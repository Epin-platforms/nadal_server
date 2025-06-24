import pool from '../../config/database.js';
import { admin } from '../../config/firebase.js';
import { getUserSocketMap } from '../../socket/websocket.js';

// 🔧 일관된 알림 그룹 관리 클래스
export class NotificationGroupManager {
  // Flutter와 동일한 그룹 정보 생성
  static getGroupInfo(type, data) {
    switch (type) {
      case 'chat':
        const roomId = data.roomId || '';
        return {
          tag: `nadal_room_${roomId}`,
          groupKey: 'nadal_chat_group',
          collapseKey: `nadal_room_${roomId}`,
          threadId: `nadal_room_${roomId}` 
        };
      case 'schedule':
        const scheduleId = data.scheduleId || '';
        return {
          tag: `nadal_schedule_${scheduleId}`,
          groupKey: 'nadal_schedule_group',
          collapseKey: `nadal_schedule_${scheduleId}`,
          threadId: `nadal_schedule_${scheduleId}`
        };
      default:
        return {
          tag: 'nadal_general',
          groupKey: 'nadal_general_group',
          collapseKey: 'nadal_general',
          threadId: 'nadal_general'
        };
    }
  }
}

// 🔧 일관된 FCM 메시지 생성 함수
export function createConsistentFCMMessage(token, data, groupInfo, isOnline = false) {
  const baseData = {
    title: data.title || '',
    body: data.body || data.subTitle || '',
    subTitle: data.subTitle || '',
    routing: data.routing || '',
    notificationId: String(data.notificationId || ''),
    type: data.type || 'general',
    alarm: data.alarm || '1',
    showNotification: "1",
    // 타입별 추가 데이터
    ...(data.roomId && { roomId: String(data.roomId) }),
    ...(data.scheduleId && { scheduleId: String(data.scheduleId) }),
    ...(data.badge && { badge: String(data.badge) })
  };

  return {
    token: token,
    data: baseData,
    android: {
      collapseKey: groupInfo.collapseKey,
      priority: "high",
      data: baseData
    },
    apns: {
      headers: {
        "apns-collapse-id": groupInfo.collapseKey,
        "apns-priority": "10"
      },
      payload: {
        aps: {
          "content-available": 1,
          alert: {
            title: data.title || '',
            body: data.body || data.subTitle || ''
          },
          sound: "default",
          badge: data.badge || 1,
          category: "nadal_notification",
          "thread-id": groupInfo.threadId
        },
        ...baseData
      }
    }
  };
}

// 🔧 DB에만 알림 생성 (FCM 전송 없음)
export async function createNotificationOnly(uid, title, subTitle, routing) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const q = `
      INSERT INTO notification (uid, title, subTitle, routing)
      VALUES (?, ?, ?, ?);
    `;
    const [result] = await conn.query(q, [uid, title, subTitle, routing]);
    const notificationId = result.insertId;
    await conn.commit();
    
    console.log(`✅ 알림 DB 저장 완료: ${notificationId} for ${uid}`);
    return notificationId;
  } catch (error) {
    await conn.rollback();
    console.error('❌ 알림 생성 트랜잭션 실패:', error);
    throw error;
  } finally {
    conn.release();
  }
}

// 🔧 일반 알림 FCM 전송
export async function sendGeneralNotificationFCM(model) {
  const { notificationId, title, subTitle, uid, routing } = model;
  
  if (!uid || !notificationId) {
    console.error('❌ FCM 전송 정보 누락:', model);
    return;
  }

  try {
    // 토큰 조회
    const [rows] = await pool.query(
      `SELECT fcmToken FROM user WHERE uid = ? AND fcmToken IS NOT NULL;`,
      [uid]
    );
    
    if (rows.length === 0) {
      console.log(`📭 FCM 토큰 없음: uid=${uid}`);
      return;
    }

    const { fcmToken } = rows[0];
    
    // 사용자 온라인 여부 확인
    const connectMap = getUserSocketMap();
    const isOnline = connectMap.has(uid);
    
    // 일관된 그룹 정보 생성
    const data = {
      title,
      body: subTitle,
      subTitle,
      routing,
      notificationId,
      type: 'general',
      alarm: '1'
    };
    
    const groupInfo = NotificationGroupManager.getGroupInfo('general', {});
    const message = createConsistentFCMMessage(fcmToken, data, groupInfo, isOnline);

    await sendFCMWithRetry(uid, message, isOnline);
    
  } catch (error) {
    console.error('❌ 일반 알림 FCM 전송 중 오류:', { notificationId, uid, error: error.message });
    throw error;
  }
}

// 🔧 채팅방 멤버들에게 FCM 알림 전송
export async function sendNotificationToRoomMembers(roomId, senderUid, chat) {
    try {
        // 방 참가자 정보 조회
        const q = `
            SELECT 
                u.fcmToken, 
                r.roomName, 
                u.uid,
                rm.alarm,
                COALESCE(
                    (SELECT COUNT(*) 
                     FROM chat c 
                     WHERE c.roomId = rm.roomId 
                       AND c.chatId > COALESCE(rm.lastRead, 0)
                    ), 0
                ) AS unread_count
            FROM roomMember rm
            LEFT JOIN room r ON rm.roomId = r.roomId
            INNER JOIN user u ON rm.uid = u.uid
            WHERE rm.roomId = ? 
              AND u.uid != ? 
              AND u.fcmToken IS NOT NULL;
        `;
        
        const [rows] = await pool.query(q, [roomId, senderUid]);
        if (rows.length === 0) {
            console.log(`📭 채팅 알림 수신자 없음 (roomId: ${roomId})`);
            return;
        }

        // 현재 소켓에 접속된 사용자 맵
        const connected = getUserSocketMap();
        
        // 일관된 그룹 정보 생성
        const chatData = { roomId: roomId.toString() };
        const groupInfo = NotificationGroupManager.getGroupInfo('chat', chatData);
        
        // 메시지 본문 결정
        const getMessageBody = (chat) => {
            if (chat.type === 1) return "(사진)";
            if (chat.type === 2) return "(일정)";
            return chat.contents || "새 메시지";
        };

        // 병렬 처리로 성능 최적화
        const sendPromises = rows.map(async (user) => {
            const isOnline = connected.has(user.uid);
            const messageBody = getMessageBody(chat);
            const title = `${user.roomName}에서의 메시지`;

            // 일관된 데이터 구조
            const data = {
                title: title,
                body: messageBody,
                subTitle: messageBody,
                roomId: roomId.toString(),
                routing: `/room/${roomId}`,
                badge: user.unread_count,
                alarm: user.alarm.toString(),
                type: "chat",
                notificationId: chat.chatId.toString()
            };

            const message = createConsistentFCMMessage(user.fcmToken, data, groupInfo, isOnline);
            
            console.log(`📱 ${isOnline ? "온라인" : "오프라인"} 사용자 채팅 알림 전송: ${user.uid}`);

            // FCM 전송 시도
            return await sendFCMWithRetry(user, message, isOnline);
        });

        // 모든 전송 완료 대기
        const results = await Promise.allSettled(sendPromises);
        
        // 결과 로깅
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const failureCount = results.filter(r => r.status === 'rejected').length;
        
        console.log(`📊 채팅 FCM 전송 결과 - 성공: ${successCount}, 실패: ${failureCount}, 총: ${rows.length}`);
        
    } catch (error) {
        console.error("❌ 채팅 알림 전송 중 치명적 오류:", error);
        throw error;
    }
}

// 🔧 게임 참가자들에게 FCM 알림 전송 (중복 제거)
export async function sendNotificationToGameMembers(scheduleId, messageContents) {
  try {
    // 게임 참가자 중 알림 대상자 조회
    const q = `
      SELECT u.uid, u.fcmToken, s.title
      FROM scheduleMember sm
      LEFT JOIN schedule s ON sm.scheduleId = s.scheduleId
      INNER JOIN user u ON sm.uid = u.uid
      WHERE sm.scheduleId = ?
        AND u.uid != s.uid
        AND u.fcmToken IS NOT NULL
        AND sm.approval = 1
    `;
    
    const [rows] = await pool.query(q, [scheduleId]);
    if (rows.length === 0) {
      console.log(`📭 게임 알림 대상 없음 (scheduleId: ${scheduleId})`);
      return;
    }
    
    console.log(`📢 게임 알림 대상 사용자: ${rows.length}명 (scheduleId: ${scheduleId})`);

    // 현재 소켓에 접속된 사용자 맵
    const connectUserMap = getUserSocketMap();

    // 일관된 그룹 정보 생성
    const scheduleData = { scheduleId: scheduleId.toString() };
    const groupInfo = NotificationGroupManager.getGroupInfo('schedule', scheduleData);

    // 병렬 처리
    const sendPromises = rows.map(async (user) => {
      try {
        // 🔧 DB에만 알림 저장 (FCM 중복 방지)
        const notificationId = await createNotificationOnly(
          user.uid,
          messageContents,
          `${user.title} 일정을 확인해볼까요?`,
          `/schedule/${scheduleId}`
        );

        // 온라인 여부 판별
        const isOnline = connectUserMap.has(user.uid);

        // 일관된 데이터 구조
        const data = {
          title: messageContents,
          body: `${user.title} 일정을 확인해볼까요?`,
          subTitle: `${user.title} 일정을 확인해볼까요?`,
          scheduleId: scheduleId.toString(),
          routing: `/schedule/${scheduleId}`,
          type: 'schedule',
          notificationId: notificationId.toString(),
          alarm: "1"
        };

        const message = createConsistentFCMMessage(user.fcmToken, data, groupInfo, isOnline);

        // FCM 전송 재시도 로직 적용
        await sendFCMWithRetry(user, message, isOnline);
        
      } catch (error) {
        console.error(`❌ 게임 알림 처리 실패 (${user.uid}):`, error.message);
        throw error;
      }
    });

    // 모든 전송 완료 대기
    const results = await Promise.allSettled(sendPromises);
    
    // 결과 로깅
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failureCount = results.filter(r => r.status === 'rejected').length;
    
    console.log(`📊 게임 스케줄 알림 결과 - 성공: ${successCount}, 실패: ${failureCount}, 총: ${rows.length}`);
    console.log('🎉 게임 스케줄 알림 처리 완료');
    
  } catch (error) {
    console.error('❗ 게임 스케줄 알림 중 치명적 오류 발생:', error);
    throw error;
  }
}

// 🔧 일반 알림 전송 함수 (외부에서 사용 가능)
export async function sendGeneralNotification(receiverUids, title, subTitle, routing) {
  try {
    if (receiverUids.length > 10) {
      throw new Error('메시지를 보낼 인원은 최대 10명까지 가능합니다');
    }

    const q = `
      SELECT u.uid, u.fcmToken 
      FROM user u 
      WHERE u.uid IN (${receiverUids.map(() => '?').join(',')}) 
        AND u.fcmToken IS NOT NULL
    `;
    
    const [rows] = await pool.query(q, receiverUids);
    if (rows.length === 0) {
      console.log('📭 일반 알림 수신자 없음');
      return [];
    }

    const connected = getUserSocketMap();
    const failedUids = [];
    
    // 일관된 그룹 정보 생성
    const groupInfo = NotificationGroupManager.getGroupInfo('general', {});

    const sendPromises = rows.map(async (user) => {
      const isOnline = connected.has(user.uid);
      
      // 일관된 데이터 구조
      const data = {
        title: title,
        body: subTitle,
        subTitle: subTitle,
        routing: routing,
        type: "general",
        alarm: "1"
      };

      const message = createConsistentFCMMessage(user.fcmToken, data, groupInfo, isOnline);

      try {
        await admin.messaging().send(message);
        console.log(`✅ 일반 알림 전송 성공: ${user.uid}`);
      } catch (error) {
        if (error.code === "messaging/registration-token-not-registered") {
          await handleInvalidToken(user.uid);
        }
        failedUids.push(user.uid);
        console.error(`❌ 일반 알림 전송 실패 (${user.uid}):`, error.message);
      }
    });

    await Promise.allSettled(sendPromises);
    
    const successCount = rows.length - failedUids.length;
    console.log(`📊 일반 알림 전송 결과 - 성공: ${successCount}, 실패: ${failedUids.length}, 총: ${rows.length}`);
    
    return failedUids;
    
  } catch (error) {
    console.error("❌ 일반 알림 전송 중 오류:", error);
    throw error;
  }
}

// FCM 전송 재시도 로직 (통합)
export async function sendFCMWithRetry(user, message, isOnline, maxRetries = 3) {
  let lastError;
  const uid = user.uid || user;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await admin.messaging().send(message);
      console.log(`✅ FCM 전송 성공: ${uid} (${isOnline ? "online" : "offline"}) - 시도: ${attempt}, messageId: ${response}`);
      return response;
    } catch (error) {
      lastError = error;
      
      // 복구 불가능한 오류들
      if (error.code === "messaging/registration-token-not-registered" || 
          error.code === "messaging/invalid-registration-token") {
        await handleInvalidToken(uid);
        console.log(`🔄 무효 토큰 삭제: ${uid}`);
        break;
      }
      
      // 일시적 오류인 경우 재시도
      if (attempt < maxRetries && isRetryableError(error)) {
        console.log(`⚠️ FCM 전송 재시도 (${attempt}/${maxRetries}): ${uid} - ${error.message}`);
        await sleep(1000 * attempt); // 지수 백오프
        continue;
      }
      
      // 최종 실패
      console.error(`❌ FCM 전송 최종 실패 (${uid}):`, error.message);
      break;
    }
  }
  
  throw lastError;
}

// 재시도 가능한 오류 판단
function isRetryableError(error) {
  const retryableCodes = [
    'messaging/internal-error',
    'messaging/server-unavailable',
    'messaging/timeout',
    'messaging/quota-exceeded'
  ];
  return retryableCodes.includes(error.code);
}

// 유틸리티: 슬립 함수
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 잘못된 토큰 처리
async function handleInvalidToken(uid) {
  try {
    const [result] = await pool.query(`UPDATE user SET fcmToken = NULL WHERE uid = ?;`, [uid]);
    if (result.affectedRows > 0) {
      console.log(`✅ 무효 FCM 토큰 제거 완료: uid=${uid}`);
    } else {
      console.log(`⚠️ 토큰 제거 대상 없음: uid=${uid}`);
    }
  } catch (err) {
    console.error(`❌ FCM 토큰 제거 실패 (uid=${uid}):`, err);
  }
}