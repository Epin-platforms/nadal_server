import pool from '../../config/database.js';


//회원가임
export async function signUp(req, res){
  const conn = await pool.getConnection(); // 커넥션 받아오기
    try {
      const {uid} = req.user;
      const userData = req.body;
      
      await conn.beginTransaction(); // 트랜잭션 시작

      //먼저 가입전 사용자 데이터가 중 중복계정이 존재하는지 검색
      const checkDuple = await checkWithEmailOrPhone(userData.email, userData.phone, userData.verificationCode, conn); //폰은 Null값 일 수 있음
      
      if(checkDuple != null){
        return res.status(204).json(checkDuple);
      }


      const q = `
        INSERT INTO user (
            uid,
            name,
            nickName,
            birthYear, 
            phone, 
            email, 
            gender, 
            local, 
            city, 
            career,  
            level,
            verificationCode,
            social
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
  
        const values = [
        uid,
        userData.name,
        userData.nickName,
        userData.birthYear,
        userData.phone,
        userData.email,
        userData.gender,
        userData.local,
        userData.city,
        userData.career,
        userData.level,
        userData.verificationCode,
        userData.social
        ];
  
      await conn.query(q, values);

      await conn.commit(); // 트랜잭션 커밋
      res.send();
    } catch (error) {
      console.error('회원가입 쿼리 오류', error);
      if (conn) await conn.rollback(); // 에러나면 롤백
      res.status(500).send();
    }finally{
      if (conn) conn.release(); // 무조건 커넥션 반환
    }
}

async function checkWithEmailOrPhone(email, phone, verificationCode, conn) {
  try {
    const q = `
      SELECT * FROM user 
      WHERE (email IS NOT NULL AND email = ?)
         OR (phone IS NOT NULL AND phone = ?)
         OR (verificationCode IS NOT NULL AND verificationCode = ?)
      LIMIT 1;
    `;

    const [rows] = await conn.query(q, [email, phone, verificationCode]);

    if (rows.length > 0) {
      const row = rows[0];
      return {
        social: row.social,
        email: row.email
      };
    }

    return null;
  } catch (error) {
    console.log('check Duple Error', error);
    throw error;
  }
}
