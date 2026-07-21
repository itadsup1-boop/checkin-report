#!/bin/bash
# ==============================================================
#  scripts/update.sh
#  Cập nhật code mới và khởi động lại hệ thống KPI
#
#  Cách dùng:
#    bash scripts/update.sh           ← cập nhật đầy đủ (git pull + build + restart)
#    bash scripts/update.sh --no-pull ← bỏ qua git pull (chỉ build + restart)
#    bash scripts/update.sh --no-build← bỏ qua build web-admin (nhanh hơn)
# ==============================================================

# ---- Màu sắc terminal ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_step()  { echo -e "\n${BLUE}${BOLD}[STEP $1]${NC} $2"; }
log_ok()    { echo -e "  ${GREEN}✅ $1${NC}"; }
log_warn()  { echo -e "  ${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "  ${RED}❌ $1${NC}"; }
log_info()  { echo -e "  ${CYAN}ℹ️  $1${NC}"; }

# ---- Xác định thư mục gốc ----
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# ---- Tham số ----
DO_PULL=true
DO_BUILD=true
for arg in "$@"; do
  case "$arg" in
    --no-pull)  DO_PULL=false ;;
    --no-build) DO_BUILD=false ;;
    --help|-h)
      echo "Cách dùng: bash scripts/update.sh [--no-pull] [--no-build]"
      echo "  (không tham số)  Pull code + build web-admin + restart PM2"
      echo "  --no-pull        Bỏ qua git pull (dùng khi sửa code trực tiếp)"
      echo "  --no-build       Bỏ qua build web-admin (nhanh, khi chỉ sửa backend)"
      exit 0
      ;;
  esac
done

# ==============================================================
echo ""
echo -e "${BOLD}=========================================================="
echo -e "   🔄 CẬP NHẬT HỆ THỐNG KPI TELEGRAM REPORT"
echo -e "   $(date '+%Y-%m-%d %H:%M')"
echo -e "==========================================================${NC}"
echo ""

# Ghi lại thời điểm bắt đầu
START_TIME=$(date +%s)

# ==============================================================
# STEP 1 — Git pull
# ==============================================================
log_step "1/4" "Cập nhật code từ git..."

if [ "$DO_PULL" = false ]; then
  log_info "Bỏ qua git pull (--no-pull)."
elif ! command -v git &>/dev/null; then
  log_warn "git chưa được cài. Bỏ qua bước pull."
  log_info "Cài git: sudo apt-get install -y git"
elif [ ! -d "$PROJECT_ROOT/.git" ]; then
  log_warn "Thư mục không phải git repo. Bỏ qua bước pull."
  log_info "Để khởi tạo git: git init && git remote add origin <URL>"
else
  # Lưu commit hiện tại để so sánh
  BEFORE_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

  # Kiểm tra có thay đổi local chưa commit không
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    log_warn "Có thay đổi local chưa commit:"
    git status --short 2>/dev/null | head -10
    echo ""
    read -rp "  Tiếp tục git pull (có thể gây conflict)? (y/N): " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
      log_info "Hủy. Hãy commit hoặc stash trước: git stash"
      exit 0
    fi
  fi

  # Pull
  BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
  log_info "Đang pull từ origin/$BRANCH..."

  if git pull origin "$BRANCH" 2>&1; then
    AFTER_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    if [ "$BEFORE_COMMIT" = "$AFTER_COMMIT" ]; then
      log_ok "Code đã là mới nhất ($AFTER_COMMIT) — không có thay đổi."
    else
      log_ok "Đã cập nhật: $BEFORE_COMMIT → $AFTER_COMMIT"
      # Hiển thị commit mới
      echo ""
      echo -e "  ${CYAN}Commits mới:${NC}"
      git log "$BEFORE_COMMIT"..HEAD --oneline 2>/dev/null | head -10 | sed 's/^/    /'
    fi
  else
    log_error "git pull thất bại. Kiểm tra kết nối hoặc conflict."
    exit 1
  fi
fi

# ==============================================================
# STEP 2 — Cài npm packages (root)
# ==============================================================
log_step "2/4" "Kiểm tra và cài root npm packages..."

# Phát hiện có package.json mới không (so với node_modules)
if [ -f "$PROJECT_ROOT/package-lock.json" ]; then
  LOCK_NEWER=$(find "$PROJECT_ROOT" -maxdepth 1 -name "package-lock.json" \
    -newer "$PROJECT_ROOT/node_modules/.package-lock.json" 2>/dev/null | wc -l)
  if [ "$LOCK_NEWER" -gt 0 ] || [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    log_info "Phát hiện package-lock.json thay đổi. Cài packages..."
    npm ci --silent 2>/dev/null || npm install --silent
    log_ok "Root packages đã được cập nhật."
  else
    log_ok "Root packages không thay đổi — bỏ qua."
  fi
else
  npm install --silent
  log_ok "Root packages OK."
fi

# ==============================================================
# STEP 3 — Build web-admin
# ==============================================================
log_step "3/4" "Build web-admin (React → production)..."

if [ "$DO_BUILD" = false ]; then
  log_info "Bỏ qua build web-admin (--no-build)."
else
  cd "$PROJECT_ROOT/apps/web-admin"

  # Cài web-admin packages nếu cần
  if [ -f "package-lock.json" ]; then
    WEB_LOCK_NEWER=$(find . -maxdepth 1 -name "package-lock.json" \
      -newer "node_modules/.package-lock.json" 2>/dev/null | wc -l)
    if [ "$WEB_LOCK_NEWER" -gt 0 ] || [ ! -d "node_modules" ]; then
      log_info "Cài web-admin packages..."
      npm ci --silent 2>/dev/null || npm install --silent
    fi
  fi

  log_info "Đang build..."
  BUILD_OUT=$(node node_modules/vite/bin/vite.js build 2>&1) && BUILD_OK=true || BUILD_OK=false

  if [ "$BUILD_OK" = true ]; then
    # Lấy kích thước file build
    DIST_SIZE=$(du -sh dist/ 2>/dev/null | awk '{print $1}' || echo "?")
    JS_SIZE=$(ls -la dist/assets/*.js 2>/dev/null | awk '{print $5}' | head -1 | numfmt --to=iec 2>/dev/null || echo "?")
    log_ok "Build thành công — dist/ ($DIST_SIZE)"
    echo "$BUILD_OUT" | grep -E "✓|kB|gzip" | sed 's/^/    /'
  else
    log_error "Build thất bại! Chi tiết:"
    echo "$BUILD_OUT" | tail -20 | sed 's/^/    /'
    cd "$PROJECT_ROOT"
    exit 1
  fi

  cd "$PROJECT_ROOT"
fi

# ==============================================================
# STEP 4 — Restart PM2
# ==============================================================
log_step "4/4" "Restart PM2 với env mới..."

if ! command -v pm2 &>/dev/null; then
  log_error "PM2 chưa được cài. Chạy: bash scripts/install.sh"
  exit 1
fi

# Kiểm tra PM2 có process nào đang chạy không
RUNNING=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
  procs = json.load(sys.stdin)
  print(len([p for p in procs if p.get('pm2_env',{}).get('status')=='online']))
except:
  print(0)
" 2>/dev/null || echo "0")

if [ "$RUNNING" -gt 0 ]; then
  log_info "$RUNNING tiến trình đang chạy — đang restart..."
  pm2 restart all --update-env 2>&1 | grep -E "✓|online|error" | head -10 | sed 's/^/    /'
  log_ok "PM2 đã được restart."
else
  log_warn "Không có tiến trình PM2 nào đang chạy."
  log_info "Khởi động hệ thống: bash scripts/start.sh"
fi

pm2 save 2>/dev/null | grep -v "^$" | sed 's/^/    /' || true

# ==============================================================
# HOÀN THÀNH
# ==============================================================
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo -e "${GREEN}${BOLD}=========================================================="
echo -e "   ✅ CẬP NHẬT HOÀN TẤT! (${ELAPSED}s)"
echo -e "==========================================================${NC}"
echo ""
echo -e "  ${BOLD}Trạng thái PM2 hiện tại:${NC}"
pm2 list 2>/dev/null | grep -E "name|kpi-api|timekeep-bot" | head -5 || true
echo ""
echo -e "  ${CYAN}Lệnh hữu ích:${NC}"
echo -e "  • Xem log real-time: ${CYAN}pm2 logs${NC}"
echo -e "  • Monitor:           ${CYAN}pm2 monit${NC}"
echo ""
