import { Telegraf, session, Scenes } from 'telegraf';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import moment from 'moment';
import fs from 'fs';
import { exec } from 'child_process';
import pool from '../../packages/database/index.js';
import cron from 'node-cron';
import { google } from 'googleapis';
import ExcelJS from 'exceljs';
import { initLogger, loggerMiddleware, setupLogRotation, overrideGlobals } from '../../packages/shared/logger.js';
import { reportWizard } from './reportWizard.js';
import { setupWizard } from './setupWizard.js';
import { requireGroupRole, sendMessageToRoleGroup, sendMediaGroupToRoleGroup, sendVideoToRoleGroup } from './role_guard.js';
import { TIMEKEEP_BOT_HELP_HTML } from './user_guide_timekeep.js';
import { syncAllTimekeepSheets } from './syncTimekeepSheets.js';
import { getOrCreateCustomerFolder, uploadToDrive, createWarehouseFolder } from './googleDrive.js';
import { getCustomerDocForGroup, getDocById } from './sheetManager.js';
import multer from 'multer';
import { KPI_GROUP_ROLES, registerEmployeeInKpiGroup } from '../../packages/shared/kpiMembership.js';
import { registerTimekeepModule } from '../../domains/timekeep/index.js';
import { registerCompanyHolidayBotModule } from '../../domains/company-holiday/index.js';
import { findEmployeeForTimekeepContext } from './timekeep-employee-context.js';
import { registerGroupSyncMiddleware } from './middleware/register-group-sync.js';
import { createTelegramMiniAppAuth } from './middleware/telegram-miniapp-auth.js';
import { configureBotHttp } from './bootstrap/configure-bot-http.js';
import { registerStartCommands } from './commands/register-start-commands.js';
import { startBotRuntime } from './bootstrap/start-bot-runtime.js';
import { registerBusinessModules } from './bootstrap/register-business-modules.js';

// Tạm tắt phụ phí 100.000đ khi đi muộn mà không có đơn báo trước.
// Giữ thành cờ riêng để có thể bật lại mà không ảnh hưởng mức phạt đi muộn gốc.
const EXTRA_UNANNOUNCED_LATE_PENALTY_ENABLED = false;

// Load environment variables
dotenv.config({ override: true });

initLogger(process.env.BOTS_LOG_FILE || './logs/timekeep_bot_logs.log');
overrideGlobals();
setupLogRotation();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const customerMediaStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public/uploads/temp');
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `customer_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
    }
});

const uploadCustomerMedia = multer({
    storage: customerMediaStorage,
    limits: { fileSize: 200 * 1024 * 1024 }
});

// Initialize Telegraf Bot
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
    console.error("LỖI: TELEGRAM_BOT_TOKEN không được định nghĩa trong file .env!");
    process.exit(1);
}

const bot = new Telegraf(botToken);
const stage = new Scenes.Stage([reportWizard, setupWizard]);
bot.use(session());
bot.use(stage.middleware());
registerGroupSyncMiddleware({ bot, pool });

// // Tự động đồng bộ nhóm khi Bot được thêm mới vào nhóm hoặc thay đổi trạng thái (my_chat_member)
// bot.on('my_chat_member', async (ctx) => {
//     try {
//         const chat = ctx.myChatMember?.chat;
//         const newStatus = ctx.myChatMember?.new_chat_member?.status;
//         if (chat && ['group', 'supergroup'].includes(chat.type)) {
//             const groupId = chat.id.toString();
//             const groupName = chat.title || `Group ${groupId}`;
//             if (['member', 'administrator'].includes(newStatus)) {
//                 await pool.query(
//                     `INSERT INTO telegram_groups (telegram_group_id, group_name, is_active, is_deleted)
//                      VALUES ($1, $2, true, false)
//                      ON CONFLICT (telegram_group_id) DO UPDATE SET group_name = $2, is_active = true, is_deleted = false`,
//                     [groupId, groupName]
//                 );
//                 await pool.query(
//                     `INSERT INTO group_settings (telegram_group_id) VALUES ($1) ON CONFLICT (telegram_group_id) DO NOTHING`,
//                     [groupId]
//                 );
//                 console.log(`[MyChatMember Sync] ✅ Đã lưu/cập nhật nhóm từ Telegram: ${groupName} (${groupId})`);
//             } else if (['left', 'kicked'].includes(newStatus)) {
//                 await pool.query(`UPDATE telegram_groups SET is_active = false WHERE telegram_group_id = $1`, [groupId]);
//                 console.log(`[MyChatMember Sync] 🔴 Bot đã rời/bị xóa khỏi nhóm: ${groupName} (${groupId})`);
//             }
//         }
//     } catch (err) {
//         console.error('[MyChatMember Sync Error]', err.message);
//     }
// });
const botApp = express();
botApp.disable('etag');
const { authenticateTelegramMiniApp } = createTelegramMiniAppAuth({ bot, pool });

// ==========================================
// BẢO MẬT: XÁC THỰC TELEGRAM INIT DATA & PAYLOAD
// ==========================================

const { corsOptions } = configureBotHttp({
    botApp,
    pool,
    cors,
    baseDir: __dirname,
    authenticateTelegramMiniApp
});

// ==========================================
// 1. API ĐĂNG KÝ THÔNG TIN NHÂN SỰ
// ==========================================
const companyHolidayModule = registerCompanyHolidayBotModule({ pool, cron, bot, moment });

// ---------------------------------------------------------------------
// Module chấm công — xem domains/timekeep/README.md. Toàn bộ chức năng đã
// chuyển vào domain; file này chỉ còn lắp ghép (Express/Telegraf bootstrap,
// static serving, và các module domain khác).
// ---------------------------------------------------------------------
registerTimekeepModule({
    botApp,
    bot,
    pool,
    cron,
    kpiGroupRoles: KPI_GROUP_ROLES,
    registerEmployeeInKpiGroup,
    syncAllTimekeepSheets,
    // Hàm chứ không phải chuỗi: ADMIN_IDS đọc lại từ .env mỗi lần dùng.
    adminIds: () => process.env.ADMIN_IDS,
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
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
    checkinUploadDir: path.join(__dirname, 'public/uploads/checkins'),
    extraUnannouncedLatePenaltyEnabled: EXTRA_UNANNOUNCED_LATE_PENALTY_ENABLED,
    cors,
    corsOptions,
    isCompanyHoliday: companyHolidayModule.isCompanyHoliday
});

botApp.get('/api/test', async (req, res) => {
    console.log("request test api xin nghi ne")
    res.json({ success: true, message: 'Lưu lịch tuần thành công!' });
});

// API endpoint to update group_settings (used by Admin UI)


// ==========================================
// CUSTOMER RECORD (LƯU THÔNG TIN KHÁCH HÀNG) FEATURES
// ==========================================

registerStartCommands({ bot, pool, requireGroupRole, timekeepHelpHtml: TIMEKEEP_BOT_HELP_HTML });

// Giữ nguyên thứ tự handler cũ: KPI đăng ký trước Customer/Warehouse.
startBotRuntime({ bot, botApp, pool, isCompanyHoliday: companyHolidayModule.isCompanyHoliday });

registerBusinessModules({
    botApp, bot, pool, cron, moment, fs, baseDir: __dirname, authenticateTelegramMiniApp,
    uploadCustomerMedia, getOrCreateCustomerFolder, uploadToDrive, getCustomerDocForGroup,
    createWarehouseFolder, getDocById, sendMessageToRoleGroup, sendMediaGroupToRoleGroup
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
