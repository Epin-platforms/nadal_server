import express from "express";
import { getGameTables, getGames, getLevelWithScheduleId, updateCourt, updateScore } from "../controllers/game/gameController.js";
import { startGameSet, updateMemberIndex } from "../controllers/game/startController.js";
import { updateStep } from "../controllers/game/stateController.js";
import { createDoubleKDK, createDoubleTournament, createSingleKDK, createSingleTournament } from "../controllers/game/tableController.js";
import { saveDoubleKDK, saveSingleKDK } from "../controllers/game/end/kdk/kdkController.js";
import { nextRound } from "../controllers/game/roundController.js"
import { saveDoubleTournament, saveSingleTournament } from "../controllers/game/end/tournament/tournamentController.js";

const router = express.Router();

router.get('/profile/:uid', getGames);

//게임 상태변화
router.put('/state', updateStep);

//게임 시작
router.put('/start/:scheduleId', startGameSet);
router.put('/member/indexUpdate', updateMemberIndex);

//게임테이블 생성
router.post('/createTable/singleKDK', createSingleKDK);
router.post('/createTable/doubleKDK', createDoubleKDK);
router.post('/createTable/singleTournament', createSingleTournament);
router.post('/createTable/doubleTournament', createDoubleTournament);

//게임 테이블 불러오기
router.get('/table/:scheduleId', getGameTables);

//게임 내용 수정
router.put('/court', updateCourt);
router.put('/score', updateScore);

//토너먼트 라운드
router.put('/nextRound', nextRound);

//게임 종료
router.post('/end/singleKDK/:scheduleId', saveSingleKDK);
router.post('/end/doubleKDK/:scheduleId', saveDoubleKDK);
router.post('/end/singleTournament/:scheduleId', saveSingleTournament);
router.post('/end/doubleTournament/:scheduleId', saveDoubleTournament);


//사용자 결과 값 가져오기
router.get('/result/:scheduleId', getLevelWithScheduleId);

export default router;