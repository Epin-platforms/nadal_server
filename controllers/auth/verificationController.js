import pool from '../../config/database.js';

//사용자 정보 업데이트 (카카오 연결 용)
export async function verificationUpdate(req, res){
    try {
        const { uid } = req.user;
        const { name, phone, email, gender, birthYear, verificationCode } = req.body;
        
        // 업데이트할 필드 구성
        const updates = [
          { key: 'name', value: name },
          { key: 'phone', value: phone },
          { key: 'gender', value: gender },
          { key: 'birthYear', value: birthYear },
          { key: 'verificationCode', value: verificationCode },
        ];
        
        // email이 null이 아닐 경우에만 추가
        if (email !== null && email !== undefined) {
          updates.push({ key: 'email', value: email });
        }
        
        // 필드와 값 나누기
        const setClause = updates.map(item => `${item.key} = ?`).join(', ');
        const values = updates.map(item => item.value);
        
        // uid는 WHERE절에서 사용
        values.push(uid);
        
        const q = `
          UPDATE user
          SET ${setClause}
          WHERE uid = ?;
        `;
        
        await pool.query(q, values);
        res.send();
    } catch (error) {
        console.error('정보 수정 변경 쿼리 오류', error);
        res.status(500).send();
    }
}
