import pool from '../../config/database.js';

export async function getMyRoomsForEditAffiliation(req, res) {
    try{
        const {uid} = req.user;

        const q = `
            SELECT 
            r.roomId,
            r.tag,
            r.roomName,
            r.roomImage,
            r.createAt,
            (
                SELECT COUNT(*) 
                FROM roomMember rm2 
                WHERE rm2.roomId = r.roomId
            ) AS memberCount
            FROM room r
            JOIN roomMember rm ON r.roomId = rm.roomId
            WHERE rm.uid = ? AND r.isOpen = FALSE
            GROUP BY r.roomId, r.tag, r.roomName, r.roomImage, r.createAt;
        `;

        const [rows] = await pool.query(q, [uid]);
        return res.json(rows);
    }catch(error){
        console.log(error);
        return res.status(500).send();
    } 
}