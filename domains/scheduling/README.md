# Domain lịch khách

Nghiệp vụ lịch khách của role `report_tour` (một phần dùng chung với role `report`).

**Phạm vi: đặt lịch · nhắc lịch · xác nhận khách đến/hủy · tổng hợp công tour · báo bù.**
Còn nợ hai phần nhỏ, xem mục "Còn nợ" bên dưới.

## Cấu trúc

```text
domains/scheduling/
├── index.js                                     Cổng duy nhất — registerSchedulingModule()
├── domain/
│   ├── appointment-rules.js                     Trạng thái, buổi làm, doanh thu, đủ công tour
│   ├── appointment-messages.js                  Soạn tin + bàn phím nút
│   └── makeup-rules.js                          Báo bù: 48 giờ, ảnh, chuẩn hoá SĐT
├── application/
│   ├── book-appointment.js                      Đặt lịch + chống trùng giờ + báo động đi luôn
│   ├── manage-appointment.js                    Cập nhật phát sinh · dời lịch · hủy lịch
│   ├── confirm-arrival.js                       4 nút: đã đến / hủy / lý do / quay lại
│   ├── schedule-reports.js                      3 báo cáo theo giờ
│   ├── remind-due-appointments.js               Nhắc khi tới giờ hẹn
│   ├── create-makeup-request.js                 Báo bù: transaction + chống trùng
│   └── review-makeup-request.js                 Báo bù: duyệt / từ chối
├── infrastructure/
│   ├── postgres/appointment-repository.js       SQL của customer_appointments
│   ├── postgres/makeup-repository.js            SQL của tour_makeup_requests
│   ├── telegram/appointment-notifier.js         Gửi tin qua sendMessageToRoleGroup
│   └── storage/proof-image-store.js             Giải mã base64, ghi file, dọn khi lỗi
├── interfaces/
│   ├── miniapp-api/appointment-routes.js        7 endpoint đặt lịch
│   ├── miniapp-api/makeup-routes.js             3 endpoint báo bù
│   ├── telegram/register-appointment-actions.js 4 nút lịch khách
│   ├── telegram/register-makeup-actions.js      2 nút duyệt/từ chối
│   ├── telegram/makeup-notification.js          Soạn + gửi tin duyệt
│   └── cron/register-schedule-crons.js          4 lịch chạy nền
└── tests/
```

Giao diện tương ứng: [`apps/bot/public/scheduling/schedule-client/`](../../apps/bot/public/scheduling/schedule-client/README.md).

> `apps/bot/public/schedule.html` **KHÔNG** thuộc domain này. Đó là trang "Đăng ký
> lịch tuần" của role chấm công, gọi `/api/timekeep/schedule/*`. Route `GET /schedule`
> phục vụ nó vẫn nằm ở `kpi_features.js`, sẽ theo role chấm công khi tách role đó.

## Hợp đồng tương thích — đổi là gãy

Mười đường dẫn, thứ tự đăng ký và hình dạng phản hồi **không được đổi**:

| Endpoint | Trả về |
|---|---|
| `GET /api/schedules/incomplete` | `{ success, data: [] }` |
| `POST /api/schedules/makeup` | `{ success, message }` |
| `GET /api/schedules/makeup/history` | `{ success, data: [] }` |
| `GET /api/schedules?date&groupId` | `{ success, data: [] }` |
| `GET /api/schedules/search?phone&groupId` | `{ success, data: [] }` |
| `POST /api/schedules/add` | `{ success, message }` |
| `GET /api/schedules/:id` | `{ success, data: {} }` |
| `PUT /api/schedules/update` | `{ success, data }` nếu lịch **chưa tới giờ**, ngược lại `{ success, message }` |
| `POST /api/schedules/edit` | `{ success, message }` |
| `POST /api/schedules/cancel` | `{ success, message }` |

**Lỗi nghiệp vụ trả HTTP 200 kèm `success: false`**, không phải 4xx — Mini App đang
đọc đúng như vậy. Chỉ lỗi xác thực/phân quyền/không tìm thấy mới dùng mã HTTP.

Sáu chuỗi `callback_data` cũng là hợp đồng, vì **tin nhắn cũ trong nhóm vẫn mang chúng**:
`arr_<id>` · `can_<id>` · `cr_<bom|ban|tien|khacspa|app>_<id>` · `cr_back_<id>` ·
`makeup_app_<id>` · `makeup_rej_<id>`.

## Thứ tự đăng ký route — đừng đảo

`/api/schedules/:id` dùng ký tự đại diện nên nó **nuốt mọi đường dẫn một đoạn**. Vì vậy
`registerMakeupRoutes` (có `/incomplete`) và `/search` phải đăng ký **trước** nó.

Đây là lỗi đã xảy ra thật: `"incomplete"` bị đem xuống database như số nguyên → lỗi 500,
ô "Chọn lịch thiếu cần bổ sung" không tải được danh sách. Có test khoá lại.

## Bốn lịch chạy nền

| Giờ | Việc | Nhóm nhận |
|---|---|---|
| `2 20 * * *` | Lịch của ngày mai | `report` + `report_tour` (opt-out) |
| `0 22 * * *` | Tổng kết lịch trong ngày | `report` + `report_tour` (opt-out) |
| `0 0 * * *` | Tổng hợp công tour hôm qua | **chỉ** `report_tour` |
| `* * * * *` | Nhắc khi tới giờ hẹn | theo nhóm của từng lịch |

**Opt-out**: nhóm chưa có dòng nào trong `schedule_notification_groups` **vẫn nhận** tin.
Chỉ nhóm đặt `is_disabled = true` mới bị loại. Đó là lý do phải `LEFT JOIN` + `COALESCE`.

## Quy tắc quan trọng

1. **Trùng khung giờ dưới 1 tiếng bị chặn** (±59 phút, trong cùng nhóm). Trừ lịch "khách
   đi luôn" (`is_urgent`) — khách đã ở đó rồi.
2. **Chỉ người đặt lịch được bấm "Đã đến"/"Hủy".** Đây là căn cứ tính công tour của chính
   họ; quản lý cũng không xác nhận hộ được.
3. **Đủ công tour** = đủ 6 trường + đã xác nhận đến + có ảnh chứng thực. Lịch còn `ACTIVE`
   tới 00:00 tính là thiếu, không tự đoán hộ.
4. **`is_reminded` đặt SAU khi gửi.** Tiến trình chết giữa chừng thì phút sau nhắc lại —
   thà nhắc thừa còn hơn sót khách.
5. **Cửa sổ báo bù 48 giờ**, chỉ áp dụng cho lịch còn thiếu, chống trùng hai lớp
   (`FOR UPDATE` / `FOR SHARE`), và **gửi Telegram ngoài transaction**.

## Ai được duyệt báo bù

| Người bấm | Được duyệt? |
|---|---|
| Chính người đặt lịch (= người gửi yêu cầu) | ✅ tự duyệt |
| Quản lý của **đúng nhóm đó** | ✅ duyệt hộ |
| Admin (`ADMIN_IDS`) | ✅ duyệt hộ |
| Quản lý nhóm khác, người ngoài | ❌ |

Quy tắc do chủ hệ thống đặt ngày **14/08/2026**; trước đó hệ thống **cấm tự duyệt**.
Hệ quả: việc kiểm chuyển thành **hậu kiểm** — ảnh minh chứng vẫn bắt buộc, và tin nhắn
duyệt ghi **"(tự duyệt)"**. Muốn quay lại tiền kiểm thì chặn `isOwner` trong
`checkReviewPermission()`.

## Còn nợ — cố ý chưa tách

| Phần | Ở đâu | Vì sao chưa |
|---|---|---|
| Nợ ảnh: `GET /api/photo-debts`, `POST /api/upload-proof` | `kpi_features.js` | `upload-proof` nằm chồng lên vùng agent khác đang sửa dở |
| Đồng bộ Google Sheet lịch khách + cron gửi lại | `kpi_features.js` | Cùng lý do |

## Lỗi có sẵn, CHƯA sửa

Tên khách / dịch vụ được ghép **thẳng vào HTML** của tin nhắn, không escape. Tên chứa
`<` sẽ làm Telegram từ chối cả tin nhắn. Lỗi này có từ trước đợt tách; sửa thì phải sửa
kèm test vì bọc escape sẽ đổi cách hiển thị `&` và `<`.

## Test

```powershell
npm run check:scheduling
```
