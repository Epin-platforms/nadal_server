import pool from "../../config/database.js";
import { getSocket } from "../../socket/websocket.js";

export async function nextRound(req, res) {
    const { scheduleId, round } = req.body;
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // 1. 현재 라운드의 게임 조회
      const [currentGames] = await connection.query(
        `SELECT * FROM gameTable 
         WHERE scheduleId = ? AND tableId DIV 1000 = ?
         ORDER BY tableId ASC`,
        [scheduleId, round]
      );
      
      // 2. 승자 목록 생성
      const nextRoundMembers = [];
      for (const game of currentGames) {
        // 승자 결정 (점수가 높은 플레이어 선택)
        if (game.score1 > game.score2) {
          nextRoundMembers.push(game.player1_0);
        } else {
          nextRoundMembers.push(game.player2_0);
        }
      }
      
      // 3. 다음 라운드 게임 조회
      const [nextRoundGames] = await connection.query(
        `SELECT * FROM gameTable 
         WHERE scheduleId = ? AND tableId DIV 1000 = ?
         ORDER BY tableId ASC`,
        [scheduleId, round + 1]
      );
      
      // 4. 다음 라운드 게임에 선수 배정
      const updatePromises = [];
      for (let i = 0; i < nextRoundGames.length; i++) {
        // 짝수 인덱스는 player1, 홀수 인덱스는 player2로 배정
        const player1_0 = nextRoundMembers.shift();
        const player2_0 = nextRoundMembers.shift();
        
        updatePromises.push(
          connection.query(
            `UPDATE gameTable SET player1_0 = ?, player2_0 = ? WHERE tableId = ? AND scheduleId = ?`,
            [player1_0, player2_0, nextRoundGames[i].tableId, scheduleId]
          )
        );
      }
      
      // 모든 업데이트 실행
      await Promise.all(updatePromises);
      
      
      await connection.commit();
      
      // 소켓 이벤트 발송 (해당되는 경우)
      const io = getSocket();
      io.to(`gameId:${scheduleId}`).emit('refreshGame');
      
      res.status(200).json({ message: '다음 라운드 진출자 배정 완료' });
    } catch (error) {
      await connection.rollback();
      console.error('다음 라운드 진출자 배정 중 오류:', error);
      res.status(500).json({ error: '서버 오류' });
    } finally {
      connection.release();
    }
  }