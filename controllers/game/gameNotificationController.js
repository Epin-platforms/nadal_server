import pool from '../../config/database.js';
import { admin } from '../../config/firebase.js';
import { getUserSocketMap } from '../../socket/websocket.js'
import { createNotification } from '../notification/notificationController.js';



//게임참가자들에게 메시지 모내기
export async function sendNotificationToGameMembers(scheduleId, messageContents) {
  try {
    // 게임 참가자 중 알림 대상자 가져오기
    const q = `
      SELECT u.uid, u.fcmToken, s.title
      FROM scheduleMember sm
      LEFT JOIN schedule s ON sm.scheduleId = s.scheduleId
      INNER JOIN user u ON sm.uid = u.uid
      WHERE sm.scheduleId = ? 
        AND u.uid != s.uid 
        AND u.fcmToken IS NOT NULL
    `;

    const [rows] = await pool.query(q, [scheduleId]);

    if (rows.length === 0) {
      console.log("알림을 보낼 대상이 없습니다.");
      return;
    }

    console.log(`알림 대상 사용자: ${rows.length}명`);

    const connectedUsers = [];
    const disconnectedUsers = [];

    const connectUserMap = getUserSocketMap();

    // 사용자 분리 및 알림 모델 생성
    for (const user of rows) {
      await createNotification(
        user.uid,
        messageContents,
        `${user.title} 일정을 확인해볼까요?`,
        `/schedule/${scheduleId}`
      );

      if (connectUserMap.has(user.uid)) {
        connectedUsers.push(user);
      } else {
        disconnectedUsers.push(user);
      }
    }

    // 접속하지 않은 사용자에게 FCM 푸시 전송
    await Promise.allSettled(
      disconnectedUsers.map(async (user) => {
        const message = {
          token: user.fcmToken,
          notification: {
            title: messageContents,
            body: `${user.title} 일정을 확인해볼까요?`,
          },
          data: {
            scheduleId: scheduleId.toString(),              // ✅ chat의 roomId 대응
            routing: `/schedule/${scheduleId}`,
            alarm: "1",                                     // ❗별도 알람 설정 있으면 적용
            type: "schedule",                               // ✅ 구분 명확히
          },
          android: {
            priority: "high",
            notification: {
              title: `${user.title}`,
              body: messageContents,
              channelId: "epin.nadal.chat.channel",
              sound: "default",
              tag: scheduleId.toString()
            },
          },
          apns: {
            payload: {
              aps: {
                sound: "default",
                badge: 0 // 필요에 따라 숫자 지정
              },
            },
          },
        };

        try {
          await admin.messaging().send(message);
          console.log(`📤 푸시 전송 성공 (비접속): ${user.uid}`);
        } catch (error) {
          console.error(`❌ 푸시 실패 (비접속): ${user.uid} - ${error.message}`);
        }
      })
    );

    // 접속 중인 사용자에게 데이터 메시지 전송
    await Promise.allSettled(
      connectedUsers.map(async (user) => {
        const message = {
          token: user.fcmToken,
          data: {
            title: messageContents,
            body: `${user.title} 일정을 확인해볼까요?`,                
            scheduleId: scheduleId.toString(),         
            routing: `/schedule/${scheduleId}`,
            alarm: "1",                             
            type: 'schedule',
          }
        }
        try {
          await admin.messaging().send(message);
          console.log(`📤 푸시 전송 성공 (접속): ${user.uid}`);
        } catch (error) {
          console.error(`❌ 푸시 실패 (접속): ${user.uid} - ${error.message}`);
        }
      })
    );

  } catch (error) {
    console.error("❗ 푸시 알림 전송 중 오류 발생:", error);
  }
}
