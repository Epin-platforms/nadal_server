import pool from '../../config/database.js';
import { 
  createNotificationOnly, 
  sendGeneralNotificationFCM,
  sendFCMWithRetry,
  NotificationGroupManager,
  createConsistentFCMMessage
} from './notificationService.js';

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

// 클라이언트 요청으로 알림 생성
export async function createNotificationByClient(req, res) {
  try {
    const { uid, title, subTitle, routing } = req.body;
    const notificationId = await createNotificationOnly(uid, title, subTitle, routing);

    // FCM 발송 (비동기)
    setImmediate(() => {
      sendGeneralNotificationFCM({ notificationId, title, subTitle, uid, routing })
        .catch(err => console.error('❌ FCM 발송 에러(비동기):', err));
    });

    res.status(201).json({ notificationId });
  } catch (error) {
    console.error('❌ 알림 생성 실패:', error);
    res.status(500).json({ error: '알림 생성 중 오류가 발생했습니다.' });
  }
}

// 🔧 기존 호환성을 위한 함수 (DB 저장 + FCM 전송)
export async function createNotification(uid, title, subTitle, routing) {
  try {
    const notificationId = await createNotificationOnly(uid, title, subTitle, routing);
    
    // FCM 발송 (비동기)
    setImmediate(() => {
      sendGeneralNotificationFCM({ notificationId, title, subTitle, uid, routing })
        .catch(err => console.error('❌ FCM 발송 에러(비동기):', err));
    });

    return notificationId;
  } catch (error) {
    console.error('❌ 알림 생성 및 전송 실패:', error);
    throw error;
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

// 알림 삭제
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