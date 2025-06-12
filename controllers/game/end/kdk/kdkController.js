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
                scoreDiff: (table.score1 ?? 0) - (table.score2 ?? 0), 
                levelDiff: table.level2_0 - table.level1_0, 
                originLevel: table.level1_0
            };
            await createUserLevel(player1_0Table, connection);

            const player2_0Table = {
                scheduleId, finalScore, tableId: table.tableId, uid: table.player2_0,
                scoreDiff: (table.score2 ?? 0) - (table.score1 ?? 0), 
                levelDiff: table.level1_0 - table.level2_0, 
                originLevel: table.level2_0
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

//랭킹계산 - 수정된 버전
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

    // 4. 점수 계산 - 수정된 로직
    for (const game of games) {
        const score1 = game.score1 ?? 0;
        const score2 = game.score2 ?? 0;
        const scoreDiff = Math.abs(score1 - score2);
        
        // 승부가 결정된 경우만 처리
        if (score1 === finalScore && score2 !== finalScore) {
            // player1_0 승리
            if (scoreBoardMap[game.player1_0]) {
                scoreBoardMap[game.player1_0].winPoint += 1;
                scoreBoardMap[game.player1_0].score += scoreDiff;
            }
            if (scoreBoardMap[game.player2_0]) {
                scoreBoardMap[game.player2_0].score -= scoreDiff;
            }
        } else if (score2 === finalScore && score1 !== finalScore) {
            // player2_0 승리
            if (scoreBoardMap[game.player2_0]) {
                scoreBoardMap[game.player2_0].winPoint += 1;
                scoreBoardMap[game.player2_0].score += scoreDiff;
            }
            if (scoreBoardMap[game.player1_0]) {
                scoreBoardMap[game.player1_0].score -= scoreDiff;
            }
        }
        // 무승부이거나 게임이 끝나지 않은 경우는 처리하지 않음
    }

    // 5. 리스트 변환 및 정렬 - 안정적인 정렬 보장
    const scoreBoard = Object.values(scoreBoardMap);
    scoreBoard.sort((a, b) => {
        // 승점이 다르면 승점 높은 순
        if (a.winPoint !== b.winPoint) {
            return b.winPoint - a.winPoint;
        }
        // 승점이 같으면 득점 높은 순
        if (a.score !== b.score) {
            return b.score - a.score;
        }
        // 승점과 득점이 모두 같으면 uid 오름차순 (안정적 정렬을 위해)
        return a.uid.localeCompare(b.uid);
    });

    // 6. ranking 부여 - 동점자 처리 개선
    let currentRank = 1;
    for (let i = 0; i < scoreBoard.length; i++) {
        if (i > 0) {
            const prev = scoreBoard[i - 1];
            const curr = scoreBoard[i];
            
            // 이전 선수와 승점과 득점이 모두 다르면 순위 업데이트
            if (prev.winPoint !== curr.winPoint || prev.score !== curr.score) {
                currentRank = i + 1;
            }
        }
        scoreBoard[i].ranking = currentRank;
    }

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
            const avgLevel2 = (table.level2_0 + table.level2_1) / 2;
            const avgLevel1 = (table.level1_0 + table.level1_1) / 2;
            
            const player1_0Table = {
                scheduleId, finalScore, tableId: table.tableId, uid: table.player1_0,
                scoreDiff: (table.score1 ?? 0) - (table.score2 ?? 0), 
                levelDiff: avgLevel2 - table.level1_0,
                originLevel: table.level1_0
            };
            await createUserLevel(player1_0Table, connection);

            const player1_1Table = {
                scheduleId, finalScore, tableId: table.tableId, uid: table.player1_1,
                scoreDiff: (table.score1 ?? 0) - (table.score2 ?? 0), 
                levelDiff: avgLevel2 - table.level1_1,
                originLevel: table.level1_1
            };
            await createUserLevel(player1_1Table, connection);

            const player2_0Table = {
                scheduleId, finalScore, tableId: table.tableId, uid: table.player2_0,
                scoreDiff: (table.score2 ?? 0) - (table.score1 ?? 0), 
                levelDiff: avgLevel1 - table.level2_0,
                originLevel: table.level2_0
            };
            await createUserLevel(player2_0Table, connection);

            const player2_1Table = {
                scheduleId, finalScore, tableId: table.tableId, uid: table.player2_1,
                scoreDiff: (table.score2 ?? 0) - (table.score1 ?? 0), 
                levelDiff: avgLevel1 - table.level2_1,
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

//복식 랭킹 계산 - 수정된 버전
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

    // 4. 점수 계산 - 수정된 로직
    for (const game of games) {
        const score1 = game.score1 ?? 0;
        const score2 = game.score2 ?? 0;
        const scoreDiff = Math.abs(score1 - score2);
        const team1 = [game.player1_0, game.player1_1].filter(uid => uid); // null 체크
        const team2 = [game.player2_0, game.player2_1].filter(uid => uid); // null 체크

        // 승부가 결정된 경우만 처리
        if (score1 === finalScore && score2 !== finalScore) {
            // team1 승리
            team1.forEach(uid => {
                if (scoreBoardMap[uid]) {
                    scoreBoardMap[uid].winPoint += 1;
                    scoreBoardMap[uid].score += scoreDiff;
                }
            });
            team2.forEach(uid => {
                if (scoreBoardMap[uid]) {
                    scoreBoardMap[uid].score -= scoreDiff;
                }
            });
        } else if (score2 === finalScore && score1 !== finalScore) {
            // team2 승리
            team2.forEach(uid => {
                if (scoreBoardMap[uid]) {
                    scoreBoardMap[uid].winPoint += 1;
                    scoreBoardMap[uid].score += scoreDiff;
                }
            });
            team1.forEach(uid => {
                if (scoreBoardMap[uid]) {
                    scoreBoardMap[uid].score -= scoreDiff;
                }
            });
        }
        // 무승부이거나 게임이 끝나지 않은 경우는 처리하지 않음
    }

    // 5. 리스트 변환 및 정렬 - 안정적인 정렬 보장
    const scoreBoard = Object.values(scoreBoardMap);
    scoreBoard.sort((a, b) => {
        // 승점이 다르면 승점 높은 순
        if (a.winPoint !== b.winPoint) {
            return b.winPoint - a.winPoint;
        }
        // 승점이 같으면 득점 높은 순
        if (a.score !== b.score) {
            return b.score - a.score;
        }
        // 승점과 득점이 모두 같으면 uid 오름차순 (안정적 정렬을 위해)
        return a.uid.localeCompare(b.uid);
    });

    // 6. ranking 부여 - 동점자 처리 개선
    let currentRank = 1;
    for (let i = 0; i < scoreBoard.length; i++) {
        if (i > 0) {
            const prev = scoreBoard[i - 1];
            const curr = scoreBoard[i];
            
            // 이전 선수와 승점과 득점이 모두 다르면 순위 업데이트
            if (prev.winPoint !== curr.winPoint || prev.score !== curr.score) {
                currentRank = i + 1;
            }
        }
        scoreBoard[i].ranking = currentRank;
    }

    return scoreBoard;
}