
import "dotenv/config";
import {
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  throw new Error("Chưa cấu hình FIREBASE_PROJECT_ID");
}

const firebaseApp =
  getApps()[0] ??
  initializeApp({
    credential: applicationDefault(),
    projectId,
  });

export const db = getFirestore(firebaseApp);
