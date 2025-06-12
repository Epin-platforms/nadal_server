import { bucket } from "../../config/firebase.js";
import { getSocket, getSocketIdByUid } from "../../socket/websocket.js";
import { admin } from "../../config/firebase.js"; // ✅ admin 모듈 import 추가
import pool from "../../config/database.js";

// 예: express 라우터에서
// router.post('/chat', upload.array('images'), saveChat);

export async function saveChat(req, res) {
  try {
      const { uid } = req.user;
      const chat = req.body;
      chat.uid = uid;

      const imageUrls = [];

      if (Array.isArray(req.files) && req.files.length > 0) {
          for (const file of req.files) {
              let processedBuffer = file.buffer;
              let contentType = file.mimetype;

              // HEIC/HEIF 또는 iOS 이미지 처리
              if (file.mimetype.includes('heic') || file.mimetype.includes('heif') || 
                  file.originalname.toLowerCase().includes('img_')) {
                  
                  // Sharp로 색상 프로파일 정규화
                  const sharp = require('sharp');
                  try {
                      processedBuffer = await sharp(file.buffer)
                          .jpeg({ 
                              quality: 90,
                              chromaSubsampling: '4:4:4'
                          })
                          // sRGB 색상 프로파일로 강제 변환
                          .toColorspace('srgb')
                          .withMetadata({
                              icc: 'srgb'
                          })
                          .toBuffer();
                      contentType = 'image/jpeg';
                  } catch (sharpError) {
                      console.warn('Sharp 처리 실패:', sharpError);
                  }
              }

              const fileName = `chat/${chat.roomId}_${uid}_${Date.now()}_${file.originalname}`;
              const gcsFile = bucket.file(fileName);

              await gcsFile.save(processedBuffer, {
                  metadata: { 
                      contentType: contentType,
                      cacheControl: 'public, max-age=31536000',
                      // 색상 프로파일 강제 설정
                      'color-profile': 'sRGB',
                      // iOS 호환성 헤더
                      'x-goog-content-length-range': '0,10485760',
                  },
                  public: true,
                  validation: 'md5',
              });

              const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
              imageUrls.push(publicUrl);
          }
          chat.images = JSON.stringify(imageUrls);
      }

      const newChat = await updateChat(chat);
      await sendNotificationToRoomMembers(chat.roomId, chat.uid, newChat);

      const io = getSocket();
      io.to(`roomId:${newChat.roomId}`).emit('chat', newChat);

      res.status(201).json({ success: true });
  } catch (error) {
      console.error('saveChat 오류:', error);
      res.status(500).json({ error: '채팅 저장에 실패했습니다.' });
  }
}

// 보낸 채팅
async function updateChat(data) {
    const { roomId, uid, reply, type, images, scheduleId, contents } = data;

    const q = `
        INSERT INTO chat (roomId, uid, reply, type, contents, scheduleId, images)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const v = [roomId, uid, reply, type, contents, scheduleId, images];

    try {
        const [insertResult] = await pool.query(q, v);
        const chatId = insertResult.insertId;

        const result = await getChat(chatId, roomId);
        return result;
    } catch (error) {
        console.error('updateChat 오류:', error);
        throw error;
    }
}

async function sendNotificationToRoomMembers(roomId, senderUid, chat) {
  try {
      // 방 참가자의 FCM 토큰 가져오기
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
          FROM 
              roomMember rm
          LEFT JOIN 
              room r ON rm.roomId = r.roomId
          INNER JOIN 
              user u ON rm.uid = u.uid
          WHERE 
              rm.roomId = ? 
              AND u.uid != ? 
              AND u.fcmToken IS NOT NULL
              AND rm.alarm = 1
      `;

      const [rows] = await pool.query(q, [roomId, senderUid]);
      
      if (rows.length === 0) {
          console.log("알림을 보낼 대상이 없습니다.");
          return;
      }

      console.log(`알림 대상 사용자: ${rows.length}명`);

      const connectedUsers = [];
      const disconnectedUsers = [];

      // 연결 상태 확인
      rows.forEach((user) => {
          if (getSocketIdByUid(user.uid)) {
              connectedUsers.push(user);
          } else {
              disconnectedUsers.push(user);
          }
      });

      // 메시지 내용 결정
      const getMessageBody = (chat) => {
          if (chat.type === 1) return '(사진)';
          if (chat.type === 2) return '(일정)';
          return chat.contents || '';
      };

      // 접속 중이지 않은 사용자에게 FCM 푸시 알림 전송
      const disconnectedPromises = disconnectedUsers.map(async (user) => {
          if (!user.fcmToken) {
              console.warn(`FCM 토큰이 없는 사용자: ${user.uid}`);
              return;
          }

          const message = {
              token: user.fcmToken,
              notification: {
                  title: `${user.roomName}에서의 메시지`,
                  body: getMessageBody(chat),
              },
              data: {
                  roomId: roomId.toString(),
                  routing: `/room/${roomId}`,        // ✅ 추가!
                  badge: user.unread_count ? user.unread_count.toString() : "0",
                  alarm: user.alarm ? user.alarm.toString() : "1", 
                  type: 'chat',
              },
              android: {
                  priority: "high",
                  notification: {
                      title: `${user.roomName}에서의 메시지`,
                      body: getMessageBody(chat),
                      channelId: "epin.nadal.chat.channel",
                      sound: "default",
                      tag: roomId.toString()
                  },
              },
              apns: {
                  payload: {
                      aps: {
                          sound: "default",
                          badge: user.unread_count || 0,
                      },
                  },
              },
          };

          try {
              await admin.messaging().send(message);
          } catch (error) {
              // 토큰이 무효한 경우 처리
              if (error.code === 'messaging/registration-token-not-registered') {
                  console.log(`무효한 토큰 삭제: ${user.uid}`);
                  await pool.query('UPDATE user SET fcmToken = NULL WHERE uid = ?', [user.uid]);
              }
          }
      });

      // 연결된 사용자에게 데이터 온리 메시지 전송
      const connectedPromises = connectedUsers.map(async (user) => {
          if (!user.fcmToken) {
              return;
          }

          const message = {
              token: user.fcmToken,
              data: {
                  title: `${user.roomName}에서의 메시지`,
                  body: getMessageBody(chat),
                  roomId: roomId.toString(),         // ✅ 추가!
                  routing: `/room/${roomId}`,
                  badge: user.unread_count ? user.unread_count.toString() : "0",
                  alarm: user.alarm ? user.alarm.toString() : "1",
                  type: 'chat',
              }
          };

          try {
              await admin.messaging().send(message);
          } catch (error) {
              console.error(`데이터 메시지 실패 (연결됨): ${user.uid}, 이유: ${error.message}`);
          }
      });

      // 모든 알림 전송 완료 대기
      await Promise.allSettled([...disconnectedPromises, ...connectedPromises]);

  } catch (error) {
      console.error("푸시 알림 전송 중 오류 발생:", error);
      throw error;
  }
}

// 특정 채팅 포맷형식으로 가져오기
async function getChat(chatId, roomId) {
    const q = `
        SELECT 
            c.*, 
            s.title, s.startDate, s.endDate, s.sports, s.tag, 
            
            -- ✅ 작성자 정보: useNickName 조건에 따라 분기
            CASE 
                WHEN r.useNickname = 0 THEN u.name
                ELSE u.nickName
            END AS name,

            u.profileImage,

            CASE 
                WHEN r.useNickname = 0 THEN u.gender
                ELSE NULL
            END AS gender,

            CASE 
                WHEN r.useNickname = 0 THEN u.birthYear
                ELSE NULL
            END AS birthYear,

            -- ✅ reply 처리
            CASE 
                WHEN c2.type = 1 THEN SUBSTRING_INDEX(c2.images, ',', 1)
                WHEN c2.type = 2 THEN s2.title
                ELSE c2.contents
            END AS replyContents,

            CASE 
                WHEN r.useNickname = 0 THEN u2.name
                ELSE u2.nickName
            END AS replyName,

            c2.type AS replyType

        FROM chat c

        LEFT JOIN schedule s ON c.scheduleId = s.scheduleId
        LEFT JOIN user u ON c.uid = u.uid
        LEFT JOIN chat c2 ON c.reply = c2.chatId AND c.roomId = c2.roomId
        LEFT JOIN schedule s2 ON c2.scheduleId = s2.scheduleId
        LEFT JOIN user u2 ON c2.uid = u2.uid
        LEFT JOIN room r ON c.roomId = r.roomId

        WHERE c.roomId = ? AND c.chatId = ?
    `;

    try {
        const [rows] = await pool.query(q, [roomId, chatId]);
        return rows[0];
    } catch (error) {
        console.error('getChat 오류:', error);
        throw error;
    }
}

export async function quickScheduleChat(scheduleChat) {
    try {
        // 2) DB에 chat 삽입
        const newChat = await updateChat(scheduleChat);
        
        // 3. 알림을 보낼 사용자 목록 가져오기 (✅ newChat 객체 전달)
        await sendNotificationToRoomMembers(newChat.roomId, newChat.uid, newChat);
        
        // 4) Socket.IO 브로드캐스트
        const io = getSocket();
        io.to(`roomId:${newChat.roomId}`).emit('chat', newChat);

        return true;
    } catch (error) {
        console.error('quickScheduleChat 오류:', error);
        return false;
    }
}