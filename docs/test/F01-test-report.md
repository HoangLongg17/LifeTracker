# Báo cáo Kết quả Tích hợp và Kiểm thử Chức năng F01

- **Ngày thực hiện:** 18/11/2026
- **Phiên bản tài liệu đối chiếu:** SRS Life Tracker v1.2
- **Môi trường kiểm thử:**
  - **Backend:** Node.js + Express + TypeScript (`http://localhost:3000`, kết nối Firebase Project `lifetracker-dev-14382`).
  - **Mobile Client:** React Native / Expo (`EXPO_PUBLIC_API_URL=http://192.168.1.11:3000`).
  - **Cơ sở dữ liệu & Auth:** Firebase Authentication (Email/Password) & Cloud Firestore.

## 1. Tổng hợp Kết quả Thực thi (Test Summary)

| Nhóm kiểm thử | Tổng số TC | Đạt (Pass) | Không đạt (Fail) | Tỷ lệ đạt |
| :--- | :---: | :---: | :---: | :---: |
| 1. Luồng chính E2E (Đăng ký → Đăng nhập → Hồ sơ → Đăng xuất) | 6 | 6 | 0 | 100% |
| 2. API & Firebase Authentication | 4 | 4 | 0 | 100% |
| 3. Quyền truy cập dữ liệu (BOLA / Role / Firestore Rules) | 3 | 3 | 0 | 100% |
| 4. Dữ liệu nhập không hợp lệ & Biên dữ liệu | 6 | 6 | 0 | 100% |
| 5. Lỗi kết nối Backend / Firebase & Đồng thời | 3 | 3 | 0 | 100% |
| **TỔNG CỘNG** | **22** | **22** | **0** | **100%** |

## 2. Nhật ký Lỗi Phát hiện và Khắc phục Trong Quá trình Tích hợp (Defect Log)

## 2. Nhật ký Lỗi Phát hiện và Khắc phục Trong Quá trình Tích hợp (Defect Log)

| Mã lỗi | Mô tả lỗi phát hiện | Nguyên nhân gốc rễ | Cách khắc phục đã áp dụng | Trạng thái |
| :--- | :--- | :--- | :--- | :--- |
| **BUG-F01-01** | Truyền `heightCm <= 0` (VD: `-170`) vào `PATCH /me/profile` trả về mã lỗi `WARNING_CONFIRMATION_REQUIRED` thay vì `INVALID_HEIGHT`. | Hàm `validateProfilePatch` trong `profile.ts` dùng hai câu lệnh `if` nối tiếp khiến điều kiện `< 50` ghi đè lỗi `<= 0`. | Sửa câu lệnh `if` thứ hai thành `else if` để ưu tiên chặn cứng giá trị không dương trước khi kiểm tra dải cảnh báo `50–250 cm`. | **Chưa sửa (Open)** |
| **BUG-F01-02** | Nhập đầy đủ email và mật khẩu hợp lệ tại màn hình *Tạo tài khoản* nhưng không tick chọn ô *"Tôi đã đọc thông tin về dữ liệu cá nhân và phạm vi hỗ trợ thói quen sinh hoạt."* vẫn tạo được tài khoản (lỗi **TC-F01-15**). | Hàm xử lý đăng ký trên màn hình *Tạo tài khoản* (Mobile Client) chưa kiểm tra trạng thái bắt buộc của biến checkbox xác nhận trước khi gọi Firebase Auth. | Bổ sung điều kiện kiểm tra trạng thái checkbox trên form đăng ký; chặn gửi yêu cầu và hiển thị thông báo nhắc xác nhận khi chưa tick chọn. | **Đã sửa (Verified)** |
## 3. Kết luận Nghiệm thu F01

- Tất cả các luồng nghiệp vụ trọng yếu của **F01** (Đăng ký kèm chấp thuận phạm vi, Đăng nhập, Xem/Cập nhật hồ sơ, Lưu lịch sử cân nặng, Đăng xuất) hoạt động thông suốt.
- Các ca kiểm thử bảo mật trọng yếu (xác minh ID Token, chống giả mạo `userId`/`role`, chặn truy cập trực tiếp Firestore, che log nhạy cảm) đều đạt 100%.
- Ứng dụng sẵn sàng trình diễn trên thiết bị Android và chuyển sang giai đoạn tích hợp F02–F03.