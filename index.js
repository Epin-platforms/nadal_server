import 'dotenv/config'; // dotenv 초기화 (전역 설정)
import http from "http";
import express from "express";
import { bucket } from './config/firebase.js';
import pool from './config/database.js';
import cors from 'cors';

//라우터
import userRouter from './routes/userRouter.js';
import scheduleRouter from './routes/scheduleRouter.js';
import scheduleMemberRouter from './routes/scheduleMemberRouter.js'; 
import notificationRouter from './routes/notificationRouter.js';
import gameRouter from './routes/gameRouter.js';
import roomRouter from './routes/roomRouter.js';
import roomMemberRouter from './routes/roomMemberRouter.js';
import appRouter from './routes/appRouter.js';
import commentRouter from './routes/commentRouter.js';
import chatRouter from './routes/chatRouter.js';

import { setupWebSocket } from "./socket/websocket.js";
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { authenticateToken } from './middlewares/authMiddleware.js';
import { initScheduler } from './serverSchedule.js';
import { loadKDKDoubleRules, loadKDKSingleRules } from './config/gameTable.js';

const app = express();

app.use(express.json());
app.use(cors());

//
app.use('/user', authenticateToken, userRouter);
app.use('/schedule', authenticateToken, scheduleRouter);
app.use('/scheduleMember', authenticateToken, scheduleMemberRouter);
app.use('/notification', authenticateToken, notificationRouter);
app.use('/game', authenticateToken, gameRouter);
app.use('/room', authenticateToken, roomRouter);
app.use('/roomMember', authenticateToken, roomMemberRouter);
app.use('/comment', authenticateToken, commentRouter);
app.use('/app', authenticateToken, appRouter);
app.use('/chat', authenticateToken, chatRouter);

//웹소켓 서버 지정 
const server = http.createServer(app);
setupWebSocket(server);


//스케줄러 등록
initScheduler();

//서버에 파일 적제
await loadKDKSingleRules();
await loadKDKDoubleRules();


//파이어베이스 이미지 업로드
//이미지 업로드
const upload = multer();

app.post('/upload/image', upload.single('image'), async (req, res) => {
    try {
      const { dir, type, hash } = req.body;
  
      // 중복 확인
      if(!req.file){
        return res.status(400).json({ error: '이미지가 필요합니다.' });
    }

      if(type == '0'){ //타입이 0. (삭제가능)
        const [existingImage] = await pool.query(
            `SELECT * FROM images WHERE hash = ?`, //삭제가능이미지중 해쉬값이 있다면
            [hash]
          );
      
          if (existingImage.length > 0) {
            await pool.query(`
                    UPDATE images
                    SET createAt = NOW()
                    WHERE hash = ?;
                `, [hash]);
            console.log('중복된 이미지 발견:', existingImage[0].url), '이고, 시간을 업데이트 하여 저장기간을 연장했습니다';
            return res.status(200).json({ path: existingImage[0].url });
          }
      }
  
      // 이미지 저장 및 DB 삽입 로직 
      const fileName = `${dir || uuidv4()}.jpg`;

      const imageBuffer = req.file.buffer;
      const jpgImage = await sharp(imageBuffer).jpeg().toBuffer();
      const file = bucket.file(fileName);

        await file.save(jpgImage, {
                metadata : {contentType: 'image/jpeg'},
                public: true
        });

      const fileUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      console.log('저장된 파일 URL:', fileUrl);
  
      //동일한 url이 있는지 미리 체크
      const [rows] = await pool.query(
        `SELECT * FROM images WHERE url = ?;`,  [fileUrl]
      );

      //동일한 url이있다면 기존 컬럼에서 수정
      if(rows.length > 0){
        await pool.query(
            `UPDATE images 
             SET path = ?, type = ?, hash = ?
             WHERE url = ?;
            `,
            [fileName, type || 0, hash, fileUrl]
          );
      }else{
        await pool.query(
            `INSERT INTO images (url, path, type, hash) VALUES (?, ?, ?, ?)`,
            [fileUrl, fileName, type || 0, hash]
          );
      }
  
      res.json({ path: fileUrl });
    } catch (error) {
      console.error('이미지 업로드 실패:', error);
      res.status(500).send();
    }
  });
  




// 서버 실행
const port = process.env.PORT || 3001;

server.listen(port, "0.0.0.0", (error) => {
    if (error) {
        console.error('서버 실행 중 오류 발생:', error);
    } else {
        console.log(`Server is running`);
    }
});