import pool from '../../config/database.js';

export async function updateMyMemberAlarm(req, res) {
    try{
        const {uid} = req.user;
        const {alarm , roomId} = req.body;

        await pool.query(`
            UPDATE roomMember 
            SET alarm = ?
            WHERE uid = ? AND roomId = ?;
            `, [alarm, uid, roomId]);
        
        res.status(201).send();   
    }catch(error){
        console.log(error);
        res.status(500).send();
    }
}