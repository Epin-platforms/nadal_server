import pool from "../../config/database.js";
import { getSocket } from "../../socket/websocket.js";

export async function nextRound(req, res) {
  const { scheduleId, round, isSingle } = req.body;
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

    // 2. 승자 목록 생성 (단식: 한 명씩 / 복식: 두 명씩)
    const nextRoundMembers = [];
    if (isSingle) {
      for (const game of currentGames) {
        let winnerId;
        if (game.walkOver === 1) {
          winnerId = game.player1_0 != null
            ? game.player1_0
            : game.player2_0;
        } else {
          winnerId = game.score1 > game.score2
            ? game.player1_0
            : game.player2_0;
        }
        nextRoundMembers.push(winnerId);
      }
    } else { // 복식
      for (const game of currentGames) {
        let winnerTeam;
        if (game.walkOver === 1) {
          winnerTeam = game.player1_0 != null
            ? [game.player1_0, game.player1_1]
            : [game.player2_0, game.player2_1];
        } else if (game.score1 > game.score2) {
          winnerTeam = [game.player1_0, game.player1_1];
        } else {
          winnerTeam = [game.player2_0, game.player2_1];
        }
        // 한 팀(2명)을 순서대로 푸시
        nextRoundMembers.push(...winnerTeam);
      }
    }

    // 3. 다음 라운드 게임 조회
    const [nextRoundGames] = await connection.query(
      `SELECT * FROM gameTable 
       WHERE scheduleId = ? AND tableId DIV 1000 = ?
       ORDER BY tableId ASC`,
      [scheduleId, round + 1]
    );

    // 4. 다음 라운드 게임에 선수(또는 팀) 배정
    const updatePromises = [];
    for (let i = 0; i < nextRoundGames.length; i++) {
      const tableId = nextRoundGames[i].tableId;

      if (isSingle) {
        const p1 = nextRoundMembers.shift();
        const p2 = nextRoundMembers.shift();
        updatePromises.push(
          connection.query(
            `UPDATE gameTable 
             SET player1_0 = ?, player2_0 = ? 
             WHERE tableId = ? AND scheduleId = ?`,
            [p1, p2, tableId, scheduleId]
          )
        );
      } else {
        const p1_0 = nextRoundMembers.shift();
        const p1_1 = nextRoundMembers.shift();
        const p2_0 = nextRoundMembers.shift();
        const p2_1 = nextRoundMembers.shift();
        updatePromises.push(
          connection.query(
            `UPDATE gameTable 
             SET player1_0 = ?, player1_1 = ?, player2_0 = ?, player2_1 = ? 
             WHERE tableId = ? AND scheduleId = ?`,
            [p1_0, p1_1, p2_0, p2_1, tableId, scheduleId]
          )
        );
      }
    }
    await Promise.all(updatePromises);

    await connection.commit();

    // 5. 소켓으로 갱신 알림
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
