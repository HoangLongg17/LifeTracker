
import "dotenv/config";
import express from "express";
import { db } from "./config/firebase";

const app = express();

// Cho phép Backend nhận dữ liệu JSON
app.use(express.json());

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
