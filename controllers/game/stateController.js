import pool from '../../config/database.js';
import { getSocket } from '../../socket/websocket.js'
import { sendNotificationToGameMembers } from './gameNotificationController.js';

///게임상태 관리 알고리즘

//상태 업데이트
export async function updateStep(req, res){
  try{
    const scheduleId = req.body.scheduleId;
    const state = req.body.state;

    const q = `
      UPDATE schedule
      SET state = ?
      WHERE scheduleId = ?;
    `;

    await pool.query(q, [state, scheduleId]);;
    

    //만약 현재 게임 상태가 추첨이거나, 종료일경우 메시지보내기
    if(state == 2 || state == 4){
      const text = state == 2 ? '일정 내 게임이 시작되었어요' : '일정 내 게임이 종료되었어요';
      await sendNotificationToGameMembers(scheduleId, text);
    }

    const io = getSocket();

    //상태가바뀌면 계속해서 업데이트 시키기
    io.to(`gameId:${scheduleId}`).emit('refreshMember');
    io.to(`gameId:${scheduleId}`).emit('changedState', {state : state});

    res.send();
  }catch(error){
    console.error(error);
    res.status(500).send();
  }
}