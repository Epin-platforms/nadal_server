import pool from '../../config/database.js';
import { checkDuplicationRoomName } from './createController.js';
import { bucket } from '../../config/firebase.js';
import { createLog } from './log/logController.js';

//방 정보 초기화
export async function getMyRooms(req, res) {
    try{
        const {uid} = req.user;

        const q = `
            SELECT r.*, (
                SELECT COUNT(*) 
                FROM roomMember rm2 
                WHERE rm2.roomId = r.roomId
            ) AS memberCount
            FROM room r
            LEFT JOIN roomMember rm ON rm.roomId = r.roomId
            WHERE rm.uid = ?;
        `;

        const [rows] = await pool.query(q, [uid]);

        res.json(rows);
    }catch(error){
        console.log(error);
        res.status(500).send();
    }
}

//방정보 다시 불러오기 혹은 방정보 불러오기
export async function getRoomByRoomId(req, res) {
    try{
        const roomId = Number(req.params.roomId);
        const updateAt = req.query.updateAt;

        const q = `  SELECT r.*, (
                SELECT COUNT(*) 
                FROM roomMember rm2 
                WHERE rm2.roomId = r.roomId
            ) AS memberCount
            FROM room r
            WHERE r.roomId = ?
            AND (? IS NULL OR r.updateAt != ?)`;
          
        const [rows] = await pool.query(q, [roomId, updateAt, updateAt]);

        if(rows.length == 0){ ///업데이트 할필요없음
            return res.status(201).send();
        }

        res.json(rows[0]);
    }catch(error){
        console.log(error);
        res.status(500).send();
    }
}

//방 정보 수정
export async function updateDBRoom(req, res) {
    const conn = await pool.getConnection();
    try {
      const room = req.body;
  
      await conn.beginTransaction(); // 트랜잭션 시작
  
      if (room.roomName) { // 룸 네임 필드가 존재한다면
        // 방명 중복 체크 (오픈채팅방은 제외)
        const duple = await checkDuplicationRoomName(room.roomName, room.local, conn);
        if (duple) {
          await conn.rollback();
          return res.status(202).send();
        }
      }
  
      // ✅ 이미지 처리
      if (req.file) {
        const fileName = `roomImage/${room.roomId}`;
        const file = bucket.file(fileName);
  
        await file.save(req.file.buffer, {
          metadata: { contentType: req.file.mimetype },
          public: true,
          validation: 'md5',
        });
  
        const imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        room.roomImage = imageUrl;
      }
  
      // ✅ 필드 업데이트
      const allowedFields = ['roomName', 'local', 'city', 'description', 'tag', 'roomImage', 'enterCode', 'useNickname'];
      const filtered = {};
  
      for (const key of Object.keys(room)) {  // room 사용
        if (allowedFields.includes(key)) {
          filtered[key] = room[key];
        }
      }
  
      if (Object.keys(filtered).length === 0) {
        await conn.rollback();
        return res.status(400).json({ message: '업데이트할 항목이 없습니다.' });
      }
  
      const setClause = Object.keys(filtered).map(k => `${k} = ?`).join(', ');
      const values = Object.values(filtered);
  
      const sql = `UPDATE room SET ${setClause} WHERE roomId = ?`;
      await conn.query(sql, [...values, room.roomId]);  // conn.query
  
      await conn.commit();  // ✅ 성공하면 commit
      res.send();
    } catch (error) {
      console.error('방 수정 실패', error);
      await conn.rollback();  // ✅ 실패하면 rollback
      res.status(500).send();
    } finally {
      conn.release();  // ✅ 항상 커넥션 반납
    }
 }
  


//마지막 공지 가져오기
export async function getLastAnnounceWithRoomId(req, res) {
    try{
        const roomId = Number(req.query.roomId);

        const q = `
                SELECT 
                s.scheduleId,
                s.title,
                s.description,
                s.createAt,
                
                CASE 
                    WHEN r.useNickname = 0 THEN u.name 
                    ELSE u.nickName 
                END AS displayName,

                CASE 
                    WHEN r.useNickname = 0 THEN u.birthYear 
                    ELSE NULL 
                END AS birthYear,

                CASE 
                    WHEN r.useNickname = 0 THEN u.gender 
                    ELSE NULL 
                END AS gender

            FROM schedule s
            LEFT JOIN user u ON u.uid = s.uid
            LEFT JOIN room r ON r.roomId = s.roomId

            WHERE r.roomId = ? AND s.tag = '공지'
            ORDER BY s.createAt DESC
            LIMIT 1;
        `;

        
        const [rows] = await pool.query(q, [roomId]);

        if(rows.length == 0){
            return res.status(202).send();
        }
        
        res.json(rows[0]);
    }catch(error){
        console.error('마지막 공지 에러', error);
        res.status(500).send();
    }
}


//방 제거
export async function deleteRoom(req, res) {
    const conn = await pool.getConnection();
    try{
        const roomId = Number(req.params.roomId);
        const {uid} = req.user;

        await conn.beginTransaction();

        //나 이외에 사용자가있는지 체크
        const [checkUsers] = await conn.query(`SELECT * FROM roomMember WHERE roomId = ? AND uid != ?;`, [roomId, uid]);

        if(checkUsers.length > 0){
            await conn.commit();
            return res.status(400).send();
        }

        await conn.query(`DELETE FROM room WHERE roomId = ?;`, [roomId]);

        await conn.commit();

        res.send();
    }catch(error){
        await conn.rollback();
        console.error('방 제거 에러', error);
        res.status(500).send();
    }finally{
        conn.release();
    }
}