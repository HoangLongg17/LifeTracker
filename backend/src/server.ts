import { db } from "./config/firebase";
import "dotenv/config";
import express from "express";

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Cho phép Backend nhận dữ liệu JSON
app.use(express.json());

// API kiểm tra Backend
app.get("/health", (_req, res) => {
    res.status(200).json({
        status: "success",
        message: "Life Tracker Backend is running"
    });
});

app.get("/health/firestore", async (_req, res) => {
  try {
    // Chỉ đọc một tài liệu kiểm tra, không tạo dữ liệu mới
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


// Khởi động máy chủ
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend đang chạy tại http://localhost:${PORT}`);
});
