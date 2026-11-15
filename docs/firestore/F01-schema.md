## 1. Cấu trúc cơ sở dữ liệu

Cấu trúc dữ liệu F01:

```text
Cloud Firestore
└── users
    └── {uid}
        └── profiles
            └── main
```

Đường dẫn:

- `/users/{uid}`: Thông tin tài khoản.
- `/users/{uid}/profiles/main`: Hồ sơ cá nhân.

Quy định:

- `{uid}` phải là UID được cấp bởi Firebase Authentication.
- Document ID của hồ sơ luôn là `main`.
- Không tạo collection `profiles` ở cấp gốc.
- Không sử dụng email làm Document ID.

## 2. Collection users

**Đường dẫn:** `/users/{uid}`

| Field                  | Kiểu Firestore | Yêu cầu                                    |
| ---------------------- | -------------- | ------------------------------------------ |
| `uid`                  | string         | Bắt buộc, bằng UID Firebase Authentication |
| `status`               | string         | Bắt buộc: active, deleting, disabled       |
| `role`                 | string         | Bắt buộc: user, admin                      |
| `createdAt`            | timestamp      | Bắt buộc, Backend quản lý                  |
| `updatedAt`            | timestamp      | Bắt buộc, Backend quản lý                  |
| `version`              | integer        | Bắt buộc, Backend quản lý                  |
| `dataRevision`         | integer        | Trường hệ thống                            |
| `consentVersion`       | string         | Có điều kiện khi ghi nhận chấp thuận       |
| `consentAt`            | timestamp      | Có điều kiện khi ghi nhận chấp thuận       |
| `eligibilityConfirmed` | boolean        | Có điều kiện, không tự đặt true            |

Quy định:

- Khi đăng ký thành công, Backend phải khởi tạo document theo UID đã xác minh.
- Với tài khoản thông thường, `role` là `user`.
- Không cho phép Mobile tự đặt hoặc sửa `role`, `status`, `version`.
- Không lưu mật khẩu, access token hoặc private key trong Firestore.
- Không tạo lại hoặc ghi đè hồ sơ đã có khi người dùng đăng nhập lại.

## 3. Subcollection profiles

**Đường dẫn:** `/users/{uid}/profiles/main`

| Field                     | Kiểu Firestore      | Yêu cầu                              |
| ------------------------- | ------------------- | ------------------------------------ |
| `displayName`             | string              | Tùy chọn                             |
| `birthDate`               | string (YYYY-MM-DD) | Có điều kiện, hoặc sử dụng birthYear |
| `birthYear`               | integer             | Có điều kiện, hoặc sử dụng birthDate |
| `heightCm`                | number              | Có điều kiện, đơn vị cm              |
| `currentWeightKg`         | number hoặc null    | Trường hệ thống từ lịch sử cân nặng  |
| `activityLevel`           | string              | Có điều kiện                         |
| `sexForEquation`          | string              | Có điều kiện khi chức năng cần       |
| `bodyFatPercent`          | number              | Tùy chọn                             |
| `preferredUnits`          | map                 | Tùy chọn                             |
| `notificationSettings`    | map                 | Bắt buộc                             |
| `healthSuggestionConsent` | boolean             | Có điều kiện khi có chấp thuận       |
| `timeZone`                | string              | Bắt buộc, ví dụ Asia/Ho_Chi_Minh     |
| `updatedAt`               | timestamp           | Bắt buộc, Backend quản lý            |
| `version`                 | integer             | Bắt buộc, Backend quản lý            |

Không yêu cầu người dùng nhập tất cả dữ liệu hồ sơ ngay khi đăng ký. Các trường có điều kiện chỉ được bổ sung khi chức năng thực sự cần.

### Cấu trúc notificationSettings đang dùng để kiểm thử

```json
{
  "enabled": false,
  "observedDevicePermission": "not_checked"
}
```

**Trạng thái:** Cấu trúc mẫu tạm thời, cần thống nhất với thành viên phụ trách LIFE-30 trước khi chốt chính thức.

## 4. Quy tắc kết nối và bảo mật

Luồng xử lý:

**Mobile → Firebase Authentication → Backend Express → Cloud Firestore**

- Mobile sử dụng Firebase Authentication để đăng ký, đăng nhập và đăng xuất.
- Mobile gửi Firebase ID Token qua `Authorization: Bearer <ID_TOKEN>` khi gọi API yêu cầu xác thực.
- Backend xác minh ID Token và lấy UID từ token.
- Backend đọc/ghi Firestore bằng Firebase Admin SDK.
- Không sử dụng `userId` do client tự gửi để quyết định quyền sở hữu.
- Người dùng chỉ được truy cập dữ liệu cá nhân của chính mình.
- Firestore Security Rules chặn truy cập trực tiếp từ Mobile SDK.

## 5. Phân công tích hợp F01

| Jira                          | Yêu cầu tích hợp                                                              |
| ----------------------------- | ----------------------------------------------------------------------------- |
| LIFE-15 – Đăng ký             | Khởi tạo users/{uid} và hồ sơ ban đầu sau khi xác thực                        |
| LIFE-23 – Đăng nhập/đăng xuất | Sử dụng Firebase Authentication; Backend kiểm tra UID và trạng thái tài khoản |
| LIFE-30 – Hồ sơ cá nhân       | Đọc và cập nhật users/{uid}/profiles/main                                     |
| LIFE-37 – Tích hợp F01        | Kiểm thử đăng ký, đăng nhập, cập nhật hồ sơ, phân quyền giữa hai UID          |

## 6. Dữ liệu kiểm thử

Firestore đã có một document mẫu tại `users/{uid}` cùng `profiles/main` với thông tin giả lập.

Dữ liệu mẫu chỉ phục vụ kiểm thử, không phải dữ liệu mặc định bắt buộc cho mọi người dùng.

Khi chức năng đăng ký hoàn thiện, Backend phải tự tạo dữ liệu. Không yêu cầu tạo thủ công document cho từng người dùng.

## 7. Nội dung cần thống nhất trước khi hoàn thiện API

- Các trường con chính thức của `notificationSettings`.
- Giá trị khởi tạo hồ sơ khi người dùng chưa nhập thông tin.
- Cách khôi phục việc khởi tạo hồ sơ nếu bước ghi Firestore thất bại sau khi Firebase Auth tạo tài khoản.
- Quy tắc cập nhật `version` và trường do Backend quản lý.

Mọi thay đổi schema phải được thông báo cho các thành viên làm Mobile, Backend và kiểm thử trước khi áp dụng.
