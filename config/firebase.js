// firebase.js
import admin from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import fs from 'fs';

// 중복 초기화 방지: Firebase 앱이 이미 초기화된 경우 새로 초기화하지 않음
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(fs.readFileSync(process.env.FIREBASE_KEY_LOCATION, 'utf8'))
    ),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const bucket = getStorage().bucket();

export { admin, bucket };
