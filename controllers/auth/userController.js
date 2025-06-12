import pool from '../../config/database.js';
import { bucket } from '../../config/firebase.js';
import { updateImageType } from '../appController.js';
import { createNotification } from '../notification/notificationController.js';
import { createLog } from '../room/log/logController.js';

//클라이언트 프로필 업데이트하기 
export async function updateClientProfile(req, res) {
    try{
       const {uid} = req.user;
       const {updateAt} = req.body;  //string 형

       const q = `
         SELECT u.*, r.roomName FROM user u
         LEFT JOIN room r ON u.affiliationId = r.roomId
         WHERE u.uid = ? AND u.updateAt != ? ;
       `;

       const [rows] = await pool.query(q, [uid, updateAt])

       if(rows.length == 0){ //업데이트 일자가 다른게 없다면
        return res.status(204).send();
       }

       return res.json(rows[0]);
    }catch(error){
       console.error('내 프로필 업데이트 오류', error);
       res.status(500).send();  
    }
}


// 수정된 서버 코드
export async function updateDBProfile(req, res) {
    try {
      const uid = req.user.uid;
      const updates = { ...req.body };
      
      // ✅ 이미지 처리
      if (req.file) {
        const fileName = `profile/${uid}`; // 폴더/파일명
        const file = bucket.file(fileName);
  
        await file.save(req.file.buffer, {
          metadata: {
            contentType: req.file.mimetype,
          },
          public: true, // 🔓 공개 URL 만들기
          validation: 'md5',
        });
  
        const imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        // 이미지 URL을 업데이트 객체에 추가 (profileImage 필드로 저장)
        updates.profileImage = imageUrl; // 이 부분이 변경됨 (image → profileImage)
      }
  
      // ✅ 필드 업데이트
      const allowedFields = ['name', 'nickName', 'gender', 'birthYear', 'career', 'local', 'city', 'profileImage', 'phone', 'email'];
      const filtered = {};
      
      for (const key of Object.keys(updates)) {
        if (allowedFields.includes(key)) {
          filtered[key] = updates[key];
        }
      }
  
      if (Object.keys(filtered).length === 0) {
        console.log("업데이트할 항목이 없음");
        return res.status(400).json({ message: '업데이트할 항목이 없습니다.' });
      }
  
      const setClause = Object.keys(filtered).map(k => `${k} = ?`).join(', ');
      const values = Object.values(filtered);
      
      console.log("SQL 쿼리:", `UPDATE user SET ${setClause} WHERE uid = ?`);
      console.log("값:", [...values, uid]);
  
      const sql = `UPDATE user SET ${setClause} WHERE uid = ?`;
      await pool.query(sql, [...values, uid]);
  
      res.status(200).json({ message: '업데이트 완료' });
    } catch (error) {
      console.error('updateDBProfile 오류:', error);
      res.status(500).json({ message: '서버 오류', error: error.message });
    }
}

  //팀 불러오기
export async function myTeamWithRoomId(req, res) {
    try{
        const {uid} = req.user; //내 uid
        const roomId = Number(req.query.roomId);
        //방아이디 확인
        const [checkRoom] = await pool.query(`SELECT * FROM room WHERE roomId = ?`, [roomId]);

        if(checkRoom.length == 0){
            return res.status(404).send();
        }

      
        const q = `SELECT 
                    t.teamId,
                    t.teamName,
                    r.useNickname,
                    u.uid,
                    u.profileImage,

                    CASE 
                        WHEN r.useNickname = 0 THEN u.name
                        ELSE u.nickName
                    END AS displayName,

                    CASE 
                        WHEN r.useNickname = 0 THEN u.gender
                        ELSE NULL
                    END AS gender,

                    CASE 
                        WHEN r.useNickname = 0 THEN u.birthYear
                        ELSE NULL
                    END AS birthYear

                FROM team t
                LEFT JOIN room r ON r.roomId = t.roomId

                -- 내가 아닌 팀원 정보를 가져오기 위한 JOIN
                LEFT JOIN user u ON (
                (t.uid1 = ? AND u.uid = t.uid2) OR
                (t.uid2 = ? AND u.uid = t.uid1)
                )

                WHERE t.roomId = ? AND (t.uid1 = ? OR t.uid2 = ?);`
        const [rows] = await pool.query(q, [uid, uid, roomId, uid, uid]);

        res.json(rows);
    }catch(error){
        console.error('팀 불러오기 오류:', error);
        res.status(500).send();
    }
}

//팀 만들기

export async function createMyTeam(req, res) {
    const connection = await pool.getConnection();
    try {
        const {uid} = req.user;
        const {roomId, otherUid, teamName} = req.body;

        await connection.beginTransaction();
        const [checkUidExist] = await connection.query(`SELECT * FROM team WHERE roomId = ? AND (uid1 = ? AND uid2 = ?) OR (uid1 = ? AND uid2 = ?)`,
            [roomId, uid, otherUid, otherUid, uid]
        );

        if(checkUidExist.length > 0){
            await connection.commit();
            return res.status(203).send(); //중복된 데이터
        }

        const [checkTeamName] = await connection.query(`SELECT * FROM team WHERE roomId = ? AND teamName = ?`, [roomId, teamName]);

        if(checkTeamName.length > 0){
            await connection.commit();
            return res.status(204).send(); //중복된 팀명
        }

        const q = `INSERT INTO team (roomId, teamName, uid1, uid2) VALUES (?, ?, ?, ?)`;
        await connection.query(q, [roomId, teamName, uid, otherUid]);
        
        await connection.commit();

        res.send();
    } catch (error) {
        await connection.rollback();
        console.error('팀 만들기 오류:', error);
        res.status(500).send();
    }finally{
        connection.release();
    }
}


  /////////////////
//특정 사용자 프로필 불러오기
export async function getProfile(req, res){
    try {
        const {uid} = req.params;

        //사용자 기본 정보 가져오기
        const q = `
         SELECT 
            u.profileImage, 
            u.nickName, 
            u.affiliationId, 
            r.roomName, 
            u.level, 
            u.career,
            (SELECT COUNT(*) FROM friend WHERE uid = u.uid) AS following,
            (SELECT COUNT(*) FROM friend WHERE friendUid = u.uid) AS follower,
            (SELECT COUNT(*) FROM gameTable WHERE player1_0 = u.uid OR player1_1 = u.uid OR player2_0 = u.uid OR player2_1 = u.uid) AS gameCount
            FROM user u
            LEFT JOIN room r ON u.affiliationId = r.roomId
            WHERE u.uid = ?;
        `;

        const [users] = await pool.query(q, [uid]);

        if(users.length == 0){
            return res.status(404).send();
        }

        res.json(users[0]);
    } catch (error) {
        console.error('프로필 쿼리 에러 :', error);
        res.status(500).send();
    }
}


//사용자 게임 기록 불러오기
export async function getGameMemory(req, res){
    try{
        const {uid} = req.query;
        const offset = Number(req.query.offset);
        
        const q = `SELECT 
                gm.tableId,
                gm.scheduleId,
                gm.player1_0,
                gm.player1_1, 
                gm.player2_0, 
                gm.player2_1, 
                gm.score1,
                gm.score2,

                -- 승/패 판단
                CASE
                    WHEN (
                    (? IN (gm.player1_0, gm.player1_1) AND gm.score1 > gm.score2)
                    OR
                    (? IN (gm.player2_0, gm.player2_1) AND gm.score2 > gm.score1)
                    ) THEN 'win'
                    
                    WHEN (
                    (? IN (gm.player1_0, gm.player1_1) AND gm.score1 < gm.score2)
                    OR
                    (? IN (gm.player2_0, gm.player2_1) AND gm.score2 < gm.score1)
                    ) THEN 'lose'
                    
                    ELSE 'draw'
                END AS result,

                -- 상대 닉네임 (내 UID와 다른 쪽 추출)
                CASE 
                    WHEN ? IN (gm.player1_0, gm.player1_1) THEN 
                    CONCAT_WS(', ',
                        IF(gm.player2_0 != ?, u20.nickName, NULL),
                        IF(gm.player2_1 != ?, u21.nickName, NULL)
                    )
                    ELSE 
                    CONCAT_WS(', ',
                        IF(gm.player1_0 != ?, u10.nickName, NULL),
                        IF(gm.player1_1 != ?, u11.nickName, NULL)
                    )
                END AS opponentNames

                FROM 
                gameTable gm
                LEFT JOIN schedule s ON gm.scheduleId = s.scheduleId

                -- player 유저 정보 조인
                LEFT JOIN user u10 ON gm.player1_0 = u10.uid
                LEFT JOIN user u11 ON gm.player1_1 = u11.uid
                LEFT JOIN user u20 ON gm.player2_0 = u20.uid
                LEFT JOIN user u21 ON gm.player2_1 = u21.uid

                WHERE 
                (? IN (gm.player1_0, gm.player1_1, gm.player2_0, gm.player2_1))
                AND s.state = 4 
                AND gm.walkOver != TRUE

                ORDER BY s.startDate DESC
                LIMIT 15 OFFSET ?;
         `;
        const [rows] = await pool.query(q, [
            uid, uid, uid, uid,      
            uid, uid, uid, uid, uid, 
            uid,                     
            offset
          ]);

        res.json(rows);
    }catch(error){
        console.error('프로필 게임 쿼리 에러 :', error);
        res.status(500).send();
    }
}

//사용자가 친구인지 체크하는 함수
export async function getFriendCheckWithUid(req, res) {
    try{
       const {uid} = req.user;
       const friendUid = req.params.uid;

       const [rows] = await pool.query(`SELECT uid FROM friend WHERE uid = ? AND friendUid = ?;`,[uid, friendUid]);

       if(rows.length > 0){
        return res.send(true);
       }
       
       res.send(false);
    }catch(error){
        console.error('사용자 쿼리 에러 :', error);
        res.status(500).send();
    }
}


//친구 제거
export async function deleteFriend(req, res){
    try{
        const {uid} = req.user;
        const friendUid = req.params.uid;

        await pool.query(`DELETE FROM friend WHERE uid = ? AND friendUid = ?;`, [uid, friendUid]);
        
        res.send();
    }catch(error){
        console.error('친구 삭제 에러 :', error);
        res.status(500).send();
    }
}


//친구 생성
export async function createFriend(req, res) {
    try {
        const { uid } = req.user;
        const friendUid = req.params.uid;

        // 1. 자기 자신을 친구로 추가하는 것 방지
        if (uid === friendUid) {
            return res.status(400).json({ 
                error: '자기 자신을 팔로우할 수 없습니다.' 
            });
        }

        // 2. 친구 대상 유저 존재 여부 확인
        const [friendExists] = await pool.query(`
            SELECT uid FROM user WHERE uid = ?
        `, [friendUid]);

        if (friendExists.length === 0) {
            return res.status(404).json({ 
                error: '존재하지 않는 사용자입니다.' 
            });
        }

        // 3. 이미 친구 관계인지 확인
        const [existingFriend] = await pool.query(`
            SELECT fid FROM friend WHERE uid = ? AND friendUid = ?
        `, [uid, friendUid]);

        if (existingFriend.length > 0) {
            return res.status(409).json({ 
                error: '이미 팔로우 중인 사용자입니다.',
                fid: existingFriend[0].fid 
            });
        }

        // 4. 친구 관계 생성
        const [result] = await pool.query(`
            INSERT INTO friend (uid, friendUid) VALUES(?, ?)
        `, [uid, friendUid]);

        const fid = result.insertId;

        // 5. 알림 발송을 위한 사용자 정보 조회
        const [userRows] = await pool.query(`
            SELECT nickName FROM user WHERE uid = ?
        `, [uid]);

        if (userRows.length === 0) {
            console.error('사용자 정보를 찾을 수 없습니다:', uid);
            return res.status(500).json({ error: '사용자 정보 오류' });
        }

        const user = userRows[0];
        const title = `${user.nickName}님이 팔로우를 했어요`;
        const contents = '프로필에서 ‘팔로우’ 버튼을 눌러 이 사용자를 친구로 추가하세요.';
        const routing = `/user/${uid}`; // 팔로우한 사람의 프로필로 가야 함

        // 6. 알림 생성 (에러가 발생해도 친구 추가는 성공으로 처리)
        try {
            await createNotification(friendUid, title, contents, routing);
        } catch (notificationError) {
            console.error('알림 생성 실패:', notificationError);
            // 알림 실패는 친구 추가 성공에 영향을 주지 않음
        }

        res.status(201).json({ 
            fid: fid,
            message: '팔로우가 완료되었습니다.' 
        });

    } catch (error) {
        console.error('친구 추가 에러:', error);
        
        // 구체적인 에러 메시지 제공
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ 
                error: '이미 팔로우 중인 사용자입니다.' 
            });
        }
        
        res.status(500).json({ 
            error: '팔로우 처리 중 오류가 발생했습니다.' 
        });
    }
}



//사용자 소속 변경
export async function updateAffiliation(req, res){
    try {
        const {uid} = req.user;
        const roomId = req.body.roomId;
      
        const q = `
        UPDATE user
        SET affiliationId = ?
        WHERE uid = ?;
        `;

        await pool.query(q, [roomId, uid]);
        res.send();
    } catch (error) {
        console.error('소속 쿼리 오류', error);
        res.status(500).send();
    }
}

//사용자 친구리스트 불러오기
export async function getFriends(req, res) {
    try{
        const offset = Number(req.query.offset);
        const {uid} = req.user;

        const q = `
                SELECT 
                f.friendUid,
                u.nickName,
                u.profileImage,
                u.level,
                u.affiliationId,
                r.roomName
                FROM friend f
                LEFT JOIN user u ON f.friendUid = u.uid
                LEFT JOIN room r ON u.affiliationId = r.roomId
                WHERE f.uid = ?
                ORDER BY u.nickName ASC
                LIMIT 30 OFFSET ?;
        `;

        const [rows] = await pool.query(q, [uid, offset]);

        res.json(rows);
    }catch(error){
        console.error('친구 목록 쿼리 오류', error);
        res.status(500).send(); 
    }
}

// 사용자 연락처 접근 후 사용자 찾기
export async function getFriendsByPhone(req, res) {
    try {
      const { uid } = req.user;
      const phoneList = req.body.phones;
      const limit = 20;
      const offset = Number(req.body.offset ?? 0);
  
      if (!Array.isArray(phoneList) || phoneList.length === 0) {
        return res.status(400).json({ message: '전화번호 리스트가 필요합니다.' });
      }
  
      const placeholders = phoneList.map(() => '?').join(', ');
      const query = `
        SELECT 
          u.uid, 
          u.nickName, 
          u.profileImage, 
          u.affiliationId, 
          u.level,
          r.roomName,
          CASE 
            WHEN f.uid IS NOT NULL THEN TRUE
            ELSE FALSE
          END AS isFriend
        FROM user u
        LEFT JOIN room r ON u.affiliationId = r.roomId
        LEFT JOIN friend f ON f.uid = ? AND f.friendUid = u.uid
        WHERE u.phone IN (${placeholders})
        LIMIT ? OFFSET ?;
      `;
  
      const [rows] = await pool.query(query, [uid, ...phoneList, limit, offset]);
  
      res.json(rows);
    } catch (error) {
      console.error('친구 번호 쿼리 오류', error);
      res.status(500).send();
    }
}

//친구 이메일 혹은 번호 검색
export async function searchWithNumber(req, res) {
    try {
        const {query} = req.query;

        const q = `
            SELECT uid FROM user
            WHERE phone = ? OR email = ?;
        `;

        const [rows] = await pool.query(q, [query, query]);

        if(rows.length > 0){
            return res.json(rows[0]);
        }

        res.status(204).send();
    } catch (error) {
        console.error('친구 검색 쿼리 오류', error);
        res.status(500).send();
    }
}

export async function getUserWithFid(req, res) {
    try {
        const fid = Number(req.query.fid);

        const q = `
                SELECT 
                f.friendUid,
                u.nickName,
                u.profileImage,
                u.level,
                u.affiliationId,
                r.roomName
                FROM friend f
                LEFT JOIN user u ON f.friendUid = u.uid
                LEFT JOIN room r ON u.affiliationId = r.roomId
                WHERE f.fid = ?;
        `;

        const [rows] = await pool.query(q, [fid]);

        res.json(rows[0]);
    } catch (error) {
        console.error('단일 친구 쿼리 오류', error);
        res.status(500).send();
    }
}

export async function getFollowerNotFollowing(req, res) {
    try{
        const {uid} = req.user;
        const lastFid = Number(req.query.lastFid);

        //나를 팔로우한 사용자 목록
        const query = `
            SELECT 
                u.nickName,
                u.profileImage,
                r.roomName,
                u.uid,
                f.fid,
                u.lastLogin
            FROM friend f
            LEFT JOIN user  u ON f.uid        = u.uid
            LEFT JOIN room  r ON u.affiliationId = r.roomId
            WHERE 
                f.friendUid = ?
            AND NOT EXISTS (
                -- 내가 f.uid(팔로워) 사람을 팔로우한 기록이 있는지 확인
                SELECT 1
                FROM friend f2
                WHERE 
                f2.uid        = ?
                AND f2.friendUid = f.uid
            );`;

        const [rows] = await pool.query(query, [uid, uid]); 
        
        res.json(rows);
    }catch(error){
        console.error('나를 팔로우했지만 맞팔로우 되지 않은 친구 목록 오류', error);
        res.status(500).send();
    }
}

//마케팅 수신 정보 업데이트
export async function updateMarketing(req, res){
    try{
        const uid = req.body.uid;
        const marketing = req.body.marketing;

        const  q = `
            UPDATE user
            SET marketing = ?
            WHERE uid = ?;
        `;

        await pool.query(q, [marketing, uid]);
        res.send();
    }catch(error){
        console.error('마케팅 변경 쿼리 오류', error);
        res.status(500).send();
    }
}



//관리자용
export async function getUsersForManage(req, res) {
    try {
        const limit = 10; // 한 페이지당 10개의 결과

        const q = `
           SELECT * FROM user 
           WHERE uid != '' AND uid != ?
           LIMIT ? OFFSET ?;
        `;
        const page = parseInt(req.query.page) || 1; // 쿼리의 page 값
        const offset = (page - 1) * limit;

        const [rows] = await pool.query(q, ["?",limit, offset]);


        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}

export async function getTotalUserCount(req, res) {
    try{
        const q = `SELECT COUNT(uid) AS total_count FROM user WHERE uid != '' AND uid != '?';`;
        const [rows] = await pool.query(q);
        
        const totalCount = rows[0]?.total_count || 0; // 안전하게 접근
        res.json({ total_count: totalCount });
    }catch(error){
        console.error(error);
        res.status.send();
    }
}



export async function removeProfile(req, res) {
    try {
        const {uid, url} = req.body;

        await updateImageType(url);

        const q = `
           UPDATE user
           SET profileImage = ''
           WHERE uid = ?;
        `;

        await pool.query(q, [uid]);
        res.send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}




//지갑 불러오기
export async function getWallet(req, res) {
    try{
      const uid = req.body.uid;

      const q = `
        SELECT point,status FROM wallet
        WHERE uid = ?;
      `;

      const [rows] = await pool.query(q, [uid]);

      if(rows.length === 0){
        return res.status(404).send();
      }

      return res.json(rows[0]);
    }catch(error){
        console.error("지갑 불러오기 실패", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
}

//새지갑 만들기
export async function createWallet(req, res) {
    try{
        const uid = req.body.uid;

        //지갑 만들기
        const q = `
          INSERT INTO wallet (uid) VALUES (?) ;
        `;
        
        await pool.query(q, [uid]);

        res.send();
    }catch(error){
        console.error("지갑 생성 실패", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
}          

