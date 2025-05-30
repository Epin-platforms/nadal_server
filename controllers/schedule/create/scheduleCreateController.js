import pool from '../../../config/database.js';
import { getSocket } from '../../../socket/websocket.js';
import { quickScheduleChat } from '../../chat/sendController.js';

export async function createSchedule(req, res) {
    try {
        const scheduleData = req.body;
        const {uid} = req.user;

        const q = `
            INSERT INTO schedule (
                uid,
                tag, 
                isAllDay, 
                startDate, 
                endDate, 
                title,
                description, 
                roomId, 
                useAddress, 
                address, 
                addressPrefix, 
                addressDetail, 
                useAccount, 
                accountId, 
                useParticipation, 
                useGenderLimit, 
                maleLimit, 
                femaleLimit, 
                sports, 
                state, 
                finalScore,
                isSingle,
                isKDK
                ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;


        const v = [
            uid,
            scheduleData.tag,
            scheduleData.isAllDay,
            scheduleData.startDate,
            scheduleData.endDate,
            scheduleData.title,
            scheduleData.description,
            scheduleData.roomId,
            scheduleData.useAddress,
            scheduleData.address,
            scheduleData.addressPrefix,
            scheduleData.addressDetail,
            scheduleData.useAccount,
            scheduleData.accountId,
            scheduleData.useParticipation,
            scheduleData.useGenderLimit,
            scheduleData.maleLimit,
            scheduleData.femaleLimit,
            scheduleData.sports,
            scheduleData.state,
            scheduleData.finalScore,
            scheduleData.isSingle,
            scheduleData.isKDK,
        ];

        const [result] = await pool.query(q, v);

        const insertId = result.insertId;

        //스케줄 데이터에 방아이디가 null 이 아니고 업데이트가 된 상태라면 소켓 채팅으로 공유
        if(scheduleData.roomId != null){
            const chat = {
                roomId : scheduleData.roomId,
                scheduleId: insertId,
                uid : uid,
                type: 2,
            };

            // 소켓 이벤트로 전달
            await quickScheduleChat(chat);
            
            if(scheduleData.tag == '공지'){
                const io = getSocket();
                io.to(`roomId:${scheduleData.roomId}`).emit('announce');
            }
        }
        
        return res.json({scheduleId: insertId});
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}