/**
 * Cổng duy nhất của domain "lịch khách".
 *
 * Bên ngoài CHỈ được import file này. Không ai được với tay vào domain/,
 * application/, infrastructure/ hay interfaces/ — giống cách domains/warehouse
 * đang làm.
 *
 * Phạm vi hiện tại: phần **Báo bù công tour** của role `report_tour`.
 * Bảy endpoint /api/schedules* còn lại (dùng chung với role `report`) vẫn nằm
 * trong apps/bot/kpi_features.js và sẽ chuyển sang đây ở đợt sau.
 */

import { createMakeupRepository } from './infrastructure/postgres/makeup-repository.js';
import { createProofImageStore } from './infrastructure/storage/proof-image-store.js';
import { createMakeupNotifier } from './interfaces/telegram/makeup-notification.js';
import { createMakeupRequestService } from './application/create-makeup-request.js';
import { createReviewMakeupService } from './application/review-makeup-request.js';
import { registerMakeupRoutes } from './interfaces/miniapp-api/makeup-routes.js';
import { registerMakeupActions } from './interfaces/telegram/register-makeup-actions.js';

/**
 * Lắp chức năng báo bù công tour vào bot.
 *
 * Nhận phụ thuộc từ ngoài thay vì tự import: bot hiện dùng chung một pool, một
 * bộ helper ảnh và một hàm gửi Telegram — tự tạo bản riêng sẽ lệch hành vi.
 *
 * @param {object} deps
 * @param {object} deps.botApp Express app của bot
 * @param {object} deps.bot Telegraf
 * @param {object} deps.pool pg Pool
 * @param {Function} deps.authenticateTelegramMiniApp
 * @param {Function} deps.checkPayloadLimit
 * @param {Function} deps.isValidImage kiểm magic bytes
 * @param {Function} deps.getImageExtension
 * @param {Function} deps.escapeHtml
 * @param {Function} deps.sendPhotoToRoleGroup
 * @param {object} deps.fs
 * @param {object} deps.path
 * @param {Function} deps.moment
 * @param {string} deps.uploadDir
 * @param {string} deps.publicBaseUrl
 */
export function registerSchedulingModule({
    botApp,
    bot,
    pool,
    kpiComposer,
    authenticateTelegramMiniApp,
    checkPayloadLimit,
    isValidImage,
    getImageExtension,
    escapeHtml,
    sendPhotoToRoleGroup,
    syncMakeupToGoogleSheet,
    fs,
    path,
    moment,
    uploadDir,
    publicBaseUrl
}) {
    const repository = createMakeupRepository({ pool });

    const imageStore = createProofImageStore({
        fs, path, isValidImage, getImageExtension, uploadDir, publicBaseUrl
    });

    const notifier = createMakeupNotifier({ bot, escapeHtml, sendPhotoToRoleGroup, moment });

    const makeupService = createMakeupRequestService({
        pool, repository, imageStore, notifier, moment
    });

    const reviewService = createReviewMakeupService({
        pool,
        repository,
        // Đồng bộ Sheet vẫn nằm ở kpi_features.js (vùng đang có người sửa dở) nên
        // truyền vào thay vì import — xem mục "Còn nợ" trong README.
        syncToSheet: syncMakeupToGoogleSheet
    });

    registerMakeupRoutes({
        botApp, authenticateTelegramMiniApp, checkPayloadLimit, repository, makeupService
    });

    // kpiComposer là tuỳ chọn: harness test đăng ký route không cần Telegraf.
    if (kpiComposer) {
        registerMakeupActions({ kpiComposer, reviewService });
    }

    return Object.freeze({ makeupService, reviewService });
}
