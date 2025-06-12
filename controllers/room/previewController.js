import pool from '../../config/database.js';
import { createLog } from './log/logController.js';


//방하나 불러오기
export async function getPreviewRoom(req, res){
    try {
        const roomId = Number(req.params.roomId);
        const {uid} = req.user;
        const q = `
            SELECT 
            r.roomId,
            r.roomName,
            r.roomImage,
            r.tag,
            r.isOpen,
            r.description,
            r.local,
            r.city,
            r.createAt,
            r.useNickname,
            COUNT(rm2.roomId) AS memberCount,

            -- 개설자 정보: grade = 0 인 사용자
            u.nickName AS creatorNickName,
            u.profileImage AS creatorProfile,

            -- ✅ 현재 사용자 참여 여부
            CASE 
                WHEN rm_me.uid IS NOT NULL THEN TRUE
                ELSE FALSE
            END AS isJoined

        FROM 
            room r

        -- 전체 멤버 수 계산용
        LEFT JOIN roomMember rm2 ON r.roomId = rm2.roomId

        -- 개설자 정보
        LEFT JOIN roomMember rm_creator ON r.roomId = rm_creator.roomId AND rm_creator.grade = 0
        LEFT JOIN user u ON rm_creator.uid = u.uid

        -- ✅ 현재 사용자 참여 여부 확인용
        LEFT JOIN roomMember rm_me ON r.roomId = rm_me.roomId AND rm_me.uid = ?

        WHERE 
            r.roomId = ?

        GROUP BY 
            r.roomId;
        `;

        const [rows] = await pool.query(q, [uid, roomId]);
        
        res.json(rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}


//가입하기 루틴
export async function registerRoom(req, res) {
    try {
      const { uid } = req.user;
      const roomId = Number(req.params.roomId);
      const enterCode = req.body.enterCode;
  
      // 1. 해당 방의 입장 코드 확인
      const codeCheck = `
        SELECT enterCode FROM room WHERE roomId = ?;
      `;
      const [codeRows] = await pool.query(codeCheck, [roomId]);
  
      if (codeRows.length === 0) {
        return res.status(404).send({ message: '방을 찾을 수 없습니다.' });
      }
  
      const roomEnterCode = codeRows[0].enterCode;
  
      // 2. 입장 코드가 필요하지만 입력되지 않은 경우
      if (roomEnterCode && !enterCode) {
        return res.status(204).send(); // 입장 코드 필요
      }
  
      // 3. 입장 코드가 있는데 입력 코드가 틀린 경우
      if (roomEnterCode && enterCode && roomEnterCode !== enterCode) {
        return res.status(202).send({ message: '입장 코드가 일치하지 않습니다.' });
      }
  
      // 4. 이미 등록된 유저인지 확인 (중복 방지)
      const checkDuplicate = `
        SELECT * FROM roomMember WHERE uid = ? AND roomId = ?;
      `;
      const [existing] = await pool.query(checkDuplicate, [uid, roomId]);
  
      if (existing.length > 0) {
        return res.status(201).send({ message: '이미 가입된 유저입니다.' });
      }
  
      // 5. roomMember에 등록
      
      // 마지막 chatId 가져오기
      const lastChatIdQuery = `
        SELECT IFNULL(MAX(chatId), 0) AS lastChatId
        FROM chat
        WHERE roomId = ?;
      `;
      const [[{ lastChatId }]] = await pool.query(lastChatIdQuery, [roomId]);

      const insertQuery = `
        INSERT INTO roomMember (uid, roomId, grade, lastRead)
        VALUES (?, ?, 3, ?);
      `;

      await pool.query(insertQuery, [uid, roomId, lastChatId]);
  
      await createLog(roomId, uid, '님이 방에 입장하셨습니다\n따뜻하게 맞이해주세요!');

      return res.status(201).send({ message: '가입 완료' });
    } catch (error) {
      console.error(error);
      return res.status(500).send({ message: '서버 오류' });
    }
  }
  