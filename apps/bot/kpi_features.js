import express from 'express';
import moment from 'moment';
import cors from 'cors';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import cron from 'node-cron';
import pool from '../../packages/database/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import crypto from 'crypto';
import { computeHashFromBase64, findDuplicateImages, saveHashesToDB } from './image_hasher.js';
import { uploadToDrive, deleteOldPhotos } from './googleDrive.js';
import { Composer } from 'telegraf';
import { requireGroupRole, getGroupRole, sendMessageToRoleGroup, sendPhotoToRoleGroup, sendMediaGroupToRoleGroup } from './role_guard.js';
import { REPORT_BOT_HELP_HTML } from './user_guide_report.js';
import {
    getEmployeeMembership,
    registerEmployeeInKpiGroup
} from '../../packages/shared/kpiMembership.js';
import { getCustomerDocForGroup, getKpiDocForGroup } from './sheetManager.js';
import {
    registerSchedulingModule,
    parseAppointmentReplyReference,
    normalizeAppointmentIdentityText
} from '../../domains/scheduling/index.js';
import { registerKpiReportModule } from '../../domains/kpi-report/index.js';

// Khởi chạy cronjob dọn ảnh rác lúc 03:00 sáng
cron.schedule('0 3 * * *', async () => {
    console.log('[CRON] Đang chạy tác vụ dọn dẹp ảnh rác trên Local Storage...');
    try {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (fs.existsSync(uploadDir)) {
            const files = fs.readdirSync(uploadDir);
            const now = Date.now();
            const MAX_AGE = 35 * 24 * 60 * 60 * 1000; // 35 ngày
            let deletedCount = 0;
            for (const file of files) {
                const filePath = path.join(uploadDir, file);
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > MAX_AGE) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            }
            console.log(`[CRON] Đã xóa ${deletedCount} ảnh quá hạn (35 ngày).`);
        }
    } catch (e) {
        console.error('Lỗi khi dọn rác ảnh:', e);
    }
});

// Fix IPv6 ETIMEDOUT issue for node-fetch
dns.setDefaultResultOrder('ipv4first');

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let customerSheetQueue = Promise.resolve();

export function setupKpiBot(bot, botApp) {
    const kpiComposer = new Composer();

    function checkAdmin(ctx) {
        // Tải lại file .env trực tiếp mỗi lần check để nhận cập nhật ngay lập tức mà không cần pm2 restart
        try {
            const envPath = path.resolve(__dirname, '../../.env');
            const envContent = fs.readFileSync(envPath, 'utf8');
            const adminLine = envContent.split('\n').find(line => line.startsWith('ADMIN_IDS='));
            if (adminLine) {
                const idsStr = adminLine.split('=')[1];
                const currentAdmins = idsStr ? idsStr.split(',').map(id => id.trim()) : [];
                if (currentAdmins.length === 0) return true;

                const userId = ctx.from.id.toString();
                if (currentAdmins.includes(userId)) return true;
            } else {
                return true; // Không có dòng ADMIN_IDS -> cho phép
            }
        } catch (e) {
            console.error('Lỗi đọc file .env:', e);
            return true;
        }

        ctx.reply("❌ Bạn không có quyền sử dụng lệnh này. Lệnh này chỉ dành cho Sếp!");
        return false;
    }

    kpiComposer.command('myid', (ctx) => {
        ctx.reply(`🆔 ID Telegram của bạn là: <code>${ctx.from.id}</code>\n\nSếp hãy copy dãy số này và dán vào file .env (ADMIN_IDS=...) để phân quyền nhé!`, { parse_mode: 'HTML' });
    });

    kpiComposer.command('batnhanlich', async (ctx) => {
        if (!checkAdmin(ctx)) return;
        const chat = ctx.chat;
        if (chat.type === 'private') return ctx.reply("Lệnh này chỉ dùng trong Group chat.");

        try {
            await pool.query(
                `INSERT INTO schedule_notification_groups (group_id, group_name, is_disabled) VALUES ($1, $2, false) 
             ON CONFLICT (group_id) DO UPDATE SET group_name = EXCLUDED.group_name, is_disabled = false`,
                [chat.id.toString(), chat.title || 'Group Lịch']
            );
            ctx.reply("✅ Đã BẬT tính năng nhận thông báo Lịch Khách Hàng cho nhóm này!\n- 20h02 tối: Lịch khách ngày mai.\n- 22h00 đêm: Tổng kết lịch đã qua.\n- Đúng giờ khách đến: Nhắc nhở trực tiếp.");
        } catch (err) {
            console.error("Lỗi batnhanlich:", err);
            ctx.reply("❌ Lỗi khi bật nhận lịch: " + err.message);
        }
    });

    kpiComposer.command('tatnhanlich', async (ctx) => {
        if (!checkAdmin(ctx)) return;
        const chat = ctx.chat;
        if (chat.type === 'private') return ctx.reply("Lệnh này chỉ dùng trong Group chat.");

        try {
            await pool.query(
                `INSERT INTO schedule_notification_groups (group_id, group_name, is_disabled) VALUES ($1, $2, true)
                 ON CONFLICT (group_id) DO UPDATE SET is_disabled = true`,
                [chat.id.toString(), chat.title || 'Group Lịch']
            );
            ctx.reply("✅ Đã TẮT tính năng nhận thông báo Lịch Khách Hàng cho nhóm này.");
        } catch (err) {
            console.error("Lỗi tatnhanlich:", err);
            ctx.reply("❌ Lỗi khi tắt nhận lịch: " + err.message);
        }
    });

    kpiComposer.command('xoalich', async (ctx) => {
        const text = ctx.message.text.replace('/xoalich', '').trim();
        if (!text) {
            return ctx.reply("❌ Vui lòng nhập tên khách hàng hoặc Mã ID cần xóa.\nCú pháp: /xoalich [Tên khách/Mã ID]\nVí dụ: /xoalich Văn A  hoặc  /xoalich 15");
        }

        try {
            const chatGroupId = ctx.chat.id.toString();

            // Kiểm tra nếu người dùng nhập một con số (Mã ID)
            if (/^\d+$/.test(text)) {
                const res = await pool.query(
                    `UPDATE customer_appointments 
                 SET status = 'CANCELLED', cancel_reason = 'Xóa qua Telegram'
                 WHERE id = $1 AND DATE(appointment_time) = CURRENT_DATE AND group_id = $2
                 RETURNING customer_name`,
                    [parseInt(text), chatGroupId]
                );
                if (res.rowCount > 0) {
                    return ctx.reply(`✅ Đã xóa/hủy thành công lịch của khách: ${res.rows[0].customer_name}`);
                } else {
                    return ctx.reply(`❌ Không tìm thấy lịch nào có Mã ID "${text}" trong hôm nay.`);
                }
            }

            // Nếu nhập bằng chữ, tìm kiếm theo tên
            const searchRes = await pool.query(
                `SELECT id, customer_name, phone, appointment_time, employee_name 
             FROM customer_appointments 
             WHERE customer_name ILIKE $1 AND DATE(appointment_time) = CURRENT_DATE AND status = 'ACTIVE' AND group_id = $2`,
                [`%${text}%`, chatGroupId]
            );

            if (searchRes.rowCount === 0) {
                return ctx.reply(`❌ Không tìm thấy lịch nào của khách có tên "${text}" đang hoạt động trong hôm nay.`);
            }

            if (searchRes.rowCount === 1) {
                // Có đúng 1 người -> Xóa luôn
                await pool.query("UPDATE customer_appointments SET status = 'CANCELLED', cancel_reason = 'Xóa qua Telegram' WHERE id = $1", [searchRes.rows[0].id]);
                return ctx.reply(`✅ Đã xóa/hủy thành công lịch của khách: ${searchRes.rows[0].customer_name} (${searchRes.rows[0].phone})`);
            }

            // Nếu có nhiều người trùng tên
            let msg = `⚠️ Phát hiện có ${searchRes.rowCount} lịch khách hàng tên giống "${text}". Để tránh xóa nhầm, Sếp vui lòng xóa theo Mã ID nhé:\n\n`;
            searchRes.rows.forEach(r => {
                const timeStr = new Date(r.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                msg += `🔹 <b>Mã ID: ${r.id}</b> | Khách: ${r.customer_name} (${r.phone}) | Hẹn lúc: ${timeStr} | Phụ trách: ${r.employee_name}\n`;
            });
            msg += `\n👉 Bấm /xoalich [Mã ID] để xóa chính xác. (Ví dụ: /xoalich ${searchRes.rows[0].id})`;

            ctx.reply(msg, { parse_mode: 'HTML' });

        } catch (err) {
            console.error("Lỗi xoalich:", err);
            ctx.reply("❌ Lỗi khi xóa lịch: " + err.message);
        }
    });

    kpiComposer.command('lich', (ctx) => {
        ctx.reply('📅 <b>HỆ THỐNG QUẢN LÝ LỊCH KHÁCH HÀNG</b>\n\nVui lòng bấm vào nút bên dưới để mở Hệ thống Check Lịch, Thêm, Sửa hoặc Hủy lịch:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: "MỞ HỆ THỐNG ĐẶT LỊCH", web_app: { url: process.env.MINI_APP_URL + "/mini-app/schedule.html" } }
                ]]
            }
        });
    });

    // 2. CHỨC NĂNG: NHẬN BÁO CÁO & LƯU DB + GOOGLE SHEET
    kpiComposer.on('message', async (ctx, next) => {
        console.log(`[DEBUG] Nhận được tin nhắn từ ID ${ctx.from.id}:`, ctx.message.text || "(Không phải text)");
        return next();
    });



    // Lệnh hiển thị danh sách các lệnh hướng dẫn chi tiết
    kpiComposer.command(['help', 'huongdan'], (ctx) => {
        return ctx.replyWithHTML(REPORT_BOT_HELP_HTML);
    });

    kpiComposer.action('START_SETUP_WIZARD', (ctx) => {
        ctx.answerCbQuery();
        return ctx.scene.enter('SETUP_WIZARD');
    });


    // Lệnh start để bắt tín hiệu từ DM
    bot.start((ctx) => {
        const text = ctx.message.text || '';
        if (text.startsWith('/start baocao_') || text.startsWith('/start schedule_')) {
            const isSchedule = text.startsWith('/start schedule_');
            const groupId = isSchedule ? text.split('schedule_')[1] : text.split('baocao_')[1];

            const miniAppUrl = process.env.MINI_APP_URL || 'https://YOUR_NGROK_URL.ngrok-free.app';
            const finalUrl = isSchedule ? `${miniAppUrl}/mini-app/schedule.html?v=${Date.now()}` : `${miniAppUrl}/mini-app/form.html?chat_id=${groupId}&v=${Date.now()}`;
            const btnText = isSchedule ? '📅 MỞ HỆ THỐNG ĐẶT LỊCH' : '📋 MỞ BẢNG ĐIỀN BÁO CÁO';

            return ctx.reply('👇 Bấm vào nút bên dưới để mở Bảng tiện ích:', {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: btnText, web_app: { url: finalUrl } }
                        ]
                    ]
                }
            });
        }

        return ctx.reply('Xin chào! Tôi là Bot quản lý KPI. Vui lòng sử dụng tôi trong nhóm làm việc của bạn.');
    });

    kpiComposer.action('START_REPORT_WIZARD', (ctx) => {
        ctx.answerCbQuery(); // Clear the loading state
        return ctx.scene.enter('REPORT_WIZARD');
    });

    // Lệnh setup nhóm để lấy Chat ID hoặc Nhân viên đăng ký tên
    kpiComposer.command('setup', async (ctx) => {
        const chat = ctx.chat;
        const text = ctx.message.text.replace('/setup', '').trim();

        // 1. Nếu gõ /setup <Tên> -> Dành cho nhân viên đăng ký
        if (text.length > 0) {
            const fullName = text;
            const telegramId = ctx.from.id.toString();
            const username = ctx.from.username || '';

            try {
                // Cố gắng tìm bằng telegram_id trước (ưu tiên cao nhất)
                let res = await pool.query('SELECT * FROM employees WHERE telegram_id = $1', [telegramId]);

                // Nếu không có, tìm bằng full_name (để map nhân sự tạo từ web admin chưa có telegram_id)
                if (res.rows.length === 0) {
                    res = await pool.query('SELECT * FROM employees WHERE full_name ILIKE $1', [fullName]);
                }

                const groupId = chat.type !== 'private' ? chat.id.toString() : null;

                if (groupId) {
                    // Đảm bảo nhóm đã tồn tại trong bảng telegram_groups để tránh lỗi Foreign Key
                    await pool.query(
                        `INSERT INTO telegram_groups (telegram_group_id, group_name) VALUES ($1, $2) ON CONFLICT (telegram_group_id) DO UPDATE SET group_name = EXCLUDED.group_name`,
                        [groupId, chat.title || 'Group KPI']
                    );
                }

                if (res.rows.length > 0) {
                    // Đã có tài khoản toàn cục. Chỉ đăng ký membership của nhóm
                    // hiện tại; tuyệt đối không thay đổi membership nhóm cũ.
                    const empId = res.rows[0].id;
                    const currentKpi = parseFloat(res.rows[0].current_kpi_target);
                    const newKpi = Number.isFinite(currentKpi) ? currentKpi : 40;
                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');
                        const updatedRes = await client.query(
                            `UPDATE employees
                             SET telegram_id = $1, telegram_username = $2, full_name = $3,
                                 current_kpi_target = $4
                             WHERE id = $5
                             RETURNING *`,
                            [telegramId, username, fullName, newKpi, empId]
                        );

                        let registration = { ok: true, membership: updatedRes.rows[0] };
                        if (groupId) {
                            registration = await registerEmployeeInKpiGroup(client, updatedRes.rows[0], groupId);
                        }

                        if (!registration.ok) {
                            await client.query('ROLLBACK');
                            if (registration.reason === 'PAUSED') {
                                return ctx.reply('⏸ Bạn đang được Admin tạm dừng KPI trong nhóm này. Đăng ký tại nhóm KPI khác vẫn hoạt động bình thường, nhưng nhóm này chỉ Admin mới có thể kích hoạt lại.');
                            }
                            return ctx.reply('❌ Nhóm hiện tại không phải nhóm báo cáo KPI đang hoạt động.');
                        }

                        await client.query('COMMIT');
                        const target = Number(registration.membership?.current_kpi_target ?? newKpi);
                        return ctx.reply(`✅ Đăng ký nhóm thành công! Đã kết nối với nhân viên: ${fullName}\n🎯 Chỉ tiêu KPI tại nhóm này: ${target}`);
                    } catch (error) {
                        await client.query('ROLLBACK');
                        throw error;
                    } finally {
                        client.release();
                    }
                } else {
                    // Chưa có -> Tạo mới nhân viên với KPI mặc định là 40
                    const tempEmpCode = `NV_${telegramId.slice(-4)}`;
                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');
                        const inserted = await client.query(
                            `INSERT INTO employees
                                (full_name, employee_code, department, position,
                                 telegram_id, telegram_username, current_kpi_target, telegram_group_id)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
                             RETURNING *`,
                            [fullName, tempEmpCode, 'Sales', 'Telesale', telegramId, username, 40]
                        );
                        if (groupId) {
                            const registration = await registerEmployeeInKpiGroup(client, inserted.rows[0], groupId);
                            if (!registration.ok) throw new Error('Nhóm hiện tại không phải nhóm KPI đang hoạt động.');
                        }
                        await client.query('COMMIT');
                    } catch (error) {
                        await client.query('ROLLBACK');
                        throw error;
                    } finally {
                        client.release();
                    }
                    return ctx.reply(`✅ Đăng ký thành công! Đã thêm nhân viên mới: ${fullName}\n🎯 Chỉ tiêu KPI mặc định: 40\nBây giờ bạn có thể dùng lệnh báo cáo.`);
                }
            } catch (err) {
                console.error("Lỗi đăng ký NV:", err);
                return ctx.reply("❌ Lỗi khi đăng ký: " + err.message);
            }
        }

        // 2. Nếu chỉ gõ /setup (Không kèm tên)
        if (chat.type === 'private') {
            return ctx.reply("👉 Để đăng ký nhân viên, hãy gõ: /setup <Họ và tên>\nVí dụ: /setup Nguyễn Văn A");
        }

        // Nếu trong Group chat -> Lưu Group
        try {
            await pool.query(
                `INSERT INTO telegram_groups (telegram_group_id, group_name) 
             VALUES ($1, $2) ON CONFLICT (telegram_group_id) DO NOTHING`,
                [chat.id.toString(), chat.title]
            );
            ctx.reply(`✅ Đã liên kết Nhóm "${chat.title}" vào hệ thống!\n👉 Nhân viên vui lòng gõ lệnh: /setup <Họ và Tên> để đăng ký tài khoản.`);
        } catch (err) {
            ctx.reply("Lỗi: " + err.message);
        }
    });

    // Auto-update Global Menu Button when bot starts
    bot.catch((err, ctx) => {
        console.error(`Lỗi Telegraf cho update ${ctx?.updateType}:`, err.stack || err);
    });

    // Auto-update Global Menu Button when bot starts
    bot.telegram.callApi('setChatMenuButton', {
        menu_button: {
            type: 'web_app',
            text: '📝 Điền Báo Cáo',
            web_app: { url: process.env.MINI_APP_URL + "/mini-app/form.html" }
        }
    }).then(() => {
    }).catch(err => {
        console.error('[ERROR] Không thể cập nhật Menu Button:', err.message);
    });

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

    botApp.use(cors());
    botApp.use(express.json({ limit: '50mb' }));
    botApp.use(express.urlencoded({ limit: '50mb', extended: true }));
    botApp.use('/mini-app', express.static(path.join(__dirname, 'public')));

    // Verify signed payload
    function verifySignedPayload(action, groupId, ts, sig) {
        if (!action || !groupId || !ts || !sig) return false;
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

    // Middleware xác thực bảo mật cho Mini App Báo Cáo
    async function authenticateTelegramMiniApp(req, res, next) {
        try {
            const initData = req.headers['x-telegram-init-data'];
            if (!initData) {
                return res.status(401).json({ success: false, message: 'Missing Telegram initData header' });
            }

            const urlParams = new URLSearchParams(initData);
            const hash = urlParams.get('hash');
            urlParams.delete('hash');
            urlParams.sort();

            let dataCheckString = '';
            for (const [key, value] of urlParams.entries()) {
                dataCheckString += `${key}=${value}\n`;
            }
            dataCheckString = dataCheckString.slice(0, -1);

            const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
            const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

            if (hash !== expectedHash) {
                return res.status(403).json({ success: false, message: 'Invalid Telegram WebApp Signature' });
            }

            const authDate = parseInt(urlParams.get('auth_date'), 10);
            const now = Math.floor(Date.now() / 1000);
            if (isNaN(authDate) || now - authDate > 86400 || authDate - now > 300) {
                return res.status(403).json({ success: false, message: 'Phiên đăng nhập đã hết hạn. Vui lòng mở lại ứng dụng!' });
            }

            const userStr = urlParams.get('user');
            if (!userStr) {
                return res.status(403).json({ success: false, message: 'User data not found in initData' });
            }
            const userObj = JSON.parse(decodeURIComponent(userStr));
            const verifiedId = String(userObj.id);

            // Express 5: req.query là getter, không thể gán trực tiếp
            // Lưu verified ID trên req object để endpoint handlers sử dụng
            req.verifiedTelegramId = verifiedId;

            // Express 5 leaves req.body undefined for requests without a body (for
            // example GET /api/bot/get-report-today). Only write the verified
            // Telegram identity into the body when a parsed body actually exists.
            if (req.body && typeof req.body === 'object') {
                req.body.telegram_id = verifiedId;
                req.body.telegramId = verifiedId;
            }

            const groupId = req.query.chatId || (req.body && req.body.chatId);
            const ts = req.query.ts || (req.body && req.body.ts);
            const sig = req.query.sig || (req.body && req.body.sig);
            const action = req.query.action || (req.body && req.body.action);

            if (groupId) {
                if (!ts || !sig) {
                    return res.status(403).json({ success: false, message: 'Thiếu chữ ký thao tác (Signed Payload).' });
                }
                const isValidPayload = verifySignedPayload(action, groupId.toString(), ts, sig);
                if (!isValidPayload) {
                    return res.status(403).json({ success: false, message: 'Chữ ký thao tác (Signed Payload) không hợp lệ hoặc đã hết hạn.' });
                }

                const groupCheck = await pool.query('SELECT * FROM telegram_groups WHERE telegram_group_id = $1', [groupId.toString()]);
                if (groupCheck.rows.length === 0) {
                    return res.status(403).json({ success: false, message: 'Bot chưa được cấp quyền hoạt động trong nhóm này!' });
                }

                try {
                    const member = await bot.telegram.getChatMember(groupId.toString(), verifiedId);
                    const allowedStatus = ['creator', 'administrator', 'member'];
                    if (!allowedStatus.includes(member.status)) {
                        return res.status(403).json({ success: false, message: 'Bạn không phải là thành viên của nhóm này!' });
                    }
                } catch (memberErr) {
                    // getChatMember có thể lỗi nếu bot chưa vào nhóm, hoặc user chưa tương tác
                    // Không chặn nếu đã verify qua signed payload thành công
                    console.warn(`[Auth] getChatMember failed for user=${verifiedId} group=${groupId}: ${memberErr?.description || memberErr?.message || JSON.stringify(memberErr)}`);
                }
            }

            next();
        } catch (err) {
            console.error('[Auth Middleware Error]:', err?.stack || err?.message || err?.description || JSON.stringify(err));
            return res.status(500).json({ success: false, message: 'Lỗi xác thực hệ thống.' });
        }
    }


    // Trang ĐĂNG KÝ LỊCH TUẦN của role chấm công (gọi /api/timekeep/schedule/*).
    // Nằm nhầm chỗ từ trước, KHÔNG thuộc lịch khách tour. Giữ nguyên đường dẫn vì
    // apps/bot/index.js còn trỏ tới; sẽ chuyển sang domains/timekeep/ khi tách role đó.
    botApp.get('/schedule', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'schedule.html'));
    });

    // ---------------------------------------------------------------------
    // Toàn bộ lịch khách của role report_tour — xem domains/scheduling/README.md.
    // Đặt lịch, nhắc lịch, xác nhận đến/hủy, tổng hợp công tour và báo bù đều
    // nằm trong module; file này chỉ còn lắp ghép.
    //
    // VỊ TRÍ CỦA LỆNH NÀY LÀ CÓ CHỦ ĐÍCH. Express khớp route theo thứ tự đăng ký,
    // mà '/api/schedules/:id' trong module dùng ký tự đại diện. Dời lệnh này
    // xuống dưới một route '/api/schedules/...' nào khác là route đó chết.
    // ---------------------------------------------------------------------
    registerSchedulingModule({
        botApp,
        bot,
        pool,
        kpiComposer,
        cron,
        authenticateTelegramMiniApp,
        checkPayloadLimit,
        isValidImage,
        getImageExtension,
        escapeHtml,
        sendPhotoToRoleGroup,
        sendMessageToRoleGroup,
        getGroupRole,
        getCustomerDocForGroup,
        adminIds: process.env.ADMIN_IDS,
        fs,
        path,
        moment,
        uploadDir: path.join(__dirname, 'public', 'uploads'),
        publicBaseUrl: process.env.MINI_APP_URL
    });

    // Toàn bộ báo cáo KPI hàng ngày (nhận diện, chờ ảnh, chốt + tính phạt, 2 cron
    // nhắc/phạt, đồng bộ Sheet, route Mini App) — xem domains/kpi-report/README.md.
    registerKpiReportModule({
        botApp,
        bot,
        pool,
        kpiComposer,
        cron,
        authenticateTelegramMiniApp,
        checkAdmin,
        getGroupRole,
        sendMessageToRoleGroup,
        sendMediaGroupToRoleGroup,
        getKpiDocForGroup,
        getEmployeeMembership,
        computeHashFromBase64,
        findDuplicateImages,
        saveHashesToDB,
        crypto
    });

    // --- HELPER FUNCTIONS FOR BÁO BÙ ---
    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function isValidImage(buffer) {
        if (buffer.length < 4) return false;
        if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return true;
        if (buffer.length >= 12 &&
            buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
            return true;
        }
        return false;
    }

    function getImageExtension(buffer) {
        if (buffer.length < 4) return '.jpg';
        if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return '.png';
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return '.gif';
        if (buffer.length >= 12 &&
            buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
            return '.webp';
        }
        return '.jpg';
    }

    function checkPayloadLimit(limitInBytes) {
        return (req, res, next) => {
            const contentLength = parseInt(req.headers['content-length'], 10);
            if (contentLength && contentLength > limitInBytes) {
                return res.status(413).json({ success: false, error: 'Kích thước yêu cầu quá lớn! Vui lòng chọn ảnh nhỏ hơn.' });
            }
            next();
        };
    }


    botApp.get('/api/groups/role', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const { groupId } = req.query;
            if (!groupId) {
                return res.status(400).json({ success: false, error: 'Thiếu groupId!' });
            }
            const groupRes = await pool.query('SELECT bot_role FROM telegram_groups WHERE telegram_group_id = $1 AND is_active = true LIMIT 1', [groupId]);
            if (groupRes.rows.length === 0) {
                return res.json({ success: true, role: null });
            }
            res.json({ success: true, role: groupRes.rows[0].bot_role });
        } catch (err) {
            console.error('Lỗi API lấy role của nhóm:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });
    // Chỉ chuyển update vào KPI composer khi đang ở nhóm báo cáo.
    // Nếu chặn ngay bên trong composer, các callback/ảnh của module đăng ký
    // phía sau (ví dụ wh_appgrp_* của kho) sẽ bị "nuốt" và không bao giờ tới
    // đúng handler của chúng.
    const kpiMiddleware = kpiComposer.middleware();
    bot.use(async (ctx, next) => {
        if (!ctx.chat || ctx.chat.type === 'private') {
            return kpiMiddleware(ctx, next);
        }

        const role = await getGroupRole(ctx.chat.id);
        if (['report', 'report_tour'].includes(role)) {
            return kpiMiddleware(ctx, next);
        }

        return next();
    });
}
