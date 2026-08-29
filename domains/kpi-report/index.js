/**
 * Cổng duy nhất của domain "báo cáo KPI hàng ngày".
 *
 * Bên ngoài CHỈ được import file này. Không ai được với tay vào domain/,
 * application/, infrastructure/ hay interfaces/ — giống cách domains/warehouse
 * và domains/scheduling đang làm.
 *
 * Phạm vi: nhận diện báo cáo (lệnh trigger hoặc tự nhiên), chờ đủ ảnh minh
 * chứng, chốt báo cáo + tính phạt (thiếu KPI, nợ ảnh, không nộp), 2 cron
 * nhắc/phạt/hạn ảnh, chống trùng ảnh, đồng bộ Google Sheet, và 2 route HTTP
 * của Mini App "Điền báo cáo".
 *
 * KHÔNG thuộc domain này (cố ý để lại `apps/bot/kpi_features.js`): `/setup` và
 * `bot.start()` (đăng ký nhân viên/nhóm dùng chung cho mọi vai trò báo cáo),
 * lệnh `/xoalich`/`/lich`/`/batnhanlich`/`/tatnhanlich` (thuộc lịch khách —
 * xem domains/scheduling), và các middleware/helper dùng chung nhiều nơi
 * (`authenticateTelegramMiniApp`, `checkAdmin`, `checkPayloadLimit`,
 * `isValidImage`, `getImageExtension`, `escapeHtml`) — vẫn định nghĩa ở
 * kpi_features.js và được truyền vào đây như phụ thuộc.
 */

import { createReportRepository } from './infrastructure/postgres/report-repository.js';
import { createReminderRepository } from './infrastructure/postgres/reminder-repository.js';
import { createGroupConfigRepository } from './infrastructure/postgres/group-config-repository.js';
import { createKpiReportSheetSync } from './infrastructure/google-sheet/kpi-report-sheet-sync.js';
import { createFinalizeReport } from './application/finalize-report.js';
import { createSendReportPhotos } from './application/send-report-photos.js';
import { registerReportTextHandler } from './interfaces/telegram/register-report-text-handler.js';
import { registerReportPhotoHandler } from './interfaces/telegram/register-report-photo-handler.js';
import { registerReportCommands } from './interfaces/telegram/register-report-commands.js';
import { registerReportCallbacks } from './interfaces/telegram/register-report-callbacks.js';
import { registerReportFormRoutes } from './interfaces/miniapp-api/report-form-routes.js';
import { registerReminderCron } from './interfaces/cron/register-reminder-cron.js';
import { registerDeadlineCron } from './interfaces/cron/register-deadline-cron.js';

/**
 * Lắp chức năng báo cáo KPI hàng ngày vào bot.
 *
 * @param {object} deps
 * @param {object} deps.botApp Express app của bot
 * @param {object} deps.bot Telegraf
 * @param {object} deps.pool pg Pool
 * @param {object} deps.kpiComposer Composer dùng chung của nhóm report/report_tour
 * @param {object} deps.cron node-cron
 * @param {Function} deps.authenticateTelegramMiniApp
 * @param {Function} deps.checkAdmin
 * @param {Function} deps.getGroupRole
 * @param {Function} deps.sendMessageToRoleGroup
 * @param {Function} deps.sendMediaGroupToRoleGroup
 * @param {Function} deps.getKpiDocForGroup
 * @param {Function} deps.getEmployeeMembership
 * @param {Function} deps.computeHashFromBase64
 * @param {Function} deps.findDuplicateImages
 * @param {Function} deps.saveHashesToDB
 * @param {object} deps.crypto
 */
export function registerKpiReportModule({
    botApp,
    bot,
    pool,
    kpiComposer,
    cron,
    authenticateTelegramMiniApp,
    checkAdmin,
    getGroupRole,
    sendMessageToRoleGroup,
    sendMediaGroupToRoleGroup,
    getKpiDocForGroup,
    getEmployeeMembership,
    computeHashFromBase64,
    findDuplicateImages,
    saveHashesToDB,
    crypto
}) {
    const reportRepository = createReportRepository({ pool });
    const reminderRepository = createReminderRepository({ pool });
    const groupConfigRepository = createGroupConfigRepository({ pool });
    const sheetSync = createKpiReportSheetSync({ getKpiDocForGroup });

    const { finalizeReport } = createFinalizeReport({
        reportRepository, groupConfigRepository, sheetSync, sendMessageToRoleGroup
    });
    const sendReportPhotos = createSendReportPhotos({
        bot, pool, sendMediaGroupToRoleGroup, sendMessageToRoleGroup,
        computeHashFromBase64, findDuplicateImages, saveHashesToDB
    });

    registerReportTextHandler({ kpiComposer, reportRepository, groupConfigRepository, finalizeReport, getEmployeeMembership, pool });
    registerReportPhotoHandler({
        bot, kpiComposer, pool, reportRepository, finalizeReport, getEmployeeMembership,
        computeHashFromBase64, findDuplicateImages, saveHashesToDB, sendMessageToRoleGroup, sendMediaGroupToRoleGroup
    });
    registerReportCommands({ kpiComposer, groupConfigRepository, reportRepository, checkAdmin });
    registerReportCallbacks({ bot, kpiComposer, reportRepository, finalizeReport, crypto });

    registerReportFormRoutes({
        botApp, authenticateTelegramMiniApp, getGroupRole, pool,
        reportRepository, groupConfigRepository, finalizeReport, sendReportPhotos,
        getEmployeeMembership, sendMessageToRoleGroup, bot
    });

    const scheduledJobs = cron
        ? [
            registerReminderCron({ cron, reminderRepository, sheetSync, sendMessageToRoleGroup, bot }),
            registerDeadlineCron({
                cron, reportRepository, groupConfigRepository, finalizeReport,
                getEmployeeMembership, pool, sendMessageToRoleGroup, bot
            })
        ]
        : [];

    return Object.freeze({
        reportRepository,
        finalizeReport,
        scheduledJobs
    });
}
