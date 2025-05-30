import express from "express";
import { deleteSchedule, getScheduleWithScheduleId, getSchedulesWithRoomId, getSchedulesWithUid, updateSchedule } from "../controllers/schedule/scheduleController.js";
import { createSchedule } from "../controllers/schedule/create/scheduleCreateController.js";
import { cancelScheduleParticipation, cancelScheduleParticipationTeam, participationSchedule, participationScheduleWithTeam } from "../controllers/scheduleMember/scheduleParticipateController.js";
import { memberWithQuery, memberWithRoomId } from "../controllers/schedule/team/teamController.js";
const router = express.Router();

//내스케줄 불러오기
router.get('/my' , getSchedulesWithUid);

//스케줄 생성
router.post('/create', createSchedule);
router.delete('/:scheduleId', deleteSchedule);
router.put('/update', updateSchedule);

//스케줄 참가/취소
router.post('/participation', participationSchedule);
router.delete('/participationCancel/:scheduleId', cancelScheduleParticipation);

//팀참가
router.get('/team/init', memberWithRoomId);
router.get('/team/search', memberWithQuery);
router.post('/participation/team', participationScheduleWithTeam);
router.delete('/participationCancel/team/:scheduleId', cancelScheduleParticipationTeam);


//방 스케줄 가져오기
router.get('/room/:roomId', getSchedulesWithRoomId);


//특정스케줄 가져오기
router.get('/:scheduleId', getScheduleWithScheduleId);

//스케줄 업데이트
router.put('/update', updateSchedule);

export default router;