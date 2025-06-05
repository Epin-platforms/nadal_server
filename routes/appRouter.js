import express from "express";
import {getAd, getBanner, getLeagues, reportSave } from "../controllers/appController.js";
import { createQnA, deleteQna, getFaQ, getQnA } from "../controllers/qna/qnaController.js";
const router = express.Router();

//위치별 배너 가져오기
router.get('/banner/:position', getBanner);

//대회 목록 가져오기
router.get('/league', getLeagues);

//광고 가져오기
router.get('/ad', getAd);

//문의하기
router.get('/qna', getQnA);
router.get('/faq', getFaQ);
router.post('/qna/create', createQnA);
router.delete('/qna/delete', deleteQna);


router.post('/report', reportSave);
export default router;