# 📦 Kế Hoạch Đóng Gói & Build Hệ Thống KPI — Ubuntu

> **Mục tiêu**: Đóng gói toàn bộ hệ thống từ môi trường "dev thủ công" (chạy bằng `.sh` + PM2) thành một **gói cài đặt chuẩn** có thể triển khai trên máy Ubuntu mới chỉ bằng vài lệnh, không cần cấu hình thủ công.

---

## 🗺️ Kiến Trúc Hiện Tại (Phân Tích)

```
telegramReport/
├── apps/
│   ├── api/          → Express.js API Server (port 3000) — chạy bằng PM2
│   ├── bot/          → Telegram Bot (timekeep_bot.js) — chạy bằng PM2
│   └── web-admin/    → React SPA (Vite) — build ra dist/, serve qua Express
├── .env              → Biến môi trường (nhạy cảm — không đóng gói)
├── ecosystem.config.cjs → PM2 process config
├── cloudflared       → Binary tunnel Cloudflare
└── khoi_dong_he_thong_kpi.sh → Script khởi động thủ công
```

**Các phụ thuộc hệ thống cần có:**
| Thành phần | Vai trò | Ghi chú |
|---|---|---|
| Node.js v22+ | Chạy API và Bot | |
| PM2 | Quản lý tiến trình | Global npm package |
| PostgreSQL | Database | Phải có DB `telegram_kpi` và user |
| `cloudflared` | Tunnel Cloudflare | Binary riêng |

---

## 🎯 Mục Tiêu Build Ubuntu

Kết quả sau khi hoàn thành:
- **Người dùng mới** chỉ cần: `git clone` → `cd telegramReport` → `./install.sh` → `./start.sh`
- Hệ thống tự cài dependencies, tự config DB, tự build web-admin, tự khởi động PM2
- Dễ **update** khi có code mới: `./update.sh` là xong

---

## 📋 Kế Hoạch Chi Tiết — 4 Giai Đoạn

---

### 🔵 Giai Đoạn 1: Chuẩn Bị & Làm Sạch Repo

**Mục tiêu**: Loại bỏ các file rác, hardcode path, và tạo cấu trúc chuẩn cho build.

#### Việc cần làm:
- [ ] **1.1** Tạo file `.gitignore` ở root (loại trừ `node_modules/`, `dist/`, `*.log`, `cloudflared.exe`, `*.deb`, `cloudflare.log`, `.env`)
- [ ] **1.2** Xóa hardcode path Windows trong `ecosystem.config.cjs` (`C:\\Users\\ADMIN\\...`) → dùng `__dirname` hoặc relative path
- [ ] **1.3** Tạo `.env.example` chuẩn đầy đủ tất cả biến (hiện tại còn thiếu `MINI_APP_URL`, `BOT_PORT`, v.v.)
- [ ] **1.4** Tạo thư mục `scripts/` để chứa toàn bộ shell scripts build/install

#### Deliverable:
```
scripts/
├── install.sh     ← Script cài đặt toàn bộ (lần đầu)
├── start.sh       ← Script khởi động hệ thống
├── update.sh      ← Script cập nhật (git pull + rebuild)
└── uninstall.sh   ← Script gỡ cài đặt
```

---

### 🟡 Giai Đoạn 2: Tạo Script `install.sh` Tự Động

**Mục tiêu**: Cài đặt tất cả dependencies trên Ubuntu mới từ đầu.

#### Nội dung `install.sh` sẽ làm:

```
[STEP 1] Kiểm tra & cài Node.js v22 (qua NodeSource PPA)
[STEP 2] Cài PM2 global (npm install -g pm2)
[STEP 3] Cài cloudflared (download .deb từ Cloudflare, dpkg -i)
[STEP 4] Kiểm tra PostgreSQL đang chạy
[STEP 5] Tạo database 'telegram_kpi' nếu chưa có
[STEP 6] npm install (root)
[STEP 7] npm install (apps/web-admin)
[STEP 8] Build web-admin (npm run build)
[STEP 9] Hướng dẫn tạo file .env từ .env.example
[STEP 10] PM2 startup (đăng ký auto-start khi boot)
```

#### Điểm quan trọng:
- Script phải **idempotent** (chạy nhiều lần không bị lỗi)
- Phải có kiểm tra: `if command -v node &> /dev/null` trước khi cài
- Tách bước "cần root" (`sudo`) và bước "không cần root"

---

### 🟠 Giai Đoạn 3: Refactor `ecosystem.config.cjs` + `start.sh`

**Mục tiêu**: Thay thế `khoi_dong_he_thong_kpi.sh` bằng script chuẩn hơn, dùng `ecosystem.config.cjs` đúng cách.

#### Refactor `ecosystem.config.cjs`:
```js
// Hiện tại: hardcode path Windows ❌
cwd: 'C:\\Users\\ADMIN\\Downloads\\telegramReport\\telegramReport'

// Sẽ sửa thành: dynamic path ✅
cwd: path.resolve(__dirname)
```

#### Script `start.sh` mới (thay thế `khoi_dong_he_thong_kpi.sh`):
```bash
[STEP 1] Kiểm tra file .env tồn tại → thoát nếu chưa có
[STEP 2] pm2 delete all (dọn tiến trình cũ)
[STEP 3] pm2 start ecosystem.config.cjs (khởi động theo config chuẩn)
[STEP 4] Khởi động cloudflared tunnel → ghi log
[STEP 5] Đợi 10 giây → đọc URL Cloudflare
[STEP 6] sed -i cập nhật MINI_APP_URL trong .env
[STEP 7] pm2 restart all --update-env
[STEP 8] pm2 save (lưu state để auto-restart khi reboot)
[STEP 9] In thông tin kết nối
```

#### Thêm vào `ecosystem.config.cjs` — app `timekeep-bot`:
```js
// Hiện tại thiếu timekeep_bot.js trong ecosystem ❌
// Sẽ thêm: ✅
{
  name: 'timekeep-bot',
  script: 'apps/bot/timekeep_bot.js',
  ...
}
```

---

### 🟢 Giai Đoạn 4: Tạo Script `update.sh` & Tài Liệu Triển Khai

**Mục tiêu**: Workflow cập nhật code production dễ dàng.

#### Script `update.sh`:
```bash
[STEP 1] git pull origin main
[STEP 2] npm install (cài packages mới nếu có)
[STEP 3] npm install trong apps/web-admin
[STEP 4] npm run build (rebuild web-admin)
[STEP 5] pm2 restart all --update-env
```

#### Tạo file `README_DEPLOY.md`:
- Hướng dẫn từng bước từ Ubuntu mới đến hệ thống chạy
- Yêu cầu tối thiểu (RAM, disk, OS version)
- Các lệnh thường dùng khi vận hành

---

## ⚠️ Các Vấn Đề Cần Giải Quyết Trước Khi Build

| # | Vấn đề | Mức độ | Giải pháp |
|---|---|---|---|
| 1 | `ecosystem.config.cjs` hardcode path Windows | 🔴 Blocker | Dùng `path.resolve(__dirname)` |
| 2 | `timekeep-bot` không có trong `ecosystem.config.cjs` | 🔴 Blocker | Thêm entry cho `timekeep_bot.js` |
| 3 | `cloudflared` binary (`.deb`) đã lỗi thời trong repo | 🟡 Medium | Script tự download từ Cloudflare |
| 4 | File `.env` chứa credentials nhạy cảm (không gitignore) | 🔴 Security | Thêm vào `.gitignore` ngay |
| 5 | `web-admin` build output (`dist/`) không gitignore | 🟡 Medium | Thêm vào `.gitignore` |
| 6 | Không có DB migration script | 🟡 Medium | Tạo `scripts/db_init.sql` |

---

## 📁 Cấu Trúc File Sau Khi Hoàn Thành

```
telegramReport/
├── apps/
│   ├── api/
│   ├── bot/
│   └── web-admin/
├── scripts/
│   ├── install.sh         ← MỚI: Cài đặt lần đầu
│   ├── start.sh           ← MỚI: Thay thế khoi_dong_he_thong_kpi.sh
│   ├── update.sh          ← MỚI: Cập nhật code
│   ├── uninstall.sh       ← MỚI: Gỡ cài đặt
│   └── db_init.sql        ← MỚI: Khởi tạo database
├── .env                   ← KHÔNG COMMIT (gitignore)
├── .env.example           ← CẬP NHẬT: đầy đủ tất cả biến
├── .gitignore             ← MỚI
├── ecosystem.config.cjs   ← SỬA: bỏ hardcode path, thêm timekeep-bot
├── package.json
└── README_DEPLOY.md       ← MỚI: Hướng dẫn triển khai Ubuntu
```

---

## 🚦 Thứ Tự Thực Hiện Đề Xuất

```
Giai đoạn 1 (30 phút)  → Làm sạch repo + .gitignore
Giai đoạn 2 (1-2 giờ)  → Viết install.sh
Giai đoạn 3 (1 giờ)    → Refactor ecosystem + start.sh
Giai đoạn 4 (30 phút)  → update.sh + README_DEPLOY.md
```

**Tổng thời gian ước tính: ~4 giờ làm việc**

---

> ✅ **Sau khi duyệt kế hoạch này, tôi sẽ bắt đầu thực hiện từ Giai đoạn 1.**
> Windows sẽ lên kế hoạch và thực hiện ở vòng tiếp theo (dùng NSIS hoặc Inno Setup để tạo installer `.exe`).
