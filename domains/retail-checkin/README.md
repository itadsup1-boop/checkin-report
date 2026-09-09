# Domain: Check-in Điểm Bán Thị Trường (Retail Check-in)

Toàn bộ nghiệp vụ kiểm soát, ghi nhận và đánh giá tiến độ của **nhân viên kinh doanh / phát triển thị trường** nằm trong thư mục này (`bot_role = 'retail_checkin'`). Module được tổ chức theo chuẩn **Clean Architecture**, cô lập hoàn toàn với các luồng chấm công văn phòng hay kho bãi.

---

## 1. Cấu Trúc Thư Mục

```text
domains/retail-checkin/
├── index.js                                Cổng vào công khai DUY NHẤT (Public API)
├── README.md                               Tài liệu kiến trúc và hướng dẫn phát triển
│
├── domain/                                 Thuần nghiệp vụ — CẤM import Express/PG/Telegraf
│   ├── checkin-rules.js                    Hằng số (15 điểm KPI, ca 08:30-18:00, CN nghỉ, 120s anti-spam), kiểm tra ca, bóc tách caption
│   └── retail-messages.js                  Định dạng tin nhắn thông báo Telegram (Check-in thành công, nhắc nhở 17:00, chốt sổ 20:00)
│
├── application/                            Use Cases — điều phối nghiệp vụ & dữ liệu
│   ├── process-store-checkin.js            Xử lý check-in điểm bán từ Telegram chat / Mini App
│   ├── send-progress-reminders.js          Nhắc nhở tiến độ 1h trước khi hết ca (17:00)
│   ├── summarize-daily-kpi.js              Tổng hợp và chốt sổ KPI cuối ngày lúc 20:00
│   ├── get-retail-overview.js              Báo cáo tiến độ KPI ngày cho Web Admin
│   ├── get-retail-monthly-overview.js      Báo cáo tổng hợp KPI tháng toàn nhóm cho Web Admin
│   ├── get-member-retail-history.js        Tra cứu chi tiết lịch sử từng ngày của nhân viên
│   └── update-member-retail-kpi.js         Điều chỉnh chỉ tiêu KPI cá nhân hoặc nhóm
│
├── infrastructure/                         Tương tác với các dịch vụ bên ngoài
│   ├── postgres/                           
│   │   └── retail-repository.js            Truy vấn Database (CRUD checkin, summary, config, kpi, GPS)
│   ├── google-sheet/                       
│   │   └── retail-sheet.js                 Đồng bộ Google Sheets (Sheet Tổng + Sheet cá nhân, công thức HYPERLINK GPS)
│   └── google-drive/                       (Tích hợp trong bot: lưu trữ ảnh theo phân cấp thư mục)
│
├── interfaces/                             Các cổng giao tiếp vào hệ thống
│   ├── telegram/                           
│   │   └── register-retail-handler.js      Tiếp nhận tin nhắn ảnh, album, vị trí GPS và lệnh /tiendo, /kpi
│   ├── miniapp-api/                        
│   │   └── register-retail-miniapp-routes.js REST API phục vụ Mini App (Port 3009: /bootstrap, /submit, /history)
│   ├── admin-api/                          
│   │   └── register-retail-admin-routes.js REST API phục vụ Web Admin (Port 3001: /groups, /overview, /kpi...)
│   └── cron/                               
│       └── register-retail-cron.js         Lập lịch tự động chạy định kỳ (17:00 nhắc nhở, 20:00 chốt sổ)
│
└── tests/                                  Bộ kiểm thử tự động toàn diện
    ├── retail-rules.test.js                Kiểm tra logic nghiệp vụ, quy tắc ca làm việc, bóc tách tin nhắn, GPS Sheets & DB
    ├── retail-miniapp.test.js              Kiểm tra REST API Mini App, chống spam, cấu trúc UI & định vị GPS
    └── retail-admin.test.js                Kiểm tra REST API Web Admin, tổng hợp tháng, cập nhật KPI
```

---

## 2. Hướng Phụ Thuộc (Dependency Rule)

```text
interfaces/  ──►  application/  ──►  domain/
     │                 │
     └─────────────────┴──────►  infrastructure/
```

- **Quy tắc bất biến**: Chiều ngược lại bị cấm. Tầng `domain/` không được phép phụ thuộc vào bất kỳ thư viện bên ngoài hay cơ sở dữ liệu nào.
- SQL và câu lệnh truy vấn cơ sở dữ liệu **chỉ được đặt trong `infrastructure/postgres/`**, tuyệt đối không để lọt vào Use Cases hoặc Handler.

---

## 3. Cách Sử Dụng Từ Bên Ngoài

Khởi tạo và đăng ký module thông qua `index.js` tại `apps/bot/bootstrap/register-business-modules.js` (dành cho Telegram Bot & Mini App) và `apps/api/index.js` (dành cho Web Admin):

```javascript
import { registerRetailModule } from '../../domains/retail-checkin/index.js';

// Trong Bot App:
registerRetailModule({
    bot,
    botApp,
    pool,
    moment,
    getDocForGroup,
    getGroupRole,
    crypto,
    fs,
    retailUploadDir
});
```

---

## 4. Mô Hình Dữ Liệu Cơ Sở Dữ Liệu (PostgreSQL)

| Bảng | Chức Năng | Các Cột Đáng Chú Ý |
|---|---|---|
| `public.retail_checkins` | Lưu trữ từng lượt check-in điểm bán | `id`, `group_id`, `employee_id`, `store_name`, `store_address`, `selfie_photo_url`, `store_photo_url`, `checkin_date`, `checkin_time`, `is_valid`, `latitude`, `longitude`, `location_accuracy`, `google_maps_url` |
| `public.retail_daily_summaries` | Tổng hợp kết quả KPI mỗi ngày (chốt sổ lúc 20:00) | `group_id`, `employee_id`, `record_date`, `valid_points_count`, `target_points`, `is_completed`, `status` (`GỬI ĐỦ` / `THIẾU`) |
| `public.retail_checkin_config` | Cấu hình ca làm việc & mốc chốt của nhóm | `telegram_group_id`, `shift_start_time` (08:30), `shift_end_time` (18:00), `daily_kpi_target` (15), `start_date` |
| `public.retail_employee_kpis` | Cấu hình chỉ tiêu KPI riêng theo từng nhân viên | `employee_id`, `telegram_group_id`, `custom_daily_kpi`, `is_active` |

Các file migration tương ứng nằm tại `packages/database/migrations/`:
- `v37_retail_checkin_config.sql`: Bảng cấu hình ca làm việc và chỉ tiêu mặc định.
- `v38_retail_start_date.sql`: Bổ sung ngày bắt đầu áp dụng `start_date`.
- `v39_retail_employee_kpi.sql`: Hỗ trợ KPI tùy chỉnh theo từng nhân viên.
- `v40_retail_checkin_drive_folder.sql`: Lưu thư mục Google Drive lưu ảnh check-in.
- `v41_retail_checkin_gps.sql`: Bổ sung 4 trường định vị GPS (`latitude`, `longitude`, `location_accuracy`, `google_maps_url`).

---

## 5. Các Hợp Đồng API Được Bảo Đảm

### A. Telegram Mini App (Port 3009)
- `GET /api/retail-checkin/bootstrap?telegram_id=...&chat_id=...`: Xác thực, trả về thông tin nhân viên, tiến độ trong ngày và trạng thái ca làm việc.
- `POST /api/retail-checkin/submit`: Nhận `FormData` (tên cửa hàng, địa chỉ, toạ độ GPS, ảnh selfie, ảnh quầy kệ), kiểm tra chống spam 120s, lưu DB, đồng bộ Sheet và thông báo Telegram.
- `GET /api/retail-checkin/history?telegram_id=...&chat_id=...&date=YYYY-MM-DD`: Trả về danh sách điểm bán đã ghé trong ngày kèm toạ độ và liên kết Google Maps.

### B. Web Admin (Port 3001)
- `GET /api/admin/retail/groups`: Danh sách các nhóm Telegram có `bot_role = 'retail_checkin'`.
- `GET /api/admin/retail/overview?group_id=...&date=YYYY-MM-DD`: Tổng quan tiến độ ngày toàn bộ nhân viên trong nhóm.
- `GET /api/admin/retail/member-history?group_id=...&employee_id=...&month=YYYY-MM`: Lịch sử chi tiết từng ngày theo tháng của một nhân viên.
- `GET /api/admin/retail/monthly-overview?group_id=...&month=YYYY-MM`: Báo cáo tổng hợp toàn nhóm trong tháng.
- `POST /api/admin/retail/kpi`: Cập nhật chỉ tiêu KPI cho nhóm hoặc từng cá nhân.

---

## 6. Quy Tắc Vận Hành & Chạy Kiểm Thử

Để kiểm tra tính toàn vẹn của toàn bộ module Retail Check-in sau khi chỉnh sửa:

```powershell
# Chạy luồng test chính thức của module retail-checkin (toàn bộ 25 test cases)
npm run test:retail-checkin

# Hoặc chạy kiểm tra từng file trong luồng chính:
node --test domains/retail-checkin/tests/retail-rules.test.js     # Nghiệp vụ, quy tắc ca & GPS Sheet/DB/Telegram
node --test domains/retail-checkin/tests/retail-miniapp.test.js   # Mini App UI, client & API Submit GPS
node --test domains/retail-checkin/tests/retail-admin.test.js     # Web Admin REST API & KPI
```
