import pool from '../../../config/database.js';
import { getSocket } from '../../../socket/websocket.js';

const maxInterval = `INTERVAL 10 DAY`;

//로그리스트 불러오기
export async function getRoomLogs(req, res){
    try{
        const roomId = Number(req.query.roomId);
        const {uid} = req.user;

        const q = `
            SELECT rl.*, 
            CASE
                WHEN r.useNickname = 0 THEN u.name
                ELSE u.nickName 
            END AS displayName

            FROM roomLog rl 
            LEFT JOIN user u ON rl.uid = u.uid
            LEFT JOIN room r ON rl.roomId = r.roomId
            WHERE rl.roomId = ? 
            AND rl.createAt >= (
                SELECT GREATEST(
                    (SELECT COALESCE(regDate, NOW()) FROM roomMember WHERE roomId = ? AND uid = ?), 
                    DATE_SUB(NOW(), ${maxInterval})
                )
            )
            ORDER BY rl.logId ASC;
        `;

            const [rows] = await pool.query(q, [roomId, roomId, uid]);
           res.json(rows);
    }catch(error){
        console.error('로그 쿼리 오류:', error);
        res.status(500).send();
    }
}

//로그 만들기
export async function createLog(roomId, uid, action) {
    try {
      const q = `
        INSERT INTO roomLog (roomId, uid, action)
        VALUES (?, ?, ?);
      `;
  
      const [result] = await pool.query(q, [roomId, uid, action]);
  
      const logId = result.insertId; // ← 올바른 반환 값

      const log = await getLogWithLogId(roomId, logId);
    
      //브로드 캐스트
      const io = getSocket();
      io.to(`roomId:${roomId}`).emit('roomLog', log);

      return log;
    } catch (error) {
      console.error('로그 쿼리 오류:', error);
      return null;
    }
}


async function getLogWithLogId(roomId, logId) {
    try{
        const q = `
            SELECT rl.*,
                CASE 
                    WHEN r.useNickname = 0 THEN u.name
                    ELSE u.nickName
                END AS displayName
            FROM roomLog rl
            LEFT JOIN user u ON rl.uid = u.uid
            LEFT JOIN room r ON rl.roomId = r.roomId
        WHERE rl.logId = ? AND rl.roomId = ?;
        `;

        const [log] = await pool.query(q, [logId, roomId]);

        return log;
    }catch(error){
        console.error('단일 로그 쿼리 오류:', error);
        return null;
    }
}
  
