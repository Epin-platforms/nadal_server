import pool from '../../config/database.js';
import { getSocket, getSocketIdByUid } from '../../socket/websocket.js';
import { createNotification } from '../notification/notificationController.js';
import { createLog } from '../room/log/logController.js';

//방 멤버들 불러오기
export async function getRoomMembers(req, res){
    try{
        const roomId = Number(req.params.roomId);
        const {uid} = req.user;

        const q = `
            SELECT rm.*, 
                r.useNickname,
                -- 닉네임 또는 이름
                CASE WHEN r.useNickname = 0 THEN u.name ELSE u.nickName END AS displayName,

                -- 프로필 이미지는 공통
                u.profileImage,

                -- 성별 (닉네임 사용 안할 경우에만 노출)
                CASE WHEN r.useNickname = 0 THEN u.gender ELSE NULL END AS gender,

                -- 출생년도 (닉네임 사용 안할 경우에만 노출)
                CASE WHEN r.useNickname = 0 THEN u.birthYear ELSE NULL END AS birthYear

            FROM roomMember rm
            LEFT JOIN user u ON rm.uid = u.uid
            LEFT JOIN room r ON rm.roomId = r.roomId
            WHERE rm.roomId = ? AND rm.uid != ?;
        `;

        const [rows] = await pool.query(q, [roomId, uid]);

        res.json(rows);
    }catch(error){
        console.error(error);
        res.status(500).send();
    }

}


export async function updateLastRead(req, res) {
    try{
        const {uid} = req.user;
        const roomId = Number(req.params.roomId);
        const lastRead = Number(req.query.lastRead);

        const q = `
            UPDATE roomMember
            SET lastRead = ?
            WHERE uid = ? AND roomId = ?;
        `;

        await pool.query(q, [lastRead, uid, roomId]);

        const io = getSocket();
        io.to(`roomId:${roomId}`).emit('updateLastRead', {
            uid: uid,
            lastRead: lastRead,
        });

        res.send();
    }catch(error){
        console.error('마지막 읽기 업데이트 오류',error);
        res.status(500).send(); 
    }
}

//내정보 불러오기
export async function getMyRoomMemberDataWithRoomId(req, res) {
    try {
        const roomId = Number(req.params.roomId);
        const {uid} = req.user;

        const q = `
            SELECT
            r.*,
            (
                SELECT COUNT(*)
                FROM chat AS c
                WHERE c.roomId   = r.roomId
                AND c.chatId > r.lastRead
            ) AS unreadCount
            FROM roomMember AS r
            WHERE r.uid    = ?  -- 바인딩: 내 UID
            AND r.roomId = ?; -- 바인딩: 조회할 roomId
        `;
        
        const [rows] = await pool.query(q, [uid, roomId]);
        res.json(rows[0]);
    } catch (error) {
        console.error('방내 내정보가져오기 오류',error);
        res.status(500).send(); 
    }
}

//방나가기
export async function exitRoom(req, res) {
    try{
        const {uid} = req.user;
        const roomId = Number(req.params.roomId);

        const q = `DELETE FROM roomMember WHERE roomId = ? AND uid = ?;`;
        
        await pool.query(q, [roomId, uid]);

        await createLog(roomId, uid, '님이 퇴장했습니다');
        
        res.send();
    }catch(error){
        console.error('방 나가기 오류',error);
        res.status(500).send(); 
    }
}

//방 탈퇴시키기
export async function kickedMember(req, res) {
    const conn = await pool.getConnection();
    try {
        const {uid, roomId} = req.body;

        await conn.beginTransaction();

        //방정보 가져오기
        const [rooms] = await conn.query(`SELECT roomName, local FROM room WHERE roomId = ?;`, [roomId]);

        if(rooms.length == 0){
            await conn.commit();
            return res.status(404).send();
        }

        const room = rooms;

        //추방하기
        await conn.query(`DELETE FROM roomMember WHERE roomId = ? AND uid = ?;`, [roomId, uid]);

        //블랙리스트 등록
        await conn.query(`INSERT INTO blackList(uid, roomId) VALUES (?,?);`,[uid, roomId]);

        //방 로그 만들기
        await createLog(roomId, uid, '님이 추방되었습니다');

        await conn.commit();

        //추방당한 사용자에게 알리기
        const io = getSocket();


        const socketId = getSocketIdByUid(uid);

        if (socketId) {
            io.to(socketId).emit('kicked', {  roomId : roomId ,  room : room });
            io.to(`roomId:${roomId}`).emit("refreshMember");
        }else{
            //푸시 메시지 날리기
           await createNotification(uid, `채팅방에서 추방되었습니다`, `${room.roomName} 방에 2달간 접근이 불가합니다`, null);
        }

        res.send();
    } catch (error) {
        await conn.rollback();
        console.error('추방하기 오류',error);
        res.status(500).send(); 
    }finally{
        conn.release();
    }
}

//방 멤버 등급 설정
export async function changedMemberGrade(req, res){
    try {
        const {uid} = req.user;
        const {targetUid, roomId, grade} = req.body;

        const q = `
            UPDATE roomMember
            SET grade = ?
            WHERE roomId = ? AND uid = ?;
        `;

        //타겟에 uid 변경
        await pool.query(q, [grade, roomId, targetUid]);

        const io = getSocket();
        io.to(`roomId:${roomId}`).emit('gradeChanged', {roomId: roomId, uid: targetUid, grade: grade});

        await createNotification(targetUid, '멤버 등급이 변경되었어요', '지금 바로 확인해보세요', `/room/${roomId}`);

        if(grade == 0){ //클럽장으로 변경이라면 //본인은 매니저로 변경
            const q = `
                UPDATE roomMember
                SET grade = 1
                WHERE roomId = ? AND uid = ?;
            `;  

            await pool.query(q, [roomId, uid]);
            io.to(`roomId:${roomId}`).emit('gradeChanged', {roomId: roomId, uid: uid, grade: 1});
        }

          //로그만들기
        const gradeStr = grade == 0 ? '클럽장' : grade == 1 ? '매니저' : grade == 2 ? '정회원' : '신입';
        await createLog(roomId, targetUid, `님께서 ${gradeStr}등급이 되었습니다`);

        res.send();
    } catch (error) {
        console.error('등급 변경 오류',error);
        res.status(500).send(); 
    }
}