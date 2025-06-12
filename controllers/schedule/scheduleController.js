import pool from '../../config/database.js';

//사용자 스케줄 불러오기
export async function getSchedulesWithUid(req, res){
    try {
        const {uid} = req.user;
        const {from, to} = req.query;

        const q = `
            SELECT DISTINCT
                s.scheduleId,
                s.updateAt,
                s.tag,
                s.startDate,
                s.endDate,
                s.isAllDay,
                s.title,
                s.state,
                s.useParticipation,
                (
                    SELECT COUNT(*) 
                    FROM scheduleMember sm2 
                    WHERE sm2.scheduleId = s.scheduleId
                ) AS participationCount
            FROM schedule s
            LEFT JOIN scheduleMember sm ON s.scheduleId = sm.scheduleId
            WHERE 
                (s.uid = ? OR sm.uid = ?)
                AND s.startDate BETWEEN ? AND ?
            ORDER BY s.startDate ASC
        `;

        const [rows] = await pool.query(q, [uid, uid, from, to]);

        res.json(rows);
    } catch (error) {
        console.error('스케줄리스트 쿼리 에러 :', error);
        res.status(500).send();
    }
  }

//개인 특적 스케줄 업데이트
export async function getUpdateSchdule(req, res) {
    try {
        const scheduleId = Number(req.query.scheduleId);
        const updateAt = req.query.updateAt;
        const participationCount = Number(req.query.participationCount);


        const query = `SELECT 
                            s.scheduleId,
                            s.updateAt,
                            s.tag,
                            s.startDate,
                            s.endDate,
                            s.isAllDay,
                            s.title,
                            s.state,
                            s.useParticipation,
                            (
                                SELECT COUNT(*) 
                                FROM scheduleMember sm2 
                                WHERE sm2.scheduleId = s.scheduleId
                            ) AS participationCount
                        FROM schedule s
                        WHERE 
                            s.scheduleId = ?
                      ;`;

        const [rows] = await pool.query(query, [scheduleId]);

        if(rows.length === 0){ //없다면 삭제된 스케줄
          return res.status(202).send();
        }
        
        const schedule = rows[0];

        if(schedule.updateAt != updateAt){ //변경된 점이있다면
          return res.status(200).json(schedule);
        }else if(schedule.participationCount != participationCount){ //업데이트는 그대로인데 사용자 수만 변경?
          return res.status(203).send(schedule.participationCount);
        }

        res.status(201).send(); //변경된 점 없으면 201
    } catch (error) {
      console.error(`특정 사용자 스케줄 업데이트 오류${error}`);
      res.status(500).send();
    }
}

 
//방 ID를 통해 스케줄 불러오기
export async function getSchedulesWithRoomId(req, res) {
  try {
    const { roomId } = req.params;
    const { from, to } = req.query;

    const q = `
      SELECT 
        s.scheduleId,
        s.title,
        s.startDate,
        s.endDate,
        s.createAt,
        s.updateAt,
        s.tag,
        s.state,
        s.uid,

        -- useNickName이 true일 경우 nickName, false일 경우 name 반환
        CASE 
          WHEN r.useNickName = 0 THEN u.name
          ELSE u.nickName
        END AS displayName,

        -- profileImage는 항상 포함
        u.profileImage,

        -- useNickName이 false일 경우에만 포함되는 필드
        CASE 
          WHEN r.useNickName = 0 THEN u.gender
          ELSE NULL
        END AS gender,

        CASE 
          WHEN r.useNickName = 0 THEN u.birthYear
          ELSE NULL
        END AS birthYear,

        r.roomName,
        s.roomId,
        r.useNickName,
        COUNT(sm.scheduleId) AS scheduleMemberCount

      FROM schedule s
      LEFT JOIN user u ON s.uid = u.uid
      LEFT JOIN scheduleMember sm ON s.scheduleId = sm.scheduleId
      LEFT JOIN room r ON s.roomId = r.roomId

      WHERE s.roomId = ?
        AND s.startDate >= ?
        AND s.startDate <= ?

      GROUP BY s.scheduleId;
    `;

    const [rows] = await pool.query(q, [roomId, from, to]);
    res.json(rows);
  } catch (error) {
    console.error('스케줄리스트 (방정보) 쿼리에러', error);
    res.status(500).send();
  }
}

//방 특정 스케줄 상태 업데이트
export async function getUpdateRoomSchedule(req, res) {
  try {
      const scheduleId = Number(req.query.scheduleId);
      const updateAt = req.query.updateAt;
      const scheduleMemberCount = Number(req.query.scheduleMemberCount);

      const query = `
              SELECT 
              s.scheduleId,
              s.title,
              s.startDate,
              s.endDate,
              s.createAt,
              s.updateAt,
              s.tag,
              s.state,
              s.uid,

              -- useNickName이 true일 경우 nickName, false일 경우 name 반환
              CASE 
                WHEN r.useNickName = 0 THEN u.name
                ELSE u.nickName
              END AS displayName,

              -- profileImage는 항상 포함
              u.profileImage,

              -- useNickName이 false일 경우에만 포함되는 필드
              CASE 
                WHEN r.useNickName = 0 THEN u.gender
                ELSE NULL
              END AS gender,

              CASE 
                WHEN r.useNickName = 0 THEN u.birthYear
                ELSE NULL
              END AS birthYear,

              r.roomName,
              s.roomId,
              r.useNickName,
              COUNT(sm.scheduleId) AS scheduleMemberCount

            FROM schedule s
            LEFT JOIN user u ON s.uid = u.uid
            LEFT JOIN scheduleMember sm ON s.scheduleId = sm.scheduleId
            LEFT JOIN room r ON s.roomId = r.roomId

            WHERE s.scheduleId = ?;
      `;
      
      const [rows] = await pool.query(query, [scheduleId]);

      if(rows.length === 0){
        return res.status(202).send();
      }

      const schedule = rows[0];
      
      if(schedule.updateAt != updateAt){
        return res.json(schedule);
      }else if(schedule.scheduleMemberCount != scheduleMemberCount){
        return res.status(203).send(schedule.scheduleMemberCount);
      }

      res.status(201).send();
  } catch (error) {
    console.error('스케줄(방정보) 업데이트 쿼리에러', error);
    res.status(500).send();
  }
}

//디테일한 스케줄 불러오기 + 멤버 불러오기
export async function getScheduleWithScheduleId(req, res) {
    try {
      const { scheduleId } = req.params;
  
      // 본명 사용하는 방인지 확인
      const [roomRows] = await pool.query(`
                SELECT 
                CASE
                WHEN s.roomId IS NULL THEN 1
                WHEN r.useNickname = 1 THEN 1
                ELSE 0
                END AS useNickname
            FROM schedule s
            LEFT JOIN room r ON s.roomId = r.roomId  
            WHERE s.scheduleId = ?;
      `, [scheduleId]);
  
      const useRealName = roomRows.length > 0 && roomRows[0].useNickname != 1;
  
      // user 컬럼 다이나믹하게 설정
      const userSelectFields = useRealName 
        ? `u.name, u.gender, u.birthYear, u.profileImage`
        : `u.nickName, u.profileImage`;
  
      // 스케줄 데이터
      const [scheduleRows] = await pool.query(`
        SELECT s.*, r.roomName, r.isOpen, r.useNickname, ${userSelectFields}, a.account, a.accountName, a.bank
        FROM schedule s 
        LEFT JOIN user u ON s.uid = u.uid
        LEFT JOIN room r ON s.roomId = r.roomId
        LEFT JOIN account a ON s.accountId = a.accountId
        WHERE s.scheduleId = ?;
      `, [scheduleId]);
  
      const schedule = scheduleRows[0];
  
      // 스케줄 멤버 데이터
      const [memberRows] = await pool.query(`
        SELECT sm.*, ${userSelectFields}, r.roomName
        FROM scheduleMember sm
        LEFT JOIN user u ON sm.uid = u.uid
        LEFT JOIN room r ON u.affiliationId = r.roomId
        WHERE sm.scheduleId = ?;
      `, [scheduleId]);
  
      const members = memberRows;
  
      res.json({
        schedule: schedule,
        members: members,
      });
  
    } catch (error) {
      console.error('디테일 스케줄 쿼리 에러:', error);
      res.status(500).send();
    }
  }
  

  ///스케줄 업데이트
  export async function updateSchedule(req, res) {
    try {
      const { uid } = req.user;
      const { scheduleId, ...fields } = req.body;
  
      if (!scheduleId) {
        return res.status(400).send("Missing scheduleId");
      }
  
      // ⚠️ 주의 변경일 때: 참여자 있는지 검사
        const [members] = await pool.query(
          `SELECT uid FROM scheduleMember WHERE scheduleId = ?`,
          [scheduleId]
        );
  
        if (members.length > 0) {
          return res.status(409).send({ error: "참가자가 있는 상태에서 변경할 수 없는 내용이 있습니다" });
        }
    
  
      const keys = Object.keys(fields);
      if (keys.length === 0) {
        return res.status(400).send("No fields to update");
      }
  
      const setClause = keys.map(k => `${k} = ?`).join(', ');
      const values = keys.map(k => fields[k]);
  
      const q = `
        UPDATE schedule
        SET ${setClause}
        WHERE uid = ? AND scheduleId = ?
      `;
      values.push(uid, scheduleId);
  
      await pool.query(q, values);
      res.send(); // 200 OK
    } catch (error) {
      console.error(error);
      res.status(500).send("Server error");
    }
  }
  

//스케줄 삭제
export async function deleteSchedule(req, res){
    try {
        const scheduleId = Number(req.params.scheduleId);
        const q = `
            DELETE FROM schedule
            WHERE scheduleId = ?;
        `;

        await pool.query(q, [scheduleId]);
        res.send();
    } catch (error) { 
        console.error(error);
        res.status(500).send();
    }
}

