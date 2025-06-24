import { createNotification } from '../notification/notificationController.js';
import { sendNotificationToGameMembers as sendGameNotificationService } from '../notification/notificationService.js'

// 🔧 수정된 게임 참가자들에게 메시지 보내기 (중복 제거 + 완전 일관성)
export async function sendNotificationToGameMembers(scheduleId, messageContents) {
  try {
    console.log(`🎮 게임 알림 요청: scheduleId=${scheduleId}, message="${messageContents}"`);
    
    // 모든 로직을 notificationService로 위임
    await sendGameNotificationService(scheduleId, messageContents);
    
    console.log(`✅ 게임 알림 전송 완료: scheduleId=${scheduleId}`);
  } catch (error) {
    console.error(`❌ 게임 알림 전송 실패: scheduleId=${scheduleId}`, error);
    throw error;
  }
}


// 🔧 향상된 스케줄 알림 전송 (다중 사용자 지원)
export async function sendScheduleNotificationToUsers(userIds, title, body, scheduleId) {
  try {
    const failedUids = [];
    
    // 각 사용자에게 개별 알림 생성 및 전송
    for (const uid of userIds) {
      try {
        // createNotification이 DB 저장 + FCM 전송을 모두 처리
        await createNotification(uid, title, body, `/schedule/${scheduleId}`);
        console.log(`✅ 스케줄 알림 전송 성공: ${uid}`);
      } catch (error) {
        failedUids.push(uid);
        console.error(`❌ 스케줄 알림 전송 실패 (${uid}):`, error.message);
      }
    }
    
    const successCount = userIds.length - failedUids.length;
    console.log(`📊 간단 스케줄 알림 결과 - 성공: ${successCount}, 실패: ${failedUids.length}, 총: ${userIds.length}`);
    
    return failedUids;
  } catch (error) {
    console.error("❌ 간단 스케줄 알림 전송 중 오류:", error);
    throw error;
  }
}