import { logsRouter } from './routes/logs';
import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { profileRouter } from "./routes/profile";

import "dotenv/config";
import express from "express";
import cors from "cors";
import { db } from "./config/firebase";

const app = express();

// Cho phép Backend nhận dữ liệu JSON
app.use(express.json());
if (process.env.NODE_ENV === "development") {
  // Expo Web runs on another port of the same development machine.
  app.use(cors((req: express.Request, callback) => {
    let allowed = false;
    try {
      const origin = new URL(req.get("Origin") ?? "");
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
      allowed = ["http:", "https:"].includes(origin.protocol) && (local || origin.hostname === req.hostname);
    } catch {
      // Native clients do not send an Origin header.
    }
    callback(null, { origin: allowed });
  }));
}
app.use(profileRouter(getAuth(), db));
app.use(logsRouter(getAuth(), db));

// Kiểm tra trạng thái Backend
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "success",
    message: "Life Tracker Backend is running",
  });
});

// Chỉ cho phép kiểm tra Firestore trong development
if (process.env.NODE_ENV === "development") {
  app.get("/health/firestore", async (_req, res) => {
    try {
      // Resolve ADC before starting the Firestore gRPC client so a missing credential is reported here.
      if (!process.env.FIRESTORE_EMULATOR_HOST) await getApp().options.credential?.getAccessToken();
      await db.collection("setupChecks")
        .doc("connection")
        .get();

      res.status(200).json({
        status: "success",
        message: "Firestore connected successfully",
      });
    } catch (error) {
      console.error("Firestore connection error:", error);

      res.status(500).json({
        status: "error",
        message: "Firestore connection failed",
      });
    }
  });
}

export default app;
