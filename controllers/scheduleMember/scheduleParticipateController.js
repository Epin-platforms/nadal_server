import pool from "../../config/database.js";
import { createNotification } from "../notification/notificationController.js";

export async function participationSchedule(req, res) {
  const conn = await pool.getConnection();
  
  try {
      const { uid } = req.user;
      const { scheduleId } = req.body;
      
      // 트랜잭션 시작을 더 일찍
      await conn.beginTransaction();
      
      // 1. 사용자 성별 정보 가져오기 (보안)
      const [users] = await conn.query('SELECT gender FROM user WHERE uid = ?', [uid]);
      if (users.length === 0) {
          return res.status(404).send({ error: '사용자를 찾을 수 없습니다.' });
      }
      const userGender = users[0].gender;
      
      // 2. 중복 참가 체크
      const [existing] = await conn.query(
          'SELECT 1 FROM scheduleMember WHERE uid = ? AND scheduleId = ?', 
          [uid, scheduleId]
      );
      if (existing.length > 0) {
          return res.status(400).send({ error: '이미 참가한 스케줄입니다.' });
      }
      
      // 3. 스케줄 상태 및 인원 체크 (WHERE 조건 수정)
      const firstQuery = `
          SELECT 
              s.state,
              s.isKDK,
              s.isSingle,
              s.useGenderLimit,
              s.maleLimit,
              s.femaleLimit,
              (SELECT COUNT(*) FROM scheduleMember sm INNER JOIN user u ON sm.uid = u.uid 
               WHERE sm.scheduleId = s.scheduleId AND u.gender = 'M') AS maleCount,
              (SELECT COUNT(*) FROM scheduleMember sm INNER JOIN user u ON sm.uid = u.uid 
               WHERE sm.scheduleId = s.scheduleId AND u.gender = 'F') AS femaleCount,
              (SELECT COUNT(*) FROM scheduleMember sm WHERE sm.scheduleId = s.scheduleId) AS totalCount
          FROM schedule s
          WHERE s.scheduleId = ? AND (s.state = 0 OR s.state IS NULL)
      `;
      
      const [schedules] = await conn.query(firstQuery, [scheduleId]);
      
      if (schedules.length === 0) {
          return res.status(401).send({ error: '이미 게임이 시작했거나 존재하지 않는 스케줄입니다.' });
      }
      
      const checkResult = schedules[0];
      
      // 4. 성별 제한 검사 (사용자 실제 성별 사용)
      if (userGender === 'M' && checkResult.useGenderLimit === 1) {
          if (checkResult.maleCount >= checkResult.maleLimit) {
              return res.status(400).send({ error: '남자 인원이 다 찼습니다.' });
          }
      }
      if (userGender === 'F' && checkResult.useGenderLimit === 1) {
          if (checkResult.femaleCount >= checkResult.femaleLimit) {
              return res.status(400).send({ error: '여자 인원이 다 찼습니다.' });
          }
      }
      
      // 5. 총 인원 제한 검사
      if (checkResult.isKDK === 1) {
          const maxLimit = checkResult.isSingle === 1 ? 13 : 16;
          if (checkResult.totalCount >= maxLimit) {
              return res.status(400).send({ error: '게임 인원이 다 찼습니다.' });
          }
      }
      
      // 6. 참가자 추가
      const insertMember = `
          INSERT INTO scheduleMember (uid, scheduleId)
          VALUES (?, ?);
      `;
      
      await conn.query(insertMember, [uid, scheduleId]);
      
      await conn.commit();
      res.send({ message: '참가가 완료되었습니다.' });
      
  } catch (error) {
      console.error('스케줄 참가 오류', error);
      if (conn) await conn.rollback();
      res.status(500).send({ error: '서버 오류가 발생했습니다.' });
  } finally {
      if (conn) conn.release();
  }
}
  

// 참가 취소 (단독 신청 취소)
export async function cancelScheduleParticipation(req, res) {
    try {    
      const { uid } = req.user;
      const { scheduleId } = req.params;
    
      const [rows] = await pool.query(`SELECT state FROM schedule WHERE scheduleId = ? AND (state = 0 OR state is NULL)`, [scheduleId]);

      if(rows.length == 0){
        return res.status(404).send();
      }

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
      
      const [rows] = await pool.query(`SELECT state FROM schedule WHERE scheduleId = ? AND state = 0`, [scheduleId]);

      if(rows.length == 0){
        return res.status(404).send();
      }


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

      //상대방에게 푸시메시지 보내기
      const [target] = await pool.query(`SELECT s.title, r.roomName FROM schedule s LEFT JOIN room r ON s.roomId = r.roomId WHERE s.scheduleId = ?`, [scheduleId]);
      
      if(target.length > 0){ //타겟이 있을때만
        const data = target[0];
        await createNotification(otherUid, `${data.title} 일정에 팀으로 참가됐어요`, `${data.roomName}방에서 지금 확인해보세요`, `/schedule/${scheduleId}`);
      }

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

  