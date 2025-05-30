
import pool from '../../../../config/database.js';
import { getSocket } from '../../../../socket/websocket.js';
import { createUserLevel, updateScheduleMemberInGame } from '../endGameController.js';
import { updateScheduleState } from '../../startController.js';

//싱글 결과 계산
export async function saveSingleKDK(req, res) {
    const connection = await pool.getConnection();
    try{
        const scheduleId = Number(req.params.scheduleId);
        const finalScore = Number(req.query.finalScore);
        await connection.beginTransaction();

        //테이블 정보 가져오기 레벨정보 포함
        const [tables] = await connection.query(
        `SELECT 
        gt.tableId, gt.score1, gt.score2, gt.player1_0, gt.player2_0, 
        u1.level as level1_0, u2.level as level2_0 
        FROM gameTable gt 
        LEFT JOIN user u1 ON gt.player1_0 = u1.uid 
        LEFT JOIN user u2 ON gt.player2_0 = u2.uid 
        WHERE scheduleId = ?
        `, [scheduleId]);

        //테이블을 보며 레벨 정보 제작
        for(const table of tables){
            const player1_0Table = {
                scheduleId, finalScore, tableId: table.tableId, uid: table.player1_0,
                scoreDiff: (table.score1 ?? 0) - (table.score2 ?? 0), levelDiff: table.level2_0 - table.level1_0, originLevel: table.level1_0
              };
              await createUserLevel(player1_0Table, connection);

              // 플레이어 2
              const player2_0Table = {
                scheduleId, finalScore, tableId: table.tableId, uid: table.player2_0,
                scoreDiff: table.score2 - table.score1, levelDiff: table.level1_0 - table.level2_0, originLevel: table.level2_0
              };
              await createUserLevel(player2_0Table, connection);
        }


        const ranking = await calculateKdkSingleRanking(scheduleId, finalScore, connection);
        await updateScheduleMemberInGame(scheduleId, ranking, connection);

        //레벨 정보 제작완료시 상태 업데이트
        await updateScheduleState(scheduleId, 4, connection);

        //커넥션 커밋해주고
        await connection.commit();

        //게임 종료 날려주기
        const io = getSocket();
        io.to(`gameId:${scheduleId}`).emit('refreshMember'); //랭킹반영
        io.to(`gameId:${scheduleId}`).emit('changedState', {state : 4});

        res.send();
    }catch(error){
        console.error(error);
        await connection.rollback();
        res.status(500).send();
    }finally{
        connection.release();
    }
}



//랭킹계산
export async function calculateKdkSingleRanking(scheduleId, finalScore, connection) {
  // 1. 게임 테이블 불러오기
  const [games] = await connection.query(`
    SELECT player1_0, player2_0, score1, score2
    FROM gameTable
    WHERE scheduleId = ?;
  `, [scheduleId]);

  // 2. 참가자 불러오기
  const [members] = await connection.query(`
    SELECT uid
    FROM scheduleMember
    WHERE scheduleId = ?;
  `, [scheduleId]);

  // 3. 점수판 초기화
  const scoreBoardMap = {};
  members.forEach(member => {
    scoreBoardMap[member.uid] = {
      uid: member.uid,
      winPoint: 0,
      score: 0,
    };
  });

  // 4. 점수 계산
  for (const game of games) {
    const scoreDiff = Math.abs(game.score1 - game.score2);

    if (game.score1 === finalScore) {
      scoreBoardMap[game.player1_0].winPoint += 1;
      scoreBoardMap[game.player1_0].score += scoreDiff;
      scoreBoardMap[game.player2_0].score -= scoreDiff;
    } else if (game.score2 === finalScore) {
      scoreBoardMap[game.player2_0].winPoint += 1;
      scoreBoardMap[game.player2_0].score += scoreDiff;
      scoreBoardMap[game.player1_0].score -= scoreDiff;
    }
  }

  // 5. 리스트 변환 및 정렬
  const scoreBoard = Object.values(scoreBoardMap);
  scoreBoard.sort((a, b) => {
    if (a.winPoint !== b.winPoint) return b.winPoint - a.winPoint;
    if (a.score !== b.score) return b.score - a.score;
    return a.uid.localeCompare(b.uid); // uid 기준 오름차순
  });

  // 6. ranking 부여
  scoreBoard.forEach((user, index) => {
    user.ranking = index + 1;
  });

  return scoreBoard;
}



export async function saveDoubleKDK(req, res) {
  const connection = await pool.getConnection();
  try{
      const scheduleId = Number(req.params.scheduleId);
      const finalScore = Number(req.query.finalScore);
      await connection.beginTransaction();

      //테이블 정보 가져오기 레벨정보 포함
      const [tables] = await connection.query(
      `SELECT 
      gt.tableId, gt.score1, gt.score2, gt.player1_0, gt.player1_1, gt.player2_0, gt.player2_1,
      u1.level as level1_0, u2.level as level1_1, u3.level as level2_0, u4.level as level2_1
      FROM gameTable gt 
      LEFT JOIN user u1 ON gt.player1_0 = u1.uid 
      LEFT JOIN user u2 ON gt.player1_1 = u2.uid 
      LEFT JOIN user u3 ON gt.player2_0 = u3.uid 
      LEFT JOIN user u4 ON gt.player2_1 = u4.uid 
      WHERE scheduleId = ?
      `, [scheduleId]);

      //테이블을 보며 레벨 정보 제작
      for(const table of tables){
          const player1_0Table = {
              scheduleId, finalScore, tableId: table.tableId, uid: table.player1_0,
              scoreDiff: (table.score1 ?? 0) - (table.score2 ?? 0), 
              levelDiff: ((table.level2_0 + table.level2_1) / 2) - table.level1_0,
              originLevel: table.level1_0
            };
            await createUserLevel(player1_0Table, connection);

            const player1_1Table = {
              scheduleId, finalScore, 
              tableId: table.tableId, 
              uid: table.player1_1,
              scoreDiff: (table.score1 ?? 0) - (table.score2 ?? 0), 
              levelDiff: ((table.level2_0 + table.level2_1) / 2) - table.level1_1,
              originLevel: table.level1_0
            };
            await createUserLevel(player1_1Table, connection);

            // 플레이어 2
            const player2_0Table = {
              scheduleId, finalScore, 
              tableId: table.tableId, 
              uid: table.player2_0,
              scoreDiff: (table.score2 ?? 0) - (table.score1 ?? 0), 
              levelDiff: ((table.level1_0 + table.level1_1) / 2) - table.level2_0,
              originLevel: table.level2_0
            };
            await createUserLevel(player2_0Table, connection);

            // 플레이어 2
            const player2_1Table = {
              scheduleId, finalScore, 
              tableId: table.tableId, 
              uid: table.player2_1,
              scoreDiff: (table.score2 ?? 0) - (table.score1 ?? 0), 
              levelDiff: ((table.level1_0 + table.level1_1) / 2) - table.level2_1,
              originLevel: table.level2_1
            };
            await createUserLevel(player2_1Table, connection);
      }


      const ranking = await calculateKdkDoubleRanking(scheduleId, finalScore, connection);
      await updateScheduleMemberInGame(scheduleId, ranking, connection);

      //레벨 정보 제작완료시 상태 업데이트
      await updateScheduleState(scheduleId, 4, connection);

      //커넥션 커밋해주고
      await connection.commit();

      //게임 종료 날려주기
      const io = getSocket();
      io.to(`gameId:${scheduleId}`).emit('refreshMember');
      io.to(`gameId:${scheduleId}`).emit('changedState', {state : 4});

      res.send();
  }catch(error){
      console.error(error);
      await connection.rollback();
      res.status(500).send();
  }finally{
      connection.release();
  }
}


//복식 랭킹 계산
export async function calculateKdkDoubleRanking(scheduleId, finalScore, connection) {

  // 1. 게임 테이블 불러오기
  const [games] = await connection.query(`
    SELECT player1_0, player1_1, player2_0, player2_1, score1, score2
    FROM gameTable
    WHERE scheduleId = ?;
  `, [scheduleId]);


  // 2. 참가자 불러오기
  const [members] = await connection.query(`
    SELECT uid
    FROM scheduleMember
    WHERE scheduleId = ?;
  `, [scheduleId]);

  // 3. 점수판 초기화
  const scoreBoardMap = {};
  members.forEach(member => {
    scoreBoardMap[member.uid] = {
      uid: member.uid,
      winPoint: 0,
      score: 0,
    };
  });

  // 4. 점수 계산 (복식: 각 팀의 2명에게 동일하게 적용)
  for (const game of games) {
    const scoreDiff = Math.abs(game.score1 - game.score2);
    const team1 = [game.player1_0, game.player1_1];
    const team2 = [game.player2_0, game.player2_1];

    console.log(`게임 결과 ${game.score1} vs ${game.score2} //finalScore = ${finalScore}`);
    if (game.score1 === finalScore) {
      console.log(`팀1 우승`);
      // team1 승리
      team1.forEach(uid => {
        console.log(`uid=${uid} 에 승점 부여 ${scoreBoardMap[uid].winPoint}`);
        scoreBoardMap[uid].winPoint += 1;
        console.log(`--> ${scoreBoardMap[uid].winPoint}`);
        scoreBoardMap[uid].score += scoreDiff;
      });
      team2.forEach(uid => {
        scoreBoardMap[uid].score -= scoreDiff;
      });
    } else if (game.score2 === finalScore) {
      console.log(`팀2 우승`);
      // team2 승리
      team2.forEach(uid => {
        scoreBoardMap[uid].winPoint += 1;
        scoreBoardMap[uid].score += scoreDiff;
      });
      team1.forEach(uid => {
        scoreBoardMap[uid].score -= scoreDiff;
      });
    }
  }

  // 5. 리스트 변환 및 정렬
  const scoreBoard = Object.values(scoreBoardMap);
  scoreBoard.sort((a, b) => {
    if (a.winPoint !== b.winPoint) return b.winPoint - a.winPoint;
    if (a.score !== b.score) return b.score - a.score;
    return a.uid.localeCompare(b.uid); // uid 기준 오름차순
  });

  // 6. ranking 부여
  scoreBoard.forEach((user, index) => {
    user.ranking = index + 1;
  });

  return scoreBoard;
}
