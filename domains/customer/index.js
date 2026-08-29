/**
 * CỔNG DUY NHẤT của domain hồ sơ khách hàng.
 *
 * Code ngoài domain chỉ được import file này. Đừng import thẳng vào
 * `application/`, `infrastructure/` hay `interfaces/` — đó là ruột, đổi lúc nào
 * cũng được miễn là cổng này giữ nguyên.
 *
 * Domain tự lắp: HTTP + handler Telegram + worker Drive + cron 22:00.
 *
 * @param {object} deps mọi thứ domain cần, do `apps/bot/timekeep_bot.js` truyền vào
 * @returns {{ processCustomerMediaQueue: Function, stopCustomerMediaWorker: Function }}
 */

import { createCustomerRepository } from './infrastructure/postgres/customer-repository.js';
import { createCustomerDrive } from './infrastructure/drive/customer-drive.js';
import { createCustomerSheet } from './infrastructure/google-sheet/customer-sheet.js';
import { createCustomerNotifier } from './infrastructure/telegram/customer-notifier.js';
import { createCustomerRecordUseCase } from './application/create-customer-record.js';
import { createAcceptTelegramMedia } from './application/accept-telegram-media.js';
import { createTelegramMediaCollector } from './application/collect-telegram-media.js';
import { createSummarizeDailyCustomers } from './application/summarize-daily-customers.js';
import { registerCustomerRoutes } from './interfaces/miniapp-api/customer-routes.js';
import { registerCustomerMediaReply } from './interfaces/telegram/register-media-reply.js';
import { registerCustomerDailySummary } from './interfaces/cron/register-daily-summary.js';

export function registerCustomerModule({
    botApp,
    bot,
    pool,
    cron,
    moment,
    fs,
    escapeHtml,
    getGroupRole,
    authenticateTelegramMiniApp,
    uploadCustomerMedia,
    getOrCreateCustomerFolder,
    uploadToDrive,
    getCustomerDocForGroup,
    driveParentFolderId
}) {
    const repository = createCustomerRepository({ pool });
    const drive = createCustomerDrive({
        getOrCreateCustomerFolder,
        uploadToDrive,
        defaultParentFolderId: driveParentFolderId
    });
    const sheet = createCustomerSheet({ getCustomerDocForGroup });
    const notifier = createCustomerNotifier({ bot });

    // Ảnh reply có thể về trước khi hồ sơ tạo xong thư mục Drive. Map này là chỗ
    // hai luồng gặp nhau, nên phải dùng CHUNG một thể hiện cho cả use case ghi hồ
    // sơ lẫn worker tải file.
    const initializationJobs = new Map();

    const createCustomerRecord = createCustomerRecordUseCase({
        repository, drive, sheet, notifier, moment, fs, escapeHtml, initializationJobs
    });
    const acceptTelegramMedia = createAcceptTelegramMedia({ repository });
    const collector = createTelegramMediaCollector({ repository, drive, notifier, initializationJobs });
    const { summarizeDailyCustomers } = createSummarizeDailyCustomers({
        repository, notifier, moment, escapeHtml
    });

    registerCustomerRoutes({ botApp, authenticateTelegramMiniApp, uploadCustomerMedia, createCustomerRecord });
    registerCustomerMediaReply({ bot, getGroupRole, acceptTelegramMedia });
    registerCustomerDailySummary({ cron, summarizeDailyCustomers });

    const stopCustomerMediaWorker = collector.start();

    return {
        processCustomerMediaQueue: collector.processQueue,
        stopCustomerMediaWorker
    };
}
