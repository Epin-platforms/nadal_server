import pool from '../config/database.js';
import { admin } from '../config/firebase.js';


//배너 불러오기
export async function getBanner(req, res) {
   try {
      const position = req.params.position;

      // RAND() 함수에 괄호를 추가했습니다
      const q = `SELECT * FROM banner WHERE position = ? ORDER BY RAND() LIMIT 1;`;
      const [rows] = await pool.query(q, [position]);
      
      res.json(rows);
   } catch (error) {
      console.error('getBanner 오류:', error);
      res.status(500).json({ message: "서버 오류가 발생했습니다." });
   }
}

//대회 가져오기
export async function getLeagues(req, res) {
   try {
      const lastLeagueId = req.query.lastLeagueId;

      const q = `
         SELECT * FROM league
         WHERE (? IS NULL OR leagueId < ?)
         ORDER BY leagueId DESC
         LIMIT 10;
      `;

      const [rows] = await pool.query(q, [lastLeagueId, lastLeagueId]);

      res.json(rows);
   } catch (error) {
      console.error('리그 가져오기 오류:', error);
      res.status(500).json({ message: "서버 오류가 발생했습니다." });
   }
}

//광고 가져오기
export async function getAd(req, res) {
   try {
      const q = `
         SELECT * FROM advertisement
         ORDER BY Rand()
         LIMIT 1;
      `;

      const [rows] = await pool.query(q);

      if(rows.length == 0){
         return res.status(204).send();
      }

      const ad = rows[0];
      
      await pool.query(`UPDATE advertisement SET view = ? WHERE adId = ?`, [ad.view+1 , ad.adId]);

      res.json(ad);
   } catch (error) {
      console.error('리그 가져오기 오류:', error);
      res.status(500).json({ message: "서버 오류가 발생했습니다." });
   }
}






//신고 목록 확인
export async function reportSave(req, res) {
   try {
      const model = req.body;
      const {uid} = req.user;

      
      const target_id = model.target_type != "user" ? Number(model.target_id) : model.target_id;

      const q = `
         INSERT INTO report (reason, target_type, target_id, uid, description)
         values (?,?,?,?,?);
      `;

      const values = [
         model.reason,
         model.target_type,
         target_id,
         uid,
         model.description
      ];

      await pool.query(q, values);
      res.send();
   } catch (error) {
      console.error(error);
      res.status(500).send();
   }
}


//관리자용
 //배너
export async function getBannerAll(req, res) {
   try {
      const q = `
         SELECT * FROM bannerModel
      `
      const [rows] = await pool.query(q);

      res.json(rows);
   } catch (error) {
      console.error(error);
      res.status(500).send();
   }
}

//배너 추가
export async function insertBanner(req, res) {
   try{
      const banner = req.body;

      const q = `
         INSERT INTO bannerModel (image, link, isOnline)
         VALUES (?,?,?);
      `;

      const values = [
         banner.image,
         banner.link,
         banner.isOnline
      ];

      await pool.query(q, values);
      res.send();
   }catch(error){
      console.error(error);
      res.status(500).sned();
   }
}

//배너 공개 전환
export async function updateBannerVisible(req, res) {
   try {
      const {bannerId , visible} = req.body;
      const q = `
         UPDATE bannerModel
         SET visible = ?
         WHERE bannerId = ?;
      `;

      await pool.query(q, [visible, bannerId]);
      res.send();
   } catch (error) {
      console.error(error);
      res.status(500).send();
   }
}


//배너 삭제
export async function deleteBanner(req, res) {
   try {
      const bannerId = req.body.bannerId;
      const image = req.body.image;

      await updateImageType(image);

      const q = `
         DELETE FROM bannerModel
         WHERE bannerId = ?;
      `;

      await pool.query(q, [bannerId]);
      res.send();
   } catch (error) {
      console.error(error);
      res.status(500).send();
   }
}

//이미지 저장 고정 비활성화
export async function updateImageType(url){
    try{
      const removeImages = `
      UPDATE images
      SET type = 0
      WHERE url = ?;
   ` ;

    await pool.query(removeImages, [url]);
    
    return true;
    }catch(error){
      console.error(error);
      return false;
    }
}

//신고하기
export async function getReportForManage(req, res) {
   try {
      const limit = 10; // 한 페이지당 10개의 결과
      const page = parseInt(req.query.page) || 1; // 쿼리의 page 값
      const offset = (page - 1) * limit;

      const q = `
         SELECT * FROM report
         LIMIT ? OFFSET ?
      `;

      const countQ = `
         SELECT COUNT(*) AS total_count FROM report;
      `;

      const [rows] =  await pool.query(q, [limit, offset]);
      const count = await pool.query(countQ);
      const totalCount = count[0].total_count || 0;

      const json = {
         'data' : rows,
         'totalCount' : totalCount
      };

      res.json(json);
   } catch (error) {
      console.error(error);
      res.status(500).send();
   }
}

//신고하기 처리 완료
export async function reportComplete(req, res) {
   try {
      const {reportId, uid} = req.body;

      const q = `
         UPDATE report
         SET \`check\` = ?
         WHERE reportId = ?;
      `;

      await pool.query(q, [true, reportId]);
      await sendNotification(uid);
   } catch (error) {
      console.error(error);
      res.status(500).send();
   }
}

//처리 완료 알림 보내기
export async function sendNotification(uid) {
   try {
             // FCM 토큰 조회
        const q = `
        SELECT fcmToken FROM user
        WHERE uid = ?;
    `;
    const [rows] = await pool.query(q, [uid]);


    if (!rows.length || !rows[0].fcmToken) {
        console.error("유효한 FCM 토큰이 없습니다.");
        return;
    }

    const token = rows[0].fcmToken;

      // 데이터 온리 FCM 메시지 생성
      const msg = {
         data: {
             title: '신고하신 내용의 처리가 완료되었습니다',
             body: '더욱 좋은 서비스가 될 수 있도록 노력하겠습니다. 감사합니다',
             scheduleId: '',
             roomId: '',
             routing: '',
             collapseKey: "default_collapse_key", // 데이터를 통해 그룹화 키 전달
         },
         token: token,
     };

      // FCM 메시지 전송
      await admin.messaging().send(msg);
      console.log("데이터 온리 메시지 전송 성공:", msg);

   } catch (error) {
      console.error(error);
   }
}

//qna
export async function getQnAForManage(req, res) {
   try {
      const limit = 10; // 한 페이지당 10개의 결과
      const page = parseInt(req.query.page) || 1; // 쿼리의 page 값
      const offset = (page - 1) * limit;

      const q = `
      SELECT * FROM qna
      LIMIT ? OFFSET ?
      `;

      const [rows] = await pool.query(q, [limit, offset]);
      res.json(rows);
   } catch (error) {
      console.error(error);
      res.status(500).send();
   }
}


//전체 qna 총 수 불러오기
export async function totalQnaCount(req, res) {
   try {
      const q = `
         SELECT COUNT(*) AS totalCount FROM qna;
      `;

      const [result] = await pool.query(q);

      const totalCount = result[0]?.totalCount || 0 ;

      res.json({totalCount: totalCount});
   } catch (error) {
      console.error(error);
      res.status(500).send();
   }
}


