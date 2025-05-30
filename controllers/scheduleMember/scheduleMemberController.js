import pool from '../../config/database.js';

//스케줄에서 멤버만 업데이트
export async function getOnlyScheduleMembersForUpdate(req, res) {
    try{
        const scheduleId = Number(req.params.scheduleId);
        const useNickname = req.query.useNickname === '1'; // 또는 === 'true'


        const userSelectFields = useNickname  ? 
        `u.nickName, u.profileImage`
              :  `u.name, u.gender, u.birthYear, u.profileImage`;
  
  
        // 스케줄 멤버 데이터
        const [memberRows] = await pool.query(`
            SELECT sm.*, ${userSelectFields}
            FROM scheduleMember sm
            LEFT JOIN user u ON sm.uid = u.uid
            WHERE sm.scheduleId = ?;
        `, [scheduleId]);

      
        res.json(memberRows);
    }catch(error){
        console.error(error);
        res.status(500).send(); 
    }
}





//불참하기
export async function deleteScheduleMember(req, res){
    try {
        const {uid, scheduleId} = req.body;
            const q = `
            DELETE FROM scheduleMember
            WHERE uid = ? AND scheduleId = ?;
        `;

        await pool.query(q, [uid, scheduleId]);
        res.send();
    } catch (error) {
        console.error(error);
        res.status(500).send(); 
    }
}

//방 참가/불참
export async function updateScheduleMember(req, res) {
    const conn = await pool.getConnection();
  
    try {
      const { scheduleId, uid, approval, gender } = req.body;
  
      if (!scheduleId || !uid || approval === undefined) {
        return res.status(400).json({ error: '필수 값이 누락되었습니다.' });
      }
  
      // 승인일 경우: 인원 체크
      if (approval === true) {
        const possible = await checkParticipationAble(scheduleId, gender);
  
        if (!possible) {
          return res.status(409).json({ error: '참가 가능 인원을 초과했습니다.' });
        }
      }
  
      await conn.beginTransaction();
  
      const updateQuery = `
        UPDATE scheduleMember
        SET approval = ?
        WHERE scheduleId = ? AND uid = ?;
      `;
  
      const [result] = await conn.query(updateQuery, [approval, scheduleId, uid]);
  
      if (result.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({ error: '대상이 존재하지 않습니다.' });
      }
  
      await conn.commit();
      res.send();
  
    } catch (error) {
      console.error('참가자 승인/거절 처리 실패:', error);
      if (conn) await conn.rollback();
      res.status(500).send();
    } finally {
      if (conn) await conn.release();
    }
}
  

//방참가 체그
async function checkParticipationAble(scheduleId, gender) {
    const [rows] = await pool.query(`
      SELECT
        s.isKDK,
        s.isSingle,
        s.maleLimit,
        s.femaleLimit,
        (
          SELECT COUNT(*)
          FROM scheduleMember sm
          WHERE sm.scheduleId = s.scheduleId AND sm.approval = 1
        ) AS totalCount,
        (
          SELECT COUNT(*)
          FROM scheduleMember sm
          INNER JOIN user u ON sm.uid = u.uid
          WHERE sm.scheduleId = s.scheduleId AND sm.approval = 1 AND u.gender = 'M'
        ) AS maleCount,
        (
          SELECT COUNT(*)
          FROM scheduleMember sm
          INNER JOIN user u ON sm.uid = u.uid
          WHERE sm.scheduleId = s.scheduleId AND sm.approval = 1 AND u.gender = 'F'
        ) AS femaleCount
      FROM schedule s
      WHERE s.scheduleId = ?;
    `, [scheduleId]);
  
    const schedule = rows[0];
    if (!schedule) return false;
  
    // 전체 인원 제한 체크 (게임 방식에 따라)
    if (schedule.isKDK === 1) {
      const limit = schedule.isSingle === 1 ? 13 : 16;
      if (schedule.totalCount >= limit) {
        return false;
      }
    }
  
    // 성별 인원 제한 체크
    if (gender === 'M' && schedule.maleLimit !== null) {
      if (schedule.maleCount >= schedule.maleLimit) return false;
    }
  
    if (gender === 'F' && schedule.femaleLimit !== null) {
      if (schedule.femaleCount >= schedule.femaleLimit) return false;
    }
  
    return true;
  }
  



//방 인원 불러오기
export async function getScheduleMembers(req, res){
    try {
        const {scheduleId} = req.params;
        const q = `
            SELECT sm.* , u.name, u.birthYear, CAST(u.level AS DOUBLE) as level, u.affiliation, u.profileImage, u.career, u.verification, u.gender, u.nickName, r.roomName, r.local as roomLocal
            FROM scheduleMember sm
            LEFT JOIN user u ON sm.uid = u.uid
            LEFT JOIN room r ON u.affiliation = r.roomId
            WHERE sm.scheduleId = ?;
        `;

        const [rows] = await pool.query(q, [scheduleId]);
        res.json(rows);
    } catch (error) {
        console.error('스케줄 참가 인원 쿼리 에러 :', error);
        res.status(500).send();
    }
}


///스케줄 참여시 팀으로 넣기 (성별 무시)
export async function insertTeam(req, res){
    try{
        const me  = req.body.me;
        const you = req.body.you;
        const teamName = req.body.teamName;
        const scheduleId = req.body.scheduleId;

        const teamNameDuple = await checkTeamName(teamName, scheduleId);

        if(teamNameDuple == true){
            return res.status(501).send();
        }

        const memberDuple =  await checkMember(you, scheduleId);

        if(memberDuple == true){
            return res.status(502).send();
        }


        const q = `
            INSERT INTO scheduleMember (uid, scheduleId, teamName)
            VALUES(?, ?, ?);
        `;

        await pool.query(q, [me, scheduleId, teamName]);
        await pool.query(q, [you, scheduleId, teamName]);
        
        res.send();
    }catch(error){
        console.error(error);
        res.status(500).send();
    }
}

//중복된 팀명이 있는지 확인하는 함수
export async function checkTeamName(teamName, scheduleId){
    const q = `
        SELECT teamName FROM scheduleMember
        WHERE teamName = ? AND scheduleId = ?;
    `;

    const [rows] = await pool.query(q, [teamName, scheduleId]);

    if(rows.length == 0){
        return false;
    }

    return true;
}

//특정 멤버가 특정 일정에 참여중인지 확인 하는 함수
export async function checkMember(uid, scheduleId){
    const q = `
        SELECT uid FROM scheduleMember
        WHERE scheduleId = ? AND uid = ?;
    `;

    const [rows] = await pool.query(q, [scheduleId, uid]);

    if(rows.length == 0){
        return false;
    }
    return true;
}


//게임 시작 알고리즘
export async function startGameInitial(req, res) {
    const scheduleId = req.body.scheduleId;
    const teamList = req.body.teamList;
    const isTournament = req.body.isTournament;

    // 트랜잭션을 위해 개별 연결 가져오기
    const connection = await pool.getConnection();
    try {
        // 트랜잭션 시작
        await connection.beginTransaction();

        // 거절된 멤버 삭제
        const deleteQuery = `
            DELETE FROM scheduleMember
            WHERE approval = 0 AND scheduleId = ?;
        `;
        await connection.query(deleteQuery, [scheduleId]);

        // 남아 있는 멤버 가져오기
        let members;
        if (teamList == null) {
            // teamList가 없으면 모든 scheduleMember 조회
            const selectQuery = `
                SELECT * FROM scheduleMember
                WHERE scheduleId = ?;
            `;
            [members] = await connection.query(selectQuery, [scheduleId]);
        } else {
            // teamList가 있으면 해당 팀 이름을 가진 멤버만 조회
            const selectQuery = `
                SELECT * FROM scheduleMember
                WHERE scheduleId = ? AND teamName IN (?);
            `;
            [members] = await connection.query(selectQuery, [scheduleId, teamList]);
        }

        if (teamList) {
                // 1. teamList가 있는 경우: 2명씩 팀이 되어 동일한 memberIndex를 할당하며 팀 간에는 랜덤 인덱스
            const teams = members.reduce((acc, member) => {
                if (!acc[member.teamName]) {
                    acc[member.teamName] = [];
                }
                acc[member.teamName].push(member);
                return acc;
            }, {});

            // 팀 수에 맞게 랜덤한 인덱스 생성
            const teamCount = Object.keys(teams).length;
            const nextPowerOfTwo = Math.pow(2, Math.ceil(Math.log2(teamCount))); // 가장 가까운 2^n
            const randomIndexes = generateCloseRandomIndexes(nextPowerOfTwo); // 커스텀 함수로 간격 2 미만의 랜덤 인덱스 생성

            // 각 팀에 랜덤 인덱스를 부여하여 업데이트
            let index = 0;
            for (const teamName in teams) {
                const teamMembers = teams[teamName];
                const teamIndex = randomIndexes[index]; // 랜덤하게 할당된 인덱스 사용
                index++;

                for (const member of teamMembers) {
                    await connection.query(
                        'UPDATE scheduleMember SET memberIndex = ? WHERE scheduleId = ? AND uid = ?',
                        [teamIndex, scheduleId, member.uid]
                    );
                }
            }

        } else if (!isTournament) {
           // 2. teamList가 없고 isTournament가 false인 경우: 1명당 1개의 랜덤하게 섞인 memberIndex 할당
            const memberIndexes = Array.from({ length: members.length }, (_, i) => i + 1);
            memberIndexes.sort(() => Math.random() - 0.5); // 인덱스를 무작위로 섞기

            for (let i = 0; i < members.length; i++) {
                const member = members[i];
                const randomIndex = memberIndexes[i];
                await connection.query(
                    'UPDATE scheduleMember SET memberIndex = ? WHERE scheduleId = ? AND uid = ?',
                    [randomIndex, scheduleId, member.uid]
                );
            }
        } else {
            // 3. teamList가 없고 isTournament가 true인 경우: 가장 가까운 2^n만큼의 랜덤 인덱스 생성
            const memberCount = members.length;
            const nextPowerOfTwo = Math.pow(2, Math.ceil(Math.log2(memberCount))); // 가장 가까운 2^n
            const randomIndexes = generateCloseRandomIndexes(nextPowerOfTwo); // 커스텀 함수로 간격 2 미만의 랜덤 인덱스 생성

            for (let i = 0; i < members.length; i++) {
                const member = members[i];
                await connection.query(
                    'UPDATE scheduleMember SET memberIndex = ? WHERE scheduleId = ? AND uid = ?',
                    [randomIndexes[i], scheduleId, member.uid]
                );
            }
        }

        // 트랜잭션 커밋
        await connection.commit();

        // 소켓으로 업데이트 알림
        const io = getSocket();
        io.to(scheduleId).emit('refreshMember');

        res.send();
    } catch (error) {
        console.error('멤버 초기화 중 오류 발생:', error);
        
        // 트랜잭션 롤백
        await connection.rollback();
        
        res.status(500).send();
    } finally {
        // 연결 해제
        connection.release();
    }
}

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



// 순서 변경 후 오픈
export async function openIndex(req, res) {
    try {
        const { scheduleId } = req.params;
        const members = req.body; // req.body 전체를 members로 받음

        const q = `
            UPDATE scheduleMember
            SET memberIndex = ?
            WHERE scheduleId = ? AND uid = ?
        `;

        for (let i = 0; i < members.length; i++) {
            const member = members[i];
            await pool.query(q, [member.memberIndex, scheduleId, member.uid]);
        }

        const io = getSocket();
        io.to(scheduleId).emit('refreshMember');
        res.send();
    } catch (error) {
        console.error('오류 발생:', error);
        res.status(500).send();
    }
}

//팀인덱스
export async function openTeamIndex(req, res) {
    try {
        const scheduleId = req.params.scheduleId;
        const teams = req.body;

        for (const team of teams) {
            const { teamName, memberIndex } = team;

            const q = `
                UPDATE scheduleMember
                SET memberIndex = ?
                WHERE scheduleId = ? AND teamName = ?
            `;

            await pool.query(q, [memberIndex, scheduleId, teamName]);
        }

        const io = getSocket();
        io.to(scheduleId).emit('refreshMember');

        res.send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}


///팀 단위 수락 거절
export async function updateTeam(req, res){
    try {
        const scheduleId = req.body.scheduleId;
        const teamName = req.body.teamName;
        const approval = req.body.approval;

        const q = `
            UPDATE scheduleMember
            SET approval = ?
            WHERE teamName = ? AND scheduleId = ?;
        `;

        await pool.query(q, [approval, teamName, scheduleId]);

        res.send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}


///팀 단위 삭제
export async function deleteTeam(req, res){
    try {
        const scheduleId = req.body.scheduleId;
        const teamName = req.body.teamName;

        const q =`
            DELETE FROM scheduleMember
            WHERE teamName = ? AND scheduleId = ?;
        `;

        await pool.query(q, [teamName, scheduleId]);
    
        res.send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}
