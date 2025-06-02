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

        // 승인된 실제 멤버 조회
        const [members] = await connection.query(
            `SELECT * FROM scheduleMember WHERE scheduleId = ? AND approval = 1;`,
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
        console.error('게임시작 에러가 발생함', error);
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

//인덱싱
function generateCloseRandomIndexes(count) {
    // 1부터 count까지의 연속된 숫자를 배열로 생성
    let indexes = Array.from({ length: count }, (_, i) => i + 1);

    // 배열을 섞으면서 동시에 인접한 숫자들의 간격을 1로 유지
    for (let i = indexes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        
        // swap
        [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
    }

    // 간격을 확인하고, 간격이 2 이상 차이나는 경우 수정
    for (let i = 1; i < indexes.length; i++) {
        if (Math.abs(indexes[i] - indexes[i - 1]) > 1) {
            // 서로 간격이 1이 되도록 조정
            [indexes[i], indexes[i - 1]] = [indexes[i - 1], indexes[i]];
        }
    }

    return indexes;
}

// 싱글 토너먼트 셔플 및 부전승 포함 처리
async function setTournamentSingleWithWalkoverShuffle(members, scheduleId, connection) {
    const memberCount = members.length;
    const nextPowerOfTwo = Math.pow(2, Math.ceil(Math.log2(memberCount)));
    const memberIndexList = generateCloseRandomIndexes(nextPowerOfTwo);

    // 인덱스 부여
    for (let i = 0; i < members.length; i++) {
        const member = members[i];
        await connection.query(
            'UPDATE scheduleMember SET memberIndex = ? WHERE scheduleId = ? AND uid = ?',
            [memberIndexList[i], scheduleId, member.uid]
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

    //팀수에 맞게 랜덤 인덱싱
    const teamList = Object.keys(teams);
    const teamCount = teamList.length;
    const nextPowerOfTwo = Math.pow(2, Math.ceil(Math.log2(teamCount)));
    const teamIndexList = generateCloseRandomIndexes(nextPowerOfTwo); // 커스텀 함수로 간격 2 미만의 랜덤 인덱스 생성

    let index = 0;
    for (const teamName in teams) {
        const teamMembers = teams[teamName];
        const teamIndex = teamIndexList[index]; // 랜덤하게 할당된 인덱스 사용
        index++;

        for (const member of teamMembers) {
            await connection.query(
                'UPDATE scheduleMember SET memberIndex = ? WHERE scheduleId = ? AND uid = ?',
                [teamIndex, scheduleId, member.uid]
            );
        }
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
    
    // 승인된 멤버 수 확인
    const [memberCount] = await connection.query(
        'SELECT COUNT(*) as count FROM scheduleMember WHERE scheduleId = ? AND approval = 1',
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
                'SELECT COUNT(DISTINCT teamName) as count FROM scheduleMember WHERE scheduleId = ? AND approval = 1',
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