import express from "express";
import { deleteComment, getCommentWithScheduleId, updateComment, writeComment } from "../controllers/comment/commentController.js";
const router = express.Router();

router.get('/:scheduleId', getCommentWithScheduleId);

//생성 삭제
router.post('/write', writeComment);
router.delete('/:commentId', deleteComment);

//수정
router.put('/:commentId', updateComment);

export default router; 