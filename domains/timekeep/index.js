/**
 * CỔNG DUY NHẤT của domain chấm công.
 *
 * Code ngoài domain chỉ được import file này. Đừng import thẳng vào
 * `application/`, `infrastructure/` hay `interfaces/` — đó là ruột, đổi lúc nào
 * cũng được miễn cổng này giữ nguyên.
 *
 * ⚠️ PHẠM VI HIỆN TẠI CHƯA TRỌN VẸN. Đợt tách này chỉ lấy 7 chức năng khép kín:
 * đăng ký nhân sự · mở/đóng đăng ký lịch · cấu hình nhóm · bảng điều khiển ·
 * quản trị ca trực · đồng bộ Sheet · cron xuất Sheet 23:00.
 *
 * Phần lõi (check-in, xin nghỉ, lưu lịch tuần, nhắc lịch Chủ Nhật, tính phạt)
 * VẪN nằm trong apps/bot/timekeep_bot.js — xem mục "Còn nợ" trong README.md.
 *
 * @param {object} deps
 * @returns {object} các use case đã lắp, dùng cho test
 */

import { createEmployeeRepository } from './infrastructure/postgres/employee-repository.js';
import { createScheduleRepository } from './infrastructure/postgres/schedule-repository.js';
import { createGroupSettingsRepository } from './infrastructure/postgres/group-settings-repository.js';
import { createAttendanceRepository } from './infrastructure/postgres/attendance-repository.js';
import { createDailyExportSheet } from './infrastructure/google-sheet/daily-export-sheet.js';
import { createRegisterEmployeeService } from './application/register-employee.js';
import { createToggleScheduleRegistration } from './application/toggle-schedule-registration.js';
import { createSaveGroupSettings } from './application/save-group-settings.js';
import { createBuildAttendanceDashboard } from './application/build-attendance-dashboard.js';
import { createManageAdminSchedules } from './application/manage-admin-schedules.js';
import { createExportDailySheet } from './application/export-daily-sheet.js';
import { registerTimekeepRegistrationRoutes } from './interfaces/miniapp-api/registration-routes.js';
import { registerTimekeepSettingsRoutes } from './interfaces/admin-api/settings-routes.js';
import { registerTimekeepDashboardRoutes } from './interfaces/admin-api/dashboard-routes.js';
import { registerTimekeepScheduleRoutes } from './interfaces/admin-api/schedule-routes.js';
import { registerTimekeepCrons } from './interfaces/cron/register-export-cron.js';

export function registerTimekeepModule({
    botApp,
    pool,
    cron,
    kpiGroupRoles,
    registerEmployeeInKpiGroup,
    syncAllTimekeepSheets,
    adminIds,
    spreadsheetId
}) {
    const employees = createEmployeeRepository({ pool });
    const schedules = createScheduleRepository({ pool });
    const groupSettings = createGroupSettingsRepository({ pool });
    const attendance = createAttendanceRepository({ pool });
    const exportSheet = createDailyExportSheet({ spreadsheetId });

    // Đọc ADMIN_IDS mỗi lần gọi, không chụp lại một lần: chủ hệ thống sửa .env là
    // có hiệu lực ngay, không phải khởi động lại bot. Giữ đúng thói quen cũ.
    const isSystemAdmin = telegramId =>
        Boolean(adminIds()) && adminIds().split(',').includes(String(telegramId));

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

    registerTimekeepRegistrationRoutes({ botApp, registerEmployee, toggleScheduleRegistration });
    registerTimekeepSettingsRoutes({ botApp, saveGroupSettings });
    registerTimekeepDashboardRoutes({ botApp, buildAttendanceDashboard });
    registerTimekeepScheduleRoutes({ botApp, manageSchedules, syncSheets: syncAllTimekeepSheets });

    // cron tuỳ chọn: harness test đăng ký route không cần lịch chạy nền.
    const scheduledJobs = cron ? registerTimekeepCrons({ cron, exportDailySheet }) : [];

    return Object.freeze({
        registerEmployee, toggleScheduleRegistration, saveGroupSettings,
        buildAttendanceDashboard, manageSchedules, exportDailySheet, scheduledJobs
    });
}
