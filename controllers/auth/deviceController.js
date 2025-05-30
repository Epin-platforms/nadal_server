import pool from '../../config/database.js';
import { getSocket, getSocketIdByUid } from '../../socket/websocket.js';


export async function deviceUpdate(req, res) {
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
        
        // 1. 현재 활성 세션 확인 및 업데이트
        const updateQuery = `
            UPDATE userSession 
            SET deviceHash = ?, 
                deviceName = ?, 
                platform = ?, 
                lastAt = NOW()
            WHERE uid = ? 
            AND isActive = TRUE 
            AND deviceHash != ?
        `;
        
        const [updateResult] = await connection.execute(updateQuery, [
            device.deviceHash,
            device.deviceName, 
            device.platform,
            uid,
            device.deviceHash
        ]);
        
        // 2. 기존 디바이스가 업데이트된 경우 소켓 알림 발송
        if (updateResult.affectedRows > 0) {
            // 소켓 알림은 비동기로 처리하여 메인 로직에 영향주지 않음
            setImmediate(() => {
                try {
                    const socketId = getSocketIdByUid(uid);
                    if (socketId) {
                        const io = getSocket();
                        if (io) {
                            io.to(socketId).emit('newLogined', {
                                message: '새로운 디바이스에서 로그인되었습니다',
                                deviceName: device.deviceName,
                                platform: device.platform,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                } catch (socketError) {
                    console.log('소켓 알림 발송 오류 (무시됨):', socketError);
                }
            });
        }
        
        // 3. 비활성 세션 정리 (선택적)
        const cleanupQuery = `
            UPDATE userSession 
            SET isActive = FALSE
            WHERE uid = ? 
            AND isActive = TRUE 
            AND lastAt < DATE_SUB(NOW(), INTERVAL 30 DAY)
        `;
        
        await connection.execute(cleanupQuery, [uid]);
        
        // 트랜잭션 커밋
        await connection.commit();
        
        res.status(200).json({
            success: true,
            message: 'Device updated successfully',
            updated: updateResult.affectedRows > 0
        });
        
    } catch (error) {
        // 트랜잭션 롤백
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.log('롤백 오류:', rollbackError);
            }
        }
        
        console.error('디바이스 업데이트 오류:', {
            error: error.message,
            uid: req.user?.uid,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
        
        res.status(500).json({ 
            error: 'Internal server error',
            message: 'Device update failed'
        });
        
    } finally {
        // 연결 해제
        if (connection) {
            connection.release();
        }
    }
}

// 세션 비활성화 (로그아웃)
export async function turnOffDevice(req, res) {
    let connection;
    
    try {
        const { uid } = req.user;
        
        connection = await pool.getConnection();
        
        const updateQuery = `
            UPDATE userSession
            SET isActive = FALSE
            WHERE uid = ?
        `;

        await connection.query(updateQuery, [uid]);
        
        res.send();
        
    } catch (error) {
        console.error('세션 비활성화 오류:', {
            error: error.message,
            uid: req.user?.uid,
            timestamp: new Date().toISOString()
        });
        
        res.status(500).send();
        
    } finally {
        if (connection) {
            connection.release();
        }
    }
}