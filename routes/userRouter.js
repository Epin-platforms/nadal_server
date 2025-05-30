import express from "express";
import { createFriend, createMyTeam, createWallet, deleteFriend, getFriendCheckWithUid, getFriends, getFriendsByPhone, getGameMemory, getProfile, getUserWithFid, getWallet, myTeamWithRoomId, searchWithNumber, updateAffiliation, updateClientProfile, updateDBProfile, updateMarketing } from "../controllers/auth/userController.js";
import { login } from "../controllers/auth/loginController.js";
import { signUp } from "../controllers/auth/signupController.js";
import { upload } from "../config/multer.js";
import { deviceUpdate, turnOffDevice } from "../controllers/auth/deviceController.js";
import { createAccount, getAccounts, getAccount, delteAccount, updateAccount } from "../controllers/account/accountController.js";
import { checkActiveRoomsAndSchedule, cancelUser } from "../controllers/auth/cancelController.js";
import { verificationUpdate } from "../controllers/auth/verificationController.js";
const router = express.Router();

//최초 가입후
router.post('/login', login);
router.post('/signUp', signUp);

//사용자 주기적인 업데이트
router.put('/deviceUpdate', deviceUpdate); 
router.post('/my', updateClientProfile);

//사용자 변경 사항 업데이트
router.put('/update', upload.single('profileImage'), updateDBProfile);
router.put('/verification', verificationUpdate);

//사용자 계좌가져오기
router.get('/account', getAccounts);
router.get('/account/only/:accountId', getAccount);
router.post('/account/create', createAccount);
router.delete('/account', delteAccount);
router.put('/account-update', updateAccount);

//사용자 팀불러오기
router.get('/team', myTeamWithRoomId);
router.post('/team', createMyTeam);

//사용자 로그아웃
router.put('/session/turnOff', turnOffDevice);

//정보수정
router.put('/update/affiliation', updateAffiliation);
router.put('/update/marketing', updateMarketing);

//사용자 탈퇴
router.post('/cancel', cancelUser);
router.get('/cancel/check', checkActiveRoomsAndSchedule);

//특정 사용자 정보 불러오기
router.get('/profile/:uid', getProfile);
router.get('/profile-game', getGameMemory);
router.get('/friend/:uid', getFriendCheckWithUid);

//친구 신청, 취소
router.get('/friends', getFriends);
router.delete('/friend/:uid', deleteFriend);
router.post('/friend/:uid', createFriend);

//사용자 검색
router.post('/friends/find-by-phone', getFriendsByPhone);
router.get('/search', searchWithNumber);

//재업데이트를 위한 사용자불러오기
router.get('/add/friend', getUserWithFid);

//지갑
router.post('/wallet/get', getWallet);
router.post('/wallet/create', createWallet);


//회원탈퇴
router.put('/cancel', cancelUser);


export default router;