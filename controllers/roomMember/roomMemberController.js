import pool from '../../config/database.js';
import { getSocket, getSocketIdByUid } from '../../socket/websocket.js';
import { createNotification } from '../notification/notificationController.js';
import { createLog } from '../room/log/logController.js';

//방 멤버들 불러오기
export async function getRoomMembers(req, res){
    try{
        const roomId = Number(req.params.roomId);
        const {uid} = req.user;

        const q = `
            SELECT rm.*, 
                r.useNickname,
                -- 닉네임 또는 이름
                CASE WHEN r.useNickname = 0 THEN u.name ELSE u.nickName END AS displayName,

                -- 프로필 이미지는 공통
                u.profileImage,

                -- 성별 (닉네임 사용 안할 경우에만 노출)
                CASE WHEN r.useNickname = 0 THEN u.gender ELSE NULL END AS gender,

                -- 출생년도 (닉네임 사용 안할 경우에만 노출)
                CASE WHEN r.useNickname = 0 THEN u.birthYear ELSE NULL END AS birthYear

            FROM roomMember rm
            LEFT JOIN user u ON rm.uid = u.uid
            LEFT JOIN room r ON rm.roomId = r.roomId
            WHERE rm.roomId = ? AND rm.uid != ?;
        `;

        const [rows] = await pool.query(q, [roomId, uid]);

        res.json(rows);
    }catch(error){
        console.error(error);
        res.status(500).send();
    }

}


export async function updateLastRead(req, res) {
    try{
        const {uid} = req.user;
        const roomId = Number(req.params.roomId);
        const lastRead = Number(req.query.lastRead);

        const q = `
            UPDATE roomMember
            SET lastRead = ?
            WHERE uid = ? AND roomId = ?;
        `;

        await pool.query(q, [lastRead, uid, roomId]);

        const io = getSocket();
        io.to(`roomId:${roomId}`).emit('updateLastRead', {
            uid: uid,
            lastRead: lastRead,
        });

        res.send();
    }catch(error){
        console.error('마지막 읽기 업데이트 오류',error);
        res.status(500).send(); 
    }
}

//내정보 불러오기
export async function getMyRoomMemberDataWithRoomId(req, res) {
    try {
        const roomId = Number(req.params.roomId);
        const {uid} = req.user;

        const q = `
            SELECT
            r.*,
            (
                SELECT COUNT(*)
                FROM chat AS c
                WHERE c.roomId   = r.roomId
                AND c.chatId > r.lastRead
            ) AS unreadCount
            FROM roomMember AS r
            WHERE r.uid    = ?  -- 바인딩: 내 UID
            AND r.roomId = ?; -- 바인딩: 조회할 roomId
        `;
        
        const [rows] = await pool.query(q, [uid, roomId]);
        res.json(rows[0]);
    } catch (error) {
        console.error('방내 내정보가져오기 오류',error);
        res.status(500).send(); 
    }
}

//방나가기
export async function exitRoom(req, res) {
    try{
        const {uid} = req.user;
        const roomId = Number(req.params.roomId);

        const q = `DELETE FROM roomMember WHERE roomId = ? AND uid = ?;`;
        
        await pool.query(q, [roomId, uid]);

        await createLog(roomId, uid, '님이 퇴장했습니다');
        
        res.send();
    }catch(error){
        console.error('방 나가기 오류',error);
        res.status(500).send(); 
    }
}

//방 탈퇴시키기
export async function kickedMember(req, res) {
    const conn = await pool.getConnection();
    try {
        const {uid, roomId} = req.body;

        console.log('🔥 추방 요청:', { uid, roomId }); // 디버깅 로그

        // ✅ 입력 데이터 검증
        if (!uid || !roomId) {
            console.log('❌ 필수 데이터 누락:', { uid, roomId });
            return res.status(400).json({ error: '필수 데이터가 누락되었습니다' });
        }

        await conn.beginTransaction();

        //방정보 가져오기
        const [rooms] = await conn.query(`SELECT roomName, local FROM room WHERE roomId = ?;`, [roomId]);

        if(rooms.length == 0){
            console.log('❌ 방을 찾을 수 없음:', roomId);
            await conn.commit();
            return res.status(404).json({ error: '방을 찾을 수 없습니다' });
        }

        // ✅ 오타 수정: room[0] → rooms[0]
        const room = rooms[0];
        console.log('✅ 방 정보:', room);

        // ✅ 멤버 존재 여부 확인
        const [existingMember] = await conn.query(
            `SELECT uid FROM roomMember WHERE roomId = ? AND uid = ?;`, 
            [roomId, uid]
        );

        if (existingMember.length === 0) {
            console.log('❌ 방에 해당 멤버가 없음:', { uid, roomId });
            await conn.commit();
            return res.status(404).json({ error: '해당 멤버가 방에 존재하지 않습니다' });
        }

        // ✅ 이미 블랙리스트에 있는지 확인
        const [existingBlacklist] = await conn.query(
            `SELECT uid FROM blackList WHERE roomId = ? AND uid = ?;`, 
            [roomId, uid]
        );

        //추방하기
        const [deleteResult] = await conn.query(`DELETE FROM roomMember WHERE roomId = ? AND uid = ?;`, [roomId, uid]);
        console.log('✅ 멤버 삭제 결과:', deleteResult);

        //블랙리스트 등록 (중복 방지)
        if (existingBlacklist.length === 0) {
            await conn.query(`INSERT INTO blackList(uid, roomId) VALUES (?,?);`,[uid, roomId]);
            console.log('✅ 블랙리스트 등록 완료');
        } else {
            console.log('ℹ️ 이미 블랙리스트에 등록됨');
        }

        //방 로그 만들기
        await createLog(roomId, uid, '님이 추방되었습니다');
        console.log('✅ 로그 생성 완료');

        await conn.commit();
        console.log('✅ 트랜잭션 커밋 완료');

        //추방당한 사용자에게 알리기
        const io = getSocket();
        
        // ✅ 소켓 연결 확인
        if (!io) {
            console.log('❌ 소켓 서버가 연결되지 않음');
        } else {
            console.log('✅ 소켓 서버 연결됨');
        }

        const socketId = getSocketIdByUid(uid);
        console.log('🔍 추방 대상 소켓 ID:', socketId);
        
        //방 전체에게 멤버 업데이트 요청
        io.to(`roomId:${roomId}`).emit("refreshMember");
        console.log('📡 방 전체에게 refreshMember 전송:', `roomId:${roomId}`);

        //현재 접속중인 사용자가있다면 킥 요청
        //푸시 메시지 날리기
        await createNotification(uid, `채팅방에서 추방되었습니다`, `${room.roomName} 방에 2달간 접근이 불가합니다`, null);
        console.log('✅ 푸시 알림 전송 완료');
        
        if (socketId != null){
            console.log('📡 개별 사용자에게 kicked 이벤트 전송:', socketId);
            io.to(socketId).emit('kicked', { roomId: roomId, room: room });
        } else {
            console.log('ℹ️ 추방 대상이 현재 접속하지 않음');
        }

        console.log('✅ 추방 처리 완료');
        res.status(200).json({ success: true, message: '추방이 완료되었습니다' });
        
    } catch (error) {
        await conn.rollback();
        console.error('❌ 추방하기 오류:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다', details: error.message }); 
    } finally {
        conn.release();
    }
}

// 방 멤버 등급 설정 (트랜잭션 적용)
export async function changedMemberGrade(req, res) {
    const { uid } = req.user;
    const { targetUid, roomId, grade } = req.body;
    const conn = await pool.getConnection();
  
    try {
      await conn.beginTransaction();
  
      // 1) 대상 멤버 등급 변경
      const q1 = `
        UPDATE roomMember
        SET grade = ?
        WHERE roomId = ? AND uid = ?;
      `;

      await conn.query(q1, [grade, roomId, targetUid]);
  
      // 2) 만약 새 클럽장(grade === 0)이라면, 기존 내 등급을 매니저(1)로 하향
      if (grade === 0) {
        const q2 = `
          UPDATE roomMember
          SET grade = 1
          WHERE roomId = ? AND uid = ?;
        `;
        await conn.query(q2, [roomId, uid]);
      }
  
      // 3) 로그 기록 (roomLog 테이블에 삽입하는 예시)
      const gradeStr = grade === 0
        ? '클럽장'
        : grade === 1
          ? '매니저'
          : grade === 2
            ? '정회원'
            : '신입';

      const logQuery = `
        INSERT INTO roomLog (roomId, uid, action)
        VALUES (?, ?, ?);
      `;

      await conn.query(logQuery, [roomId, targetUid, `${gradeStr} 등급으로 변경되었습니다.`]);
  
      await conn.commit();
  
      // — 이 시점부터는 DB 트랜잭션이 성공적으로 커밋된 이후 작업 —
  
      // 4) 방 안 전체에 소켓 이벤트
      const io = getSocket();
      io.to(`roomId:${roomId}`).emit('gradeChanged', { roomId, uid: targetUid, grade });
  
      if (grade === 0) {
        // 본인(구 클럽장)을 매니저로 변경한 이벤트도 발송
        io.to(`roomId:${roomId}`).emit('gradeChanged', { roomId, uid, grade: 1 });
      }
  
      // 5) 대상에게 푸시 알림 생성
      await createNotification(
        targetUid,
        '멤버 등급이 변경되었어요',
        '지금 바로 확인해보세요',
        `/room/${roomId}`
      );
  
      res.send();
    } catch (error) {
      await conn.rollback();
      console.error('등급 변경 오류:', error);
      res.status(500).send();
    } finally {
      conn.release();
    }
  }
  