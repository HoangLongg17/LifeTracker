
import { getApp, getApps, initializeApp } from "firebase/app";

import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// Cấu hình Firebase
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Kiểm tra các biến cấu hình bắt buộc
if (
  !firebaseConfig.apiKey ||
  !firebaseConfig.projectId ||
  !firebaseConfig.appId
) {
  throw new Error("Thiếu cấu hình Firebase trong .env.local");
}

// Khởi tạo Firebase App một lần
export const firebaseApp =
  getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig);

// Khởi tạo Authentication
function createAuth() {
  // Trên Web sử dụng cơ chế lưu phiên của trình duyệt
  if (Platform.OS === "web") {
    return getAuth(firebaseApp);
  }

  try {
    // Trên Android/iOS sử dụng AsyncStorage
    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (error: unknown) {
    // Hỗ trợ trường hợp Fast Refresh đã khởi tạo Auth
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "auth/already-initialized"
    ) {
      return getAuth(firebaseApp);
    }

    throw error;
  }
}

export const auth = createAuth();
