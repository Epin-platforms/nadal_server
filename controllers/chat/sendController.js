// controllers/chat/sendController.js
import { bucket } from "../../config/firebase.js";
import { getSocket } from "../../socket/websocket.js";
import pool from "../../config/database.js";
import { sendNotificationToRoomMembers } from "../notification/notificationService.js";

export async function saveChat(req, res) {
    try {
        const { uid } = req.user;
        const chat = req.body;
        chat.uid = uid;

        const imageUrls = [];

        // 이미지 처리 (기존 로직 유지)
        if (Array.isArray(req.files) && req.files.length > 0) {
            for (const file of req.files) {
                let processedBuffer = file.buffer;
                let contentType = file.mimetype;

                if (file.mimetype.includes('heic') || file.mimetype.includes('heif') || 
                    file.originalname.toLowerCase().includes('img_')) {
                    
                    const sharp = require('sharp');
                    try {
                        processedBuffer = await sharp(file.buffer)
                            .jpeg({ 
                                quality: 90,
                                chromaSubsampling: '4:4:4'
                            })
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
                        'color-profile': 'sRGB',
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

        // 🔥 단일 처리로 통합 (중복 제거)
        const newChat = await updateChat(chat);
        
        // 🔔 FCM 알림 전송 (비동기로 처리하여 응답 속도 향상)
        // 🔧 올바른 객체 생성 문법 사용
        const chatForm = { 
            chatId: newChat.chatId, 
            contents: newChat.contents, 
            type: newChat.type 
        };

        // 🔧 비동기 처리로 응답 속도 향상
        setImmediate(() => {
            sendNotificationToRoomMembers(newChat.roomId, uid, chatForm)
                .catch(error => console.error('❌ 알림 전송 오류:', error));
        });
        
        // 📡 Socket.IO 브로드캐스트 (실시간 전송)
        const io = getSocket();
        io.to(`roomId:${newChat.roomId}`).emit('chat', newChat);

        res.status(201).json({ success: true });
    } catch (error) {
        console.error('saveChat 오류:', error);
        res.status(500).json({ error: '채팅 저장에 실패했습니다.' });
    }
}

// 보낸 채팅 저장 (소켓 emit 제거)
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

// 특정 채팅 포맷형식으로 가져오기
async function getChat(chatId, roomId) {
    const q = `
        SELECT 
            c.*, 
            s.title, s.startDate, s.endDate, s.sports, s.tag, 
            
            -- 작성자 정보: useNickName 조건에 따라 분기
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

            -- reply 처리
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

// 🔥 수정된 빠른 스케줄 채팅 (중복 제거)
export async function quickScheduleChat(scheduleChat) {
    try {
        // DB에 chat 삽입
        const newChat = await updateChat(scheduleChat);
        
        // 알림을 보낼 사용자 목록 가져오기 (비동기 처리)
        setImmediate(() => {
            sendNotificationToRoomMembers(newChat.roomId, newChat.uid, newChat)
                .catch(error => console.error('빠른 스케줄 채팅 알림 오류:', error));
        });
        
        // Socket.IO 브로드캐스트
        const io = getSocket();
        io.to(`roomId:${newChat.roomId}`).emit('chat', newChat);

        return true;
    } catch (error) {
        console.error('quickScheduleChat 오류:', error);
        return false;
    }
}