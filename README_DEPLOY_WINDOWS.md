# 🚀 Hướng Dẫn Triển Khai — KPI Telegram Report (Windows)

> **Môi trường**: Windows 10 v1903+ / Windows 11  
> **Phiên bản**: Node.js v22+, PostgreSQL 16, PM2 v7+  
> **Thời gian cài đặt**: 20–40 phút

---

## 📦 Yêu Cầu Hệ Thống

| Thành phần | Tối thiểu | Khuyến nghị |
|---|---|---|
| **OS** | Windows 10 v1903 | Windows 11 |
| **RAM** | 2 GB | 4 GB+ |
| **Disk** | 5 GB trống | 10 GB+ |
| **CPU** | 2 cores | 4 cores |
| **Quyền** | Administrator | Administrator |
| **Node.js** | v22+ | v22 LTS |
| **PostgreSQL** | v14+ | v16 |

---

## 🗂️ Kiến Trúc Hệ Thống

```
                    ┌─────────────────────────────────┐
                    │       Windows 10/11 PC          │
                    │                                 │
  Telegram  ───────▶│  timekeep-bot (port 3002)       │
  Bot API           │  → Chấm công, KPI, lịch        │
                    │                                 │
  Web Admin ───────▶│  kpi-api (port 3001)            │
  Browser           │  → REST API + static web-admin  │
                    │                                 │
                    │  cloudflared.exe tunnel         │
                    │  → Expose port 3002 ra internet │
                    │                                 │
                    │  PostgreSQL (port 5432)         │
                    │  → Database telegram_kpi        │
                    │                                 │
                    │  Task Scheduler                 │
                    │  → Auto-start khi đăng nhập    │
                    └─────────────────────────────────┘
```

---

## ⚡ Cài Đặt Nhanh

```batch
REM 1. Tải PostgreSQL và cài đặt
REM    https://www.postgresql.org/download/windows/
REM    (Ghi nhớ mật khẩu user postgres)

REM 2. Chạy file cài đặt (double-click hoặc dùng PowerShell)
scripts\windows\install.bat

REM 3. Điền thông tin vào .env (mở tự động sau install)
notepad .env

REM 4. Khởi động hệ thống
PowerShell -ExecutionPolicy Bypass -File scripts\windows\start.ps1
```

---

## 🔧 Cài Đặt PostgreSQL Trên Windows

### Bước 1: Tải và cài đặt

1. Truy cập: https://www.postgresql.org/download/windows/
2. Chọn **Windows x86-64** → phiên bản mới nhất (v16+)
3. Chạy installer với quyền Admin
4. Trong quá trình cài:
   - **Password**: đặt mật khẩu cho user `postgres` (ghi nhớ lại)
   - **Port**: giữ mặc định `5432`
   - **Locale**: để mặc định

### Bước 2: Thêm PostgreSQL vào PATH

```batch
REM Mở System Properties → Environment Variables → Path → thêm:
C:\Program Files\PostgreSQL\16\bin
```

Hoặc chạy trong PowerShell (Admin):
```powershell
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
[System.Environment]::SetEnvironmentVariable('PATH', "$pgBin;$env:PATH", 'Machine')
```

### Bước 3: Kiểm tra

```batch
psql --version
REM Phải hiện: psql (PostgreSQL) 16.x
```

---

## 🔧 Cấu Hình `.env`

Sau khi chạy `install.bat`, file `.env` sẽ tự động mở. Điền:

```bash
# === BẮT BUỘC ===

# Kết nối PostgreSQL — thay your_password bằng mật khẩu đặt lúc cài
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/telegram_kpi

# Token bot Telegram (từ @BotFather → /newbot)
TELEGRAM_BOT_TOKEN=1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ID Google Spreadsheet chính
GOOGLE_SPREADSHEET_ID=1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# === TỰ ĐỘNG — KHÔNG CẦN ĐIỀN ===
# MINI_APP_URL được cập nhật tự động mỗi lần start.ps1 chạy
MINI_APP_URL=
```

---

## 🚦 Vận Hành Hàng Ngày

### Khởi động / Dừng / Restart

```powershell
# Khởi động đầy đủ (sau khi tắt máy, hoặc lần đầu)
.\scripts\windows\start.ps1

# Chỉ restart PM2 (khi sửa code backend)
.\scripts\windows\start.ps1 -Restart

# Dừng toàn bộ hệ thống
.\scripts\windows\start.ps1 -Stop
```

> **Lưu ý**: Khi PC khởi động lại, **Task Scheduler** sẽ tự chạy `start.ps1` khi bạn đăng nhập — không cần làm gì thêm.

### Cập nhật code mới

```powershell
# Cập nhật đầy đủ (git pull + build + restart)
.\scripts\windows\update.ps1

# Chỉ build lại và restart (không pull git)
.\scripts\windows\update.ps1 -NoPull

# Chỉ restart PM2 (không build)
.\scripts\windows\update.ps1 -NoPull -NoBuild
```

### Xem Log & Monitor

```powershell
# Dashboard PM2 real-time
pm2 monit

# Log tất cả
pm2 logs

# Log từng service
pm2 logs kpi-api
pm2 logs timekeep-bot

# Log Cloudflare tunnel
Get-Content cf_err.log -Tail 20 -Wait
```

---

## 🔄 Quản Lý Auto-Start (Task Scheduler)

Task `KPI-System-Autostart` được tạo bởi `install.bat`:

```powershell
# Xem task
schtasks /Query /TN "KPI-System-Autostart" /FO LIST

# Xóa task (nếu muốn tắt auto-start)
schtasks /Delete /TN "KPI-System-Autostart" /F

# Tạo lại task
schtasks /Create /TN "KPI-System-Autostart" `
  /TR "PowerShell -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PWD\scripts\windows\start.ps1`"" `
  /SC ONLOGON /RU $env:USERNAME /RL HIGHEST /F

# Chạy task ngay lập tức (test)
schtasks /Run /TN "KPI-System-Autostart"
```

Hoặc quản lý bằng giao diện:
1. Tìm **Task Scheduler** trong Start Menu
2. Mở **Task Scheduler Library**
3. Tìm `KPI-System-Autostart`

---

## 🗄️ Quản Lý Database

```powershell
# Kết nối trực tiếp
psql -U postgres -d telegram_kpi

# Xem danh sách bảng
psql -U postgres -d telegram_kpi -c "\dt"

# Backup database
$date = Get-Date -Format 'yyyyMMdd'
pg_dump -U postgres telegram_kpi > "backup_$date.sql"

# Restore từ backup
psql -U postgres -d telegram_kpi -f "backup_20260718.sql"

# Kích thước database
psql -U postgres -c "SELECT pg_size_pretty(pg_database_size('telegram_kpi'));"
```

---

## 🐛 Xử Lý Sự Cố Windows

### PowerShell bị block (Execution Policy)

```powershell
# Kiểm tra policy hiện tại
Get-ExecutionPolicy -List

# Cho phép chạy script (chỉ user hiện tại, an toàn)
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force

# Hoặc chạy script trực tiếp
PowerShell -ExecutionPolicy Bypass -File scripts\windows\start.ps1
```

### Antivirus block `cloudflared.exe`

```
Windows Defender → Virus & threat protection settings
→ Exclusions → Add an exclusion → File
→ Chọn: scripts\windows\cloudflared.exe
```

### PM2 không tìm thấy sau cài

```powershell
# Thêm npm global vào PATH
$npmGlobal = "$env:APPDATA\npm"
$env:PATH = "$npmGlobal;$env:PATH"

# Kiểm tra
where.exe pm2

# Cài lại nếu cần
npm install -g pm2
```

### Bot không phản hồi

```powershell
# Kiểm tra trạng thái
pm2 status

# Xem lỗi bot
pm2 logs timekeep-bot --lines 50

# Kiểm tra kết nối Telegram
$token = (Get-Content .env | Select-String 'TELEGRAM_BOT_TOKEN=(.+)').Matches[0].Groups[1].Value
Invoke-RestMethod "https://api.telegram.org/bot$token/getMe"
```

### Cloudflare URL không lấy được

```powershell
# Xem log
Get-Content cf_err.log -Tail 30

# Kill và thử lại thủ công
Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
Start-Sleep 1
$CF = ".\scripts\windows\cloudflared.exe"
Start-Process $CF -ArgumentList "tunnel --url http://localhost:3002" `
  -RedirectStandardError "cf_err.log" -WindowStyle Hidden
Start-Sleep 15
Select-String 'https://.*\.trycloudflare\.com' cf_err.log | Select-Object -First 1
```

### Port 3001/3002 bị chiếm

```powershell
# Xem process đang dùng port
netstat -ano | findstr ":3001"
netstat -ano | findstr ":3002"

# Kill process (thay 1234 bằng PID thực)
taskkill /PID 1234 /F
```

---

## 📁 Cấu Trúc Thư Mục

```
telegramReport\
├── apps\
│   ├── api\
│   │   └── index.js          ← Express API (port 3001)
│   ├── bot\
│   │   └── timekeep_bot.js   ← Telegram Bot (port 3002)
│   └── web-admin\
│       ├── src\              ← React source
│       └── dist\             ← Build output
├── scripts\
│   ├── windows\
│   │   ├── install.bat       ← Cài đặt lần đầu
│   │   ├── start.ps1         ← Khởi động hệ thống
│   │   ├── update.ps1        ← Cập nhật code
│   │   ├── uninstall.bat     ← Gỡ cài đặt
│   │   └── cloudflared.exe   ← (gitignored, tự download)
│   └── db_init.sql           ← Schema database
├── .env                      ← Cấu hình (KHÔNG commit)
├── .env.example              ← Template
├── ecosystem.config.cjs      ← PM2 config (dùng chung)
└── README_DEPLOY_WINDOWS.md  ← File này
```

---

## 📞 Thông Tin Kỹ Thuật

| URL / Endpoint | Mô tả |
|---|---|
| `http://localhost:3001` | Web Admin Dashboard |
| `http://localhost:3001/api/*` | REST API |
| `http://localhost:3002` | Telegram Bot server |
| `https://xxxx.trycloudflare.com` | Public URL (đổi mỗi lần start) |

| File | Mô tả |
|---|---|
| `cloudflare.log` | stdout của cloudflared |
| `cf_err.log` | stderr của cloudflared (có Cloudflare URL ở đây) |
| `startup.log` | Log khởi động hệ thống |
