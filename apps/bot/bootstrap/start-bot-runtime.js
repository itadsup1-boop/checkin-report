import fs from 'node:fs';
import { setupKpiBot } from '../kpi_features.js';
import { syncGroupsOnStartup } from '../jobs/sync-groups-on-startup.js';

export function startBotRuntime({ bot, botApp, pool, isCompanyHoliday }) {
    const isDocker = fs.existsSync('/.dockerenv');
    const PORT = process.env.PORT || (isDocker ? 3002 : 3009);
    
    
    botApp.get('/api/status', (req, res) => {
        res.json({ status: 'ok', time: new Date().toISOString() });
    });
    
    botApp.get('/isdocker', (req, res) => {
        res.json({ isDocker });
    });
    
    // ========================================
    // DASHBOARD API – Thống kê chấm công
    // ========================================
    // UTC+7 helpers (hoạt động cả host lẫn Docker bất kể TZ container)
    
    
    
    // Daily export cron job at 23:00
    // =====================================
    // ADMIN SCHEDULE MANAGEMENT APIs
    // =====================================
    
    // Admin cập nhật ca trực (thay đổi shift_type)
    
    // Admin thêm lịch trực thủ công
    
    // Admin xóa lịch trực
    
    // Admin đồng bộ Google Sheet Chấm công & Lịch
    // Setup KPI bot features
    setupKpiBot(bot, botApp, { isCompanyHoliday });
    
    botApp.listen(PORT, () => {
        console.log(`[Express] Mini-App Server đang chạy trên cổng ${PORT}`);
    });
    
    // Start Telegraf Bot
    bot.telegram.setMyCommands([
        { command: 'start', description: 'Khởi động bot & nhận liên kết chức năng' },
        // { command: 'setup', description: 'Thiết lập ca trực nhóm (chỉ Admin)' },
        // { command: 'calendar', description: 'Đăng ký lịch làm việc tuần' },
        // { command: 'stats', description: 'Xem lịch tuần & thống kê đi muộn, tiền phạt' }
    ]).then(() => {
        console.log('[Telegraf] Đăng ký danh sách lệnh bot thành công');
    }).catch(err => {
        console.error('[Telegraf Error] Lỗi đăng ký commands:', err);
    });
    
    // 409 Conflict xảy ra khi restart: getUpdates của instance cũ còn giữ
    // phiên trên Telegram vài giây. Telegraf KHÔNG tự retry polling sau 409,
    // nếu không thử lại thì bot chết im cho đến khi ai đó restart tay.
    let launchAttempts = 0;
    const launchBot = () => {
        launchAttempts += 1;
        bot.launch().then(() => {
            console.log('[Telegraf] Bot Chấm công đã sẵn sàng...');
            syncGroupsOnStartup({ bot, pool });
        }).catch((err) => {
            console.error(`[Telegraf Error] Lỗi khởi động Bot (lần ${launchAttempts}):`, err.message);
            if (launchAttempts < 5) {
                const delayMs = launchAttempts * 10 * 1000;
                console.log(`[Telegraf] Thử launch lại sau ${delayMs / 1000}s...`);
                setTimeout(launchBot, delayMs);
            }
        });
    };
    launchBot();
}
