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
import {
    buildAbsenceNotificationText,
    finalizeUnauthorizedAbsences,
    getPendingAbsenceNotifications,
    groupAbsenceNotifications,
    markAbsenceNotificationsSent,
    applyApprovedLeavePenalties
} from '../../domains/timekeep/attendance-penalties.js';

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

// Cấu hình Multer cho upload video check-in dạng binary stream
const checkinStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public/uploads/checkins');
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const telegramId = req.verifiedTelegramId || req.body.telegram_id || 'user';
        const ext = path.extname(file.originalname) || '.mp4';
        cb(null, `checkin_${telegramId}_${Date.now()}${ext}`);
    }
});

const uploadCheckin = multer({
    storage: checkinStorage,
    limits: { fileSize: 200 * 1024 * 1024 }
});

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
                const isNetworkError = err.message === 'TIMEOUT' || 
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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-telegram-init-data', 'x-admin-id', 'x-admin-role'],
    credentials: true,
    optionsSuccessStatus: 204
};

botApp.use(cors(corsOptions));
botApp.use(loggerMiddleware);

botApp.use(express.json({ limit: '200mb' }));
botApp.use(express.urlencoded({ limit: '200mb', extended: true }));

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
const warehouseAssetDirs = ['warehouse', 'scheduling', 'shared-ui']
    .map(name => path.join(__dirname, 'public', name));

// Shell nào chứa __ASSET_V__ thì khai báo ở đây.
const warehouseShells = {
    '/mini-app/warehouse_export.html': path.join(__dirname, 'public', 'warehouse_export.html'),
    '/mini-app/warehouse_import.html': path.join(__dirname, 'public', 'warehouse_import.html'),
    '/mini-app/warehouse_inventory.html': path.join(__dirname, 'public', 'warehouse_inventory.html'),
    '/mini-app/schedule_client.html': path.join(__dirname, 'public', 'schedule_client.html')
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

// ==========================================
// 1. API ĐĂNG KÝ THÔNG TIN NHÂN SỰ
// ==========================================
botApp.post('/api/timekeep/register', async (req, res) => {
    try {
        const { telegram_username, full_name, role, telegram_group_id } = req.body;
        const telegram_id = req.verifiedTelegramId || req.body.telegram_id;

        console.log(`[Registration] Nhận yêu cầu đăng ký: ID=${telegram_id}, Name=${full_name}, Role=${role}, GroupID=${telegram_group_id}`);

        if (!telegram_id || !full_name || !role) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin đăng ký bắt buộc!' });
        }

        if (!telegram_group_id) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng mở Mini App từ liên kết Đăng ký trong nhóm làm việc của bạn để xác định nhóm trực thuộc!'
            });
        }

        // Get or create group in telegram_groups
        let groupRes = await pool.query('SELECT * FROM telegram_groups WHERE telegram_group_id = $1', [telegram_group_id]);
        let groupId;
        let groupRecord;
        if (groupRes.rows.length > 0) {
            groupId = groupRes.rows[0].id;
            groupRecord = groupRes.rows[0];
        } else {
            const insertGroup = await pool.query(
                'INSERT INTO telegram_groups (telegram_group_id, group_name) VALUES ($1, $2) RETURNING *',
                [telegram_group_id, 'Nhóm làm việc']
            );
            groupId = insertGroup.rows[0].id;
            groupRecord = insertGroup.rows[0];
        }

        // Nhóm KPI dùng tài khoản nhân viên toàn cục + membership theo từng nhóm.
        // Đăng ký MEDITECH không tạo bản sao và không kích hoạt lại UK đang PAUSED.
        if (KPI_GROUP_ROLES.includes(groupRecord.bot_role)) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                let employeeResult = await client.query(
                    'SELECT * FROM employees WHERE telegram_id = $1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE',
                    [String(telegram_id)]
                );

                if (employeeResult.rows.length === 0) {
                    employeeResult = await client.query(
                        `SELECT * FROM employees
                         WHERE group_id = $1
                           AND LOWER(TRIM(full_name)) = LOWER(TRIM($2))
                           AND (telegram_id IS NULL OR telegram_id = '')
                         ORDER BY created_at ASC
                         LIMIT 1
                         FOR UPDATE`,
                        [groupId, full_name]
                    );
                }

                let employee;
                if (employeeResult.rows.length > 0) {
                    employee = employeeResult.rows[0];
                    if (employee.is_active === false) {
                        await client.query('ROLLBACK');
                        return res.status(403).json({ success: false, message: 'Tài khoản đã bị vô hiệu hóa toàn hệ thống. Vui lòng liên hệ Admin.' });
                    }
                    const updated = await client.query(
                        `UPDATE employees
                         SET telegram_id = $1, telegram_username = $2,
                             full_name = $3, role = COALESCE(NULLIF(role, ''), $4)
                         WHERE id = $5
                         RETURNING *`,
                        [String(telegram_id), telegram_username || '', full_name, role, employee.id]
                    );
                    employee = updated.rows[0];
                } else {
                    const employeeCode = `EMP-${telegram_id}-${Date.now().toString().slice(-4)}`;
                    const inserted = await client.query(
                        `INSERT INTO employees
                            (group_id, telegram_group_id, telegram_id, telegram_username,
                             full_name, role, employee_code, department, position,
                             current_kpi_target, need_report, is_active)
                         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, 40, TRUE, TRUE)
                         RETURNING *`,
                        [groupId, String(telegram_id), telegram_username || '', full_name, role, employeeCode, 'Chưa xếp', 'Nhân viên']
                    );
                    employee = inserted.rows[0];
                }

                const registration = await registerEmployeeInKpiGroup(client, employee, telegram_group_id, 'mini_app_registration');
                if (!registration.ok) {
                    await client.query('ROLLBACK');
                    if (registration.reason === 'PAUSED') {
                        return res.status(409).json({
                            success: false,
                            message: 'Bạn đang được Admin tạm dừng KPI trong nhóm này. Bạn vẫn có thể đăng ký và hoạt động tại nhóm KPI khác.'
                        });
                    }
                    return res.status(400).json({ success: false, message: 'Nhóm này không phải nhóm KPI đang hoạt động.' });
                }

                await client.query('COMMIT');
                return res.json({ success: true, message: 'Đăng ký hoạt động KPI trong nhóm thành công!' });
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        }

        // Check if user already exists in employees for this group
        const userRes = await pool.query(
            'SELECT id FROM employees WHERE group_id = $1 AND telegram_id = $2',
            [groupId, telegram_id]
        );

        if (userRes.rows.length > 0) {
            // User already registered in this group – do not allow duplicate registration
            console.log(`[Registration] Người dùng đã tồn tại trong nhóm, từ chối đăng ký lại. telegram_id=${telegram_id}, group_id=${groupId}`);
            return res.status(400).json({ success: false, message: 'Người dùng đã đăng ký trong nhóm này.' });
        }

        const employeeCode = `EMP-${telegram_id}-${Date.now().toString().slice(-4)}`;
        // Ưu tiên liên kết hồ sơ đã được Admin tạo sẵn trong đúng nhóm.
        const unlinkedRes = await pool.query(
            `SELECT id FROM employees
             WHERE group_id = $1
               AND LOWER(TRIM(full_name)) = LOWER(TRIM($2))
               AND (telegram_id IS NULL OR telegram_id = '')
             ORDER BY id ASC
             LIMIT 1`,
            [groupId, full_name]
        );

        if (unlinkedRes.rows.length > 0) {
            await pool.query(
                `UPDATE employees
                 SET telegram_group_id = $1,
                     telegram_id = $2,
                     telegram_username = $3,
                     role = COALESCE(NULLIF(role, ''), $4),
                     is_active = true
                 WHERE id = $5`,
                [telegram_group_id, telegram_id, telegram_username || '', role, unlinkedRes.rows[0].id]
            );
        } else {
            await pool.query(
                'INSERT INTO employees (group_id, telegram_group_id, telegram_id, telegram_username, full_name, role, employee_code, department, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [groupId, telegram_group_id, telegram_id, telegram_username || '', full_name, role, employeeCode, 'Chưa xếp', 'Nhân viên']
            );
        }
        console.log(`[Registration] Thêm mới thành công user: ${full_name}`);

        res.json({ success: true, message: 'Đăng ký tài khoản thành công!' });

    } catch (error) {
        console.error('[Registration Error] Lỗi đăng ký:', error);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message });
    }
});

// ==========================================
// 2. API TRUY VẤN LỊCH TUẦN (FRONTEND LOAD)
// ==========================================
botApp.get('/api/timekeep/schedule/data', async (req, res) => {
    try {
        const { chat_id, target_user_id } = req.query;
        const telegram_id = req.verifiedTelegramId || req.query.telegram_id;

        console.log('[DEBUG /schedule/data] req.query:', req.query, 'verifiedTelegramId:', req.verifiedTelegramId);

        if (!telegram_id) {
            console.log('[DEBUG /schedule/data] Missing telegram_id!');
            return res.status(400).json({ success: false, message: 'Thiếu telegram_id!' });
        }

        // 1. Get user details
        const employeeRes = await pool.query('SELECT * FROM employees WHERE telegram_id = $1 LIMIT 1', [telegram_id]);
        if (employeeRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Nhân sự chưa đăng ký tài khoản! Vui lòng đăng ký trước.' });
        }
        const user = employeeRes.rows[0];

        const isAdmin = (process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(String(telegram_id))) || user.role === 'admin';
        user.is_admin = isAdmin;

        let schedule_registration_open = true;
        if (chat_id) {
            const groupRes = await pool.query('SELECT * FROM telegram_groups WHERE telegram_group_id = $1 LIMIT 1', [chat_id]);
            if (groupRes.rows.length > 0) {
                const groupRecord = groupRes.rows[0];
                schedule_registration_open = groupRecord.schedule_registration_open;
                
                if (!isAdmin && user.group_id !== groupRecord.id) {
                    return res.status(404).json({ success: false, message: 'Nhân sự chưa đăng ký tài khoản trong nhóm này!' });
                }
            } else if (!isAdmin) {
                return res.status(404).json({ success: false, message: 'Nhóm Telegram này chưa được đăng ký trong hệ thống!' });
            }
        } else if (user.group_id) {
            const groupRes = await pool.query('SELECT schedule_registration_open FROM telegram_groups WHERE id = $1 LIMIT 1', [user.group_id]);
            if (groupRes.rows.length > 0) {
                schedule_registration_open = groupRes.rows[0].schedule_registration_open;
            }
        }
        user.schedule_registration_open = schedule_registration_open;

        // Determine target user if admin is viewing someone else's schedule
        let targetUser = user;
        if (target_user_id && target_user_id !== String(user.id) && isAdmin) {
            const targetRes = await pool.query('SELECT * FROM employees WHERE id = $1', [target_user_id]);
            if (targetRes.rows.length > 0) {
                const fetchedTarget = targetRes.rows[0];
                if (fetchedTarget.group_id !== user.group_id) {
                    return res.status(403).json({ success: false, message: 'Không thể xem lịch của nhân viên thuộc nhóm khác!' });
                }
                targetUser = fetchedTarget;
            }
        }

        const groupId = user.group_id;

        // 2. Date calculations using Moment.js (ISO week starts on Monday, ends on Sunday)
        const startOfCurrentWeek = moment().startOf('isoWeek');
        const startOfNextWeek = moment().add(1, 'week').startOf('isoWeek');

        const currentWeekDays = [];
        for (let i = 0; i < 7; i++) {
            currentWeekDays.push(moment(startOfCurrentWeek).add(i, 'days').format('YYYY-MM-DD'));
        }

        const nextWeekDays = [];
        for (let i = 0; i < 7; i++) {
            nextWeekDays.push(moment(startOfNextWeek).add(i, 'days').format('YYYY-MM-DD'));
        }

        // Calculate thresholds for current and next weeks (Sunday at 23:00)
        const currentWeekThreshold = moment(startOfCurrentWeek).subtract(1, 'days').hours(23).minutes(0).seconds(0);
        const nextWeekThreshold = moment(startOfNextWeek).subtract(1, 'days').hours(23).minutes(0).seconds(0);

        const isCurrentWeekPastThreshold = moment().isSameOrAfter(currentWeekThreshold);
        const isNextWeekPastThreshold = moment().isSameOrAfter(nextWeekThreshold);

        const isCurrentWeekLocked = !isAdmin && isCurrentWeekPastThreshold && (user.schedule_registration_open === false);
        const isNextWeekLocked = !isAdmin && isNextWeekPastThreshold && (user.schedule_registration_open === false);

        // 3. Fetch user's schedules
        const mySchedulesRes = await pool.query(
            `SELECT date::text, shift_type, is_locked, proof_url, updated_by, updated_at 
             FROM tk_schedules 
             WHERE user_id = $1 AND date >= $2 AND date <= $3`,
            [targetUser.id, currentWeekDays[0], nextWeekDays[6]]
        );
        const mySchedules = mySchedulesRes.rows;

        // 4. Fetch all group schedules for current & next week (for overlap/role-based checks)
        const groupSchedulesRes = await pool.query(
            `SELECT s.date::text, s.shift_type, u.id as user_id, u.full_name, u.role 
             FROM tk_schedules s 
             JOIN employees u ON s.user_id = u.id 
             WHERE s.group_id = $1 AND s.date >= $2 AND s.date <= $3`,
            [groupId, currentWeekDays[0], nextWeekDays[6]]
        );
        const groupSchedules = groupSchedulesRes.rows;

        // 5. Fetch all group users (only for Admin view selection)
        let groupUsers = [];
        if (isAdmin) {
            const groupUsersRes = await pool.query(
                `SELECT id, full_name, role, telegram_id FROM employees WHERE group_id = $1 ORDER BY full_name ASC`,
                [groupId]
            );
            groupUsers = groupUsersRes.rows;
        }

        res.json({
            success: true,
            user,
            target_user: targetUser,
            is_admin: isAdmin,
            currentWeekDays,
            nextWeekDays,
            is_current_week_locked: isCurrentWeekLocked,
            is_next_week_locked: isNextWeekLocked,
            mySchedules,
            groupSchedules,
            groupUsers
        });

    } catch (error) {
        console.error('[Get Schedule Error]:', error);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message });
    }
});

// ==========================================
// 3. API BẬT/TẮT ĐĂNG KÝ LỊCH (CHO QUẢN LÝ / ADMIN)
// ==========================================
botApp.post('/api/timekeep/schedule/toggle', async (req, res) => {
    try {
        const { chat_id } = req.body;
        const telegram_id = req.verifiedTelegramId || req.body.telegram_id;

        if (!telegram_id || !chat_id) {
            return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ!' });
        }

        const callerRes = await pool.query(
            `SELECT u.role, g.id as group_id, g.schedule_registration_open 
             FROM employees u 
             JOIN telegram_groups g ON u.group_id = g.id 
             WHERE u.telegram_id = $1 AND g.telegram_group_id = $2`,
            [telegram_id, chat_id]
        );

        if (callerRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tài khoản không tồn tại trong nhóm này!' });
        }

        const caller = callerRes.rows[0];
        const isAdmin = process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(String(telegram_id));

        if (!isAdmin && !['Quản lý', 'Quản lý kho'].includes(caller.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền thao tác tính năng này!' });
        }

        const newState = !caller.schedule_registration_open;
        await pool.query('UPDATE telegram_groups SET schedule_registration_open = $1 WHERE id = $2', [newState, caller.group_id]);

        res.json({ success: true, message: newState ? 'Đã MỞ đăng ký lịch.' : 'Đã ĐÓNG đăng ký lịch.', new_state: newState });
    } catch (error) {
        console.error('[Toggle Schedule Error]:', error);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message });
    }
});

// ==========================================
// 4. API LƯU LỊCH TUẦN & FILE MINH CHỨNG
// ==========================================
botApp.post('/api/timekeep/schedule/save', async (req, res) => {
    try {
        const { chat_id, target_user_id, days, proof_image } = req.body;
        const telegram_id = req.verifiedTelegramId || req.body.telegram_id;

        if (!telegram_id || !days || !Array.isArray(days)) {
            return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ!' });
        }

        const employeeRes = await pool.query('SELECT * FROM employees WHERE telegram_id = $1 LIMIT 1', [telegram_id]);
        if (employeeRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tài khoản yêu cầu không tồn tại trong hệ thống!' });
        }
        const caller = employeeRes.rows[0];

        const isAdmin = (process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(String(telegram_id))) || caller.role === 'admin';
        
        let schedule_registration_open = true;
        if (chat_id) {
            const groupRes = await pool.query('SELECT * FROM telegram_groups WHERE telegram_group_id = $1 LIMIT 1', [chat_id]);
            if (groupRes.rows.length > 0) {
                const groupRecord = groupRes.rows[0];
                schedule_registration_open = groupRecord.schedule_registration_open;
                
                if (!isAdmin && caller.group_id !== groupRecord.id) {
                    return res.status(404).json({ success: false, message: 'Tài khoản yêu cầu không tồn tại trong nhóm này!' });
                }
            } else if (!isAdmin) {
                return res.status(404).json({ success: false, message: 'Nhóm Telegram này chưa được đăng ký trong hệ thống!' });
            }
        } else if (caller.group_id) {
            const groupRes = await pool.query('SELECT schedule_registration_open FROM telegram_groups WHERE id = $1 LIMIT 1', [caller.group_id]);
            if (groupRes.rows.length > 0) {
                schedule_registration_open = groupRes.rows[0].schedule_registration_open;
            }
        }
        caller.schedule_registration_open = schedule_registration_open;
        const managerCheckRes = await pool.query("SELECT 1 FROM employees WHERE telegram_id = $1 AND role IN ('Quản lý', 'Quản lý kho') LIMIT 1", [telegram_id]);
        const isManager = managerCheckRes.rows.length > 0;

        // Identify target user
        let targetUser = caller;
        if (target_user_id && target_user_id !== String(caller.id)) {
            if (!isAdmin) {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền sửa lịch của người khác!' });
            }
            const targetRes = await pool.query('SELECT * FROM employees WHERE id = $1', [target_user_id]);
            if (targetRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Nhân viên đích không tồn tại!' });
            }
            const fetchedTarget = targetRes.rows[0];
            if (fetchedTarget.group_id !== caller.group_id) {
                return res.status(403).json({ success: false, message: 'Không thể sửa lịch của nhân viên thuộc nhóm khác!' });
            }
            targetUser = fetchedTarget;
        }

        const groupId = targetUser.group_id;

        // Validation for regular staff
        if (!isAdmin) {
            const startOfCurrentWeek = moment().startOf('isoWeek').format('YYYY-MM-DD');

            for (const day of days) {
                const dayStr = moment(day.date).format('YYYY-MM-DD');

                // Chặn sửa lịch của các tuần cũ hơn tuần này
                if (dayStr < startOfCurrentWeek) {
                    return res.status(400).json({ success: false, message: 'Bạn không thể thay đổi lịch của các tuần cũ!' });
                }

                // Check lock threshold for the week containing this day (Sunday at 23:00 of previous week)
                const startOfWeekOfDay = moment(day.date).startOf('isoWeek');
                const lockThreshold = moment(startOfWeekOfDay).subtract(1, 'days').hours(23).minutes(0).seconds(0);
                if (moment().isSameOrAfter(lockThreshold)) {
                    if (caller.schedule_registration_open === false) {
                        const startOfWeekFormatted = startOfWeekOfDay.format('DD/MM/YYYY');
                        return res.status(403).json({ success: false, message: `Quản lý đã đóng đăng ký lịch tuần ${startOfWeekFormatted}!` });
                    }
                }
            }

            // Kiểm soát nghỉ trùng ngày cùng vị trí (Overlap Check)
            for (const day of days) {
                if (day.shift_type === 'OFF') {
                    const overlapRes = await pool.query(
                        `SELECT u.full_name 
                         FROM tk_schedules s 
                         JOIN employees u ON s.user_id = u.id 
                         WHERE s.group_id = $1 AND s.date = $2 AND s.shift_type = 'OFF' AND u.role = $3 AND u.id != $4`,
                        [groupId, day.date, targetUser.role, targetUser.id]
                    );
                    if (overlapRes.rows.length > 0) {
                        return res.status(400).json({
                            success: false,
                            message: `Không thể chọn OFF ngày ${day.date}. Nhân sự "${overlapRes.rows[0].full_name}" có cùng vai trò "${targetUser.role}" đã đăng ký nghỉ ngày này!`
                        });
                    }
                }
            }

            // Kiểm soát tổng số ngày nghỉ trong tuần (>= 2 ngày OFF trong tuần)
            const offDaysCount = days.filter(d => d.shift_type === 'OFF').length;

            if (offDaysCount >= 2 && !proof_image) {
                return res.status(400).json({
                    success: false,
                    message: 'Bạn đăng ký nghỉ từ 2 ngày trở lên trong tuần. Vui lòng tải lên ảnh minh chứng!'
                });
            }

            if (!isManager && offDaysCount >= 2) {
                // Handle proof image upload
                let proofUrl = null;
                if (proof_image) {
                    const matches = proof_image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                    if (matches && matches.length === 3) {
                        const fileType = matches[1];
                        const base64Data = matches[2];
                        const buffer = Buffer.from(base64Data, 'base64');
                        const ext = fileType.split('/')[1] || 'png';

                        const filename = `proof_schedule_${targetUser.telegram_id}_${Date.now()}.${ext}`;
                        const uploadDir = path.join(__dirname, 'public/uploads/proofs');
                        const uploadPath = path.join(uploadDir, filename);

                        fs.mkdirSync(uploadDir, { recursive: true });
                        fs.writeFileSync(uploadPath, buffer);

                        proofUrl = `/mini-app/uploads/proofs/${filename}`;
                    }
                }

                const startOfWeekStr = moment(days[0].date).startOf('isoWeek').format('YYYY-MM-DD');

                // Cancel existing pending SCHEDULE_CHANGE requests for this user & week
                await pool.query(
                    `UPDATE tk_leave_requests 
                     SET status = 'CANCELLED' 
                     WHERE user_id = $1 AND request_type = 'SCHEDULE_CHANGE' AND date = $2 AND status = 'PENDING'`,
                    [targetUser.id, startOfWeekStr]
                );

                const insertRes = await pool.query(
                    `INSERT INTO tk_leave_requests (group_id, user_id, request_type, late_minutes, date, reason, proof_url, status)
                     VALUES ($1, $2, 'SCHEDULE_CHANGE', 0, $3, $4, $5, 'PENDING')
                     RETURNING id`,
                    [groupId, targetUser.id, startOfWeekStr, JSON.stringify(days), proofUrl]
                );
                const requestId = insertRes.rows[0].id;

                let telegramGroupId = chat_id;
                if (!telegramGroupId) {
                    const groupRes = await pool.query('SELECT telegram_group_id FROM telegram_groups WHERE id = $1', [groupId]);
                    if (groupRes.rows.length > 0) {
                        telegramGroupId = groupRes.rows[0].telegram_group_id;
                    }
                }

                if (telegramGroupId) {
                    const startOfWeekFormatted = moment(startOfWeekStr).format('DD/MM/YYYY');
                    const endOfWeekFormatted = moment(startOfWeekStr).endOf('isoWeek').format('DD/MM/YYYY');
                    const offDaysDates = days.filter(d => d.shift_type === 'OFF').map(d => moment(d.date).format('DD/MM')).join(', ');
                    const miniAppUrl = process.env.MINI_APP_URL || 'https://bot.adsup.vn';

                    let msg = `🚨 <b>YÊU CẦU DUYỆT ĐĂNG KÝ LỊCH TUẦN (>= 2 NGÀY NGHỈ)</b>\n\n` +
                        `👤 <b>Nhân viên:</b> ${targetUser.full_name}\n` +
                        `💼 <b>Vị trí:</b> ${targetUser.role}\n` +
                        `📅 <b>Tuần đăng ký:</b> ${startOfWeekFormatted} - ${endOfWeekFormatted}\n` +
                        `🌴 <b>Các ngày xin nghỉ:</b> ${offDaysDates}\n`;

                    if (proofUrl) {
                        msg += `📸 <b>Minh chứng:</b> <a href="${miniAppUrl}${proofUrl}">Xem ảnh đính kèm</a>\n`;
                    } else {
                        msg += `📸 <b>Minh chứng:</b> Không có\n`;
                    }

                    msg += `\n------------------------------------------\n` +
                        `Vui lòng phê duyệt lịch làm việc của nhân sự này.`;

                    const keyboard = {
                        inline_keyboard: [
                            [
                                { text: '✅ Duyệt lịch', callback_data: `approve_leave_${requestId}` },
                                { text: '❌ Từ chối', callback_data: `reject_leave_${requestId}` }
                            ]
                        ]
                    };

                    await bot.telegram.sendMessage(telegramGroupId, msg, {
                        parse_mode: 'HTML',
                        reply_markup: keyboard
                    });
                }

                return res.json({
                    success: true,
                    message: 'Lịch đang chờ Quản lý duyệt do đăng ký nghỉ >= 2 ngày.'
                });
            }
        }

        // Retrieve existing schedule to compare
        const dateList = days.map(d => moment(d.date).format('YYYY-MM-DD'));
        const existingRes = await pool.query(
            'SELECT date::text, shift_type FROM tk_schedules WHERE user_id = $1 AND date = ANY($2::date[])',
            [targetUser.id, dateList]
        );
        const existingMap = {};
        existingRes.rows.forEach(r => {
            existingMap[r.date] = r.shift_type;
        });

        // Handle proof image upload
        let proofUrl = null;
        if (proof_image) {
            const matches = proof_image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const fileType = matches[1];
                const base64Data = matches[2];
                const buffer = Buffer.from(base64Data, 'base64');
                const ext = fileType.split('/')[1] || 'png';

                const filename = `proof_${targetUser.telegram_id}_${Date.now()}.${ext}`;
                const uploadDir = path.join(__dirname, 'public/uploads/proofs');
                const uploadPath = path.join(uploadDir, filename);

                fs.mkdirSync(uploadDir, { recursive: true });
                fs.writeFileSync(uploadPath, buffer);

                proofUrl = `/mini-app/uploads/proofs/${filename}`;
            }
        }

        // Save to Database
        const isModifiedByAdmin = isAdmin && (targetUser.id !== caller.id);
        const adminName = isModifiedByAdmin ? caller.full_name : null;
        const modifiedAt = isModifiedByAdmin ? new Date() : null;

        for (const day of days) {
            const dayStr = moment(day.date).format('YYYY-MM-DD');
            const oldShift = existingMap[dayStr];
            const newShift = day.shift_type;

            const hasChanged = oldShift !== newShift;
            const currentProofUrl = (newShift === 'OFF' && proofUrl) ? proofUrl : null;
            const isLockedValue = isAdmin ? true : false;

            if (isModifiedByAdmin && hasChanged) {
                // If modified by admin and changed, set to new admin info
                await pool.query(
                    `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, proof_url, updated_by, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (user_id, date) 
                     DO UPDATE SET shift_type = EXCLUDED.shift_type, 
                                   is_locked = EXCLUDED.is_locked,
                                   proof_url = COALESCE(EXCLUDED.proof_url, tk_schedules.proof_url),
                                   updated_by = EXCLUDED.updated_by,
                                   updated_at = EXCLUDED.updated_at`,
                    [groupId, targetUser.id, day.date, newShift, isLockedValue, currentProofUrl, adminName, modifiedAt]
                );
            } else if (!isAdmin && hasChanged) {
                // If regular staff changes their own schedule, clear the admin edit tracking!
                await pool.query(
                    `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, proof_url, updated_by, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)
                     ON CONFLICT (user_id, date) 
                     DO UPDATE SET shift_type = EXCLUDED.shift_type, 
                                   is_locked = EXCLUDED.is_locked,
                                   proof_url = COALESCE(EXCLUDED.proof_url, tk_schedules.proof_url),
                                   updated_by = NULL,
                                   updated_at = NULL`,
                    [groupId, targetUser.id, day.date, newShift, isLockedValue, currentProofUrl]
                );
            } else {
                // Admin editing themselves, or admin keeping unchanged days, keep existing updated_by/updated_at
                await pool.query(
                    `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, proof_url)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (user_id, date) 
                     DO UPDATE SET shift_type = EXCLUDED.shift_type, 
                                   is_locked = EXCLUDED.is_locked,
                                   proof_url = COALESCE(EXCLUDED.proof_url, tk_schedules.proof_url)`,
                    [groupId, targetUser.id, day.date, newShift, isLockedValue, currentProofUrl]
                );
            }
        }

        // If modified by Admin, notify the target employee via bot
        if (isModifiedByAdmin) {
            const changesList = [];
            for (const day of days) {
                const dayStr = moment(day.date).format('YYYY-MM-DD');
                const oldShift = existingMap[dayStr] || 'Chưa xếp ca';
                const newShift = day.shift_type;

                if (oldShift !== newShift) {
                    const displayDate = moment(day.date).format('DD/MM/YYYY');
                    const getShiftName = (shift) => {
                        if (shift === 'OFF') return 'Nghỉ 🟥';
                        if (shift === 'CA_SANG' || shift === 'CA_1') return 'Ca SỚM 🌅';
                        if (shift === 'CA_CHIEU' || shift === 'CA_2') return 'Ca MUỘN 🌇';
                        if (shift === 'FULL_DAY') return 'Cả ngày 🌞';
                        return shift;
                    };
                    changesList.push(`• <b>${displayDate}</b>: <b>${getShiftName(newShift)}</b> <i>(Trước đó: ${getShiftName(oldShift)})</i>`);
                }
            }

            if (changesList.length > 0 && targetUser.telegram_id) {
                try {
                    const timestampStr = moment().format('HH:mm - DD/MM/YYYY');
                    const notifyMsg = `🔔 <b>THÔNG BÁO: LỊCH LÀM VIỆC ĐÃ ĐƯỢC THAY ĐỔI</b>\n\n` +
                        `👤 <b>Người thay đổi:</b> Admin <b>${caller.full_name}</b>\n` +
                        `⏰ <b>Thời gian thay đổi:</b> ${timestampStr}\n\n` +
                        `📅 <b>Chi tiết các ca được thay đổi:</b>\n` +
                        changesList.join('\n') + `\n\n` +
                        `<i>Vui lòng mở Mini App để xem toàn bộ lịch của tuần.</i>`;

                    await bot.telegram.sendMessage(targetUser.telegram_id, notifyMsg, { parse_mode: 'HTML' });
                } catch (e) {
                    console.error(`Không thể gửi thông báo thay đổi lịch cho user ${targetUser.telegram_id}:`, e);
                }
            }
        }

        syncAllTimekeepSheets().catch(e => console.error('Sync sheet error:', e));
        res.json({ success: true, message: 'Lưu lịch tuần thành công!' });

    } catch (error) {
        console.error('[Save Schedule Error]:', error);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message });
    }
});

botApp.get('/api/test', async (req, res) => {
    console.log("request test api xin nghi ne")
    res.json({ success: true, message: 'Lưu lịch tuần thành công!' });
});

// ==========================================
// 3.1. API XIN NGHỈ ĐỘT XUẤT / ĐI MUỘN
// ==========================================
botApp.post('/api/timekeep/leave-request/save', async (req, res) => {
    try {
        const { chat_id, request_type, late_minutes, date, reason, proof_image } = req.body;
        const telegram_id = req.verifiedTelegramId || req.body.telegram_id;
        console.log(`[DEBUG API XIN NGHỈ] Đã nhận request từ Telegram ID: ${telegram_id} | Loại: ${request_type} | Ngày: ${date}`);

        if (!telegram_id || !request_type || !date || !reason) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin bắt buộc!' });
        }

        // 1. Get user details
        console.log(`[DEBUG API XIN NGHỈ] Đang query DB employees...`);
        let userRes;
        const employeeRes = await pool.query('SELECT * FROM employees WHERE telegram_id = $1 LIMIT 1', [telegram_id]);
        if (employeeRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Nhân sự chưa đăng ký tài khoản! Vui lòng đăng ký trước.' });
        }
        const user = employeeRes.rows[0];

        const isAdmin = (process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(String(telegram_id))) || user.role === 'admin';

        if (chat_id) {
            const groupRes = await pool.query('SELECT * FROM telegram_groups WHERE telegram_group_id = $1 LIMIT 1', [chat_id]);
            if (groupRes.rows.length > 0) {
                const groupRecord = groupRes.rows[0];
                if (!isAdmin && user.group_id !== groupRecord.id) {
                    return res.status(404).json({ success: false, message: 'Nhân sự chưa đăng ký tài khoản trong nhóm này!' });
                }
            } else if (!isAdmin) {
                return res.status(404).json({ success: false, message: 'Nhóm Telegram này chưa được đăng ký trong hệ thống!' });
            }
        }

        // 2. Identify group
        let groupId = user.group_id;
        let telegramGroupId = chat_id;
        if (chat_id) {
            const groupRes = await pool.query('SELECT id FROM telegram_groups WHERE telegram_group_id = $1', [chat_id]);
            if (groupRes.rows.length > 0) {
                groupId = groupRes.rows[0].id;
            }
        } else {
            const groupRes = await pool.query('SELECT telegram_group_id FROM telegram_groups WHERE id = $1', [groupId]);
            if (groupRes.rows.length > 0) {
                telegramGroupId = groupRes.rows[0].telegram_group_id;
            }
        }

        // 3. Process proof image
        let proofUrl = null;
        if (proof_image) {
            const matches = proof_image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const fileType = matches[1];
                const base64Data = matches[2];
                const buffer = Buffer.from(base64Data, 'base64');
                const ext = fileType.split('/')[1] || 'png';

                const filename = `urgent_proof_${telegram_id}_${Date.now()}.${ext}`;
                const uploadDir = path.join(__dirname, 'public/uploads/proofs');
                const uploadPath = path.join(uploadDir, filename);

                fs.mkdirSync(uploadDir, { recursive: true });
                fs.writeFileSync(uploadPath, buffer);

                proofUrl = `/mini-app/uploads/proofs/${filename}`;
            }
        }

        // 3.5. Cancel any existing requests for the same date (Auto-Overwrite)
        await pool.query(
            `UPDATE tk_leave_requests 
             SET status = 'CANCELLED' 
             WHERE user_id = $1 AND date = $2 AND status IN ('PENDING', 'APPROVED', 'REJECTED')`,
            [user.id, date]
        );

        // 4. Save request into database
        const insertRes = await pool.query(
            `INSERT INTO tk_leave_requests (group_id, user_id, request_type, late_minutes, date, reason, proof_url, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
             RETURNING id`,
            [groupId, user.id, request_type, late_minutes, date, reason, proofUrl]
        );
        const requestId = insertRes.rows[0].id;

        // 5. Send message to the group for approval
        if (telegramGroupId) {
            let requestTypeName = 'Nghỉ cả ngày 🟥';
            if (request_type === 'HALF_DAY_AM') requestTypeName = 'Nghỉ nửa ngày (Sáng) 🌅';
            if (request_type === 'HALF_DAY_PM') requestTypeName = 'Nghỉ nửa ngày (Chiều) 🌇';
            if (request_type === 'LATE') requestTypeName = `Xin đi muộn (${late_minutes} phút) 🟩`;

            const displayDate = moment(date).format('DD/MM/YYYY');
            const miniAppUrl = process.env.MINI_APP_URL || 'https://YOUR_TUNNEL.trycloudflare.com';

            let msg = `🚨 <b>YÊU CẦU DUYỆT NGHỈ ĐỘT XUẤT / ĐI MUỘN</b>\n\n` +
                `👤 <b>Nhân viên:</b> ${user.full_name}\n` +
                `💼 <b>Vị trí:</b> ${user.role}\n` +
                `📅 <b>Ngày xin phép:</b> ${displayDate}\n` +
                `📝 <b>Loại yêu cầu:</b> ${requestTypeName}\n` +
                `💬 <b>Lý do:</b> ${reason}\n`;

            if (proofUrl) {
                msg += `📸 <b>Minh chứng:</b> <a href="${miniAppUrl}${proofUrl}">Xem ảnh đính kèm</a>\n`;
            } else {
                msg += `📸 <b>Minh chứng:</b> Không có\n`;
            }

            msg += `\n------------------------------------------\n` +
                `<i>Vui lòng Quản lý (Admin) bấm chọn nút dưới đây để phê duyệt:</i>`;

            console.log(`[DEBUG API XIN NGHỈ] Đang gửi tin nhắn cho group ${telegramGroupId}`);
            await sendMessageToRoleGroup(bot, telegramGroupId, 'timekeep', msg, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'Duyệt ✅', callback_data: `approve_leave_${requestId}` },
                            { text: 'Từ chối ❌', callback_data: `reject_leave_${requestId}` }
                        ]
                    ]
                }
            }, 'leave_request_notice');
            console.log(`[DEBUG API XIN NGHỈ] Đã gửi thành công.`);
        }

        res.json({ success: true, message: 'Gửi yêu cầu thành công, đang chờ Quản lý duyệt!' });

    } catch (error) {
        console.error('[Save Leave Request Error]:', error);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message, error: error });
    }
});

// ==========================================
// 3.2. API ĐIỂM DANH CHECK-IN VIDEO
// ==========================================
botApp.post('/api/timekeep/checkin/save', uploadCheckin.single('video_file'), async (req, res) => {
    try {
        const { chat_id, video_base64, mime_type } = req.body;
        const telegram_id = req.verifiedTelegramId || req.body.telegram_id;
        console.log(`[DEBUG API CHECK-IN] Đã nhận request từ Telegram ID: ${telegram_id}`);

        if (!telegram_id) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin Telegram ID!' });
        }

        // 1. Get user details
        const employeeRes = await pool.query('SELECT * FROM employees WHERE telegram_id = $1 LIMIT 1', [telegram_id]);
        if (employeeRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Nhân sự chưa đăng ký tài khoản! Vui lòng đăng ký trước.' });
        }
        const user = employeeRes.rows[0];

        const isAdmin = (process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(String(telegram_id))) || user.role === 'admin';

        if (chat_id) {
            const groupRes = await pool.query('SELECT * FROM telegram_groups WHERE telegram_group_id = $1 LIMIT 1', [chat_id]);
            if (groupRes.rows.length > 0) {
                const groupRecord = groupRes.rows[0];
                if (!isAdmin && user.group_id !== groupRecord.id) {
                    return res.status(404).json({ success: false, message: 'Nhân sự chưa đăng ký tài khoản trong nhóm này!' });
                }
            } else if (!isAdmin) {
                return res.status(404).json({ success: false, message: 'Nhóm Telegram này chưa được đăng ký trong hệ thống!' });
            }
        }

        // 2. Identify group
        let groupId = user.group_id;
        let telegramGroupId = chat_id;
        if (chat_id) {
            const groupRes = await pool.query('SELECT id FROM telegram_groups WHERE telegram_group_id = $1', [chat_id]);
            if (groupRes.rows.length > 0) {
                groupId = groupRes.rows[0].id;
            }
        } else {
            const groupRes = await pool.query('SELECT telegram_group_id FROM telegram_groups WHERE id = $1', [groupId]);
            if (groupRes.rows.length > 0) {
                telegramGroupId = groupRes.rows[0].telegram_group_id;
            }
        }

        // 3. Process video
        let videoUrl = null;
        let originalUploadPath = null;
        let finalMp4Path = null;
        let isMp4 = false;

        if (req.file) {
            // Direct binary stream file upload via Multer (Fast & efficient)
            originalUploadPath = req.file.path;
            const filename = req.file.filename;
            videoUrl = `/mini-app/uploads/checkins/${filename}`;
            const ext = path.extname(filename).toLowerCase();
            isMp4 = ['.mp4', '.mov', '.m4v'].includes(ext);
            finalMp4Path = isMp4 ? originalUploadPath : originalUploadPath.replace(ext, '.mp4');
            console.log(`[DEBUG API CHECK-IN] File binary upload thành công: ${filename} (${(req.file.size / (1024 * 1024)).toFixed(2)} MB)`);
        } else if (video_base64 && video_base64.includes(';base64,')) {
            // Fallback Base64 string decode
            const parts = video_base64.split(';base64,');
            const base64Data = parts[1];
            const buffer = Buffer.from(base64Data, 'base64');
            let ext = 'webm';
            if (mime_type) {
                const mimeLower = mime_type.toLowerCase();
                if (mimeLower.includes('mp4') || mimeLower.includes('quicktime') || mimeLower.includes('mov') || mimeLower.includes('m4v')) {
                    ext = 'mp4';
                    isMp4 = true;
                } else if (mimeLower.includes('3gp')) {
                    ext = '3gp';
                } else if (mimeLower.includes('avi')) {
                    ext = 'avi';
                } else if (mimeLower.includes('webm')) {
                    ext = 'webm';
                }
            }

            const filename = `checkin_${telegram_id}_${Date.now()}.${ext}`;
            const uploadDir = path.join(__dirname, 'public/uploads/checkins');
            originalUploadPath = path.join(uploadDir, filename);

            fs.mkdirSync(uploadDir, { recursive: true });
            fs.writeFileSync(originalUploadPath, buffer);

            videoUrl = `/mini-app/uploads/checkins/${filename}`;
            finalMp4Path = isMp4 ? originalUploadPath : originalUploadPath.replace('.webm', '.mp4');
        } else {
            return res.status(400).json({ success: false, message: 'Thiếu dữ liệu video tải lên!' });
        }

        const currentDate = moment().utcOffset(7).format('YYYY-MM-DD');
        const checkInTime = moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss');
        await pool.query(
            `INSERT INTO tk_check_ins (group_id, user_id, date, check_in_time, video_file_id, status)
                 VALUES ($1, $2, $3, $4, $5, 'APPROVED')`,
            [groupId, user.id, currentDate, checkInTime, videoUrl]
        );
        syncAllTimekeepSheets().catch(e => console.error('Sheet sync error:', e));

        // 5. Trả về kết quả ngay lập tức để WebApp đóng nhanh chóng
        res.json({ success: true, message: 'Điểm danh thành công!' });

        // 6. Xử lý Convert và Gửi tin nhắn ngầm (Background)
        if (telegramGroupId && originalUploadPath) {
            const timestampStr = moment().format('HH:mm - DD/MM/YYYY');
            let msg = `📸 <b>BÁO CÁO ĐIỂM DANH</b>\n\n` +
                `👤 <b>Nhân viên:</b> ${user.full_name}\n` +
                `💼 <b>Vị trí:</b> ${user.role}\n` +
                `⏰ <b>Thời gian:</b> ${timestampStr}`;

            try {
                // Nếu không phải mp4 (thường là webm từ Android/Chrome), convert qua mp4
                if (!isMp4) {
                    console.log(`[DEBUG API CHECK-IN] Đang convert video sang MP4...`);
                    await new Promise((resolve, reject) => {
                        exec(`ffmpeg -y -i "${originalUploadPath}" -c:v libx264 -preset fast -crf 28 "${finalMp4Path}"`, (error) => {
                            if (error) {
                                console.error('[FFmpeg Error]:', error);
                                reject(error);
                            } else {
                                resolve();
                            }
                        });
                    });
                    console.log(`[DEBUG API CHECK-IN] Convert MP4 thành công!`);
                }

                console.log(`[DEBUG API CHECK-IN] Đang gửi video MP4 cho group ${telegramGroupId}`);
                await sendVideoToRoleGroup(bot, telegramGroupId, 'timekeep', { source: finalMp4Path }, {
                    caption: msg,
                    parse_mode: 'HTML'
                }, 'checkin_video');
                console.log(`[DEBUG API CHECK-IN] Hoàn tất tiến trình gửi video.`);

            } catch (err) {
                console.error('[Send Checkin Video Error]:', err);
            }
        }

    } catch (error) {
        console.error('[Save Checkin Error]:', error);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message });
    }
});


// API endpoint to update group_settings (used by Admin UI)
botApp.put('/api/tk_group_settings/:telegram_group_id', async (req, res) => {
    try {
        const { telegram_group_id } = req.params;
        const {
            penalty_under_15,
            penalty_under_90,
            penalty_over_90,
            shift_1_time,
            shift_2_time,
            auto_reminder_enabled = true,
            bot_role,
            schedule_registration_open,
            remind_time_1 = '17:00:00',
            photo_deadline_minutes = 60,
            penalty_missing_kpi = 100000,
            penalty_per_photo = 20000,
            penalty_missing_report = 100000,
            kpi_sheet_id,
            customer_sheet_id,
            customer_drive_folder_id
        } = req.body;

        function extractSheetId(input) {
            if (!input) return null;
            const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (match) return match[1];
            return input.trim();
        }

        const cleanKpiSheetId = extractSheetId(kpi_sheet_id);
        const cleanCustomerSheetId = extractSheetId(customer_sheet_id);

        // Cập nhật hoặc tạo mới nhóm và gán bot_role
        await pool.query(
            `INSERT INTO telegram_groups (telegram_group_id, group_name, bot_role, schedule_registration_open, kpi_sheet_id, customer_sheet_id, customer_drive_folder_id) 
             VALUES ($1, $2, $3, COALESCE($4, true), $5, $6, $7)
             ON CONFLICT (telegram_group_id) DO UPDATE SET 
             bot_role = EXCLUDED.bot_role, 
             schedule_registration_open = COALESCE($4, telegram_groups.schedule_registration_open),
             kpi_sheet_id = COALESCE(EXCLUDED.kpi_sheet_id, telegram_groups.kpi_sheet_id),
             customer_sheet_id = COALESCE(EXCLUDED.customer_sheet_id, telegram_groups.customer_sheet_id),
             customer_drive_folder_id = COALESCE(EXCLUDED.customer_drive_folder_id, telegram_groups.customer_drive_folder_id)`,
            [telegram_group_id, `Group ${telegram_group_id}`, bot_role || null, schedule_registration_open, cleanKpiSheetId, cleanCustomerSheetId, customer_drive_folder_id || null]
        );

        const checkRes = await pool.query(
            'SELECT id FROM group_settings WHERE telegram_group_id = $1',
            [telegram_group_id]
        );

        if (checkRes.rows.length > 0) {
            await pool.query(
                `UPDATE group_settings SET
              penalty_under_15 = $1,
              penalty_under_90 = $2,
              penalty_over_90 = $3,
              shift_1_time = $4,
              shift_2_time = $5,
              auto_reminder_enabled = $6
           WHERE telegram_group_id = $7`,
                [
                    penalty_under_15,
                    penalty_under_90,
                    penalty_over_90,
                    shift_1_time,
                    shift_2_time,
                    auto_reminder_enabled,
                    telegram_group_id
                ]
            );
        } else {
            await pool.query(
                `INSERT INTO group_settings
            (telegram_group_id, remind_time_1, auto_reminder_enabled,
             photo_deadline_minutes, penalty_missing_kpi, penalty_per_photo,
             penalty_missing_report, shift_1_time, shift_2_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [
                    telegram_group_id,
                    remind_time_1,
                    auto_reminder_enabled,
                    photo_deadline_minutes,
                    penalty_missing_kpi,
                    penalty_per_photo,
                    penalty_missing_report,
                    shift_1_time,
                    shift_2_time
                ]
            );
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[group_settings API] Error:', error);
        res.status(500).json({ error: error.message });
    }
});


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
                    `👋 Xin chào các thành viên nhóm <b>${groupName}</b>!\n\n` +
                    `⚠️ Nhóm chưa được phân quyền. Vui lòng liên hệ Admin để set quyền cho Bot trong nhóm này.`,
                    { parse_mode: 'HTML' }
                );
            } else if (botRole === 'timekeep') {
                await ctx.reply(
                    `👋 Xin chào các thành viên nhóm <b>${groupName}</b>!\n\n` +
                    `Vui lòng chọn chức năng chấm công:`,
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

                await ctx.reply(
                    `👋 Xin chào các thành viên nhóm <b>${groupName}</b>!\n\n` +
                    `Vui lòng chọn chức năng quản lý kho:`,
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
                                ]
                            ]
                        }
                    }
                );
            } else if (botRole === 'report') {
                await ctx.reply(
                    `👋 Xin chào các thành viên nhóm <b>${groupName}</b>!\n\n` +
                    `Vui lòng chọn chức năng báo cáo:`,
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
                    `👋 Xin chào các thành viên nhóm <b>${groupName}</b>!\n\n` +
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
                    `👋 Xin chào các thành viên nhóm <b>${groupName}</b>!\n\n` +
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

// ==========================================
// 5. PHÊ DUYỆT YÊU CẦU XIN NGHỈ / ĐI MUỘN QUA BUTTON
// ==========================================
bot.action(/^(approve|reject)_leave_(.+)$/, async (ctx) => {
    if (!(await requireGroupRole(ctx, 'timekeep'))) return;
    try {
        const action = ctx.match[1]; // 'approve' or 'reject'
        const requestId = ctx.match[2];
        const clickerId = ctx.from.id.toString();

        // 1. Verify clicker is Admin or Manager
        const isAdmin = process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(clickerId);
        const managerCheckRes = await pool.query("SELECT 1 FROM employees WHERE telegram_id = $1 AND role IN ('Quản lý', 'Quản lý kho') LIMIT 1", [clickerId]);
        const isManager = managerCheckRes.rows.length > 0;

        if (!isAdmin && !isManager) {
            return ctx.answerCbQuery('⚠️ Bạn không có quyền phê duyệt yêu cầu này!', { show_alert: true });
        }

        // 2. Fetch leave request details
        const requestRes = await pool.query(
            `SELECT r.*, u.full_name, u.role, u.telegram_id as user_telegram_id, g.telegram_group_id 
             FROM tk_leave_requests r 
             JOIN employees u ON r.user_id = u.id 
             JOIN telegram_groups g ON r.group_id = g.id 
             WHERE r.id = $1`,
            [requestId]
        );

        if (requestRes.rows.length === 0) {
            return ctx.answerCbQuery('Yêu cầu không tồn tại trong hệ thống!', { show_alert: true });
        }

        const request = requestRes.rows[0];

        if (request.status !== 'PENDING') {
            return ctx.answerCbQuery(`Yêu cầu này đã được xử lý trước đó (Trạng thái: ${request.status})!`, { show_alert: true });
        }

        // 3. Find Admin full name
        const adminRes = await pool.query('SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1', [clickerId]);
        const adminName = adminRes.rows.length > 0 ? adminRes.rows[0].full_name : (ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name);

        const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

        // 4. Update request status in DB
        await pool.query(
            'UPDATE tk_leave_requests SET status = $1, approved_by = $2 WHERE id = $3',
            [newStatus, adminName, requestId]
        );

        let penaltyButtons = [];

        // 5. Special logic if APPROVED for FULL/HALF days or SCHEDULE_CHANGE
        if (newStatus === 'APPROVED' && ['FULL_DAY', 'HALF_DAY_AM', 'HALF_DAY_PM'].includes(request.request_type)) {
            const formattedDate = moment(request.date).format('YYYY-MM-DD');
            let newShift = 'OFF';
            if (request.request_type === 'HALF_DAY_AM') newShift = 'HALF_DAY_PM_WORK';
            if (request.request_type === 'HALF_DAY_PM') newShift = 'CA_SANG';
            
            await pool.query(
                `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked)
                 VALUES ($1, $2, $3, $4, true)
                 ON CONFLICT (user_id, date) 
                 DO UPDATE SET shift_type = $4, is_locked = true`,
                [request.group_id, request.user_id, formattedDate, newShift]
            );

            const leavePenalties = await applyApprovedLeavePenalties({
                pool,
                request: { ...request, date: formattedDate }
            });
            if (leavePenalties.consecutivePenaltyId) {
                penaltyButtons.push([{
                    text: '✅ Miễn phạt nghỉ liên tiếp',
                    callback_data: `excuse_penalty_${leavePenalties.consecutivePenaltyId}`
                }]);
            }
            syncAllTimekeepSheets().catch(e => console.error('Sync sheet error:', e));
        } else if (newStatus === 'APPROVED' && request.request_type === 'SCHEDULE_CHANGE') {
            try {
                const daysToSave = JSON.parse(request.reason);
                for (const day of daysToSave) {
                    const dayStr = moment(day.date).format('YYYY-MM-DD');
                    await pool.query(
                        `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked)
                         VALUES ($1, $2, $3, $4, true)
                         ON CONFLICT (user_id, date) 
                         DO UPDATE SET shift_type = EXCLUDED.shift_type, is_locked = true`,
                        [request.group_id, request.user_id, dayStr, day.shift_type]
                    );
                }
                syncAllTimekeepSheets().catch(e => console.error('Sync sheet error:', e));
            } catch (jsonErr) {
                console.error('[Approve Schedule Change Error] Failed to parse days:', jsonErr);
            }
        }

        // 6. Edit group message to show updated status
        let updatedMsg = '';
        let requestTypeName = '';
        if (request.request_type === 'SCHEDULE_CHANGE') {
            requestTypeName = 'Đăng ký lịch tuần (>= 2 ngày nghỉ) 📅';
            const startOfWeekFormatted = moment(request.date).format('DD/MM/YYYY');
            const endOfWeekFormatted = moment(request.date).endOf('isoWeek').format('DD/MM/YYYY');
            
            let offDaysDates = '';
            try {
                const daysToSave = JSON.parse(request.reason);
                offDaysDates = daysToSave.filter(d => d.shift_type === 'OFF').map(d => moment(d.date).format('DD/MM')).join(', ');
            } catch (err) {}

            let statusText = newStatus === 'APPROVED' ? `✅ <b>ĐÃ DUYỆT ĐĂNG KÝ LỊCH TUẦN</b>` : `❌ <b>ĐÃ TỪ CHỐI ĐĂNG KÝ LỊCH TUẦN</b>`;
            let colorSymbol = newStatus === 'APPROVED' ? '🟢' : '🔴';

            updatedMsg = `${statusText}\n\n` +
                `👤 <b>Nhân viên:</b> ${request.full_name}\n` +
                `💼 <b>Vị trí:</b> ${request.role}\n` +
                `📅 <b>Tuần đăng ký:</b> ${startOfWeekFormatted} - ${endOfWeekFormatted}\n` +
                `🌴 <b>Các ngày xin nghỉ:</b> ${offDaysDates}\n` +
                `🤝 <b>Trạng thái:</b> ${colorSymbol} ${newStatus === 'APPROVED' ? 'Đã duyệt' : 'Từ chối'} bởi Admin <b>${adminName}</b>`;
        } else {
            requestTypeName = request.request_type === 'FULL_DAY' ? 'Nghỉ cả ngày 🟥' :
                (request.request_type === 'HALF_DAY_AM' ? 'Nghỉ nửa ngày (Sáng) 🌅' :
                    (request.request_type === 'HALF_DAY_PM' ? 'Nghỉ nửa ngày (Chiều) 🌇' :
                        `Xin đi muộn (${request.late_minutes} phút) 🟩`));
            const displayDate = moment(request.date).format('DD/MM/YYYY');
            let statusText = newStatus === 'APPROVED' ? `✅ <b>ĐÃ DUYỆT YÊU CẦU NGHỈ</b>` : `❌ <b>ĐÃ TỪ CHỐI YÊU CẦU NGHỈ</b>`;
            let colorSymbol = newStatus === 'APPROVED' ? '🟢' : '🔴';

            updatedMsg = `${statusText}\n\n` +
                `👤 <b>Nhân viên:</b> ${request.full_name}\n` +
                `💼 <b>Vị trí:</b> ${request.role}\n` +
                `📅 <b>Ngày xin phép:</b> ${displayDate}\n` +
                `📝 <b>Loại yêu cầu:</b> ${requestTypeName}\n` +
                `💬 <b>Lý do:</b> ${request.reason}\n` +
                `🤝 <b>Trạng thái:</b> ${colorSymbol} ${newStatus === 'APPROVED' ? 'Đã duyệt' : 'Từ chối'} bởi Admin <b>${adminName}</b>`;
        }

        await ctx.editMessageText(updatedMsg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: penaltyButtons } // Remove buttons or add penalty buttons
        });

        await ctx.answerCbQuery(`Đã ${newStatus === 'APPROVED' ? 'duyệt' : 'từ chối'} yêu cầu!`);

        // 7. Notify the employee directly in private message if possible
        try {
            let notifyText = '';
            if (request.request_type === 'SCHEDULE_CHANGE') {
                const startOfWeekFormatted = moment(request.date).format('DD/MM/YYYY');
                const endOfWeekFormatted = moment(request.date).endOf('isoWeek').format('DD/MM/YYYY');
                notifyText = `🔔 <b>Kết quả duyệt đăng ký lịch tuần (${startOfWeekFormatted} - ${endOfWeekFormatted}):</b>\n\n` +
                             `📊 <b>Kết quả:</b> ${newStatus === 'APPROVED' ? 'Đã được DUYỆT ✅' : 'Bị TỪ CHỐI ❌'}\n` +
                             `👤 <b>Người duyệt:</b> Admin ${adminName}`;
            } else {
                const displayDate = moment(request.date).format('DD/MM/YYYY');
                notifyText = `🔔 <b>Kết quả duyệt đơn xin nghỉ/đi muộn ngày ${displayDate}:</b>\n\n` +
                             `📝 <b>Loại:</b> ${requestTypeName}\n` +
                             `📊 <b>Kết quả:</b> ${newStatus === 'APPROVED' ? 'Đã được DUYỆT ✅' : 'Bị TỪ CHỐI ❌'}\n` +
                             `👤 <b>Người duyệt:</b> Admin ${adminName}`;
            }
            await ctx.telegram.sendMessage(request.user_telegram_id, notifyText, { parse_mode: 'HTML' });
        } catch (e) {
            console.log(`Không thể gửi tin nhắn riêng cho user ${request.user_telegram_id} (chưa chat với bot bao giờ).`);
        }

    } catch (e) {
        console.error('Lỗi duyệt phép bot.action:', e);
        await ctx.answerCbQuery('Lỗi xử lý hệ thống!', { show_alert: true });
    }
});

bot.action(/^excuse_penalty_([0-9a-f-]{36})$/i, async (ctx) => {
    if (!(await requireGroupRole(ctx, 'timekeep'))) return;
    try {
        const penaltyId = ctx.match[1];
        const clickerId = ctx.from.id.toString();

        const isAdmin = process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(clickerId);
        const managerCheckRes = await pool.query("SELECT 1 FROM employees WHERE telegram_id = $1 AND role IN ('Quản lý', 'Quản lý kho') LIMIT 1", [clickerId]);
        const isManager = managerCheckRes.rows.length > 0;

        if (!isAdmin && !isManager) {
            return ctx.answerCbQuery('⚠️ Bạn không có quyền miễn trừ án phạt này!', { show_alert: true });
        }

        const adminRes = await pool.query('SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1', [clickerId]);
        const adminName = adminRes.rows.length > 0 ? adminRes.rows[0].full_name : (ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name);

        await pool.query(
            `UPDATE tk_penalties 
             SET amount = 0, reason = reason || ' (Đã được miễn trừ bởi ' || $1 || ')' 
             WHERE id = $2`,
            [adminName, penaltyId]
        );
        syncAllTimekeepSheets().catch(e => console.error('Sync sheet error:', e));

        let msgText = ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || '';
        msgText += `\n\n🎁 <b>Miễn trừ:</b> Án phạt nghỉ liên tiếp 2 ngày đã được miễn trừ bởi Admin <b>${adminName}</b>.`;

        await ctx.editMessageText(msgText, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }
        });

        await ctx.answerCbQuery('Đã miễn trừ án phạt thành công!', { show_alert: true });
    } catch (e) {
        console.error('Lỗi miễn trừ phạt bot.action:', e);
        await ctx.answerCbQuery('Lỗi xử lý hệ thống!', { show_alert: true });
    }
});

// ==========================================
// CRON JOB: KIỂM TRA ĐI MUỘN & TÍNH PHẠT
// Chạy mỗi 1 phút để cập nhật và thông báo chuẩn xác
// ==========================================
cron.schedule('*/1 * * * *', async () => {
    try {
        let attendanceSheetDirty = false;
        const nowVN = moment().utcOffset(7);
        const todayStr = nowVN.format('YYYY-MM-DD');
        const currentTimeStr = nowVN.format('HH:mm'); // e.g. "07:57"
        const currentMonth = nowVN.month() + 1; // 1-12
        const currentYear = nowVN.year();

        // --- PHẦN 1: TÍNH TOÁN VÀ GỬI THÔNG BÁO NHẮC NHỞ & BÁO MUỘN THEO CA ---
        // Lấy thông tin cấu hình ca của các nhóm
        const groupsSettingsRes = await pool.query(`
            SELECT g.id AS group_uuid, g.telegram_group_id, g.group_name,
                   COALESCE(gs.shift_1_time, '08:00:00') AS shift_1_time,
                   COALESCE(gs.shift_2_time, '13:30:00') AS shift_2_time
            FROM telegram_groups g
            LEFT JOIN group_settings gs ON g.telegram_group_id = gs.telegram_group_id
            WHERE g.bot_role = 'timekeep'
              AND g.is_active = true
              AND COALESCE(g.is_deleted, false) = false
        `);

        for (const row of groupsSettingsRes.rows) {
            const { group_uuid, telegram_group_id, group_name, shift_1_time, shift_2_time } = row;

            // Xử lý cho Ca sớm (Shift 1) và Ca muộn (Shift 2)
            const shifts = [
                {
                    num: 1,
                    label: 'Ca sớm',
                    startStr: shift_1_time,
                    types: ['CA_1', 'CA_SANG', 'FULL_DAY']
                },
                {
                    num: 2,
                    label: 'Ca muộn',
                    startStr: shift_2_time,
                    types: ['CA_2', 'CA_CHIEU', 'FULL_DAY']
                },
                {
                    num: 3,
                    label: 'Ca làm bù chiều',
                    startStr: '13:30:00',
                    types: ['HALF_DAY_PM_WORK']
                }
            ];

            for (const shift of shifts) {
                // Parse giờ bắt đầu ca
                const shiftStartMoment = moment(shift.startStr, 'HH:mm:ss');
                const remindMinutes = 5;
                const remindTime = shiftStartMoment.clone().subtract(remindMinutes, 'minutes').format('HH:mm');
                const lateTime = shiftStartMoment.clone().add(1, 'minutes').format('HH:mm');

                // A. Nhắc nhở trước ca làm (Bỏ qua nhân sự được miễn check-in hoặc bị vô hiệu hóa)
                if (currentTimeStr === remindTime) {
                    const uncheckedRes = await pool.query(`
                        SELECT u.id AS user_id, u.full_name
                        FROM employees u
                        JOIN tk_schedules s ON u.id = s.user_id AND s.date = $2
                        LEFT JOIN employee_group_memberships gm
                          ON gm.employee_id = u.id
                         AND gm.telegram_group_id = $4
                        WHERE u.group_id = $1
                          AND COALESCE(u.is_exempt_checkin, false) = false
                          AND COALESCE(u.is_active, true) = true
                          AND COALESCE(gm.status, 'ACTIVE') = 'ACTIVE'
                          AND s.shift_type = ANY($3)
                           AND NOT EXISTS (
                               SELECT 1 FROM tk_check_ins c
                               WHERE c.user_id = u.id AND c.date = $2
                           )
                           AND NOT EXISTS (
                               SELECT 1 FROM tk_attendance_daily_status ds
                               WHERE ds.group_id = $1
                                 AND ds.user_id = u.id
                                 AND ds.date = $2
                                 AND (ds.reminder_sent_at IS NOT NULL OR ds.finalized_at IS NOT NULL)
                           )
                        ORDER BY u.full_name ASC
                    `, [group_uuid, todayStr, shift.types, String(telegram_group_id)]);

                    if (uncheckedRes.rows.length > 0) {
                        const names = uncheckedRes.rows.map(r => `👤 ${r.full_name}`).join('\n');
                        const msg = `🔔 <b>NHẮC NHỞ ĐIỂM DANH (${shift.label})</b> 🔔\n\n` +
                            `⏰ Chỉ còn ${remindMinutes} phút nữa là đến giờ vào làm (<b>${shift.startStr.substring(0, 5)}</b>).\n` +
                            `Các nhân sự sau chưa điểm danh, vui lòng check-in ngay nhé:\n\n${names}`;
                        try {
                            const sent = await sendMessageToRoleGroup(bot, telegram_group_id, 'timekeep', msg, { parse_mode: 'HTML' }, `checkin_reminder_${remindMinutes}min`);
                            if (sent) {
                                for (const employee of uncheckedRes.rows) {
                                    await pool.query(`
                                        INSERT INTO tk_attendance_daily_status
                                            (group_id, user_id, date, reminder_sent_at, updated_at)
                                        VALUES ($1, $2, $3, NOW(), NOW())
                                        ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                                            reminder_sent_at = COALESCE(tk_attendance_daily_status.reminder_sent_at, NOW()),
                                            updated_at = NOW()
                                    `, [group_uuid, employee.user_id, todayStr]);
                                }
                            }
                        } catch (err) {
                            console.error(`Lỗi gửi nhắc nhở checkin ca ${shift.num} cho nhóm ${group_name}:`, err.message);
                        }
                    }
                }

                // B. Báo cáo đi muộn sau ca 1 phút (Bỏ qua nhân sự được miễn check-in hoặc bị vô hiệu hóa)
                if (currentTimeStr === lateTime) {
                    const lateRes = await pool.query(`
                        SELECT u.id AS user_id, u.full_name
                        FROM employees u
                        JOIN tk_schedules s ON u.id = s.user_id AND s.date = $2
                        LEFT JOIN employee_group_memberships gm
                          ON gm.employee_id = u.id
                         AND gm.telegram_group_id = $4
                        WHERE u.group_id = $1
                          AND COALESCE(u.is_exempt_checkin, false) = false
                          AND COALESCE(u.is_active, true) = true
                          AND COALESCE(gm.status, 'ACTIVE') = 'ACTIVE'
                          AND s.shift_type = ANY($3)
                           AND NOT EXISTS (
                               SELECT 1 FROM tk_check_ins c
                               WHERE c.user_id = u.id AND c.date = $2
                           )
                           AND NOT EXISTS (
                               SELECT 1 FROM tk_attendance_daily_status ds
                               WHERE ds.group_id = $1
                                 AND ds.user_id = u.id
                                 AND ds.date = $2
                                 AND (ds.late_warning_sent_at IS NOT NULL OR ds.finalized_at IS NOT NULL)
                           )
                        ORDER BY u.full_name ASC
                    `, [group_uuid, todayStr, shift.types, String(telegram_group_id)]);

                    if (lateRes.rows.length > 0) {
                        const names = lateRes.rows.map(r => `❌ ${r.full_name}`).join('\n');
                        const msg = `⏰ <b>THÔNG BÁO NHÂN SỰ ĐI MUỘN (${shift.label})</b> ⏰\n\n` +
                            `🚫 Đã quá giờ vào làm 1 phút (<b>${shift.startStr.substring(0, 5)}</b>).\n` +
                            `Các nhân sự sau chưa điểm danh (ghi nhận đi muộn):\n\n${names}`;
                        try {
                            const sent = await sendMessageToRoleGroup(bot, telegram_group_id, 'timekeep', msg, { parse_mode: 'HTML' }, 'checkin_late_warning_1min');
                            if (sent) {
                                for (const employee of lateRes.rows) {
                                    await pool.query(`
                                        INSERT INTO tk_attendance_daily_status
                                            (group_id, user_id, date, result, late_warning_sent_at, updated_at)
                                        VALUES ($1, $2, $3, 'LATE_NOTIFIED', NOW(), NOW())
                                        ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                                            result = CASE
                                                WHEN tk_attendance_daily_status.finalized_at IS NULL THEN 'LATE_NOTIFIED'
                                                ELSE tk_attendance_daily_status.result
                                            END,
                                            late_warning_sent_at = COALESCE(tk_attendance_daily_status.late_warning_sent_at, NOW()),
                                            updated_at = NOW()
                                    `, [group_uuid, employee.user_id, todayStr]);
                                    attendanceSheetDirty = true;
                                }
                            }
                        } catch (err) {
                            console.error(`Lỗi gửi báo muộn ca ${shift.num} cho nhóm ${group_name}:`, err.message);
                        }
                    }
                }
            }
        }

        // --- PHẦN 2: TÍNH PHẠT ĐI MUỘN KHI NHÂN VIÊN GỬI CHECK-IN (Bỏ qua nhân sự miễn checkin hoặc vô hiệu hóa) ---
        // Lấy checkin đầu tiên của mỗi user trong ngày hôm nay kèm theo ca làm việc và cấu hình giờ bắt đầu ca
        const checkInsRes = await pool.query(`
            SELECT DISTINCT ON (c.user_id) 
                   c.id, c.group_id, c.user_id, c.date::text, c.check_in_time, 
                   u.full_name, g.telegram_group_id,
                   s.shift_type, gs.shift_1_time, gs.shift_2_time
            FROM tk_check_ins c
            JOIN employees u ON c.user_id = u.id
            JOIN telegram_groups g ON c.group_id = g.id
            LEFT JOIN tk_schedules s ON c.user_id = s.user_id AND c.date = s.date
            LEFT JOIN group_settings gs ON g.telegram_group_id = gs.telegram_group_id
            LEFT JOIN employee_group_memberships gm
              ON gm.employee_id = u.id
             AND gm.telegram_group_id = g.telegram_group_id
            WHERE c.date = $1
              AND COALESCE(u.is_exempt_checkin, false) = false
              AND COALESCE(u.is_active, true) = true
              AND COALESCE(gm.status, 'ACTIVE') = 'ACTIVE'
              AND NOT EXISTS (
                  SELECT 1 FROM tk_attendance_daily_status ds
                  WHERE ds.group_id = c.group_id
                    AND ds.user_id = c.user_id
                    AND ds.date = c.date
                    AND ds.finalized_at IS NOT NULL
              )
            ORDER BY c.user_id, c.check_in_time ASC
        `, [todayStr]);

        for (const c of checkInsRes.rows) {
            // Chỉ tính phạt cho Ca 1 (CA_SANG), Ca 2 (CA_CHIEU), Cả ngày (FULL_DAY) hoặc Ca bù chiều (HALF_DAY_PM_WORK)
            if (!['CA_1', 'CA_2', 'CA_SANG', 'CA_CHIEU', 'FULL_DAY', 'HALF_DAY_PM_WORK'].includes(c.shift_type)) {
                continue;
            }

            let shiftStart = '08:00:00';
            if (c.shift_type === 'CA_1' || c.shift_type === 'CA_SANG' || c.shift_type === 'FULL_DAY') {
                shiftStart = c.shift_1_time || '08:00:00';
            } else if (c.shift_type === 'CA_2' || c.shift_type === 'CA_CHIEU') {
                shiftStart = c.shift_2_time || '13:30:00';
            } else if (c.shift_type === 'HALF_DAY_PM_WORK') {
                shiftStart = '13:30:00';
            }

            // Định dạng check-in time và giờ bắt đầu ca thành moment để so sánh
            const checkInTimeStr = moment(c.check_in_time).utcOffset(7).format('HH:mm:ss');
            const checkInMoment = moment(checkInTimeStr, 'HH:mm:ss');
            const shiftStartMoment = moment(shiftStart, 'HH:mm:ss');

            if (checkInMoment.isAfter(shiftStartMoment)) {
                const lateMinutes = checkInMoment.diff(shiftStartMoment, 'minutes');
                if (lateMinutes <= 0) {
                    await pool.query(`
                        INSERT INTO tk_attendance_daily_status
                            (group_id, user_id, date, result, finalized_at, updated_at)
                        VALUES ($1, $2, $3, 'ON_TIME', NOW(), NOW())
                        ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                            result = 'ON_TIME', finalized_at = NOW(), updated_at = NOW()
                    `, [c.group_id, c.user_id, c.date]);
                    continue;
                }

                // Kiểm tra xem đã có bản ghi phạt LATE cho user vào ngày này chưa
                const penaltyExist = await pool.query(
                    `SELECT id FROM tk_penalties 
                     WHERE user_id = $1 AND date = $2 AND violation_type = 'LATE'`,
                    [c.user_id, c.date]
                );

                if (penaltyExist.rows.length === 0) {
                    // Đếm số lần đi muộn trong tháng này (không tính bản ghi sắp thêm)
                    const prevCountRes = await pool.query(
                        `SELECT COUNT(*) as count 
                         FROM tk_penalties 
                         WHERE user_id = $1 
                           AND violation_type = 'LATE' 
                           AND EXTRACT(MONTH FROM date) = $2 
                           AND EXTRACT(YEAR FROM date) = $3`,
                        [c.user_id, currentMonth, currentYear]
                    );

                    const prevCount = parseInt(prevCountRes.rows[0].count) || 0;
                    let amount = 0;
                    let reason = '';

                    if (prevCount === 0) {
                        amount = 0;
                        reason = `Đi muộn lần 1 trong tháng ${currentMonth}/${currentYear} (Miễn phạt)`;
                    } else {
                        if (lateMinutes < 15) {
                            amount = 20000;
                            reason = `Đi muộn lần ${prevCount + 1} trong tháng (${lateMinutes} phút - dưới 15p)`;
                        } else if (lateMinutes < 90) {
                            amount = 20000 + (lateMinutes - 15) * 2000;
                            reason = `Đi muộn lần ${prevCount + 1} trong tháng (${lateMinutes} phút - phạt 2k/phút từ phút 16)`;
                        } else {
                            amount = 200000;
                            reason = `Đi muộn lần ${prevCount + 1} trong tháng (${lateMinutes} phút - từ 90p trở lên)`;
                        }
                    }

                    // Giảm 50% nếu có xin phép đi muộn (request_type = 'LATE') cho ngày hôm đó
                    const leaveReqRes = await pool.query(
                        `SELECT id FROM tk_leave_requests 
                         WHERE user_id = $1 AND date = $2 AND request_type = 'LATE'
                         LIMIT 1`,
                        [c.user_id, c.date]
                    );

                    if (leaveReqRes.rows.length > 0 && amount > 0) {
                        amount = amount / 2;
                        reason += ` (Đã giảm 50% do có đơn báo trước)`;
                    } else if (amount > 0 && EXTRA_UNANNOUNCED_LATE_PENALTY_ENABLED) {
                        amount += 100000;
                        reason += ` (Phạt thêm 100k do không có đơn báo trước)`;
                    }

                    // Thêm bản ghi phạt vào tk_penalties
                    await pool.query(
                        `INSERT INTO tk_penalties (group_id, user_id, date, violation_type, late_minutes, amount, reason, is_paid)
                         VALUES ($1, $2, $3, 'LATE', $4, $5, $6, false)`,
                        [c.group_id, c.user_id, c.date, lateMinutes, amount, reason]
                    );

                    if (c.telegram_group_id) {
                        const penaltyText = amount > 0 ? `💸 Bị phạt: <b>${amount.toLocaleString('vi-VN')} VNĐ</b>` : `✅ Miễn phạt (Đi muộn lần đầu)`;
                        const msg = `⏰ <b>THÔNG BÁO GHI NHẬN ĐI MUỘN</b> ⏰\n\n` +
                            `👤 <b>Nhân sự:</b> ${c.full_name}\n` +
                            `📅 <b>Ngày:</b> ${moment(c.date).format('DD/MM/YYYY')}\n` +
                            `🔴 <b>Số phút đi muộn:</b> ${lateMinutes} phút\n` +
                            `💰 <b>Trạng thái phạt:</b> ${penaltyText}\n` +
                            `📝 <b>Chi tiết:</b> ${reason}`;
                        try { await sendMessageToRoleGroup(bot, c.telegram_group_id, 'timekeep', msg, { parse_mode: 'HTML' }, 'late_penalty_notice'); } catch (err) { console.error(err); }
                    }
                }
                await pool.query(`
                    INSERT INTO tk_attendance_daily_status
                        (group_id, user_id, date, result, finalized_at, updated_at)
                    VALUES ($1, $2, $3, 'LATE', NOW(), NOW())
                    ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                        result = 'LATE', finalized_at = NOW(), updated_at = NOW()
                    `, [c.group_id, c.user_id, c.date]);
                attendanceSheetDirty = true;
            } else {
                await pool.query(`
                    INSERT INTO tk_attendance_daily_status
                        (group_id, user_id, date, result, finalized_at, updated_at)
                    VALUES ($1, $2, $3, 'ON_TIME', NOW(), NOW())
                    ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                        result = 'ON_TIME', finalized_at = NOW(), updated_at = NOW()
                `, [c.group_id, c.user_id, c.date]);
                attendanceSheetDirty = true;
            }
        }

        // --- PHẦN 3: 14:00 CHỐT NGƯỜI KHÔNG CHECK-IN ---
        // Chỉ xử lý ngày hiện tại. Dữ liệu lịch sử được bổ sung bằng tác vụ riêng
        // không đi qua nhánh gửi Telegram, nên sẽ không phát thông báo cũ lên nhóm.
        if (currentTimeStr >= '14:00') {
            const absences = await finalizeUnauthorizedAbsences({ pool, date: todayStr });
            if (absences.some(item => item.penaltyInserted || item.consecutivePenaltyInserted)) {
                attendanceSheetDirty = true;
            }

            const pendingRows = await getPendingAbsenceNotifications({ pool, date: todayStr });
            const notificationGroups = groupAbsenceNotifications(pendingRows);

            for (const group of notificationGroups) {
                try {
                    const sent = await sendMessageToRoleGroup(
                        bot,
                        group.telegramGroupId,
                        'timekeep',
                        buildAbsenceNotificationText(group),
                        { parse_mode: 'HTML' },
                        'checkin_absent_14h'
                    );
                    if (sent) {
                        await markAbsenceNotificationsSent({
                            pool,
                            groupId: group.groupId,
                            userIds: group.employees.map(employee => employee.userId),
                            date: todayStr
                        });
                    }
                } catch (error) {
                    console.error(`[14:00 Absence Notice] Không gửi được nhóm ${group.groupName}:`, error.message);
                }
            }
        }

        if (attendanceSheetDirty) {
            syncAllTimekeepSheets().catch(error => {
                console.error('[Late Attendance Sheet Sync]', error);
            });
        }
    } catch (error) { console.error('[Cron Error] Lỗi khi xử lý tính phạt đi muộn:', error); }
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
function getTodayVN() {
    const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
}
function getIsoWeekRangeVN() {
    const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const day = now.getUTCDay();
    const diffToMonday = (day === 0) ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return {
        start: monday.toISOString().slice(0, 10),
        end: sunday.toISOString().slice(0, 10)
    };
}

botApp.get('/api/admin/dashboard', async (req, res) => {
    try {
        const { group_id } = req.query;

        const groupsRes = await pool.query(
            `SELECT id, telegram_group_id, group_name FROM telegram_groups ORDER BY created_at ASC`
        );
        const groups = groupsRes.rows;

        const emptyStats = {
            total_scheduled_today: 0, total_checked_in_today: 0,
            total_absent_today: 0, total_not_checked_yet: 0,
            weekly_late_count: 0, weekly_on_time_count: 0,
            weekly_total_checkins: 0, weekly_punctual_rate: 0,
            weekly_penalty_total: 0
        };

        if (groups.length === 0) {
            return res.json({ groups: [], group: null, today: getTodayVN(), employees: [], stats: emptyStats });
        }

        const targetGroup = groups.find(g => g.id === group_id) || groups[0];
        const today = getTodayVN();
        const { start: weekStart, end: weekEnd } = getIsoWeekRangeVN();

        // Danh sách nhân sự + lịch + checkin + penalty hôm nay
        const employeesRes = await pool.query(`
            SELECT
                u.id AS user_id,
                u.full_name,
                u.telegram_id,
                u.role,
                s.shift_type,
                ci.check_in_time,
                ci.status AS checkin_status,
                COALESCE(p.late_minutes, 0) AS late_minutes,
                COALESCE(p.amount, 0) AS penalty_amount,
                CASE
                    WHEN s.id IS NULL THEN 'NO_SCHEDULE'
                    WHEN s.shift_type = 'OFF' THEN 'OFF'
                    WHEN ci.id IS NULL THEN 'NOT_CHECKED_IN'
                    WHEN p.late_minutes > 0 THEN 'LATE'
                    ELSE 'ON_TIME'
                END AS status
            FROM employees u
            JOIN telegram_groups tg ON u.telegram_group_id = tg.telegram_group_id
            LEFT JOIN tk_schedules s ON s.user_id = u.id AND s.date = $2
            LEFT JOIN tk_check_ins ci ON ci.user_id = u.id AND ci.date = $2
            LEFT JOIN tk_penalties p ON p.user_id = u.id AND p.date = $2 AND p.violation_type = 'LATE'
            WHERE tg.id = $1
            ORDER BY u.full_name ASC
        `, [targetGroup.id, today]);

        // Format check_in_time → HH:mm UTC+7
        const employees = employeesRes.rows.map(emp => {
            let checkInDisplay = null;
            if (emp.check_in_time) {
                const t = new Date(new Date(emp.check_in_time).getTime() + 7 * 60 * 60 * 1000);
                checkInDisplay = t.toISOString().slice(11, 16);
            }
            return { ...emp, check_in_time: checkInDisplay };
        });

        // Thống kê tuần
        const weeklyRes = await pool.query(`
            SELECT
                COUNT(*) AS total_checkins,
                SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) AS late_count,
                COALESCE(SUM(p2.amount), 0) AS penalty_total
            FROM tk_check_ins ci
            LEFT JOIN tk_penalties p ON p.user_id = ci.user_id AND p.date = ci.date AND p.violation_type = 'LATE'
            LEFT JOIN tk_penalties p2 ON p2.user_id = ci.user_id AND p2.date >= $2 AND p2.date <= $3 AND p2.violation_type = 'LATE'
            WHERE ci.group_id = $1 AND ci.date >= $2 AND ci.date <= $3
        `, [targetGroup.id, weekStart, weekEnd]);

        const ws = weeklyRes.rows[0];
        const totalCheckins = parseInt(ws.total_checkins) || 0;
        const weeklyLateCount = parseInt(ws.late_count) || 0;
        const weeklyOnTimeCount = totalCheckins - weeklyLateCount;
        const weeklyPunctualRate = totalCheckins > 0
            ? Math.round((weeklyOnTimeCount / totalCheckins) * 1000) / 10 : 0;

        const scheduledToday = employees.filter(e => e.shift_type && e.shift_type !== 'OFF').length;
        const checkedInToday = employees.filter(e => e.check_in_time !== null).length;

        res.json({
            groups,
            group: targetGroup,
            today,
            week: { start: weekStart, end: weekEnd },
            employees,
            stats: {
                total_scheduled_today: scheduledToday,
                total_checked_in_today: checkedInToday,
                total_absent_today: Math.max(0, scheduledToday - checkedInToday),
                total_not_checked_yet: employees.filter(e => e.status === 'NOT_CHECKED_IN').length,
                weekly_late_count: weeklyLateCount,
                weekly_on_time_count: weeklyOnTimeCount,
                weekly_total_checkins: totalCheckins,
                weekly_punctual_rate: weeklyPunctualRate,
                weekly_penalty_total: parseInt(ws.penalty_total) || 0
            }
        });
    } catch (error) {
        console.error('[Dashboard Error]', error);
        res.status(500).json({ error: error.message });
    }
});

botApp.get('/api/timekeep/personal-stats', async (req, res) => {
    try {
        const { chat_id } = req.query;
        const telegram_id = req.verifiedTelegramId || req.query.telegram_id;
        if (!telegram_id || !chat_id) {
            return res.status(400).json({ error: 'Thiếu telegram_id hoặc chat_id' });
        }

        // 1. Lấy thông tin nhóm
        const groupRes = await pool.query(
            'SELECT id, group_name FROM telegram_groups WHERE telegram_group_id = $1',
            [chat_id]
        );
        if (groupRes.rows.length === 0) {
            return res.status(404).json({ error: 'Không tìm thấy nhóm làm việc tương ứng' });
        }
        const group = groupRes.rows[0];

        // 2. Tìm nhân sự
        const employeeRes = await pool.query(
            'SELECT id, full_name, role, group_id FROM employees WHERE telegram_id = $1 LIMIT 1',
            [telegram_id]
        );
        if (employeeRes.rows.length === 0) {
            return res.status(404).json({ error: 'Tài khoản chưa được đăng ký trong hệ thống' });
        }
        const user = employeeRes.rows[0];

        const isAdmin = (process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(String(telegram_id))) || user.role === 'admin';

        if (!isAdmin && user.group_id !== group.id) {
            return res.status(404).json({ error: 'Tài khoản chưa được đăng ký trong nhóm này' });
        }

        // 3. Tính toán khoảng thời gian cho tuần hiện tại và tuần kế tiếp theo giờ UTC+7
        const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const day = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        const diffToMonday = (day === 0) ? -6 : 1 - day;

        const currMonday = new Date(now);
        currMonday.setUTCDate(now.getUTCDate() + diffToMonday);
        const currSunday = new Date(currMonday);
        currSunday.setUTCDate(currMonday.getUTCDate() + 6);

        const nextMonday = new Date(currMonday);
        nextMonday.setUTCDate(currMonday.getUTCDate() + 7);
        const nextSunday = new Date(nextMonday);
        nextSunday.setUTCDate(nextMonday.getUTCDate() + 6);

        const currentWeekRange = {
            start: currMonday.toISOString().slice(0, 10),
            end: currSunday.toISOString().slice(0, 10)
        };
        const nextWeekRange = {
            start: nextMonday.toISOString().slice(0, 10),
            end: nextSunday.toISOString().slice(0, 10)
        };

        // 4. Lấy lịch làm việc của cả nhóm cho cả 2 tuần
        const schedulesRes = await pool.query(`
            SELECT s.user_id, u.full_name, s.date::text, s.shift_type
            FROM tk_schedules s
            JOIN employees u ON s.user_id = u.id
            WHERE u.group_id = $1
              AND s.date >= $2
              AND s.date <= $3
            ORDER BY u.full_name ASC, s.date ASC
        `, [group.id, currentWeekRange.start, nextWeekRange.end]);

        // 5. Thống kê lỗi đi muộn và tiền phạt của chính user này trong tháng hiện tại
        const startOfMonthStr = moment().utcOffset(7).startOf('month').format('YYYY-MM-DD');
        const endOfMonthStr = moment().utcOffset(7).endOf('month').format('YYYY-MM-DD');

        const penaltiesRes = await pool.query(`
            SELECT date::text, late_minutes, amount, reason, is_paid
            FROM tk_penalties
            WHERE user_id = $1
              AND date >= $2
              AND date <= $3
              AND violation_type = 'LATE'
            ORDER BY date DESC
        `, [user.id, startOfMonthStr, endOfMonthStr]);

        const penalties = penaltiesRes.rows;
        const totalLateCount = penalties.length;
        const totalPenaltyAmount = penalties.reduce((sum, p) => sum + parseInt(p.amount), 0);

        res.json({
            user,
            group_name: group.group_name,
            current_week: currentWeekRange,
            next_week: nextWeekRange,
            schedules: schedulesRes.rows,
            personal_stats: {
                total_late_count: totalLateCount,
                total_penalty_amount: totalPenaltyAmount,
                penalties: penalties
            }
        });
    } catch (error) {
        console.error('[Personal Stats Error]', error);
        res.status(500).json({ error: error.message });
    }
});

botApp.options('/api/export/today', cors(corsOptions));


botApp.get('/api/export/today', async (req, res) => {
    try {
        const today = new Date();
        const dateStr = req.query.date || today.toISOString().slice(0, 10);
        const adminId = req.headers['x-admin-id'];
        const adminRole = req.headers['x-admin-role'];

        if (!adminId || !adminRole) {
            return res.status(401).json({ success: false, message: 'Thiếu thông tin xác thực admin' });
        }

        let allowedGroupIds = null;
        if (adminRole !== 'SUPER_ADMIN') {
            const mappingRes = await pool.query(
                'SELECT telegram_group_id FROM admin_group_mappings WHERE admin_id = $1',
                [adminId]
            );
            allowedGroupIds = mappingRes.rows.map(row => row.telegram_group_id);
        }

        // Fetch data for the specified date
        let userQuery = `
            SELECT u.id, u.full_name, u.group_id, g.telegram_group_id, g.group_name
            FROM employees u
            LEFT JOIN telegram_groups g ON u.group_id = g.id
        `;
        const userParams = [];
        if (allowedGroupIds !== null) {
            userParams.push(allowedGroupIds);
            userQuery += ` WHERE g.telegram_group_id = ANY($1)`;
        }
        userQuery += ` ORDER BY g.group_name ASC, u.full_name ASC`;

        const userRes = await pool.query(userQuery, userParams);
        const scheduleRes = await pool.query('SELECT * FROM tk_schedules WHERE date = $1', [dateStr]);
        const checkinRes = await pool.query('SELECT * FROM tk_check_ins WHERE date = $1', [dateStr]);
        const penaltyRes = await pool.query('SELECT * FROM tk_penalties WHERE date = $1', [dateStr]);
        const leaveRes = await pool.query('SELECT * FROM tk_leave_requests WHERE date = $1', [dateStr]);
        const groupSettingRes = await pool.query('SELECT * FROM group_settings');

        const schedules = scheduleRes.rows;
        const checkins = checkinRes.rows;
        const penalties = penaltyRes.rows;
        const leaveRequests = leaveRes.rows;
        const groupSettings = groupSettingRes.rows;

        // Create workbook and worksheet
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Báo cáo điểm danh');

        // Setup columns
        ws.columns = [
            { header: 'Nhân viên', key: 'employee', width: 25 },
            { header: 'Tên nhóm', key: 'groupName', width: 25 },
            { header: 'Ca làm', key: 'shift', width: 20 },
            { header: 'Check-in', key: 'checkin', width: 12 },
            { header: 'Check-out', key: 'checkout', width: 12 },
            { header: 'Trạng thái', key: 'status', width: 18 },
            { header: 'Số phút muộn', key: 'lateMinutes', width: 15 },
            { header: 'Lý do', key: 'reason', width: 30 },
            { header: 'Tiền phạt', key: 'penalty', width: 15 }
        ];

        // Format column alignments & number formats
        ws.getColumn('employee').alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getColumn('groupName').alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getColumn('shift').alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getColumn('checkin').alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getColumn('checkout').alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getColumn('status').alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getColumn('lateMinutes').alignment = { horizontal: 'right', vertical: 'middle' };
        ws.getColumn('reason').alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getColumn('penalty').alignment = { horizontal: 'right', vertical: 'middle' };
        ws.getColumn('penalty').numFmt = '#,##0';

        // Process each user
        userRes.rows.forEach(user => {
            const userSchedule = schedules.find(s => s.user_id === user.id);
            const userCheckins = checkins.filter(c => c.user_id === user.id);
            const userPenalties = penalties.filter(p => p.user_id === user.id);
            const userLeave = leaveRequests.find(l => l.user_id === user.id && (l.status === 'APPROVED' || l.status === 'approved'));

            const hasCheckin = userCheckins.length > 0;
            const isOffDay = userSchedule?.shift_type === 'OFF';

            // Resolve shift display range (e.g. 08:00–17:30)
            let shiftDisplay = 'Nghỉ';
            if (userSchedule && userSchedule.shift_type !== 'OFF') {
                const gs = groupSettings.find(g => g.telegram_group_id === user.telegram_group_id);
                const s1Start = gs?.shift_1_time ? gs.shift_1_time.substring(0, 5) : '08:00';
                const s2Start = gs?.shift_2_time ? gs.shift_2_time.substring(0, 5) : '13:30';

                if (['CA_1', 'CA_SANG', 'FULL_DAY'].includes(userSchedule.shift_type)) {
                    shiftDisplay = `${s1Start}–17:30`;
                } else if (['CA_2', 'CA_CHIEU'].includes(userSchedule.shift_type)) {
                    shiftDisplay = `${s2Start}–17:30`;
                } else if (userSchedule.shift_type === 'HALF_DAY_PM_WORK') {
                    shiftDisplay = `13:30-17:30`;
                } else {
                    shiftDisplay = userSchedule.shift_type;
                }
            } else if (!userSchedule) {
                shiftDisplay = 'Không có ca';
            }

            // Resolve check-in / check-out times (min and max check-in times)
            let checkInDisplay = '';
            let checkOutDisplay = '';
            if (hasCheckin) {
                const sortedCheckins = [...userCheckins].sort((a, b) => new Date(a.check_in_time) - new Date(b.check_in_time));
                checkInDisplay = moment(sortedCheckins[0].check_in_time).utcOffset(7).format('HH:mm');
                if (sortedCheckins.length > 1) {
                    checkOutDisplay = moment(sortedCheckins[sortedCheckins.length - 1].check_in_time).utcOffset(7).format('HH:mm');
                }
            }

            // Resolve status, late minutes, penalty amount, and reason
            let status = 'Đạt';
            let lateMinutes = '';
            let penaltyAmount = 0;
            let reasonParts = [];

            if (isOffDay || !userSchedule) {
                status = 'Nghỉ';
                if (userLeave) reasonParts.push(userLeave.reason);
            } else {
                if (hasCheckin) {
                    const latePenalty = userPenalties.find(p => p.violation_type === 'LATE');
                    if (latePenalty) {
                        status = 'Đi muộn';
                        lateMinutes = latePenalty.late_minutes || '';
                    } else {
                        status = 'Đạt';
                    }
                } else {
                    if (userLeave) {
                        status = 'Nghỉ có phép';
                        reasonParts.push(userLeave.reason);
                    } else {
                        status = 'Nghỉ không phép';
                    }
                }
            }

            // Collect all penalties and reasons
            penaltyAmount = userPenalties.reduce((sum, p) => sum + Number(p.amount), 0);
            userPenalties.forEach(p => {
                if (p.reason) reasonParts.push(p.reason);
            });
            if (userLeave && !reasonParts.includes(userLeave.reason)) {
                reasonParts.push(userLeave.reason);
            }

            const reasonDisplay = reasonParts.filter(Boolean).join(', ') || '';

            ws.addRow({
                employee: user.full_name,
                groupName: user.group_name || '',
                shift: shiftDisplay,
                checkin: checkInDisplay,
                checkout: checkOutDisplay,
                status: status,
                lateMinutes: lateMinutes,
                reason: reasonDisplay,
                penalty: penaltyAmount
            });
        });

        // Style header row
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1F4E78' } // Dark premium blue
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 25;

        // Add auto-filter to columns
        ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: userRes.rows.length + 1, column: 9 }
        };

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="daily_export_${dateStr}.xlsx"`);
        res.send(buffer);
    } catch (err) {
        console.error('[Export API Error]', err);
        res.status(500).json({ success: false, message: 'Export failed', error: err.message });
    }
});

let cachedBotUsername = null;
async function getBotUsername() {
    if (!cachedBotUsername) {
        try {
            const botInfo = await bot.telegram.getMe();
            cachedBotUsername = botInfo.username;
        } catch (e) {
            console.error('Lỗi khi lấy thông tin bot:', e);
            cachedBotUsername = process.env.BOT_USERNAME || 'baocao_kpi_adsup_bot';
        }
    }
    return cachedBotUsername;
}

function generateScheduleLink(groupId, botUsername) {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const ts = Date.now();
    const appShortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
    const dataString = `schedule:${groupId}:${ts}`;
    const sig = crypto.createHmac('sha256', token).update(dataString).digest('hex');
    return `https://t.me/${botUsername}/${appShortName}?startapp=schedule_${groupId}_${ts}_${sig}`;
}

async function sendSundayScheduleReminder(type) {
    try {
        console.log(`[Sunday Cron] Chạy trình nhắc nhở lịch: ${type}`);
        // 1. Tìm tất cả các nhóm chấm công đang hoạt động
        const groupsRes = await pool.query(`
            SELECT id, telegram_group_id, group_name 
            FROM telegram_groups 
            WHERE bot_role = 'timekeep' 
              AND is_active = true 
              AND COALESCE(is_deleted, false) = false
        `);

        if (groupsRes.rows.length === 0) return;

        // Lấy danh sách 7 ngày của tuần tiếp theo (Thứ 2 đến Chủ Nhật)
        const nextMonday = moment().utcOffset(7).add(1, 'day').startOf('day');
        const nextWeekDates = [];
        for (let i = 0; i < 7; i++) {
            nextWeekDates.push(moment(nextMonday).add(i, 'days').format('YYYY-MM-DD'));
        }

        const botUsername = await getBotUsername();

        for (const group of groupsRes.rows) {
            const groupId = group.telegram_group_id;
            const groupName = group.group_name;

            const scheduleUrl = generateScheduleLink(groupId, botUsername);

            // Tìm nhân viên trong nhóm chưa đăng ký lịch cho tuần tới (0 bản ghi trong tk_schedules cho tuần sau)
            const unregisteredRes = await pool.query(`
                SELECT e.id, e.full_name, e.telegram_id, e.telegram_username
                FROM employees e
                WHERE e.telegram_group_id = $1 
                  AND e.is_active = true 
                  AND e.full_name NOT LIKE '/%' 
                  AND e.full_name != 'tester'
                  AND NOT EXISTS (
                      SELECT 1 
                      FROM tk_schedules s 
                      WHERE s.user_id = e.id 
                        AND s.date >= $2::date 
                        AND s.date <= $3::date
                  )
            `, [groupId, nextWeekDates[0], nextWeekDates[6]]);

            const unregisteredStaff = unregisteredRes.rows;

            if (type === 'general_17' || type === 'general_18') {
                const message = `🔔 <b>[NHẮC NHỞ ĐĂNG KÝ LỊCH TUẦN MỚI]</b>\n\n` +
                    `Các bạn thành viên nhóm <b>${groupName}</b> ơi, vui lòng nhấp vào nút dưới đây để đăng ký lịch làm việc cho tuần tới nhé!\n` +
                    `⏰ Hạn chót đóng đăng ký: <b>20:00 tối nay (Chủ Nhật)</b>.`;

                await bot.telegram.sendMessage(groupId, message, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📅 Đăng ký lịch tuần', url: scheduleUrl }
                            ]
                        ]
                    }
                });
            } else if (type === 'targeted_19' || type === 'targeted_1950') {
                if (unregisteredStaff.length === 0) {
                    continue; 
                }

                const tagList = unregisteredStaff.map(emp => {
                    if (emp.telegram_username) {
                        return `@${emp.telegram_username.replace('@', '')} (${emp.full_name})`;
                    } else {
                        return `<a href="tg://user?id=${emp.telegram_id}">${emp.full_name}</a>`;
                    }
                }).join(', ');

                let message = '';
                if (type === 'targeted_19') {
                    message = `🔔 <b>[CẢNH BÁO ĐĂNG KÝ LỊCH TUẦN MỚI]</b>\n\n` +
                        `Các thành viên sau đây vui lòng nhấn nút dưới đây để hoàn tất đăng ký lịch làm việc tuần tới trước 20:00:\n\n` +
                        `👉 ${tagList}`;
                } else {
                    message = `🚨 <b>[CẢNH BÁO ĐĂNG KÝ LỊCH LẦN CUỐI]</b>\n\n` +
                        `⏰ <b>Chỉ còn đúng 10 phút!</b> Nếu quá 20:00 chưa hoàn tất đăng ký lịch, hệ thống sẽ tự động xếp toàn bộ ca của bạn thành <b>Ca sớm (8:30)</b> cho cả tuần sau.\n\n` +
                        `👉 Các bạn chưa đăng ký: ${tagList}`;
                }

                await bot.telegram.sendMessage(groupId, message, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📅 Đăng ký lịch tuần', url: scheduleUrl }
                            ]
                        ]
                    }
                });
            } else if (type === 'auto_set_2000') {
                // 1. Tự động xếp lịch Ca Sáng (CA_SANG) cho toàn bộ nhân sự chưa đăng ký lịch
                if (unregisteredStaff.length > 0) {
                    for (const emp of unregisteredStaff) {
                        for (const dateStr of nextWeekDates) {
                            await pool.query(`
                                INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, updated_by)
                                VALUES ($1, $2, $3, 'CA_SANG', true, 'Hệ thống tự động')
                                ON CONFLICT (user_id, date) 
                                DO UPDATE SET shift_type = 'CA_SANG', is_locked = true, updated_by = 'Hệ thống tự động', updated_at = NOW()
                            `, [group.id, emp.id, dateStr]);
                        }
                    }

                    const namesList = unregisteredStaff.map(emp => emp.full_name).join(', ');
                    const message = `🔒 <b>[HẾT HẠN ĐĂNG KÝ & TỰ ĐỘNG XẾP CA]</b>\n\n` +
                        `Hạn đăng ký lịch làm việc tuần tới đã kết thúc.\n\n` +
                        `Các thành viên chưa đăng ký đã được hệ thống tự động xếp lịch <b>Ca sớm (8:30)</b> cho cả tuần từ Thứ 2 đến Chủ Nhật:\n` +
                        `👉 <b>${namesList}</b>`;

                    await bot.telegram.sendMessage(groupId, message, { parse_mode: 'HTML' });
                }

                // 2. Tiến hành đóng đăng ký lịch cho nhóm
                await pool.query(`
                    UPDATE telegram_groups 
                    SET schedule_registration_open = false 
                    WHERE id = $1
                `, [group.id]);
                console.log(`[Cron] Đã đóng đăng ký lịch cho nhóm ${groupName}`);
            }
        }
    } catch (e) {
        console.error(`[Sunday Cron Error] Lỗi khi xử lý reminder ${type}:`, e);
    }
}

// 1. Nhắc chung lúc 17:00 Chủ Nhật hàng tuần
cron.schedule('0 17 * * 0', async () => {
    await sendSundayScheduleReminder('general_17');
}, { scheduled: true, timezone: "Asia/Ho_Chi_Minh" });

// 2. Nhắc chung lúc 18:00 Chủ Nhật hàng tuần
cron.schedule('0 18 * * 0', async () => {
    await sendSundayScheduleReminder('general_18');
}, { scheduled: true, timezone: "Asia/Ho_Chi_Minh" });

// 3. Nhắc tên cụ thể lúc 19:00 Chủ Nhật hàng tuần
cron.schedule('0 19 * * 0', async () => {
    await sendSundayScheduleReminder('targeted_19');
}, { scheduled: true, timezone: "Asia/Ho_Chi_Minh" });

// 4. Nhắc tên cụ thể lúc 19:50 Chủ Nhật hàng tuần (cảnh báo 10 phút cuối)
cron.schedule('50 19 * * 0', async () => {
    await sendSundayScheduleReminder('targeted_1950');
}, { scheduled: true, timezone: "Asia/Ho_Chi_Minh" });

// 5. Khóa đăng ký lịch và tự động xếp ca lúc 20:00 Chủ Nhật hàng tuần
cron.schedule('0 20 * * 0', async () => {
    await sendSundayScheduleReminder('auto_set_2000');
}, { scheduled: true, timezone: "Asia/Ho_Chi_Minh" });

// Daily export cron job at 23:00
cron.schedule('0 23 * * *', async () => {
    try {
        console.log('[Cron] Starting daily export to Google Spreadsheet');
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10);
        const scheduleRes = await pool.query('SELECT * FROM group_settings');
        const checkinRes = await pool.query('SELECT * FROM tk_check_ins WHERE date = $1', [dateStr]);
        const penaltyRes = await pool.query('SELECT * FROM tk_penalties WHERE date = $1', [dateStr]);
        const leaveRes = await pool.query('SELECT * FROM tk_leave_requests WHERE date = $1', [dateStr]);

        const rows = [];
        rows.push(['Type', 'Group ID', 'User ID', 'Date', 'Details']);
        rows.push(['Schedule', r.telegram_group_id, '', r.date, JSON.stringify(r)]);

        checkinRes.rows.forEach(r => {
            rows.push(['Checkin', r.group_id, r.user_id, r.date, `Video: ${r.video_file_id}`]);
        });
        penaltyRes.rows.forEach(r => {
            rows.push(['Penalty', r.group_id, r.user_id, r.date, `${r.violation_type} - ${r.amount}`]);
        });
        leaveRes.rows.forEach(r => {
            rows.push(['Leave', r.group_id, r.user_id, r.date, `${r.reason}`]);
        });
        // Google Sheets API
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
            range: 'DailyExport!A1',
            valueInputOption: 'RAW',
            requestBody: { values: rows }
        });
        console.log('[Cron] Export completed successfully');
    } catch (err) {
        console.error('[Cron] Error during daily export:', err);
    }
});
// =====================================
// ADMIN SCHEDULE MANAGEMENT APIs
// =====================================

// Admin cập nhật ca trực (thay đổi shift_type)
botApp.put('/api/admin/schedules/:id', async (req, res) => {
    try {
        const { shift_type } = req.body;
        const validShifts = ['CA_SANG', 'CA_CHIEU', 'FULL_DAY', 'OFF'];
        if (!validShifts.includes(shift_type)) {
            return res.status(400).json({ success: false, message: 'Ca trực không hợp lệ' });
        }
        const result = await pool.query(
            `UPDATE tk_schedules SET shift_type = $1, updated_by = 'admin', updated_at = NOW() WHERE id = $2 RETURNING id, group_id, user_id, date::text AS date, shift_type, is_locked, created_at, proof_url, updated_by, updated_at`,
            [shift_type, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy lịch' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('[Admin Schedule PUT Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin thêm lịch trực thủ công
botApp.post('/api/admin/schedules', async (req, res) => {
    try {
        const { user_id, date, shift_type } = req.body;
        if (!user_id || !date || !shift_type) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin bắt buộc' });
        }
        // Lấy group_id của user
        const userRes = await pool.query(
            `SELECT tg.id AS group_id 
             FROM employees u 
             JOIN telegram_groups tg ON u.telegram_group_id = tg.telegram_group_id 
             WHERE u.id = $1`,
            [user_id]
        );
        const group_id = userRes.rows[0]?.group_id || null;

        const result = await pool.query(
            `INSERT INTO tk_schedules (group_id, user_id, date, shift_type, is_locked, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, false, 'admin', NOW())
             ON CONFLICT (user_id, date)
             DO UPDATE SET shift_type = $4, updated_by = 'admin', updated_at = NOW()
             RETURNING  id, group_id, user_id, date::text AS date, shift_type, is_locked, created_at, proof_url, updated_by, updated_at`,
            [group_id, user_id, date, shift_type]
        );

        console.log('Kết quả trả về:', result.rows[0]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('[Admin Schedule POST Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin xóa lịch trực
botApp.delete('/api/admin/schedules/:id', async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM tk_schedules WHERE id = $1 RETURNING id, group_id, user_id, date::text AS date, shift_type, is_locked, created_at, proof_url, updated_by, updated_at`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy lịch' });
        }
        syncAllTimekeepSheets().catch(e => console.error('Sync sheet error:', e));
        res.json({ success: true });
    } catch (error) {
        console.error('[Admin Schedule DELETE Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin đồng bộ Google Sheet Chấm công & Lịch
botApp.post('/api/admin/timekeep/sync-sheet', async (req, res) => {
    try {
        const result = await syncAllTimekeepSheets();
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Cache lưu video gần nhất của từng user để hỗ trợ check-in bằng cách gửi video trước, nhắn tin "checkin" sau (Chỉ áp dụng cho chính user đó, chống check-in hộ)
const recentUserVideos = new Map();
const VIDEO_CACHE_TTL = 2 * 60 * 1000; // 2 phút

// Handler nhận video check-in trực tiếp hoặc khi trả lời (reply) video cũ kèm text chứa chữ "check"
bot.on(['video', 'video_note', 'text'], async (ctx, next) => {
    try {
        if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) {
            return next();
        }

        const telegram_id = ctx.message.from.id.toString();
        const telegramGroupId = ctx.chat.id.toString();
        let videoObj = ctx.message.video || ctx.message.video_note;
        let isReplyCheck = false;
        let isCachedCheck = false;

        // Nếu tin nhắn hiện tại chứa video trực tiếp từ chính user này, lưu vào cache cá nhân của user đó
        if (videoObj) {
            recentUserVideos.set(telegram_id, {
                videoObj: videoObj,
                timestamp: Date.now()
            });
        }

        // Trường hợp tin nhắn chữ reply lại một video/video_note đã gửi trước đó từ CHÍNH USER ĐÓ
        if (!videoObj && ctx.message.reply_to_message) {
            const repliedMsg = ctx.message.reply_to_message;
            // Chỉ chấp nhận nếu người được reply chính là người đang nhắn tin (chống reply video của người khác để check-in hộ)
            if (repliedMsg.from && repliedMsg.from.id.toString() === telegram_id) {
                videoObj = repliedMsg.video || repliedMsg.video_note;
                if (videoObj) {
                    isReplyCheck = true;
                }
            }
        }

        // Nếu không có video trực tiếp/reply chính chủ, kiểm tra cache video cá nhân gần đây của CHÍNH USER ĐÓ
        if (!videoObj) {
            const cached = recentUserVideos.get(telegram_id);
            if (cached && (Date.now() - cached.timestamp) <= VIDEO_CACHE_TTL) {
                videoObj = cached.videoObj;
                isCachedCheck = true;
            }
        }

        // Nếu không tìm thấy video hợp lệ của chính user này thì bỏ qua (tuyệt đối không cho điểm danh hộ)
        if (!videoObj) {
            return next();
        }

        const textOrCaption = (ctx.message.caption || ctx.message.text || '').trim();
        if (!textOrCaption.toLowerCase().includes('check')) {
            return next();
        }

        // 1. Tìm thông tin nhân sự trong nhóm
        let userRes = await pool.query(
            `SELECT u.id, u.full_name, u.role, u.group_id 
             FROM employees u 
             JOIN telegram_groups g ON u.group_id = g.id 
             WHERE u.telegram_id = $1 AND g.telegram_group_id = $2`,
            [telegram_id, telegramGroupId]
        );

        if (userRes.rows.length === 0) {
            userRes = await pool.query(
                `SELECT id, full_name, role, group_id FROM employees WHERE telegram_id = $1 LIMIT 1`,
                [telegram_id]
            );
        }

        if (userRes.rows.length === 0) {
            await ctx.reply(
                `⚠️ <b>${ctx.message.from.first_name || 'Bạn'}</b> ơi, bạn chưa đăng ký tài khoản nhân sự trong hệ thống!\nVui lòng đăng ký tài khoản trước khi thực hiện check-in.`,
                { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }
            );
            return next();
        }

        const user = userRes.rows[0];
        let msgDate = ctx.message.date;
        if (isReplyCheck && ctx.message.reply_to_message) {
            msgDate = ctx.message.reply_to_message.date;
        } else if (isCachedCheck) {
            const cached = recentUserVideos.get(telegram_id);
            if (cached) {
                // cached.timestamp is in ms, need to convert to unix seconds
                msgDate = Math.floor(cached.timestamp / 1000);
            }
        }

        const msgMoment = moment.unix(msgDate).utcOffset(7);
        const currentDate = msgMoment.format('YYYY-MM-DD');
        const checkInTime = msgMoment.format('YYYY-MM-DD HH:mm:ss');
        const fileId = videoObj.file_id;

        // 2. Lưu thông tin điểm danh vào bảng tk_check_ins
        await pool.query(
            `INSERT INTO tk_check_ins (group_id, user_id, date, check_in_time, video_file_id, status)
             VALUES ($1, $2, $3, $4, $5, 'APPROVED')`,
            [user.group_id, user.id, currentDate, checkInTime, fileId]
        );
        syncAllTimekeepSheets().catch(e => console.error('Sheet sync error:', e));

        // Xóa cache video của user sau khi đã ghi nhận check-in
        recentUserVideos.delete(telegram_id);

        // 3. Phản hồi xác nhận điểm danh thành công
        const timestampStr = msgMoment.format('HH:mm:ss - DD/MM/YYYY');
        let replyNote = '';
        if (isReplyCheck) {
            replyNote = ' (Xác nhận từ video được trả lời)';
        } else if (isCachedCheck) {
            replyNote = ' (Xác nhận từ video gửi trước đó)';
        }

        await ctx.reply(
            `📸 <b>ĐÃ GHI NHẬN CHECK-IN VIDEO THÀNH CÔNG</b> 📸\n\n` +
            `👤 <b>Nhân viên:</b> ${user.full_name}\n` +
            `💼 <b>Vị trí:</b> ${user.role || 'Nhân viên'}\n` +
            `⏰ <b>Thời gian điểm danh:</b> ${timestampStr}${replyNote}\n\n` +
            `<i>Hệ thống đã lưu video điểm danh của bạn thành công!</i>`,
            { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }
        );

    } catch (err) {
        console.error('[Video Checkin Message Handler Error]', err?.stack || err?.message || err);
    }
    return next();
});

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

const CUSTOMER_REPLY_ROLES = ['customer', 'customer_record'];
const TELEGRAM_BOT_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
const customerReplyAlbumTargets = new Map();
const customerReplyAckTimers = new Map();
const customerRecordInitializationJobs = new Map();

function buildCustomerRecordNotification(data, recordId, replyMode = false) {
    const displayDate = moment().utcOffset(7).format('DD/MM/YYYY HH:mm');
    const customerTypeDisplay = data.customerType === 'NEW' ? 'Khách mới ☘️' : 'Khách cũ 🔁';

    let message = `☘️ <b>GHI NHẬN THÔNG TIN KHÁCH HÀNG</b> ☘️\n\n` +
        `📅 <b>Ngày ghi nhận:</b> ${displayDate}\n` +
        `👤 <b>Nhân viên báo cáo:</b> ${escapeHtml(data.employeeName)}\n` +
        `👩‍💼 <b>Tư vấn:</b> ${escapeHtml(data.consultant)}\n` +
        `📊 <b>Loại khách:</b> ${customerTypeDisplay}\n` +
        `👤 <b>Tên khách hàng:</b> ${escapeHtml(data.customerName)}\n` +
        `📞 <b>Điện thoại:</b> ${escapeHtml(data.phone)}\n` +
        `📍 <b>Địa chỉ:</b> ${escapeHtml(data.address) || 'Không có'}\n` +
        `🛠️ <b>Dịch vụ:</b> ${escapeHtml(data.service)}\n` +
        `🎁 <b>Tặng kèm:</b> ${escapeHtml(data.gift) || 'Không có'}\n` +
        `💸 <b>Tổng Bill:</b> ${data.billAmount.toLocaleString('vi-VN')}đ\n` +
        `💳 <b>Đã thanh toán:</b> ${data.paidAmount.toLocaleString('vi-VN')}đ\n` +
        `🚨 <b>Còn nợ:</b> ${data.debtAmount.toLocaleString('vi-VN')}đ\n` +
        `🧑‍⚕️ <b>Người thực hiện:</b> ${escapeHtml(data.operator)}\n` +
        `🛡️ <b>Bảo hành:</b> ${escapeHtml(data.warranty) || 'Không có'}`;

    if (replyMode) {
        message += `\n\n📎 <b>GỬI ẢNH/VIDEO BẰNG TELEGRAM</b>\n` +
            `Reply trực tiếp tin nhắn này rồi gửi ảnh/video của đúng khách hàng. Bot sẽ tiếp nhận từng file và tự đồng bộ Google Drive trong nền.\n` +
            `⚠️ Video cần được Telegram nén xuống dưới 20 MB.\n` +
            `🆔 <b>Mã hồ sơ:</b> <code>CR:${recordId}</code>`;
    }

    return message;
}

function getCustomerReplyRecordId(message) {
    const match = String(message || '').match(/CR:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return match ? match[1] : null;
}

function scheduleCustomerReplyAcknowledgement(ctx, recordId) {
    const mediaGroupId = ctx.message.media_group_id;
    if (!mediaGroupId) {
        return ctx.reply(
            '✅ Đã tiếp nhận file. Bot đang đồng bộ lên Google Drive trong nền; dấu ✅ sẽ xuất hiện trên file khi hoàn tất.',
            { reply_to_message_id: ctx.message.message_id }
        ).catch(() => {});
    }

    const key = `${ctx.chat.id}:${recordId}:${mediaGroupId}`;
    const current = customerReplyAckTimers.get(key) || { count: 0, timer: null };
    current.count += 1;
    if (current.timer) clearTimeout(current.timer);
    current.timer = setTimeout(() => {
        customerReplyAckTimers.delete(key);
        ctx.telegram.sendMessage(
            ctx.chat.id,
            `✅ Đã tiếp nhận ${current.count} ảnh/video. Bot đang đồng bộ lên Google Drive trong nền; từng file sẽ có dấu ✅ khi hoàn tất.`,
            { reply_to_message_id: ctx.message.message_id }
        ).catch(() => {});
    }, 1200);
    customerReplyAckTimers.set(key, current);
}

function inferCustomerMediaExtension(mimeType, mediaType) {
    const known = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'video/mp4': '.mp4',
        'video/quicktime': '.mov'
    };
    return known[mimeType] || (mediaType === 'video' ? '.mp4' : '.jpg');
}

// Route nhận thông tin từ Mini App Form và lưu trữ
botApp.post('/api/customer/save', authenticateTelegramMiniApp, uploadCustomerMedia.array('media_files', 20), async (req, res) => {
    try {
        const telegram_id = req.verifiedTelegramId || req.body.telegram_id;
        const {
            chat_id,
            consultant,
            customer_type,
            customer_name,
            phone,
            address,
            service,
            gift,
            bill_amount,
            paid_amount,
            debt_amount,
            operator,
            warranty,
            media_mode
        } = req.body;

        const useTelegramReply = media_mode === 'telegram_reply';

        if (!telegram_id) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin Telegram ID!' });
        }

        // 1. Kiểm tra nhân sự
        const userRes = await pool.query('SELECT * FROM employees WHERE telegram_id = $1 LIMIT 1', [telegram_id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Nhân sự chưa đăng ký tài khoản trên hệ thống!' });
        }
        const user = userRes.rows[0];

        // 2. Xác định nhóm Telegram
        let groupRecord = null;
        let tgGroupId = chat_id || user.telegram_group_id;
        if (tgGroupId) {
            const groupRes = await pool.query('SELECT * FROM telegram_groups WHERE telegram_group_id = $1 LIMIT 1', [tgGroupId]);
            if (groupRes.rows.length > 0) {
                groupRecord = groupRes.rows[0];
            }
        }

        if (!groupRecord || !CUSTOMER_REPLY_ROLES.includes(groupRecord.bot_role) || groupRecord.is_active !== true || groupRecord.is_deleted === true) {
            return res.status(403).json({
                success: false,
                message: 'Chức năng hồ sơ khách hàng không được bật trong nhóm này.'
            });
        }
        const dbGroupId = groupRecord ? groupRecord.id : null;

        const currentDate = moment().utcOffset(7).format('YYYY-MM-DD');
        const billVal = parseFloat(bill_amount) || 0;
        const paidVal = parseFloat(paid_amount) || 0;
        const debtVal = parseFloat(debt_amount) || 0;

        // 3. Ghi nhận vào cơ sở dữ liệu ngay lập tức để phản hồi nhanh
        const insertRes = await pool.query(
            `INSERT INTO public.customer_records 
             (group_id, creator_employee_id, record_date, consultant, customer_type, customer_name, address, phone, service, gift, bill_amount, paid_amount, debt_amount, operator, warranty, drive_folder_link, media_urls)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NULL, NULL)
             RETURNING id`,
            [
                dbGroupId,
                user.id,
                currentDate,
                consultant,
                customer_type,
                customer_name,
                address || null,
                phone,
                service,
                gift || null,
                billVal,
                paidVal,
                debtVal,
                operator,
                warranty || null
            ]
        );
        const recordId = insertRes.rows[0].id;

        const notificationData = {
            employeeName: user.full_name,
            consultant,
            customerType: customer_type,
            customerName: customer_name,
            phone,
            address,
            service,
            gift,
            billAmount: billVal,
            paidAmount: paidVal,
            debtAmount: debtVal,
            operator,
            warranty
        };

        // Với lựa chọn Reply Telegram, tạo tin nhắn đích trước khi đóng Mini App
        // để nhân viên luôn có đúng hồ sơ mà họ cần reply.
        if (useTelegramReply) {
            try {
                await bot.telegram.sendMessage(
                    tgGroupId,
                    buildCustomerRecordNotification(notificationData, recordId, true),
                    { parse_mode: 'HTML', disable_web_page_preview: true }
                );
            } catch (telegramError) {
                await pool.query('DELETE FROM public.customer_records WHERE id = $1', [recordId]).catch(() => {});
                console.error('[Customer Reply Mode] Không thể tạo tin nhắn nhận media:', telegramError);
                return res.status(502).json({
                    success: false,
                    message: 'Không thể tạo tin nhắn nhận ảnh/video trong nhóm. Vui lòng thử lại.'
                });
            }
        }

        // Phản hồi thành công ngay lập tức cho client!
        res.json({
            success: true,
            media_mode: useTelegramReply ? 'telegram_reply' : 'mini_app',
            message: useTelegramReply
                ? 'Đã tạo hồ sơ. Vui lòng quay lại nhóm và reply ảnh/video vào tin nhắn Bot vừa gửi.'
                : 'Ghi nhận thông tin khách hàng thành công!'
        });

        // CHẠY TOÀN BỘ PHẦN UPLOAD DRIVE, SEND TELEGRAM, VÀ SYNC SHEET TRONG BACKGROUND
        const customerInitializationJob = (async () => {
            const parentFolderId = (groupRecord && groupRecord.customer_drive_folder_id) || process.env.CUSTOMER_DRIVE_PARENT_FOLDER_ID || '1efnVoB6tQXrHKAeTcm3lcqzJqBoGg3QF';
            const cleanPhone = phone.replace(/[^0-9+]/g, '');
            const customerFolder = await getOrCreateCustomerFolder(parentFolderId, cleanPhone);
            const driveFolderLink = customerFolder.webViewLink;

            const mediaUrls = [];
            if (req.files && req.files.length > 0) {
                for (const file of req.files) {
                    try {
                        const buffer = fs.readFileSync(file.path);
                        const uploadResult = await uploadToDrive(buffer, file.originalname, file.mimetype, customerFolder.id);
                        mediaUrls.push(uploadResult.webViewLink);
                    } catch (driveErr) {
                        console.error('[Customer Save Drive Upload Error]:', driveErr);
                    }
                }
            }

            // Reply mode có thể đã nhận media từ Telegram trong lúc khởi tạo
            // folder, vì vậy không được ghi đè mảng media_urls về rỗng.
            if (useTelegramReply) {
                await pool.query(
                    `UPDATE public.customer_records
                     SET drive_folder_link = $1,
                         media_urls = COALESCE(media_urls, '[]'::jsonb)
                     WHERE id = $2`,
                    [driveFolderLink, recordId]
                );
            } else {
                await pool.query(
                    `UPDATE public.customer_records
                     SET drive_folder_link = $1, media_urls = $2
                     WHERE id = $3`,
                    [driveFolderLink, JSON.stringify(mediaUrls), recordId]
                );
            }

            // Chế độ Reply đã gửi tin nhắn đích trước khi trả response; không gửi lặp lại.
            if (tgGroupId && !useTelegramReply) {
                const notifyMsg = buildCustomerRecordNotification(notificationData, recordId, false);

                if (req.files && req.files.length > 0) {
                    try {
                        const mediaGroup = req.files.slice(0, 10).map((file, idx) => {
                            const isVideo = file.mimetype.startsWith('video');
                            const mediaObj = {
                                type: isVideo ? 'video' : 'photo',
                                media: { source: file.path }
                            };
                            if (idx === 0) {
                                mediaObj.caption = notifyMsg;
                                mediaObj.parse_mode = 'HTML';
                            }
                            return mediaObj;
                        });
                        await bot.telegram.sendMediaGroup(tgGroupId, mediaGroup);
                    } catch (tgErr) {
                        console.error('[Customer Save Telegram Media Error] Thất bại khi gửi media group, gửi tin nhắn text dự phòng:', tgErr);
                        await bot.telegram.sendMessage(tgGroupId, notifyMsg, { parse_mode: 'HTML', disable_web_page_preview: true });
                    } finally {
                        // Xóa các file tạm
                        for (const file of req.files) {
                            try { fs.unlinkSync(file.path); } catch (e) {}
                        }
                    }
                } else {
                    await bot.telegram.sendMessage(tgGroupId, notifyMsg, { parse_mode: 'HTML', disable_web_page_preview: true });
                }
            }

            // Đồng bộ lên Google Sheet của nhóm
            try {
                await syncCustomerRecordToSheet(tgGroupId, {
                    date: moment().utcOffset(7).format('DD/MM/YYYY'),
                    employeeName: user.full_name,
                    employeeCode: user.employee_code || '',
                    consultant,
                    customerType: customer_type === 'NEW' ? 'Khách mới' : 'Khách cũ',
                    customerName: customer_name,
                    address,
                    phone,
                    service,
                    gift,
                    billAmount: billVal,
                    paidAmount: paidVal,
                    debtAmount: debtVal,
                    operator,
                    warranty,
                    driveFolderLink
                });
            } catch (sheetErr) {
                console.error('[Sheet Sync Error] Lỗi khi đồng bộ khách hàng lên Google Sheet:', sheetErr);
            }
        })();
        customerRecordInitializationJobs.set(recordId, customerInitializationJob);
        customerInitializationJob.catch(err => {
            console.error('[Customer Save Background Error]:', err);
        }).finally(() => {
            if (customerRecordInitializationJobs.get(recordId) === customerInitializationJob) {
                customerRecordInitializationJobs.delete(recordId);
            }
        });

    } catch (error) {
        console.error('[Save Customer Record Error]:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + error.message });
    }
});

// Chỉ nhận media reply trong nhóm hồ sơ khách hàng. Các role khác luôn được
// chuyển tiếp cho handler riêng của chúng bằng next().
bot.on(['photo', 'video', 'document'], async (ctx, next) => {
    try {
        if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) return next();

        const groupRole = await getGroupRole(ctx.chat.id);
        if (!CUSTOMER_REPLY_ROLES.includes(groupRole)) return next();

        const mediaGroupId = ctx.message.media_group_id || null;
        const albumKey = mediaGroupId ? `${ctx.chat.id}:${mediaGroupId}` : null;
        const replyMessage = ctx.message.reply_to_message;
        const isReplyToThisBot = replyMessage?.from?.is_bot && replyMessage.from.id === ctx.botInfo?.id;

        let recordId = isReplyToThisBot
            ? getCustomerReplyRecordId(replyMessage.text || replyMessage.caption || '')
            : null;

        // Một số Telegram client chỉ gắn reply_to_message cho phần tử đầu album.
        if (recordId && albumKey) {
            customerReplyAlbumTargets.set(albumKey, recordId);
            const cleanupTimer = setTimeout(() => customerReplyAlbumTargets.delete(albumKey), 2 * 60 * 1000);
            cleanupTimer.unref?.();
        } else if (!recordId && albumKey) {
            recordId = customerReplyAlbumTargets.get(albumKey) || null;
        }

        if (!recordId) return next();

        const recordRes = await pool.query(
            `SELECT r.*, tg.telegram_group_id, tg.bot_role,
                    e.telegram_id AS creator_telegram_id
             FROM public.customer_records r
             JOIN public.telegram_groups tg ON tg.id = r.group_id
             LEFT JOIN public.employees e ON e.id = r.creator_employee_id
             WHERE r.id = $1
             LIMIT 1`,
            [recordId]
        );

        if (recordRes.rows.length === 0) {
            return ctx.reply('⚠️ Không tìm thấy hồ sơ khách hàng tương ứng.', {
                reply_to_message_id: ctx.message.message_id
            });
        }

        const record = recordRes.rows[0];
        if (
            String(record.telegram_group_id) !== String(ctx.chat.id) ||
            !CUSTOMER_REPLY_ROLES.includes(record.bot_role)
        ) {
            return ctx.reply('⚠️ Hồ sơ này không thuộc nhóm hồ sơ khách hàng hiện tại.', {
                reply_to_message_id: ctx.message.message_id
            });
        }

        if (String(record.creator_telegram_id || '') !== String(ctx.from.id)) {
            return ctx.reply('⚠️ Chỉ nhân viên đã tạo hồ sơ này mới được gửi bổ sung ảnh/video.', {
                reply_to_message_id: ctx.message.message_id
            });
        }

        let telegramFile = null;
        let mediaType = null;
        let mimeType = null;
        let fileName = null;

        if (ctx.message.photo?.length) {
            telegramFile = ctx.message.photo[ctx.message.photo.length - 1];
            mediaType = 'photo';
            mimeType = 'image/jpeg';
        } else if (ctx.message.video) {
            telegramFile = ctx.message.video;
            mediaType = 'video';
            mimeType = ctx.message.video.mime_type || 'video/mp4';
            fileName = ctx.message.video.file_name || null;
        } else if (ctx.message.document) {
            const document = ctx.message.document;
            mimeType = document.mime_type || '';
            if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
                return ctx.reply('⚠️ Hồ sơ khách hàng chỉ nhận hình ảnh hoặc video.', {
                    reply_to_message_id: ctx.message.message_id
                });
            }
            telegramFile = document;
            mediaType = mimeType.startsWith('video/') ? 'video' : 'photo';
            fileName = document.file_name || null;
        }

        if (!telegramFile) return next();

        const fileSize = Number(telegramFile.file_size || 0);
        if (fileSize > TELEGRAM_BOT_DOWNLOAD_LIMIT) {
            return ctx.reply(
                '⚠️ File lớn hơn 20 MB nên Bot Telegram không thể tải xuống. Hãy gửi video ở chế độ nén của Telegram hoặc dùng cách tải trực tiếp trong Mini App.',
                { reply_to_message_id: ctx.message.message_id }
            );
        }

        if (!fileName) {
            fileName = `Customer_${recordId.slice(0, 8)}_${Date.now()}${inferCustomerMediaExtension(mimeType, mediaType)}`;
        }

        const queued = await pool.query(
            `INSERT INTO public.customer_record_telegram_media
             (customer_record_id, telegram_file_id, telegram_file_unique_id,
              telegram_chat_id, telegram_message_id, telegram_media_group_id,
              media_type, mime_type, file_name, file_size)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (customer_record_id, telegram_file_unique_id) DO NOTHING
             RETURNING id`,
            [
                recordId,
                telegramFile.file_id,
                telegramFile.file_unique_id,
                String(ctx.chat.id),
                ctx.message.message_id,
                mediaGroupId,
                mediaType,
                mimeType,
                fileName,
                fileSize
            ]
        );

        if (queued.rows.length === 0) {
            return ctx.reply('ℹ️ File này đã được tiếp nhận trước đó, Bot không tải trùng.', {
                reply_to_message_id: ctx.message.message_id
            });
        }

        scheduleCustomerReplyAcknowledgement(ctx, recordId);
    } catch (error) {
        console.error('[Customer Telegram Reply Receive Error]:', error);
        return ctx.reply('❌ Không thể tiếp nhận file lúc này. Vui lòng thử lại.', {
            reply_to_message_id: ctx.message.message_id
        }).catch(() => {});
    }
});

let customerTelegramMediaWorkerBusy = false;

async function claimNextCustomerTelegramMedia() {
    const result = await pool.query(`
        WITH next_job AS (
            SELECT id
            FROM public.customer_record_telegram_media
            WHERE (status = 'PENDING')
               OR (status = 'FAILED' AND next_retry_at <= NOW())
               OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '10 minutes')
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE public.customer_record_telegram_media queue
        SET status = 'PROCESSING',
            attempts = attempts + 1,
            updated_at = NOW(),
            last_error = NULL
        FROM next_job
        WHERE queue.id = next_job.id
        RETURNING queue.*
    `);
    return result.rows[0] || null;
}

async function uploadQueuedCustomerTelegramMedia(job) {
    const initializationJob = customerRecordInitializationJobs.get(job.customer_record_id);
    if (initializationJob) {
        await initializationJob;
    }

    const detailsRes = await pool.query(
        `SELECT r.*, tg.customer_drive_folder_id, tg.telegram_group_id, tg.bot_role
         FROM public.customer_records r
         JOIN public.telegram_groups tg ON tg.id = r.group_id
         WHERE r.id = $1
         LIMIT 1`,
        [job.customer_record_id]
    );

    if (detailsRes.rows.length === 0) throw new Error('Hồ sơ khách hàng không còn tồn tại.');
    const record = detailsRes.rows[0];
    if (!CUSTOMER_REPLY_ROLES.includes(record.bot_role)) {
        throw new Error('Nhóm không còn thuộc role hồ sơ khách hàng.');
    }

    const fileLink = await bot.telegram.getFileLink(job.telegram_file_id);
    const downloadResponse = await fetch(fileLink.href, { signal: AbortSignal.timeout(120000) });
    if (!downloadResponse.ok) {
        throw new Error(`Telegram download HTTP ${downloadResponse.status}`);
    }
    const buffer = Buffer.from(await downloadResponse.arrayBuffer());

    const parentFolderId = record.customer_drive_folder_id || process.env.CUSTOMER_DRIVE_PARENT_FOLDER_ID || '1efnVoB6tQXrHKAeTcm3lcqzJqBoGg3QF';
    const cleanPhone = String(record.phone || '').replace(/[^0-9+]/g, '');
    const customerFolder = await getOrCreateCustomerFolder(parentFolderId, cleanPhone);
    const uploadResult = await uploadToDrive(
        buffer,
        job.file_name,
        job.mime_type || (job.media_type === 'video' ? 'video/mp4' : 'image/jpeg'),
        customerFolder.id
    );

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE public.customer_record_telegram_media
             SET status = 'UPLOADED', drive_url = $2, uploaded_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [job.id, uploadResult.webViewLink]
        );
        await client.query(
            `UPDATE public.customer_records
             SET drive_folder_link = $2,
                 media_urls = COALESCE(media_urls, '[]'::jsonb) || jsonb_build_array($3::text)
             WHERE id = $1`,
            [job.customer_record_id, customerFolder.webViewLink, uploadResult.webViewLink]
        );
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    await bot.telegram.setMessageReaction(
        job.telegram_chat_id,
        Number(job.telegram_message_id),
        [{ type: 'emoji', emoji: '✅' }]
    ).catch(() => {});
}

async function markCustomerTelegramMediaFailed(job, error) {
    const retryMinutes = [1, 5, 15, 30][Math.min(Math.max(job.attempts - 1, 0), 3)];
    await pool.query(
        `UPDATE public.customer_record_telegram_media
         SET status = 'FAILED',
             last_error = $2,
             next_retry_at = NOW() + ($3 * INTERVAL '1 minute'),
             updated_at = NOW()
         WHERE id = $1`,
        [job.id, String(error.message || error).slice(0, 2000), retryMinutes]
    );

    if (job.attempts === 3) {
        await bot.telegram.sendMessage(
            job.telegram_chat_id,
            '⚠️ Một file hồ sơ khách hàng chưa đồng bộ được lên Drive. Bot vẫn đang tự động thử lại; bạn không cần gửi lại file lúc này.',
            { reply_to_message_id: Number(job.telegram_message_id) }
        ).catch(() => {});
    }
}

async function processCustomerTelegramMediaQueue() {
    if (customerTelegramMediaWorkerBusy) return;
    customerTelegramMediaWorkerBusy = true;
    try {
        for (let processed = 0; processed < 3; processed += 1) {
            const job = await claimNextCustomerTelegramMedia();
            if (!job) break;
            try {
                await uploadQueuedCustomerTelegramMedia(job);
                console.log(`[Customer Telegram Reply] Đã đồng bộ media ${job.id} lên Drive.`);
            } catch (error) {
                console.error(`[Customer Telegram Reply] Lỗi đồng bộ media ${job.id}:`, error);
                await markCustomerTelegramMediaFailed(job, error);
            }
        }
    } catch (error) {
        // Khi migration chưa chạy hoặc DB tạm lỗi, không làm tiến trình Bot bị dừng.
        console.error('[Customer Telegram Reply Worker Error]:', error.message);
    } finally {
        customerTelegramMediaWorkerBusy = false;
    }
}

const customerTelegramMediaWorkerTimer = setInterval(processCustomerTelegramMediaQueue, 5000);
customerTelegramMediaWorkerTimer.unref?.();
setTimeout(processCustomerTelegramMediaQueue, 1500).unref?.();

// Hàm hỗ trợ ghi thông tin khách hàng vào Google Sheet
async function syncCustomerRecordToSheet(telegramGroupId, data) {
    try {
        const doc = await getCustomerDocForGroup(telegramGroupId);
        if (!doc) {
            console.warn(`[Sheet Sync Warning] Không tìm thấy Spreadsheet cấu hình cho nhóm ${telegramGroupId}`);
            return;
        }
        await doc.loadInfo();

        const sheetTitle = 'THÔNG TIN KHÁCH HÀNG THỰC TẾ';
        const headers = [
            'Ngày', 'Nhân viên', 'Mã NV', 'Tư vấn', 'Khách mới/cũ', 'Tên KH', 
            'Địa chỉ', 'Điện thoại', 'Dịch vụ', 'Tặng', 'Bill (đ)', 
            'Đã TT (đ)', 'Nợ (đ)', 'Người thực hiện', 'Bảo hành', 'Link Folder Drive'
        ];

        let sheet = doc.sheetsByTitle[sheetTitle];
        if (!sheet) {
            sheet = await doc.addSheet({ headerValues: headers, title: sheetTitle });
        } else {
            await sheet.setHeaderRow(headers);
        }

        await sheet.addRow({
            'Ngày': data.date,
            'Nhân viên': data.employeeName,
            'Mã NV': data.employeeCode,
            'Tư vấn': data.consultant,
            'Khách mới/cũ': data.customerType,
            'Tên KH': data.customerName,
            'Địa chỉ': data.address || '',
            'Điện thoại': data.phone,
            'Dịch vụ': data.service,
            'Tặng': data.gift || '',
            'Bill (đ)': data.billAmount,
            'Đã TT (đ)': data.paidAmount,
            'Nợ (đ)': data.debtAmount,
            'Người thực hiện': data.operator,
            'Bảo hành': data.warranty || '',
            'Link Folder Drive': data.driveFolderLink
        });
        console.log(`[Sheet Sync] Đồng bộ thành công thông tin KH ${data.customerName} lên Sheet.`);
    } catch (e) {
        console.error('[Sheet Sync Error] Thất bại khi ghi dữ liệu lên Google Sheet:', e);
        throw e;
    }
}

// Cron job chạy lúc 22:00 hàng ngày tổng kết danh sách khách hàng phục vụ trong ngày
cron.schedule('0 22 * * *', async () => {
    try {
        console.log('[Cron] Khởi chạy tổng hợp danh sách khách hàng lúc 22:00 hàng ngày...');
        const todayStr = moment().utcOffset(7).format('YYYY-MM-DD');

        // Tìm tất cả các nhóm có bot_role liên quan
        const groupsRes = await pool.query(
            `SELECT id, telegram_group_id, group_name FROM telegram_groups 
             WHERE bot_role IN ('customer', 'customer_record') AND is_active = true AND COALESCE(is_deleted, false) = false`
        );

        for (const group of groupsRes.rows) {
            // Lấy danh sách bản ghi khách hàng phát sinh trong hôm nay của nhóm
            const recordsRes = await pool.query(
                `SELECT r.*, e.full_name as creator_name 
                 FROM customer_records r
                 LEFT JOIN employees e ON r.creator_employee_id = e.id
                 WHERE r.group_id = $1 AND r.record_date = $2
                 ORDER BY r.created_at ASC`,
                [group.id, todayStr]
            );

            let message = '';
            if (recordsRes.rows.length > 0) {
                message = `📋 <b>TỔNG HỢP DANH SÁCH KHÁCH HÀNG HÔM NAY (${moment().utcOffset(7).format('DD/MM/YYYY')})</b>\n`;
                message += `<b>Nhóm:</b> ${escapeHtml(group.group_name)}\n`;
                message += `-------------------------------------------\n\n`;

                recordsRes.rows.forEach((r, idx) => {
                    const custType = r.customer_type === 'NEW' ? 'Khách mới ☘️' : 'Khách cũ 🔁';
                    message += `${idx + 1}. <b>Khách hàng:</b> ${escapeHtml(r.customer_name)} (${custType})\n`;
                    message += `   📞 <b>Điện thoại:</b> ${escapeHtml(r.phone)}\n`;
                    message += `   👩‍💼 <b>Tư vấn:</b> ${escapeHtml(r.consultant)}\n`;
                    message += `   🛠️ <b>Dịch vụ:</b> ${escapeHtml(r.service)}\n`;
                    message += `   💸 <b>Tổng Bill:</b> ${(Number(r.bill_amount) || 0).toLocaleString('vi-VN')}đ | 💳 <b>Đã TT:</b> ${(Number(r.paid_amount) || 0).toLocaleString('vi-VN')}đ | 🚨 <b>Nợ:</b> ${(Number(r.debt_amount) || 0).toLocaleString('vi-VN')}đ\n`;
                    message += `   🧑‍⚕️ <b>Người thực hiện:</b> ${escapeHtml(r.operator)}\n`;
                    message += `   📁 <b>Drive Folder:</b> <a href="${r.drive_folder_link}">Xem folder ảnh</a>\n\n`;
                });
            } else {
                message = `📋 <b>TỔNG HỢP DANH SÁCH KHÁCH HÀNG HÔM NAY (${moment().utcOffset(7).format('DD/MM/YYYY')})</b>\n`;
                message += `<b>Nhóm:</b> ${escapeHtml(group.group_name)}\n`;
                message += `-------------------------------------------\n\n`;
                message += `😔 Hôm nay không có khách hàng nào được ghi nhận.`;
            }

            // Gửi tin nhắn đến nhóm
            await bot.telegram.sendMessage(group.telegram_group_id, message, { parse_mode: 'HTML', disable_web_page_preview: true });
            console.log(`[Cron] Đã gửi báo cáo tổng kết khách hàng cho nhóm: ${group.group_name}`);
        }
    } catch (e) {
        console.error('[Cron Error] Lỗi khi chạy tổng kết khách hàng cuối ngày lúc 22:00:', e);
    }
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
