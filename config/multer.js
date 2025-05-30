import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() }); // ✅ 메모리로 파일 받기

export { upload };
