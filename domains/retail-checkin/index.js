/**
 * CỔNG VÀO CÔNG KHAI DUY NHẤT CỦA DOMAIN RETAIL CHECK-IN
 */

import { createRetailRepository } from './infrastructure/postgres/retail-repository.js';
import { createRetailSheetSync } from './infrastructure/google-sheet/retail-sheet.js';
import { createProcessStoreCheckin } from './application/process-store-checkin.js';
import { createSummarizeDailyKpi } from './application/summarize-daily-kpi.js';
import { createSendProgressReminders } from './application/send-progress-reminders.js';
import { registerRetailTelegramHandler } from './interfaces/telegram/register-retail-handler.js';
import { registerRetailCron } from './interfaces/cron/register-retail-cron.js';
import { registerRetailMiniappRoutes } from './interfaces/miniapp-api/register-retail-miniapp-routes.js';

export function registerRetailCheckinModule({
    botApp,
    bot,
    pool,
    cron,
    moment,
    crypto,
    fs,
    retailUploadDir,
    authenticateTelegramMiniApp,
    getGroupRole,
    getDocForGroup
}) {
    const repository = createRetailRepository({ pool });
    const sheetSync = createRetailSheetSync({ getDocForGroup });

    const processStoreCheckin = createProcessStoreCheckin({
        repository,
        sheetSync,
        moment
    });

    const summarizeDailyKpi = createSummarizeDailyKpi({
        repository,
        bot,
        moment
    });

    const sendProgressReminders = createSendProgressReminders({
        repository,
        bot,
        moment
    });

    // Đăng ký Telegram listener
    registerRetailTelegramHandler({
        bot,
        processStoreCheckin,
        getGroupRole,
        crypto
    });

    // Đăng ký REST API cho Mini App
    if (botApp) {
        registerRetailMiniappRoutes({
            botApp,
            bot,
            repository,
            sheetSync,
            moment,
            crypto,
            fs,
            retailUploadDir,
            authenticateTelegramMiniApp
        });
    }

    // Đăng ký Cron tự động
    if (cron) {
        registerRetailCron({
            cron,
            sendProgressReminders,
            summarizeDailyKpi
        });
    }

    console.log('[Retail Checkin Module] Đã khởi tạo thành công module check-in điểm bán thị trường.');

    return {
        repository,
        processStoreCheckin,
        summarizeDailyKpi,
        sendProgressReminders
    };
}
