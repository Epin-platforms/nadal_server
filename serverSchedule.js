// scheduler.js
import schedule from 'node-schedule';
import pool from './config/database.js';           // MySQL pool 인스턴스

// 보관 기간 설정
const date_sub_chat         = 30;
const date_sub_notification = 7;
const date_sub_schedule     = 10;
const date_sub_roomLog      = 30;

// 예약 작업 ID를 담아두는 배열 (취소용)
const jobs = [];

export function initScheduler() {
  // 새벽 3시마다 실행
  const job = schedule.scheduleJob('0 3 * * *', async () => {
    console.log('삭제 작업 시작:', new Date());
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction(conn); 
      await autoDeleteChat(conn);
      await autoDeleteRoomLog(conn);
      await autoDeleteNotification(conn);
      await autoDeleteSchedule(conn);
      await conn.commit();
      console.log('삭제 작업 종료:', new Date());
    } catch (e) {
      await conn.rollback();  
      console.error('전체 삭제 작업 중 오류:', e);
    }finally{
      conn.release(); 
    }
  });

  jobs.push(job);
}

// 프로세스 종료 시 스케줄러 취소용 (선택)
export function stopScheduler() {
  jobs.forEach(j => j.cancel());
  console.log('스케줄러 모두 취소됨');
}

// --- 이하 개별 함수들 ---

async function autoDeleteChat() {
  try {
    const [result] = await pool.query(`
      DELETE FROM chat
      WHERE DATE(createAt) <= DATE_SUB(CURDATE(), INTERVAL ${date_sub_chat} DAY)
    `);
    console.log(`삭제된 채팅 수: ${result.affectedRows}`);
  } catch (e) {
    console.error('채팅 삭제 실패:', e);
  }
}

async function autoDeleteRoomLog(conn) {
  try {
    const [result] = await conn.query(`
      DELETE FROM roomLog
      WHERE DATE(createAt) <= DATE_SUB(CURDATE(), INTERVAL ${date_sub_roomLog} DAY)
    `);
    console.log(`삭제된 로그 수: ${result.affectedRows}`);
  } catch (e) {
    console.error('로그 삭제 실패:', e);
  }
}


async function autoDeleteNotification(conn) {
  try {
    const [result] = await conn.query(`
      DELETE FROM notification
      WHERE DATE(createAt) <= DATE_SUB(CURDATE(), INTERVAL ${date_sub_notification} DAY)
    `);
    console.log(`삭제된 알림 메타데이터 수: ${result.affectedRows}`);
  } catch (e) {
    console.error('알림 삭제 실패:', e);
  }
}

async function autoDeleteSchedule(conn) {
  try {
    const [result] = await conn.query(`
      DELETE FROM schedule
      WHERE DATE(endDate) <= DATE_SUB(CURDATE(), INTERVAL ${date_sub_schedule} DAY)
        AND (state IS NULL OR state < 4)
    `);
    console.log(`삭제된 스케줄 수: ${result.affectedRows}`);
  } catch (e) {
    console.error('스케줄 삭제 실패:', e);
  }
}
