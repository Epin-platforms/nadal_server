import express from "express";
import {createFAQ, createQnA, deleteBanner, deleteQna, getApp, getBanner, getBannerAll, getCommunityBanners, getFaQ, getQnA, getQnAForManage, getReportForManage, insertBanner, reportComplete, reportSave, totalQnaCount, updateAnswer, updateBannerVisible, updateUrl } from "../controllers/appController.js";
const router = express.Router();

router.get('/app', getApp);
router.get('/app/update/url', updateUrl);
router.get('/communityBanner', getCommunityBanners);
router.get('/banner', getBanner);

router.get('/frequency/all', getFaQ);
router.get('/questionAndAnswer/:uid', getQnA);
router.post('/questionAndAnswer/create', createQnA);

router.post('/report', reportSave);


//관리자용
router.get('/banner/all', getBannerAll);
router.post('/banner/create', insertBanner);
router.put('/banner/update/visible', updateBannerVisible);
router.delete('/banner/delete', deleteBanner);

router.get('/report/all', getReportForManage);
router.put('/report/complete', reportComplete);

router.get('/question/total', totalQnaCount);
router.get('/question/all', getQnAForManage);
router.post('/question/faq/create', createFAQ);
router.put('/question/answer/update', updateAnswer);
router.delete('/question/delete', deleteQna);
export default router;