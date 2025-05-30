import pool from '../../config/database.js';
import { getSocket } from '../../socket/websocket.js';

//특정 사용자 진행 게임 리스트 불러오기
export async function getGames(req, res){
    try {
        const {uid} = req.params;
        const q = `SELECT s.title, s.startDate, s.endDate, s.state, s.isSingle, s.isKDK, s.finalScore, 
        (SELECT COUNT(*) 
        FROM schedulemember sm
        WHERE s.scheduleId = sm.scheduleId) AS memberCount
        FROM schedule s
        INNER JOIN scheduleMember sm2 ON s.scheduleId = sm2.scheduleId
        WHERE sm.uid = ? AND s.tag = '게임'`;

        const [rows] = await pool.query(q, [uid]);
        res.json(rows);
    } catch (error) {
        console.error('게임 리스트 쿼리 에러 :', err);
        res.status(500).send();
    }
}

//게임 테이블 불러오기
export async function getGameTables(req, res){
    try {
        const {scheduleId} = req.params;
        const q = `
            SELECT * FROM gameTable
            WHERE scheduleId = ?
        `;

        const [rows] = await pool.query(q, [scheduleId]);

        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}

// 개선: 트랜잭션 사용 + 상태 재검증
export async function updateScore(req, res){
  const connection = await pool.getConnection();
  try {
      const {scheduleId, tableId, score, where} = req.body;

      await connection.beginTransaction();

      // 상태 재확인 (트랜잭션 안에서)
      const [rows] = await connection.query(`
          SELECT state FROM schedule
          WHERE scheduleId = ? FOR UPDATE;
      `, [scheduleId]);

      if(rows.length === 0 || rows[0].state !== 3){
          await connection.rollback();
          return res.status(400).send({message: '이미 종료된 게임입니다'});
      }

      // 점수 업데이트
      const q = `
          UPDATE gameTable
          SET score${where} = ?
          WHERE tableId = ? AND scheduleId = ?;
      `; 
      await connection.query(q, [score, tableId, scheduleId]);

      await connection.commit();

      const io = getSocket();
      io.to(`gameId:${scheduleId}`).emit('score', req.body);

      res.send();
  } catch (error) {
      await connection.rollback();
      console.error(error);
      res.status(500).send();
  } finally {
      connection.release();
  }
}

//게임 코트명 변경
export async function updateCourt(req, res){
  try {
      const scheduleId = req.body.scheduleId;
      const court = req.body.court;
      const tableId = req.body.tableId;

      const q = `
          UPDATE gameTable
          SET court = ?
          WHERE scheduleId = ? AND tableId = ?;
      `;

      await pool.query(q, [court, scheduleId, tableId]);

      const io = getSocket();
      io.to(`gameId:${scheduleId}`).emit('court', {tableId : tableId, court: court});
      res.send();
  } catch (error) {
      console.error(error);
      res.status(500).send();
  }
}


// 스케줄 아이디로 레벨 조회
export async function getLevelWithScheduleId(req, res) {
  const {uid} = req.user;
  const {scheduleId} = req.params;

  const q = `
      SELECT * FROM userLevel
      WHERE uid = ? AND scheduleId = ?;
  `;

  try {
    const [results] = await pool.query(q, [uid, scheduleId]);
    res.json(results);
  } catch (error) {
    console.error('게임 유저 획득 실패', error);
    res.status(500).send();
  }
}

