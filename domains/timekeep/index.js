/**
 * CỔNG DUY NHẤT của domain chấm công.
 *
 * Code ngoài domain chỉ được import file này. Đừng import thẳng vào
 * `application/`, `infrastructure/` hay `interfaces/` — đó là ruột, đổi lúc nào
 * cũng được miễn cổng này giữ nguyên.
 *
 * Phạm vi: đăng ký nhân sự · mở/đóng đăng ký lịch · cấu hình nhóm · bảng điều
 * khiển · quản trị ca trực · đồng bộ Sheet · cron xuất Sheet 23:00 · đăng ký
 * lịch tuần (Mini App + duyệt >= 2 ngày nghỉ) · xin nghỉ đột xuất/đi muộn ·
 * điểm danh video (Mini App + Telegram) · số liệu cá nhân · cron chấm công mỗi
 * phút (nhắc ca, phạt muộn, chốt vắng 14:00) · cron nhắc lịch Chủ Nhật · xuất
 * Excel điểm danh.
 */

import { createEmployeeRepository } from './infrastructure/postgres/employee-repository.js';
import { createScheduleRepository } from './infrastructure/postgres/schedule-repository.js';
import { createGroupSettingsRepository } from './infrastructure/postgres/group-settings-repository.js';
import { createAttendanceRepository } from './infrastructure/postgres/attendance-repository.js';
import { createAttendanceCronRepository } from './infrastructure/postgres/attendance-cron-repository.js';
import { createCheckinRepository } from './infrastructure/postgres/checkin-repository.js';
import { createSundayReminderRepository } from './infrastructure/postgres/sunday-reminder-repository.js';
import { createRegistrationReviewRepository } from './infrastructure/postgres/registration-review-repository.js';
import { createDailyExportSheet } from './infrastructure/google-sheet/daily-export-sheet.js';

import { createRegisterEmployeeService } from './application/register-employee.js';
import { createToggleScheduleRegistration } from './application/toggle-schedule-registration.js';
import { createSaveGroupSettings } from './application/save-group-settings.js';
import { createBuildAttendanceDashboard } from './application/build-attendance-dashboard.js';
import { createManageAdminSchedules } from './application/manage-admin-schedules.js';
import { createExportDailySheet } from './application/export-daily-sheet.js';
import { createGetScheduleView } from './application/get-schedule-view.js';
import { createSaveWeeklySchedule } from './application/save-weekly-schedule.js';
import { createSaveLeaveRequest } from './application/save-leave-request.js';
import { createReviewLeaveRequest } from './application/review-leave-request.js';
import { createSaveCheckin } from './application/save-checkin.js';
import { createGetPersonalStats } from './application/get-personal-stats.js';
import { createRunShiftReminders } from './application/run-shift-reminders.js';
import { createRunLatePenaltyCheck } from './application/run-late-penalty-check.js';
import { createSendSundayScheduleReminder } from './application/send-sunday-schedule-reminder.js';
import { createExportAttendanceExcel } from './application/export-attendance-excel.js';
import { createReviewRegistrationService } from './application/review-registration.js';
import {
    finalizeUnauthorizedAbsences, getPendingAbsenceNotifications, markAbsenceNotificationsSent,
    groupAbsenceNotifications, buildAbsenceNotificationText
} from './application/attendance-penalties.js';

import { registerTimekeepRegistrationRoutes } from './interfaces/miniapp-api/registration-routes.js';
import { registerTimekeepSettingsRoutes } from './interfaces/admin-api/settings-routes.js';
import { registerTimekeepDashboardRoutes } from './interfaces/admin-api/dashboard-routes.js';
import { registerTimekeepScheduleRoutes } from './interfaces/admin-api/schedule-routes.js';
import { registerExportExcelRoutes } from './interfaces/admin-api/export-excel-routes.js';
import { registerRegistrationReviewRoutes } from './interfaces/admin-api/registration-review-routes.js';
import { registerScheduleMiniAppRoutes } from './interfaces/miniapp-api/schedule-mini-app-routes.js';
import { registerLeaveRequestRoutes } from './interfaces/miniapp-api/leave-request-routes.js';
import { registerCheckinRoutes } from './interfaces/miniapp-api/checkin-routes.js';
import { registerPersonalStatsRoutes } from './interfaces/miniapp-api/personal-stats-routes.js';
import { registerLeaveApprovalActions } from './interfaces/telegram/register-leave-approval-actions.js';
import { registerVideoCheckinHandler } from './interfaces/telegram/register-video-checkin-handler.js';
import { registerLateReportHandler } from './interfaces/telegram/register-late-report-handler.js';
import { registerTimekeepCrons } from './interfaces/cron/register-export-cron.js';
import { registerAttendanceCron } from './interfaces/cron/register-attendance-cron.js';
import { registerSundayReminderCrons } from './interfaces/cron/register-sunday-reminder-crons.js';

export function registerTimekeepModule({
    botApp,
    bot,
    pool,
    cron,
    kpiGroupRoles,
    registerEmployeeInKpiGroup,
    syncAllTimekeepSheets,
    adminIds,
    spreadsheetId,
    findEmployeeForTimekeepContext,
    requireGroupRole,
    sendMessageToRoleGroup,
    sendVideoToRoleGroup,
    multer,
    fs,
    path,
    exec,
    moment,
    crypto,
    ExcelJS,
    checkinUploadDir,
    extraUnannouncedLatePenaltyEnabled = false,
    cors,
    corsOptions
}) {
    const employees = createEmployeeRepository({ pool });
    const schedules = createScheduleRepository({ pool });
    const groupSettings = createGroupSettingsRepository({ pool });
    const attendance = createAttendanceRepository({ pool });
    const attendanceCron = createAttendanceCronRepository({ pool });
    const checkins = createCheckinRepository({ pool });
    const sundayReminders = createSundayReminderRepository({ pool });
    const exportSheet = createDailyExportSheet({ spreadsheetId });

    // Đọc ADMIN_IDS mỗi lần gọi, không chụp lại một lần: chủ hệ thống sửa .env là
    // có hiệu lực ngay, không phải khởi động lại bot. Giữ đúng thói quen cũ.
    const isSystemAdmin = telegramId =>
        Boolean(adminIds()) && adminIds().split(',').includes(String(telegramId));

    // Bó sẵn `pool` — các application/ service ở dưới gọi hàm này chỉ với
    // (telegramId, chatId), không phải tự truyền pool mỗi lần.
    const findEmployeeContext = (telegramId, chatId) => findEmployeeForTimekeepContext(pool, telegramId, chatId);

    const registerEmployee = createRegisterEmployeeService({
        pool, repository: employees, kpiGroupRoles, registerInKpiGroup: registerEmployeeInKpiGroup
    });
    const toggleScheduleRegistration = createToggleScheduleRegistration({
        repository: schedules, isSystemAdmin
    });
    const saveGroupSettings = createSaveGroupSettings({ repository: groupSettings });
    const buildAttendanceDashboard = createBuildAttendanceDashboard({ repository: attendance });
    const manageSchedules = createManageAdminSchedules({
        repository: schedules, syncSheets: syncAllTimekeepSheets
    });
    const exportDailySheet = createExportDailySheet({
        repository: attendance, sheetWriter: exportSheet
    });

    const { getScheduleView } = createGetScheduleView({
        repository: schedules, findEmployeeContext, isSystemAdmin, moment
    });
    const { saveWeeklySchedule } = createSaveWeeklySchedule({
        repository: schedules, findEmployeeContext, isSystemAdmin,
        syncSheets: syncAllTimekeepSheets, fs, path, moment,
        uploadDir: path.join(path.dirname(checkinUploadDir), 'proofs'),
        bot, publicBaseUrl: process.env.MINI_APP_URL || 'https://bot.adsup.vn'
    });
    const { saveLeaveRequest } = createSaveLeaveRequest({
        pool, repository: schedules, findEmployeeContext, isSystemAdmin,
        syncSheets: syncAllTimekeepSheets, fs, path, moment,
        uploadDir: path.join(path.dirname(checkinUploadDir), 'proofs'),
        bot, sendMessageToRoleGroup,
        publicBaseUrl: process.env.MINI_APP_URL || 'https://YOUR_TUNNEL.trycloudflare.com'
    });
    const { reviewLeaveRequest, excusePenalty } = createReviewLeaveRequest({
        pool, isSystemAdmin, isManager: schedules.isManager, moment, syncSheets: syncAllTimekeepSheets
    });
    const { saveCheckin } = createSaveCheckin({
        checkinRepository: checkins, scheduleRepository: schedules, findEmployeeContext, isSystemAdmin,
        moment, fs, path, exec, bot, sendVideoToRoleGroup, uploadDir: checkinUploadDir, syncSheets: syncAllTimekeepSheets
    });
    const { getPersonalStats } = createGetPersonalStats({
        attendanceRepository: attendance, scheduleRepository: schedules, findEmployeeContext, isSystemAdmin, moment
    });
    const { runShiftReminders } = createRunShiftReminders({ repository: attendanceCron, sendMessageToRoleGroup, bot, moment });
    const { runLatePenaltyCheck } = createRunLatePenaltyCheck({
        repository: attendanceCron, sendMessageToRoleGroup, bot, moment, extraUnannouncedLatePenaltyEnabled
    });
    const { sendSundayScheduleReminder } = createSendSundayScheduleReminder({ repository: sundayReminders, bot, moment, crypto });
    const { exportAttendanceExcel } = createExportAttendanceExcel({ repository: attendance, ExcelJS, moment });

    registerTimekeepRegistrationRoutes({ botApp, registerEmployee, toggleScheduleRegistration });
    registerTimekeepSettingsRoutes({ botApp, saveGroupSettings });
    registerTimekeepDashboardRoutes({ botApp, buildAttendanceDashboard });
    registerTimekeepScheduleRoutes({ botApp, manageSchedules, syncSheets: syncAllTimekeepSheets });
    registerExportExcelRoutes({ botApp, exportAttendanceExcel, cors, corsOptions });

    // Báo bù/lịch tuần đăng ký TRƯỚC các route '/api/timekeep/schedule/:id'-kiểu
    // wildcard nếu có; hiện các route Mini App ở đây đều có đường dẫn cụ thể, không
    // có ký tự đại diện, nên thứ tự không ảnh hưởng lẫn nhau.
    registerScheduleMiniAppRoutes({ botApp, getScheduleView, saveWeeklySchedule });
    registerLeaveRequestRoutes({ botApp, saveLeaveRequest });
    registerCheckinRoutes({ botApp, multer, fs, path, uploadDir: checkinUploadDir, saveCheckin });
    registerPersonalStatsRoutes({ botApp, getPersonalStats });

    // bot tuỳ chọn: harness test đăng ký route không cần Telegraf.
    if (bot) {
        registerLeaveApprovalActions({ bot, requireGroupRole, reviewLeaveRequest, excusePenalty });
        registerVideoCheckinHandler({
            bot, checkinRepository: checkins, findEmployeeContext, syncSheets: syncAllTimekeepSheets, moment
        });
        registerLateReportHandler({ bot, findEmployeeContext, saveLeaveRequest, moment });
    }

    // cron tuỳ chọn: harness test đăng ký route không cần lịch chạy nền.
    const scheduledJobs = cron
        ? [
            ...registerTimekeepCrons({ cron, exportDailySheet }),
            registerAttendanceCron({
                cron, runShiftReminders, runLatePenaltyCheck,
                finalizeUnauthorizedAbsences, getPendingAbsenceNotifications, markAbsenceNotificationsSent,
                groupAbsenceNotifications, buildAbsenceNotificationText,
                pool, sendMessageToRoleGroup, bot, syncSheets: syncAllTimekeepSheets, moment
            }),
            ...registerSundayReminderCrons({ cron, sendSundayScheduleReminder })
        ]
        : [];

    return Object.freeze({
        registerEmployee, toggleScheduleRegistration, saveGroupSettings,
        buildAttendanceDashboard, manageSchedules, exportDailySheet,
        getScheduleView, saveWeeklySchedule, saveLeaveRequest, reviewLeaveRequest, excusePenalty,
        saveCheckin, getPersonalStats, exportAttendanceExcel, sendSundayScheduleReminder,
        scheduledJobs
    });
}

/** Lắp riêng API duyệt đăng ký vào tiến trình Web Admin. */
export function registerTimekeepRegistrationReview({
    app,
    pool,
    getAdminAuthContext,
    kpiGroupRoles,
    registerEmployeeInKpiGroup
}) {
    const repository = createRegistrationReviewRepository({ pool });
    const reviewRegistrations = createReviewRegistrationService({
        pool,
        repository,
        kpiGroupRoles,
        registerInKpiGroup: registerEmployeeInKpiGroup
    });
    registerRegistrationReviewRoutes({ app, reviewRegistrations, getAdminAuthContext });
    return Object.freeze({ reviewRegistrations });
}
