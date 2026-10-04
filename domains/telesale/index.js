/**
 * CỔNG VÀO CÔNG KHAI DUY NHẤT CỦA DOMAIN TELESALE
 */

import { createTelesaleRepository } from './infrastructure/postgres/telesale-repository.js';
import { createTelesaleSheetSync } from './infrastructure/google-sheet/telesale-sheet-sync.js';
import { createSubmitTelesaleReport } from './application/submit-telesale-report.js';
import { createGetTelesaleBootstrap } from './application/get-telesale-bootstrap.js';
import { createSendTelesaleReminder } from './application/send-telesale-reminder.js';
import { createScanTelesaleDeadline } from './application/scan-telesale-deadline.js';
import { createSummarizeDailyTelesale } from './application/summarize-daily-telesale.js';
import { registerTelesaleTelegramHandler } from './interfaces/telegram/register-telesale-handler.js';
import { registerTelesaleMiniappRoutes } from './interfaces/miniapp-api/telesale-routes.js';
import { registerTelesaleCrons } from './interfaces/cron/register-telesale-crons.js';

import { registerTelesaleAdminRoutes } from './interfaces/admin-api/telesale-admin-routes.js';

export function registerTelesaleAdminModule({ app, pool, adminAuth, bot = null, getDocById = null }) {
    const telesaleRepository = createTelesaleRepository({ pool });
    const sendTelesaleReminder = createSendTelesaleReminder({
        telesaleRepository,
        bot
    });

    const telesaleSheetSync = getDocById ? createTelesaleSheetSync({ getDocById }) : null;

    registerTelesaleAdminRoutes({
        app,
        telesaleRepository,
        sendTelesaleReminder,
        adminAuth,
        telesaleSheetSync
    });

    return {
        telesaleRepository,
        sendTelesaleReminder,
        telesaleSheetSync
    };
}

export function registerTelesaleModule({
    botApp,
    bot,
    pool,
    cron,
    getDocById,
    getGroupRole
}) {
    const telesaleRepository = createTelesaleRepository({ pool });
    const telesaleSheetSync = createTelesaleSheetSync({ getDocById });

    const submitTelesaleReport = createSubmitTelesaleReport({
        telesaleRepository,
        telesaleSheetSync,
        bot
    });

    const getTelesaleBootstrap = createGetTelesaleBootstrap({
        telesaleRepository
    });

    const sendTelesaleReminder = createSendTelesaleReminder({
        telesaleRepository,
        bot
    });

    const scanTelesaleDeadline = createScanTelesaleDeadline({
        telesaleRepository,
        telesaleSheetSync,
        bot
    });

    const summarizeDailyTelesale = createSummarizeDailyTelesale({
        telesaleRepository,
        bot
    });

    // 1. Đăng ký Telegram handler
    registerTelesaleTelegramHandler({
        bot,
        telesaleRepository,
        summarizeDailyTelesale,
        submitTelesaleReport,
        getGroupRole
    });

    // 2. Đăng ký Mini App routes
    registerTelesaleMiniappRoutes({
        botApp,
        getTelesaleBootstrap,
        submitTelesaleReport
    });

    // 3. Đăng ký Cron tự động
    const crons = registerTelesaleCrons({
        cron,
        telesaleRepository,
        sendTelesaleReminder,
        scanTelesaleDeadline,
        summarizeDailyTelesale
    });

    console.log('[Telesale Module] Đã khởi tạo thành công module Báo Cáo Telesale.');

    return {
        telesaleRepository,
        telesaleSheetSync,
        submitTelesaleReport,
        getTelesaleBootstrap,
        sendTelesaleReminder,
        scanTelesaleDeadline,
        summarizeDailyTelesale,
        crons
    };
}
