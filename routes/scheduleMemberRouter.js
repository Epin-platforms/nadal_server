import express from "express";
import { getOnlyScheduleMembersForUpdate, updateScheduleMember } from "../controllers/scheduleMember/scheduleMemberController.js";

const router = express.Router();

///스케줄 참가, 취소는 스케줄 라우터에 존재

router.get('/:scheduleId', getOnlyScheduleMembersForUpdate);

//사용자 거절, 승인
router.put('/updateApproval', updateScheduleMember);


export default router;