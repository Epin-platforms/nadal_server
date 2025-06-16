import express from "express";
import { deleteRoom, getLastAnnounceWithRoomId, getMyRooms, getRoomByRoomId, updateDBRoom} from "../controllers/room/roomController.js";
import { getMyRoomsForEditAffiliation } from "../controllers/auth/affiliationController.js";
import { createRoom } from "../controllers/room/createController.js";
import { upload } from "../config/multer.js";
import { autoTextSearchRooms, recommendRooms, searchRooms } from "../controllers/room/searchController.js";
import {  getPreviewRoom, registerRoom } from "../controllers/room/previewController.js";
import { getRoomLogs } from "../controllers/room/log/logController.js";
import { getHotQuickRooms, getMyLocalQuickChat } from "../controllers/room/quickChatController.js";

const router = express.Router();

// 입력 검증 미들웨어
const validateSearchQuery = (req, res, next) => {
    const { text } = req.query;
    
    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Search text is required' });
    }
    
    const trimmedText = text.trim();
    if (trimmedText.length < 1 || trimmedText.length > 100) {
        return res.status(400).json({ error: 'Search text must be between 1 and 100 characters' });
    }
    
    // SQL 인젝션 방지를 위한 기본 패턴 체크
    const dangerousPatterns = [
        /--/,           // SQL 주석
        /\/\*/,         // SQL 블록 주석  
        /;.*drop/i,     // DROP 명령어
        /;.*delete/i,   // DELETE 명령어
        /;.*update/i,   // UPDATE 명령어
        /;.*insert/i,   // INSERT 명령어
        /union.*select/i, // UNION SELECT
    ];
    
    for (const pattern of dangerousPatterns) {
        if (pattern.test(trimmedText)) {
            return res.status(400).json({ error: 'Invalid characters in search text' });
        }
    }
    
    next();
};

// 오프셋 검증 미들웨어
const validateOffset = (req, res, next) => {
    const offset = Number(req.query.offset) || 0;
    if (offset < 0 || offset > 10000) {
        return res.status(400).json({ error: 'Invalid offset value' });
    }
    req.query.offset = offset;
    next();
};

// 에러 핸들링 미들웨어
const handleAsyncError = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

//내가 참가하고있는 클럽들 불러오기
router.get('/affiliation', handleAsyncError(getMyRoomsForEditAffiliation));

//홈에서 참가하고있는 방정보 불러오기
router.get('/rooms', handleAsyncError(getMyRooms));

//방 생성하기
router.post('/create', handleAsyncError(createRoom));

//방 정보다시가져오기
router.get('/reGet/:roomId', handleAsyncError(getRoomByRoomId));

//방 정보 업데이트
router.put('/update', upload.single('roomImage'), handleAsyncError(updateDBRoom));
router.get('/lastAnnounce', handleAsyncError(getLastAnnounceWithRoomId));

//방검색 기능 - 검증 미들웨어 적용
router.get('/recommend', handleAsyncError(recommendRooms));
router.get('/autoText', validateSearchQuery, handleAsyncError(autoTextSearchRooms));
router.get('/search', validateSearchQuery, validateOffset, handleAsyncError(searchRooms));

//방 미리보기
router.get('/preview/:roomId', handleAsyncError(getPreviewRoom));

//방 가입하기
router.post('/register/:roomId', handleAsyncError(registerRoom));

//방 로그 불러오기
router.get('/log', handleAsyncError(getRoomLogs));

//방제거
router.delete('/:roomId', handleAsyncError(deleteRoom));

//번개챗 방
router.get('/my-local-quick', handleAsyncError(getMyLocalQuickChat));
router.get('/hot-quick-rooms', handleAsyncError(getHotQuickRooms));

// 에러 핸들링
router.use((error, req, res, next) => {
    console.error('Room router error:', error);
    
    if (error.code === 'ER_BAD_FIELD_ERROR') {
        return res.status(400).json({ error: 'Invalid query parameters' });
    }
    
    if (error.code === 'ER_PARSE_ERROR') {
        return res.status(400).json({ error: 'Database query error' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
});

export default router;