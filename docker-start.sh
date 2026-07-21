#!/bin/bash
# ==============================================================
#  docker-start.sh
#  Khởi động hệ thống KPI Telegram Report bằng Docker và tự động
#  cập nhật URL Mini App từ Cloudflare Quick Tunnel.
# ==============================================================

# ---- Màu sắc terminal ----
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== KHỞI ĐỘNG HỆ THỐNG KPI VIA DOCKER ===${NC}"

# 0. Tạo thư mục mount logs trên host nếu chưa có để tránh lỗi permission
echo -e "${YELLOW}⏳ Đang khởi tạo thư mục logs tại /home/giang-adsup/mount/logs...${NC}"
mkdir -p /home/giang-adsup/mount/logs

# 1. Chạy docker compose up (tự động build lại nếu có thay đổi code)
docker compose up -d --build

# 2. Chờ Quick Tunnel tạo URL
echo -e "${YELLOW}⏳ Đang chờ Cloudflare Quick Tunnel cấp phát URL (khoảng 10-15s)...${NC}"
sleep 12

# 3. Lấy URL từ Docker log
CLOUDFLARE_URL=$(docker logs kpi_cloudflared 2>&1 | grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" | head -n 1)

if [ -n "$CLOUDFLARE_URL" ]; then
    echo -e "${GREEN}✅ Đã tìm thấy Cloudflare URL: ${CLOUDFLARE_URL}${NC}"
    
    # Cập nhật MINI_APP_URL vào /home/giang-adsup/mount/.env
    sed -i "s|^MINI_APP_URL=.*|MINI_APP_URL=$CLOUDFLARE_URL|" /home/giang-adsup/mount/.env
    echo -e "${GREEN}✅ Đã cập nhật MINI_APP_URL vào /home/giang-adsup/mount/.env${NC}"
    
    # Khởi động lại các container có cấu hình thay đổi để nhận env mới
    echo -e "${YELLOW}🔄 Đang tải lại cấu hình cho Bot và API...${NC}"
    docker compose up -d
    
    
    echo -e "\n${GREEN}==========================================================${NC}"
    echo -e "${GREEN}🚀 HỆ THỐNG DOCKER ĐÃ SẴN SÀNG!${NC}"
    echo -e "${GREEN}----------------------------------------------------------${NC}"
    echo -e "📲 URL Mini App (Dán vào BotFather -> /editapp):"
    echo -e "👉 ${CLOUDFLARE_URL}"
    echo -e "${GREEN}==========================================================${NC}\n"
else
    echo -e "${YELLOW}⚠️ Không tìm thấy URL Quick Tunnel tự động từ log.${NC}"
    echo -e "Điều này bình thường nếu bạn đang cấu hình CLOUDFLARE_TUNNEL_TOKEN cố định."
    echo -e "Nếu dùng Quick Tunnel, vui lòng chạy lệnh này sau vài giây nữa để cập nhật:"
    echo -e "👉 ${BLUE}bash docker-start.sh${NC}"
fi
