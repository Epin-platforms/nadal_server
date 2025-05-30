import express from "express";
import { createNotification, getNotifications, readNotification, removeNotification, updateFCMToken } from "../controllers/notification/notificationController.js";
const router = express.Router();

router.get('', getNotifications);
router.put('/read', readNotification);
router.post('/fcmToken', updateFCMToken);
router.post('/create', createNotification);
router.delete('/remove/:notificationId', removeNotification);
export default router;