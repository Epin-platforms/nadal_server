import pool from '../../config/database.js';


//qna가져오기
export async function getQnA(req, res) {
    try {
       const {uid} = req.user;
 
       const q = `
          SELECT q.*, u.name as managerName, u.profileImage as managerProfileImage FROM qna q
          LEFT JOIN manager m ON q.answerMid = m.mid
          LEFT JOIN user u ON m.uid = u.uid
          WHERE q.uid = ?
          AND q.createAt >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
          ORDER BY q.createAt DESC;
       `;
 
       const [rows] = await pool.query(q, [uid]);
       res.json(rows);
    } catch (error) {
       console.error(error);
       res.status(500).send();
    }
 }

 
 //faq가져오기
export async function getFaQ(req, res) {
    try {
       const q = `
       SELECT q.*, u.name as managerName, u.profileImage as managerProfileImage FROM qna q
       LEFT JOIN manager m ON q.answerMid = m.mid
       LEFT JOIN user u ON m.uid = u.uid
       WHERE isFaq = 1
       ORDER BY q.createAt DESC;`;
 
       const [rows] = await pool.query(q);
       res.json(rows);
    } catch (error) {
       console.error(error);
       res.status(500).send();
    }
 }
 
 
// 문의 만들기
export async function createQnA(req, res) {
    try {
      const { uid } = req.user;
      const { title, question } = req.body;
  
      const q = `
        INSERT INTO qna (uid, title, question)
        VALUES (?, ?, ?);
      `;
  
      const values = [uid, title, question];
  
      const [insertResult] = await pool.query(q, values); // ✅ 구조분해
      const insertId = insertResult.insertId;
  
      const q2 = `
        SELECT q.*, u.name as managerName, u.profileImage as managerProfileImage
        FROM qna q
        LEFT JOIN manager m ON q.answerMid = m.mid
        LEFT JOIN user u ON m.uid = u.uid
        WHERE q.qid = ?;
      `;
  
      const [rows] = await pool.query(q2, [insertId]);
  
      res.json(rows[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'QnA 등록 중 오류가 발생했습니다.' });
    }
  }
  

//질문 내역 제거
export async function deleteQna(req, res) {
    try {
       const { qid } = req.body;
       const q = `
          DELETE FROM qna
          WHERE qid = ?;
       `;
 
       await pool.query(q, [qid]);
       res.send();
    } catch (error) {
       console.error(error);
       res.status(500).send();
    }
 }
 