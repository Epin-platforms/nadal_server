import pool from "../../config/database.js";

export async function participationSchedule(req, res) {
    const conn = await pool.getConnection();
  
    try {
      const { uid } = req.user;
      const { scheduleId, gender } = req.body;
  
      const firstQuery = `
        SELECT 
            s.state,
            s.isKDK,
            s.isSingle,
            s.maleLimit,
            s.femaleLimit,
            (SELECT COUNT(*) FROM scheduleMember sm INNER JOIN user u ON sm.uid = u.uid WHERE sm.scheduleId = s.scheduleId AND u.gender = 'M') AS maleCount,
            (SELECT COUNT(*) FROM scheduleMember sm INNER JOIN user u ON sm.uid = u.uid WHERE sm.scheduleId = s.scheduleId AND u.gender = 'F') AS femaleCount,
            (SELECT COUNT(*) FROM scheduleMember sm WHERE sm.scheduleId = s.scheduleId) AS totalCount
        FROM schedule s
        WHERE s.scheduleId = ? AND s.state = 0
        `;

      const [schedules] = await conn.query(firstQuery, [scheduleId]);
  
      if (schedules.length === 0) {
        return res.status(401).send({ error: '이미 게임이 시작했습니다.' });
      }
  
      const checkResult = schedules[0];
  
      // 성별 제한 검사
      if (gender === 'M' && checkResult.maleLimit != null) {
        if (checkResult.maleCount >= checkResult.maleLimit) {
          return res.status(401).send({ error: '남자 인원이 다 찼습니다.' });
        }
      }
      if (gender === 'F' && checkResult.femaleLimit != null) {
        if (checkResult.femaleCount >= checkResult.femaleLimit) {
          return res.status(401).send({ error: '여자 인원이 다 찼습니다.' });
        }
      }
  
      // 총 인원 제한 검사
      if (checkResult.isKDK == 1) {
        const maxLimit = checkResult.isSingle == 1 ? 13 : 16;
        if (checkResult.totalCount >= maxLimit) {
          return res.status(401).send({ error: '게임 인원이 다 찼습니다.' });
        }
      }
  
      // 여기서 트랜잭션 시작
      await conn.beginTransaction();
  
      const insertMember = `
        INSERT INTO scheduleMember (uid, scheduleId)
        VALUES (?, ?);
      `;
  
      await conn.query(insertMember, [uid, scheduleId]);
  
      await conn.commit();
      res.send();
  
    } catch (error) {
      console.error('스케줄 참가 오류', error);
      if (conn) await conn.rollback();
      res.status(500).send();
    } finally {
      if (conn) conn.release();
    }
  }
  

// 참가 취소 (단독 신청 취소)
export async function cancelScheduleParticipation(req, res) {
    try {
      const { uid } = req.user;
      const { scheduleId } = req.params;
  
      const q = `
        DELETE FROM scheduleMember 
        WHERE scheduleId = ? AND uid = ?;
      `;
  
      await pool.query(q, [scheduleId, uid]);
      res.sendStatus(200).send();
    } catch (error) {
      console.error('참가 취소 실패:', error);
      res.status(500).send();
    }
  }
  

  export async function participationScheduleWithTeam(req, res) {
    const conn = await pool.getConnection();
    try{
      const {uid} = req.user;
      const {scheduleId,  teamId} = req.body;
      
      await conn.beginTransaction();

      //팀불러오기
      const [teams] = await conn.query(`SELECT * FROM team WHERE teamId = ?`, [teamId]);
      const team = teams[0];
    
      const otherUid = team.uid1 == uid ? team.uid2 : team.uid1;
      
      //사용자가 있는지 체크
      const [existing] = await conn.query(
        `SELECT uid FROM scheduleMember WHERE scheduleId = ? AND uid IN (?, ?)`,
        [scheduleId, uid, otherUid]
      );

      if(existing.length > 0){
        await conn.commit();
        return res.status(204).send();
      }


      await conn.query(
        `INSERT INTO scheduleMember (scheduleId, uid, teamName) VALUES (?, ?, ?), (?, ?, ?)`,
        [
          scheduleId, uid, team.teamName,
          scheduleId, otherUid, team.teamName
        ]
      );
      
      await conn.commit();
      res.send();
    }catch(error){
      await conn.rollback();
      console.error('팀 참가 실패:', error);
      res.status(500).send();
    }finally{
      conn.release();
    }
  }


// 참가 취소 (팀단위 참가 취소)
export async function cancelScheduleParticipationTeam(req, res) {
  try {
    const { uid } = req.user;
    const { scheduleId } = req.params;

    const [teamRows] = await pool.query(`
          SELECT sm.uid
        FROM scheduleMember sm
        JOIN (
            SELECT teamName
            FROM scheduleMember
            WHERE scheduleId = ? AND uid = ?
        ) AS myTeam ON sm.teamName = myTeam.teamName
        WHERE sm.scheduleId = ?;
       `, [scheduleId, uid, scheduleId]);



    const q = `
      DELETE FROM scheduleMember 
      WHERE scheduleId = ? AND uid = ?;
    `;

    for (const row of teamRows) {
      await pool.query(q, [scheduleId, row.uid]);
    }

    res.sendStatus(200).send();
  } catch (error) {
    console.error('참가 취소 실패:', error);
    res.status(500).send();
  }
}

  