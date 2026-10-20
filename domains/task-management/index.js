/**
 * CỔNG VÀO CÔNG KHAI DUY NHẤT CỦA DOMAIN TASK-MANAGEMENT (quản lý & giao việc + form báo cáo)
 *
 * Mặc định TẮT. Bật bằng TASK_MANAGEMENT_ENABLED=true trong .env.
 * Lý do: module mới không được phép làm hỏng luồng check-in/báo cáo hiện có
 * (docs/ke-hoach-he-thong-giao-viec-ai.md mục 24.1 — feature flag cho từng module).
 */

import { createTaskAccessRepository } from './infrastructure/postgres/access-repository.js';
import { createTaskAccessService } from './application/access-service.js';
import { registerTaskAccessHandlers } from './interfaces/telegram/register-access-handlers.js';
import { createTaskRepository } from './infrastructure/postgres/task-repository.js';
import { createTaskService } from './application/task-service.js';
import { registerTaskHandlers } from './interfaces/telegram/register-task-handlers.js';
import { registerNlpHandlers } from './interfaces/telegram/register-nlp-handlers.js';
import { createFormRepository } from './infrastructure/postgres/form-repository.js';
import { createFormService } from './application/form-service.js';
import { registerFormHandlers } from './interfaces/telegram/register-form-handlers.js';
import { createExcelRepository } from './infrastructure/postgres/excel-repository.js';
import { createExcelService } from './application/excel-service.js';
import { registerExcelHandlers } from './interfaces/telegram/register-excel-handlers.js';
import { createMessagingRepository } from './infrastructure/postgres/messaging-repository.js';
import { createMessagingService } from './application/messaging-service.js';
import { registerMessagingHandlers } from './interfaces/telegram/register-messaging-handlers.js';
import { createRuleConfigRepository } from './infrastructure/postgres/rule-config-repository.js';
import { createRuleConfigService } from './application/rule-config-service.js';
import { registerRuleConfigHandlers } from './interfaces/telegram/register-rule-config-handlers.js';
import { registerTaskCrons } from './interfaces/cron/register-task-crons.js';
import { registerTaskManagementAdminModule } from './interfaces/admin-routes.js';
import { createConversationRegistry } from './interfaces/conversation-registry.js';
import { createAttendanceReportRepository } from './infrastructure/postgres/attendance-report-repository.js';
import { createAttendanceReportService } from './application/attendance-report-service.js';
import { registerTaskExtendRoutes } from './interfaces/miniapp-api/task-extend-routes.js';

export function registerTaskManagementModule({
    botApp = null, authenticateTelegramMiniApp = null,
    bot, pool, cron = null, env = process.env, accessService = null, loadAdminIds
}) {
    if ((env.TASK_MANAGEMENT_ENABLED || 'false').trim().toLowerCase() !== 'true') {
        console.log('[TaskManagement] TASK_MANAGEMENT_ENABLED khác "true" — module quản lý/giao việc KHÔNG khởi động.');
        return null;
    }

    if (!accessService) {
        const accessRepository = createTaskAccessRepository({ pool });
        accessService = createTaskAccessService({ accessRepository });
    }
    registerTaskAccessHandlers({ bot, accessService, loadAdminIds });

    const taskRepository = createTaskRepository({ pool });
    const conversationRegistry = createConversationRegistry();
    const ruleConfigRepository = createRuleConfigRepository({ pool });
    const ruleConfigService = createRuleConfigService({ ruleConfigRepository });
    const taskExtendUrl = displayCode => {
        const botUsername = bot.botInfo?.username || env.BOT_USERNAME || 'baocao_kpi_adsup_bot';
        const appShortName = env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
        return `https://t.me/${botUsername}/${appShortName}?startapp=taskextend_${displayCode}`;
    };
    const taskService = createTaskService({ taskRepository, ruleConfigService, taskExtendUrl });
    const formRepository = createFormRepository({ pool });
    const formService = createFormService({ formRepository, taskRepository, ruleConfigService });

    // P4 Excel: flag riêng lớp 2 — tắt thì domain vẫn chạy nhiệm vụ + form.
    let excelService = null;
    if ((env.EXCEL_SYNC_ENABLED || 'false').trim().toLowerCase() === 'true') {
        const excelRepository = createExcelRepository({ pool });
        excelService = createExcelService({ excelRepository, taskRepository, taskService, formRepository });
        console.log('[TaskManagement] Excel sync đã bật (/xuatexcel + import file).');
    }

    const messagingRepository = createMessagingRepository({ pool });
    const messagingService = createMessagingService({ taskRepository, messagingRepository });
    const attendanceReportRepository = createAttendanceReportRepository({ pool });
    const attendanceReportService = createAttendanceReportService({
        reportRepository: attendanceReportRepository, accessService, taskRepository
    });

    if (botApp && authenticateTelegramMiniApp) {
        registerTaskExtendRoutes({ botApp, authenticateTelegramMiniApp, taskService });
    }

    registerNlpHandlers({
        bot, taskService, taskRepository, accessService, messagingService,
        excelService, ruleConfigService, formService, conversationRegistry, attendanceReportService
    });
    registerTaskHandlers({ bot, taskService, taskRepository, conversationRegistry });
    registerFormHandlers({ bot, formService, taskRepository, conversationRegistry });
    if (excelService) registerExcelHandlers({ bot, excelService, accessService, conversationRegistry });
    registerMessagingHandlers({ bot, messagingService, accessService, conversationRegistry });
    registerRuleConfigHandlers({ bot, ruleConfigService, accessService });

    const crons = registerTaskCrons({
        cron, bot, taskService, taskRepository, formService, directMessageRepository: messagingRepository,
        attendanceReportService
    });

    console.log('[TaskManagement] Đã khởi tạo P1..P5b: RBAC (/capma, /kichhoat, /thuhoi, /quyen) + giao việc (/giao, /congviec, /huytask) + form báo cáo (/taoform, /giaoform, /tonghop, /huyform, /dsform) + Excel (/xuatexcel) + gửi tin (/guitin, /guitinall) + rule (/cauhinh, /tamdung, /chohay) + worker + cron nhắc.');
    return { accessService, taskService, formService, taskRepository, formRepository, excelService, messagingService, ruleConfigService, attendanceReportService, crons };
}

// API web-admin: quản lý mã kích hoạt + tài khoản quản lý (apps/api gọi khi TASK_MANAGEMENT_ENABLED=true)
export function registerTaskManagementWebAdminModule({ app, pool, requireSuperAdmin, env = process.env }) {
    if ((env.TASK_MANAGEMENT_ENABLED || 'false').trim().toLowerCase() !== 'true') {
        console.log('[TaskManagement] TASK_MANAGEMENT_ENABLED khác "true" — API web-admin quản lý mã KHÔNG khởi động.');
        return null;
    }
    return registerTaskManagementAdminModule({ app, pool, requireSuperAdmin });
}
