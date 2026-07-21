# 🚀 Hướng Dẫn Triển Khai — KPI Telegram Report

> **Môi trường**: Ubuntu 22.04 / 24.04 LTS  
> **Phiên bản**: Node.js v22+, PostgreSQL 16, PM2 v7+  
> **Thời gian cài đặt ước tính**: 15–30 phút (tùy tốc độ mạng)

---

## 📦 Yêu Cầu Tối Thiểu

| Thành phần | Yêu cầu tối thiểu | Khuyến nghị |
|---|---|---|
| **OS** | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| **RAM** | 1 GB | 2 GB+ |
| **Disk** | 5 GB trống | 10 GB+ |
| **CPU** | 1 core | 2 cores |
| **Mạng** | Cần kết nối internet | Ổn định, ít latency |
| **Node.js** | v22+ | v22 LTS |
| **PostgreSQL** | v14+ | v16 |

---

## 🗂️ Kiến Trúc Hệ Thống

```
                    ┌─────────────────────────────────┐
                    │         Ubuntu Server           │
                    │                                 │
  Telegram  ───────▶│  timekeep-bot (port 3002)       │
  Bot API           │  → Chấm công, KPI, lịch        │
                    │                                 │
  Web Admin ───────▶│  kpi-api (port 3001)            │
  Browser           │  → REST API + static web-admin  │
                    │                                 │
                    │  cloudflared tunnel             │
                    │  → Expose port 3002 ra internet │
                    │    (URL động, cập nhật mỗi lần) │
                    │                                 │
                    │  PostgreSQL (port 5432)         │
                    │  → Database telegram_kpi        │
                    └─────────────────────────────────┘
```

---

## ⚡ Cài Đặt Nhanh (Fresh Ubuntu)

```bash
# 1. Clone hoặc copy source code
git clone <YOUR_REPO_URL> telegramReport
cd telegramReport

# 2. Cài đặt tất cả dependencies
bash scripts/install.sh

# 3. Cấu hình môi trường
cp .env.example .env
nano .env          # Điền thông tin thực tế (xem phần cấu hình bên dưới)

# 4. Khởi động hệ thống
bash scripts/start.sh
```

---

## 🔧 Cấu Hình Chi Tiết (`.env`)

Sau khi chạy `cp .env.example .env`, mở file `.env` và điền:

```bash
# === BẮT BUỘC ===

# Kết nối PostgreSQL
# Thay postgres:YOUR_PASSWORD bằng thông tin thực tế
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/telegram_kpi

# Token bot Telegram (lấy từ @BotFather → /newbot)
TELEGRAM_BOT_TOKEN=1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ID Google Spreadsheet chính (trong URL: /d/SPREADSHEET_ID/edit)
GOOGLE_SPREADSHEET_ID=1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# === TÙY CHỌN ===

# Cổng API server (mặc định 3001)
API_PORT=3001

# ID Google Spreadsheet phụ (customer data)
CUSTOMER_SPREADSHEET_ID=1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Danh sách Telegram ID của admin (cách nhau bằng dấu phẩy)
ADMIN_IDS=1234567890,9876543210

# === TỰ ĐỘNG (không cần điền) ===
# MINI_APP_URL sẽ được cập nhật tự động bởi start.sh
MINI_APP_URL=
```

### Lấy Google Service Account Key

```bash
# 1. Vào Google Cloud Console → IAM & Admin → Service Accounts
# 2. Tạo Service Account mới → tạo key dạng JSON
# 3. Copy file JSON vào thư mục dự án (ví dụ: service-account.json)
# 4. Chia sẻ Google Spreadsheet với email của Service Account
```

---

## 📋 Cài Đặt Từng Bước (Manual)

### Bước 1: Cài PostgreSQL

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Đặt mật khẩu cho user postgres
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'your_password';"
```

### Bước 2: Tạo Database

```bash
sudo -u postgres createdb telegram_kpi
sudo -u postgres psql -d telegram_kpi -f scripts/db_init.sql
```

### Bước 3: Cài Node.js v22

```bash
# Qua NodeSource PPA (khuyến nghị)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # Phải là v22.x.x
```

### Bước 4: Cài PM2 và cloudflared

```bash
# PM2
npm install -g pm2

# cloudflared (qua apt)
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] \
  https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

### Bước 5: Cài npm packages và build

```bash
# Root packages
npm install

# Web-admin packages và build
cd apps/web-admin
npm install
npm run build
cd ../..
```

---

## 🚦 Vận Hành Hàng Ngày

### Khởi động / Dừng / Restart

```bash
# Khởi động đầy đủ (lần đầu hoặc sau khi tắt máy)
bash scripts/start.sh

# Chỉ restart PM2 (khi sửa code backend)
bash scripts/start.sh --restart

# Dừng toàn bộ hệ thống
bash scripts/start.sh --stop
```

### Cập Nhật Code Mới

```bash
# Cập nhật đầy đủ (git pull + build + restart)
bash scripts/update.sh

# Chỉ restart (không pull, không build)
bash scripts/update.sh --no-pull --no-build

# Pull + restart nhưng không build lại web-admin
bash scripts/update.sh --no-build
```

### Xem Log & Monitor

```bash
# Dashboard PM2 real-time
pm2 monit

# Log tất cả
pm2 logs

# Log từng service
pm2 logs kpi-api
pm2 logs timekeep-bot

# Log với số dòng giới hạn
pm2 logs --lines 100

# Log Cloudflare tunnel
tail -f cloudflare.log
tail -f cf_err.log
```

### Quản Lý PM2

```bash
# Xem trạng thái
pm2 status
pm2 list

# Restart từng service
pm2 restart kpi-api
pm2 restart timekeep-bot

# Reload graceful (zero-downtime)
pm2 reload kpi-api

# Xóa process
pm2 delete kpi-api

# Lưu trạng thái (auto-start khi reboot)
pm2 save

# Xem startup command
pm2 startup
```

---

## 🔄 Cấu Hình Auto-Start Khi Reboot

```bash
# Tạo systemd service cho PM2
pm2 startup
# → Chạy lệnh được in ra (bắt đầu bằng "sudo env PATH=...")

# Lưu danh sách process hiện tại
pm2 save
```

Sau đó, khi Ubuntu khởi động lại, PM2 sẽ tự động chạy `kpi-api` và `timekeep-bot`.

> **Lưu ý**: `cloudflared tunnel` KHÔNG tự động khởi động khi reboot vì URL thay đổi mỗi lần.  
> Sau khi reboot, chạy lại: `bash scripts/start.sh` để cập nhật URL mới vào `.env`.

---

## 🗄️ Quản Lý Database

```bash
# Kết nối trực tiếp
psql -U postgres -d telegram_kpi

# Xem danh sách bảng
psql -U postgres -d telegram_kpi -c "\dt"

# Backup database
pg_dump -U postgres telegram_kpi > backup_$(date +%Y%m%d).sql

# Restore từ backup
psql -U postgres -d telegram_kpi < backup_20260718.sql

# Xem kích thước database
psql -U postgres -c "SELECT pg_size_pretty(pg_database_size('telegram_kpi'));"
```

---

## 🌐 Cấu Hình Cloudflare Tunnel

Mỗi lần chạy `bash scripts/start.sh`, hệ thống sẽ:
1. Khởi động `cloudflared tunnel --url http://localhost:3002`
2. Chờ lấy URL dạng: `https://xxxx.trycloudflare.com`
3. Tự động cập nhật `MINI_APP_URL` trong `.env`
4. Restart bot để nhận URL mới

**Sau khi có URL**, cập nhật trên BotFather:
```
/editapp → Chọn bot → Edit Web App URL
→ Dán: https://xxxx.trycloudflare.com
```

---

## 🐛 Xử Lý Sự Cố

### Bot không phản hồi

```bash
# Kiểm tra trạng thái
pm2 status

# Xem lỗi bot
pm2 logs timekeep-bot --lines 50

# Kiểm tra kết nối Telegram
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe" | python3 -m json.tool
```

### API không hoạt động

```bash
# Kiểm tra API đang chạy
pm2 logs kpi-api --lines 50

# Test API thủ công
curl http://localhost:3001/api/health 2>/dev/null || echo "API không phản hồi"

# Restart API
pm2 restart kpi-api
```

### Lỗi Database

```bash
# Kiểm tra PostgreSQL đang chạy
pg_isready && echo "OK" || sudo systemctl restart postgresql

# Kiểm tra kết nối
psql "$DATABASE_URL" -c "SELECT NOW();"
```

### Cloudflare URL không lấy được

```bash
# Xem log cloudflare
cat cf_err.log | tail -30

# Thử lại thủ công
pkill -f "cloudflared tunnel" 2>/dev/null
nohup cloudflared tunnel --url http://localhost:3002 > cloudflare.log 2> cf_err.log &
sleep 15
grep -oP 'https://[a-z0-9\-]+\.trycloudflare\.com' cf_err.log | head -1
```

---

## 📁 Cấu Trúc Thư Mục

```
telegramReport/
├── apps/
│   ├── api/
│   │   ├── index.js          ← Express API Server (port 3001)
│   │   └── public/           ← Static files (mini-app HTML)
│   ├── bot/
│   │   ├── timekeep_bot.js   ← Telegram Bot chính (port 3002)
│   │   ├── image_hasher.js   ← Xử lý hash ảnh
│   │   └── public/           ← Static files của bot
│   └── web-admin/
│       ├── src/              ← React source code
│       ├── dist/             ← Build output (được serve bởi kpi-api)
│       └── vite.config.js
├── packages/
│   └── database/             ← Shared PostgreSQL pool
├── scripts/
│   ├── install.sh            ← Cài đặt lần đầu
│   ├── start.sh              ← Khởi động hệ thống
│   ├── update.sh             ← Cập nhật code
│   └── db_init.sql           ← Schema database
├── .env                      ← Biến môi trường (KHÔNG commit)
├── .env.example              ← Template cấu hình
├── ecosystem.config.cjs      ← PM2 process config
└── README_DEPLOY.md          ← File này
```

---

## 📞 Thông Tin Kỹ Thuật

| URL / Endpoint | Mô tả |
|---|---|
| `http://localhost:3001` | Web Admin Dashboard |
| `http://localhost:3001/api/*` | REST API |
| `http://localhost:3002` | Telegram Bot server (webhook) |
| `https://xxxx.trycloudflare.com` | Public URL (thay đổi mỗi lần start) |
