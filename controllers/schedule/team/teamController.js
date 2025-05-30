import pool from '../../../config/database.js';


export async function memberWithRoomId(req, res) {
    try{
        if(req.query.roomId == null || req.query.scheduleId == null){
            console.log('불러올 데이터 파라미터가 없습니다');
            return res.status(400).send();
        }
        
        const offset = Number(req.query.offset);
        const {uid} = req.user;
        const roomId = Number(req.query.roomId); // 방 아이디가 널일 경우 에러처리
        const scheduleId = Number(req.query.scheduleId);

        //방이 실제하는지 체크
        const [checkRoom] = await pool.query(`SELECT * FROM room WHERE roomId = ?`, [roomId]);

        if(checkRoom.length == 0){
            console.log('이미 삭제된 방입니다');
            return res.status(404).send();
        }

        //방사용자 불러오기 현재 스케줄을 참가중인가
        const q = `
            SELECT 
            rm.uid,
            r.useNickname,
            u.profileImage,

            CASE 
                WHEN r.useNickname = 0 THEN u.name
                ELSE u.nickName
            END AS displayName,

            CASE 
                WHEN r.useNickname = 0 THEN u.gender
                ELSE NULL
            END AS gender,

            CASE 
                WHEN r.useNickname = 0 THEN u.birthYear
                ELSE NULL
            END AS birthYear,

            CASE 
                WHEN sm.uid IS NOT NULL THEN true
                ELSE false
            END AS isParticipation

            FROM roomMember rm
            LEFT JOIN user u ON rm.uid = u.uid
            LEFT JOIN room r ON rm.roomId = r.roomId
            LEFT JOIN scheduleMember sm 
            ON sm.uid = rm.uid AND sm.scheduleId = ? -- 💡 LEFT JOIN 조건에 넣어야 null 체크가 의미 있음

            WHERE rm.roomId = ? AND rm.uid != ?
            LIMIT 10 OFFSET ?;
        `

        const [rows] = await pool.query(q, [scheduleId, roomId, uid, offset]);

        res.json(rows);
    }catch(error){
       console.error('팀 멤버 불러오기 에러', error); 
       res.status(500).send();
    }
}


export async function memberWithQuery(req, res) {
    try{
        const offset = Number(req.query.offset);
        const {uid} = req.user;
        const roomId = Number(req.query.roomId); // 방 아이디가 널일 경우 에러처리
        const scheduleId = Number(req.query.scheduleId);
        const query = req.query.query;
    
                const q = `
                SELECT 
                rm.uid,
                r.useNickname,
                u.profileImage,

                CASE 
                    WHEN r.useNickname = 0 THEN u.name
                    ELSE u.nickName
                END AS displayName,

                CASE 
                    WHEN r.useNickname = 0 THEN u.gender
                    ELSE NULL
                END AS gender,

                CASE 
                    WHEN r.useNickname = 0 THEN u.birthYear
                    ELSE NULL
                END AS birthYear,

                CASE 
                    WHEN sm.uid IS NOT NULL THEN true
                    ELSE false
                END AS isParticipation

                FROM roomMember rm
                LEFT JOIN user u ON rm.uid = u.uid
                LEFT JOIN room r ON rm.roomId = r.roomId
                LEFT JOIN scheduleMember sm 
                ON sm.uid = rm.uid AND sm.scheduleId = ? -- 💡 LEFT JOIN 조건에 넣어야 null 체크가 의미 있음

                WHERE rm.roomId = ? AND rm.uid != ?   AND (
                        (r.useNickname = 0 AND u.name LIKE CONCAT('%', ?, '%'))
                        OR
                        (r.useNickname = 1 AND u.nickName LIKE CONCAT('%', ?, '%'))
                    )
                LIMIT 10 OFFSET ?;
            `

            const [rows] = await pool.query(q, [scheduleId, roomId, uid, query, query, offset]);

            res.json(rows);

    }catch(error){
        console.error('팀 멤버 불러오기 에러', error); 
        res.status(500).send();
    }
}