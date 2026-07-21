#!/bin/bash

# Di chuyển đến thư mục dự án
cd /home/giang-adsup/Documents/telegramReport

export NODE_OPTIONS=--dns-result-order=ipv4first

echo "🚀 Đang dọn dẹp các tiến trình cũ..."
pm2 delete kpi-api 2>/dev/null || true
pm2 delete kpi-bot 2>/dev/null || true
pkill -f "cloudflared tunnel --url http://localhost:3001" || true

echo "📦 Đang khởi động API & Web Server (Chạy ngầm)..."
pm2 start apps/api/index.js --name "kpi-api"


echo "🤖 Đang khởi động Telegram Bot (Chạy ngầm)..."
pm2 start apps/bot/index.js --name "kpi-bot"

echo "🌐 Đang khởi động đường hầm mạng Cloudflare..."
nohup cloudflared tunnel --url http://localhost:3001 > cloudflare.log 2>&1 &

echo "⏳ Đang cấu hình kết nối mạng (vui lòng đợi 10 giây)..."
sleep 10

CLOUDFLARE_URL=$(grep -o 'https://[a-z0-9\-]*\.trycloudflare\.com' cloudflare.log | head -n 1)

if [ -z "$CLOUDFLARE_URL" ]; then
    CLOUDFLARE_URL="Lỗi không lấy được link, hãy thử chạy lại file sh"
else
    # Tự động cập nhật MINI_APP_URL trong .env
    sed -i "s|^MINI_APP_URL=.*|MINI_APP_URL=$CLOUDFLARE_URL|" .env
    pm2 restart all --update-env
fi

echo ""
echo "=========================================================="
echo "✅ HỆ THỐNG KPI ĐÃ KHỞI CHẠY THÀNH CÔNG!"
echo "=========================================================="
echo "🎯 MINI APP URL (Cloudflare Tunnel):"
echo "👉 $CLOUDFLARE_URL"
echo ""
echo "🖥️  WEB ADMIN LOCAL:"
echo "👉 http://localhost:3001"
echo "=========================================================="
echo "💡 Ghi chú:"
echo "- Để xem trực tiếp tiến trình, gõ: pm2 monit"
echo "- Để xem lỗi của Bot nếu có, gõ: pm2 logs kpi-bot"
echo "- Để tắt toàn bộ hệ thống, gõ: pm2 stop all"
echo "=========================================================="
