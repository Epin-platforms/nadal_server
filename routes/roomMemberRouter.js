import express from "express";
import { updateMyMemberAlarm } from "../controllers/roomMember/myMemberController.js";
import { changedMemberGrade, exitRoom, getMyRoomMemberDataWithRoomId, getRoomMembers, kickedMember, updateLastRead } from "../controllers/roomMember/roomMemberController.js";

const router = express.Router();

router.get('/my/:roomId', getMyRoomMemberDataWithRoomId);

router.get('/:roomId', getRoomMembers);

//알람 업데이트
router.put('/alarm', updateMyMemberAlarm);

//마지막 읽은 시간 업데이트
router.put('/lastread/:roomId', updateLastRead);

//룸 나가기
router.delete('/exit/:roomId', exitRoom);

//방에서 추방하기
router.post('/kick', kickedMember);

//방 멤버 권한 업데이트
router.put('/grade', changedMemberGrade);
export default router;