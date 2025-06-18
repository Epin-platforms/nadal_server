import pool from '../../config/database.js';
import { admin } from '../../config/firebase.js';
import { getUserSocketMap } from '../../socket/websocket.js';

// FCM 토큰 갱신
export async function updateFCMToken(req, res) {
  try {
    const { uid } = req.user;
    const { fcmToken } = req.body;
    
    if (!fcmToken || typeof fcmToken !== 'string') {
      return res.status(400).json({ error: '유효한 FCM 토큰을 제공해주세요.' });
    }
    
    await pool.query(
      `UPDATE user SET fcmToken = ? WHERE uid = ?;`,
      [fcmToken.trim(), uid]
    );
    
    console.log(`✅ FCM 토큰 업데이트 성공: ${uid}`);
    res.sendStatus(204);
  } catch (error) {
    console.error('❌ 토큰 업데이트 실패:', error);
    res.status(500).json({ error: '서버 오류로 토큰 갱신에 실패했습니다.' });
  }
}

// 최근 7일간 알림 조회
export async function getNotifications(req, res) {
  try {
    const { uid } = req.user;
    const q = `
      SELECT *
      FROM notification
      WHERE uid = ?
        AND createAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY createAt DESC
    `;
    const [rows] = await pool.query(q, [uid]);
    res.json(rows);
  } catch (error) {
    console.error('❌ 알림 조회 실패:', error);
    res.status(500).json({ error: '알림을 불러오는 중 오류가 발생했습니다.' });
  }
}

// 클라이언트 요청으로 알림 생성 (본인 uid만 허용)
export async function createNotificationByClient(req, res) {
  try {
    const { uid, title, subTitle, routing } = req.body;
    const q = `
      INSERT INTO notification (uid, title, subTitle, routing)
      VALUES (?, ?, ?, ?);
    `;
    const [result] = await pool.query(q, [uid, title, subTitle, routing]);
    const notificationId = result.insertId;

    // FCM 발송 (비동기)
    setImmediate(() => {
      sendNotification({ notificationId, title, subTitle, uid, routing })
        .catch(err => console.error('❌ FCM 발송 에러(비동기):', err));
    });

    res.status(201).json({ notificationId });
  } catch (error) {
    console.error('❌ 알림 생성 실패:', error);
    res.status(500).json({ error: '알림 생성 중 오류가 발생했습니다.' });
  }
}

// 서버 내부용 알림 생성
export async function createNotification(uid, title, subTitle, routing) {
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

    // FCM 발송 (비동기)
    setImmediate(() => {
      sendNotification({ notificationId, title, subTitle, uid, routing })
        .catch(err => console.error('❌ FCM 발송 에러(비동기):', err));
    });

    return notificationId;
  } catch (error) {
    await conn.rollback();
    console.error('❌ 알림 생성 트랜잭션 실패:', error);
    throw error;
  } finally {
    conn.release();
  }
}

// 🔧 수정된 FCM 메시지 전송 함수
async function sendNotification(model) {
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
    
    // collapseKey 설정 (알림 그룹화)
    const collapseKey = `nadal_${notificationId}`;
    
    // 🔧 모든 사용자에게 data-only 메시지 전송 (Flutter에서 알림 제어)
    const message = {
      token: fcmToken,
      data: {
        title: title || '',
        body: subTitle || '',
        subTitle: subTitle || '',
        routing: routing || '',
        notificationId: String(notificationId),
        type: "general",
        alarm: "1",
        // 🔧 모든 사용자에게 "1"로 보내서 Flutter에서 판단하게 함
        showNotification: "1"
      },
      android: {
        collapseKey: collapseKey,
        priority: "high",
        data: {
          title: title || '',
          body: subTitle || '',
          subTitle: subTitle || '',
          routing: routing || '',
          notificationId: String(notificationId),
          type: "general",
          alarm: "1",
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
              title: title || '',
              body: subTitle || ''
            },
            sound: "default",
            category: "nadal_notification"
          },
          title: title || '',
          body: subTitle || '',
          subTitle: subTitle || '',
          routing: routing || '',
          notificationId: String(notificationId),
          type: "general",
          alarm: "1",
          showNotification: "1"
        }
      }
    };

    // FCM 전송 재시도 로직 적용
    await sendFCMWithRetry(uid, message, isOnline);
    
  } catch (error) {
    console.error('❌ FCM 메시지 전송 중 치명적 오류:', { notificationId, uid, error: error.message });
    throw error;
  }
}

// FCM 전송 재시도 로직
async function sendFCMWithRetry(uid, message, isOnline, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await admin.messaging().send(message);
      console.log(`✅ 일반 알림 FCM 전송 성공: ${uid} (${isOnline ? "online" : "offline"}) - 시도: ${attempt}, messageId: ${response}`);
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
        console.log(`⚠️ 일반 알림 FCM 전송 재시도 (${attempt}/${maxRetries}): ${uid} - ${error.message}`);
        await sleep(1000 * attempt); // 지수 백오프
        continue;
      }
      
      // 최종 실패
      console.error(`❌ 일반 알림 FCM 전송 최종 실패 (${uid}):`, error.message);
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

// 잘못된 토큰 처리 (개선된 버전)
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

// 알림 읽음 처리
export async function readNotification(req, res) {
  try {
    const { uid } = req.user;
    const { notificationId } = req.body;
    
    if (!notificationId) {
      return res.status(400).json({ error: '알림 ID가 필요합니다.' });
    }
    
    const q = `
      UPDATE notification
      SET readState = 1
      WHERE notificationId = ? AND uid = ? AND readState = 0;
    `;
    const [result] = await pool.query(q, [notificationId, uid]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '알림을 찾을 수 없거나 이미 읽음 처리되었습니다.' });
    }
    
    console.log(`✅ 알림 읽음 처리 완료: notificationId=${notificationId}, uid=${uid}`);
    res.sendStatus(204);
  } catch (error) {
    console.error('❌ 알림 읽음 처리 실패:', error);
    res.status(500).json({ error: '알림 처리 중 오류가 발생했습니다.' });
  }
}

// 알림 삭제 (본인만 가능)
export async function removeNotification(req, res) {
  try {
    const { uid } = req.user;
    const { notificationId } = req.params;
    
    if (!notificationId) {
      return res.status(400).json({ error: '알림 ID가 필요합니다.' });
    }
    
    const q = `
      DELETE FROM notification
      WHERE notificationId = ? AND uid = ?;
    `;
    const [result] = await pool.query(q, [notificationId, uid]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '삭제할 알림을 찾을 수 없습니다.' });
    }
    
    console.log(`✅ 알림 삭제 완료: notificationId=${notificationId}, uid=${uid}`);
    res.sendStatus(204);
  } catch (error) {
    console.error('❌ 알림 삭제 실패:', error);
    res.status(500).json({ error: '알림 삭제 중 오류가 발생했습니다.' });
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

    const sendPromises = rows.map(async (user) => {
      const isOnline = connected.has(user.uid);
      
      const message = {
        token: user.fcmToken,
        data: {
          title: title,
          body: subTitle,
          subTitle: subTitle,
          routing: routing,
          type: "general",
          alarm: "1",
          showNotification: "1"
        },
        android: {
          priority: "high",
          data: {
            title: title,
            body: subTitle,
            subTitle: subTitle,
            routing: routing,
            type: "general",
            alarm: "1",
            showNotification: "1"
          }
        },
        apns: {
          headers: {
            "apns-priority": isOnline ? "5" : "10"
          },
          payload: {
            aps: isOnline ? {
              "content-available": 1
            } : {
              "content-available": 1,
              alert: {
                title: title,
                body: subTitle
              },
              sound: "default"
            },
            title: title,
            body: subTitle,
            subTitle: subTitle,
            routing: routing,
            type: "general",
            alarm: "1",
            showNotification: "1"
          }
        }
      };

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