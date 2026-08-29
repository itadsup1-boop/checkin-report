/**
 * Cổng duy nhất của domain "lịch khách".
 *
 * Bên ngoài CHỈ được import file này. Không ai được với tay vào domain/,
 * application/, infrastructure/ hay interfaces/ — giống cách domains/warehouse
 * đang làm.
 *
 * Phạm vi: toàn bộ lịch khách của role `report`/`report_tour` — đặt lịch, nhắc
 * lịch, xác nhận khách đến/hủy, tổng hợp công tour, báo bù, nợ ảnh, và đồng bộ
 * Google Sheet của tất cả các phần trên.
 */

import { createMakeupRepository } from './infrastructure/postgres/makeup-repository.js';
import { createAppointmentRepository } from './infrastructure/postgres/appointment-repository.js';
import { createAppointmentReportsRepository } from './infrastructure/postgres/appointment-reports-repository.js';
import { createCompletionRepository } from './infrastructure/postgres/completion-repository.js';
import { createProofRepository } from './infrastructure/postgres/proof-repository.js';
import { createRetryRepository } from './infrastructure/postgres/retry-repository.js';
import { createProofImageStore } from './infrastructure/storage/proof-image-store.js';
import { createAppointmentSheetSync } from './infrastructure/google-sheet/appointment-sheet-sync.js';
import { createMakeupNotifier } from './interfaces/telegram/makeup-notification.js';
import { createAppointmentNotifier } from './infrastructure/telegram/appointment-notifier.js';
import { createMakeupRequestService } from './application/create-makeup-request.js';
import { createReviewMakeupService } from './application/review-makeup-request.js';
import { createBookAppointmentService } from './application/book-appointment.js';
import { createManageAppointmentService } from './application/manage-appointment.js';
import { createConfirmArrivalService } from './application/confirm-arrival.js';
import { createScheduleReportService } from './application/schedule-reports.js';
import { createRemindDueAppointments } from './application/remind-due-appointments.js';
import { createSyncMakeupSheet } from './application/sync-makeup-sheet.js';
import { createSubmitProofPhoto } from './application/submit-proof-photo.js';
import { registerMakeupRoutes } from './interfaces/miniapp-api/makeup-routes.js';
import { registerAppointmentRoutes } from './interfaces/miniapp-api/appointment-routes.js';
import { registerPhotoDebtRoutes } from './interfaces/miniapp-api/photo-debt-routes.js';
import { registerMakeupActions } from './interfaces/telegram/register-makeup-actions.js';
import { registerAppointmentActions } from './interfaces/telegram/register-appointment-actions.js';
import { registerPhotoReplyHandler } from './interfaces/telegram/register-photo-reply-handler.js';
import { registerScheduleCrons } from './interfaces/cron/register-schedule-crons.js';
import { registerRetryCron } from './interfaces/cron/register-retry-cron.js';

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
    getCustomerDocForGroup,
    fs,
    path,
    moment,
    uploadDir,
    publicBaseUrl,
    cron,
    sendMessageToRoleGroup,
    getGroupRole,
    adminIds = ''
}) {
    const repository = createMakeupRepository({ pool });
    // Một object duy nhất: cron/báo cáo và luồng đặt/sửa lịch trực tiếp đều gọi
    // qua `repository.<tên hàm>` như trước, chỉ SQL được chia làm 2 file để mỗi
    // file giữ dưới 300 dòng — xem appointment-reports-repository.js.
    const appointments = {
        ...createAppointmentRepository({ pool }),
        ...createAppointmentReportsRepository({ pool })
    };
    const proofRepository = createProofRepository({ pool });
    const retryRepository = createRetryRepository({ pool });

    const imageStore = createProofImageStore({
        fs, path, isValidImage, getImageExtension, uploadDir, publicBaseUrl
    });

    const notifier = createMakeupNotifier({ bot, escapeHtml, sendPhotoToRoleGroup, moment });

    const makeupService = createMakeupRequestService({
        pool, repository, imageStore, notifier, moment
    });

    // Đồng bộ Sheet của lịch khách/báo bù — dùng chung cho duyệt báo bù, nợ ảnh,
    // và cron quét lại khi lỗi.
    const sheetSync = createAppointmentSheetSync({ getCustomerDocForGroup, getGroupRole, moment });
    const { syncMakeupToGoogleSheet } = createSyncMakeupSheet({ retryRepository, sheetSync, moment });
    const submitProofPhoto = createSubmitProofPhoto({
        repository: proofRepository, sheetSync, moment, fs, path, uploadDir, publicBaseUrl
    });

    const reviewService = createReviewMakeupService({
        pool,
        repository,
        syncToSheet: syncMakeupToGoogleSheet
    });

    /* ---------- Đặt lịch khách ---------- */

    const completionRepository = createCompletionRepository({ pool });
    const appointmentNotifier = createAppointmentNotifier({ bot, sendMessageToRoleGroup });

    const bookAppointment = createBookAppointmentService({
        repository: appointments, notifier: appointmentNotifier, getGroupRole
    });
    const manageService = createManageAppointmentService({
        repository: appointments, notifier: appointmentNotifier
    });
    const confirmService = createConfirmArrivalService({ repository: appointments });
    const reportService = createScheduleReportService({
        repository: appointments, notifier: appointmentNotifier
    });
    const remindDueAppointments = createRemindDueAppointments({
        repository: appointments, completionRepository, notifier: appointmentNotifier, getGroupRole
    });

    /* ---------- Lắp vào bot ---------- */
    // Báo bù đăng ký TRƯỚC: '/api/schedules/incomplete' phải đứng trước
    // '/api/schedules/:id' của phần đặt lịch, nếu không ':id' nuốt mất.

    registerMakeupRoutes({
        botApp, authenticateTelegramMiniApp, checkPayloadLimit, repository, makeupService
    });

    registerAppointmentRoutes({
        botApp, repository: appointments, bookAppointment, manageService
    });

    registerPhotoDebtRoutes({
        botApp, authenticateTelegramMiniApp, repository: proofRepository, submitProofPhoto,
        bot, sendPhotoToRoleGroup
    });

    // kpiComposer là tuỳ chọn: harness test đăng ký route không cần Telegraf.
    if (kpiComposer) {
        registerMakeupActions({ kpiComposer, reviewService });
        registerAppointmentActions({ kpiComposer, confirmService });
        registerPhotoReplyHandler({
            kpiComposer, repository: proofRepository, submitProofPhoto, moment, fs, adminIds
        });
    }

    // cron tuỳ chọn vì cùng lý do.
    const scheduledJobs = cron
        ? [
            ...registerScheduleCrons({ cron, reportService, remindDueAppointments }),
            registerRetryCron({
                cron, retryRepository, syncMakeupToGoogleSheet, sheetSync,
                sendPhotoToRoleGroup, escapeHtml, bot, fs, path, moment, uploadDir
            })
        ]
        : [];

    return Object.freeze({
        makeupService, reviewService,
        bookAppointment, manageService, confirmService, reportService,
        remindDueAppointments, scheduledJobs
    });
}

export {
    parseAppointmentReplyReference,
    normalizeAppointmentIdentityText
} from './domain/appointment-messages.js';
