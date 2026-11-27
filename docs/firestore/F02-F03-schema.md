# LIFE TRACKER – SCHEMA CLOUD FIRESTORE F02–F03

**Phiên bản:** 1.0 – Sprint 4
**Công việc:** LIFE-39 – Triển khai phần xử lý dùng chung cho API nhật ký
**Phạm vi:** F02 – Nhật ký sinh hoạt và F03 – Dinh dưỡng

## 1. Cấu trúc cơ sở dữ liệu

```text

Cloud Firestore
├── users
│   └── {uid}
│       ├── waterLogs
│       │   └── {entryId}
│       ├── activityLogs
│       │   └── {entryId}
│       ├── sleepLogs
│       │   └── {entryId}
│       ├── mealLogs
│       │   └── {entryId}
│       ├── weightLogs
│       │   └── {entryId}
│       ├── dailySummaries
│       │   └── {dateKey}
│       └── logTombstones
│           └── {type}_{entryId}
└── foodCatalog
    └── {foodId}
```

## 2. Danh sách collection

| Collection       | Chức năng                              | Jira             |
| ---------------- | -------------------------------------- | ---------------- |
| `waterLogs`      | Nhật ký nước uống                      | LIFE-40          |
| `activityLogs`   | Nhật ký vận động                       | LIFE-41          |
| `sleepLogs`      | Nhật ký giấc ngủ                       | LIFE-42          |
| `foodCatalog`    | Danh mục thực phẩm dùng chung          | LIFE-43, LIFE-44 |
| `mealLogs`       | Nhật ký ăn uống                        | LIFE-45          |
| `weightLogs`     | Lịch sử cân nặng                       | LIFE-46          |
| `dailySummaries` | Tổng hợp và xác nhận dữ liệu theo ngày | LIFE-47          |

## 3. Quy ước chung cho nhật ký

Các nhật ký sử dụng những trường chung theo tài liệu thiết kế:

| Field                | Kiểu Firestore | Quy định                             |
| -------------------- | -------------- | ------------------------------------ | ----------------------------------------------------- |
| `entryId`            | string         | ID ổn định, đồng thời là Document ID |
| `userId`             | string         | UID từ Firebase Authentication       |
| `createdAt`          | timestamp      | Thời điểm Backend tạo                |
| `updatedAt`          | timestamp      | Thời điểm Backend cập nhật           |
| `version`            | integer        | Phiên bản bản ghi, bắt đầu từ 1      |
| `source`             | string         | `manual` trong MVP                   |
| `timeZone`           | string         | Múi giờ IANA của sự kiện             |
| `localDate`          | string         | Ngày quy thuộc, định dạng YYYY-MM-DD |
| `requestFingerprint` | string         | S                                    | SHA-256 của nội dung yêu cầu tạo nhật ký đã chuẩn hóa |

Các collection có thêm các field nghiệp vụ riêng.
Quy tắc:

- Backend tạo requestFingerprint khi tạo nhật ký.
- Không chấp nhận requestFingerprint do Mobile gửi.
- Cùng entryId và cùng fingerprint được nhận diện là retry.
- Cùng entryId nhưng fingerprint khác trả HTTP 409.
- Fingerprint của yêu cầu tạo ban đầu được giữ nguyên sau PATCH.
- Không trả requestFingerprint trong API đọc nhật ký.
- Khi xóa nhật ký, tombstone lưu fingerprint ban đầu để truy vết retry.

## 4. Quy tắc xử lý chung LIFE-39

- Mỗi tài khoản chỉ được truy cập nhật ký của chính mình.
- Backend xác minh Firebase ID Token trước khi truy cập Firestore.
- Gửi lại cùng `entryId` và cùng nội dung không tạo bản ghi trùng.
- Gửi lại cùng `entryId` nhưng khác nội dung trả HTTP 409.
- Sửa hoặc xóa với phiên bản cũ trả HTTP 409.
- Khi bản ghi đổi ngày, phải cập nhật hoặc đánh dấu tính lại dữ liệu tổng hợp của cả hai ngày.
- Không tự xem ngày chưa ghi nhật ký là ngày có tổng bằng 0.

## 5. Data Dictionary chi tiết

Các phần cần hoàn thiện tiếp:

### 5.1. waterLogs

**Đường dẫn Firestore:** `/users/{uid}/waterLogs/{entryId}`

#### Các field nghiệp vụ

| Field          | Kiểu Firestore | Mức | Quy định                          |
| -------------- | -------------- | --- | --------------------------------- |
| loggedAt       | timestamp      | B   | Thời điểm thực tế uống nước       |
| volumeMl       | number         | B   | Lượng nước tính bằng mL, phải > 0 |
| originalAmount | number         | T   | Lượng người dùng nhập ban đầu     |
| originalUnit   | string         | T   | Đơn vị ban đầu, ví dụ mL hoặc L   |
| beverageType   | string         | T   | Loại đồ uống                      |
| note           | string         | T   | Ghi chú tùy chọn                  |

#### Các field chung bắt buộc

| Field     | Kiểu Firestore | Quy định                       |
| --------- | -------------- | ------------------------------ |
| entryId   | string         | Trùng Document ID              |
| userId    | string         | UID từ Firebase Authentication |
| source    | string         | manual trong MVP               |
| timeZone  | string         | Múi giờ IANA                   |
| localDate | string         | YYYY-MM-DD, tính từ loggedAt   |
| version   | integer        | Bắt đầu từ 1                   |
| createdAt | timestamp      | Thời điểm Backend tạo          |
| updatedAt | timestamp      | Thời điểm Backend cập nhật     |

#### Quy tắc xử lý

1. Backend xác minh Firebase ID Token và lấy UID.
2. Từ chối lượng nước bằng 0 hoặc số âm.
3. Quy đổi lượng nước về mL trước khi lưu.
4. Xác định localDate từ loggedAt và timeZone.
5. Gửi lại cùng entryId và cùng nội dung không tạo trùng.
6. Dùng lại entryId với nội dung khác trả HTTP 409.
7. Sửa hoặc xóa bằng version cũ trả HTTP 409.
8. Đổi ngày của bản ghi phải cập nhật hoặc đánh dấu tính lại cả ngày cũ và ngày mới.
9. Chỉ tính tổng nhật ký thuộc UID hiện tại.
10. Ngày chưa ghi dữ liệu không tự được xem là đã uống 0 mL.

### 5.2. activityLogs

**Đường dẫn Firestore:** `/users/{uid}/activityLogs/{entryId}`

#### Các field nghiệp vụ

| Field             | Kiểu Firestore   | Mức | Quy định                                                     |
| ----------------- | ---------------- | --- | ------------------------------------------------------------ |
| startedAt         | timestamp        | B   | Thời điểm bắt đầu vận động                                   |
| activityType      | string           | B   | Loại hoạt động thuộc danh sách cho phép của Backend          |
| durationMinutes   | number           | B   | Thời lượng vận động, phải > 0                                |
| endedAt           | timestamp        | T   | Thời điểm kết thúc, nếu có phải sau startedAt                |
| metValue          | number           | DK  | Giá trị MET khi có nguồn dữ liệu phù hợp                     |
| activityCode      | string           | DK  | Mã hoạt động khi có dữ liệu tham chiếu                       |
| weightAtSessionKg | number           | DK  | Cân nặng tại thời điểm vận động, nếu dùng để tính năng lượng |
| energyGrossKcal   | number hoặc null | S   | Năng lượng tổng ước tính khi đủ dữ liệu                      |
| energyNetKcal     | number hoặc null | S   | Năng lượng thuần ước tính khi đủ dữ liệu                     |
| overlapStatus     | string           | S   | clear hoặc needs_review                                      |

#### Các field chung bắt buộc

| Field     | Kiểu Firestore | Quy định                                    |
| --------- | -------------- | ------------------------------------------- |
| entryId   | string         | Trùng Document ID                           |
| userId    | string         | UID từ Firebase Authentication              |
| source    | string         | manual trong MVP                            |
| timeZone  | string         | Múi giờ IANA của sự kiện                    |
| localDate | string         | YYYY-MM-DD, tính theo startedAt và timeZone |
| version   | integer        | Bắt đầu từ 1                                |
| createdAt | timestamp      | Thời điểm Backend tạo                       |
| updatedAt | timestamp      | Thời điểm Backend cập nhật                  |

#### Quy tắc xử lý

1. Backend xác minh Firebase ID Token và lấy UID.
2. Không chấp nhận durationMinutes bằng 0 hoặc số âm.
3. localDate được xác định từ startedAt theo timeZone.
4. Nếu có endedAt, thời điểm này phải sau startedAt; sai lệch với durationMinutes không vượt quá 1 phút.
5. Có thể lưu nhật ký vận động khi chưa có dữ liệu MET.
6. Không tự động gán MET hoặc năng lượng khi thiếu dữ liệu.
7. Kiểm tra các phiên vận động nghi chồng lấp và đánh dấu needs_review theo quy tắc thiết kế.
8. Hai phiên hợp lệ 20 phút và 30 phút được tính thành 50 phút.
9. Gửi lại cùng entryId và cùng nội dung không tạo bản ghi trùng.
10. Dùng lại entryId với nội dung khác trả HTTP 409.
11. Sửa hoặc xóa bằng version cũ trả HTTP 409.
12. Chỉ đọc, sửa và xóa dữ liệu thuộc UID hiện tại.
13. Khi bản ghi thay đổi ngày, Backend phải cập nhật hoặc đánh dấu tính lại dữ liệu của cả ngày cũ và ngày mới.

### 5.3. sleepLogs

**Đường dẫn Firestore:** `/users/{uid}/sleepLogs/{entryId}`

#### Các field nghiệp vụ

| Field              | Kiểu Firestore   | Mức | Quy định                                            |
| ------------------ | ---------------- | --- | --------------------------------------------------- |
| sleepStart         | timestamp        | B   | Thời điểm bắt đầu phiên ngủ (UTC)                   |
| sleepEnd           | timestamp        | B   | Thời điểm kết thúc, phải sau sleepStart             |
| sessionMinutes     | number           | S   | Thời lượng phiên ngủ tính bằng phút, phải > 0       |
| awakeMinutes       | number           | T   | Số phút thức nếu biết, từ 0 đến sessionMinutes      |
| actualSleepMinutes | number hoặc null | S   | Chỉ tính khi có dữ liệu thức đầy đủ                 |
| subjectiveQuality  | integer          | T   | Chất lượng giấc ngủ tự đánh giá từ 1 đến 5          |
| overlapStatus      | string           | S   | clear hoặc needs_review khi có phiên nghi chồng lấp |

#### Các field chung bắt buộc

| Field     | Kiểu Firestore | Quy định                            |
| --------- | -------------- | ----------------------------------- |
| entryId   | string         | Trùng Document ID                   |
| userId    | string         | UID từ Firebase Authentication      |
| source    | string         | manual trong MVP                    |
| timeZone  | string         | Múi giờ IANA của phiên ngủ          |
| localDate | string         | YYYY-MM-DD, tính theo ngày thức dậy |
| version   | integer        | Bắt đầu từ 1                        |
| createdAt | timestamp      | Thời điểm Backend tạo               |
| updatedAt | timestamp      | Thời điểm Backend cập nhật          |

#### Quy tắc xử lý

1. Backend xác minh Firebase ID Token và lấy UID.
2. Bắt buộc cung cấp đầy đủ sleepStart và sleepEnd.
3. Từ chối khi sleepEnd <= sleepStart.
4. sessionMinutes = (sleepEnd - sleepStart) / 60000.
5. localDate được xác định từ sleepEnd theo timeZone của phiên ngủ.
6. Phiên ngủ từ 23:30 đến 06:30 hôm sau được tính thành 420 phút và quy thuộc ngày thức dậy.
7. Không tự động gán awakeMinutes = 0 khi người dùng chưa cung cấp.
8. Không tự động coi actualSleepMinutes bằng sessionMinutes.
9. subjectiveQuality chỉ nhận giá trị nguyên từ 1 đến 5.
10. Kiểm tra các phiên ngủ chồng lấp; đánh dấu needs_review để rà soát.
11. Không tính trùng khoảng thời gian chồng lấp khi tổng hợp dữ liệu.
12. Gửi lại cùng entryId và cùng nội dung không tạo bản ghi trùng.
13. Dùng lại entryId với nội dung khác trả HTTP 409.
14. Sửa hoặc xóa bằng version cũ trả HTTP 409.
15. Chỉ đọc, sửa và xóa dữ liệu thuộc UID hiện tại.
16. Khi thay đổi ngày quy thuộc, Backend phải cập nhật hoặc đánh dấu tính lại dữ liệu ngày cũ và ngày mới.

### Chống tạo lại nhật ký đã xóa

- Sử dụng collection kỹ thuật:
  `users/{uid}/logTombstones/{type}_{entryId}`
- Khi xóa nhật ký, Backend đồng thời tạo tombstone
  và xóa document gốc trong cùng transaction.
- Tombstone lưu UID, loại nhật ký, entryId,
  fingerprint ban đầu, version và thời điểm xóa.
- Không lưu lại toàn bộ thông tin sinh hoạt trong tombstone.
- POST sử dụng entryId đã xóa trả HTTP 409,
  không tạo lại nhật ký.
- Tombstone được giữ để phục vụ chống retry
  và phải được xóa khi xóa toàn bộ dữ liệu tài khoản.
- Mobile không được tự tạo, sửa hoặc xóa tombstone.

#### Ngoài phạm vi MVP

- sleepStages: Các giai đoạn giấc ngủ, cần nguồn dữ liệu đo riêng.
- psqiScore: Điểm PSQI, không tự suy ra từ hai mốc thời gian.

### 5.4. foodCatalog

**Đường dẫn Firestore:** `/foodCatalog/{foodId}`

**Phạm vi:** Collection dùng chung cho toàn bộ người dùng.

#### Các field định danh và mô tả

| Field             | Kiểu Firestore | Mức | Quy định                              |
| ----------------- | -------------- | --- | ------------------------------------- |
| foodId            | string         | B   | ID nội bộ bất biến, trùng Document ID |
| foodSource        | string         | B   | Tên hoặc mã nguồn dữ liệu tham chiếu  |
| sourceFoodId      | string         | DK  | Mã thực phẩm tại nguồn tham chiếu     |
| foodName          | string         | B   | Tên thực phẩm hiển thị                |
| nameNormalized    | string         | S   | Tên chuẩn hóa chữ thường, bỏ dấu      |
| aliasesNormalized | array<string>  | T   | Danh sách bí danh đã chuẩn hóa        |
| foodState         | string         | DK  | Trạng thái sống/chín khi có thông tin |
| dataType          | string         | DK  | Dạng dữ liệu thực phẩm theo nguồn     |
| brand             | string         | T   | Thương hiệu nếu có                    |
| barcode           | string         | T   | Mã vạch nếu có                        |

#### Các field định lượng và dinh dưỡng

| Field             | Kiểu Firestore   | Mức | Quy định                               |
| ----------------- | ---------------- | --- | -------------------------------------- |
| referenceBasis    | string           | B   | 100g, 100mL hoặc serving có định lượng |
| referenceAmount   | number           | B   | Lượng tham chiếu, phải > 0             |
| referenceUnit     | string           | B   | g, mL hoặc serving                     |
| energyKcal        | number hoặc null | DK  | Năng lượng theo lượng tham chiếu       |
| proteinGrams      | number hoặc null | DK  | Protein theo lượng tham chiếu          |
| carbsGrams        | number hoặc null | DK  | Carbohydrate theo lượng tham chiếu     |
| fatGrams          | number hoặc null | DK  | Chất béo theo lượng tham chiếu         |
| fiberGrams        | number hoặc null | T   | Chất xơ nếu có dữ liệu                 |
| sodiumMg          | number hoặc null | T   | Natri nếu có dữ liệu                   |
| servingSize       | number           | DK  | Định lượng của một khẩu phần, phải > 0 |
| servingUnit       | string           | DK  | Đơn vị của khẩu phần                   |
| densityGramsPerMl | number           | DK  | Mật độ khi cần quy đổi mL sang g       |

#### Các field nguồn và quản lý

| Field         | Kiểu Firestore | Mức | Quy định                            |
| ------------- | -------------- | --- | ----------------------------------- |
| sourceVersion | string         | DK  | Phiên bản dữ liệu nguồn             |
| retrievedAt   | timestamp      | DK  | Thời điểm lấy dữ liệu nguồn         |
| status        | string         | B   | draft, active hoặc inactive         |
| createdAt     | timestamp      | B   | Thời điểm tạo trên hệ thống         |
| updatedAt     | timestamp      | B   | Thời điểm cập nhật                  |
| version       | integer        | B   | Phiên bản document, Backend quản lý |

#### Quy tắc xử lý

1. foodCatalog là collection gốc dùng chung, không nằm trong users/{uid}.
2. Mỗi thực phẩm có foodId ổn định, không dùng foodName làm Document ID.
3. Hai thực phẩm cùng tên nhưng khác nguồn hoặc biến thể phải được phân biệt.
4. Chỉ công bố các thực phẩm có status = active.
5. Dữ liệu dinh dưỡng phải có nguồn tham chiếu phù hợp.
6. Các giá trị năng lượng và chất dinh dưỡng phải >= 0 khi đã biết.
7. Giá trị chưa biết phải để null hoặc không có field; không tự động gán 0.
8. referenceAmount phải > 0, đồng thời phù hợp với referenceBasis và referenceUnit.
9. Khi dùng cơ sở 100 g hoặc 100 mL, giá trị dinh dưỡng phải tương ứng với lượng tham chiếu đó.
10. Chỉ tính toán khẩu phần khi có đủ thông tin quy đổi.
11. Không tự động đổi g sang mL hoặc ngược lại khi thiếu dữ liệu mật độ.
12. Không nhân lặp số phần sau khi đã quy đổi sang lượng thực phẩm thực tế.
13. Khi danh mục thực phẩm được cập nhật, không tự thay đổi snapshot của các bữa ăn đã lưu.
14. Việc tạo và chỉnh sửa danh mục phải được kiểm soát bởi Backend theo quyền quản trị.
15. Backend phải kiểm tra dữ liệu đầu vào và không công bố dữ liệu tham chiếu không hợp lệ.

#### API liên quan

- GET /foods: Tìm kiếm và liệt kê thực phẩm.
- GET /foods/{foodId}: Xem chi tiết thực phẩm.
- POST /nutrition/calculate: Tính dinh dưỡng dựa trên khẩu phần và dữ liệu tham chiếu.

#### Dữ liệu khởi tạo

- Dự kiến khoảng 100 thực phẩm chuẩn hóa.
- Phải có thông tin nguồn tham chiếu.
- Không tự tạo dữ liệu dinh dưỡng khi chưa có nguồn hợp lệ.
- Dữ liệu tham chiếu sẽ được nạp vào Firestore trong quá trình thực hiện LIFE-43.

### 5.5. mealLogs

**Đường dẫn Firestore:** `/users/{uid}/mealLogs/{entryId}`

**Phạm vi:** Lưu nhật ký ăn uống của từng người dùng, bao gồm thông tin bữa ăn, các thực phẩm đã sử dụng và snapshot giá trị dinh dưỡng.

#### Các field nghiệp vụ

| Field                | Kiểu Firestore | Mức | Quy định                                          |
| -------------------- | -------------- | --- | ------------------------------------------------- |
| loggedAt             | timestamp      | B   | Thời điểm thực tế diễn ra bữa ăn                  |
| mealType             | string         | B   | breakfast, lunch, dinner hoặc snack               |
| items                | array<map>     | B   | Danh sách thực phẩm, ít nhất 1 phần tử            |
| totals               | map            | S   | Tổng năng lượng và các chất dinh dưỡng của bữa ăn |
| nutrientCompleteness | map            | S   | Mức đầy đủ dữ liệu theo từng chỉ tiêu dinh dưỡng  |

#### Cấu trúc mỗi phần tử trong items

| Field                     | Kiểu Firestore   | Mức | Quy định                                                                |
| ------------------------- | ---------------- | --- | ----------------------------------------------------------------------- |
| items[].foodId            | string           | B   | ID thực phẩm đã chọn                                                    |
| items[].foodSource        | string           | B   | Nguồn dữ liệu thực phẩm đã chọn                                         |
| items[].foodName          | string           | B   | Tên thực phẩm được lưu tại thời điểm ghi                                |
| items[].quantity          | number           | DK  | Số phần, phải > 0 nếu nhập theo khẩu phần                               |
| items[].servingSize       | number           | DK  | Định lượng mỗi phần, phải > 0                                           |
| items[].servingUnit       | string           | DK  | Đơn vị định lượng mỗi phần                                              |
| items[].consumedGrams     | number           | DK  | Khối lượng thực phẩm thực tế theo g                                     |
| items[].consumedMl        | number           | DK  | Thể tích thực phẩm thực tế theo mL                                      |
| items[].referenceSnapshot | map              | B   | Snapshot dữ liệu tham chiếu tại thời điểm ghi                           |
| items[].energyKcal        | number hoặc null | S   | Năng lượng của khẩu phần                                                |
| items[].proteinGrams      | number hoặc null | S   | Protein của khẩu phần                                                   |
| items[].carbsGrams        | number hoặc null | S   | Carbohydrate của khẩu phần                                              |
| items[].fatGrams          | number hoặc null | S   | Chất béo của khẩu phần                                                  |
| items[].calculationMethod | string           | B   | Phương pháp tính, theo thiết kế là source_scaled và phiên bản công thức |

#### Nội dung referenceSnapshot

Map referenceSnapshot cần lưu thông tin tham chiếu đã sử dụng, gồm:

- Nguồn thực phẩm.
- Phiên bản nguồn hoặc thời điểm lấy dữ liệu.
- Cơ sở tham chiếu (referenceBasis).
- Lượng tham chiếu (referenceAmount).
- Đơn vị tham chiếu (referenceUnit).
- Các giá trị dinh dưỡng tại thời điểm ghi.

Các trường con cụ thể phải được nhóm thống nhất khi triển khai LIFE-43, LIFE-44 và LIFE-45.

#### Các field chung bắt buộc

| Field     | Kiểu Firestore | Quy định                                 |
| --------- | -------------- | ---------------------------------------- |
| entryId   | string         | Trùng Document ID                        |
| userId    | string         | UID từ Firebase Authentication           |
| source    | string         | manual trong MVP                         |
| timeZone  | string         | Múi giờ IANA của sự kiện                 |
| localDate | string         | YYYY-MM-DD, tính từ loggedAt và timeZone |
| version   | integer        | Bắt đầu từ 1                             |
| createdAt | timestamp      | Thời điểm Backend tạo                    |
| updatedAt | timestamp      | Thời điểm Backend cập nhật               |

#### Quy tắc xử lý

1. Backend xác minh Firebase ID Token và lấy UID người dùng.
2. Mỗi bữa ăn phải có mealType và loggedAt hợp lệ.
3. items phải chứa ít nhất một thực phẩm.
4. Mỗi thực phẩm phải lưu foodId, foodSource, foodName và referenceSnapshot.
5. Lượng sử dụng phải > 0 và phù hợp với đơn vị nhập.
6. Không tự quy đổi g sang mL nếu thiếu dữ liệu mật độ.
7. Không nhân lặp số phần sau khi đã quy đổi sang lượng thực phẩm thực tế.
8. Các giá trị dinh dưỡng được tính theo khẩu phần và nguồn tham chiếu hợp lệ.
9. Giá trị dinh dưỡng chưa biết phải được giữ là null hoặc trạng thái thiếu dữ liệu, không tự gán 0.
10. nutrientCompleteness phân biệt complete, partial và unknown theo từng chỉ tiêu.
11. Lưu snapshot của dữ liệu nguồn tại thời điểm ghi bữa ăn.
12. Khi foodCatalog thay đổi, không tự cập nhật snapshot của bữa ăn cũ.
13. Khi người dùng sửa khẩu phần hoặc thành phần bữa ăn, Backend phải tính lại kết quả dinh dưỡng liên quan.
14. Xóa bữa ăn phải loại dữ liệu của bữa ăn khỏi tổng ngày.
15. localDate được tính từ loggedAt theo timeZone.
16. Khi bản ghi chuyển sang ngày khác, Backend cập nhật hoặc đánh dấu tính lại cả ngày cũ và ngày mới.
17. Gửi lại cùng entryId và cùng nội dung không tạo bản ghi trùng.
18. Dùng lại entryId với nội dung khác trả HTTP 409.
19. Sửa hoặc xóa bằng version cũ trả HTTP 409.
20. Người dùng chỉ được đọc, sửa và xóa nhật ký thuộc UID của chính mình.

#### API liên quan

- /me/logs/meal: API CRUD quản lý nhật ký ăn uống.
- GET /foods: Tra cứu danh mục thực phẩm.
- GET /foods/{foodId}: Xem chi tiết thực phẩm.
- POST /nutrition/calculate: Tính dinh dưỡng theo khẩu phần.

#### Lưu ý triển khai

- items được lưu dưới dạng Array<Map> với giới hạn kích thước do Backend kiểm soát.
- totals và nutrientCompleteness do Backend tính toán, không tin tưởng giá trị tổng do Mobile tự gửi.
- Việc sửa bữa ăn không được tự ý thay thế snapshot cũ bằng dữ liệu danh mục mới nếu chưa có quy tắc cập nhật phù hợp.

### 5.6. weightLogs

**Đường dẫn Firestore:** `/users/{uid}/weightLogs/{entryId}`

**Phạm vi:** Lưu lịch sử các lần đo cân nặng của từng người dùng và đồng bộ cân nặng hiện tại với hồ sơ F01.

#### Các field nghiệp vụ

| Field      | Kiểu Firestore | Mức | Quy định                                   |
| ---------- | -------------- | --- | ------------------------------------------ |
| weightKg   | number         | B   | Cân nặng tính bằng kg, phải > 0 và hữu hạn |
| measuredAt | timestamp      | B   | Thời điểm thực tế đo cân nặng (UTC)        |

#### Các field chung bắt buộc

| Field     | Kiểu Firestore | Quy định                                   |
| --------- | -------------- | ------------------------------------------ |
| entryId   | string         | Trùng Document ID                          |
| userId    | string         | UID từ Firebase Authentication             |
| source    | string         | manual trong MVP                           |
| timeZone  | string         | Múi giờ IANA tại thời điểm đo              |
| localDate | string         | YYYY-MM-DD, tính từ measuredAt và timeZone |
| version   | integer        | Bắt đầu từ 1                               |
| createdAt | timestamp      | Thời điểm Backend tạo bản ghi              |
| updatedAt | timestamp      | Thời điểm Backend cập nhật bản ghi         |
| validationStatus | string | `valid` cho số đo được chấp nhận            |
| warningConfirmed | boolean | Xác nhận khi số đo ngoài khoảng cảnh báo   |

#### Quy tắc xử lý

1. Backend xác minh Firebase ID Token và lấy UID người dùng.
2. Mỗi lần đo phải có weightKg và measuredAt hợp lệ.
3. Từ chối weightKg <= 0, NaN hoặc Infinity.
4. Với weightKg ngoài khoảng 20–300 kg và dưới 1000 kg, hệ thống cần cảnh báo và yêu cầu xác nhận theo quy tắc thiết kế.
5. weightKg đạt 1000 kg trở lên bị từ chối như một giới hạn cứng, dù có truyền `warningConfirmed` hay không.
6. localDate được tính từ measuredAt theo timeZone tại thời điểm đo.
7. Không sử dụng createdAt để xác định lần đo cân nặng mới nhất.
8. Người dùng có thể ghi bổ sung số đo của ngày trước đó.
9. Khi ghi bổ sung số đo cũ, không được ghi đè cân nặng hiện tại nếu đã có số đo hợp lệ mới hơn.
10. Khi thêm, sửa hoặc xóa số đo mới nhất, Backend phải xác định lại số đo hợp lệ có measuredAt mới nhất.
11. Cập nhật profiles/main.currentWeightKg từ lịch sử weightLogs, không coi đây là nguồn dữ liệu độc lập.
12. Nếu không còn số đo hợp lệ, currentWeightKg phải thể hiện trạng thái chưa có dữ liệu, không tự gán 0.
13. Gửi lại cùng entryId và cùng nội dung không tạo bản ghi trùng.
14. Dùng lại entryId với nội dung khác trả HTTP 409.
15. Sửa hoặc xóa bằng version cũ trả HTTP 409.
16. Người dùng chỉ được đọc, sửa và xóa dữ liệu thuộc UID của chính mình.
17. Khi số đo thay đổi ngày quy thuộc, Backend phải cập nhật hoặc đánh dấu tính lại các dữ liệu dẫn xuất liên quan.
18. Việc cập nhật lịch sử và cân nặng hiện tại phải bảo đảm nhất quán khi có các request đồng thời.

#### Liên kết với hồ sơ F01

**Đường dẫn hồ sơ:** `/users/{uid}/profiles/main`

Trường liên quan:

| Field           | Kiểu Firestore   | Quy định                                                   |
| --------------- | ---------------- | ---------------------------------------------------------- |
| currentWeightKg | number hoặc null | Giá trị dẫn xuất từ lần đo hợp lệ mới nhất theo measuredAt |

Quy tắc:

- weightLogs là nguồn dữ liệu gốc.
- currentWeightKg trong profiles/main là giá trị dẫn xuất.
- Mobile không được tự sửa currentWeightKg độc lập với lịch sử cân nặng.
- Backend chịu trách nhiệm đồng bộ giá trị khi lịch sử thay đổi.

#### API liên quan

- GET /me/weights: Xem lịch sử cân nặng.
- POST /me/weights: Thêm lần đo.
- PATCH /me/weights/{entryId}: Cập nhật lần đo.
- DELETE /me/weights/{entryId}: Xóa lần đo.

Các request dùng Firebase ID Token đã xác minh để xác định UID; client không gửi `userId`.

| Thao tác | Hợp đồng |
| --- | --- |
| `GET /me/weights?limit=30&cursor={entryId}&date={YYYY-MM-DD}` | Trả `{ items, nextCursor }`, sắp xếp theo phút đo giảm dần, sau đó `updatedAt DESC` và `entryId DESC`; `limit` từ 1 đến 100. `date` là tùy chọn để lọc theo `localDate`; cursor phải thuộc cùng ngày nếu có lọc. |
| `POST /me/weights` | Nhận `entryId`, `weightKg`, `measuredAt` ISO-8601, `timeZone` và tùy chọn `warningConfirmed`; cùng ID/nội dung retry trả thành công, ID khác nội dung trả `409 ENTRY_ID_CONFLICT`. |
| `GET /me/weights/{entryId}` | Chỉ trả bản ghi trong UID đã xác thực. |
| `PATCH /me/weights/{entryId}` | Nhận `version` cùng ít nhất một trường sửa được; version cũ trả `409 VERSION_CONFLICT`. |
| `DELETE /me/weights/{entryId}?version={version}` | Xóa theo version hiện tại; version cũ trả `409 VERSION_CONFLICT`, thành công trả `204`. |

Tạo/sửa/xóa bản ghi và cập nhật `profiles/main.currentWeightKg` được commit trong cùng Firestore transaction. Khi không còn bản ghi hợp lệ, projection được đặt thành `null`.

#### Truy vấn

- Lấy các bản ghi trong users/{uid}/weightLogs.
- Sắp xếp theo measuredAt giảm dần để xem lịch sử.
- Hỗ trợ limit và cursor khi có nhiều bản ghi.
- Khi có nhiều số đo cùng measuredAt, cần thống nhất quy tắc chọn bản ghi đại diện để kết quả luôn xác định.

#### Lưu ý triển khai

- Không tạo collection weightLogs ở cấp gốc.
- Không lưu lịch sử cân nặng dưới dạng mảng vô hạn trong profiles/main.
- Không tạo hai nguồn quản lý cân nặng hiện tại độc lập.
- Backend phải bảo đảm các thao tác cập nhật lịch sử và hồ sơ không gây mất đồng bộ.

### 5.7. dailySummaries

**Đường dẫn Firestore:** `/users/{uid}/dailySummaries/{dateKey}`

**Phạm vi:** Lưu kết quả tổng hợp và trạng thái đầy đủ dữ liệu sinh hoạt của từng người dùng theo ngày.

**Quy định Document ID:** dateKey có định dạng YYYY-MM-DD, xác định theo múi giờ của ngày được tổng hợp.

#### Các field định danh và thời gian

| Field       | Kiểu Firestore | Mức | Quy định                                      |
| ----------- | -------------- | --- | --------------------------------------------- |
| dateKey     | string         | B   | Trùng Document ID, dạng YYYY-MM-DD            |
| timeZone    | string         | B   | Múi giờ IANA của ngày tổng hợp                |
| periodStart | string         | B   | Ngày bắt đầu kỳ, YYYY-MM-DD                   |
| periodEnd   | string         | B   | Ngày kết thúc kỳ, theo khoảng nửa mở [D, D+1) |

#### Các field tổng hợp

| Field                | Kiểu Firestore   | Mức | Quy định                                         |
| -------------------- | ---------------- | --- | ------------------------------------------------ |
| totalEnergyKcal      | number hoặc null | S   | Tổng năng lượng có dữ liệu hợp lệ                |
| totalProteinGrams    | number hoặc null | S   | Tổng protein                                     |
| totalCarbsGrams      | number hoặc null | S   | Tổng carbohydrate                                |
| totalFatGrams        | number hoặc null | S   | Tổng chất béo                                    |
| totalWaterMl         | number hoặc null | S   | Tổng lượng nước uống trong ngày                  |
| totalActivityMinutes | number hoặc null | S   | Tổng thời gian vận động hợp lệ, tránh cộng trùng |
| totalSleepMinutes    | number hoặc null | S   | Tổng thời lượng phiên ngủ theo ngày thức dậy     |

#### Các field trạng thái dữ liệu

| Field                   | Kiểu Firestore       | Mức | Quy định                                          |
| ----------------------- | -------------------- | --- | ------------------------------------------------- |
| recordStatusByCategory  | map<string, string>  | S   | Trạng thái từng nhóm: missing, partial, confirmed |
| userConfirmedByCategory | map<string, boolean> | DK  | Người dùng đã xác nhận đầy đủ từng nhóm hay chưa  |
| nutrientCompleteness    | map<string, string>  | S   | complete, partial hoặc unknown theo từng chất     |
| observedByCategory      | map<string, boolean> | S   | Có ít nhất một nhật ký hợp lệ thuộc nhóm          |
| validByCategory         | map<string, boolean> | S   | Ngày đáp ứng tiêu chí hợp lệ của từng nhóm        |

Các nhóm trong recordStatusByCategory:

- meal
- water
- activity
- sleep

#### Các field quản lý tổng hợp

| Field           | Kiểu Firestore     | Mức | Quy định                               |
| --------------- | ------------------ | --- | -------------------------------------- |
| sourceRevision  | number hoặc string | B   | Phiên bản nguồn được dùng để tính tổng |
| computedAt      | timestamp          | B   | Thời điểm Backend tính tổng gần nhất   |
| recomputeStatus | string             | S   | fresh, stale, calculating hoặc failed  |
| createdAt       | timestamp          | B   | Thời điểm Backend tạo document         |
| updatedAt       | timestamp          | B   | Thời điểm Backend cập nhật document    |

#### Quy tắc xử lý

1. Backend xác minh Firebase ID Token và chỉ xử lý dữ liệu thuộc UID hiện tại.
2. Mỗi UID chỉ có tối đa một document dailySummaries cho một dateKey.
3. dailySummaries là dữ liệu dẫn xuất từ các nhật ký, không phải nguồn dữ liệu gốc.
4. Mobile không được tự chỉnh sửa các giá trị tổng.
5. Không có nhật ký và chưa xác nhận dữ liệu thì trạng thái là missing, tổng tương ứng không tự động bằng 0.
6. Có nhật ký hợp lệ nhưng chưa xác nhận đầy đủ thì trạng thái nhóm là partial.
7. Chỉ xác nhận dữ liệu của ngày đã kết thúc theo múi giờ áp dụng cho ngày đó.
8. Người dùng xác nhận đầy đủ theo từng nhóm dữ liệu độc lập.
9. Ngày không vận động có thể được xác nhận đầy đủ và có tổng 0 phút khi đáp ứng quy tắc xác nhận.
10. Tổng nước bằng 0 chỉ được sử dụng khi có xác nhận phù hợp rằng ngày đó không uống nước.
11. Tổng dinh dưỡng phải phân biệt dữ liệu đầy đủ, một phần và chưa biết.
12. Các phiên vận động hoặc giấc ngủ chồng lấp phải được xử lý theo quy tắc tổng hợp để tránh tính trùng.
13. Nhật ký giấc ngủ được tổng hợp theo ngày thức dậy.
14. Khi tạo, sửa hoặc xóa nhật ký, Backend phải cập nhật hoặc đánh dấu tính lại tổng của ngày bị ảnh hưởng.
15. Nếu một nhật ký chuyển từ ngày A sang ngày B, cả hai ngày đều phải được cập nhật hoặc đánh dấu tính lại.
16. Khi dữ liệu của một nhóm thay đổi sau khi được xác nhận, hệ thống phải hủy trạng thái xác nhận của nhóm bị ảnh hưởng, không tự hủy các nhóm khác.
17. Backend sử dụng sourceRevision và recomputeStatus để nhận biết tổng hợp đã cũ.
18. Không trả dữ liệu tổng hợp stale như thể đó là kết quả đã cập nhật.
19. Việc tính lại phải dựa trên các bản ghi hợp lệ và tránh cộng trùng.
20. Các thao tác đồng thời phải được kiểm soát để tránh ghi đè kết quả tổng hợp mới bằng kết quả cũ.

#### Quy ước tổng hợp theo thời điểm hành vi

- mealLogs: localDate từ loggedAt.
- waterLogs: localDate từ loggedAt.
- activityLogs: localDate từ startedAt.
- sleepLogs: localDate từ sleepEnd.
- weightLogs: localDate từ measuredAt; phục vụ lịch sử cân nặng, không có tổng cân nặng ngày trong schema này.

#### API liên quan

- GET /me/dashboard?date=...: Lấy dữ liệu dashboard ngày.
- GET /me/analytics?from=...&to=...: Lấy dữ liệu tổng hợp theo kỳ.
- PUT /me/days/{date}/record-status: Xác nhận trạng thái đầy đủ của từng nhóm.

#### Lưu ý triển khai

- Backend chịu trách nhiệm tạo và cập nhật dailySummaries.
- Không tạo document tổng hợp với các tổng bằng 0 chỉ vì chưa có nhật ký.
- Khi tổng hợp đang stale hoặc failed, API cần biểu diễn trạng thái phù hợp.
- observedByCategory không đồng nghĩa với userConfirmedByCategory.
- validByCategory phải được tính theo tiêu chí hợp lệ của từng nhóm.
- observedDays và validDaysCount cho kỳ nhiều ngày được tổng hợp qua API, không bắt buộc lưu trong từng document ngày.
- Phải thống nhất cơ chế sourceRevision, recompute và xử lý cập nhật đồng thời trước khi hoàn thiện LIFE-39.

## 6. Truy vấn và Firestore Indexes

### 6.1. Nguyên tắc truy vấn

1. Backend truy vấn dữ liệu nhật ký theo đường dẫn users/{uid}, trong đó uid lấy từ Firebase ID Token đã xác minh.
2. Không truy vấn nhật ký của tất cả người dùng rồi mới lọc UID.
3. Truy vấn theo khoảng ngày sử dụng localDate.
4. Sắp xếp theo thời điểm hành vi, không dùng createdAt để xác định ngày xảy ra sự kiện.
5. Các API danh sách phải có limit và cursor để phân trang.
6. Không sử dụng Firestore Indexes thay cho kiểm tra quyền truy cập.

### 6.2. Composite Indexes đề xuất

| Index | Collection   | Field 1       | Field 2            | Mục đích                        |
| ----- | ------------ | ------------- | ------------------ | ------------------------------- |
| IX01  | mealLogs     | localDate ASC | loggedAt DESC      | Lọc và sắp xếp bữa ăn           |
| IX02  | waterLogs    | localDate ASC | loggedAt DESC      | Lọc và sắp xếp nhật ký nước     |
| IX03  | sleepLogs    | localDate ASC | sleepEnd DESC      | Lọc giấc ngủ theo ngày thức dậy |
| IX04  | activityLogs | localDate ASC | startedAt DESC     | Lọc nhật ký vận động            |
| IX05  | weightLogs   | localDate ASC | measuredAt DESC    | Lọc lịch sử cân nặng            |
| IX06  | foodCatalog  | status ASC    | nameNormalized ASC | Tra cứu thực phẩm, tùy chọn     |

Các index trên là cấu hình đề xuất theo tài liệu thiết kế CSDL.
API cân nặng lọc `date` trong backend sau truy vấn theo `measuredAt`; không yêu cầu composite index mới.

### 6.3. Quy định triển khai

- Các index nhật ký sử dụng queryScope COLLECTION.
- Không tạo collection-group index xuyên nhiều UID nếu chưa có yêu cầu được phê duyệt.
- Truy vấn đơn giản theo Document ID không cần composite index.
- Với dailySummaries, ưu tiên đọc document theo dateKey.
- foodCatalog có thể tra cứu thông qua Backend với danh mục nhỏ được cache và chuẩn hóa tên.
- Không tạo index không cần thiết trên note hoặc các map/array dữ liệu lớn.
- Chỉ bổ sung index khi phù hợp với truy vấn thực tế.

### 6.4. Kiểm thử Indexes

1. Tạo dữ liệu thử nghiệm cho ít nhất hai UID.
2. Kiểm thử truy vấn trên nhiều ngày và nhiều bản ghi trong cùng ngày.
3. Kiểm tra thứ tự trả về và phân trang.
4. Xác định composite index cần thiết dựa trên API thực tế.
5. Cập nhật firestore.indexes.json.
6. Kiểm tra trạng thái index sau khi triển khai lên Firebase.

## 7. Dữ liệu kiểm thử và nghiệm thu

### 7.1. Nguyên tắc chung

- Chỉ sử dụng tài khoản và dữ liệu kiểm thử.
- Chuẩn bị ít nhất hai UID khác nhau từ Firebase Authentication.
- Mọi nhật ký cá nhân nằm dưới /users/{uid}.
- Backend lấy UID từ Firebase ID Token đã xác minh.
- Dữ liệu thử nghiệm cần bao gồm nhiều ngày và nhiều bản ghi.
- Không sử dụng dữ liệu cá nhân thật.
- Không tự tạo giá trị dinh dưỡng khi thiếu nguồn tham chiếu.
- Không tự gán tổng ngày bằng 0 khi chưa có dữ liệu hoặc xác nhận phù hợp.

### 7.2. Các tình huống kiểm thử

| ID   | Collection     | Dữ liệu hoặc thao tác                     | Kết quả mong muốn                                  |
| ---- | -------------- | ----------------------------------------- | -------------------------------------------------- |
| TC01 | waterLogs      | Ghi 250 mL và 0.5 L cùng ngày             | Tổng lượng nước 750 mL                             |
| TC02 | waterLogs      | Ghi lượng nước 0 hoặc âm                  | Backend từ chối                                    |
| TC03 | activityLogs   | Hai phiên hợp lệ 20 và 30 phút            | Tổng 50 phút                                       |
| TC04 | activityLogs   | Không có dữ liệu MET                      | Vẫn lưu được phiên hợp lệ                          |
| TC05 | sleepLogs      | Ngủ 23:30 đến 06:30 ngày hôm sau          | sessionMinutes = 420                               |
| TC06 | sleepLogs      | sleepEnd trước sleepStart                 | Backend từ chối                                    |
| TC07 | mealLogs       | Một bữa ăn có nhiều thực phẩm             | Lưu được items và snapshot                         |
| TC08 | mealLogs       | Chỉnh sửa khẩu phần                       | Tính lại dinh dưỡng                                |
| TC09 | foodCatalog    | Dinh dưỡng chưa có dữ liệu                | Giữ null/thiếu, không gán 0                        |
| TC10 | weightLogs     | Nhập bổ sung số đo cũ                     | Không ghi đè cân nặng hiện tại                     |
| TC11 | weightLogs     | Xóa số đo mới nhất                        | Cập nhật currentWeightKg từ số đo hợp lệ tiếp theo |
| TC12 | dailySummaries | Ngày chưa có dữ liệu                      | missing; không tự xác nhận tổng 0                  |
| TC13 | dailySummaries | Xác nhận ngày đã kết thúc, không vận động | activity confirmed; tổng 0 phút                    |
| TC14 | dailySummaries | Sửa nhật ký nước đã xác nhận              | Hủy xác nhận riêng nhóm nước                       |

### 7.3. Kiểm thử dùng chung LIFE-39

| ID   | Tình huống                               | Kết quả mong muốn                                      |
| ---- | ---------------------------------------- | ------------------------------------------------------ |
| TC15 | UID A đọc hoặc sửa nhật ký của UID B     | Bị từ chối                                             |
| TC16 | Gửi lại cùng entryId và cùng nội dung    | Không tạo bản ghi trùng                                |
| TC17 | Gửi lại cùng entryId nhưng nội dung khác | HTTP 409                                               |
| TC18 | PATCH với version cũ                     | HTTP 409, giữ dữ liệu mới nhất                         |
| TC19 | DELETE với version cũ                    | HTTP 409, giữ dữ liệu mới nhất                         |
| TC20 | Sửa thời điểm khiến nhật ký đổi ngày     | Cập nhật hoặc đánh dấu tính lại cả ngày cũ và ngày mới |

### 7.4. Quy định thực hiện kiểm thử

- Các trường hợp TC15–TC20 là tiêu chí quan trọng của LIFE-39.
- Kiểm thử retry sử dụng cùng entryId và cùng nội dung nghiệp vụ đã gửi ban đầu.
- Các bài kiểm thử phải xác minh dữ liệu thực tế trên Firestore.
- Cần kiểm tra trường hợp nhiều request đồng thời.
- Không được đánh dấu test thành công nếu chưa chạy thực tế.
- Lưu kết quả kiểm thử để bàn giao trong Sprint 4.

### 7.5. Trách nhiệm tạo dữ liệu

- Người thực hiện LIFE-39 chuẩn bị cơ chế và dữ liệu kiểm thử dùng chung.
- Người thực hiện LIFE-40–42, LIFE-45–46 tạo dữ liệu thông qua API của chức năng tương ứng.
- Người thực hiện LIFE-43 chuẩn bị và nạp danh mục thực phẩm tham chiếu.
- Người thực hiện LIFE-47 kiểm thử trạng thái tổng hợp và xác nhận ngày.
- LIFE-48 thực hiện kiểm thử tích hợp F02–F03.

Các document nhật ký được Backend tạo thông qua API. Không bắt buộc nhập thủ công toàn bộ dữ liệu vào Firebase Console.

Sử dụng dữ liệu giả lập, tách biệt với dữ liệu cá nhân thật. Backend sẽ chịu trách nhiệm tạo document nhật ký thông qua API.
