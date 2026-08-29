# Domain chấm công

Nghiệp vụ chấm công của role `timekeep`: đăng ký nhân sự, lịch trực tuần, check-in,
xin nghỉ, tiền phạt đi muộn.

> ⚠️ **Domain này mới tách được một phần.** Đợt đầu lấy 8 chức năng khép kín.
> Phần lõi vẫn nằm trong `apps/bot/timekeep_bot.js` — xem mục "Còn nợ".

## Cổng vào

```js
import { registerTimekeepModule } from '../../domains/timekeep/index.js';
```

`index.js` là **lối vào duy nhất**. Đừng import thẳng vào `application/`,
`infrastructure/` hay `interfaces/`.

## Cấu trúc

```text
domains/timekeep/
├── index.js                                      Cổng duy nhất — registerTimekeepModule()
├── domain/
│   ├── timekeep-rules.js                         Ca trực, mã nhân viên, trạng thái chấm công, mã Sheet
│   └── vn-time.js                                Mốc ngày và tuần ISO theo UTC+7
├── application/
│   ├── register-employee.js                      Đăng ký nhân sự (2 luồng: nhóm KPI và nhóm thường)
│   ├── toggle-schedule-registration.js           Mở / đóng đăng ký lịch tuần
│   ├── save-group-settings.js                    Cấu hình nhóm: vai trò bot, mức phạt, giờ ca
│   ├── build-attendance-dashboard.js             Số liệu bảng điều khiển
│   ├── manage-admin-schedules.js                 Admin sửa / thêm / xoá ca trực
│   └── export-daily-sheet.js                     Xuất chấm công 23:00
├── infrastructure/
│   ├── postgres/employee-repository.js           SQL nhân sự và nhóm
│   ├── postgres/schedule-repository.js           SQL tk_schedules + cờ đăng ký lịch
│   ├── postgres/group-settings-repository.js     SQL telegram_groups + group_settings
│   ├── postgres/attendance-repository.js         SQL đọc cho bảng điều khiển và bản xuất
│   └── google-sheet/daily-export-sheet.js        Ghi trang DailyExport
├── interfaces/
│   ├── miniapp-api/registration-routes.js        2 endpoint Mini App
│   ├── admin-api/settings-routes.js              Cấu hình nhóm
│   ├── admin-api/dashboard-routes.js             Bảng điều khiển
│   ├── admin-api/schedule-routes.js              Quản trị ca trực + đồng bộ Sheet
│   └── cron/register-export-cron.js              Lịch 23:00
├── attendance-penalties.js       ← chưa xếp tầng, xem "Còn nợ"
├── leave-request-service.js      ← chưa xếp tầng, xem "Còn nợ"
├── schedule-date-policy.js       ← chưa xếp tầng, xem "Còn nợ"
└── tests/
```

Hướng phụ thuộc một chiều: `interfaces` → `application` → `domain`.
`infrastructure` chỉ được `index.js` lắp vào.

## Hợp đồng tương thích — đổi là gãy

| Endpoint | Ai gọi | Trả về |
|---|---|---|
| `POST /api/timekeep/register` | `register.html` | `{ success, message }` |
| `POST /api/timekeep/schedule/toggle` | `schedule.html` | `{ success, message, new_state }` |
| `PUT /api/tk_group_settings/:telegram_group_id` | Web Admin | `{ success: true }` |
| `GET /api/admin/dashboard?group_id=` | Web Admin | payload **phẳng**, không bọc `success` |
| `PUT /api/admin/schedules/:id` | Web Admin | `{ success, data }` |
| `POST /api/admin/schedules` | Web Admin | `{ success, data }` |
| `DELETE /api/admin/schedules/:id` | Web Admin | `{ success: true }` |
| `POST /api/admin/timekeep/sync-sheet` | Web Admin | kết quả của `syncAllTimekeepSheets()` |

Tiền tố `tk_` trong `/api/tk_group_settings` trông lạ nhưng **phải giữ** — Web Admin
đang chạy gọi đúng chuỗi đó.

Lỗi nghiệp vụ trả `{ success:false, message }`; lỗi hệ thống trả `{ error }`. Riêng
`/api/admin/dashboard` trả `{ error }` cho cả hai — giữ đúng bản cũ.

## Thứ tự đăng ký — đừng đảo

`registerTimekeepModule(...)` phải đứng **SAU** dòng:

```js
botApp.use('/api/timekeep', authenticateTelegramMiniApp);
```

Express chỉ áp middleware cho route đăng ký sau nó. Dời module lên trên là
`POST /api/timekeep/register` **mất lớp xác thực Telegram** — ai cũng đăng ký hộ
người khác được. Có test khoá lại.

## Quy tắc quan trọng

1. **Hai luồng đăng ký khác hẳn nhau.** Nhóm KPI (`report`, `report_tour`) dùng một
   tài khoản nhân viên toàn cục + membership theo từng nhóm, chạy trong transaction
   với `FOR UPDATE`; đăng ký ở nhóm thứ hai **không** tạo bản sao. Nhóm thường thì
   mỗi nhóm một hồ sơ, đã có rồi thì từ chối.
2. **Ưu tiên gắn vào hồ sơ Admin tạo sẵn**, khớp theo tên trong cùng nhóm. Tạo mới
   ngay sẽ làm một người có hai bản ghi và số liệu chấm công bị tách đôi.
3. **Giờ luôn tính bằng UTC+7 cộng tay**, không dựa vào giờ máy: bot chạy cả trên
   Windows lẫn trong Docker (TZ=UTC), dựa vào giờ máy thì hai nơi ra hai kết quả.
4. **`ADMIN_IDS` đọc lại từ `.env` mỗi lần dùng**, không chụp một lần lúc khởi động —
   sửa `.env` là có hiệu lực ngay, không phải restart bot.
5. **Cấu hình nhóm dùng `COALESCE`**: Web Admin gửi form từng phần, trường không gửi
   phải giữ giá trị cũ chứ không được xoá về `NULL`.
6. **Xoá ca trực mới đồng bộ Sheet**, và chạy nền — không bắt Web Admin chờ Google.

## Còn nợ — cố ý chưa tách

Toàn bộ phần dưới đây nằm **chồng lên vùng một agent khác đang sửa dở** tính năng
đơn nghỉ đột xuất. Tách bây giờ sẽ xoá mất công việc chưa commit của họ, mà thứ
chưa commit thì git không khôi phục được.

| Phần | Ở đâu |
|---|---|
| `GET /api/timekeep/schedule/data` · `POST /api/timekeep/schedule/save` | `timekeep_bot.js` |
| `POST /api/timekeep/leave-request/save` | `timekeep_bot.js` |
| `POST /api/timekeep/checkin/save` + handler nhận video check-in | `timekeep_bot.js` |
| `GET /api/timekeep/personal-stats` | `timekeep_bot.js` |
| `startHandler` (menu `/app`) · nút duyệt đơn nghỉ | `timekeep_bot.js` |
| Cron nhắc lịch Chủ Nhật · cron quét mỗi phút | `timekeep_bot.js` |
| 3 file phẳng ở gốc domain này | đang được import từ đúng dòng agent kia vừa sửa |

Test `CÒN NỢ: phần lõi vẫn ở timekeep_bot.js` **khẳng định các phần này vẫn còn** —
tách xong thì phải sửa test đó, nhờ vậy không ai báo nhầm là đã hoàn thành.

## Lỗi có sẵn, CHƯA sửa

`application/export-daily-sheet.js` đọc biến `r` chưa khai báo ở dòng `'Schedule'`
— bản cũ thiếu vòng lặp `settings.forEach(r => ...)`. Hàm ném `ReferenceError` ngay
dòng đầu, nên bản xuất 23:00 **chưa từng ghi được gì lên Sheet**; log mỗi đêm hiện
`[Cron] Error during daily export`.

Không sửa khi tách là có chủ đích: sửa xong thì bản xuất sẽ **bắt đầu ghi đè vùng
`DailyExport!A1`** trên bảng tính thật. Đó là đổi hành vi có tác dụng ra ngoài, cần
chủ hệ thống quyết.

## Test

```powershell
npm run test:timekeep-module
npm run check:timekeep
```
