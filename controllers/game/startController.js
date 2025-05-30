import pool from '../../config/database.js';
import { getSocket } from '../../socket/websocket.js';
import { sendNotificationToGameMembers } from './gameNotificationController.js';
import { singleKdkRules, doubleKdkRules } from '../../config/gameTable.js';

//게임 시작 알고리즘
// 게임 시작 핸들러
export async function startGameSet(req, res) {
    const scheduleId = Number(req.params.scheduleId);
    const connection = await pool.getConnection();

    try {
        // 게임 시작 전 유효성 검사
        const validation = await validateGameSetup(scheduleId, connection);
        const game = validation.schedule;

        // 트랜잭션 시작
        await connection.beginTransaction();

        // 승인되지 않은 참가자 삭제
        await connection.query(
            `DELETE FROM scheduleMember WHERE approval = 0 AND scheduleId = ?;`,
            [scheduleId]
        );

        // 승인된 실제 멤버 조회 (부전승 제외)
        const [members] = await connection.query(
            `SELECT * FROM scheduleMember WHERE scheduleId = ? AND approval = 1 AND (isWalkOver IS NULL OR isWalkOver = 0);`,
            [scheduleId]
        );

        // 게임 방식에 따라 분기 처리
        if (game.isKDK == 1) {
            await setMemberKDK(members, scheduleId, connection);
        } else if (game.isSingle == 1) {
            await setTournamentSingleWithWalkoverShuffle(members, scheduleId, connection);
        } else {
            await setTournamentDoubleWithWalkoverShuffle(members, scheduleId, connection);
        }

        // 게임 상태 업데이트
        await updateScheduleState(scheduleId, 2, connection);

        // 트랜잭션 커밋
        await connection.commit();

        // 알림 및 소켓 브로드캐스트
        await sendNotificationToGameMembers(scheduleId, '일정 내 게임이 시작되었어요');
        const io = getSocket();
        io.to(`gameId:${scheduleId}`).emit('refreshMember');
        io.to(`gameId:${scheduleId}`).emit('changedState', { state: 2 });

        res.status(200).json({ success: true, message: '게임이 성공적으로 시작되었습니다.' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ success: false, message: '게임 시작 중 오류가 발생했습니다.', error: error.message });
    } finally {
        connection.release();
    }
}

// KDK인 경우 (기존 로직 유지)
async function setMemberKDK(members, scheduleId, connection) {
    const memberIndexes = Array.from({ length: members.length }, (_, i) => i + 1);
    const shuffledIndexes = shuffleArray(memberIndexes);

    for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const randomIndex = shuffledIndexes[i];
        await connection.query(
            'UPDATE scheduleMember SET memberIndex = ? WHERE scheduleId = ? AND uid = ?',
            [randomIndex, scheduleId, member.uid]
        );
    }
}

// 싱글 토너먼트 셔플 및 부전승 포함 처리
async function setTournamentSingleWithWalkoverShuffle(members, scheduleId, connection) {
    const memberCount = members.length;
    const nextPowerOfTwo = Math.pow(2, Math.ceil(Math.log2(memberCount)));
    const walkOverCount = nextPowerOfTwo - memberCount;

    // 필요한 경우 부전승 멤버 생성
    if (walkOverCount > 0) {
        await createWalkOverMembers(scheduleId, walkOverCount, connection);
    }

    // 전체 멤버 다시 조회
    const [allMembers] = await connection.query(
        'SELECT * FROM scheduleMember WHERE scheduleId = ? AND approval = 1',
        [scheduleId]
    );

    // 실제 멤버 / 부전승 멤버 분리 및 셔플
    const realMembers = allMembers.filter(m => !m.isWalkOver);
    const walkOverMembers = allMembers.filter(m => m.isWalkOver);
    const shuffledReal = shuffleArray(realMembers);
    const shuffledWalkOver = shuffleArray(walkOverMembers);

    // 부전승과 번갈아가며 배치
    let mergeList = [];
    for (let i = 0; i < shuffledReal.length; i++) {
        mergeList.push(shuffledReal[i]);
        if (shuffledWalkOver[i]) mergeList.push(shuffledWalkOver[i]);
    }
    if (shuffledWalkOver.length > shuffledReal.length) {
        mergeList = mergeList.concat(shuffledWalkOver.slice(shuffledReal.length));
    }

    // 인덱스 부여
    for (let i = 0; i < mergeList.length; i++) {
        await connection.query(
            'UPDATE scheduleMember SET memberIndex = ? WHERE scheduleId = ? AND uid IS ?',
            [i + 1, scheduleId, mergeList[i].uid]
        );
    }
}



// 복식 토너먼트 셔플 및 부전승 포함 처리
async function setTournamentDoubleWithWalkoverShuffle(members, scheduleId, connection) {
    // 팀별로 그룹
    const teams = members.reduce((acc, member) => {
        const teamName = member.teamName || `개인팀_${member.uid}`;
        if (!acc[teamName]) acc[teamName] = [];
        acc[teamName].push(member);
        return acc;
    }, {});

    const teamList = Object.entries(teams);
    const teamCount = teamList.length;
    const nextPowerOfTwo = Math.pow(2, Math.ceil(Math.log2(teamCount)));
    const walkOverCount = nextPowerOfTwo - teamCount;

    // 필요한 경우 부전승 팀 생성
    if (walkOverCount > 0) {
        await createWalkOverTeams(scheduleId, walkOverCount, connection);
    }

    // 전체 멤버 재조회 후 팀 재구성
    const [allMembers] = await connection.query(
        'SELECT * FROM scheduleMember WHERE scheduleId = ? AND approval = 1',
        [scheduleId]
    );

    const realTeams = {};
    const walkOverTeams = {};
    for (const member of allMembers) {
        const key = member.teamName || `개인팀_${member.uid}`;
        if (member.isWalkOver) {
            if (!walkOverTeams[key]) walkOverTeams[key] = [];
            walkOverTeams[key].push(member);
        } else {
            if (!realTeams[key]) realTeams[key] = [];
            realTeams[key].push(member);
        }
    }

    // 실제 팀 / 부전승 팀 셔플 후 번갈아 병합
    const shuffledReal = shuffleArray(Object.entries(realTeams));
    const shuffledWalkOver = shuffleArray(Object.entries(walkOverTeams));

    let mergedTeams = [];
    for (let i = 0; i < shuffledReal.length; i++) {
        mergedTeams.push(shuffledReal[i]);
        if (shuffledWalkOver[i]) mergedTeams.push(shuffledWalkOver[i]);
    }
    if (shuffledWalkOver.length > shuffledReal.length) {
        mergedTeams = mergedTeams.concat(shuffledWalkOver.slice(shuffledReal.length));
    }

    // 팀 단위로 memberIndex 부여
    for (let i = 0; i < mergedTeams.length; i++) {
        const [, teamMembers] = mergedTeams[i];
        for (const member of teamMembers) {
            await connection.query(
                'UPDATE scheduleMember SET memberIndex = ? WHERE scheduleId = ? AND uid IS ?',
                [i + 1, scheduleId, member.uid]
            );
        }
    }
}


// 부전승 멤버 생성 (싱글 토너먼트용)
async function createWalkOverMembers(scheduleId, walkOverCount, connection) {
    for (let i = 1; i <= walkOverCount; i++) {
        await connection.query(
            `INSERT INTO scheduleMember (scheduleId, uid, memberIndex, isWalkOver, approval) 
             VALUES (?, null, ?, 1, 1)`,
            [scheduleId, 0,] // memberIndex는 나중에 설정
        );
    }
}

// 부전승 팀 생성 (팀 토너먼트용)
async function createWalkOverTeams(scheduleId, walkOverTeamCount, connection) {
    for (let i = 1; i <= walkOverTeamCount; i++) {
        const teamName = `부전승팀${i}`;
        
        await connection.query(
            `INSERT INTO scheduleMember (scheduleId, uid, teamName, memberIndex, isWalkOver, approval) 
             VALUES (?, null, ?, ?, 1, 1)`,
            [scheduleId, teamName, 0]
        );
    }
}

// 배열 셔플 함수 (Fisher-Yates 알고리즘)
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// 스케줄 상태 업데이트
export async function updateScheduleState(scheduleId, state, connection) {
    const query = `
        UPDATE schedule
        SET state = ?
        WHERE scheduleId = ?;
    `;
    
    const [result] = await connection.query(query, [state, scheduleId]);
    
    if (result.affectedRows === 0) {
        throw new Error(`Schedule not found or not updated: scheduleId ${scheduleId}`);
    }
    
    console.log(`스케줄 상태 업데이트 완료: scheduleId ${scheduleId}, state ${state}`);
    return result;
}

// 사용자 순서 변경
export async function updateMemberIndex(req, res) {
    const connection = await pool.getConnection();
    try {
        const { scheduleId, ...members } = req.body;

        if (!scheduleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'scheduleId가 필요합니다.' 
            });
        }

        if (Object.keys(members).length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: '업데이트할 멤버 정보가 없습니다.' 
            });
        }

        await connection.beginTransaction();

        // 각 멤버의 인덱스 업데이트
        for (const uid in members) {
            const memberIndex = members[uid];
            
            // 유효성 검사
            if (typeof memberIndex !== 'number' || memberIndex < 1) {
                throw new Error(`Invalid memberIndex for uid ${uid}: ${memberIndex}`);
            }

            const [result] = await connection.query(
                'UPDATE scheduleMember SET memberIndex = ? WHERE scheduleId = ? AND uid = ?',
                [memberIndex, scheduleId, uid]
            );

            if (result.affectedRows === 0) {
                throw new Error(`Member not found or not updated: uid ${uid}`);
            }
        }

        await connection.commit();

        // 소켓 이벤트 발송
        const io = getSocket();
        io.to(`gameId:${scheduleId}`).emit('refreshMember');

        res.status(200).json({ 
            success: true, 
            message: '멤버 순서가 성공적으로 업데이트되었습니다.',
            updatedCount: Object.keys(members).length
        });
    } catch (error) {
        await connection.rollback();
        console.error('멤버 인덱스 업데이트 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '멤버 순서 업데이트 중 오류가 발생했습니다.',
            error: error.message 
        });
    } finally {
        connection.release();
    }
}

// 부전승 멤버 정리 (게임 종료 시 사용)
export async function cleanupWalkOverMembers(scheduleId, connection) {
    const deleteQuery = `
        DELETE FROM scheduleMember
        WHERE scheduleId = ? AND isWalkOver = 1;
    `;
    
    const [result] = await connection.query(deleteQuery, [scheduleId]);
    console.log(`부전승 멤버 정리 완료: ${result.affectedRows}명 삭제`);
    return result;
}

// KDK 규칙에서 최대 인원수 가져오기
function getMaxMembersFromKDKRules() {
    const singleMax = Object.keys(singleKdkRules).length > 0 
        ? Math.max(...Object.keys(singleKdkRules).map(Number)) 
        : 14; // 기본값
    
    const doubleMax = Object.keys(doubleKdkRules).length > 0 
        ? Math.max(...Object.keys(doubleKdkRules).map(Number)) 
        : 16; // 기본값
    
    return { singleMax, doubleMax };
}

// 게임 유효성 검사 (게임 시작 전 호출)
async function validateGameSetup(scheduleId, connection) {
    // 스케줄 존재 여부 및 상태 확인
    const [schedules] = await connection.query(
        'SELECT * FROM schedule WHERE scheduleId = ? AND state IN (0, 1)',
        [scheduleId]
    );
    
    if (schedules.length === 0) {
        throw new Error(`Schedule not found or already started: ${scheduleId}`);
    }
    
    const schedule = schedules[0];
    
    // 게임 타입 확인
    if (schedule.tag !== '게임') {
        throw new Error(`Not a game schedule: ${scheduleId}`);
    }
    
    // 승인된 멤버 수 확인 (부전승 제외)
    const [memberCount] = await connection.query(
        'SELECT COUNT(*) as count FROM scheduleMember WHERE scheduleId = ? AND approval = 1 AND (isWalkOver IS NULL OR isWalkOver = 0)',
        [scheduleId]
    );
    
    const count = memberCount[0].count;
    
    // 최소 참가자 수 확인
    if (count < 2) {
        throw new Error(`Insufficient members for game: ${count} (minimum 2 required)`);
    }
    
    // KDK 규칙에서 최대 인원수 가져오기
    const { singleMax, doubleMax } = getMaxMembersFromKDKRules();
    
    // 게임 타입별 최대 참가자 수 확인
    if (schedule.isKDK == 1) {
        // KDK 게임
        if (schedule.isSingle == 1) {
            // KDK 단식: JSON에서 가져온 최대값
            if (count > singleMax) {
                throw new Error(`Too many members for KDK single: ${count} (maximum ${singleMax} supported by rules)`);
            }
            
            // JSON에 해당 인원수 규칙이 있는지 확인
            if (!singleKdkRules[count.toString()]) {
                throw new Error(`No KDK single rules found for ${count} members. Supported: ${Object.keys(singleKdkRules).join(', ')}`);
            }
        } else {
            // KDK 복식: JSON에서 가져온 최대값
            if (count > doubleMax) {
                throw new Error(`Too many members for KDK double: ${count} (maximum ${doubleMax} supported by rules)`);
            }
            
            // JSON에 해당 인원수 규칙이 있는지 확인
            if (!doubleKdkRules[count.toString()]) {
                throw new Error(`No KDK double rules found for ${count} members. Supported: ${Object.keys(doubleKdkRules).join(', ')}`);
            }
        }
    } else {
        // 토너먼트 게임
        if (schedule.isSingle == 1) {
            // 토너먼트 단식: 최대 64명 (2^6)
            if (count > 64) {
                throw new Error(`Too many members for tournament single: ${count} (maximum 64)`);
            }
        } else {
            // 토너먼트 복식: 팀 수 확인
            const [teamCount] = await connection.query(
                'SELECT COUNT(DISTINCT teamName) as count FROM scheduleMember WHERE scheduleId = ? AND approval = 1 AND (isWalkOver IS NULL OR isWalkOver = 0)',
                [scheduleId]
            );
            
            const teams = teamCount[0].count;
            if (teams > 32) {
                throw new Error(`Too many teams for tournament double: ${teams} (maximum 32)`);
            }
            if (teams < 2) {
                throw new Error(`Insufficient teams for tournament double: ${teams} (minimum 2 required)`);
            }
        }
    }
    
    console.log(`게임 유효성 검사 통과: scheduleId ${scheduleId}, 참가자 ${count}명`);
    
    return {
        schedule: schedule,
        memberCount: count
    };
}