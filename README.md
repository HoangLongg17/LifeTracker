# Life Tracker

Ứng dụng di động hỗ trợ theo dõi thói quen sinh hoạt,
quản lý mục tiêu và tổng hợp dữ liệu sức khỏe cá nhân.

## 1. Công nghệ sử dụng

### Mobile

- React Native
- Expo SDK 58
- TypeScript
- Firebase Authentication

### Backend

- Node.js
- Express.js
- TypeScript
- Firebase Admin SDK

### Database

- Cloud Firestore

## 2. Cấu trúc dự án

```text
LifeTracker/
├── mobile/                    # Ứng dụng React Native + Expo
├── backend/                   # API Node.js + Express
├── firebase.json              # Cấu hình Firebase CLI
├── firestore.rules            # Quy tắc bảo mật Cloud Firestore
├── firestore.indexes.json     # Cấu hình chỉ mục Firestore
├── .nvmrc                     # Phiên bản Node.js khuyến nghị
├── .gitignore                 # Danh sách file không đưa lên Git
└── README.md                  # Tài liệu hướng dẫn dự án
```

## 3. Yêu cầu môi trường

Cần cài đặt:

- Node.js và npm phiên bản tương thích với Expo
- VS Code hoặc trình soạn thảo tương đương
- Expo Go trên điện thoại Android
- Google Cloud CLI (khi cần chạy Backend với Firestore)

Điện thoại và máy tính cần kết nối cùng mạng nội bộ
để Mobile truy cập Backend đang chạy trên laptop.

### Yêu cầu phiên bản Node.js

Dự án Life Tracker sử dụng Node.js 24 cho cả Mobile và Backend.

- Phiên bản hỗ trợ: `>=24.12.0 <25`
- Phiên bản khuyến nghị: `24.13.0`
- Công cụ quản lý thư viện: npm

Kiểm tra môi trường:

```powershell
node -v
npm -v
```

Cài đặt thư viện Backend:

```powershell
cd backend
npm ci
```

Cài đặt thư viện Mobile (thực hiện từ thư mục gốc dự án):

```powershell
cd mobile
npm ci
```

**Lưu ý:**

- Sử dụng `.env.example` làm mẫu để thiết lập biến môi trường cục bộ.
- Không commit `.env`, `.env.local` hoặc thông tin bí mật lên GitHub.
- Các thành viên cần thống nhất phiên bản Node.js trước khi phát triển và kiểm thử.

## 4. Cài đặt Backend

Di chuyển vào thư mục Backend:

```bash
cd backend
npm install
```

Tạo file `.env` dựa trên `.env.example`:

```env
PORT=3000
NODE_ENV=development
FIREBASE_PROJECT_ID=lifetracker-dev-14382
```

Đối với môi trường phát triển cục bộ, đăng nhập
Google Cloud bằng tài khoản được cấp quyền:

```bash
gcloud auth application-default login
```

Chạy Backend:

```bash
npm run dev
```

Kiểm tra API:

http://localhost:3000/health

Kết quả mong muốn:

```json
{
  "status": "success",
  "message": "Life Tracker Backend is running"
}
```

## 5. Cài đặt Mobile

Di chuyển vào thư mục Mobile:

```bash
cd mobile
npm install
```

Tạo file `.env.local` dựa trên `.env.example`.

Cấu hình:

```env
EXPO_PUBLIC_API_URL=http://YOUR_LOCAL_IP:3000

EXPO_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_AUTH_DOMAIN
EXPO_PUBLIC_FIREBASE_PROJECT_ID=lifetracker-dev-14382
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=YOUR_STORAGE_BUCKET
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=YOUR_SENDER_ID
EXPO_PUBLIC_FIREBASE_APP_ID=YOUR_APP_ID
```

Thay YOUR_LOCAL_IP bằng IPv4 của máy chạy Backend.
Các giá trị Firebase lấy từ Firebase Console.

Chạy ứng dụng:

```bash
npx expo start
```

Mở Expo Go trên Android và quét mã QR.

## 6. Firebase

Firebase Project: LifeTracker-Dev

Project ID: lifetracker-dev-14382

Các dịch vụ sử dụng:

- Firebase Authentication: Email/Password
- Cloud Firestore: Lưu dữ liệu ứng dụng

Ứng dụng Mobile sử dụng Firebase Authentication
để xác thực người dùng.

Dữ liệu nghiệp vụ Firestore được truy cập thông qua
Backend sử dụng Firebase Admin SDK.

Backend phải xác minh Firebase ID Token và kiểm tra
quyền sở hữu dữ liệu trước khi cung cấp API nghiệp vụ.

## 7. Các chức năng đã kiểm thử

- Chạy ứng dụng Expo trên Android.
- Mobile gọi API Backend thành công.
- Backend truy cập Cloud Firestore thành công.
- Firebase Authentication đăng nhập bằng Email/Password.
- Duy trì trạng thái đăng nhập sau khi mở lại ứng dụng.

Lưu ý: Đây là các phép thử khởi tạo môi trường,
chưa phải kiểm thử toàn bộ chức năng Life Tracker.

## 8. Quy định bảo mật

Không commit các file:

- .env
- .env.local
- Firebase Service Account private key
- Thông tin xác thực Google Cloud
- node_modules

Chỉ chia sẻ các file .env.example để hướng dẫn cấu hình.

Không sử dụng Firebase Admin SDK trực tiếp trên Mobile.

API kiểm tra Firestore chỉ phục vụ môi trường phát triển;
phải xóa hoặc giới hạn truy cập trước khi triển khai công khai.

## 9. Quy trình Git

Không push trực tiếp lên main.

Mỗi thành viên làm việc trên nhánh riêng:

feature/<issue-id>-<description>

Sau khi hoàn thành:

1. Kiểm tra thay đổi.
2. Commit lên nhánh riêng.
3. Push nhánh lên GitHub.
4. Tạo Pull Request.
5. Chờ review trước khi merge.

## 10. Trạng thái dự án

Đã hoàn thành bước khởi tạo môi trường Mobile,
Backend và Firebase.

Các API nghiệp vụ, giao diện chính thức và cơ chế
phân quyền dữ liệu sẽ được triển khai ở các công việc
tiếp theo.
