import pool from '../../config/database.js';

export async function checkActiveRoomsAndSchedule(req, res) {
    try{
        const {uid} = req.user;

        const q = `
            SELECT roomId FROM roomMember
            WHERE uid = ? AND grade = 0;
        `;

        const [roomRows] = await pool.query(q, [uid]);

        if(roomRows.length > 0){
            return res.json(roomRows[0]);
        }

        const q2 = `
            SELECT sm.scheduleId FROM scheduleMember sm
            LEFT JOIN schedule s ON sm.scheduleId = s.scheduleId
            WHERE sm.uid = ? AND (s.state is NULL OR s.state < 4)  
        `;

        const [scheduleRows] = await pool.query(q2, [uid]);

        if(scheduleRows.length > 0){
            return res.json(scheduleRows[0]);
        }

        res.send();
    }catch(error){
        console.log(error);
        res.staus(500).send();
    }
}


export async function cancelUser(req, res) {
    try{
        const {uid} = req.user;
        const payload = req.body;
        
        //페이로드 등록
        await pool.query(`INSERT INTO cancel (reasonId, otherReason) VALUES (?,?);`, [payload.resonId, payload.otherReason]);

        //계정 삭제
        await pool.query(`DELETE FROM user WHERE uid = ?;`, [uid]);

        res.send();
    }catch(error){
        console.log(error);
        res.staus(500).send();
    }
}