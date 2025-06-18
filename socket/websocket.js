import { Server } from "socket.io";
import pool from "../config/database.js";

let io;
let userSocketMap = new Map();
// 사용자당 참여 가능한 최대 방 수를 제한 (DoS 방지)
let userRoomCount = new Map();
// 간단한 채널 접근 권한 캐시
let roomAccessCache = new Map();

// 🔧 **추가: 핑퐁 관리**
let pingIntervals = new Map(); // 사용자별 ping 인터벌 관리

export function setupWebSocket(server) {
  console.log('소켓 서버 시작');
  
  //접근은 누구나 가능하게, 하지만 최소한의 검증 추가
  io = new Server(server, {
    cors: {
      origin: '*'
    },
    // 🔧 **추가: Socket.IO 설정 개선**
    pingTimeout: 60000,    // 60초 후 연결 해제
    pingInterval: 25000,   // 25초마다 ping 전송
    upgradeTimeout: 30000, // 30초 업그레이드 타임아웃
    allowEIO3: true       // EIO3 호환성
  });
  
  // 최소한의 연결 검증 (클라이언트에서 전송한 UID 사용)
  io.use((socket, next) => {
    // 헤더에서 uid 추출 (방법 1)
    const headerUid = socket.handshake.headers.uid;
    
    // 또는 Auth 데이터에서 uid 추출 (방법 2) 
    const authUid = socket.handshake.auth.uid;
    
    // 둘 중 하나라도 있으면 사용
    const uid = headerUid || authUid;
    
    // uid가 없으면 연결 거부
    if (!uid) {
      return next(new Error('인증 정보가 없습니다'));
    }
    
    // uid를 socket.data에 저장 (이후 접근용)
    socket.data.uid = uid;
    
    // 사용자당 방 카운트 초기화
    userRoomCount.set(uid, 0);
    
    return next();
  });
  
  io.on('connection', (socket) => {
    const uid = socket.data.uid;
    userSocketMap.set(uid, socket.id);
    console.log(`${uid} 유저가 서버에 접속 ${socket.id}`);

    // 🔧 **추가: 핑퐁 처리**
    setupPingPong(socket, uid);
    
    // 소켓 연결 해제 시 처리
    socket.on('disconnect', (reason) => {
      console.log(`사용자 나감 : ${uid}, 이유: ${reason}`);
      
      // 🔧 **추가: 핑퐁 정리**
      cleanupPingPong(uid);
      
      userSocketMap.delete(uid);
      userRoomCount.delete(uid);
      
      // 방 접근 캐시에서 해당 유저 관련 항목들 정리
      cleanupUserCache(uid);
      
      // 모든 방에서 자동 퇴장 처리 (메모리 누수 방지)
      socket.rooms.forEach(room => {
        if (room !== socket.id) { // 소켓 ID는 기본 room이므로 제외
          socket.leave(room);
        }
      });
    });
    
    //방 소켓 연결 (간단한 검증 추가)
    socket.on('join', async (roomId) => {
      try {
        // 유효하지 않은 roomId 거부 (int형 검증)
        if (roomId === undefined || !Number.isInteger(roomId) || roomId <= 0) {
          return socket.emit('error', { message: '유효하지 않은 방 ID입니다.' });
        }
        
        // 참여 가능한 최대 방 수 제한 (DoS 방지)
        const userJoinedRooms = userRoomCount.get(uid) || 0;
        if (userJoinedRooms >= 50) { // 최대 50개 방으로 제한
          return socket.emit('error', { message: '참여 가능한 최대 방 수를 초과했습니다.' });
        }
        
        // 간단한 접근 권한 확인 (캐시 활용)
        const accessKey = `${uid}_${roomId}`;
        let hasAccess = roomAccessCache.get(accessKey);
        
        if (hasAccess === undefined) {
          // 캐시에 없으면 DB에서 확인 (이미 함수로 구현되어 있는 것으로 가정)
          // 실제로는 이 부분이 getMyRoomMemberData 내부에서 처리될 수도 있음
          hasAccess = await checkRoomAccess(uid, roomId);
          roomAccessCache.set(accessKey, hasAccess);
          
          // 캐시 크기 관리 (최대 10000개 항목으로 제한)
          if (roomAccessCache.size > 10000) {
            const oldestKey = roomAccessCache.keys().next().value;
            roomAccessCache.delete(oldestKey);
          }
        }
        
        if (!hasAccess) {
          return socket.emit('error', { message: '방에 접근할 권한이 없습니다.' });
        }
        
        // 1) 방 입장
        const roomChannel = `roomId:${roomId}`;
        socket.join(roomChannel);
        userRoomCount.set(uid, userJoinedRooms + 1);
        console.log(`${roomChannel}방에 ${uid} 사용자가 접속했습니다`);
        
        // 4) 클라이언트에 전송 (이벤트 이름: 'joinedRoom')
        socket.emit('joinedRoom');
      } catch (err) {
        console.error('join 처리 중 오류:', err);
        socket.emit('error', { message: '방 참여 중 오류가 발생했습니다.' });
      }
    });
    
    //방 소켓 종료
    socket.on('leave', (roomId) => {
      // int형 roomId 검증
      if (roomId === undefined || !Number.isInteger(roomId) || roomId <= 0) {
        return socket.emit('error', { message: '유효하지 않은 방 ID입니다.' });
      }
      
      const roomChannel = `roomId:${roomId}`;
      socket.leave(roomChannel);
      
      // 사용자의 참여 방 수 감소
      const userJoinedRooms = userRoomCount.get(uid) || 0;
      if (userJoinedRooms > 0) {
        userRoomCount.set(uid, userJoinedRooms - 1);
      }
    });
    
    ///게임///
    socket.on('joinGame', (scheduleId) => {
      // int형 scheduleId 검증
      if (scheduleId === undefined || !Number.isInteger(scheduleId) || scheduleId <= 0) {
        return socket.emit('error', { message: '유효하지 않은 일정 ID입니다.' });
      }
      
      console.log('게임방접속');
      const gameChannel = `gameId:${scheduleId}`;
      socket.join(gameChannel);
      
      // 입장 확인 메시지 (선택적)
      socket.emit('gameJoined', { scheduleId });
    });
    
    socket.on('leaveGame', (scheduleId) => {
      // int형 scheduleId 검증 (간단하게 유효성만 확인)
      if (scheduleId === undefined || !Number.isInteger(scheduleId) || scheduleId <= 0) {
        return;
      }
      console.log('게임방접속해제');
      const gameChannel = `gameId:${scheduleId}`;
      socket.leave(gameChannel);
    });
  });
  
  return io;
}

// 🔧 **추가: 핑퐁 설정 함수**
function setupPingPong(socket, uid) {
  // 클라이언트에서 ping을 받으면 pong으로 응답
  socket.on('ping', () => {
    socket.emit('pong');
    console.log(`🏓 ${uid}에게 pong 응답 전송`);
  });

  // 🔧 **추가: 서버에서 주기적으로 ping 전송 (선택사항)**
  const pingInterval = setInterval(() => {
    if (socket.connected) {
      socket.emit('serverPing');
      console.log(`📡 ${uid}에게 서버 ping 전송`);
    } else {
      clearInterval(pingInterval);
      pingIntervals.delete(uid);
    }
  }, 30000); // 30초마다 ping 전송

  pingIntervals.set(uid, pingInterval);

  // 클라이언트에서 서버 ping에 대한 응답
  socket.on('serverPong', () => {
    console.log(`🏓 ${uid}로부터 서버 pong 응답 수신`);
  });
}

// 🔧 **추가: 핑퐁 정리 함수**
function cleanupPingPong(uid) {
  const pingInterval = pingIntervals.get(uid);
  if (pingInterval) {
    clearInterval(pingInterval);
    pingIntervals.delete(uid);
    console.log(`🧹 ${uid}의 ping 인터벌 정리됨`);
  }
}

// 🔧 **추가: 사용자 캐시 정리 함수**
function cleanupUserCache(uid) {
  // 해당 사용자와 관련된 모든 캐시 항목 삭제
  for (const [key, value] of roomAccessCache.entries()) {
    if (key.startsWith(`${uid}_`)) {
      roomAccessCache.delete(key);
    }
  }
  console.log(`🧹 ${uid}의 캐시 정리됨`);
}

// 방 접근 권한 확인 함수
async function checkRoomAccess(uid, roomId) {
  try {
    const q = `
      SELECT 1 FROM roomMember
      WHERE uid = ? AND roomId = ?
      LIMIT 1;
    `;
    
    const [rows] = await pool.query(q, [uid, roomId]);
    
    return rows.length > 0;
  } catch (error) {
    console.error('방 접근 권한 확인 중 오류:', error);
    // 오류 발생 시 기본적으로 접근 거부
    return false;
  }
}

export function getSocket(){
  if (!io) {
    console.log("io없음");
    throw new Error('Socket.io not initialized');
  }
  return io;
}

//접속한 사용자 전체 불러오기
export function getUserSocketMap() {
  if (userSocketMap.size === 0) {
    throw new Error('userSocketMap is empty');
  }
  return userSocketMap;
}

export function getSocketIdByUid(uid) {
  // Map에 uid 키가 있으면 socketId를 꺼내고, 없으면 null 반환
  const socketId = userSocketMap.get(uid) ?? null;
  return socketId;
}

// 🔧 **추가: 연결 상태 체크 유틸리티 함수**
export function checkUserConnection(uid) {
  const socketId = userSocketMap.get(uid);
  if (!socketId) return false;
  
  const socket = io.sockets.sockets.get(socketId);
  return socket && socket.connected;
}

// 🔧 **추가: 전체 연결 상태 정리 함수 (정기적으로 호출 권장)**
export function cleanupDisconnectedUsers() {
  const disconnectedUsers = [];
  
  for (const [uid, socketId] of userSocketMap.entries()) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket || !socket.connected) {
      disconnectedUsers.push(uid);
    }
  }
  
  disconnectedUsers.forEach(uid => {
    userSocketMap.delete(uid);
    userRoomCount.delete(uid);
    cleanupPingPong(uid);
    cleanupUserCache(uid);
  });
  
  if (disconnectedUsers.length > 0) {
    console.log(`🧹 끊어진 연결 정리: ${disconnectedUsers.length}명`);
  }
  
  return disconnectedUsers.length;
}