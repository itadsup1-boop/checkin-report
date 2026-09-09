/**
 * CỔNG VÀO CÔNG KHAI DUY NHẤT CỦA DOMAIN RETAIL CHECK-IN
 */

import { createRetailRepository } from './infrastructure/postgres/retail-repository.js';
import { createRetailSheetSync } from './infrastructure/google-sheet/retail-sheet.js';
import { createProcessStoreCheckin } from './application/process-store-checkin.js';
import { createSummarizeDailyKpi } from './application/summarize-daily-kpi.js';
import { createSendProgressReminders } from './application/send-progress-reminders.js';
import { createGetRetailOverview } from './application/get-retail-overview.js';
import { createGetRetailMonthlyOverview } from './application/get-retail-monthly-overview.js';
import { createGetMemberRetailHistory } from './application/get-member-retail-history.js';
import { createUpdateMemberRetailKpi } from './application/update-member-retail-kpi.js';
import { registerRetailTelegramHandler } from './interfaces/telegram/register-retail-handler.js';
import { registerRetailCron } from './interfaces/cron/register-retail-cron.js';
import { registerRetailMiniappRoutes } from './interfaces/miniapp-api/register-retail-miniapp-routes.js';
import { registerRetailAdminRoutes } from './interfaces/admin-api/register-retail-admin-routes.js';

export function registerRetailCheckinModule({
    botApp,
    bot,
    pool,
    cron,
    moment,
    crypto,
    fs,
    uploadToDrive,
    getOrCreateRetailFolderHierarchy,
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
        moment,
        bot,
        uploadToDrive,
        getOrCreateRetailFolderHierarchy
    });

    const summarizeDailyKpi = createSummarizeDailyKpi({
        repository,
        bot,
        moment,
        sheetSync
    });

    const sendProgressReminders = createSendProgressReminders({
        repository,
        bot,
        moment
    });

    // Đăng ký Telegram listener
    registerRetailTelegramHandler({
        bot,
        repository,
        moment,
        processStoreCheckin,
        sendProgressReminders,
        summarizeDailyKpi,
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
            uploadToDrive,
            getOrCreateRetailFolderHierarchy,
            retailUploadDir,
            authenticateTelegramMiniApp
        });
    }

    // Đăng ký Cron tự động
    if (cron) {
        registerRetailCron({
            cron,
            sendProgressReminders,
            summarizeDailyKpi,
            repository
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

export function registerRetailAdminModule({ app, pool, moment }) {
    const repository = createRetailRepository({ pool });
    const getRetailOverview = createGetRetailOverview({ repository, moment });
    const getRetailMonthlyOverview = createGetRetailMonthlyOverview({ repository, moment });
    const getMemberRetailHistory = createGetMemberRetailHistory({ repository });
    const updateMemberRetailKpi = createUpdateMemberRetailKpi({ repository });

    registerRetailAdminRoutes({
        app,
        getRetailOverview,
        getRetailMonthlyOverview,
        getMemberRetailHistory,
        updateMemberRetailKpi,
        repository
    });

    console.log('[Retail Admin Module] Đã đăng ký thành công các route Admin cho Check-in Thị Trường.');

    return {
        repository,
        getRetailOverview,
        getRetailMonthlyOverview,
        getMemberRetailHistory,
        updateMemberRetailKpi
    };
}

