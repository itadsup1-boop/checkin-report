import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../../packages/database/index.js';
import { syncAllTimekeepSheets } from '../bot/syncTimekeepSheets.js';
import { applyApprovedLeavePenalties } from '../../domains/timekeep/application/attendance-penalties.js';
import { rejectAutoAcceptedLeaveRequest } from '../../domains/timekeep/application/leave-request-service.js';
import { initLogger, writeLog, loggerMiddleware, setupLogRotation, overrideGlobals } from '../../packages/shared/logger.js';
import {
    KPI_GROUP_ROLES,
    pauseEmployeeMembershipsInAllGroups,
    registerEmployeeInKpiGroup
} from '../../packages/shared/kpiMembership.js';
import { registerWarehouseAdminRoutes } from '../../domains/warehouse/index.js';
import { registerTimekeepRegistrationReview } from '../../domains/timekeep/index.js';
import { registerStaffProfileModule } from '../../domains/staff-profile/index.js';
import { registerCompanyHolidayAdminModule } from '../../domains/company-holiday/index.js';
import { registerTelegramGroupAutomation } from '../../domains/telegram-group-automation/index.js';
import { createAdminAuth } from './admin-auth.js';
import { webAdminSecurityHeaders } from '../../packages/shared/web-admin-security-headers.js';
import { registerAdminAccountRoutes } from './routes/admin-account-routes.js';
import { registerStaffRoutes } from './routes/staff-routes.js';
import { registerAttendanceRoutes } from './routes/attendance-routes.js';
import { registerScheduleRoutes } from './routes/schedule-routes.js';
import { registerLeaveRoutes } from './routes/leave-routes.js';
import { registerEmployeeRoutes } from './routes/employee-routes.js';
import { registerGroupRoutes } from './routes/group-routes.js';
import { registerProxyRoutes } from './routes/proxy-routes.js';

const PAUSABLE_GROUP_ROLES = [...KPI_GROUP_ROLES, 'timekeep'];
const normalizeStaffRole = role => String(role || '').trim().toLocaleLowerCase('vi') === 'admin'
    ? 'admin'
    : String(role || '').trim();

dotenv.config();

const isDocker = fs.existsSync('/.dockerenv');
const BOT_HOST = isDocker ? 'bot' : 'localhost';
const BOT_PORT = isDocker ? 3002 : 3009;
const BOT_URL = `http://${BOT_HOST}:${BOT_PORT}`;

// Khởi tạo file log và bắt đầu cron job rotate
initLogger(process.env.APIS_LOG_FILE || './logs/timekeep_api_logs.log');
overrideGlobals();
setupLogRotation();

const app = express();
app.disable('etag');
app.use(loggerMiddleware);

app.get('/api/test-error', async (req, res) => {
    req.admin = { isSuperAdmin: true, allowedGroupIds: [] };
    try {
        const { isSuperAdmin, allowedGroupIds } = await getAdminAuthContext(req);
        res.json({ ok: true, isSuperAdmin, allowedGroupIds });
    } catch (e) {
        console.error("TEST ERROR:", e);
        res.status(500).json({ error: e.message });
    }
});

app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
app.use(webAdminSecurityHeaders);

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'API is running' });
});

const adminAuth = createAdminAuth({ pool });
const { getAdminAuthContext } = adminAuth;
adminAuth.registerLoginRoute(app);
app.use('/api/admin', adminAuth.authenticateAdmin);
app.use('/api/admin', adminAuth.restrictWarehouseAccountToWarehouse);
adminAuth.registerSessionRoutes(app);

// Các API cũ không có tiền tố /admin nhưng chỉ được Web Admin sử dụng.
app.use('/api/groups', adminAuth.authenticateAdmin, adminAuth.restrictWarehouseAccountGroupAccess);
app.use('/api/employees', adminAuth.authenticateAdmin, adminAuth.requireSuperAdmin);
app.use('/api/tk_group_settings', adminAuth.authenticateAdmin, adminAuth.requireGeneralAdmin);
app.use('/api/export', adminAuth.authenticateAdmin, adminAuth.requireGeneralAdmin);

// =====================================
// NEW WEB ADMIN API & AUTH
// =====================================

registerWarehouseAdminRoutes({ app, pool });
registerTimekeepRegistrationReview({
    app,
    pool,
    getAdminAuthContext: adminAuth.getAdminAuthContext,
    kpiGroupRoles: KPI_GROUP_ROLES,
    registerEmployeeInKpiGroup
});
registerStaffProfileModule({
    app,
    pool,
    getAdminAuthContext: adminAuth.getAdminAuthContext
});
registerCompanyHolidayAdminModule({
    app,
    pool,
    requireSuperAdmin: adminAuth.requireSuperAdmin
});
registerTelegramGroupAutomation({ app, pool, requireSuperAdmin: adminAuth.requireSuperAdmin });

// APIs Quản lý Tài khoản Admin (Dành cho Super Admin)
// Thêm các endpoint khác theo tài liệu THIET_KE_HE_THONG.md ở đây

registerAdminAccountRoutes({ app, pool, adminAuth });
registerStaffRoutes({
    app,
    pool,
    getAdminAuthContext,
    pausableGroupRoles: PAUSABLE_GROUP_ROLES,
    normalizeStaffRole,
    pauseEmployeeMembershipsInAllGroups,
    registerEmployeeInKpiGroup
});
registerAttendanceRoutes({ app, pool, getAdminAuthContext, syncAllTimekeepSheets });
registerScheduleRoutes({ app, pool, getAdminAuthContext });
registerLeaveRoutes({
    app,
    pool,
    getAdminAuthContext,
    syncAllTimekeepSheets,
    applyApprovedLeavePenalties,
    rejectAutoAcceptedLeaveRequest,
    writeLog
});
registerEmployeeRoutes({ app, pool });
registerGroupRoutes({ app, pool });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAdminPath = path.join(__dirname, '../web-admin/dist');
const botAppPath = path.join(__dirname, '../bot/public');

registerProxyRoutes({ app, express, isDocker, botUrl: BOT_URL, webAdminPath, botAppPath });

const PORT = process.env.API_PORT || 3000;
app.listen(PORT, () => {
    writeLog('info', `API & Web Server is running on port ${PORT}`);
});
