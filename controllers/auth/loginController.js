import pool from '../../config/database.js';

// 사용자 로그인 처리
export async function login(req, res) {
  let connection;
  
  try {
      const device = req.body;
      const { uid } = req.user;

      // 입력 데이터 검증
      if (!device || !device.deviceHash || !device.deviceName || !device.platform) {
          return res.status(400).json({ 
              error: 'Invalid device data', 
              required: ['deviceHash', 'deviceName', 'platform'] 
          });
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();

      // 1. 사용자 데이터 조회
      const userQuery = `
          SELECT u.*, r.roomName 
          FROM user u 
          LEFT JOIN room r ON u.affiliationId = r.roomId
          WHERE u.uid = ?
      `;
      
      const [userRows] = await connection.query(userQuery, [uid]);

      // 사용자가 존재하지 않으면 회원가입 필요
      if (userRows.length === 0) {
          await connection.commit();
          return res.status(201).send();
      }

      const userData = userRows[0];

      // 2. 세션 확인 및 처리
      const sessionResult = await handleUserSession(device, uid, connection);
      
      if (sessionResult) {
          // 다른 디바이스에서 로그인 중인 경우
          await connection.commit();
          return res.status(205).json(sessionResult);
      }

      // 3. 사용자 제재 상태 확인
      const blockInfo = await checkUserBlock(uid, connection);
      if (blockInfo) {
          userData.banType = blockInfo.reason;
          userData.startBlock = blockInfo.startBlock;
          userData.endBlock = blockInfo.endBlock;
      }

      // 4. 마지막 로그인 시간 업데이트
      await updateLastLogin(uid, connection);

      await connection.commit();
      res.json(userData);

  } catch (error) {
      if (connection) {
          await connection.rollback();
      }
      
      console.error('로그인 처리 오류:', {
          error: error.message,
          uid: req.user?.uid,
          timestamp: new Date().toISOString(),
          stack: error.stack
      });
      
      res.status(500).send();
      
  } finally {
      if (connection) {
          connection.release();
      }
  }
}

// 사용자 세션 관리
async function handleUserSession(device, uid, connection) {
  try {
      // 1. 다른 디바이스에서 활성 세션 확인
      const conflictQuery = `
          SELECT deviceName FROM userSession
          WHERE uid = ? AND deviceHash != ? AND isActive = 1
      `;
      
      const [conflictRows] = await connection.query(conflictQuery, [uid, device.deviceHash]);
      
      if (conflictRows.length > 0) {
          // 다른 기기에서 로그인된 세션이 존재
          return conflictRows[0];
      }

      // 2. 현재 디바이스 세션 확인
      const existingQuery = `
          SELECT * FROM userSession
          WHERE uid = ? AND deviceHash = ?
      `;
      
      const [existingRows] = await connection.query(existingQuery, [uid, device.deviceHash]);

      if (existingRows.length === 0) {
          // 새 세션 생성
          const insertQuery = `
              INSERT INTO userSession (uid, deviceHash, isActive, lastAt, platform, deviceName)
              VALUES (?, ?, TRUE, NOW(), ?, ?)
          `;
          
          await connection.query(insertQuery, [
              uid, 
              device.deviceHash, 
              device.platform,
              device.deviceName
          ]);
      } else {
          // 기존 세션 업데이트
          const updateQuery = `
              UPDATE userSession
              SET lastAt = NOW(), isActive = TRUE
              WHERE uid = ? AND deviceHash = ?
          `;
          
          await connection.query(updateQuery, [uid, device.deviceHash]);
      }

      return null;

  } catch (error) {
      console.error('세션 처리 오류:', error);
      throw error;
  }
}

// 사용자 제재 상태 확인
async function checkUserBlock(uid, connection) {
  try {
      const blockQuery = `
          SELECT * FROM userBlock 
          WHERE uid = ? AND startBlock <= NOW() AND endBlock > NOW()
          ORDER BY endBlock DESC
          LIMIT 1
      `;
      
      const [blockRows] = await connection.query(blockQuery, [uid]);
      
      return blockRows.length > 0 ? blockRows[0] : null;
      
  } catch (error) {
      console.error('제재 확인 오류:', error);
      throw error;
  }
}

// 마지막 로그인 시간 업데이트
async function updateLastLogin(uid, connection) {
  try {
      const updateQuery = `
          UPDATE user
          SET lastLogin = NOW()
          WHERE uid = ?
      `;
      
      await connection.query(updateQuery, [uid]);
      
  } catch (error) {
      console.error('로그인 시간 업데이트 오류:', error);
      throw error;
  }
}
