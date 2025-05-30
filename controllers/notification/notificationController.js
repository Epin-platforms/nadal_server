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
       const offset = Number(req.query.offset);
       const limit = 20;

        const q = `
                SELECT *
                FROM notification
                WHERE uid = ?
                AND createAt >= DATE_SUB(NOW(), INTERVAL 1 MONTH)
                ORDER BY createAt DESC
                LIMIT ?
                OFFSET ?;
       `;

       const [rows] = await pool.query(q, [uid, limit, offset]);
       res.json(rows);

    } catch (error) {
        console.error('알림리스트 쿼리 실패', error);
        res.status(500).send();
    }
}

export async function createNotificationByClient(req, res) {
    try{
        const {uid, title, subTitle, routing} = req.body;

        const q = `
            INSERT INTO notification (uid, title, subTitle, routing) 
            VALUES (?, ?, ?, ?);
        `;

        await pool.query(q,  [uid, title, subTitle, routing]);

        const model = {title: title, subTitle: subTitle, uid: uid, routing: routing};

        await sendNotification(model);

        res.send();
    }catch(error){
        console.error('알림 만들기 쿼리 실패', error);
        res.status(500).send();
    }
}


export async function createNotification(uid, title, subTitle, routing) {
    try{
        const q = `
            INSERT INTO notification (uid, title, subTitle, routing) 
            VALUES (?, ?, ?, ?);
        `;

        await pool.query(q,  [uid, title, subTitle, routing]);

        const model = {title: title, subTitle: subTitle, uid: uid, routing: routing};

        await sendNotification(model);
    }catch(error){
        console.error('알림 만들기 쿼리 실패', error);
    }
}



// FCM 메시지 전송 함수
async function sendNotification(model) {
    try {

        if(model.uid == null){
            return
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

        // Android 및 iOS 알림 그룹화 키
        const collapseKey =  "default_collapse_key";

        let msg;

        // 데이터 온리 FCM 메시지 생성
        const connectUserMap = getUserSocketMap();

        if(connectUserMap.has(model.uid)){
            msg = {
                data: {
                    title: model.title || '',
                    body: model.subTitle || '',
                    routing: model.routing || '',
                    collapseKey: collapseKey, // 데이터를 통해 그룹화 키 전달
                },
                token: token,
            };
        }else{
            msg = {
                notification:{
                    title: model.title || '',
                    body: model.subTitle || '',
                },
                data: {
                    routing: model.routing || '',
                    collapseKey: collapseKey, // 데이터를 통해 그룹화 키 전달
                },
                android: {
                    priority: "high", // 높은 우선 순위
                    notification: {
                      title: model.title || '',
                      body: model.subTitle || '',
                      channelId: "epin.nadal.chat.channel", // 알림 채널 ID
                      sound: "default", // 알림 소리,
                      tag: collapseKey
                    },
                  },
                  apns: {
                    payload: {
                      aps: {
                        sound: "default",
                      },
                    },
                  },
                token: token,
            };
        }

    
        // FCM 메시지 전송
        await admin.messaging().send(msg);
        console.log("데이터 온리 메시지 전송 성공:", msg);
    } catch (error) {
        if (error.code === "messaging/invalid-registration-token") {
            console.error("잘못된 FCM 토큰:", error.message);
        } else if (error.code === "messaging/registration-token-not-registered") {
            console.error("등록되지 않은 FCM 토큰:", error.message);
        } else {
            console.error("데이터 온리 메시지 전송 실패:", error);
        }
    }
}


export async function readNotification(req, res) {
    try {
        const {uid} = req.user;
        const {notificationId} = req.body;
        const q = `
            UPDATE notification
            SET readState = 1
            WHERE notificationId = ? AND uid = ?;
        `;

        await pool.query(q, [notificationId, uid]);
        res.send();
    } catch (error) {
        console.error(error);
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

