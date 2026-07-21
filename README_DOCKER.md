# 🐳 Hướng Dẫn Chạy Bằng Docker

Hướng dẫn này giúp bạn chạy toàn bộ hệ thống KPI Report chỉ với **1 lệnh duy nhất**, không cần cài Node.js, PostgreSQL hay PM2.

---

## 📋 Yêu Cầu

- **Docker** đã được cài sẵn (Docker Desktop hoặc Docker Engine)
- **Docker Compose** v2+ (thường đi kèm với Docker Desktop)

Kiểm tra:
```bash
docker --version        # Docker version 24.x trở lên
docker compose version  # Docker Compose version v2.x trở lên
```

---

## ⚡ Chạy Nhanh (3 bước)

### Bước 1 — Chuẩn bị file cấu hình

```bash
# Sao chép file cấu hình mẫu
cp .env.example .env
```

Mở file `.env` và điền ít nhất 2 thông tin bắt buộc:

```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHI...    # Token từ @BotFather
DB_PASSWORD=mat_khau_ban_muon                 # Mật khẩu cho DB (tự đặt)
```

> Các thông tin khác (Google Sheets, Cloudflare...) có thể điền sau.

---

### Bước 2 — (Nếu dùng Google Sheets) Đặt file credentials

```bash
# Đặt file service account vào thư mục gốc project
cp /đường/dẫn/tới/service_account.json ./service_account.json
```

> Nếu **không dùng Google Sheets**, bỏ qua bước này. Tạo file rỗng để tránh lỗi:
> ```bash
> echo "{}" > service_account.json
> ```

---

### Bước 3 — Khởi động hệ thống

```bash
docker compose up -d
```

Lần đầu chạy sẽ mất **2-5 phút** để tải image và build. Các lần sau chỉ vài giây.

Sau khi khởi động xong, truy cập:
- 🌐 **Web Admin**: http://localhost:3000
- 👤 **Đăng nhập**: `admin` / `admin123`

---

## 🗂️ Cấu Trúc Services

```
┌─────────────────────────────────────────────────┐
│                   Docker Network                │
│                                                 │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │   postgres   │◄───│        api           │  │
│  │  (port 5432) │    │  Web Admin + API     │  │
│  │  PostgreSQL  │    │  (port 3000 → host)  │  │
│  └──────────────┘    └──────────────────────┘  │
│         ▲                      ▲                │
│         │            ┌─────────┴────────┐       │
│         └────────────│       bot        │       │
│                      │  Telegram Bot    │       │
│                      │  (port 3002)     │       │
│                      └──────────────────┘       │
└─────────────────────────────────────────────────┘
```

| Service     | Mô tả                              | Port nội bộ | Port ra ngoài |
|-------------|-------------------------------------|-------------|---------------|
| `postgres`  | Cơ sở dữ liệu PostgreSQL           | 5432        | 5432          |
| `api`       | API server + Web Admin dashboard   | 3000        | **3000**      |
| `bot`       | Telegram Bot                        | 3002        | _(ẩn)_        |
| `cloudflared` | Cloudflare Tunnel (tuỳ chọn)    | —           | —             |

---

## 🌐 Dùng Cloudflare Tunnel (Tuỳ Chọn)

Để expose Mini App ra Internet qua Cloudflare Tunnel:

**1. Lấy token tại:** https://one.dash.cloudflare.com → Tunnels → Create a tunnel

**2. Điền vào `.env`:**
```env
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoixxxxxxxx...
```

**3. Khởi động kèm tunnel:**
```bash
docker compose --profile tunnel up -d
```

---

## 📦 Các Lệnh Thường Dùng

```bash
# Khởi động tất cả services
docker compose up -d

# Xem logs realtime
docker compose logs -f

# Xem log của 1 service cụ thể
docker compose logs -f bot
docker compose logs -f api

# Dừng hệ thống (giữ data)
docker compose down

# Dừng và XOÁ toàn bộ data (cẩn thận!)
docker compose down -v

# Restart 1 service
docker compose restart bot
docker compose restart api

# Xem trạng thái các container
docker compose ps

# Vào terminal bên trong container
docker exec -it kpi_api sh
docker exec -it kpi_postgres psql -U postgres -d telegram_kpi
```

---

## 🔄 Cập Nhật Code

Khi bạn sửa code và muốn deploy lại:

```bash
# Build lại image và restart
docker compose up -d --build

# Hoặc build lại 1 service cụ thể
docker compose up -d --build api
docker compose up -d --build bot
```

---

## 💾 Data & Backup

Data PostgreSQL được lưu trong Docker **volume** `postgres_data`, không bị mất khi restart container.

```bash
# Backup database
docker exec kpi_postgres pg_dump -U postgres telegram_kpi > backup_$(date +%Y%m%d).sql

# Restore database
cat backup_20241201.sql | docker exec -i kpi_postgres psql -U postgres telegram_kpi
```

---

## ❓ Xử Lý Sự Cố

### Bot không kết nối được Telegram
```bash
# Kiểm tra log bot
docker compose logs bot

# Thử restart
docker compose restart bot
```

### Web Admin không load được
```bash
# Kiểm tra API có chạy không
curl http://localhost:3000/api/health

# Xem log API
docker compose logs api
```

### Database lỗi kết nối
```bash
# Kiểm tra postgres có healthy không
docker compose ps

# Xem log postgres
docker compose logs postgres
```

### Muốn reset toàn bộ (bao gồm xoá data)
```bash
docker compose down -v
docker compose up -d
```

---

## 📁 Files Docker

```
project/
├── docker-compose.yml          # Orchestration chính
├── .dockerignore               # Bỏ qua file không cần thiết
├── .env                        # Cấu hình (tự tạo từ .env.example)
├── service_account.json        # Google Sheets credentials (nếu dùng)
└── docker/
    ├── Dockerfile.api          # Build API + Web Admin
    └── Dockerfile.bot          # Build Telegram Bot
```
