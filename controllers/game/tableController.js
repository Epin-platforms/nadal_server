import pool from '../../config/database.js';
import { doubleKdkRules, singleKdkRules } from '../../config/gameTable.js';
import { getSocket } from '../../socket/websocket.js';
import { updateScheduleState } from './startController.js';

/**
 * 공통 에러 처리 함수
 */
async function handleError(connection, error, res, message = '게임 테이블 생성 중 오류가 발생했습니다.') {
    console.error(`게임 테이블 생성 오류:`, error);
    await connection.rollback();
    res.status(500).json({ 
        success: false, 
        message,
        error: error.message 
    });
}

/**
 * 게임 완료 처리 (소켓 이벤트 발송)
 */
function broadcastGameUpdate(scheduleId, state = 3) {
    const io = getSocket();
    io.to(`gameId:${scheduleId}`).emit('refreshMember');
    io.to(`gameId:${scheduleId}`).emit('refreshGame');
    io.to(`gameId:${scheduleId}`).emit('changedState', { state });
}

/**
 * 멤버 조회 (부전승 멤버 포함, isWalkOver 명시적 처리)
 */
async function getMembers(scheduleId, connection) {
    try {
        const query = `
            SELECT * FROM scheduleMember
            WHERE scheduleId = ? AND approval = 1
            ORDER BY memberIndex ASC
        `;
        
        const [rows] = await connection.query(query, [scheduleId]);
        
        // isWalkOver 필드 정규화 (1, true, '1' 모두 true로 처리)
        return rows.map(member => ({
            ...member,
            isWalkOver: member.isWalkOver === 1 || member.isWalkOver === true || member.isWalkOver === '1'
        }));
    } catch (error) {
        console.error('멤버 조회 오류:', error);
        return [];
    }
}

/**
 * 실제 참가자만 필터링 (부전승 제외)
 */
function getRealMembers(members) {
    return members.filter(member => !member.isWalkOver);
}

/**
 * KDK 단식 게임 테이블 생성
 */
export async function createSingleKDK(req, res) {
    const connection = await pool.getConnection();
    try {
        const { scheduleId } = req.body;

        if (!scheduleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'scheduleId가 필요합니다.' 
            });
        }

        await connection.beginTransaction();

        const members = await getMembers(scheduleId, connection);
        const realMembers = getRealMembers(members);

        if (realMembers.length < 4) {
            await connection.rollback();
            return res.status(400).json({ 
                success: false, 
                message: 'KDK 단식은 최소 4명이 필요합니다.' 
            });
        }

        const rule = singleKdkRules[realMembers.length];
        if (!rule) {
            await connection.rollback();
            return res.status(400).json({ 
                success: false, 
                message: `${realMembers.length}명에 대한 KDK 단식 규칙을 찾을 수 없습니다.` 
            });
        }

        const gameTables = [];
        for (let i = 0; i < rule.length; i++) {
            const [a, b] = rule[i];
            const player1 = realMembers[a]?.uid;
            const player2 = realMembers[b]?.uid;
            
            if (player1 && player2) {
                gameTables.push([
                    i + 1,        // tableId
                    player1,      // player1_0
                    player2,      // player2_0
                    0,            // score1
                    0,            // score2
                    scheduleId,   // scheduleId
                    false         // walkOver
                ]);
            }
        }

        if (gameTables.length === 0) {
            await connection.rollback();
            return res.status(400).json({ 
                success: false, 
                message: '생성할 수 있는 게임이 없습니다.' 
            });
        }

        const insertQuery = `
            INSERT INTO gameTable
            (tableId, player1_0, player2_0, score1, score2, scheduleId, walkOver)
            VALUES ?
        `;

        await connection.query(insertQuery, [gameTables]);
        await updateScheduleState(scheduleId, 3, connection);
        await connection.commit();

        broadcastGameUpdate(scheduleId);
        res.status(200).json({ 
            success: true, 
            message: 'KDK 단식 게임 테이블이 생성되었습니다.',
            gameCount: gameTables.length
        });

    } catch (error) {
        await handleError(connection, error, res, 'KDK 단식 게임 테이블 생성 중 오류가 발생했습니다.');
    } finally {
        connection.release();
    }
}

/**
 * KDK 복식 게임 테이블 생성
 */
export async function createDoubleKDK(req, res) {
    const connection = await pool.getConnection();
    try {
        const { scheduleId } = req.body;

        if (!scheduleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'scheduleId가 필요합니다.' 
            });
        }

        await connection.beginTransaction();

        const members = await getMembers(scheduleId, connection);
        const realMembers = getRealMembers(members);

        if (realMembers.length < 5) {
            await connection.rollback();
            return res.status(400).json({ 
                success: false, 
                message: 'KDK 복식은 최소 5명이 필요합니다.' 
            });
        }

        const rule = doubleKdkRules[realMembers.length];
        if (!rule) {
            await connection.rollback();
            return res.status(400).json({ 
                success: false, 
                message: `${realMembers.length}명에 대한 KDK 복식 규칙을 찾을 수 없습니다.` 
            });
        }

        const gameTables = [];
        for (const match of rule) {
            const team1Player1 = realMembers[match.team1[0]]?.uid;
            const team1Player2 = realMembers[match.team1[1]]?.uid;
            const team2Player1 = realMembers[match.team2[0]]?.uid;
            const team2Player2 = realMembers[match.team2[1]]?.uid;
            
            if (team1Player1 && team1Player2 && team2Player1 && team2Player2) {
                gameTables.push([
                    match.tableId,  // tableId
                    team1Player1,   // player1_0
                    team1Player2,   // player1_1
                    team2Player1,   // player2_0
                    team2Player2,   // player2_1
                    0,              // score1
                    0,              // score2
                    scheduleId,     // scheduleId
                    false           // walkOver
                ]);
            }
        }

        if (gameTables.length === 0) {
            await connection.rollback();
            return res.status(400).json({ 
                success: false, 
                message: '생성할 수 있는 게임이 없습니다.' 
            });
        }

        const insertQuery = `
            INSERT INTO gameTable 
            (tableId, player1_0, player1_1, player2_0, player2_1, score1, score2, scheduleId, walkOver) 
            VALUES ?
        `;
        
        await connection.query(insertQuery, [gameTables]);
        await updateScheduleState(scheduleId, 3, connection);
        await connection.commit();

        broadcastGameUpdate(scheduleId);
        res.status(200).json({ 
            success: true, 
            message: 'KDK 복식 게임 테이블이 생성되었습니다.',
            gameCount: gameTables.length
        });

    } catch (error) {
        await handleError(connection, error, res, 'KDK 복식 게임 테이블 생성 중 오류가 발생했습니다.');
    } finally {
        connection.release();
    }
}

/**
 * 토너먼트 라운드 수 계산
 */
function calculateTotalRounds(numberOfParticipants) {
    if (numberOfParticipants <= 1) return 1;
    return Math.ceil(Math.log2(numberOfParticipants));
}

/**
 * 토너먼트 단식 게임 테이블 생성
 */
export async function createSingleTournament(req, res) {
    const connection = await pool.getConnection();
    try {
        const { scheduleId } = req.body;

        if (!scheduleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'scheduleId가 필요합니다.' 
            });
        }

        await connection.beginTransaction();

        const members = await getMembers(scheduleId, connection);
        if (members.length < 2) {
            await connection.rollback();
            return res.status(400).json({ 
                success: false, 
                message: '토너먼트는 최소 2명이 필요합니다.' 
            });
        }

        const totalRounds = calculateTotalRounds(members.length);
        const tournamentTables = [];

        // 각 라운드별 게임 테이블 생성
        for (let round = 1; round <= totalRounds; round++) {
            const currentRoundParticipants = Math.pow(2, totalRounds - round + 1);
            const gamesInRound = currentRoundParticipants / 2;

            for (let game = 1; game <= gamesInRound; game++) {
                const tableId = (round * 1000) + game;
                
                if (round === 1) {
                    // 첫 라운드: 실제 참가자 배치
                    const player1Index = (game - 1) * 2;
                    const player2Index = player1Index + 1;
                    
                    const player1 = members[player1Index] || null;
                    const player2 = members[player2Index] || null;
                    
                    // 부전승 처리: 상대가 없거나 상대가 부전승인 경우
                    const isWalkOver = !player2 || player2.isWalkOver;
                    
                    tournamentTables.push([
                        tableId,
                        scheduleId,
                        player1?.uid || null,
                        player2?.uid || null,
                        isWalkOver ? (player1?.isWalkOver ? null : 0) : 0,
                        isWalkOver ? (player2?.isWalkOver ? null : 0) : 0,
                        isWalkOver
                    ]);
                } else {
                    // 다음 라운드: 빈 테이블 (승자가 나중에 채워짐)
                    tournamentTables.push([
                        tableId,
                        scheduleId,
                        null,  // player1_0
                        null,  // player2_0
                        0,     // score1
                        0,     // score2
                        false  // walkOver
                    ]);
                }
            }
        }

        const insertQuery = `
            INSERT INTO gameTable (tableId, scheduleId, player1_0, player2_0, score1, score2, walkOver) 
            VALUES ?
        `;
        
        await connection.query(insertQuery, [tournamentTables]);
        await updateScheduleState(scheduleId, 3, connection);
        await connection.commit();

        broadcastGameUpdate(scheduleId);
        res.status(200).json({ 
            success: true, 
            message: '토너먼트 단식 게임 테이블이 생성되었습니다.',
            rounds: totalRounds,
            totalGames: tournamentTables.length
        });

    } catch (error) {
        await handleError(connection, error, res, '토너먼트 단식 게임 테이블 생성 중 오류가 발생했습니다.');
    } finally {
        connection.release();
    }
}

/**
 * 멤버를 팀으로 그룹화 (isWalkOver 고려)
 */
function groupMembersIntoTeams(members) {
    const teamGroups = new Map();
    
    for (const member of members) {
        if (!member.teamName) continue;
        
        if (!teamGroups.has(member.teamName)) {
            teamGroups.set(member.teamName, []);
        }
        teamGroups.get(member.teamName).push(member);
    }
    
    const teams = [];
    for (const [teamName, teamMembers] of teamGroups) {
        if (teamMembers.length > 0) {
            // 팀 내 멤버들을 memberIndex로 정렬
            teamMembers.sort((a, b) => (a.memberIndex || 0) - (b.memberIndex || 0));
            
            teams.push({
                teamName,
                memberIndex: teamMembers[0].memberIndex || 0,
                members: teamMembers,
                isWalkOver: teamMembers.every(member => member.isWalkOver)
            });
        }
    }
    
    // 팀들을 memberIndex로 정렬
    teams.sort((a, b) => a.memberIndex - b.memberIndex);
    return teams;
}

/**
 * 토너먼트 복식 게임 테이블 생성
 */
export async function createDoubleTournament(req, res) {
    const connection = await pool.getConnection();
    try {
        const { scheduleId } = req.body;

        if (!scheduleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'scheduleId가 필요합니다.' 
            });
        }

        await connection.beginTransaction();

        const members = await getMembers(scheduleId, connection);
        const teams = groupMembersIntoTeams(members);

        if (teams.length < 2) {
            await connection.rollback();
            return res.status(400).json({ 
                success: false, 
                message: '토너먼트 복식은 최소 2팀이 필요합니다.' 
            });
        }

        const totalRounds = calculateTotalRounds(teams.length);
        const tournamentTables = [];

        // 각 라운드별 게임 테이블 생성
        for (let round = 1; round <= totalRounds; round++) {
            const currentRoundTeams = Math.pow(2, totalRounds - round + 1);
            const gamesInRound = currentRoundTeams / 2;

            for (let game = 1; game <= gamesInRound; game++) {
                const tableId = (round * 1000) + game;
                
                if (round === 1) {
                    // 첫 라운드: 실제 팀 배치
                    const team1Index = (game - 1) * 2;
                    const team2Index = team1Index + 1;
                    
                    const team1 = teams[team1Index] || null;
                    const team2 = teams[team2Index] || null;
                    
                    // 부전승 처리: 상대팀이 없거나 상대팀이 부전승인 경우
                    const isWalkOver = !team2 || team2.isWalkOver;
                    
                    const team1Member1 = team1?.members[0] || null;
                    const team1Member2 = team1?.members[1] || null;
                    const team2Member1 = team2?.members[0] || null;
                    const team2Member2 = team2?.members[1] || null;
                    
                    tournamentTables.push([
                        tableId,
                        scheduleId,
                        team1Member1?.uid || null,  // player1_0
                        team1Member2?.uid || null,  // player1_1
                        team2Member1?.uid || null,  // player2_0
                        team2Member2?.uid || null,  // player2_1
                        isWalkOver ? (team1?.isWalkOver ? null : 0) : 0,  // score1
                        isWalkOver ? (team2?.isWalkOver ? null : 0) : 0,  // score2
                        isWalkOver
                    ]);
                } else {
                    // 다음 라운드: 빈 테이블
                    tournamentTables.push([
                        tableId,
                        scheduleId,
                        null,  // player1_0
                        null,  // player1_1
                        null,  // player2_0
                        null,  // player2_1
                        0,     // score1
                        0,     // score2
                        false  // walkOver
                    ]);
                }
            }
        }

        const insertQuery = `
            INSERT INTO gameTable (tableId, scheduleId, player1_0, player1_1, player2_0, player2_1, score1, score2, walkOver) 
            VALUES ?
        `;
        
        await connection.query(insertQuery, [tournamentTables]);
        await updateScheduleState(scheduleId, 3, connection);
        await connection.commit();

        broadcastGameUpdate(scheduleId);
        res.status(200).json({ 
            success: true, 
            message: '토너먼트 복식 게임 테이블이 생성되었습니다.',
            teams: teams.length,
            rounds: totalRounds,
            totalGames: tournamentTables.length
        });

    } catch (error) {
        await handleError(connection, error, res, '토너먼트 복식 게임 테이블 생성 중 오류가 발생했습니다.');
    } finally {
        connection.release();
    }
}