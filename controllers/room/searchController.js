import pool from '../../config/database.js';


//자동 완성 방 검색
export async function autoTextSearchRooms(req, res){
    try {
        const { text } = req.query;

        if (!text) {
            return res.status(400).send('Query parameter is required');
          }

          const search = `%${text}%`;

          const q = `
            SELECT roomName, tag, description
            FROM room
            WHERE roomName LIKE ? OR tag LIKE ? OR description LIKE ?
            LIMIT 13;
          `;
          
          const [rows] = await pool.query(q, [search, search, search]);
          
          const result = rows.map(row => ({
            roomName: row.roomName,
            tagSnippet: extractContext(text, row.tag, 'tag'),               // ex. ['#축구']
            descriptionSnippet: extractContext(text, row.description, 'description'), // ex. '...무슨태그가 필요...'
          }));


          res.json(result);
    } catch (error) {
        console.error('자동 완성 쿼리오류:', error);
        return res.status(500).send();
    }
}

//요약 텍스트로변경
function extractContext(keyword, text, type = 'default') {
    if (!text || !keyword) return null;
  
    if (type === 'tag') {
      // '#' 단위로 split
      return text
        .split('#')
        .map(t => t.trim())
        .filter(t => t && t.includes(keyword))
        .map(t => `#${t}`);
    }
  
    if (type === 'description') {
      const regex = new RegExp(`(.{0,20}${keyword}.{0,20})`, 'i'); // 전후 20자
      const match = text.match(regex);
      return match ? match[1].trim() : null;
    }
  
    return null;
  }
  

//추천 방 시스템
export async function recommendRooms(req, res) {
    try {
        const {local} = req.query;
        const {uid} = req.user;

        const q = `
            SELECT 
                r.roomName, r.roomImage, r.tag, r.local,
                COUNT(rm.uid) AS memberCount
            FROM 
                room r
            LEFT JOIN roomMember rm ON rm.roomId = r.roomId
            WHERE 
                r.local = ?
                AND r.isOpen = 1
                AND NOT EXISTS (
                SELECT 1 FROM roomMember rm2
                WHERE rm2.roomId = r.roomId AND rm2.uid = ?
                )
                AND NOT EXISTS (
                SELECT 1 FROM blackList b
                WHERE b.roomId = r.roomId AND b.uid = ?
                )
            GROUP BY r.roomId 
            ORDER BY RAND()
            LIMIT 5;
            `;

        const [rows] = await pool.query(q, [local, uid, uid]);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}



//방 찾기
export async function searchRooms(req, res) {
    try {
      const { uid } = req.user;
      const text = req.query.text;
      const offset = Number(req.query.offset) || 0;
  
      if (!text) {
        return res.status(400).send('Search text parameter is required');
      }
  
      const q = `
        SELECT 
          r.roomId,
          r.roomName,
          r.roomImage,
          r.tag,
          r.description,
          r.local,
          COUNT(rm2.roomId) AS memberCount
        FROM room r
        LEFT JOIN roomMember rm ON r.roomId = rm.roomId AND rm.uid = ?

        LEFT JOIN roomMember rm2 ON r.roomId = rm2.roomId
        WHERE 
          rm.uid IS NULL
          AND (
            r.roomName LIKE CONCAT('%', ?, '%') OR
            r.description LIKE CONCAT('%', ?, '%') OR
            r.tag LIKE CONCAT('%', ?, '%')
          )
        GROUP BY r.roomId
        ORDER BY r.createAt DESC
        LIMIT 10 OFFSET ?;
      `;
  
      const [rows] = await pool.query(q, [uid, text, text, text, offset]);
      res.json(rows);
    } catch (error) {
      console.error('방 찾기 쿼리 오류:', error);
      res.status(500).send();
    }
} 

