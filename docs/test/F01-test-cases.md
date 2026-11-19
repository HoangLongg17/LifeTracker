# Danh sách Test Case Kiểm thử Chức năng F01 (Quản lý Tài khoản và Hồ sơ)

- **Dự án:** Life Tracker
- **Phạm vi yêu cầu:** FR-01.01 – FR-01.06, UC-01 – UC-03, NFR-01 – NFR-08, NFR-11
- **Ca nghiệm thu liên quan:** AT-01, AT-02, AT-03, AT-04, AT-35, AT-38
- **Môi trường:** Backend Node.js/Express (`localhost:3000`), Firebase Auth & Firestore (`lifetracker-dev-14382`), Mobile Expo Android.

## 1. Nhóm Luồng chính End-to-End (Đăng ký → Đăng nhập → Hồ sơ → Đăng xuất)

| Mã TC | Tên Test Case | Tham chiếu | Điều kiện tiên quyết | Các bước thực hiện | Kết quả mong đợi |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-F01-01** | Đăng ký tài khoản mới hợp lệ và chấp thuận phạm vi | FR-01.01, FR-01.05, UC-01, AT-01 | Chưa đăng nhập; email chưa tồn tại trên Firebase Auth. | 1. Mở màn hình *Tạo tài khoản*.<br>2. Nhập email hợp lệ, mật khẩu $\ge 8$ ký tự, nhập lại mật khẩu khớp.<br>3. Tick chọn ô xác nhận đọc thông tin dữ liệu cá nhân.<br>4. Bấm *Tạo tài khoản*. | - Firebase Auth tạo `UID` mới.<br>- Backend tạo 1 bản ghi `users` (kèm `consentVersion`) và 1 bản ghi `profiles`.<br>- Không lưu mật khẩu trong Firestore.<br>- Chuyển sang màn hình chính / hoàn thiện hồ sơ. |
| **TC-F01-02** | Khởi tạo hồ sơ Idempotent (chống trùng khi gọi lại) | FR-01.01, UC-01, AT-01 | Đã có `ID Token` của tài khoản mới tạo. | 1. Gửi request khởi tạo hồ sơ lần 1.<br>2. Gửi lặp lại chính xác request đó lần 2 với cùng `UID`. | - Chỉ tồn tại duy nhất 1 document `users/{uid}` và `profiles/{uid}`.<br>- Không phát sinh lỗi 500 hoặc nhân đôi dữ liệu. |
| **TC-F01-03** | Đăng nhập thành công và tải hồ sơ hiện tại | FR-01.02, UC-02 | Tài khoản `applon@gmail.com` đã tồn tại. | 1. Mở màn hình *Đăng nhập*.<br>2. Nhập đúng email và mật khẩu.<br>3. Bấm *Đăng nhập*. | - SDK nhận Firebase ID Token.<br>- App gọi `GET /api/v1/me/profile` kèm `Bearer <token>` thành công (`200 OK`).<br>- Hiển thị đúng tên hiển thị và email trên màn hình *Hồ sơ cá nhân*. |
| **TC-F01-04** | Cập nhật thông tin hồ sơ và lưu lịch sử cân nặng | FR-01.03, UC-03, AT-04 | Đã đăng nhập. | 1. Mở *Thông tin cá nhân*.<br>2. Nhập tên hiển thị, ngày sinh `1995-05-15`, chiều cao `170` cm, cân nặng `65` kg, mức vận động *Vừa phải*, múi giờ `Asia/Ho_Chi_Minh`.<br>3. Bấm *Lưu thông tin*. | - API `PATCH /api/v1/me/profile` trả `200 OK`, `version` tăng lên 1.<br>- `currentWeightKg = 65` và tạo thêm 1 bản ghi mới trong lịch sử cân nặng (`weightLogs`), không ghi đè số đo cũ. |
| **TC-F01-05** | Hồ sơ tối thiểu (bỏ trống trường không bắt buộc REE) | FR-01.06, NFR-08 | Tài khoản mới chưa nhập chiều cao, cân nặng, `sexForEquation`. | 1. Đăng nhập với hồ sơ chỉ có tên hiển thị.<br>2. Truy cập các chức năng ghi nhật ký nước/vận động. | - Hệ thống cho phép sử dụng bình thường, không ép nhập `sexForEquation` hoặc thông số REE. |
| **TC-F01-06** | Đăng xuất và xóa sạch trạng thái phiên cục bộ | FR-01.02, UC-02, AT-02, AT-38 | Đang đăng nhập tài khoản A (`applon@gmail.com`). | 1. Mở *Hồ sơ cá nhân*, bấm *Đăng xuất*.<br>2. Kiểm tra màn hình điều hướng.<br>3. Đăng nhập bằng tài khoản B khác. | - Thoát về màn hình *Đăng nhập*.<br>- Xóa toàn bộ cache/state hồ sơ của A.<br>- Tài khoản B không thấy bất kỳ thông tin nào của A. |

## 2. Nhóm Kiểm thử API & Xác thực Firebase Authentication

| Mã TC | Tên Test Case | Tham chiếu | Dữ liệu đầu vào / Hành động | Kết quả mong đợi |
| :--- | :--- | :--- | :--- | :--- |
| **TC-F01-07** | Gọi API cá nhân không đính kèm Token | FR-01.02, NFR-02, AT-02 | Gửi `GET /api/v1/me/profile` không có header `Authorization`. | Backend từ chối với mã `401 Unauthorized`, trả về mã lỗi chuẩn và `requestId`, không lộ stack trace. |
| **TC-F01-08** | Gọi API với Token giả mạo / sai chữ ký / hết hạn | NFR-02, AT-02 | Gửi `GET /api/v1/me/profile` với `Authorization: Bearer invalid.jwt.token` hoặc token đã hết hạn. | Backend `verifyIdToken` thất bại, trả về `401 Unauthorized`. |
| **TC-F01-09** | Đăng ký với Email đã tồn tại trên Firebase Auth | FR-01.01, UC-01 | Nhập `applon@gmail.com` ở màn hình *Tạo tài khoản* và bấm đăng ký. | Firebase báo lỗi `auth/email-already-in-use`; giao diện hiển thị thông báo tiếng Việt rõ ràng, giữ nguyên form để sửa. |
| **TC-F01-10** | Đăng nhập sai mật khẩu | FR-01.02, UC-02 | Nhập đúng email nhưng sai mật khẩu tại màn hình *Đăng nhập*. | Firebase từ chối; giao diện báo sai thông tin đăng nhập, không làm sập ứng dụng. |

## 3. Nhóm Kiểm thử Quyền Truy cập Dữ liệu (Authorization & BOLA/IDOR)

| Mã TC | Tên Test Case | Tham chiếu | Dữ liệu đầu vào / Hành động | Kết quả mong đợi |
| :--- | :--- | :--- | :--- | :--- |
| **TC-F01-11** | Giả mạo `userId` của người khác trong Payload cập nhật | BR-01, NFR-03, AT-03 | User A (token của A) gửi `PATCH /api/v1/me/profile` kèm body `{"userId": "<UID_của_B>", "displayName": "Hacked"}`. | Backend bỏ qua `userId` trong body, chỉ lấy `UID` của A từ token; hồ sơ của B hoàn toàn không bị thay đổi. |
| **TC-F01-12** | Nâng đặc quyền trái phép (`role: "admin"`) qua Payload | NFR-04, AT-03 | User A gửi `PATCH /api/v1/me/profile` kèm body `{"role": "admin", "status": "active"}`. | Backend lọc theo allowlist, từ chối hoặc bỏ qua trường `role`; User A vẫn giữ quyền `user` và bị chặn `403` khi gọi `/api/v1/admin/*`. |
| **TC-F01-13** | Truy cập trực tiếp Cloud Firestore từ Client SDK | Mục 9.2 SRS | Dùng Firebase Client SDK gọi `getDoc(doc(db, 'profiles', uidB))`. | Firestore Security Rules chặn truy cập trực tiếp (`Missing or insufficient permissions`). |

## 4. Nhóm Kiểm thử Dữ liệu Nhập Không Hợp Lệ & Biên Dữ Liệu

| Mã TC | Tên Test Case | Tham chiếu | Dữ liệu đầu vào / Hành động | Kết quả mong đợi |
| :--- | :--- | :--- | :--- | :--- |
| **TC-F01-14** | Đăng ký với email sai định dạng hoặc mật khẩu < 8 ký tự | FR-01.01, NFR-11 | Nhập email `abc@`, mật khẩu `1234567` (7 ký tự) hoặc mật khẩu nhập lại không khớp. | Client chặn ngay tại form với thông báo gắn dưới từng trường; không gửi request rác lên Firebase. |
| **TC-F01-15** | Đăng ký khi chưa tick xác nhận phạm vi & quyền riêng tư | FR-01.05 | Nhập đủ email và mật khẩu hợp lệ nhưng bỏ trống ô checkbox đồng ý. | Không cho phép tạo tài khoản; hiển thị nhắc nhở người dùng cần đọc và xác nhận thông tin dữ liệu cá nhân. |
| **TC-F01-16** | Cập nhật chiều cao hoặc cân nặng `<= 0` hoặc `NaN` | NFR-11, AT-35 | Gửi `PATCH /api/v1/me/profile` với `heightCm: -170` hoặc `currentWeightKg: 0`. | Backend trả `400 Bad Request` kèm `fieldErrors` chỉ rõ trường sai; không lưu vào Firestore. |
| **TC-F01-17** | Cập nhật chiều cao / cân nặng ngoài dải cảnh báo (50–250cm, 20–300kg) | Mục 7.1, AT-35 | Nhập cân nặng `350` kg trên form *Thông tin cá nhân* và bấm *Lưu thông tin*. | Hiển thị hộp thoại cảnh báo yêu cầu xác nhận lại số đo bất thường; chỉ lưu khi người dùng xác nhận. |
| **TC-F01-18** | Ngày sinh ở tương lai hoặc mâu thuẫn giữa Ngày sinh và Năm sinh | Mục 6.3, Mục 7.1 | Nhập `birthDate: "2030-01-01"` hoặc nhập đồng thời `birthDate: "1995-05-15"` và `birthYear: 1999`. | Backend từ chối với mã `400 Bad Request` và thông báo lỗi nhất quán thời gian. |
| **TC-F01-19** | Múi giờ IANA không hợp lệ | BR-05, NFR-11 | Gửi `timeZone: "Mars/Phobos"` hoặc chuỗi rỗng. | Backend từ chối với mã `400 Bad Request`. |

## 5. Nhóm Kiểm thử Lỗi Kết nối Backend / Firebase & Đồng thời

| Mã TC | Tên Test Case | Tham chiếu | Điều kiện & Hành động | Kết quả mong đợi |
| :--- | :--- | :--- | :--- | :--- |
| **TC-F01-20** | Mất kết nối mạng / Backend ngừng hoạt động khi cập nhật hồ sơ | FR-02.08, NFR-20 | Tắt server Node.js hoặc ngắt Wi-Fi trên thiết bị, sau đó bấm *Lưu thông tin* ở màn hình *Thông tin cá nhân*. | Ứng dụng không bị crash; giữ nguyên dữ liệu người dùng vừa nhập trên form và hiển thị thông báo lỗi kết nối để thử lại. |
| **TC-F01-21** | Firebase Auth đăng ký thành công nhưng Backend gặp lỗi khi tạo Profile | FR-01.01, UC-01 | Ngắt kết nối Backend ngay lúc bấm *Tạo tài khoản*; sau đó bật lại Backend và đăng nhập lại bằng tài khoản vừa tạo. | Lần đăng nhập lại tự động đồng bộ khởi tạo hồ sơ còn thiếu theo đúng `UID` ban đầu, đưa người dùng vào ứng dụng bình thường. |
| **TC-F01-22** | Xung đột cập nhật đồng thời (`409 Conflict`) | Mục 6.9, NFR-13, AT-36 | Hai phiên cùng đọc `profile` ở `version: 1`; phiên 1 cập nhật thành công (`version: 2`); phiên 2 gửi cập nhật kèm `version: 1`. | Backend phát hiện `version` cũ, trả về `409 Conflict` để client tải lại bản mới nhất trước khi ghi đè. |