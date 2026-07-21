#!/bin/bash
# ==============================================================
#  scripts/start.sh
#  Khởi động hệ thống KPI Telegram Report trên Ubuntu
#  Thay thế: khoi_dong_he_thong_kpi.sh
#
#  Cách dùng:
#    bash scripts/start.sh           ← khởi động mới hoàn toàn
#    bash scripts/start.sh --restart ← chỉ restart PM2 (giữ tunnel)
#    bash scripts/start.sh --stop    ← dừng toàn bộ hệ thống
# ==============================================================

# ---- Màu sắc terminal ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ---- Hàm tiện ích ----
log_step()  { echo -e "\n${BLUE}${BOLD}[STEP $1]${NC} $2"; }
log_ok()    { echo -e "  ${GREEN}✅ $1${NC}"; }
log_warn()  { echo -e "  ${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "  ${RED}❌ $1${NC}"; }
log_info()  { echo -e "  ${CYAN}ℹ️  $1${NC}"; }

# ---- Xác định thư mục gốc ----
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# ---- Xử lý tham số dòng lệnh ----
MODE="start"  # start | restart | stop
for arg in "$@"; do
  case "$arg" in
    --restart) MODE="restart" ;;
    --stop)    MODE="stop" ;;
    --help|-h)
      echo "Cách dùng: bash scripts/start.sh [--restart|--stop|--help]"
      echo "  (không tham số)  Khởi động toàn bộ hệ thống từ đầu"
      echo "  --restart        Restart PM2 + reload env (giữ tunnel cũ nếu còn)"
      echo "  --stop           Dừng toàn bộ hệ thống và tunnel"
      exit 0
      ;;
  esac
done

# ==============================================================
echo ""
echo -e "${BOLD}=========================================================="
echo -e "   🚀 HỆ THỐNG KPI TELEGRAM REPORT"

case "$MODE" in
  start)   echo -e "   Khởi động — $(date '+%Y-%m-%d %H:%M')" ;;
  restart) echo -e "   Restart — $(date '+%Y-%m-%d %H:%M')" ;;
  stop)    echo -e "   Dừng hệ thống — $(date '+%Y-%m-%d %H:%M')" ;;
esac

echo -e "==========================================================${NC}"
echo ""

# ==============================================================
# MODE: STOP
# ==============================================================
if [ "$MODE" = "stop" ]; then
  log_step "1/2" "Dừng PM2..."
  pm2 stop all 2>/dev/null && log_ok "Tất cả tiến trình PM2 đã dừng." || log_warn "PM2 không có tiến trình nào đang chạy."

  log_step "2/2" "Dừng cloudflared tunnel..."
  pkill -f "cloudflared tunnel" 2>/dev/null && log_ok "cloudflared đã dừng." || log_warn "cloudflared không chạy."

  echo ""
  echo -e "${GREEN}✅ Hệ thống đã dừng.${NC}"
  echo -e "${CYAN}Để khởi động lại: bash scripts/start.sh${NC}"
  echo ""
  exit 0
fi

# ==============================================================
# MODE: RESTART
# ==============================================================
if [ "$MODE" = "restart" ]; then
  log_step "1/1" "Restart PM2 với env mới từ .env..."
  if [ ! -f "$PROJECT_ROOT/.env" ]; then
    log_error "Không tìm thấy file .env. Hãy chạy install.sh trước."
    exit 1
  fi
  pm2 restart all --update-env 2>/dev/null && \
    log_ok "Tất cả tiến trình PM2 đã được restart." || \
    log_warn "PM2 restart có lỗi — kiểm tra: pm2 logs"

  echo ""
  echo -e "${GREEN}✅ Restart hoàn tất.${NC}"
  echo -e "${CYAN}Xem trạng thái: pm2 status${NC}"
  echo ""
  exit 0
fi

# ==============================================================
# MODE: START (mặc định)
# ==============================================================

# STEP 1 — Kiểm tra tiên quyết
# ==============================================================
log_step "1/6" "Kiểm tra tiên quyết..."

PREREQ_OK=true

# Kiểm tra file .env
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  log_error "Không tìm thấy file .env!"
  echo -e "  ${YELLOW}Hãy tạo file .env từ mẫu:${NC}"
  echo -e "  ${CYAN}cp .env.example .env && nano .env${NC}"
  exit 1
fi

# Kiểm tra các biến bắt buộc
check_required_var() {
  local var_name=$1
  local value
  value=$(grep -E "^${var_name}=" "$PROJECT_ROOT/.env" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | xargs)
  if [ -z "$value" ] || [[ "$value" == *"YOUR_"* ]]; then
    log_error "Biến $var_name chưa được đặt trong .env"
    PREREQ_OK=false
  fi
}

check_required_var "DATABASE_URL"
check_required_var "TELEGRAM_BOT_TOKEN"

if [ "$PREREQ_OK" = false ]; then
  echo -e "\n  ${YELLOW}Hãy điền đầy đủ .env rồi chạy lại.${NC}"
  exit 1
fi

# Kiểm tra PM2
if ! command -v pm2 &>/dev/null; then
  log_error "PM2 chưa được cài. Hãy chạy: bash scripts/install.sh"
  exit 1
fi

# Kiểm tra cloudflared
if ! command -v cloudflared &>/dev/null; then
  log_error "cloudflared chưa được cài. Hãy chạy: bash scripts/install.sh"
  exit 1
fi

# Kiểm tra web-admin đã build chưa
if [ ! -f "$PROJECT_ROOT/apps/web-admin/dist/index.html" ]; then
  log_warn "Web-admin chưa được build. Đang build..."
  cd "$PROJECT_ROOT/apps/web-admin"
  node node_modules/vite/bin/vite.js build --silent 2>/dev/null || npm run build --silent
  cd "$PROJECT_ROOT"
  log_ok "Web-admin đã được build."
else
  log_ok "Web-admin OK (dist/ đã có)."
fi

log_ok "Tất cả kiểm tra tiên quyết đã pass."

# ==============================================================
# STEP 2 — Dọn dẹp tiến trình cũ
# ==============================================================
log_step "2/6" "Dọn dẹp tiến trình cũ..."

pm2 delete kpi-api     2>/dev/null || true
pm2 delete kpi-bot     2>/dev/null || true
pm2 delete timekeep-bot 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true

# Xóa log cloudflare cũ để đọc URL mới chính xác
rm -f "$PROJECT_ROOT/cloudflare.log" "$PROJECT_ROOT/cf_err.log"

log_ok "Đã dọn dẹp xong."

# ==============================================================
# STEP 3 — Khởi động PM2 via ecosystem.config.cjs
# ==============================================================
log_step "3/6" "Khởi động API và Bot qua PM2..."

export NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"

pm2 start "$PROJECT_ROOT/ecosystem.config.cjs" 2>&1 | grep -E "online|error|✓" || true

# Chờ PM2 khởi động ổn định
sleep 3

# Kiểm tra trạng thái
API_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
  procs = json.load(sys.stdin)
  for p in procs:
    if p.get('name') == 'kpi-api':
      print(p.get('pm2_env', {}).get('status', 'unknown'))
except:
  print('unknown')
" 2>/dev/null || echo "unknown")

BOT_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
  procs = json.load(sys.stdin)
  for p in procs:
    if p.get('name') == 'timekeep-bot':
      print(p.get('pm2_env', {}).get('status', 'unknown'))
except:
  print('unknown')
" 2>/dev/null || echo "unknown")

if [ "$API_STATUS" = "online" ]; then
  log_ok "kpi-api đang chạy (port 3001)."
else
  log_warn "kpi-api trạng thái: $API_STATUS — kiểm tra: pm2 logs kpi-api"
fi

if [ "$BOT_STATUS" = "online" ]; then
  log_ok "timekeep-bot đang chạy (port 3009)."
else
  log_warn "timekeep-bot trạng thái: $BOT_STATUS — kiểm tra: pm2 logs timekeep-bot"
fi

# ==============================================================
# STEP 4 — Khởi động Cloudflare Tunnel
# ==============================================================
log_step "4/6" "Khởi động Cloudflare Tunnel (trỏ vào port 3009)..."

# Chạy cloudflared nền, stdout → cloudflare.log, stderr → cf_err.log
nohup cloudflared tunnel --url http://localhost:3009 \
  > "$PROJECT_ROOT/cloudflare.log" \
  2> "$PROJECT_ROOT/cf_err.log" &

CLOUDFLARED_PID=$!
log_info "cloudflared đang khởi động (PID: $CLOUDFLARED_PID)..."
echo "  ⏳ Đang chờ đường hầm kết nối (tối đa 20 giây)..."

# ==============================================================
# STEP 5 — Đọc URL Cloudflare và cập nhật .env
# ==============================================================
log_step "5/6" "Lấy Cloudflare URL và cập nhật .env..."

CLOUDFLARE_URL=""
WAIT_COUNT=0
MAX_WAIT=20  # tối đa 20 giây

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
  sleep 1
  WAIT_COUNT=$((WAIT_COUNT + 1))

  # Tìm URL trong cả 2 file log (cloudflared ghi vào stderr)
  CLOUDFLARE_URL=$(cat "$PROJECT_ROOT/cf_err.log" "$PROJECT_ROOT/cloudflare.log" 2>/dev/null \
    | grep -oP 'https://[a-z0-9\-]+\.trycloudflare\.com' \
    | head -1)

  if [ -n "$CLOUDFLARE_URL" ]; then
    break
  fi

  # Hiển thị tiến trình mỗi 5 giây
  if [ $((WAIT_COUNT % 5)) -eq 0 ]; then
    log_info "Đang chờ... ($WAIT_COUNT/$MAX_WAIT giây)"
  fi
done

if [ -n "$CLOUDFLARE_URL" ]; then
  log_ok "Cloudflare URL: $CLOUDFLARE_URL"

  # Cập nhật MINI_APP_URL trong .env
  sed -i "s|^MINI_APP_URL=.*|MINI_APP_URL=$CLOUDFLARE_URL|" "$PROJECT_ROOT/.env"
  log_ok "MINI_APP_URL đã được cập nhật trong .env."

  # Restart PM2 với env mới để bot nhận URL mới
  pm2 restart all --update-env 2>/dev/null
  log_ok "PM2 đã được restart với env mới."
else
  log_warn "Không lấy được Cloudflare URL sau $MAX_WAIT giây."
  log_info "Kiểm tra log: cat cf_err.log | tail -20"
  log_info "Nếu tunnel hoạt động sau, chạy: bash scripts/start.sh --restart"
  CLOUDFLARE_URL="(chưa lấy được — xem cf_err.log)"
fi

# ==============================================================
# STEP 6 — Lưu trạng thái PM2 & hiển thị kết quả
# ==============================================================
log_step "6/6" "Lưu trạng thái PM2..."

pm2 save 2>/dev/null && log_ok "Trạng thái PM2 đã được lưu (auto-restart khi reboot)." || true

# ==============================================================
# KẾT QUẢ CUỐI
# ==============================================================
API_PORT=$(grep -E "^API_PORT=" "$PROJECT_ROOT/.env" 2>/dev/null | cut -d'=' -f2 | xargs || echo "3001")

echo ""
echo -e "${GREEN}${BOLD}=========================================================="
echo -e "   ✅ HỆ THỐNG KPI ĐÃ KHỞI CHẠY THÀNH CÔNG!"
echo -e "==========================================================${NC}"
echo ""
echo -e "  ${BOLD}📡 TELEGRAM MINI APP URL (dán vào BotFather → /editapp):${NC}"
echo -e "  ${CYAN}👉 $CLOUDFLARE_URL${NC}"
echo ""
echo -e "  ${BOLD}🖥️  WEB ADMIN:${NC}"
echo -e "  ${CYAN}👉 http://localhost:$API_PORT${NC}"
echo ""
echo -e "  ${BOLD}📊 PM2 Process List:${NC}"
pm2 list 2>/dev/null | grep -E "name|kpi-api|timekeep-bot" || true
echo ""
echo -e "  ${BOLD}💡 Lệnh hữu ích:${NC}"
echo -e "  • Xem tiến trình:   ${CYAN}pm2 monit${NC}"
echo -e "  • Xem log API:      ${CYAN}pm2 logs kpi-api${NC}"
echo -e "  • Xem log Bot:      ${CYAN}pm2 logs timekeep-bot${NC}"
echo -e "  • Dừng hệ thống:   ${CYAN}bash scripts/start.sh --stop${NC}"
echo -e "  • Chỉ restart:     ${CYAN}bash scripts/start.sh --restart${NC}"
echo -e "  • Cập nhật code:   ${CYAN}bash scripts/update.sh${NC}"
echo ""
