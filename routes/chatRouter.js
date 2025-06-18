import express from "express";
import { upload } from "../config/multer.js";
import { saveChat } from "../controllers/chat/sendController.js";
import { getChats, getChatsAfter, getChatsBefore, reconnectChat, removeChat } from "../controllers/chat/chatController.js";

const router = express.Router();

router.post('/send', upload.array('image'), saveChat);
router.get('/chat', getChats);

router.put('/remove/:chatId', removeChat);

router.get('/chatsBefore', getChatsBefore);
router.get('/chatsAfter', getChatsAfter);


//재연결시 
router.get('/reconnect', reconnectChat);
export default router; 
