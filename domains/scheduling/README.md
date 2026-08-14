# Domain lịch khách

Nghiệp vụ lịch khách của hai role `report` và `report_tour`.

**Phạm vi hiện tại: phần "Báo bù công tour" của role `report_tour`.** Phần còn lại
vẫn nằm trong `apps/bot/kpi_features.js` — xem mục "Còn nợ" bên dưới.

## Báo bù công tour là gì

Nhân viên tour làm xong cho khách nhưng quên báo cáo, hoặc báo rồi mà thiếu ảnh minh
chứng. Báo bù cho phép khai lại — nhưng phải có người duyệt vì nó ảnh hưởng trực tiếp
tới **công và doanh thu**.

## Cấu trúc

```text
domains/scheduling/
├── index.js                                  Cổng duy nhất — registerSchedulingModule()
├── domain/
│   └── makeup-rules.js                       Quy tắc thuần: 48 giờ, ảnh, chuẩn hoá SĐT
├── application/
│   └── create-makeup-request.js              Ca sử dụng: transaction + chống trùng
├── infrastructure/
│   ├── postgres/makeup-repository.js         Nơi DUY NHẤT được viết SQL
│   └── storage/proof-image-store.js          Giải mã base64, ghi file, dọn khi lỗi
├── interfaces/
│   ├── miniapp-api/makeup-routes.js          3 endpoint HTTP
│   └── telegram/makeup-notification.js       Soạn + gửi tin duyệt
└── tests/
```

Giao diện tương ứng: [`apps/bot/public/scheduling/schedule-client/`](../../apps/bot/public/scheduling/schedule-client/README.md).

## Hợp đồng tương thích

Ba đường dẫn và hình dạng phản hồi **không được đổi** — Mini App đang chạy thật gọi vào:

| Endpoint | Trả về |
|---|---|
| `GET /api/schedules/incomplete` | `{ success, data: [] }` |
| `POST /api/schedules/makeup` | `{ success, message }` |
| `GET /api/schedules/makeup/history` | `{ success, data: [] }` |

## Ai được duyệt

| Người bấm | Được duyệt? |
|---|---|
| Chính người đặt lịch (= người gửi yêu cầu) | ✅ tự duyệt |
| Quản lý của **đúng nhóm đó** | ✅ duyệt hộ |
| Admin (`ADMIN_IDS`) | ✅ duyệt hộ |
| Quản lý nhóm khác, người ngoài | ❌ |

Quy tắc này do chủ hệ thống đặt ngày **14/08/2026**. Trước đó hệ thống **cấm tự duyệt**.

Hệ quả cần biết: không còn người thứ hai đối chiếu trước khi công và doanh thu được
ghi nhận. Việc kiểm chuyển thành **hậu kiểm** — ảnh minh chứng vẫn bắt buộc và vẫn lưu,
và tin nhắn duyệt có ghi **"(tự duyệt)"** để phân biệt với trường hợp có người khác xác
nhận. Muốn quay lại tiền kiểm thì thêm điều kiện chặn `isOwner` trong
`checkReviewPermission()`.

## Bốn quy tắc quan trọng

1. **Cửa sổ 48 giờ.** Chỉ báo bù được lịch trong 48 giờ qua, và giờ hẹn không được ở
   tương lai. Quá mốc này không còn ai nhớ để đối chiếu.
2. **Chỉ lịch còn thiếu.** Lịch gốc phải đang chờ (`ACTIVE`) hoặc đã đến mà còn nợ ảnh.
   Lịch đã đủ ảnh mà cho báo bù nữa là **tính công hai lần**.
3. **Chống trùng hai lớp.** Đã có yêu cầu cùng khách cùng ngày (`FOR UPDATE`), hoặc công
   tour hôm đó đã ghi nhận đủ (`FOR SHARE`) → từ chối.
4. **Gửi Telegram NGOÀI transaction.** Telegram chậm mà giữ khoá database sẽ làm nghẽn
   người khác. Đổi lại có trạng thái trung gian: `PENDING_NOTIFICATION` → gửi xong thành
   `PENDING`, gửi hỏng thành `NOTIFICATION_FAILED` để bot gửi lại sau.

## Còn nợ — cố ý chưa tách

| Phần | Ở đâu | Vì sao chưa |
|---|---|---|
| Duyệt / từ chối (`makeup_app_`, `makeup_rej_`) | `kpi_features.js` ~2910–3110 | Nằm sát vùng agent khác đang sửa dở |
| Đồng bộ Sheet + cron gửi lại | `kpi_features.js` ~3448–3540 | Cùng lý do |
| 7 endpoint `/api/schedules*` còn lại | `kpi_features.js` 1900–2280 | Dùng chung với role `report`, tách sau |

## Lỗi đã phát hiện, CHƯA sửa

`GET /api/schedules/incomplete` **bị che bởi `GET /api/schedules/:id`** đăng ký trước nó
(dòng 2113 so với 3673). Express khớp theo thứ tự nên `"incomplete"` bị ép thành số
nguyên → lỗi 500. Hệ quả: ô "Chọn lịch thiếu cần bổ sung" trong tab Báo Bù không tải
được danh sách.

Lỗi này **có từ trước khi tách** — bản đã commit cũng cùng thứ tự. Cách sửa: chuyển lời
gọi `registerSchedulingModule(...)` lên TRƯỚC dòng 2113. Chưa làm vì đó là đổi hành vi
của một chức năng liên quan tới công và doanh thu, cần người quyết định.

## Test

```powershell
npm run check:scheduling
```
