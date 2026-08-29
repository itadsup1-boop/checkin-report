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
import { setupKpiBot } from './kpi_features.js';
import { reportWizard } from './reportWizard.js';
import { setupWizard } from './setupWizard.js';
import { requireGroupRole, sendMessageToRoleGroup, sendMediaGroupToRoleGroup, sendVideoToRoleGroup } from './role_guard.js';
import { TIMEKEEP_BOT_HELP_HTML } from './user_guide_timekeep.js';
import { syncAllTimekeepSheets } from './syncTimekeepSheets.js';
import { getOrCreateCustomerFolder, uploadToDrive, createWarehouseFolder } from './googleDrive.js';
import { getCustomerDocForGroup, getDocById } from './sheetManager.js';
import multer from 'multer';
import { KPI_GROUP_ROLES, registerEmployeeInKpiGroup } from '../../packages/shared/kpiMembership.js';
import { registerWarehouseModule } from '../../domains/warehouse/index.js';
import { registerCustomerModule } from '../../domains/customer/index.js';
import { registerTimekeepModule } from '../../domains/timekeep/index.js';
import { findEmployeeForTimekeepContext } from './timekeep-employee-context.js';
import { createAdminAuth } from '../api/admin-auth.js';
import { webAdminSecurityHeaders } from '../../packages/shared/web-admin-security-headers.js';

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

// Tự động kiểm tra và lưu nhóm vào DB mỗi khi có tương tác từ nhóm
bot.use(async (ctx, next) => {
    if (ctx.chat && ['group', 'supergroup'].includes(ctx.chat.type)) {
        const groupId = ctx.chat.id.toString();
        const groupName = ctx.chat.title || `Group ${groupId}`;
        pool.query(
            `INSERT INTO telegram_groups (telegram_group_id, group_name, is_active, is_deleted)
             VALUES ($1, $2, true, false)
             ON CONFLICT (telegram_group_id) DO UPDATE SET group_name = EXCLUDED.group_name, is_active = true, is_deleted = false`,
            [groupId, groupName]
        ).then(() => {
            return pool.query(
                `INSERT INTO group_settings (telegram_group_id) VALUES ($1) ON CONFLICT (telegram_group_id) DO NOTHING`,
                [groupId]
            );
        }).catch(err => {
            console.error('[Auto Sync Group Middleware Error]', err.message);
        });
    }
    return next();
});

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

// ==========================================
// BẢO MẬT: XÁC THỰC TELEGRAM INIT DATA & PAYLOAD
// ==========================================

// Verify Telegram WebApp initData HMAC signature
function verifyTelegramWebAppData(initDataRaw, maxAgeSeconds = 86400) {
    if (!initDataRaw) return null;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return null;

    try {
        const urlParams = new URLSearchParams(initDataRaw);
        const hash = urlParams.get('hash');
        if (!hash) return null;

        // Check auth_date to prevent replay attacks
        const authDateStr = urlParams.get('auth_date');
        if (!authDateStr) {
            console.warn('[Security] initData missing auth_date!');
            return null;
        }

        const authDate = parseInt(authDateStr, 10);
        const now = Math.floor(Date.now() / 1000);
        if (isNaN(authDate) || (now - authDate) > maxAgeSeconds || (authDate - now) > 300) {
            console.warn('[Security] initData auth_date expired or invalid!', { authDate, now, age: now - authDate });
            return null;
        }

        urlParams.delete('hash');

        const keys = Array.from(urlParams.keys()).sort();
        const dataCheckArr = keys.map(key => `${key}=${urlParams.get(key)}`);
        const dataCheckString = dataCheckArr.join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHash !== hash) {
            console.warn('[Security] initData hash mismatch!');
            return null;
        }

        const userJson = urlParams.get('user');
        if (!userJson) return null;

        return JSON.parse(userJson);
    } catch (err) {
        console.error('[Security] Error validating initData:', err);
        return null;
    }
}

// Create signed payload for startapp links
function createSignedPayload(action, groupId) {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const ts = Date.now();
    const dataString = `${action}:${groupId}:${ts}`;
    const sig = crypto.createHmac('sha256', token).update(dataString).digest('hex');
    return `${action}_${groupId}_${ts}_${sig}`;
}

// Verify signed payload
function verifySignedPayload(action, groupId, ts, sig) {
    if (!groupId || !ts || !sig) return false;
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const now = Date.now();
    const age = now - parseInt(ts, 10);
    if (isNaN(age) || age < -300000) { // Removed 24h expiration (age > 86400000)
        return false;
    }

    if (!action) return false;
    const dataString = `${action}:${groupId}:${ts}`;
    const expectedSig = crypto.createHmac('sha256', token).update(dataString).digest('hex');
    if (sig.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return true;

    return false;
}

// Middleware xác thực bảo mật cho Mini App API
async function authenticateTelegramMiniApp(req, res, next) {
    try {
        const initData = req.headers['x-telegram-init-data'] ||
            (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null) ||
            req.body?.initData || req.query?.initData;

        if (!initData) {
            return res.status(401).json({ success: false, message: 'Vui lòng thao tác trực tiếp trên ứng dụng Telegram (Thiếu initData).' });
        }

        const telegramUser = verifyTelegramWebAppData(initData);
        if (!telegramUser || !telegramUser.id) {
            return res.status(401).json({ success: false, message: 'Xác thực Telegram không hợp lệ hoặc đã hết hạn.' });
        }

        const verifiedId = telegramUser.id.toString();
        req.telegramUser = telegramUser;
        req.verifiedTelegramId = verifiedId;

        // Force set verified ID on req.body and req.query unconditionally to prevent spoofing
        if (!req.body) req.body = {};
        req.body.telegram_id = verifiedId;
        if (!req.query) req.query = {};
        req.query.telegram_id = verifiedId;

        const groupId = req.query.chat_id || req.body.chat_id || req.body.telegram_group_id;
        const ts = req.query.ts || req.body.ts;
        const sig = req.query.sig || req.body.sig;
        const action = req.query.action || req.body.action;

        if (groupId) {
            // Verify signed payload unconditionally for group-bound actions
            if (!ts || !sig) {
                return res.status(403).json({ success: false, message: 'Thiếu chữ ký thao tác (Signed Payload).' });
            }
            const isValidPayload = verifySignedPayload(action, groupId.toString(), ts, sig);
            if (!isValidPayload) {
                return res.status(403).json({ success: false, message: 'Chữ ký thao tác (Signed Payload) không hợp lệ hoặc đã hết hạn.' });
            }

            const groupCheck = await pool.query('SELECT * FROM telegram_groups WHERE telegram_group_id = $1', [groupId.toString()]);
            if (groupCheck.rows.length === 0) {
                return res.status(403).json({ success: false, message: 'Nhóm Telegram này chưa được đăng ký vào hệ thống.' });
            }

            // Chạy kiểm tra thành viên với timeout 2.5s và cơ chế fail-open khi lỗi mạng
            try {
                const runWithTimeout = (promise, ms) => {
                    const timeout = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('TIMEOUT')), ms)
                    );
                    return Promise.race([promise, timeout]);
                };

                const checkMembership = async () => {
                    const botMe = await bot.telegram.getMe();
                    const botMember = await bot.telegram.getChatMember(groupId.toString(), botMe.id);
                    if (!['member', 'administrator', 'creator'].includes(botMember.status)) {
                        throw new Error('BOT_LEFT_GROUP');
                    }

                    const userMember = await bot.telegram.getChatMember(groupId.toString(), parseInt(verifiedId, 10));
                    if (['left', 'kicked'].includes(userMember.status)) {
                        throw new Error('USER_NOT_MEMBER');
                    }
                };

                await runWithTimeout(checkMembership(), 2500);
            } catch (err) {
                console.warn('[Security] Membership verification skipped/failed:', err.message);
                
                if (err.message === 'BOT_LEFT_GROUP') {
                    return res.status(403).json({ success: false, message: 'Bot đã không còn nằm trong nhóm này.' });
                }
                if (err.message === 'USER_NOT_MEMBER') {
                    return res.status(403).json({ success: false, message: 'Bạn không phải là thành viên nhóm này.' });
                }
                
                // Nếu là lỗi TIMEOUT hoặc lỗi kết nối mạng Telegram, ta cho phép bỏ qua (vì đã xác thực chữ ký Signed Payload ở trên)
                // Telegram giới hạn tần suất gọi getChatMember — khi nhiều Mini App gọi
                // dồn dập (vd gõ tìm kiếm liên tục), Telegram trả 429 "Too Many Requests".
                // Đây KHÔNG phải lỗi bảo mật, chỉ là Telegram đang bận — coi như lỗi mạng,
                // bỏ qua kiểm tra thành viên vì chữ ký Signed Payload đã xác thực ở trên rồi.
                const isRateLimited = err.response?.error_code === 429 ||
                                      err.message.includes('Too Many Requests');

                const isNetworkError = isRateLimited ||
                                       err.message === 'TIMEOUT' ||
                                       err.code === 'ETIMEDOUT' ||
                                       err.code === 'ECONNRESET' ||
                                       err.code === 'ENOTFOUND' ||
                                       err.code === 'EAI_AGAIN' ||
                                       err.message.includes('connect ETIMEDOUT') ||
                                       err.message.includes('read ECONNRESET');

                if (isNetworkError) {
                    console.warn(`[Security] Telegram API network issue (${err.message}). Bypassing membership check as signature is valid.`);
                } else {
                    const errMsg = err.message || '';
                    const errDesc = err.response?.description || '';
                    if (errMsg.includes('PARTICIPANT_ID_INVALID') || errDesc.includes('PARTICIPANT_ID_INVALID')) {
                        console.warn(`[Security] getChatMember returned PARTICIPANT_ID_INVALID, bypassing.`);
                    } else {
                        return res.status(403).json({
                            success: false,
                            message: 'Xác thực thành viên nhóm thất bại: ' + (err.response?.description || err.message)
                        });
                    }
                }
            }
        }

        next();
    } catch (error) {
        console.error('[Auth Middleware Error]', error);
        return res.status(500).json({ success: false, message: 'Lỗi xác thực hệ thống: ' + error.message });
    }
}

const corsOptions = {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-telegram-init-data'],
    credentials: true,
    optionsSuccessStatus: 204
};

botApp.use(cors(corsOptions));
botApp.use(loggerMiddleware);

botApp.use(express.json({ limit: '200mb' }));
botApp.use(express.urlencoded({ limit: '200mb', extended: true }));
botApp.use(webAdminSecurityHeaders);

// Serve Web Admin React App & Mini App
const webAdminDistPath = path.join(__dirname, '../web-admin/dist');
botApp.use(express.static(webAdminDistPath));

// ---------------------------------------------------------------------------
// Chống cache cho Mini App xuất kho (nạp code dạng ES module).
//
// Origin đã trả Cache-Control: max-age=0 nhưng Cloudflare ghi đè thành
// max-age=14400 (4 giờ), nên client giữ file .js cũ và không hỏi lại server.
// Sửa bằng header là vô ích — phải đổi URL. Asset được nạp qua tiền tố
// /mini-app/_v<token>/... với token tính theo mtime mới nhất của thư mục module,
// nên mỗi lần sửa code là URL đổi và client tải lại ngay.
// Chỉ ảnh hưởng đường dẫn có tiền tố /_v; các Mini App khác giữ nguyên.
// ---------------------------------------------------------------------------
// Các thư mục module Mini App. shared-ui là hạ tầng dùng chung nên phải nằm trong
// danh sách: sửa core/ hay icons.js cũng cần đổi token.
// Thêm nghiệp vụ mới (timekeep/, scheduling/…) thì khai báo thêm ở đây.
const warehouseAssetDirs = ['warehouse', 'scheduling', 'customer', 'shared-ui']
    .map(name => path.join(__dirname, 'public', name));

// Shell nào chứa __ASSET_V__ thì khai báo ở đây.
const warehouseShells = {
    '/mini-app/warehouse_export.html': path.join(__dirname, 'public', 'warehouse_export.html'),
    '/mini-app/warehouse_import.html': path.join(__dirname, 'public', 'warehouse_import.html'),
    '/mini-app/warehouse_inventory.html': path.join(__dirname, 'public', 'warehouse_inventory.html'),
    '/mini-app/warehouse_pricing.html': path.join(__dirname, 'public', 'warehouse_pricing.html'),
    '/mini-app/schedule_client.html': path.join(__dirname, 'public', 'schedule_client.html'),
    '/mini-app/customer_form.html': path.join(__dirname, 'public', 'customer_form.html')
};

let warehouseAssetVersionCache = { token: '0', checkedAt: 0 };

function getWarehouseAssetVersion() {
    const now = Date.now();
    if (now - warehouseAssetVersionCache.checkedAt < 5000) {
        return warehouseAssetVersionCache.token;
    }

    let newestMtime = 0;
    const walk = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(fullPath);
            else newestMtime = Math.max(newestMtime, fs.statSync(fullPath).mtimeMs);
        }
    };

    for (const directory of warehouseAssetDirs) {
        try {
            walk(directory);
        } catch (error) {
            newestMtime = now;
        }
    }

    warehouseAssetVersionCache = { token: Math.floor(newestMtime).toString(36), checkedAt: now };
    return warehouseAssetVersionCache.token;
}

// Bỏ tiền tố phiên bản khỏi URL đầy đủ (middleware không mount để req.url giữ nguyên
// thay đổi cho các layer sau).
botApp.use((req, res, next) => {
    const match = req.url.match(/^\/mini-app\/_v[^/]+(\/.*)$/);
    if (match) req.url = `/mini-app${match[1]}`;
    next();
});

// Shell Mini App kho: chèn token phiên bản và không cho cache, để client luôn nhận
// đúng URL asset mới nhất. Đặt trước express.static để thắng file tĩnh.
for (const [routePath, shellFile] of Object.entries(warehouseShells)) {
    botApp.get(routePath, (req, res, next) => {
        try {
            const html = fs.readFileSync(shellFile, 'utf8')
                .replace(/__ASSET_V__/g, getWarehouseAssetVersion());
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store, must-revalidate');
            res.send(html);
        } catch (error) {
            next();
        }
    });
}

botApp.use('/mini-app', express.static(path.join(__dirname, 'public')));
botApp.get('/', (req, res) => {
    res.sendFile(path.join(webAdminDistPath, 'index.html'));
});

// Áp dụng middleware bảo mật cho toàn bộ API /api/timekeep
botApp.use('/api/timekeep', authenticateTelegramMiniApp);

import { getGroupRole } from './role_guard.js';

botApp.use('/api/timekeep', async (req, res, next) => {
    const groupId = req.body.telegram_group_id || req.body.chat_id || req.query.chat_id || req.query.telegram_group_id;
    if (groupId) {
        const role = await getGroupRole(groupId);
        const isRegistration = req.path === '/register';
        const allowedRoles = isRegistration ? ['timekeep', 'report', 'report_tour', 'customer', 'warehouse'] : ['timekeep'];
        if (!allowedRoles.includes(role)) {
            return res.status(403).json({
                success: false,
                message: isRegistration
                    ? 'Nhóm này không được cấu hình chức năng đăng ký tài khoản.'
                    : 'Nhóm này không được cấu hình chức năng chấm công.'
            });
        }
    }
    next();
});

// Các route Web Admin trên tiến trình bot cũng phải dùng cùng session bảo mật
// với API chính; danh tính và vai trò luôn lấy từ session trong database.
const botAdminAuth = createAdminAuth({ pool });
botApp.use('/api/admin', botAdminAuth.authenticateAdmin);
botApp.use('/api/tk_group_settings', botAdminAuth.authenticateAdmin);
botApp.use('/api/export', botAdminAuth.authenticateAdmin);

// ==========================================
// 1. API ĐĂNG KÝ THÔNG TIN NHÂN SỰ
// ==========================================
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
    corsOptions
});

botApp.get('/api/test', async (req, res) => {
    console.log("request test api xin nghi ne")
    res.json({ success: true, message: 'Lưu lịch tuần thành công!' });
});

// API endpoint to update group_settings (used by Admin UI)


// ==========================================
// 4. CẤU HÌNH BOT TELEGRAM
// ==========================================
async function startHandler(ctx) {
    try {
        const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
        const miniAppUrl = process.env.MINI_APP_URL || 'https://YOUR_TUNNEL.trycloudflare.com';

        if (isGroup) {
            const groupName = ctx.chat.title || 'Nhóm làm việc';
            const groupId = ctx.chat.id.toString();

            // Auto-update/insert group details
            const groupRes = await pool.query(
                'INSERT INTO telegram_groups (telegram_group_id, group_name) VALUES ($1, $2) ON CONFLICT (telegram_group_id) DO UPDATE SET group_name = EXCLUDED.group_name RETURNING bot_role',
                [groupId, groupName]
            );
            const botRole = groupRes.rows[0]?.bot_role;

            // Sinh Web App URL trực tiếp thay vì startapp
            const botUsername = ctx.botInfo?.username || process.env.BOT_USERNAME || 'bot';
            const appShortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
            const token = process.env.TELEGRAM_BOT_TOKEN || '';
            const ts = Date.now();

            const createWebAppUrl = (action, targetPage) => {
                const dataString = `${action}:${groupId}:${ts}`;
                const sig = crypto.createHmac('sha256', token).update(dataString).digest('hex');
                // Bắt buộc dùng deep link (url) vì Telegram chặn web_app trong group chat
                return `https://t.me/${botUsername}/${appShortName}?startapp=${action}_${groupId}_${ts}_${sig}`;
            };

            const registerUrl = createWebAppUrl('register', 'register.html');
            const scheduleclientUrl = createWebAppUrl('scheduleclient', 'schedule_client.html');
            const scheduleUrl = createWebAppUrl('schedule', 'schedule.html');
            const leaveUrl = createWebAppUrl('leave', 'urgent_leave.html');
            const checkinUrl = createWebAppUrl('checkin', 'checkin_upload.html');
            const statsUrl = createWebAppUrl('stats', 'stats.html');
            const baocaoUrl = createWebAppUrl('baocao', 'form.html');
            const customerUrl = createWebAppUrl('customer', 'customer_form.html');

            const schedclientSig = crypto.createHmac('sha256', token).update(`scheduleclient:${ctx.chat.id}:${ts}`).digest('hex');
            const scheduleclientUrl2 = `https://t.me/${botUsername}/${appShortName}?startapp=scheduleclient_${ctx.chat.id}_${ts}_${schedclientSig}`;

            const makeupclientSig = crypto.createHmac('sha256', token).update(`makeupclient:${ctx.chat.id}:${ts}`).digest('hex');
            const makeupclientUrl = `https://t.me/${botUsername}/${appShortName}?startapp=makeupclient_${ctx.chat.id}_${ts}_${makeupclientSig}`;

            // Generate dmUrl (Direct Message URL) for Report Form
            const dmUrl = `https://t.me/${botUsername}`; // Used for 'Điền Form Báo Cáo' which typically opens PM

            if (!botRole) {
                await ctx.reply(
                    `⚠️ Nhóm chưa được phân quyền. Vui lòng liên hệ Admin để set quyền cho Bot trong nhóm này.`,
                    { parse_mode: 'HTML' }
                );
            } else if (botRole === 'timekeep') {
                await ctx.reply(
                    `Vui lòng chọn chức năng:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '👤 Đăng ký tài khoản', url: registerUrl },
                                    { text: '📸 Check-in (Upload Video)', url: checkinUrl }
                                ],
                                [
                                    { text: '📅 Đăng ký lịch tuần', url: scheduleUrl },
                                    { text: '🚨 Xin nghỉ đột xuất / Đi muộn', url: leaveUrl }
                                ],
                                [
                                    { text: '📊 Lịch & Đi muộn tháng này', url: statsUrl }
                                ]
                            ]
                        }
                    }
                );
            } else if (botRole === 'warehouse') {
                const whImportUrl = createWebAppUrl('whimport', 'warehouse_import.html');
                const whExportUrl = createWebAppUrl('whexport', 'warehouse_export.html');
                const whInventoryUrl = createWebAppUrl('whinventory', 'warehouse_inventory.html');
                const whPricingUrl = createWebAppUrl('whpricing', 'warehouse_pricing.html');

                await ctx.reply(
                    `Vui lòng chọn chức năng:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '👤 Đăng ký tài khoản', url: registerUrl }
                                ],
                                [
                                    { text: '📥 Nhập kho', url: whImportUrl },
                                    { text: '📤 Xuất kho', url: whExportUrl }
                                ],
                                [
                                    { text: '📊 Xem tồn kho', url: whInventoryUrl }
                                ],
                                [
                                    // Chỉ Admin/kế toán có quyền MANAGE_PRICING mới thao tác được —
                                    // ai không có quyền bấm vào vẫn bị chặn ở app, đây chỉ là lối vào chung.
                                    { text: '💰 Nhập đơn giá', url: whPricingUrl }
                                ]
                            ]
                        }
                    }
                );
            } else if (botRole === 'report') {
                await ctx.reply(
                    `Vui lòng chọn chức năng:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '👤 Đăng Ký Tài Khoản', url: registerUrl }
                                ],
                                [
                                    { text: '📝 Điền Báo Cáo KPI (Form)', url: baocaoUrl }
                                ],
                                [
                                    { text: '🔄 Cập Nhật Báo Cáo', callback_data: 'CHECK_UPDATE_REPORT' },
                                    { text: '📅 Đặt Lịch / Check Lịch', url: scheduleclientUrl2 }
                                ]
                            ]
                        }
                    }
                );
            } else if (botRole === 'report_tour') {
                await ctx.reply(
                    `Vui lòng chọn chức năng:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '👤 Đăng Ký Tài Khoản', url: registerUrl }
                                ],
                                [
                                    { text: '📅 Đặt Lịch / Check Lịch', url: scheduleclientUrl2 }
                                ],
                                [
                                    { text: '🕘 Báo Bù / Báo Công Muộn', url: makeupclientUrl }
                                ]
                            ]
                        }
                    }
                );
            } else if (botRole === 'customer' || botRole === 'customer_record') {
                await ctx.reply(
                    `Vui lòng chọn chức năng:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '👤 Đăng Ký Tài Khoản', url: registerUrl }
                                ],
                                [
                                    { text: '☘️ Điền Thông Tin Khách Hàng', url: customerUrl }
                                ]
                            ]
                        }
                    }
                );
            }
        } else {
            // Private Chat Flow
            const startPayload = ctx.startPayload;

            if (startPayload && startPayload.startsWith('reg_')) {
                const groupId = startPayload.replace('reg_', '');
                const registerUrl = `${miniAppUrl}/mini-app/register.html?chat_id=${groupId}`;

                await ctx.reply(
                    `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                    `Vui lòng nhấn nút <b>Đăng ký ngay</b> dưới đây để hoàn tất thông tin cá nhân:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '👤 Đăng ký ngay', web_app: { url: registerUrl } }
                                ]
                            ]
                        }
                    }
                );
            } else if (startPayload && startPayload.startsWith('sched_')) {
                const groupId = startPayload.replace('sched_', '');
                const scheduleUrl = `${miniAppUrl}/mini-app/schedule.html?chat_id=${groupId}`;

                await ctx.reply(
                    `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                    `Vui lòng nhấn nút <b>Đăng ký lịch</b> dưới đây để xếp ca làm việc tuần tiếp theo:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '📅 Đăng ký lịch tuần', web_app: { url: scheduleUrl } }
                                ]
                            ]
                        }
                    }
                );
            } else if (startPayload && startPayload.startsWith('leave_')) {
                const groupId = startPayload.replace('leave_', '');
                const leaveUrl = `${miniAppUrl}/mini-app/urgent_leave.html?chat_id=${groupId}`;

                await ctx.reply(
                    `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                    `Vui lòng nhấn nút <b>Báo nghỉ đột xuất</b> dưới đây để gửi yêu cầu nghỉ hoặc đi muộn:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '🚨 Xin nghỉ / Đi muộn', web_app: { url: leaveUrl } }
                                ]
                            ]
                        }
                    }
                );
            } else if (startPayload && startPayload.startsWith('checkin_')) {
                const groupId = startPayload.replace('checkin_', '');
                const checkinUrl = `${miniAppUrl}/mini-app/checkin_upload.html?chat_id=${groupId}`;

                await ctx.reply(
                    `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                    `Vui lòng nhấn nút <b>Tải Up Video Check-in</b> dưới đây để điểm danh bằng Video:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '📸 Tải Up Video Check-in', web_app: { url: checkinUrl } }
                                ]
                            ]
                        }
                    }
                );
            } else if (startPayload && startPayload.startsWith('stats_')) {
                const groupId = startPayload.replace('stats_', '');
                const statsUrl = `${miniAppUrl}/mini-app/stats.html?chat_id=${groupId}`;

                await ctx.reply(
                    `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                    `Vui lòng nhấn nút <b>Xem thống kê của tôi</b> dưới đây để theo dõi lịch tuần này, tuần sau và lịch sử đi muộn/tiền phạt tháng này:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '📊 Xem thống kê của tôi', web_app: { url: statsUrl } }
                                ]
                            ]
                        }
                    }
                );
            } else if (startPayload && startPayload.startsWith('customer_')) {
                const payloadParts = startPayload.split('_');
                const groupId = payloadParts[1] || startPayload.replace('customer_', '');
                const formUrl = `${miniAppUrl}/mini-app/customer_form.html?chat_id=${groupId}`;

                await ctx.reply(
                    `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                    `Vui lòng nhấn nút <b>Điền thông tin khách hàng</b> dưới đây để bắt đầu nhập thông tin:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '☘️ Điền Thông Tin Khách Hàng', web_app: { url: formUrl } }
                                ]
                            ]
                        }
                    }
                );
            } else if (startPayload && startPayload.startsWith('whimport_')) {
                const payloadParts = startPayload.split('_');
                const groupId = payloadParts[1];
                const ts = payloadParts[2];
                const sig = payloadParts[3];
                const formUrl = `${miniAppUrl}/mini-app/warehouse_import.html?chat_id=${groupId}&ts=${ts}&sig=${sig}&action=whimport`;

                await ctx.reply(
                    `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                    `Vui lòng nhấn nút <b>Nhập Kho</b> dưới đây để bắt đầu nhập sản phẩm:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '📥 Nhập Kho', web_app: { url: formUrl } }
                                ]
                            ]
                        }
                    }
                );
            } else if (startPayload && startPayload.startsWith('whexport_')) {
                const payloadParts = startPayload.split('_');
                const groupId = payloadParts[1];
                const ts = payloadParts[2];
                const sig = payloadParts[3];
                // Mini App xuất kho tự đọc cờ warehouse_service_order_enabled qua
                // /api/warehouse/service-order/bootstrap rồi bật hoặc khóa luồng đơn
                // theo dịch vụ ngay trong màn hình chọn loại đơn. Bot không cần truy
                // vấn cờ để chọn trang nữa nên bỏ được một query mỗi lần mở link.
                const formUrl = `${miniAppUrl}/mini-app/warehouse_export.html?chat_id=${groupId}&ts=${ts}&sig=${sig}&action=whexport`;

                await ctx.reply(
                    `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                    `Vui lòng nhấn nút <b>Xuất Kho</b> dưới đây để gửi yêu cầu xuất sản phẩm:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '📤 Xuất Kho', web_app: { url: formUrl } }
                                ]
                            ]
                        }
                    }
                );
            } else if (startPayload && startPayload.startsWith('whinventory_')) {
                const payloadParts = startPayload.split('_');
                const groupId = payloadParts[1];
                const ts = payloadParts[2];
                const sig = payloadParts[3];
                const formUrl = `${miniAppUrl}/mini-app/warehouse_inventory.html?chat_id=${groupId}&ts=${ts}&sig=${sig}&action=whinventory`;

                await ctx.reply(
                    `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                    `Vui lòng nhấn nút <b>Xem Tồn Kho</b> dưới đây để kiểm tra số lượng hàng trong kho:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '📊 Xem Tồn Kho', web_app: { url: formUrl } }
                                ]
                            ]
                        }
                    }
                );
            } else {
                const botInfo = await ctx.telegram.getMe();
                const addToGroupUrl = `https://t.me/${botInfo.username}?startgroup=true`;

                await ctx.reply(
                    `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                    `Để đăng ký tài khoản hoặc lịch làm việc, vui lòng nhấn các nút trong nhóm làm việc của bạn.\n\n` +
                    `👉 Nếu Bot chưa được đưa vào nhóm làm việc, nhấn nút dưới đây để thêm:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '➕ Thêm Bot vào nhóm', url: addToGroupUrl }
                                ]
                            ]
                        }
                    }
                );
            }
        }
    } catch (e) {
        console.error('Lỗi startHandler:', e);
    }
}

bot.start(startHandler);
bot.command(['app', 'menu', 'setup', 'chamcong', 'form', 'lamviec', 'tienich'], startHandler);
bot.command(['help', 'huongdan'], async (ctx) => {
    if (!(await requireGroupRole(ctx, 'timekeep'))) return;
    return ctx.replyWithHTML(TIMEKEEP_BOT_HELP_HTML);
});



const isDocker = fs.existsSync('/.dockerenv');
const PORT = process.env.PORT || (isDocker ? 3002 : 3009);


botApp.get('/api/status', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

botApp.get('/isdocker', (req, res) => {
    res.json({ isDocker });
});

// ========================================
// DASHBOARD API – Thống kê chấm công
// ========================================
// UTC+7 helpers (hoạt động cả host lẫn Docker bất kể TZ container)



// Daily export cron job at 23:00
// =====================================
// ADMIN SCHEDULE MANAGEMENT APIs
// =====================================

// Admin cập nhật ca trực (thay đổi shift_type)

// Admin thêm lịch trực thủ công

// Admin xóa lịch trực

// Admin đồng bộ Google Sheet Chấm công & Lịch
// Setup KPI bot features
setupKpiBot(bot, botApp);

botApp.listen(PORT, () => {
    console.log(`[Express] Mini-App Server đang chạy trên cổng ${PORT}`);
});

// Start Telegraf Bot
bot.telegram.setMyCommands([
    { command: 'start', description: 'Khởi động bot & nhận liên kết chức năng' },
    // { command: 'setup', description: 'Thiết lập ca trực nhóm (chỉ Admin)' },
    // { command: 'calendar', description: 'Đăng ký lịch làm việc tuần' },
    // { command: 'stats', description: 'Xem lịch tuần & thống kê đi muộn, tiền phạt' }
]).then(() => {
    console.log('[Telegraf] Đăng ký danh sách lệnh bot thành công');
}).catch(err => {
    console.error('[Telegraf Error] Lỗi đăng ký commands:', err);
});

async function syncGroupsOnStartup() {
    try {
        console.log('[Startup Sync] Đang kiểm tra và bổ sung các nhóm còn thiếu vào DB...');

        // 1. Tự động tìm và lưu các telegram_group_id có trong DB nhưng chưa có trong telegram_groups
        const missingFromDb = await pool.query(`
            SELECT DISTINCT telegram_group_id 
            FROM (
                SELECT telegram_group_id FROM employees WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
                UNION
                SELECT telegram_group_id FROM kpi_policies WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
                UNION
                SELECT telegram_group_id FROM daily_reports WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
                UNION
                SELECT telegram_group_id FROM penalty_records WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
                UNION
                SELECT telegram_group_id FROM reminder_logs WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
                UNION
                SELECT telegram_group_id FROM group_settings WHERE telegram_group_id IS NOT NULL AND telegram_group_id != ''
            ) AS referenced_groups
            WHERE telegram_group_id NOT IN (SELECT telegram_group_id FROM telegram_groups)
        `);

        for (const row of missingFromDb.rows) {
            const gid = row.telegram_group_id;
            await pool.query(
                `INSERT INTO telegram_groups (telegram_group_id, group_name, is_active, is_deleted)
                 VALUES ($1, $2, true, false) ON CONFLICT (telegram_group_id) DO NOTHING`,
                [gid, `Group ${gid}`]
            );
            await pool.query(
                `INSERT INTO group_settings (telegram_group_id) VALUES ($1) ON CONFLICT (telegram_group_id) DO NOTHING`,
                [gid]
            );
            console.log(`[Startup Sync] Đã bổ sung nhóm từ dữ liệu DB: ${gid}`);
        }

        // 2. Gọi Telegram API getChat để đồng bộ tên nhóm thực tế và trạng thái hoạt động
        const allGroups = await pool.query(`SELECT telegram_group_id, group_name FROM telegram_groups WHERE COALESCE(is_deleted, false) = false`);

        let syncedCount = 0;
        for (const g of allGroups.rows) {
            const gid = g.telegram_group_id;
            try {
                const chatInfo = await bot.telegram.getChat(gid);
                if (chatInfo && chatInfo.title) {
                    await pool.query(
                        `UPDATE telegram_groups SET group_name = $1, is_active = true WHERE telegram_group_id = $2`,
                        [chatInfo.title, gid]
                    );
                    await pool.query(
                        `INSERT INTO group_settings (telegram_group_id) VALUES ($1) ON CONFLICT (telegram_group_id) DO NOTHING`,
                        [gid]
                    );
                    syncedCount++;
                }
            } catch (err) {
                if (err.message && (err.message.includes('chat not found') || err.message.includes('bot was kicked'))) {
                    await pool.query(`UPDATE telegram_groups SET is_active = false WHERE telegram_group_id = $1`, [gid]);
                }
            }
        }

        console.log(`[Startup Sync] ✅ Đã hoàn tất kiểm tra & đồng bộ ${syncedCount}/${allGroups.rows.length} nhóm với Telegram.`);
    } catch (err) {
        console.error('[Startup Sync Error]', err.message);
    }
}

bot.launch().then(() => {
    console.log('[Telegraf] Bot Chấm công đã sẵn sàng...');
    syncGroupsOnStartup();
}).catch((err) => {
    console.error('[Telegraf Error] Lỗi khởi động Bot:', err);
});

// ==========================================
// CUSTOMER RECORD (LƯU THÔNG TIN KHÁCH HÀNG) FEATURES
// ==========================================

const escapeHtml = (str) => {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// Module hồ sơ khách hàng được lắp ghép tại một điểm duy nhất: route Mini App,
// handler nhận ảnh reply, worker đồng bộ Drive và cron tổng kết 22:00 đều nằm
// trong domains/customer/, không rải rác trong file này nữa.
registerCustomerModule({
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
    driveParentFolderId: process.env.CUSTOMER_DRIVE_PARENT_FOLDER_ID
});

// Module kho được lắp ghép tại một điểm duy nhất để không trộn nghiệp vụ kho
// với các role chấm công, KPI và hồ sơ khách hàng.
registerWarehouseModule({
    botApp,
    bot,
    pool,
    authenticateTelegramMiniApp,
    warehouseTempUploadDir: path.join(__dirname, 'public/uploads/temp'),
    moment,
    fs,
    createWarehouseFolder,
    uploadToDrive,
    escapeHtml,
    getDocById,
    sendMessageToRoleGroup,
    sendMediaGroupToRoleGroup
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
