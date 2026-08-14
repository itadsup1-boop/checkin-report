/**
 * Cổng duy nhất của domain "lịch khách".
 *
 * Bên ngoài CHỈ được import file này. Không ai được với tay vào domain/,
 * application/, infrastructure/ hay interfaces/ — giống cách domains/warehouse
 * đang làm.
 *
 * Phạm vi: toàn bộ lịch khách của role `report_tour` — đặt lịch, nhắc lịch, xác
 * nhận khách đến/hủy, tổng hợp công tour, và báo bù.
 *
 * Còn nợ (nằm trong vùng file kpi_features.js đang có người sửa dở): nợ ảnh
 * (`/api/photo-debts`, `/api/upload-proof`) và các hàm đồng bộ Google Sheet.
 * Xem mục "Còn nợ" trong README.md.
 */

import { createMakeupRepository } from './infrastructure/postgres/makeup-repository.js';
import { createAppointmentRepository } from './infrastructure/postgres/appointment-repository.js';
import { createProofImageStore } from './infrastructure/storage/proof-image-store.js';
import { createMakeupNotifier } from './interfaces/telegram/makeup-notification.js';
import { createAppointmentNotifier } from './infrastructure/telegram/appointment-notifier.js';
import { createMakeupRequestService } from './application/create-makeup-request.js';
import { createReviewMakeupService } from './application/review-makeup-request.js';
import { createBookAppointmentService } from './application/book-appointment.js';
import { createManageAppointmentService } from './application/manage-appointment.js';
import { createConfirmArrivalService } from './application/confirm-arrival.js';
import { createScheduleReportService } from './application/schedule-reports.js';
import { createRemindDueAppointments } from './application/remind-due-appointments.js';
import { registerMakeupRoutes } from './interfaces/miniapp-api/makeup-routes.js';
import { registerAppointmentRoutes } from './interfaces/miniapp-api/appointment-routes.js';
import { registerMakeupActions } from './interfaces/telegram/register-makeup-actions.js';
import { registerAppointmentActions } from './interfaces/telegram/register-appointment-actions.js';
import { registerScheduleCrons } from './interfaces/cron/register-schedule-crons.js';

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
    publicBaseUrl,
    cron,
    sendMessageToRoleGroup,
    getGroupRole
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

    /* ---------- Đặt lịch khách ---------- */

    const appointments = createAppointmentRepository({ pool });
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
        repository: appointments, notifier: appointmentNotifier, getGroupRole
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

    // kpiComposer là tuỳ chọn: harness test đăng ký route không cần Telegraf.
    if (kpiComposer) {
        registerMakeupActions({ kpiComposer, reviewService });
        registerAppointmentActions({ kpiComposer, confirmService });
    }

    // cron tuỳ chọn vì cùng lý do.
    const scheduledJobs = cron
        ? registerScheduleCrons({ cron, reportService, remindDueAppointments })
        : [];

    return Object.freeze({
        makeupService, reviewService,
        bookAppointment, manageService, confirmService, reportService,
        remindDueAppointments, scheduledJobs
    });
}
