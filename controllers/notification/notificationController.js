import pool from '../../config/database.js';
import { admin } from '../../config/firebase.js';
import { getUserSocketMap } from '../../socket/websocket.js';


export async function updateFCMToken(req, res){
    try {
       const {uid} = req.user;
       const {fcmToken} = req.body;
       await pool.query(
        `UPDATE user
         SET fcmToken = ?
         WHERE uid = ?;
        `, [fcmToken, uid]
       );

       res.send();
    } catch (error) {
        console.error('토큰 업데이트 쿼리 실패', error);
        res.status(500).send();
    }
}


export async function getNotifications(req, res){
    try {
       const {uid} = req.user;
    
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
        console.error('알림리스트 쿼리 실패', error);
        res.status(500).send();
    }
}

export async function createNotificationByClient(req, res) {
    try {
        const { uid, title, subTitle, routing } = req.body;

        const q = `
            INSERT INTO notification (uid, title, subTitle, routing) 
            VALUES (?, ?, ?, ?);
        `;

        const [result] = await pool.query(q, [uid, title, subTitle, routing]);
        const notificationId = result.insertId;

        const model = {
            notificationId: notificationId,
            title: title, 
            subTitle: subTitle, 
            uid: uid, 
            routing: routing
        };

        await sendNotification(model);

        res.send();
    } catch (error) {
        console.error('알림 만들기 쿼리 실패', error);
        res.status(500).send();
    }
}

export async function createNotification(uid, title, subTitle, routing) {
    try {
        const q = `
            INSERT INTO notification (uid, title, subTitle, routing) 
            VALUES (?, ?, ?, ?);
        `;

        const [result] = await pool.query(q, [uid, title, subTitle, routing]);
        const notificationId = result.insertId;

        const model = {
            notificationId: notificationId,
            title: title, 
            subTitle: subTitle, 
            uid: uid, 
            routing: routing
        };

        await sendNotification(model);
        
        return notificationId; // 생성된 알림 ID 반환
    } catch (error) {
        console.error('알림 만들기 쿼리 실패', error);
        throw error;
    }
}

// FCM 메시지 전송 함수 (개선)
async function sendNotification(model) {
    try {
        if (model.uid == null) {
            console.error("UID가 없습니다.");
            return;
        }

        if (model.notificationId == null) {
            console.error("알림 ID가 없습니다.");
            return;
        }

        // FCM 토큰 조회
        const q = `
            SELECT fcmToken FROM user
            WHERE uid = ?;
        `;

        const [rows] = await pool.query(q, [model.uid]);

        if (!rows.length || !rows[0].fcmToken) {
            console.error("유효한 FCM 토큰이 없습니다.");
            return;
        }

        const token = rows[0].fcmToken;
        const collapseKey = "default_collapse_key";

        // 공통 데이터 객체 (notificationId 포함)
        const commonData = {
            title: model.title || '',
            body: model.subTitle || '',
            routing: model.routing || '',
            notificationId: model.notificationId.toString(), // 중요: 알림 ID 추가
            collapseKey: collapseKey,
        };

        let msg;

        // 사용자 연결 상태 확인
        const connectUserMap = getUserSocketMap();

        if (connectUserMap.has(model.uid)) {
            // 사용자가 온라인인 경우 - 데이터 온리 메시지
            msg = {
                data: commonData,
                token: token,
            };
        } else {
            // 사용자가 오프라인인 경우 - 알림 포함 메시지
            msg = {
                notification: {
                    title: model.title || '',
                    body: model.subTitle || '',
                },
                data: commonData, // 데이터에 notificationId 포함
                android: {
                    priority: "high",
                    notification: {
                        title: model.title || '',
                        body: model.subTitle || '',
                        channelId: "epin.nadal.chat.channel",
                        sound: "default",
                        tag: collapseKey,
                        clickAction: "FLUTTER_NOTIFICATION_CLICK", // 클릭 액션 추가
                    },
                    data: {
                        ...commonData, // Android 전용 데이터에도 포함
                    }
                },
                apns: {
                    payload: {
                        aps: {
                            sound: "default",
                            category: "NOTIFICATION_CATEGORY", // iOS 카테고리
                        },
                        // iOS 커스텀 데이터
                        notificationId: model.notificationId.toString(),
                        routing: model.routing || '',
                    },
                },
                token: token,
            };
        }

        // FCM 메시지 전송
        const response = await admin.messaging().send(msg);
        console.log("FCM 메시지 전송 성공:", {
            notificationId: model.notificationId,
            uid: model.uid,
            messageId: response
        });
        
        return response;
    } catch (error) {
        console.error("FCM 메시지 전송 실패:", {
            notificationId: model.notificationId,
            uid: model.uid,
            error: error.message
        });

        if (error.code === "messaging/invalid-registration-token") {
            console.error("잘못된 FCM 토큰 - 토큰 삭제 고려:", error.message);
            // 토큰 삭제 로직 추가 가능
            await handleInvalidToken(model.uid);
        } else if (error.code === "messaging/registration-token-not-registered") {
            console.error("등록되지 않은 FCM 토큰 - 토큰 삭제 고려:", error.message);
            // 토큰 삭제 로직 추가 가능
            await handleInvalidToken(model.uid);
        }
        
        throw error;
    }
}

// 잘못된 토큰 처리 함수
async function handleInvalidToken(uid) {
    try {
        const q = `
            UPDATE user 
            SET fcmToken = NULL 
            WHERE uid = ?;
        `;
        await pool.query(q, [uid]);
        console.log(`잘못된 FCM 토큰 삭제 완료: uid=${uid}`);
    } catch (error) {
        console.error("FCM 토큰 삭제 실패:", error);
    }
}

export async function readNotification(req, res) {
    try {
        const { uid } = req.user;
        const { notificationId } = req.body;

        // 알림 소유자 검증 및 읽음 처리
        const q = `
            UPDATE notification
            SET readState = 1
            WHERE notificationId = ? AND uid = ? AND readState = 0;
        `;

        const [result] = await pool.query(q, [notificationId, uid]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "알림을 찾을 수 없거나 이미 읽음 처리된 알림입니다."
            });
        }

        console.log(`알림 읽음 처리 완료: notificationId=${notificationId}, uid=${uid}`);
        res.send();
    } catch (error) {
        console.error("알림 읽음 처리 실패:", error);
        res.status(500).send();
    }
}

export async function removeNotification(req, res) {
    try {
        const {notificationId} = req.params;

        const q = `
            DELETE FROM notification
            WHERE notificationId = ?;
        `;

        await pool.query(q, [notificationId]);
        res.send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}

