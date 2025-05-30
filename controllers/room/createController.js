import pool from '../../config/database.js';
import { createLog } from './log/logController.js';

//방 생성
export async function createRoom(req, res) {
    const conn = await pool.getConnection(); // 커넥션 받아오기
    try {
      const { uid } = req.user;
      const room = req.body;
  
      await conn.beginTransaction(); // 트랜잭션 시작
  
      // 방명 중복 체크 (오픈채팅방은 제외)
      const duple = await checkDuplicationRoomName(room.roomName, room.local, conn);
      if (duple) {
        await conn.rollback();
        return res.status(202).send();
      }
  
      // 방 추가
      const q = `
        INSERT INTO room (roomName, local, city, description, tag, useNickname, enterCode)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `;
      const v = [
        room.roomName,
        room.local,
        room.city,
        room.description,
        room.tag,
        room.useNickname,
        room.enterCode
      ];
  
      const [result] = await conn.query(q, v);
      const roomId = result.insertId; // 수정: insertId로 가져와야 해
  
      // 방장 추가
      await createLeader(roomId, uid, conn);
      await conn.commit(); // 트랜잭션 커밋
      await createLog(roomId, null, '새로운 대화가 시작됐어요!\n모두가 함께하는 소통의 공간! 존중과 배려를 잊지 말아주세요');
      res.json({ roomId: roomId });
    } catch (error) {
      console.error('채팅방 추가 실패', error);
      if (conn) await conn.rollback(); // 에러나면 롤백
      res.status(500).send('채팅방 쿼리 오류');
    } finally {
      if (conn) conn.release(); // 무조건 커넥션 반환
    }
  }
  
  //방명 중복검사
 export async function checkDuplicationRoomName(roomName, local, conn) {
    const q = `SELECT roomId FROM room WHERE roomName = ? AND local = ?`;
    const [rows] = await conn.query(q, [roomName, local]);
    return rows.length > 0;
  }
  
  //방장 만들기
  async function createLeader(roomId, uid, conn) {
    const q = `INSERT INTO roomMember(uid, roomId, grade, lastRead) VALUES (?, ?, ?, ?)`;
    await conn.query(q, [uid, roomId, 0, 0]);
  }
   