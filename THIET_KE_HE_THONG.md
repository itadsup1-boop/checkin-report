# TÀI LIỆU THIẾT KẾ HỆ THỐNG QUẢN LÝ BÁO CÁO KPI TELESALE

## 1. Tổng quan hệ thống
Hệ thống là giải pháp tự động hóa quy trình báo cáo hàng ngày của nhân viên telesale thẩm mỹ viện. Thay vì điền báo cáo trên Google Sheet hay phần mềm rườm rà, nhân viên sẽ nhắn tin báo cáo theo form quy định vào nhóm Telegram. Hệ thống sử dụng công cụ bóc tách chuỗi (Regex Parser) để kiểm tra xem báo cáo đã đúng form chưa, trích xuất số liệu, so sánh với KPI được giao (lấy từ database) và tự động tính toán tiến độ, thiếu hụt, xuất báo cáo cho Kế toán/HR, đồng thời có cơ chế nhắc việc tự động.

## 2. Kiến trúc tổng thể
- **Frontend (Web Admin)**: React.js + Tailwind CSS (Vite), giao diện quản trị nhanh, nhẹ, responsive.
- **Backend (API + Cron)**: Node.js + Express.js. API RESTful cho Web Admin. Các cron job chạy ngầm để nhắc việc và tổng hợp cuối ngày.
- **Telegram Bot**: Node.js + Telegraf, sử dụng Polling hoặc Webhook để nhận tin nhắn realtime.
- **Database**: PostgreSQL (cài đặt cục bộ ngay trên máy chủ hiện tại) để quản lý dữ liệu an toàn và tự chủ hoàn toàn.
- **Parser Engine**: Sử dụng Regular Expression (Regex) để trích xuất dữ liệu từ form cứng một cách chính xác và không tốn chi phí API.
- **Export Data**: Google Sheets API, tạo báo cáo tự động đẩy dữ liệu sang các sheet kế toán.

## 3. Luồng nghiệp vụ chi tiết
1. Các nhóm Telegram (Sale Hà Nội, Sale HCM...) phần lớn đã có sẵn. Admin chỉ cần thêm bot vào các nhóm này, lấy `group_id` và đăng ký nhóm đó lên Web Admin.
2. Admin cấu hình: thời gian nhắc báo cáo, đơn vị KPI chuẩn (khách, data...), và số KPI yêu cầu cho từng chức vụ/nhóm.
3. Nhân viên nhắn `#baocao...` vào nhóm (hoặc Admin dùng lệnh `/addnv` để thêm nhân viên).
4. Bot nhận tin nhắn, kiểm tra user có tồn tại và thuộc nhóm không.
5. Bot dùng Regex parse đoạn text dựa trên form quy định để lấy số lượng thực tế: `kpi_actual`.
6. Bot lấy KPI từ DB (ưu tiên KPI cá nhân `employee_kpi_overrides`, nếu không có thì lấy `kpi_policies` theo chức vụ).
7. So sánh `kpi_actual` với `kpi_required`. Tính `kpi_missing` và trạng thái đạt/không đạt.
8. Trả lời ngay lập tức vào Telegram kết quả xử lý. Lưu log vào bảng `daily_reports`.
9. Các mốc giờ nhắc việc, cronjob tự quét những ai chưa có record `daily_reports` hôm nay -> Gửi nhắc nhở.
10. Sau giờ chốt sổ (VD: 20:00), cronjob chốt báo cáo. Ai chưa gửi -> Ghi nhận `CHUA_BAO_CAO` và sinh ra `penalty_records`.
11. Kế toán/HR vào Web Admin xem dashboard, duyệt các mức phạt. Admin có thể bấm nút xuất Google Sheet.

## 4. Thiết kế Web Admin
- **Trang Đăng nhập**: Form Login (Email, Password). Xác thực qua API nội bộ (sử dụng JWT - JSON Web Token).
- **Dashboard Tổng quan**: Hiển thị số liệu hôm nay (Tổng NV, Đã báo cáo, Chưa báo cáo, Vi phạm). Nút "Nhắc thủ công".
- **Quản lý Nhóm Telegram**: Bảng danh sách các nhóm, thêm/sửa webhook/group_id, trạng thái bot.
- **Cấu hình thời gian nhắc**: Form chỉnh Nhắc 1, 2, 3 và Giờ chốt theo từng nhóm. 
- **Quản lý Nhân sự**: Bảng danh sách NV, chức năng gán Telegram ID, gán Bộ phận, Chức vụ. Có nút Gán KPI riêng.
- **Quản lý KPI**: Cấu hình các gói KPI chung theo Nhóm + Bộ phận + Chức vụ (Mức yêu cầu, tiền phạt...).
- **Cấu hình nhóm**: Cài đặt các tham số quản lý nhóm (Đơn vị KPI chính).
- **Báo cáo hôm nay**: Bảng real-time danh sách các báo cáo gửi trong ngày. Có Filter.
- **Tổng hợp Xử lý/Phạt**: Nơi HR/Kế toán có nút Duyệt (Approve), Hủy (Reject) mức xử lý đề xuất.
- **Xuất Google Sheet**: Bảng điều khiển cấu hình Google Sheet ID và các nút Trigger xuất báo cáo.

## 5. Database Schema (PostgreSQL cục bộ)

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. admins
CREATE TABLE admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR UNIQUE NOT NULL,
    password_hash VARCHAR NOT NULL,
    role VARCHAR NOT NULL, -- ADMIN, HR, ACCOUNTANT
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. telegram_groups
CREATE TABLE telegram_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_group_id VARCHAR UNIQUE NOT NULL,
    group_name VARCHAR NOT NULL,
    report_keyword VARCHAR DEFAULT '#baocao',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. group_settings
CREATE TABLE group_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),

    main_kpi_unit VARCHAR DEFAULT 'khách',
    remind_time_1 TIME,
    remind_time_2 TIME,
    remind_time_3 TIME,
    deadline_time TIME,
    auto_reminder_enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. employees
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_code VARCHAR UNIQUE NOT NULL,
    full_name VARCHAR NOT NULL,
    telegram_id VARCHAR,
    telegram_username VARCHAR,
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),
    department VARCHAR NOT NULL,
    position VARCHAR NOT NULL,
    need_report BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. kpi_policies
CREATE TABLE kpi_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),
    department VARCHAR NOT NULL,
    position VARCHAR NOT NULL,
    kpi_name VARCHAR NOT NULL,
    kpi_required NUMERIC NOT NULL,
    kpi_unit VARCHAR NOT NULL,
    penalty_low_kpi NUMERIC DEFAULT 0,
    penalty_missing_report NUMERIC DEFAULT 0,
    penalty_late_report NUMERIC DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. employee_kpi_overrides
CREATE TABLE employee_kpi_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id),
    kpi_name VARCHAR NOT NULL,
    kpi_required NUMERIC NOT NULL,
    kpi_unit VARCHAR NOT NULL,
    penalty_low_kpi NUMERIC DEFAULT 0,
    penalty_missing_report NUMERIC DEFAULT 0,
    penalty_late_report NUMERIC DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. daily_reports
CREATE TABLE daily_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_date DATE NOT NULL,
    report_month VARCHAR NOT NULL, -- format YYYY-MM
    employee_id UUID REFERENCES employees(id),
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),
    raw_text TEXT,
    parsed_json JSONB,
    kpi_required NUMERIC,
    kpi_actual NUMERIC,
    kpi_unit VARCHAR,
    kpi_missing NUMERIC,
    completion_rate NUMERIC,

    status VARCHAR, -- DAT_KPI, KHONG_DAT_KPI, THIEU_FORM, CHUA_BAO_CAO, BAO_CAO_MUON
    submitted_at TIMESTAMP WITH TIME ZONE,
    is_late BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. penalty_records
CREATE TABLE penalty_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_date DATE NOT NULL,
    report_month VARCHAR NOT NULL,
    employee_id UUID REFERENCES employees(id),
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),
    reason VARCHAR NOT NULL,
    kpi_required NUMERIC,
    kpi_actual NUMERIC,
    kpi_missing NUMERIC,
    amount NUMERIC DEFAULT 0,
    status VARCHAR DEFAULT 'CHO_DUYET', -- CHO_DUYET, DA_DUYET, DA_HUY, DA_GUI_KE_TOAN
    accounting_sheet_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. reminder_logs
CREATE TABLE reminder_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_date DATE NOT NULL,
    employee_id UUID REFERENCES employees(id),
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),
    reminder_no INTEGER, -- 1, 2, 3
    send_type VARCHAR, -- AUTO, MANUAL_ADMIN
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## 6. API Endpoints
- **Auth**: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- **Dashboard**: `GET /api/dashboard/today`, `GET /api/dashboard/groups/:groupId/today`
- **Groups**: `GET /api/groups`, `POST /api/groups`, `PUT /api/groups/:id`, `DELETE /api/groups/:id`
- **Group settings**: `GET /api/groups/:id/settings`, `PUT /api/groups/:id/settings`
- **Employees**: `GET /api/employees`, `POST /api/employees`, `PUT /api/employees/:id`, `DELETE /api/employees/:id`, `PUT /api/employees/:id/report-status`, `PUT /api/employees/:id/kpi-override`
- **KPI**: `GET /api/kpi-policies`, `POST /api/kpi-policies`, `PUT /api/kpi-policies/:id`, `DELETE /api/kpi-policies/:id`
- **Reports**: `GET /api/reports/today`, `GET /api/reports`, `GET /api/reports/:id`
- **Penalties**: `GET /api/penalties`, `PUT /api/penalties/:id/status`
- **Reminder**: `POST /api/reminders/send-manual`, `GET /api/reminders/logs`
- **Google Sheet**: `POST /api/export/daily`, `POST /api/export/monthly`, `GET /api/export/sheet-url`

## 7. Thiết kế Telegram Bot
Dùng thư viện `telegraf`.
- `/start`, `/help`: Hiển thị hướng dẫn.
- `/myid`: Lấy `ctx.message.from.id` gửi lại cho user (dùng để update vào web admin).
- `/addnv NV001 Nguyễn Văn A | Sale | Nhân viên sale`: Bắt event `reply_to_message`. Lấy id của người được reply, lưu vào bảng `employees` kèm mã NV, tên, phòng ban.
- `/listnv`: Truy vấn bảng `employees` where `telegram_group_id = ctx.chat.id`.
- `/check`: Truy vấn xem ai đã có `daily_reports` ngày hôm nay.
- `/nhac`: Trigger hàm gửi nhắc nhở cho người chưa báo cáo.
- `/tonghop`: Thống kê nhanh từ DB trả ra chat.
- **Middleware Text**: Lắng nghe mọi text message, kiểm tra xem có bắt đầu bằng `report_keyword` (vd `#baocao`). Nếu có, đưa vào luồng AI Parser.

## 8. Thiết kế Form mẫu và Regex Parser

Hệ thống quy định form báo cáo cực kỳ tối giản. Nhân viên chỉ cần nhắn từ khóa báo cáo kèm theo **số lượng đạt được**.

**Ví dụ:**
```text
#baocao 5
```
hoặc
```text
#baocao 5 khách
```

**Regex Pattern cơ bản (Javascript):**
```javascript
function parseReport(text) {
    // Tìm con số ngay sau từ khóa #baocao
    const match = text.match(/#baocao\s+(\d+)/i);

    return {
        is_valid: Boolean(match),
        kpi_actual: match ? parseInt(match[1]) : 0
    };
}
```

## 9. Thuật toán so KPI

```javascript
function calculateKPIStatus(report, kpiPolicy, groupSettings) {
    const kpi_required = kpiPolicy.kpi_required;
    const kpi_actual = report.kpi_actual || 0;
    const submitted_at = moment(report.submitted_at);
    const deadline_time = moment(groupSettings.deadline_time, "HH:mm");
    
    let kpi_missing = Math.max(kpi_required - kpi_actual, 0);
    let completion_rate = kpi_required > 0 ? (kpi_actual / kpi_required) * 100 : 0;
    let is_late = submitted_at.isAfter(deadline_time);

    let status = '';
    let penalty_amount = 0;

    if (!report.is_valid) {
        status = 'THIEU_FORM';
    } else if (kpi_actual >= kpi_required) {
        status = is_late ? 'BAO_CAO_MUON' : 'DAT_KPI';
        penalty_amount = is_late ? kpiPolicy.penalty_late_report : 0;
    } else {
        status = 'KHONG_DAT_KPI';
        // Phạt theo cái lớn hơn hoặc cộng dồn tùy logic cty. Ví dụ: Lấy mức phạt do Không đạt KPI
        penalty_amount = kpiPolicy.penalty_low_kpi;
        if (is_late) {
            // Nếu muốn cộng dồn: penalty_amount += kpiPolicy.penalty_late_report;
            // Ở đây tạm lấy mức cao nhất giữa muộn và không đạt
            penalty_amount = Math.max(kpiPolicy.penalty_low_kpi, kpiPolicy.penalty_late_report);
        }
    }

    return { kpi_missing, completion_rate, is_late, status, penalty_amount };
}
```

## 10. Cron job nhắc việc và tổng hợp

Dùng thư viện `node-cron`.
- **Cron nhắc việc (`* * * * *`)**:
  - Lặp qua tất cả `group_settings`.
  - Nếu `moment().format('HH:mm')` == `remind_time_1` (hoặc 2, 3).
  - Lấy danh sách NV `need_report = true` của nhóm đó.
  - Left Join với `daily_reports` ngày hôm nay. Lọc ra những người `daily_reports.id IS NULL`.
  - Push tin nhắn vào Telegram: `@username Nhắc nhở lần X: Đã đến giờ gửi báo cáo ngày...`
  - Insert bảng `reminder_logs`.

- **Cron tổng hợp (ví dụ chạy sau giờ chốt 5 phút hoặc lúc 20:05 `5 20 * * *`)**:
  - Quét tất cả NV `need_report = true`.
  - Ai chưa có `daily_reports` hnay: Tạo `daily_reports` với trạng thái `CHUA_BAO_CAO`.
  - Tạo `penalty_records` với `reason = 'Không gửi báo cáo'`, `amount = penalty_missing_report`.
  - Auto push tin nhắn tổng kết ngày vào nhóm Telegram: "Đã chốt sổ báo cáo hôm nay. Tổng số: X, Vi phạm: Y..."

## 11. Google Sheet Export
Sử dụng `googleapis` và Service Account.
- **BAO_CAO_NGAY**: Mỗi tối chạy xuất đè hoặc append vào Sheet. Data lấy từ `daily_reports` join `employees`.
- **TONG_HOP_XU_LY**: Map từ bảng `penalty_records`.
- **TONG_HOP_THANG**: Chạy group by (SUM) từ bảng `penalty_records` theo tháng (`report_month`).

## 12. Mẫu phản hồi bot
1. **Thêm nhân sự thành công**: "✅ Đã thêm nhân sự NV001 - Nguyễn Văn A vào hệ thống."
2. **Thêm nhân sự thất bại**: "❌ Bạn cần reply một tin nhắn của nhân sự để lấy thông tin."
3. **Nhân sự chưa đăng ký**: "⚠️ Tài khoản của bạn chưa được đăng ký trong hệ thống. Vui lòng liên hệ Admin."
4. **Báo cáo hợp lệ & đạt**: "✅ Đã nhận báo cáo của Nguyễn Văn A.\nKPI yêu cầu: 8 khách\nKPI thực tế: 10 khách\nTỷ lệ hoàn thành: 125%\nTrạng thái: Đạt KPI 🎯"
5. **Báo cáo hợp lệ & không đạt**: "⚠️ Đã nhận báo cáo của Nguyễn Văn A.\nKPI yêu cầu: 8 khách\nKPI thực tế: 5 khách\nThấp hơn KPI: 3 khách\nTỷ lệ hoàn thành: 62.5%\nTrạng thái: Không đạt KPI 📉\nMức xử lý đề xuất: 50,000 VND."
6. **Báo cáo sai form**: "❌ Báo cáo chưa hợp lệ. Vui lòng nhập đúng cú pháp: #baocao <số lượng>"
7. **Báo cáo muộn**: "...Trạng thái: Đạt KPI nhưng Báo Cáo Muộn ⏰."
8. **Nhắc tự động**: "🔔 [Nhắc nhở tự động] Đã 17:30, các bạn sau chưa báo cáo vui lòng cập nhật: @user1, @user2..."
9. **Tổng hợp**: "📊 TỔNG HỢP BÁO CÁO NGÀY 19/06:\n- Đã gửi: 10\n- Chưa gửi: 2\n- Không đạt KPI: 1"

## 13. Cấu trúc thư mục code (Monorepo Node.js)
```text
telegram-kpi-system/
├── package.json
├── pnpm-workspace.yaml
├── .env
├── apps/
│   ├── web-admin/         # React, Vite, Tailwind
│   ├── api/               # Express REST API
│   └── bot/               # Telegraf + Cronjobs
└── packages/
    ├── database/          # Kết nối PostgreSQL (pg), Schema
    └── shared/            # Typescript types, const, thuật toán so KPI dùng chung
```

## 14. Code mẫu các phần chính

### Backend API (Express + node-postgres)
```javascript
import express from 'express';
import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;
const app = express();
app.use(express.json());

// Kết nối PostgreSQL cục bộ
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Lấy danh sách NV
app.get('/api/employees', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM employees');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Chạy tay xuất báo cáo 
app.post('/api/export/daily', async (req, res) => {
    // Logic gọi Google Sheet API tại đây
    res.json({ message: "Export triggered" });
});

app.listen(3000, () => console.log('API running on port 3000'));
```

### Telegram Bot (Telegraf + Regex Parser)
```javascript
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.command('myid', (ctx) => {
    ctx.reply(`Telegram ID của bạn là: ${ctx.message.from.id}`);
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if(text.toLowerCase().startsWith('#baocao')) {
        // 1. Check user
        const telegram_id = ctx.message.from.id.toString();
        // Giả sử lấy user từ DB
        const user = { full_name: "Nguyễn Văn A" }; 

        // 2. Gọi Regex Parse theo form
        const parsedJSON = parseReport(text); // Hàm Regex đã định nghĩa ở phần 8

        // 3. Xử lý Logic
        if (!parsedJSON.is_valid) {
            return ctx.reply(`❌ Cú pháp chưa đúng. Vui lòng nhập dạng: #baocao <số lượng> (VD: #baocao 5)`);
        }
        
        ctx.reply(`✅ Đã nhận báo cáo của ${user.full_name}.\nKPI thực tế: ${parsedJSON.kpi_actual} ${parsedJSON.kpi_unit}\n...`);
    }
});

bot.launch();
```

## 15. File .env mẫu
```env
# Bot & AI
TELEGRAM_BOT_TOKEN=7xxx:AAHxxx_xxxxxxxxxxxxxxxxxxxx

# Database PostgreSQL cục bộ
DATABASE_URL=postgresql://user:password@localhost:5432/telegram_kpi

# Backend
PORT=3000
JWT_SECRET=super_secret_jwt_key
TIMEZONE=Asia/Ho_Chi_Minh

# Google Sheets API
GOOGLE_SERVICE_ACCOUNT_EMAIL=bot-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...=\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=1A2B3C4D5E...
```

## 16. Hướng dẫn triển khai
1. **Telegram**: Lên `@BotFather`, tạo bot mới, lấy `Token`. Tắt Privacy mode trong Bot Settings để bot đọc được mọi tin nhắn group. Thêm bot vào Group Telesale. Lấy `group_id` (nếu group có chủ đề, group_id bắt đầu bằng dấu trừ, ví dụ `-100xxxxx`).
2. **Database**: Cài đặt PostgreSQL trên máy hiện tại. Tạo database `telegram_kpi` và chạy file SQL ở phần 5. Cập nhật chuỗi kết nối vào `DATABASE_URL` trong file `.env`.
3. (Bỏ qua cấu hình AI, vì hệ thống dùng Regex Parser cục bộ).
4. **Google Cloud**: Tạo project -> Kích hoạt Google Sheets API -> Tạo Service Account -> Tạo JSON key -> Copy Email và Private Key vào `.env`.
5. **Google Sheet**: Tạo 1 file Sheet trắng, bấm Share cấp quyền Editor cho Email Service Account. Lấy Sheet ID từ URL.
6. **Triển khai trên máy chủ hiện tại**: 
   - `npm install`
   - Cài đặt PM2 để chạy ngầm: `npm install -g pm2`
   - Chạy các dịch vụ: 
     `pm2 start apps/api/index.js --name "kpi-api"`
     `pm2 start apps/bot/index.js --name "kpi-bot"`
     `pm2 start apps/web-admin/dist (serve tĩnh)`
7. **Test luồng**: Chat `/myid` -> Tạo NV trên Web -> Chat `#baocao 5` -> Xem log và Web Admin.

## 17. Checklist MVP
- [ ] Admin login Web.
- [ ] Bot nhận được tin nhắn từ Group.
- [ ] Regex parse thành công text theo đúng form của NV thành JSON.
- [ ] Hệ thống so sánh đúng KPI và tính ra mức thiếu hụt.
- [ ] Phản hồi đúng format vào nhóm.
- [ ] Cronjob gửi nhắc đúng giờ.
- [ ] Đẩy dữ liệu lên Google Sheet thành công bằng Service Account.

## 18. Những lỗi thường gặp và cách xử lý
- **Bot không đọc được tin nhắn**: Quên tắt Privacy mode. Cần vào `@BotFather` -> `/setprivacy` -> Chọn Bot -> Chọn `Disable`.
- **Nhân viên nhập sai khoảng trắng khiến Regex không nhận diện được**: Trong hàm parseReport, hãy viết pattern `\s*` để Regex có thể bỏ qua khoảng trắng linh hoạt, giúp nhận diện chính xác dù user gõ dư space.
- **Timezone Cronjob chạy sai giờ**: Đảm bảo set timezone `Asia/Ho_Chi_Minh` cả ở level Server (PM2/Docker) và trong code cron (`{ timezone: "Asia/Ho_Chi_Minh" }`).
- **Google Sheet API trả lỗi Permission Denied**: Chưa Share file sheet cho Service Account Email. Mở file Sheet -> Bấm Chia sẻ -> Paste email đuôi `.iam.gserviceaccount.com` vào với quyền Editor.
- **Mất cấu hình khi restart server**: Đảm bảo mọi cấu hình Group Settings lưu thẳng vào PostgreSQL DB, code bot luôn fetch mới (hoặc có cache TTL 1 phút) thay vì dùng biến in-memory.
