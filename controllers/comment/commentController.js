import pool from '../../config/database.js';


export async function getCommentWithScheduleId(req, res) {
    try {
      const scheduleId = Number(req.params.scheduleId);
      const updateAt = req.query.updateAt;
      const limit = Number(req.query.limit) || 30;
      const offset = Number(req.query.offset) || 0;
  
      if (!scheduleId || !updateAt) {
        return res.status(400).json({ error: 'scheduleId와 updateAt은 필수입니다.' });
      }
  
      const q = `
        SELECT 
          c.commentId,
          c.uid,
          c.text,
          c.scheduleId,
          c.reply,
          c.createAt,
          c.updateAt,
          u.profileImage,
            IF(COALESCE(r.useNickname, 1) = 1, u.nickName, u.name) AS displayName,
            IF(COALESCE(r.useNickname, 1) = 1, NULL, u.gender) AS gender,
            IF(COALESCE(r.useNickname, 1) = 1, NULL, u.birthYear) AS birthYear
        FROM comment c
        LEFT JOIN user u ON c.uid = u.uid
        LEFT JOIN schedule s ON c.scheduleId = s.scheduleId
        LEFT JOIN room r ON s.roomId = r.roomId
        WHERE c.scheduleId = ?
          AND (c.createAt > ? OR c.updateAt > ?)
          AND (
            c.reply IS NULL OR
            (c.reply IS NOT NULL AND EXISTS (
              SELECT 1 FROM comment c2 
              WHERE c2.commentId = c.reply AND c2.reply IS NULL
            ))
          )
        ORDER BY c.createAt ASC
        LIMIT ? OFFSET ?;
      `;
  
      const [rows] = await pool.query(q, [scheduleId, updateAt, updateAt, limit, offset]);
  
      res.json(rows);
    } catch (error) {
      console.error('댓글 불러오기 오류:', error);
      res.status(500).send();
    }
  }
  


  export async function writeComment(req, res) {
    try {
      const { uid } = req.user;
      const { scheduleId, text, reply } = req.body;
  
      const q = `
        INSERT INTO comment (scheduleId, uid, text, reply)
        VALUES (?, ?, ?, ?)
      `;
  
      await pool.query(q, [scheduleId, uid, text, reply || null]);
      res.send();
    } catch (error) {
      console.error('댓글 등록 실패:', error);
      res.status(500).send();
    }
  }
  

  //코멘트삭제
  export async function deleteComment(req, res) {
    try {
      const commentId = Number(req.params.commentId);
  
      // 대댓글 존재 여부 확인
      const [[replyCheck]] = await pool.query(
        `SELECT COUNT(*) AS count FROM comment WHERE reply = ?`,
        [commentId]
      );
      
      const isDelete = replyCheck.count > 0 ? false : true;
      if (replyCheck.count > 0) {
        // ❗ 대댓글 있음 → 소프트 삭제
        await pool.query(
          `UPDATE comment SET text = '삭제된 댓글입니다.' WHERE commentId = ?`,
          [commentId]
        );
      } else {
        // ✅ 대댓글 없음 → 하드 삭제
        await pool.query(
          `DELETE FROM comment WHERE commentId = ?`,
          [commentId]
        );
      }
  
      res.json({isDelete : isDelete});
    } catch (error) {
      console.error('댓글 삭제 오류:', error);
      res.status(500).send();
    }
  }
  
  //코멘트 업데이트
  export async function updateComment(req, res) {
    try {
      const commentId = Number(req.params.commentId);
      const { text } = req.body;
      const { uid } = req.user; // 인증된 사용자
  
      if (!text || text.trim().length === 0) {
        return res.status(400).send({ error: '댓글 내용이 비어 있습니다.' });
      }
  
      // 본인 확인 및 댓글 존재 여부
      const [[check]] = await pool.query(
        `SELECT uid FROM comment WHERE commentId = ?`,
        [commentId]
      );
  
      if (!check) {
        return res.status(404).send({ error: '댓글이 존재하지 않습니다.' });
      }
  
      if (check.uid !== uid) {
        return res.status(403).send({ error: '본인의 댓글만 수정할 수 있습니다.' });
      }
  
      // 수정
      await pool.query(
        `UPDATE comment SET text = ?, updateAt = CURRENT_TIMESTAMP WHERE commentId = ?`,
        [text, commentId]
      );
  
      res.send(); // 200 OK
    } catch (error) {
      console.error('댓글 수정 오류:', error);
      res.status(500).send();
    }
  }
  