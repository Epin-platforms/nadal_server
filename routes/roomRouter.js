import express from "express";
import { deleteRoom, getLastAnnounceWithRoomId, getMyRooms, getRoomByRoomId, updateDBRoom} from "../controllers/room/roomController.js";
import { getMyRoomsForEditAffiliation } from "../controllers/auth/affiliationController.js";
import { createRoom } from "../controllers/room/createController.js";
import { upload } from "../config/multer.js";
import { autoTextSearchRooms, recommendRooms, searchRooms } from "../controllers/room/searchController.js";
import {  getPreviewRoom, registerRoom } from "../controllers/room/previewController.js";
import { getRoomLogs } from "../controllers/room/log/logController.js";


const router = express.Router();

//내가 참가하고있는 클럽들 불러오기
router.get('/affiliation', getMyRoomsForEditAffiliation),

//홈에서 참가하고있는 방정보 불러오기
router.get('/rooms', getMyRooms),

//방 생성하기
router.post('/create', createRoom);

//방 정보다시가져오기
router.get('/reGet/:roomId', getRoomByRoomId);

//방 정보 업데이트
router.put('/update', upload.single('roomImage'), updateDBRoom);
router.get('/lastAnnounce', getLastAnnounceWithRoomId);

//방검색 기능
router.get('/recommend', recommendRooms);
router.get('/autoText', autoTextSearchRooms);
router.get('/search', searchRooms);

//방 미리보기
router.get('/preview/:roomId', getPreviewRoom);

//방 가입하기
router.post('/register/:roomId', registerRoom);


//방 로그 불러오기
router.get('/log', getRoomLogs);

//방제거
router.delete('/:roomId', deleteRoom);


export default router;