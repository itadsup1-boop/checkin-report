#!/bin/bash
# ==============================================================
#  scripts/install.sh
#  Cài đặt hệ thống KPI Telegram Report trên Ubuntu 22/24 LTS
#  Chạy lần đầu trên máy mới:  bash scripts/install.sh
# ==============================================================

set -e  # Dừng ngay nếu có lỗi

# ---- Màu sắc terminal ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ---- Hàm tiện ích ----
log_step()  { echo -e "\n${BLUE}${BOLD}[STEP $1]${NC} $2"; }
log_ok()    { echo -e "  ${GREEN}✅ $1${NC}"; }
log_warn()  { echo -e "  ${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "  ${RED}❌ $1${NC}"; }
log_info()  { echo -e "  ${CYAN}ℹ️  $1${NC}"; }

# ---- Xác định thư mục gốc của dự án ----
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# ==============================================================
echo ""
echo -e "${BOLD}=========================================================="
echo -e "   📦 CÀI ĐẶT HỆ THỐNG KPI TELEGRAM REPORT"
echo -e "   Ubuntu Build — $(date '+%Y-%m-%d %H:%M')"
echo -e "==========================================================${NC}"
echo ""

# ==============================================================
# STEP 1 — Kiểm tra quyền và hệ điều hành
# ==============================================================
log_step "1/8" "Kiểm tra môi trường hệ thống..."

# Kiểm tra Ubuntu
if ! grep -qi "ubuntu" /etc/os-release 2>/dev/null; then
  log_warn "Script này được tối ưu cho Ubuntu. OS hiện tại có thể không tương thích."
fi

# Kiểm tra sudo (cảnh báo nếu không có, không block)
HAS_SUDO=false
if sudo -n true 2>/dev/null; then
  HAS_SUDO=true
elif [ -t 0 ] && sudo -v 2>/dev/null; then
  HAS_SUDO=true
fi

if [ "$HAS_SUDO" = false ]; then
  log_warn "Không có quyền sudo. Một số bước có thể bị bỏ qua."
  log_info "Nếu cần cài các gói hệ thống, chạy: sudo bash scripts/install.sh"
fi

log_ok "Môi trường OK — $(lsb_release -d 2>/dev/null | cut -f2 || echo 'Ubuntu')"

# ==============================================================
# STEP 2 — Cài đặt Node.js v22 (qua NodeSource PPA)
# ==============================================================
log_step "2/8" "Kiểm tra Node.js..."

NODE_REQUIRED_MAJOR=22

if command -v node &>/dev/null; then
  NODE_CURRENT=$(node --version | grep -oP '\d+' | head -1)
  if [ "$NODE_CURRENT" -ge "$NODE_REQUIRED_MAJOR" ]; then
    log_ok "Node.js $(node --version) đã được cài — bỏ qua."
  else
    log_warn "Node.js hiện tại là v$NODE_CURRENT, cần v$NODE_REQUIRED_MAJOR+. Đang nâng cấp..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
    log_ok "Node.js $(node --version) đã được cài đặt."
  fi
else
  log_info "Node.js chưa được cài. Đang cài đặt v22 từ NodeSource..."
  sudo apt-get update -q
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  log_ok "Node.js $(node --version) đã được cài đặt."
fi

# ==============================================================
# STEP 3 — Cài đặt PM2
# ==============================================================
log_step "3/8" "Kiểm tra PM2..."

if command -v pm2 &>/dev/null; then
  log_ok "PM2 $(pm2 --version) đã được cài — bỏ qua."
else
  log_info "Đang cài PM2..."
  npm install -g pm2
  log_ok "PM2 $(pm2 --version) đã được cài đặt."
fi

# ==============================================================
# STEP 4 — Cài đặt cloudflared
# ==============================================================
log_step "4/8" "Kiểm tra cloudflared..."

if command -v cloudflared &>/dev/null; then
  log_ok "cloudflared $(cloudflared --version 2>&1 | head -1) đã được cài — bỏ qua."
else
  log_info "Đang cài cloudflared từ Cloudflare repository..."
  # Cài qua apt (phương pháp chính thức của Cloudflare)
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
    | sudo tee /etc/apt/sources.list.d/cloudflared.list
  sudo apt-get update -q
  sudo apt-get install -y cloudflared
  log_ok "cloudflared $(cloudflared --version 2>&1 | head -1 | awk '{print $3}') đã được cài đặt."
fi

# ==============================================================
# STEP 5 — Kiểm tra PostgreSQL
# ==============================================================
log_step "5/8" "Kiểm tra PostgreSQL..."

if ! command -v psql &>/dev/null; then
  log_error "PostgreSQL chưa được cài đặt!"
  echo ""
  echo -e "  ${YELLOW}Hãy cài PostgreSQL trước khi tiếp tục:${NC}"
  echo -e "  ${CYAN}sudo apt-get install -y postgresql postgresql-contrib${NC}"
  echo -e "  ${CYAN}sudo systemctl enable postgresql && sudo systemctl start postgresql${NC}"
  echo ""
  read -p "  Bạn muốn cài PostgreSQL ngay bây giờ không? (y/N): " INSTALL_PG
  if [[ "$INSTALL_PG" =~ ^[Yy]$ ]]; then
    sudo apt-get update -q
    sudo apt-get install -y postgresql postgresql-contrib
    sudo systemctl enable postgresql
    sudo systemctl start postgresql
    log_ok "PostgreSQL đã được cài đặt và khởi động."
  else
    log_error "PostgreSQL bắt buộc phải có. Hãy cài và chạy lại install.sh."
    exit 1
  fi
else
  log_ok "PostgreSQL $(psql --version | awk '{print $3}') đã được cài."
fi

# Kiểm tra PostgreSQL đang chạy
if ! pg_isready -q 2>/dev/null; then
  log_warn "PostgreSQL chưa chạy. Đang khởi động..."
  sudo systemctl start postgresql
  sleep 2
fi

if pg_isready -q; then
  log_ok "PostgreSQL đang hoạt động."
else
  log_error "Không thể khởi động PostgreSQL. Kiểm tra lại: sudo systemctl status postgresql"
  exit 1
fi

# ==============================================================
# STEP 6 — Khởi tạo Database telegram_kpi
# ==============================================================
log_step "6/8" "Khởi tạo database telegram_kpi..."

# ---- Hàm chạy lệnh psql linh hoạt (thử nhiều phương thức auth) ----
run_psql() {
  local sql="$1"
  local db="${2:-postgres}"
  # Phương thức 1: sudo -u postgres (nếu có sudo)
  if [ "$HAS_SUDO" = true ]; then
    sudo -u postgres psql -d "$db" -tAc "$sql" 2>/dev/null && return 0
  fi
  # Phương thức 2: psql -U postgres trực tiếp (trust auth hoặc .pgpass)
  psql -U postgres -d "$db" -tAc "$sql" 2>/dev/null && return 0
  # Phương thức 3: Đọc DATABASE_URL từ .env
  if [ -f "$PROJECT_ROOT/.env" ]; then
    local db_url
    db_url=$(grep -E "^DATABASE_URL=" "$PROJECT_ROOT/.env" | cut -d'=' -f2- | tr -d '"' | xargs)
    if [ -n "$db_url" ]; then
      psql "$db_url" -tAc "$sql" 2>/dev/null && return 0
    fi
  fi
  return 1
}

run_psql_file() {
  local file="$1"
  local db="${2:-telegram_kpi}"
  if [ "$HAS_SUDO" = true ]; then
    sudo -u postgres psql -d "$db" -f "$file" -q 2>/dev/null && return 0
  fi
  psql -U postgres -d "$db" -f "$file" -q 2>/dev/null && return 0
  if [ -f "$PROJECT_ROOT/.env" ]; then
    local db_url
    db_url=$(grep -E "^DATABASE_URL=" "$PROJECT_ROOT/.env" | cut -d'=' -f2- | tr -d '"' | xargs)
    [ -n "$db_url" ] && psql "$db_url" -f "$file" -q 2>/dev/null && return 0
  fi
  return 1
}

# Kiểm tra database đã tồn tại chưa
DB_EXISTS=$(run_psql "SELECT 1 FROM pg_database WHERE datname='telegram_kpi'" || echo "")

if [ "$DB_EXISTS" = "1" ]; then
  log_ok "Database 'telegram_kpi' đã tồn tại — bỏ qua tạo mới."
  log_info "Để chạy lại migration schema: psql -U postgres -d telegram_kpi -f scripts/db_init.sql"
else
  log_info "Đang tạo database 'telegram_kpi'..."

  # Tạo DB
  CREATE_OK=false
  if [ "$HAS_SUDO" = true ] && sudo -u postgres createdb telegram_kpi 2>/dev/null; then
    CREATE_OK=true
  elif createdb -U postgres telegram_kpi 2>/dev/null; then
    CREATE_OK=true
  fi

  if [ "$CREATE_OK" = true ]; then
    log_ok "Database 'telegram_kpi' đã được tạo."
    log_info "Đang import schema từ scripts/db_init.sql..."
    if run_psql_file "$PROJECT_ROOT/scripts/db_init.sql" "telegram_kpi"; then
      log_ok "Schema đã được import thành công."
    else
      log_warn "Không thể import schema tự động. Chạy thủ công:"
      echo -e "     ${CYAN}psql -U postgres -d telegram_kpi -f scripts/db_init.sql${NC}"
    fi
  else
    log_warn "Không thể tạo database tự động. Chạy thủ công:"
    echo -e "     ${CYAN}sudo -u postgres createdb telegram_kpi${NC}"
    echo -e "     ${CYAN}sudo -u postgres psql -d telegram_kpi -f scripts/db_init.sql${NC}"
  fi
fi

# ==============================================================
# STEP 7 — Cài đặt npm dependencies
# ==============================================================
log_step "7/8" "Cài đặt npm packages..."

# Root dependencies
log_info "Cài root packages..."
npm install --silent
log_ok "Root packages OK."

# Web-admin dependencies
log_info "Cài web-admin packages..."
cd "$PROJECT_ROOT/apps/web-admin"
npm install --silent
log_ok "Web-admin packages OK."

# Build web-admin
log_info "Đang build web-admin (React → production)..."
node node_modules/vite/bin/vite.js build --silent 2>/dev/null || npm run build
log_ok "Web-admin đã được build vào apps/web-admin/dist/"
cd "$PROJECT_ROOT"

# ==============================================================
# STEP 8 — Cấu hình file .env
# ==============================================================
log_step "8/8" "Cấu hình file .env..."

if [ -f "$PROJECT_ROOT/.env" ]; then
  log_ok "File .env đã tồn tại."

  # Kiểm tra các biến bắt buộc
  MISSING_VARS=()
  check_env_var() {
    local var_name=$1
    local value
    value=$(grep -E "^${var_name}=" "$PROJECT_ROOT/.env" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | xargs)
    if [ -z "$value" ] || [[ "$value" == *"YOUR_"* ]] || [[ "$value" == *"your_"* ]]; then
      MISSING_VARS+=("$var_name")
    fi
  }

  check_env_var "DATABASE_URL"
  check_env_var "TELEGRAM_BOT_TOKEN"
  check_env_var "GOOGLE_SPREADSHEET_ID"

  if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    log_warn "Các biến sau chưa được cấu hình trong .env:"
    for var in "${MISSING_VARS[@]}"; do
      echo -e "    ${RED}→ $var${NC}"
    done
    echo -e "  ${YELLOW}Hãy điền đầy đủ trước khi chạy start.sh${NC}"
  else
    log_ok "Tất cả biến môi trường bắt buộc đã được cấu hình."
  fi
else
  log_warn "Chưa có file .env. Đang tạo từ .env.example..."
  cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
  echo ""
  echo -e "${YELLOW}  ⚠️  QUAN TRỌNG: Hãy mở file .env và điền thông tin thực tế:${NC}"
  echo -e "  ${CYAN}nano $PROJECT_ROOT/.env${NC}"
  echo ""
  echo -e "  Các biến bắt buộc cần điền:"
  echo -e "  ${RED}  → DATABASE_URL${NC}      (thông tin đăng nhập PostgreSQL)"
  echo -e "  ${RED}  → TELEGRAM_BOT_TOKEN${NC} (lấy từ @BotFather)"
  echo -e "  ${RED}  → GOOGLE_SPREADSHEET_ID${NC} (ID Google Sheet)"
fi

# ==============================================================
# STEP CUỐI — Đăng ký PM2 auto-start khi reboot
# ==============================================================
log_info "Đăng ký PM2 khởi động cùng hệ thống..."
PM2_STARTUP_CMD=$(pm2 startup 2>/dev/null | grep "sudo env" | head -1 || true)
if [ -n "$PM2_STARTUP_CMD" ]; then
  eval "$PM2_STARTUP_CMD" 2>/dev/null || true
  log_ok "PM2 auto-start đã được đăng ký."
else
  log_info "PM2 startup đã được cấu hình trước đó."
fi

# ==============================================================
# HOÀN THÀNH
# ==============================================================
echo ""
echo -e "${GREEN}${BOLD}=========================================================="
echo -e "   ✅ CÀI ĐẶT HOÀN TẤT!"
echo -e "==========================================================${NC}"
echo ""
echo -e "  ${BOLD}Bước tiếp theo:${NC}"

if [ ! -f "$PROJECT_ROOT/.env" ] || grep -q "YOUR_" "$PROJECT_ROOT/.env" 2>/dev/null; then
  echo -e "  ${YELLOW}1. Điền thông tin vào .env:${NC}"
  echo -e "     nano $PROJECT_ROOT/.env"
  echo ""
fi

echo -e "  ${GREEN}2. Khởi động hệ thống:${NC}"
echo -e "     bash $PROJECT_ROOT/scripts/start.sh"
echo ""
echo -e "  ${CYAN}Lệnh hữu ích:${NC}"
echo -e "  • Xem tiến trình:  pm2 monit"
echo -e "  • Xem log:         pm2 logs"
echo -e "  • Dừng hệ thống:   pm2 stop all"
echo -e "  • Cập nhật code:   bash scripts/update.sh"
echo ""
