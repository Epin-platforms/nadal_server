import pool from '../../config/database.js';

export async function getMyLocalQuickChat(req, res) {
    try {
      const offset = Number(req.query.offset) || 0;
      const { uid } = req.user;
  
      // 1) 사용자 지역 가져오기
      const [[{ local }]] = await pool.query(
        `SELECT local FROM user WHERE uid = ?;`,
        [uid]
      );
  
      // 2) 내가 **참여하지 않은** 오픈된 동일 지역 방만 조회
      const query = `
        SELECT 
          r.*,
          (
            SELECT COUNT(*) 
            FROM roomMember rm2 
            WHERE rm2.roomId = r.roomId
          ) AS memberCount
        FROM room r
        WHERE
          r.local    = ?
          AND r.isOpen = TRUE
          -- 내가 참여하지 않은 방만
          AND NOT EXISTS (
            SELECT 1
            FROM roomMember rm
            WHERE rm.roomId = r.roomId
              AND rm.uid    = ?
          )
        LIMIT 10
        OFFSET ?;
      `;
  
      const [rows] = await pool.query(query, [local, uid, offset]);
      res.json(rows);
  
    } catch (error) {
      console.error('getMyLocalQuickChat 오류:', error);
      res.status(500).send();
    }
  }


  export async function getHotQuickRooms(req, res) {
    try {
      const { uid } = req.user;
  
      const query = `
        WITH base AS (
          SELECT 
            r.*,
            (
              SELECT COUNT(*) 
              FROM roomMember rm2 
              WHERE rm2.roomId = r.roomId
            ) AS memberCount
          FROM room r
          WHERE
            r.isOpen = TRUE
            AND NOT EXISTS (
              SELECT 1
              FROM roomMember rm
              WHERE rm.roomId = r.roomId
                AND rm.uid    = ?
            )
        ),
        ranked AS (
          SELECT 
            *,
            NTILE(5) OVER (ORDER BY memberCount DESC) AS tile
          FROM base
        )
        SELECT *
        FROM ranked
        WHERE tile = 1
        ORDER BY RAND()
        LIMIT 4;
      `;
  
      const [rows] = await pool.query(query, [uid]);
      res.json(rows);
    } catch (error) {
      console.error('핫한방오류 오류:', error);
      res.status(500).send();
    }
  }
  

