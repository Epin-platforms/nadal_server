import pool from '../../config/database.js';
import { admin } from '../../config/firebase.js';
import { getUserSocketMap } from '../../socket/websocket.js';
import { createNotification } from '../notification/notificationController.js';

// 🔧 수정된 게임 참가자들에게 메시지 보내기
export async function sendNotificationToGameMembers(scheduleId, messageContents) {
  try {
    // 1) 게임 참가자 중 알림 대상자 조회
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

    // 2) 현재 소켓에 접속된 사용자 맵
    const connectUserMap = getUserSocketMap();

    // 3) collapseKey: 동일 스케줄 알림을 하나로 묶기 위한 키
    const collapseKey = `schedule_${scheduleId}`;

    // 4) 푸시 알림 병렬 전송
    const sendPromises = rows.map(async (user) => {
      try {
        // 4-1) DB에 알림 저장 및 ID 반환
        const notificationId = await createNotification(
          user.uid,
          messageContents,
          `${user.title} 일정을 확인해볼까요?`,
          `/schedule/${scheduleId}`
        );

        // 4-2) 온라인 여부 판별
        const isOnline = connectUserMap.has(user.uid);

        // 4-3) 메시지 본문 결정
        const msgTitle = messageContents;
        const msgBody = `${user.title} 일정을 확인해볼까요?`;

        // 4-4) 🔧 모든 사용자에게 data-only 메시지 전송 (Flutter에서 알림 제어)
        const msg = {
          token: user.fcmToken,
          data: {
            title: msgTitle,
            body: msgBody,
            scheduleId: scheduleId.toString(),
            routing: `/schedule/${scheduleId}`,
            type: 'schedule',
            notificationId: notificationId.toString(),
            // 🔧 모든 사용자에게 "1"로 보내서 Flutter에서 판단하게 함
            showNotification: "1"
          },
          android: {
            collapseKey: collapseKey,
            priority: "high",
            data: {
              title: msgTitle,
              body: msgBody,
              scheduleId: scheduleId.toString(),
              routing: `/schedule/${scheduleId}`,
              type: 'schedule',
              notificationId: notificationId.toString(),
              showNotification: "1"
            }
          },
          apns: {
            headers: {
              "apns-collapse-id": collapseKey,
              "apns-priority": isOnline ? "5" : "10"
            },
            payload: {
              aps: {
                "content-available": 1,
                alert: {
                  title: msgTitle,
                  body: msgBody
                },
                sound: "default",
                badge: 1,
                category: "nadal_notification",
                "thread-id": collapseKey
              },
              title: msgTitle,
              body: msgBody,
              scheduleId: scheduleId.toString(),
              routing: `/schedule/${scheduleId}`,
              type: 'schedule',
              notificationId: notificationId.toString(),
              showNotification: "1"
            }
          }
        };

        // 4-5) FCM 전송 재시도 로직 적용
        await sendFCMWithRetry(user, msg, isOnline);
        
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

// FCM 전송 재시도 로직
async function sendFCMWithRetry(user, message, isOnline, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await admin.messaging().send(message);
      console.log(`✅ 게임 FCM 전송 성공: ${user.uid} (${isOnline ? "online" : "offline"}) - 시도: ${attempt}`);
      return response;
    } catch (error) {
      lastError = error;
      
      // 복구 불가능한 오류들
      if (error.code === "messaging/registration-token-not-registered" || 
          error.code === "messaging/invalid-registration-token") {
        await handleInvalidToken(user.uid);
        console.log(`🔄 무효 토큰 삭제: ${user.uid}`);
        break;
      }
      
      // 일시적 오류인 경우 재시도
      if (attempt < maxRetries && isRetryableError(error)) {
        console.log(`⚠️ 게임 FCM 전송 재시도 (${attempt}/${maxRetries}): ${user.uid} - ${error.message}`);
        await sleep(1000 * attempt); // 지수 백오프
        continue;
      }
      
      // 최종 실패
      console.error(`❌ 게임 FCM 전송 최종 실패 (${user.uid}):`, error.message);
      break;
    }
  }
  
  throw lastError;
}

// 무효 토큰 처리
async function handleInvalidToken(uid) {
  try {
    const [result] = await pool.query(`UPDATE user SET fcmToken = NULL WHERE uid = ?`, [uid]);
    if (result.affectedRows > 0) {
      console.log(`✅ 무효 FCM 토큰 제거 완료: uid=${uid}`);
    } else {
      console.log(`⚠️ 토큰 제거 대상 없음: uid=${uid}`);
    }
  } catch (error) {
    console.error(`❌ 토큰 삭제 실패 (${uid}):`, error);
  }
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

// 🔧 향상된 스케줄 알림 전송 (다중 사용자 지원)
export async function sendScheduleNotificationToUsers(userIds, title, body, scheduleId) {
  try {
    if (userIds.length > 20) {
      throw new Error('스케줄 알림을 보낼 인원은 최대 20명까지 가능합니다');
    }

    const q = `
      SELECT u.uid, u.fcmToken 
      FROM user u 
      WHERE u.uid IN (${userIds.map(() => '?').join(',')}) 
        AND u.fcmToken IS NOT NULL
    `;
    
    const [rows] = await pool.query(q, userIds);
    if (rows.length === 0) {
      console.log('📭 스케줄 알림 수신자 없음');
      return [];
    }

    const connected = getUserSocketMap();
    const collapseKey = `schedule_${scheduleId}`;
    const failedUids = [];

    const sendPromises = rows.map(async (user) => {
      const isOnline = connected.has(user.uid);
      
      const message = {
        token: user.fcmToken,
        data: {
          title: title,
          body: body,
          scheduleId: scheduleId.toString(),
          routing: `/schedule/${scheduleId}`,
          type: "schedule",
          showNotification: "1"
        },
        android: {
          collapseKey: collapseKey,
          priority: "high",
          data: {
            title: title,
            body: body,
            scheduleId: scheduleId.toString(),
            routing: `/schedule/${scheduleId}`,
            type: "schedule",
            showNotification: "1"
          }
        },
        apns: {
          headers: {
            "apns-collapse-id": collapseKey,
            "apns-priority": isOnline ? "5" : "10"
          },
          payload: {
            aps: isOnline ? {
              "content-available": 1
            } : {
              "content-available": 1,
              alert: {
                title: title,
                body: body
              },
              sound: "default",
              category: "nadal_notification",
              "thread-id": collapseKey
            },
            title: title,
            body: body,
            scheduleId: scheduleId.toString(),
            routing: `/schedule/${scheduleId}`,
            type: "schedule",
            showNotification: "1"
          }
        }
      };

      try {
        await admin.messaging().send(message);
        console.log(`✅ 스케줄 알림 전송 성공: ${user.uid}`);
      } catch (error) {
        if (error.code === "messaging/registration-token-not-registered") {
          await handleInvalidToken(user.uid);
        }
        failedUids.push(user.uid);
        console.error(`❌ 스케줄 알림 전송 실패 (${user.uid}):`, error.message);
      }
    });

    await Promise.allSettled(sendPromises);
    
    const successCount = rows.length - failedUids.length;
    console.log(`📊 스케줄 알림 전송 결과 - 성공: ${successCount}, 실패: ${failedUids.length}, 총: ${rows.length}`);
    
    return failedUids;
    
  } catch (error) {
    console.error("❌ 스케줄 알림 전송 중 오류:", error);
    throw error;
  }
}