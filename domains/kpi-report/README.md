# Domain báo cáo KPI hàng ngày

Nghiệp vụ báo cáo KPI hàng ngày của role `report` (và các nhóm `report_tour` khi
cùng đăng ký nhân sự chung): nhận diện báo cáo, chờ đủ ảnh minh chứng, chốt báo
cáo + tính phạt, nhắc/phạt không nộp, chống trùng ảnh, và đồng bộ Google Sheet.

Đây là domain thứ tư được tách ra khỏi `apps/bot/kpi_features.js`, sau
[`warehouse`](../warehouse/README.md), [`scheduling`](../scheduling/README.md)
và [`customer`](../customer/README.md).

## Cổng vào

```js
import { registerKpiReportModule } from '../../domains/kpi-report/index.js';
```

`index.js` là **lối vào duy nhất**. Đừng import thẳng vào `application/`,
`infrastructure/` hay `interfaces/`.

## Cấu trúc

```text
domains/kpi-report/
├── index.js                                        registerKpiReportModule()
├── domain/
│   ├── report-parsing.js         Phân tích nội dung báo cáo, nhận diện trigger, hạn nộp ảnh
│   ├── kpi-target.js             Chỉ tiêu KPI thực dùng của một nhân viên
│   └── missing-reporters.js      Ai chưa nộp báo cáo (dùng chung 2 mốc cron)
├── application/
│   ├── finalize-report.js        Chốt báo cáo: tính phạt, ghi DB, ghi Sheet, báo nhóm
│   └── send-report-photos.js     Gửi ảnh từ form lên nhóm theo chùm 10 ảnh + chống trùng
├── infrastructure/
│   ├── postgres/report-repository.js       SQL của pending_reports/daily_reports
│   ├── postgres/reminder-repository.js     SQL các nhóm/nhân viên cần quét nhắc nhở
│   ├── postgres/group-config-repository.js Cấu hình theo nhóm (giờ nhắc, mức phạt, lệnh trigger)
│   └── google-sheet/kpi-report-sheet-sync.js  Hàng đợi ghi Sheet báo cáo + sổ phạt
├── interfaces/
│   ├── telegram/register-report-text-handler.js   Nhận diện + chờ ảnh hoặc chốt luôn
│   ├── telegram/register-report-photo-handler.js  Nhận ảnh/video, chống trùng, chốt khi đủ
│   ├── telegram/register-report-commands.js       6 lệnh cấu hình của Admin
│   ├── telegram/register-report-callbacks.js      Xin nghỉ phép, kiểm tra báo cáo hôm nay
│   ├── miniapp-api/report-form-routes.js          2 endpoint Mini App "Điền báo cáo"
│   ├── cron/register-reminder-cron.js             Nhắc giờ + phạt hết ân hạn (nhóm role report)
│   └── cron/register-deadline-cron.js             Hạn ảnh + nhắc giữa kỳ + nhắc im lặng
└── tests/
```

## Hợp đồng tương thích — đổi là gãy

Hai đường dẫn và hình dạng phản hồi **không được đổi** vì Mini App đang chạy
thật gọi vào:

| Endpoint | Trả về |
|---|---|
| `GET /api/bot/get-report-today` | `{ success, data: { tinNhan, doanhThu, lichKhach } }` hoặc `{ success:false }` |
| `POST /api/bot/submit-report` | `{ success, message? }` — lỗi 4xx/5xx kèm `reportSaved` khi báo cáo đã lưu nhưng gửi Telegram thất bại |

Sáu lệnh Telegram (`/hengio`, `/phatvipham`, `/phatbaocao`, `/kpi`, `/lichbaocao`,
`/taocaulenh`) và bốn callback (`REQUEST_LEAVE`, `CANCEL_LEAVE_<id>`,
`CONFIRM_LEAVE_<id>`, `CHECK_UPDATE_REPORT`) giữ nguyên cú pháp/`callback_data`
cũ — tin nhắn cũ trong nhóm vẫn còn mang các callback này.

## Sở hữu cột `group_settings`

Domain này **sở hữu** các cột `remind_time_1`, `deadline_time`,
`penalty_missing_kpi`, `penalty_missing_report` trên bảng `group_settings` —
logic đọc để tính phạt/giờ nhắc nằm ở đây. `domains/timekeep` cũng có sẵn code
đọc/ghi cùng bảng `group_settings` nhưng cho các cột khác (cấu hình chấm công);
hai domain dùng chung bảng, khác cột, không đụng nhau.

## Không thuộc domain này (cố ý để lại `kpi_features.js`)

- `/setup` và `bot.start()` — đăng ký nhân viên/nhóm dùng chung cho mọi vai trò
  báo cáo (report, report_tour), không riêng báo cáo KPI hàng ngày.
- `/xoalich`, `/lich`, `/batnhanlich`, `/tatnhanlich` — thuộc lịch khách, xem
  `domains/scheduling`.
- `authenticateTelegramMiniApp`, `checkAdmin`, `escapeHtml`, `isValidImage`,
  `getImageExtension`, `checkPayloadLimit` — middleware/helper dùng chung nhiều
  domain, vẫn định nghĩa ở `kpi_features.js` và truyền vào như phụ thuộc.

## Lỗi có sẵn, CHƯA sửa

- Cột `deadline_time` (đặt qua lệnh `/lichbaocao`) được lưu nhưng **không được
  cron nào đọc** — thời điểm "chốt sổ phạt" thực tế luôn tính từ
  `remind_time_1 + 2 tiếng`, không phải `deadline_time`. Lỗi có từ trước đợt
  tách; sửa thì đổi hành vi thời điểm phạt tiền thật, cần chủ hệ thống quyết.
- Phạt chỉ tính **một lần duy nhất mỗi ngày** dù vi phạm nhiều lỗi cùng lúc
  (thiếu KPI + nợ ảnh) — là quy tắc có chủ đích, không phải lỗi, xem
  `finalize-report.js`.

## Test

```powershell
npm run check:kpi-report
```
