import pool from '../../../../config/database.js';
import { getSocket } from '../../../../socket/websocket.js';
import { createUserLevel, updateScheduleMemberInGame } from '../endGameController.js';
import { updateScheduleState } from '../../startController.js';


//싱글 결과 계산
export async function saveSingleTournament(req, res) {
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
        WHERE scheduleId = ? AND walkOver = FALSE
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


        const ranking = await calculateTournamentSingleRanking(scheduleId, finalScore, connection);

        //멤버 업데이트
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
async function calculateTournamentSingleRanking(scheduleId, finalScore, connection) {
    try {
      // 1. 스케줄 멤버 불러오기
      const [members] = await connection.query(`
        SELECT uid
        FROM scheduleMember
        WHERE scheduleId = ?;
      `, [scheduleId]);
      
      // 2. 게임 테이블 불러오기
      const [gameTables] = await connection.query(`
        SELECT tableId, player1_0, player2_0, score1, score2, walkOver
        FROM gameTable
        WHERE scheduleId = ?;
      `, [scheduleId]);
      
      // 3. 점수판 초기화
      const scoreBoard = members.map(member => ({
        uid: member.uid,
        winPoint: 0, // 승리 라운드
        score: 0     // 점수 누적
      }));
      
      // 4. 점수 계산
      for (const game of gameTables) {
        const round = Math.floor(game.tableId / 1000);
        
        //부전승일 경우  둘중 하나는 무조건 null 부전승인경우 score이 둘다 null
        if(game.walkOver == 1){
            const player1Index = scoreBoard.findIndex(player => player.uid === game.player1_0);
            const player2Index = scoreBoard.findIndex(player => player.uid === game.player2_0);
            if(player1Index !== -1){
                scoreBoard[player1Index].winPoint = round + 1;
            }
            if(player2Index !== -1){
                scoreBoard[player2Index].winPoint = round + 1;
            }
        }else{ //부전승이 아닌경우
            if (game.score1 === finalScore) {
                // player1 승리
                const player1Index = scoreBoard.findIndex(player => player.uid === game.player1_0);
                if (player1Index !== -1) {
                  scoreBoard[player1Index].winPoint = round + 1;
                  
                  // 상대가 존재하면 점수 추가
                  const player2Index = scoreBoard.findIndex(player => player.uid === game.player2_0);
                  if (player2Index !== -1) {
                    scoreBoard[player2Index].winPoint = round;
                    scoreBoard[player1Index].score += game.score1;
                    scoreBoard[player2Index].score += game.score2;
                  }
                }
              } else if (game.score2 === finalScore) {
                // player2 승리
                const player2Index = scoreBoard.findIndex(player => player.uid === game.player2_0);
                if (player2Index !== -1) {
                  scoreBoard[player2Index].winPoint = round + 1;
                  
                  // 상대가 존재하면 점수 추가
                  const player1Index = scoreBoard.findIndex(player => player.uid === game.player1_0);
                  if (player1Index !== -1) {
                    scoreBoard[player1Index].winPoint = round;
                    scoreBoard[player1Index].score += game.score1;
                    scoreBoard[player2Index].score += game.score2;
                  }
                }
              }
        }
        
        
      }
      
      // 5. 정렬 (winPoint 내림차순, 동점시 score 내림차순)
      scoreBoard.sort((a, b) => {
        if (a.winPoint !== b.winPoint) {
          return b.winPoint - a.winPoint; // winPoint 기준 내림차순
        } else {
          return b.score - a.score; // score 기준 내림차순
        }
      });
      
      // 6. 순위 부여
      scoreBoard.forEach((player, index) => {
        player.ranking = index + 1;
      });
      
      return scoreBoard;
    } catch (error) {
      console.error('토너먼트 단식 점수 계산 중 오류:', error);
      throw error;
    }
  }



  //팀 토너먼트 결과 계산
export async function saveDoubleTournament(req, res) {
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
        WHERE scheduleId = ? AND walkOver = FALSE
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

        const ranking = await calculateTournamentDoubleRanking(scheduleId, finalScore, connection);

        //멤버 업데이트
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

async function calculateTournamentDoubleRanking(scheduleId, finalScore, connection) {
    try {
      // 1. 스케줄 멤버 불러오기
      const [members] = await connection.query(`
        SELECT uid, teamName
        FROM scheduleMember
        WHERE scheduleId = ?;
      `, [scheduleId]);
      
      // 2. 게임 테이블 불러오기
      const [gameTables] = await connection.query(`
        SELECT tableId, player1_0, player1_1, player2_0, player2_1, score1, score2, walkOver
        FROM gameTable
        WHERE scheduleId = ?;
      `, [scheduleId]);
      
      // 3. 점수판 초기화
      const scoreBoard = members.map(member => ({
        uid: member.uid,
        winPoint: 0,   // 승리 라운드
        score: 0,      // 점수 누적
        teamName: member.teamName,
        ranking: 0     // 최종 순위
      }));
      
      // 4. 점수 계산
      for (const game of gameTables) {
        const round = Math.floor(game.tableId / 1000);
        
        // 부전승 처리
        if (game.walkOver == 1) {
          // 팀1 승리
          if (game.player1_0) {
            const player1_0Index = scoreBoard.findIndex(player => player.uid === game.player1_0);
            if (player1_0Index !== -1) {
              scoreBoard[player1_0Index].winPoint = round + 1;
            }
            
            if (game.player1_1) {
              const player1_1Index = scoreBoard.findIndex(player => player.uid === game.player1_1);
              if (player1_1Index !== -1) {
                scoreBoard[player1_1Index].winPoint = round + 1;
              }
            }
          }
          
          // 팀2 승리
          if (game.player2_0) {
            const player2_0Index = scoreBoard.findIndex(player => player.uid === game.player2_0);
            if (player2_0Index !== -1) {
              scoreBoard[player2_0Index].winPoint = round + 1;
            }
            
            if (game.player2_1) {
              const player2_1Index = scoreBoard.findIndex(player => player.uid === game.player2_1);
              if (player2_1Index !== -1) {
                scoreBoard[player2_1Index].winPoint = round + 1;
              }
            }
          }
        } else { // 일반 경기
          if (game.score1 === finalScore) {
            // 팀1 승리
            updateTeamScore(scoreBoard, game.player1_0, game.player1_1, round + 1, game.score1);
            
            // 팀2 패배 (상대가 존재하는 경우)
            if (game.player2_0) {
              updateTeamScore(scoreBoard, game.player2_0, game.player2_1, round, game.score2);
            }
          } else if (game.score2 === finalScore) {
            // 팀2 승리
            updateTeamScore(scoreBoard, game.player2_0, game.player2_1, round + 1, game.score2);
            
            // 팀1 패배
            if (game.player1_0) {
              updateTeamScore(scoreBoard, game.player1_0, game.player1_1, round, game.score1);
            }
          }
        }
      }
      
      // 5. 중복을 제거하고 팀별 순위 계산을 위한 팀 목록 생성
      const teamRanking = [];
      const processedTeams = new Set();
      
      for (const player of scoreBoard) {
        if (player.teamName && !processedTeams.has(player.teamName)) {
          processedTeams.add(player.teamName);
          
          // 해당 팀의 대표 멤버를 찾아 팀 랭킹 정보 저장
          teamRanking.push({
            teamName: player.teamName,
            winPoint: player.winPoint,
            score: player.score
          });
        }
      }
      
      // 6. 팀 랭킹 정렬 (winPoint 내림차순, 동점시 score 내림차순)
      teamRanking.sort((a, b) => {
        if (a.winPoint !== b.winPoint) {
          return b.winPoint - a.winPoint; // winPoint 기준 내림차순
        } else {
          return b.score - a.score; // score 기준 내림차순
        }
      });
      
      // 7. 각 팀의 순위 업데이트
      for (let i = 0; i < teamRanking.length; i++) {
        const team = teamRanking[i];
        const rank = i + 1;
        
        // 같은 팀에 속한 모든 멤버의 랭킹 업데이트
        scoreBoard.forEach(player => {
          if (player.teamName === team.teamName) {
            player.ranking = rank;
          }
        });
      }
      
      return scoreBoard;
    } catch (error) {
      console.error('토너먼트 복식 점수 계산 중 오류:', error);
      throw error;
    }
  }
  
  // 팀 점수 업데이트 헬퍼 함수
  function updateTeamScore(scoreBoard, player1, player2, winPoint, score) {
    // 첫 번째 플레이어 업데이트
    if (player1) {
      const player1Index = scoreBoard.findIndex(player => player.uid === player1);
      if (player1Index !== -1) {
        scoreBoard[player1Index].winPoint = winPoint;
        scoreBoard[player1Index].score += score;
      }
    }
    
    // 두 번째 플레이어 업데이트 (존재하는 경우)
    if (player2) {
      const player2Index = scoreBoard.findIndex(player => player.uid === player2);
      if (player2Index !== -1) {
        scoreBoard[player2Index].winPoint = winPoint;
        scoreBoard[player2Index].score += score;
      }
    }
  }