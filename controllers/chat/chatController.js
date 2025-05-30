import pool from "../../config/database.js";


//전체채팅 불러오기 (초기 로딩)
export async function getChats(req, res) {
    try {
        const {uid} = req.user;
        const roomId = Number(req.query.roomId);

        // 1. 사용자의 lastRead와 regDate 가져오기
        const memberQuery = `
            SELECT lastRead, regDate 
            FROM roomMember 
            WHERE roomId = ? AND uid = ?
        `;
        const [memberResult] = await pool.query(memberQuery, [roomId, uid]);
        
        if (!memberResult[0]) {
            return res.status(404).json({ error: '방 멤버를 찾을 수 없습니다' });
        }

        const { lastRead, regDate } = memberResult[0];

        // 2. 안읽은 채팅 (lastRead 이후, 최대 50개)
        const unreadQuery = `
            SELECT
                c.*,
                s.title,
                s.startDate,
                s.endDate,
                s.tag,
                u.profileImage,
                r.useNickname,

                -- 작성자 이름
                CASE
                    WHEN r.useNickname = 0 THEN u.name
                    ELSE u.nickName
                END AS name,

                -- 작성자 성별
                CASE
                    WHEN r.useNickname = 0 THEN u.gender
                    ELSE NULL
                END AS gender,

                -- 작성자 출생연도
                CASE
                    WHEN r.useNickname = 0 THEN u.birthYear 
                    ELSE NULL
                END AS birthYear,

                -- 답글 내용 가공
                CASE
                    WHEN c2.type = 1 THEN SUBSTRING_INDEX(IFNULL(c2.images, ''), ',', 1)
                    WHEN c2.type = 2 THEN s2.title
                    ELSE c2.contents
                END AS replyContents,

                -- 답글 작성자 이름
                CASE
                    WHEN r.useNickname = 0 THEN u2.name
                    ELSE u2.nickName
                END AS replyName,

                -- 답글 타입
                c2.type AS replyType

            FROM chat c
            LEFT JOIN schedule s ON c.type = 2 AND c.scheduleId = s.scheduleId
            LEFT JOIN user u ON c.uid = u.uid
            LEFT JOIN room r ON c.roomId = r.roomId
            LEFT JOIN chat c2 ON c.reply = c2.chatId AND c.roomId = c2.roomId
            LEFT JOIN user u2 ON c2.uid = u2.uid
            LEFT JOIN schedule s2 ON c2.type = 2 AND c2.scheduleId = s2.scheduleId

            WHERE c.roomId = ? 
            AND c.createAt > ?
            AND c.chatId > ?
            ORDER BY c.chatId ASC
            LIMIT 50
        `;

        // 3. 읽은 채팅 (lastRead 이전, 최대 10개)
        const readQuery = `
            SELECT
                c.*,
                s.title,
                s.startDate,
                s.endDate,
                s.tag,
                u.profileImage,
                r.useNickname,

                -- 작성자 이름
                CASE
                    WHEN r.useNickname = 0 THEN u.name
                    ELSE u.nickName
                END AS name,

                -- 작성자 성별
                CASE
                    WHEN r.useNickname = 0 THEN u.gender
                    ELSE NULL
                END AS gender,

                -- 작성자 출생연도
                CASE
                    WHEN r.useNickname = 0 THEN u.birthYear 
                    ELSE NULL
                END AS birthYear,

                -- 답글 내용 가공
                CASE
                    WHEN c2.type = 1 THEN SUBSTRING_INDEX(IFNULL(c2.images, ''), ',', 1)
                    WHEN c2.type = 2 THEN s2.title
                    ELSE c2.contents
                END AS replyContents,

                -- 답글 작성자 이름
                CASE
                    WHEN r.useNickname = 0 THEN u2.name
                    ELSE u2.nickName
                END AS replyName,

                -- 답글 타입
                c2.type AS replyType

            FROM chat c
            LEFT JOIN schedule s ON c.type = 2 AND c.scheduleId = s.scheduleId
            LEFT JOIN user u ON c.uid = u.uid
            LEFT JOIN room r ON c.roomId = r.roomId
            LEFT JOIN chat c2 ON c.reply = c2.chatId AND c.roomId = c2.roomId
            LEFT JOIN user u2 ON c2.uid = u2.uid
            LEFT JOIN schedule s2 ON c2.type = 2 AND c2.scheduleId = s2.scheduleId

            WHERE c.roomId = ? 
            AND c.createAt > ?
            AND c.chatId <= ?
            ORDER BY c.chatId DESC
            LIMIT 10
        `;

        const [unreadChats] = await pool.query(unreadQuery, [roomId, regDate, lastRead]);
        const [readChats] = await pool.query(readQuery, [roomId, regDate, lastRead]);

        // 4. 전체 채팅을 합쳐서 정렬 (chatId 기준 내림차순)
        const allChats = [...unreadChats, ...readChats].sort((a, b) => b.chatId - a.chatId);

        res.json({
            chats: allChats,
            lastReadChatId: lastRead
        });

    } catch (error) {
        console.error('채팅 가져오기 오류', error);
        res.status(500).send();
    }
}

// 위로 스크롤 시 - 이미 지나간 채팅 불러오기
export async function getChatsBefore(req, res) {
    try {
        const {uid} = req.user;
        const roomId = Number(req.query.roomId);
        const lastChatId = Number(req.query.lastChatId); // 현재 가장 오래된 채팅 ID

        // 사용자의 regDate 가져오기
        const memberQuery = `
            SELECT regDate 
            FROM roomMember 
            WHERE roomId = ? AND uid = ?
        `;
        const [memberResult] = await pool.query(memberQuery, [roomId, uid]);
        
        if (!memberResult[0]) {
            return res.status(404).json({ error: '방 멤버를 찾을 수 없습니다' });
        }

        const { regDate } = memberResult[0];

        const q = `
            SELECT
                c.*,
                s.title,
                s.startDate,
                s.endDate,
                s.tag,
                u.profileImage,
                r.useNickname,

                -- 작성자 이름
                CASE
                    WHEN r.useNickname = 0 THEN u.name
                    ELSE u.nickName
                END AS name,

                -- 작성자 성별
                CASE
                    WHEN r.useNickname = 0 THEN u.gender
                    ELSE NULL
                END AS gender,

                -- 작성자 출생연도
                CASE
                    WHEN r.useNickname = 0 THEN u.birthYear 
                    ELSE NULL
                END AS birthYear,

                -- 답글 내용 가공
                CASE
                    WHEN c2.type = 1 THEN SUBSTRING_INDEX(IFNULL(c2.images, ''), ',', 1)
                    WHEN c2.type = 2 THEN s2.title
                    ELSE c2.contents
                END AS replyContents,

                -- 답글 작성자 이름
                CASE
                    WHEN r.useNickname = 0 THEN u2.name
                    ELSE u2.nickName
                END AS replyName,

                -- 답글 타입
                c2.type AS replyType

            FROM chat c
            LEFT JOIN schedule s ON c.type = 2 AND c.scheduleId = s.scheduleId
            LEFT JOIN user u ON c.uid = u.uid
            LEFT JOIN room r ON c.roomId = r.roomId
            LEFT JOIN chat c2 ON c.reply = c2.chatId AND c.roomId = c2.roomId
            LEFT JOIN user u2 ON c2.uid = u2.uid
            LEFT JOIN schedule s2 ON c2.type = 2 AND c2.scheduleId = s2.scheduleId

            WHERE c.roomId = ? 
            AND c.createAt > ?
            AND c.chatId < ?
            ORDER BY c.chatId DESC
            LIMIT 20
        `;

        const [rows] = await pool.query(q, [roomId, regDate, lastChatId]);
        res.json(rows);

    } catch (error) {
        console.error('이전 채팅 가져오기 오류', error);
        res.status(500).send();
    }
}

// 아래로 스크롤 시 - 안읽은 채팅 불러오기  
export async function getChatsAfter(req, res) {
    try {
        const {uid} = req.user;
        const roomId = Number(req.query.roomId);
        const lastChatId = Number(req.query.lastChatId); // 현재 가장 최신 채팅 ID

        // 사용자의 regDate 가져오기
        const memberQuery = `
            SELECT regDate 
            FROM roomMember 
            WHERE roomId = ? AND uid = ?
        `;
        const [memberResult] = await pool.query(memberQuery, [roomId, uid]);
        
        if (!memberResult[0]) {
            return res.status(404).json({ error: '방 멤버를 찾을 수 없습니다' });
        }

        const { regDate } = memberResult[0];

        const q = `
            SELECT
                c.*,
                s.title,
                s.startDate,
                s.endDate,
                s.tag,
                u.profileImage,
                r.useNickname,

                -- 작성자 이름
                CASE
                    WHEN r.useNickname = 0 THEN u.name
                    ELSE u.nickName
                END AS name,

                -- 작성자 성별
                CASE
                    WHEN r.useNickname = 0 THEN u.gender
                    ELSE NULL
                END AS gender,

                -- 작성자 출생연도
                CASE
                    WHEN r.useNickname = 0 THEN u.birthYear 
                    ELSE NULL
                END AS birthYear,

                -- 답글 내용 가공
                CASE
                    WHEN c2.type = 1 THEN SUBSTRING_INDEX(IFNULL(c2.images, ''), ',', 1)
                    WHEN c2.type = 2 THEN s2.title
                    ELSE c2.contents
                END AS replyContents,

                -- 답글 작성자 이름
                CASE
                    WHEN r.useNickname = 0 THEN u2.name
                    ELSE u2.nickName
                END AS replyName,

                -- 답글 타입
                c2.type AS replyType

            FROM chat c
            LEFT JOIN schedule s ON c.type = 2 AND c.scheduleId = s.scheduleId
            LEFT JOIN user u ON c.uid = u.uid
            LEFT JOIN room r ON c.roomId = r.roomId
            LEFT JOIN chat c2 ON c.reply = c2.chatId AND c.roomId = c2.roomId
            LEFT JOIN user u2 ON c2.uid = u2.uid
            LEFT JOIN schedule s2 ON c2.type = 2 AND c2.scheduleId = s2.scheduleId

            WHERE c.roomId = ? 
            AND c.createAt > ?
            AND c.chatId > ?
            ORDER BY c.chatId ASC
            LIMIT 20
        `;

        const [rows] = await pool.query(q, [roomId, regDate, lastChatId]);
        res.json(rows);

    } catch (error) {
        console.error('이후 채팅 가져오기 오류', error);
        res.status(500).send();
    }
}

//안읽은 메시지 채팅수 가져오기
export async function getNotReadChatsCount(roomId, uid){
    try {
        const q = `
            SELECT COUNT(*) as notRead
            FROM chat c
            INNER JOIN roomMember rm ON c.roomId = rm.roomId AND rm.uid = ?
            WHERE c.roomId = ?
            AND c.createAt > rm.regDate
            AND c.chatId > rm.lastRead
        `;

        const [rows] = await pool.query(q, [uid, roomId]);
        const notRead = rows[0]?.notRead || 0;
        return notRead;
    } catch (error) {
        console.error('안읽은 메시지 수 가져오기 오류', error);
        return 0;
    }
}

//메시지 삭제
export async function removeChat(req, res) {
    try{
        const { uid } = req.user;
        const roomId = Number(req.query.roomId);
        const chatId = Number(req.params.chatId);
        
        // 삭제 권한 확인 (본인 메시지인지 확인)
        const authQuery = `
            SELECT uid FROM chat 
            WHERE chatId = ? AND roomId = ?
        `;
        const [authResult] = await pool.query(authQuery, [chatId, roomId]);
        
        if (!authResult[0] || authResult[0].uid !== uid) {
            return res.status(403).json({ error: '삭제 권한이 없습니다' });
        }

        const q = `
            UPDATE chat
            SET type = -1
            WHERE chatId = ? AND roomId = ?
        `;

        await pool.query(q, [chatId, roomId]);

        const io = getSocket();
        io.to(`roomId:${roomId}`).emit('removeChat', {chatId: chatId, roomId: roomId});

        res.send();
    }catch(error){
        console.error('채팅 삭제 오류', error);
        res.status(500).send();
    }
}

// 재연결 시 채팅 가져오기
export async function reconnectChat(req, res) {
    try {
        const { uid } = req.user;
        const roomId = Number(req.query.roomId);
        const lastChatId = Number(req.query.lastChatId);
        const validLastChatId = isNaN(lastChatId) ? null : lastChatId;

        // 사용자의 regDate 가져오기
        const memberQuery = `
            SELECT regDate 
            FROM roomMember 
            WHERE roomId = ? AND uid = ?
        `;
        const [memberResult] = await pool.query(memberQuery, [roomId, uid]);
        
        if (!memberResult[0]) {
            return res.status(404).json({ error: '방 멤버를 찾을 수 없습니다' });
        }

        const { regDate } = memberResult[0];

        const q = `
            SELECT
                c.*,
                s.title,
                s.startDate,
                s.endDate,
                s.tag,
                u.profileImage,
                r.useNickname,

                -- 작성자 이름
                CASE
                    WHEN r.useNickname = 0 THEN u.name
                    ELSE u.nickName
                END AS name,

                -- 작성자 성별
                CASE
                    WHEN r.useNickname = 0 THEN u.gender
                    ELSE NULL
                END AS gender,

                -- 작성자 출생연도
                CASE
                    WHEN r.useNickname = 0 THEN u.birthYear
                    ELSE NULL
                END AS birthYear,

                -- 답글 내용 가공
                CASE
                    WHEN c2.type = 1 THEN SUBSTRING_INDEX(IFNULL(c2.images, ''), ',', 1)
                    WHEN c2.type = 2 THEN s2.title
                    ELSE c2.contents
                END AS replyContents,

                -- 답글 작성자 이름
                CASE
                    WHEN r.useNickname = 0 THEN u2.name
                    ELSE u2.nickName
                END AS replyName,

                -- 답글 작성자 성별
                CASE
                    WHEN r.useNickname = 0 THEN u2.gender
                    ELSE NULL
                END AS replyGender,

                -- 답글 작성자 출생연도
                CASE
                    WHEN r.useNickname = 0 THEN u2.birthYear
                    ELSE NULL
                END AS replyBirthYear,

                -- 답글 타입
                c2.type AS replyType

            FROM chat c
            LEFT JOIN schedule s ON c.type = 2 AND c.scheduleId = s.scheduleId
            LEFT JOIN user u ON c.uid = u.uid
            LEFT JOIN room r ON c.roomId = r.roomId
            LEFT JOIN chat c2 ON c.reply = c2.chatId AND c.roomId = c2.roomId
            LEFT JOIN user u2 ON c2.uid = u2.uid
            LEFT JOIN schedule s2 ON c2.type = 2 AND c2.scheduleId = s2.scheduleId

            WHERE c.roomId = ?
            AND c.createAt > ?
            AND c.chatId > ?
            ORDER BY c.chatId ASC
            LIMIT 50
        `;

        const params = [roomId, regDate, validLastChatId || 0];
        const [rows] = await pool.query(q, params);
        
        res.json(rows);
    } catch (error) {
        console.error('채팅 재연결 실패', error);
        res.status(500).send();
    }
}