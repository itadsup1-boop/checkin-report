import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import cron from 'node-cron';
import pool from '../../packages/database/index.js';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import crypto from 'crypto';
import { computeHashFromBase64, findDuplicateImages, saveHashesToDB } from './image_hasher.js';
import { uploadToDrive, deleteOldPhotos } from './googleDrive.js';

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
const credsPath = path.join(__dirname, '../../hybrid-flame-499905-r2-ccd6aff86787.json');
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || 'SPREADSHEET_ID_CHUA_CAI_DAT';
const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

const CUSTOMER_SPREADSHEET_ID = process.env.CUSTOMER_SPREADSHEET_ID;
let customerDoc = null;
if (CUSTOMER_SPREADSHEET_ID) {
    customerDoc = new GoogleSpreadsheet(CUSTOMER_SPREADSHEET_ID, serviceAccountAuth);
}
let customerSheetQueue = Promise.resolve();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

import { session, Scenes } from 'telegraf';
import { reportWizard } from './reportWizard.js';
import { setupWizard } from './setupWizard.js';
const stage = new Scenes.Stage([reportWizard, setupWizard]);
bot.use(session());
bot.use(stage.middleware());
let sheetQueue = Promise.resolve();

async function logPenaltyToSheet(user_full_name, employee_code, telegram_id, penalty_type, amount, details) {
    if (SPREADSHEET_ID === 'SPREADSHEET_ID_CHUA_CAI_DAT' || amount <= 0) return;

    sheetQueue = sheetQueue.then(async () => {
        try {
            await doc.loadInfo();
            const today = new Date();
            const monthStr = `${today.getMonth() + 1}-${today.getFullYear()}`;
            const sheetTitle = `TỔNG PHẠT T${monthStr}`;

            let penaltySheet = doc.sheetsByTitle[sheetTitle];
            const headers = ['Nhân viên', 'Mã NV', 'Telegram ID', 'Tổng Tiền Phạt', 'Lịch Sử Vi Phạm'];

            if (!penaltySheet) {
                penaltySheet = await doc.addSheet({ headerValues: headers, title: sheetTitle });
            }

            const rows = await penaltySheet.getRows();
            const existingRow = rows.find(r => r.get('Telegram ID') === telegram_id.toString());

            const dateStr = `${today.getDate()}/${today.getMonth() + 1}`;
            const newLogLine = `[${dateStr}] ${penalty_type}: -${amount.toLocaleString('vi-VN')}đ (${details})`;

            if (existingRow) {
                // Đã có nhân viên này -> Kiểm tra xem hôm nay đã bị phạt chưa?
                const currentHistory = existingRow.get('Lịch Sử Vi Phạm') || '';
                const isAlreadyPenalizedToday = currentHistory.includes(`[${dateStr}]`);

                if (isAlreadyPenalizedToday) {
                    // Nếu ĐÃ BỊ PHẠT HÔM NAY -> Không cộng dồn tiền, chỉ lưu lịch sử lỗi
                    const noStackingLog = `[${dateStr}] THÊM LỖI: ${penalty_type} (Đã phạt, không cộng dồn tiền)`;
                    existingRow.set('Lịch Sử Vi Phạm', currentHistory + '\n' + noStackingLog);
                    await existingRow.save();
                    console.log(`[LOG] Bỏ qua cộng tiền phạt ${penalty_type} cho ${user_full_name} vì đã vi phạm trong ngày hôm nay.`);
                } else {
                    // Nếu CHƯA BỊ PHẠT HÔM NAY -> Trừ tiền
                    let currentTotalStr = existingRow.get('Tổng Tiền Phạt') || '0';
                    let currentTotal = parseFloat(currentTotalStr.toString().replace(/\./g, '').replace(/,/g, '')) || 0;
                    currentTotal += amount;

                    existingRow.set('Tổng Tiền Phạt', currentTotal);
                    existingRow.set('Lịch Sử Vi Phạm', currentHistory + '\n' + newLogLine);
                    await existingRow.save();
                    console.log(`[LOG] Đã CỘNG DỒN phạt ${penalty_type} cho ${user_full_name}.`);
                }
            } else {
                // Thêm mới
                await penaltySheet.addRow({
                    'Nhân viên': user_full_name,
                    'Mã NV': employee_code || '',
                    'Telegram ID': telegram_id || '',
                    'Tổng Tiền Phạt': amount,
                    'Lịch Sử Vi Phạm': newLogLine
                });
                console.log(`[LOG] Đã TẠO MỚI phạt ${penalty_type} cho ${user_full_name}.`);
            }
        } catch (err) {
            console.error("Lỗi ghi TỔNG HỢP PHẠT:", err);
        }
    }).catch(err => console.error("Lỗi Queue Phạt Sheet:", err));
}

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

bot.command('myid', (ctx) => {
    ctx.reply(`🆔 ID Telegram của bạn là: <code>${ctx.from.id}</code>\n\nSếp hãy copy dãy số này và dán vào file .env (ADMIN_IDS=...) để phân quyền nhé!`, { parse_mode: 'HTML' });
});

function parseCurrency(text) {
    if (!text) return 0;
    let val = text.toLowerCase().replace(/,/g, '').replace(/\./g, '').trim();
    let numMatch = val.match(/[\d]+/);
    if (!numMatch) return 0;
    let num = parseInt(numMatch[0]);
    if (val.includes('tr') || val.includes('triệu') || val.includes('m') || val.includes('củ')) {
        num *= 1000000;
    } else if (val.includes('k') || val.includes('nghìn') || val.includes('ngàn') || val.includes('lít')) {
        num *= 1000;
    }
    return num;
}

function parseReport(text, command_trigger = '#baocao') {
    const safeTrigger = command_trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const triggerRegex = new RegExp(`^${safeTrigger}`, 'i');

    if (!triggerRegex.test(text.trim())) {
        return { is_valid: false };
    }

    const lines = text.split('\n').map(line => line.trim().toLowerCase());

    // Hỗ trợ mượt mà: Nếu gõ kiểu cũ "#baocao 15" trên 1 dòng
    if (lines.length === 1) {
        const fallbackMatch = text.match(new RegExp(`^${safeTrigger}\\s+(\\d+)`, 'i'));
        if (fallbackMatch) {
            const num = parseInt(fallbackMatch[1]);
            return {
                is_valid: true,
                kpi_actual: num,
                doanh_thu: 0,
                lich_khach: 'Không có',
                total_photos_needed: num
            };
        }
        return { is_valid: false };
    }

    let kpi_actual = 0;
    let doanh_thu = 0;
    let lich_khach = '';
    let hasTinNhan = false;
    let hasDoanhThu = false;
    let hasLichKhach = false;

    const textLower = text.toLowerCase();

    const tinNhanMatch = textLower.match(/(?:tin nhắn|tin gửi|tin gui).*?:\s*(\d+)/);
    if (tinNhanMatch) {
        kpi_actual = parseInt(tinNhanMatch[1]);
        hasTinNhan = true;
    }

    const doanhThuMatch = textLower.match(/(?:doanh thu|doanh số|số ds).*?:\s*(.+)/);
    if (doanhThuMatch) {
        doanh_thu = parseCurrency(doanhThuMatch[1]);
        hasDoanhThu = true;
    }

    let lichKhachLines = [];
    let isParsingLichKhach = false;

    for (const line of lines) {
        if (line.includes('lịch khách')) {
            hasLichKhach = true;
            isParsingLichKhach = true;
            const parts = line.split(':');
            if (parts.length > 1 && parts[1].trim() !== '') {
                lichKhachLines.push(parts.slice(1).join(':').trim());
            }
        } else if (isParsingLichKhach) {
            // Cứ thế thu thập các dòng lịch khách ở bên dưới
            lichKhachLines.push(line);
        }
    }

    if (lichKhachLines.length > 0) {
        lich_khach = lichKhachLines.join('\n').trim();
    }

    // Validate 1: Thiếu dòng nào không?
    const is_definitely_report = hasTinNhan && hasDoanhThu && hasLichKhach;

    if (!hasTinNhan || !hasDoanhThu || !hasLichKhach) {
        let missing = [];
        if (!hasTinNhan) missing.push('Số tin nhắn gửi');
        if (!hasDoanhThu) missing.push('Số doanh thu');
        if (!hasLichKhach) missing.push('Lịch khách');
        return {
            is_valid: false,
            is_definitely_report,
            error_msg: `❌ Báo cáo thiếu hoặc bỏ trống các mục: ${missing.join(', ')}.\n👉 Vui lòng điền ĐẦY ĐỦ form mẫu!`
        };
    }

    // Validate 2: Định dạng lịch khách
    if (lich_khach !== '0' && !lich_khach.includes('không') && !lich_khach.includes('ko có')) {
        const hasSlash = lich_khach.includes('/');
        const isTaiKham = lich_khach.toLowerCase().includes('tái khám') || lich_khach.toLowerCase().includes('tai kham');
        if (!hasSlash && !isTaiKham) {
            return {
                is_valid: false,
                is_definitely_report,
                error_msg: `❌ Định dạng Lịch khách chưa đúng!\n👉 Nếu có khách, bắt buộc phải ghi rành mạch có dấu gạch chéo '/' báo số buổi (Ví dụ: 3/10) hoặc ghi 'tái khám' (Ví dụ: khách tái khám / tái khám).\n👉 Nếu KHÔNG có khách, hãy ghi: Lịch khách: 0`
            };
        }
    }

    return {
        is_valid: true,
        kpi_actual,
        doanh_thu,
        lich_khach,
        total_photos_needed: kpi_actual + (doanh_thu > 0 ? 1 : 0)
    };
}

// 1. CHỨC NĂNG: TREO BOT & HẸN GIỜ NHẮC NHỞ (LINH HOẠT TỪ DATABASE)
// Chạy mỗi phút 1 lần để kiểm tra xem nhóm nào đến giờ nhắc nhở
cron.schedule('* * * * *', async () => {
    try {
        const now = new Date();
        const currentHour = String(now.getHours()).padStart(2, '0');
        const currentMinute = String(now.getMinutes()).padStart(2, '0');
        const currentTimeString = `${currentHour}:${currentMinute}:00`;

        // Lấy danh sách nhóm và cài đặt thời gian
        const query = `
            SELECT tg.telegram_group_id, tg.group_name, gs.remind_time_1, gs.deadline_time, gs.penalty_missing_report
            FROM telegram_groups tg
            LEFT JOIN group_settings gs ON tg.telegram_group_id = gs.telegram_group_id
            WHERE tg.is_active = true AND tg.bot_role = 'report' AND gs.auto_reminder_enabled = true
        `;
        const res = await pool.query(query);
        const groups = res.rows;

        for (const group of groups) {
            // 1. Nhắc nhở nộp báo cáo & Điểm danh
            const remindTime = group.remind_time_1 || '17:00:00';
            if (remindTime === currentTimeString) {
                console.log(`⏰ Đến giờ nhắc nhở cho nhóm: ${group.group_name}`);

                const todayStr = new Date().toISOString().split('T')[0];
                const empRes = await pool.query(`SELECT full_name, telegram_id, id FROM employees WHERE is_active = true AND need_report = true AND telegram_id IS NOT NULL AND telegram_group_id = $1`, [group.telegram_group_id]);
                const repRes = await pool.query(`SELECT employee_id FROM daily_reports WHERE telegram_group_id = $1 AND report_date = $2`, [group.telegram_group_id, todayStr]);
                const reportedIds = new Set(repRes.rows.map(r => r.employee_id));

                const missing = empRes.rows.filter(e => !reportedIds.has(e.id));
                if (missing.length > 0) {
                    const names = missing.map(m => m.full_name).join(', ');
                    bot.telegram.sendMessage(group.telegram_group_id, `⚠️ ĐÃ ĐẾN GIỜ BÁO CÁO KPI!\nDanh sách chưa nộp: ${names}\n⏰ Các bạn có đúng 2 tiếng nữa để nộp trước khi hệ thống chốt phạt tiền!`);
                } else {
                    bot.telegram.sendMessage(group.telegram_group_id, `🎉 Tuyệt vời! Tất cả nhân sự đã nộp báo cáo đúng hạn ngày hôm nay.`);
                }
            }

            // 2. Chốt sổ phạt sau deadline 2 tiếng
            if (group.remind_time_1) {
                const [h, m, s] = group.remind_time_1.split(':').map(Number);
                let penaltyDate = new Date();
                penaltyDate.setHours(h, m + 120, 0, 0); // Cộng 120 phút

                const penaltyHour = String(penaltyDate.getHours()).padStart(2, '0');
                const penaltyMinute = String(penaltyDate.getMinutes()).padStart(2, '0');
                const penaltyTimeString = `${penaltyHour}:${penaltyMinute}:00`;

                if (currentTimeString === penaltyTimeString) {
                    const todayStr = new Date().toISOString().split('T')[0];
                    const empRes = await pool.query(`SELECT full_name, telegram_id, employee_code, id FROM employees WHERE is_active = true AND need_report = true AND telegram_id IS NOT NULL AND telegram_group_id = $1`, [group.telegram_group_id]);
                    const repRes = await pool.query(`SELECT employee_id FROM daily_reports WHERE telegram_group_id = $1 AND report_date = $2`, [group.telegram_group_id, todayStr]);
                    const reportedIds = new Set(repRes.rows.map(r => r.employee_id));

                    const missing = empRes.rows.filter(e => !reportedIds.has(e.id));
                    if (missing.length > 0) {
                        const parsedAmount = parseFloat(group.penalty_missing_report);
                        const amount = isNaN(parsedAmount) ? 100000 : parsedAmount;
                        let penaltyMsg = amount > 0 ? `\n💸 Phạt: -${amount.toLocaleString('vi-VN')}đ / người` : '';
                        const names = missing.map(m => m.full_name).join(', ');

                        bot.telegram.sendMessage(group.telegram_group_id, `⛔ ĐÃ HẾT THỜI GIAN ÂN HẠN!\nDanh sách KHÔNG nộp báo cáo: ${names}${penaltyMsg}\n📋 Hệ thống đã lưu vào sổ đen cuối tháng!`);

                        if (amount > 0) {
                            for (const e of missing) {
                                await logPenaltyToSheet(e.full_name, e.employee_code, e.telegram_id, 'KHÔNG NỘP BÁO CÁO', amount, 'Quá hạn 2 tiếng không có báo cáo nào');
                            }
                        }

                        // Đẩy lên Google Sheet cho từng người
                        if (SPREADSHEET_ID !== 'SPREADSHEET_ID_CHUA_CAI_DAT') {
                            sheetQueue = sheetQueue.then(async () => {
                                try {
                                    await doc.loadInfo();
                                    const mainSheet = doc.sheetsByIndex[0];
                                    const headers = ['Ngày', 'Nhân viên', 'Mã NV', 'Telegram ID', 'Số tin nhắn (KPI)', 'Tin nhắn Thực tế', 'Doanh Thu', 'Lịch Khách', 'Hoàn thành (%)', 'Trạng thái', 'Tình trạng Ảnh', 'Nội dung tin nhắn'];

                                    for (const e of missing) {
                                        const rowData = {
                                            'Ngày': new Date().toLocaleString(),
                                            'Nhân viên': e.full_name,
                                            'Mã NV': e.employee_code || '',
                                            'Telegram ID': e.telegram_id,
                                            'Số tin nhắn (KPI)': '',
                                            'Tin nhắn Thực tế': 0,
                                            'Doanh Thu': '0',
                                            'Lịch Khách': '',
                                            'Hoàn thành (%)': '0%',
                                            'Trạng thái': '❌ KHÔNG BÁO CÁO',
                                            'Tình trạng Ảnh': amount > 0 ? `🚨 BỎ BÁO CÁO (Phạt: -${amount.toLocaleString('vi-VN')}đ)` : '🚨 BỎ BÁO CÁO',
                                            'Nội dung tin nhắn': ''
                                        };
                                        if (mainSheet) {
                                            await mainSheet.setHeaderRow(headers);
                                            await mainSheet.addRow(rowData);
                                        }

                                        // Lưu vào Tab cá nhân
                                        const idSuffix = e.telegram_id.slice(-3);
                                        const sheetTitle = `${e.full_name} - ${idSuffix}`.substring(0, 100);
                                        let individualSheet = doc.sheetsByTitle[sheetTitle];
                                        if (!individualSheet) {
                                            individualSheet = await doc.addSheet({ headerValues: headers, title: sheetTitle });
                                        } else {
                                            await individualSheet.setHeaderRow(headers);
                                        }
                                        await individualSheet.addRow(rowData);
                                    }
                                } catch (e) { console.error('Lỗi đẩy phạt lên Sheet:', e); }
                            }).catch(e => console.error(e));
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error("Lỗi Cron Job:", err);
    }
});

// Lệnh thay đổi giờ nhắc nhở: /hengio 17:30
bot.command('hengio', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const chat = ctx.chat;
    if (chat.type === 'private') {
        return ctx.reply("Lệnh này chỉ dùng trong Group chat.");
    }

    const text = ctx.message.text;
    const match = text.match(/\/hengio\s+(\d{1,2}:\d{2})/);
    if (!match) {
        return ctx.reply("❌ Cú pháp sai. Vui lòng nhập: /hengio HH:MM\nVí dụ: /hengio 17:30");
    }

    const timeString = match[1] + ":00";
    try {
        const groupId = chat.id.toString();
        // Cập nhật hoặc thêm mới vào group_settings
        const res = await pool.query('SELECT id FROM group_settings WHERE telegram_group_id = $1', [groupId]);
        if (res.rows.length > 0) {
            await pool.query('UPDATE group_settings SET remind_time_1 = $1 WHERE telegram_group_id = $2', [timeString, groupId]);
        } else {
            await pool.query('INSERT INTO group_settings (telegram_group_id, remind_time_1) VALUES ($1, $2)', [groupId, timeString]);
        }
        ctx.reply(`✅ Đã thay đổi giờ nhắc báo cáo thành ${match[1]} hàng ngày!`);
    } catch (err) {
        console.error("Lỗi đổi giờ:", err);
        ctx.reply("❌ Lỗi khi thay đổi giờ: " + err.message);
    }
});
// Lệnh /batnhanlich và /tatnhanlich
bot.command('batnhanlich', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const chat = ctx.chat;
    if (chat.type === 'private') return ctx.reply("Lệnh này chỉ dùng trong Group chat.");

    try {
        await pool.query(
            `INSERT INTO schedule_notification_groups (group_id, group_name) VALUES ($1, $2) 
             ON CONFLICT (group_id) DO UPDATE SET group_name = EXCLUDED.group_name`,
            [chat.id.toString(), chat.title || 'Group Lịch']
        );
        ctx.reply("✅ Đã BẬT tính năng nhận thông báo Lịch Khách Hàng cho nhóm này!\n- 6h00 sáng: Thống kê lịch hôm nay.\n- 22h00 đêm: Tổng kết lịch đã qua.\n- Đúng giờ khách đến: Nhắc nhở trực tiếp.");
    } catch (err) {
        console.error("Lỗi batnhanlich:", err);
        ctx.reply("❌ Lỗi khi bật nhận lịch: " + err.message);
    }
});

bot.command('tatnhanlich', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const chat = ctx.chat;
    if (chat.type === 'private') return ctx.reply("Lệnh này chỉ dùng trong Group chat.");

    try {
        await pool.query('DELETE FROM schedule_notification_groups WHERE group_id = $1', [chat.id.toString()]);
        ctx.reply("✅ Đã TẮT tính năng nhận thông báo Lịch Khách Hàng cho nhóm này.");
    } catch (err) {
        console.error("Lỗi tatnhanlich:", err);
        ctx.reply("❌ Lỗi khi tắt nhận lịch: " + err.message);
    }
});

bot.command('xoalich', async (ctx) => {
    const text = ctx.message.text.replace('/xoalich', '').trim();
    if (!text) {
        return ctx.reply("❌ Vui lòng nhập tên khách hàng hoặc Mã ID cần xóa.\nCú pháp: /xoalich [Tên khách/Mã ID]\nVí dụ: /xoalich Văn A  hoặc  /xoalich 15");
    }

    try {
        // Kiểm tra nếu người dùng nhập một con số (Mã ID)
        if (/^\d+$/.test(text)) {
            const res = await pool.query(
                `UPDATE customer_appointments 
                 SET status = 'CANCELLED', cancel_reason = 'Xóa qua Telegram'
                 WHERE id = $1 AND DATE(appointment_time) = CURRENT_DATE 
                 RETURNING customer_name`,
                [parseInt(text)]
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
             WHERE customer_name ILIKE $1 AND DATE(appointment_time) = CURRENT_DATE AND status = 'ACTIVE'`,
            [`%${text}%`]
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

bot.command('lich', (ctx) => {
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
bot.on('message', async (ctx, next) => {
    console.log(`[DEBUG] Nhận được tin nhắn từ ID ${ctx.from.id}:`, ctx.message.text || "(Không phải text)");
    return next();
});

const pendingReports = new Map();

async function processReport(user, parsedJSON, kpiTarget, telegram_id, group_id, text, ctx, botInstance = null, debt_info = null) {
    try {
        let penalty_amount = 100000;
        try {
            const gsRes = await pool.query(`SELECT penalty_missing_kpi FROM group_settings WHERE telegram_group_id = $1`, [group_id]);
            if (gsRes.rows.length > 0) {
                const pAmount = parseFloat(gsRes.rows[0].penalty_missing_kpi);
                if (!isNaN(pAmount)) penalty_amount = pAmount;
            }
        } catch (e) {
            console.error("Lỗi lấy penalty_amount:", e);
        }

        let total_penalty = 0;
        let missing_kpi = 0;
        let penalty_kpi_amount = 0;

        if (kpiTarget > 0 && parsedJSON.kpi_actual < kpiTarget) {
            missing_kpi = kpiTarget - parsedJSON.kpi_actual;
            if (penalty_amount > 0) {
                total_penalty = penalty_amount; // Phạt 1 lần duy nhất cho toàn bộ các lỗi
            }
        }

        if (debt_info && penalty_amount > 0) {
            total_penalty = penalty_amount; // Nếu có nợ ảnh thì cũng bị chốt phạt chung 1 lần
        }

        if (missing_kpi > 0) {
            await logPenaltyToSheet(user.full_name, user.employee_code, telegram_id, 'THIẾU KPI', total_penalty, `Thiếu ${missing_kpi} tin nhắn so với KPI ${kpiTarget}`);
        } else if (debt_info && debt_info.missing > 0) {
            await logPenaltyToSheet(user.full_name, user.employee_code, telegram_id, 'NỢ MINH CHỨNG', total_penalty, `Thiếu ${debt_info.missing} ảnh (Chỉ nộp ${debt_info.received}/${debt_info.required})`);
        }

        // A. LƯU VÀO DATABASE (PostgreSQL)
        const today = new Date();
        const report_month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

        await pool.query(
            `INSERT INTO daily_reports 
            (report_date, report_month, employee_id, telegram_group_id, raw_text, kpi_actual, kpi_required, status, submitted_at, metadata) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)`,
            [today.toISOString().split('T')[0], report_month, user.id, group_id, text, parsedJSON.kpi_actual, kpiTarget, text === 'XIN NGHỈ' ? 'OFF' : 'DA_BAO_CAO', JSON.stringify({
                doanh_thu: parsedJSON.doanh_thu,
                lich_khach: parsedJSON.lich_khach,
                debt_photos: debt_info ? debt_info.missing : 0,
                penalty_amount: total_penalty,
                missing_kpi: missing_kpi
            })]
        );

        // B. LƯU VÀO GOOGLE SHEET (XẾP HÀNG ĐỂ XỬ LÝ ĐỒNG THỜI - QUEUE)
        sheetQueue = sheetQueue.then(async () => {
            try {
                if (SPREADSHEET_ID !== 'SPREADSHEET_ID_CHUA_CAI_DAT') {
                    await doc.loadInfo();

                    const kpiRequiredStr = kpiTarget > 0 ? kpiTarget : '';
                    const percentComplete = kpiTarget > 0 ? Math.round((parsedJSON.kpi_actual / kpiTarget) * 100) + '%' : '';

                    let statusText = '';
                    if (text === 'XIN NGHỈ') {
                        statusText = '🛌 ĐÃ XIN NGHỈ';
                    } else if (kpiTarget > 0) {
                        if (parsedJSON.kpi_actual >= kpiTarget) {
                            statusText = '✅ Đạt KPI';
                        } else {
                            statusText = `❌ Không đạt (Thiếu ${missing_kpi})`;
                            if (penalty_amount > 0) {
                                statusText += `\n💸 Phạt vi phạm: -${penalty_amount.toLocaleString('vi-VN')}đ`;
                            }
                        }
                    }

                    const headers = ['Ngày', 'Nhân viên', 'Mã NV', 'Telegram ID', 'Số tin nhắn (KPI)', 'Tin nhắn Thực tế', 'Doanh Thu', 'Lịch Khách', 'Hoàn thành (%)', 'Trạng thái', 'Tình trạng Ảnh', 'Nội dung tin nhắn'];

                    let tinhTrangAnh = '✅ Đủ ảnh';
                    if (debt_info) {
                        tinhTrangAnh = `🚨 NỢ MINH CHỨNG: Thiếu ${debt_info.missing} ảnh (Chỉ nộp ${debt_info.received}/${debt_info.required})`;
                        if (penalty_amount > 0 && missing_kpi === 0) {
                            tinhTrangAnh += `\n💸 Phạt vi phạm: -${penalty_amount.toLocaleString('vi-VN')}đ`;
                        } else if (penalty_amount > 0 && missing_kpi > 0) {
                            tinhTrangAnh += `\n💸 Đã tính phạt chung 1 lần/ngày.`;
                        }
                    }

                    const rowData = {
                        'Ngày': new Date().toLocaleString(),
                        'Nhân viên': user.full_name,
                        'Mã NV': user.employee_code || '',
                        'Telegram ID': telegram_id,
                        'Số tin nhắn (KPI)': kpiRequiredStr,
                        'Tin nhắn Thực tế': parsedJSON.kpi_actual,
                        'Doanh Thu': parsedJSON.doanh_thu ? parsedJSON.doanh_thu.toLocaleString('vi-VN') + 'đ' : '0',
                        'Lịch Khách': parsedJSON.lich_khach || '',
                        'Hoàn thành (%)': percentComplete,
                        'Trạng thái': statusText,
                        'Tình trạng Ảnh': tinhTrangAnh,
                        'Nội dung tin nhắn': text
                    };

                    // 1. Lưu vào Sheet tổng
                    const mainSheet = doc.sheetsByIndex[0];
                    if (mainSheet) {
                        await mainSheet.setHeaderRow(headers);
                        await mainSheet.addRow(rowData);
                    }

                    // 2. Lưu vào Tab cá nhân
                    const idSuffix = telegram_id.slice(-3);
                    const sheetTitle = `${user.full_name} - ${idSuffix}`.substring(0, 100);

                    let individualSheet = doc.sheetsByTitle[sheetTitle];

                    if (!individualSheet) {
                        individualSheet = await doc.addSheet({ headerValues: headers, title: sheetTitle });
                    } else {
                        await individualSheet.setHeaderRow(headers);
                    }

                    await individualSheet.addRow(rowData);
                    console.log(`[LOG] Đã ghi Sheet xong cho ${user.full_name}.`);
                }
            } catch (sheetErr) {
                console.error("Lỗi khi lưu lên Google Sheet:", sheetErr.message);
            }
        }).catch(err => console.error("Lỗi Queue Sheet:", err));

        let penaltyKpiMsg = '';
        if (missing_kpi > 0) {
            penaltyKpiMsg = `\n📉 Bạn gửi thiếu ${missing_kpi} tin nhắn.`;
            if (total_penalty > 0 && !debt_info) {
                penaltyKpiMsg += `\n💸 Phạt vi phạm: -${total_penalty.toLocaleString('vi-VN')}đ`;
            }
        }

        const kpiMsg = kpiTarget > 0 ? `\n🎯 Chỉ tiêu: ${kpiTarget} | ✅ Thực tế: ${parsedJSON.kpi_actual}` : `\n✅ Thực tế: ${parsedJSON.kpi_actual}`;

        if (debt_info) {
            let debtMsg = `🚨 BÁO CÁO GHI NỢ ẢNH!\nĐã lưu báo cáo của ${user.full_name} lên hệ thống.\n⚠️ Tình trạng: Thiếu ${debt_info.missing} ảnh minh chứng (Nộp ${debt_info.received}/${debt_info.required}).${penaltyKpiMsg}`;
            if (total_penalty > 0) {
                debtMsg += `\n🔥 Mức phạt vi phạm: -${total_penalty.toLocaleString('vi-VN')}đ (Đã tính trọn gói 1 lần/ngày)`;
            }
            debtMsg += `\nSếp sẽ kiểm tra và trừ thưởng cuối tháng!`;

            if (botInstance) {
                botInstance.telegram.sendMessage(group_id, debtMsg);
            } else if (ctx) {
                ctx.reply(debtMsg);
            }
        } else if (text === 'XIN NGHỈ') {
            if (ctx) {
                ctx.reply(`✅ Đã ghi nhận: ${user.full_name} xin nghỉ phép hôm nay!\nHệ thống sẽ miễn báo cáo cho bạn.`);
            } else if (botInstance) {
                botInstance.telegram.sendMessage(group_id, `✅ Đã ghi nhận: ${user.full_name} xin nghỉ phép hôm nay!\nHệ thống sẽ miễn báo cáo cho bạn.`);
            }
        } else {
            if (ctx) {
                ctx.telegram.sendMessage(group_id, `✅ Đã nhận đủ ảnh minh chứng!\nĐã lưu báo cáo của ${user.full_name}.${kpiMsg}${penaltyKpiMsg}\n💾 Hệ thống đã ghi nhận thành công!`);
            } else if (botInstance) {
                botInstance.telegram.sendMessage(group_id, `✅ Đã nhận đủ ảnh minh chứng!\nĐã lưu báo cáo của ${user.full_name}.${kpiMsg}${penaltyKpiMsg}\n💾 Hệ thống đã ghi nhận thành công!`);
            }
        }
        console.log(`[LOG] Đã lưu báo cáo của ${user.full_name} vào DB và đưa vào hàng đợi Sheet.`);

    } catch (error) {
        console.error("Lỗi khi lưu báo cáo:", error);
        ctx.reply(`⚠️ Có lỗi xảy ra khi lưu hệ thống. Đội kỹ thuật đang xử lý!`);
    }
}

// Xử lý khi nhận được ảnh/video minh chứng
bot.on(['photo', 'video'], async (ctx, next) => {
    const telegram_id = ctx.message.from.id.toString();

    try {
        // --- CHỐT CHẶN VÂN TAY CHO ẢNH GỬI TRỰC TIẾP ---
        const userResult = await pool.query(`SELECT id, full_name, employee_code, current_kpi_target FROM employees WHERE telegram_id = $1 LIMIT 1`, [telegram_id]);
        const user = userResult.rows[0];

        if (user && user.id) {
            const photoArray = ctx.message.photo;
            const videoObj = ctx.message.video;

            if (photoArray && photoArray.length > 0) {
                const bestPhoto = photoArray[photoArray.length - 1];
                const file_id = bestPhoto.file_id;

                try {
                    const fileLink = await bot.telegram.getFileLink(file_id);
                    const response = await fetch(fileLink);
                    const arrayBuffer = await response.arrayBuffer();
                    const base64Data = Buffer.from(arrayBuffer).toString('base64');
                    const hashVal = await computeHashFromBase64(base64Data);

                    if (hashVal) {
                        const hashedImages = [{ index: 1, hash: hashVal, file_id: file_id }];
                        const duplicates = await findDuplicateImages(pool, hashedImages);

                        if (duplicates.length > 0) {
                            const dup = duplicates[0];
                            const dateStr = new Date(dup.old_date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                            let warnMsg = `🚨 <b>PHÁT HIỆN NGHI VẤN XÀI LẠI ẢNH CŨ</b> 🚨\n`;
                            warnMsg += `👤 Nhân viên gửi: <b>${user.full_name}</b>\n`;
                            warnMsg += `⚠️ Ảnh gửi lên giống ${dup.similarity}% với ảnh của <b>${dup.old_employee}</b> nộp lúc ${dateStr}.\n`;
                            warnMsg += `<i>👇 Mời Sếp xem đối chiếu (Bên trái: Cũ, Bên phải: Mới):</i>`;

                            await bot.telegram.sendMessage(ctx.chat.id, warnMsg, { parse_mode: 'HTML' });
                            await bot.telegram.sendMediaGroup(ctx.chat.id, [
                                { type: 'photo', media: dup.old_file_id, caption: `BẢN GỐC của ${dup.old_employee} nộp ${dateStr}` },
                                { type: 'photo', media: dup.new_file_id, caption: `BẢN MỚI do ${user.full_name} gửi lên` }
                            ]);
                        }
                        await saveHashesToDB(pool, user.id, hashedImages);
                    }
                } catch (hashErr) {
                    console.error("Lỗi hash ảnh gửi trực tiếp:", hashErr);
                }
            } else if (videoObj) {
                // Nếu là video, tạm thời không check trùng lặp (khó hash video qua base64)
                console.log(`[LOG] Nhận video từ ${user.full_name} (bỏ qua check hash)`);
            }
        }
        // --- KẾT THÚC CHỐT CHẶN VÂN TAY ---

        // Sử dụng Atomic UPDATE để tránh lỗi Race Condition khi gửi nhiều ảnh cùng lúc
        const updateResult = await pool.query(
            `UPDATE pending_reports 
             SET received_photos = received_photos + 1,
                 last_photo_received_at = NOW(),
                 inactivity_reminded = false
             WHERE telegram_id = $1 AND status = 'WAITING_PHOTOS' 
             RETURNING *`,
            [telegram_id]
        );

        if (updateResult.rows.length > 0) {
            const report = updateResult.rows[0];

            if (report.received_photos >= report.required_photos) {
                // Đủ ảnh -> Cập nhật thành DONE an toàn
                const doneResult = await pool.query(
                    `UPDATE pending_reports SET status = 'DONE' WHERE telegram_id = $1 AND status = 'WAITING_PHOTOS' RETURNING telegram_id`,
                    [telegram_id]
                );

                if (doneResult.rowCount > 0) {
                    // Fetch lại user để lấy full name
                    const userResult = await pool.query(`SELECT id, full_name, employee_code, current_kpi_target FROM employees WHERE telegram_id = $1 LIMIT 1`, [telegram_id]);
                    const user = userResult.rows[0] || { id: null, full_name: ctx.message.from.first_name, employee_code: null, current_kpi_target: 40 };
                    const kpiTarget = user.current_kpi_target > 0 ? user.current_kpi_target : 40;

                    // Parse lại báo cáo với trigger rỗng vì nó đã được validate lúc text
                    const parsedJSON = parseReport(report.raw_text, '');

                    await processReport(user, parsedJSON, kpiTarget, telegram_id, report.group_id, report.raw_text, ctx);

                    // Nếu có customers_data, giờ mới đẩy lên Sheet
                    const customersData = report.customers_data;
                    if (customersData && customersData.length > 0) {
                        await pushCustomersToSheet(customersData, user);
                    }
                }
            }
        }
    } catch (err) {
        console.error("Lỗi khi xử lý ảnh minh chứng:", err);
    }

    return next();
});

bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    const telegram_id = ctx.message.from.id.toString();
    const username = ctx.message.from.username || "Không có username";
    const group_id = ctx.chat.id.toString();

    try {
        // 1. Kiểm tra xem nhóm này có cài đặt Workflow không
        const wfResult = await pool.query(`SELECT * FROM telegram_workflows WHERE group_id = $1`, [group_id]);

        // Nếu nhóm không có cấu hình workflow, dùng mặc định là #baocao
        let command_trigger = '#baocao';
        let is_photo_required = true;
        let remind_time_1 = '17:00:00';
        const settingsResult = await pool.query(`SELECT remind_time_1 FROM group_settings WHERE telegram_group_id = $1`, [group_id]);
        if (settingsResult.rows.length > 0 && settingsResult.rows[0].remind_time_1) {
            remind_time_1 = settingsResult.rows[0].remind_time_1;
        }

        if (wfResult.rows.length > 0) {
            const wf = wfResult.rows[0];
            command_trigger = wf.command_trigger;
            is_photo_required = true;
        }

        // 2. Nhận diện báo cáo (Bằng lệnh hoặc tự nhiên)
        const textLower = text.toLowerCase();
        let isCommandMatched = false;
        let usedTrigger = command_trigger;

        if (textLower.startsWith(command_trigger)) {
            isCommandMatched = true;
        } else if (textLower.includes('báo cáo') || textLower.includes('bao cao')) {
            const hasNumbers = /\d/.test(textLower);
            const hasDoanhThu = textLower.includes('doanh thu') || textLower.includes('doanh số') || textLower.includes('số ds');
            const hasKhach = textLower.includes('khách');
            const hasTinNhan = textLower.includes('tin nhắn') || textLower.includes('tin gửi') || textLower.includes('tin gui');

            // Nhận diện thông minh: Có số liệu và ít nhất 2 từ khóa báo cáo đặc trưng
            if (hasNumbers && ((hasDoanhThu && hasKhach) || (hasDoanhThu && hasTinNhan) || (hasKhach && hasTinNhan) || text.split('\n').length > 3)) {
                isCommandMatched = true;
                usedTrigger = ''; // Cho phép regex trong parseReport chạy qua
            }
        }

        if (isCommandMatched) {
            const parsedJSON = parseReport(text, usedTrigger);
            if (!parsedJSON.is_valid) {
                // Chỉ báo lỗi cú pháp nếu họ dùng ĐÚNG lệnh trigger (vd: #baocao)
                // Hoặc nếu nó chắc chắn là lệnh báo cáo tự nhiên (có đủ 3 thành phần)
                if (usedTrigger !== '' || parsedJSON.is_definitely_report) {
                    return ctx.reply(parsedJSON.error_msg || `❌ Báo cáo sai cú pháp mẫu!`);
                }
                return next(); // Bỏ qua nếu bắt nhầm tự nhiên
            }

            const userResult = await pool.query(
                `SELECT id, full_name, employee_code, current_kpi_target 
                 FROM employees 
                 WHERE telegram_id = $1 OR employee_code = $2 
                 ORDER BY (telegram_id = $1) DESC NULLS LAST 
                 LIMIT 1`,
                [telegram_id, telegram_id]
            );
            const user = userResult.rows[0] || { id: null, full_name: ctx.message.from.first_name, employee_code: null, current_kpi_target: 40 };
            const kpiTarget = user.current_kpi_target > 0 ? user.current_kpi_target : 40;

            if (parsedJSON.kpi_actual === 0 || !is_photo_required) {
                // Báo cáo 0 hoặc không yêu cầu ảnh -> Xử lý luôn
                await processReport(user, parsedJSON, kpiTarget, telegram_id, group_id, text, ctx);
            } else {
                // Hạn chót nộp ảnh = Giờ nhắc nhở + 2 tiếng
                const [h, m, s] = remind_time_1.split(':').map(Number);
                let deadlineDate = new Date();
                deadlineDate.setHours(h, m + 120, 0, 0);

                // Nếu báo cáo nộp quá sát giờ (hoặc nộp trễ), cho họ tối thiểu 5 phút để load ảnh
                const minDeadline = new Date(Date.now() + 5 * 60 * 1000);
                const deadline_at = deadlineDate > minDeadline ? deadlineDate : minDeadline;

                // Sử dụng UPSERT (ON CONFLICT DO UPDATE) để chống lỗi duplicate data khi user spam hoặc mạng lag
                await pool.query(
                    `INSERT INTO pending_reports 
                    (telegram_id, group_id, raw_text, kpi_actual, required_photos, received_photos, deadline_at, status, last_reminder_stage) 
                    VALUES ($1, $2, $3, $4, $5, 0, $6, 'WAITING_PHOTOS', 0)
                    ON CONFLICT (telegram_id) DO UPDATE SET
                        group_id = EXCLUDED.group_id,
                        raw_text = EXCLUDED.raw_text,
                        kpi_actual = EXCLUDED.kpi_actual,
                        required_photos = EXCLUDED.required_photos,
                        received_photos = 0,
                        deadline_at = EXCLUDED.deadline_at,
                        status = 'WAITING_PHOTOS',
                        last_reminder_stage = 0,
                        inactivity_reminded = false,
                        last_photo_received_at = NULL`,
                    [telegram_id, group_id, text, parsedJSON.kpi_actual, parsedJSON.total_photos_needed, deadline_at]
                );

                ctx.reply(`⏳ Đã ghi nhận lệnh báo cáo của ${user.full_name} (Tin nhắn: ${parsedJSON.kpi_actual} | Doanh thu: ${parsedJSON.doanh_thu.toLocaleString('vi-VN')}đ).\n\n📸 VUI LÒNG GỬI ĐÚNG ${parsedJSON.total_photos_needed} ẢNH MINH CHỨNG.\n⏰ Vui lòng nộp ảnh trước hạn chót lúc ${deadline_at.toLocaleTimeString('vi-VN')} để không bị phạt!`);
            }
        }
    } catch (error) {
        console.error("Lỗi khi xử lý text message:", error);
    }

    // Rất quan trọng: cho phép các lệnh khác như /setup được chạy
    return next();
});

// Lệnh thiết lập mức phạt nợ ảnh: /phatnoanh 100k
// Lệnh thiết lập mức phạt chung: /phatvipham 100k
bot.command('phatvipham', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const chat = ctx.chat;
    const text = ctx.message.text.replace(/\/phatvipham/i, '').trim().toLowerCase();

    if (chat.type === 'private') {
        return ctx.reply("❌ Lệnh này chỉ dùng được khi add Bot vào trong một Nhóm chat.");
    }

    if (!text) {
        return ctx.reply("❌ Cú pháp sai. Vui lòng gõ: /phatvipham <số tiền>\nVí dụ: /phatvipham 100k");
    }

    const amount = parseCurrency(text);
    if (amount <= 0 && text !== '0') {
        return ctx.reply("❌ Số tiền không hợp lệ. Vui lòng gõ: /phatvipham 100k hoặc /phatvipham 0 để tắt phạt.");
    }

    try {
        const groupId = chat.id.toString();
        // Cập nhật vào penalty_missing_kpi (dùng chung cho mọi lỗi trừ trốn báo cáo)
        const res = await pool.query('SELECT id FROM group_settings WHERE telegram_group_id = $1', [groupId]);
        if (res.rows.length > 0) {
            await pool.query('UPDATE group_settings SET penalty_missing_kpi = $1 WHERE telegram_group_id = $2', [amount, groupId]);
        } else {
            await pool.query('INSERT INTO group_settings (telegram_group_id, penalty_missing_kpi) VALUES ($1, $2)', [groupId, amount]);
        }

        if (amount === 0) {
            ctx.reply(`✅ Đã tắt chế độ phạt vi phạm trong nhóm này.`);
        } else {
            ctx.reply(`✅ Đã thiết lập mức phạt vi phạm (Thiếu KPI, Nợ Ảnh)!\nTừ bây giờ, nhân viên vi phạm lỗi này sẽ bị phạt: -${amount.toLocaleString('vi-VN')}đ (Tối đa 1 lần phạt/ngày).`);
        }
    } catch (err) {
        console.error("Lỗi cài đặt phạt:", err);
        ctx.reply("❌ Lỗi hệ thống: " + err.message);
    }
});

// Lệnh thiết lập phạt không báo cáo: /phatbaocao 500k
bot.command('phatbaocao', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const chat = ctx.chat;
    const text = ctx.message.text.replace('/phatbaocao', '').trim().toLowerCase();

    if (chat.type === 'private') {
        return ctx.reply("❌ Lệnh này chỉ dùng được trong Nhóm.");
    }

    if (!text) {
        return ctx.reply("❌ Cú pháp sai. Vui lòng gõ: /phatbaocao <số tiền>\nVí dụ: /phatbaocao 500k");
    }

    const amount = parseCurrency(text);
    if (amount <= 0 && text !== '0') {
        return ctx.reply("❌ Số tiền không hợp lệ.");
    }

    try {
        const groupId = chat.id.toString();
        const res = await pool.query('SELECT id FROM group_settings WHERE telegram_group_id = $1', [groupId]);
        if (res.rows.length > 0) {
            await pool.query('UPDATE group_settings SET penalty_missing_report = $1 WHERE telegram_group_id = $2', [amount, groupId]);
        } else {
            await pool.query('INSERT INTO group_settings (telegram_group_id, penalty_missing_report) VALUES ($1, $2)', [groupId, amount]);
        }

        if (amount === 0) {
            ctx.reply(`✅ Đã tắt chế độ phạt không nộp báo cáo.`);
        } else {
            ctx.reply(`✅ Đã thiết lập mức phạt KHÔNG NỘP BÁO CÁO: -${amount.toLocaleString('vi-VN')}đ.`);
        }
    } catch (err) {
        console.error("Lỗi cài đặt phạt báo cáo:", err);
        ctx.reply("❌ Lỗi hệ thống: " + err.message);
    }
});

// Lệnh thiết lập KPI: /kpi 10
bot.command('kpi', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const chat = ctx.chat;
    const text = ctx.message.text.replace(/\/kpi/i, '').trim();

    if (chat.type === 'private') {
        return ctx.reply("❌ Lệnh này chỉ dùng được trong Nhóm.");
    }

    const newKpi = parseInt(text);
    if (isNaN(newKpi) || newKpi <= 0) {
        return ctx.reply("❌ Cú pháp sai. Vui lòng gõ: /kpi <số lượng>\nVí dụ: /kpi 40");
    }

    try {
        const groupId = chat.id.toString();
        // Cập nhật kpi cho tất cả nhân viên thuộc nhóm này
        const result = await pool.query(`UPDATE employees SET current_kpi_target = $1 WHERE telegram_group_id = $2 RETURNING id`, [newKpi, groupId]);

        ctx.reply(`🎯 Đã cập nhật chỉ tiêu KPI chung cho nhóm là: ${newKpi} tin nhắn/ngày!\n(Đã áp dụng cho ${result.rowCount} nhân viên trong nhóm)`);
    } catch (err) {
        console.error("Lỗi cài đặt KPI:", err);
        ctx.reply("❌ Có lỗi xảy ra: " + err.message);
    }
});

// Lệnh thiết lập lịch chốt báo cáo: /lichbaocao 18:00 hoặc 18h
bot.command('lichbaocao', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const chat = ctx.chat;
    const text = ctx.message.text.replace('/lichbaocao', '').trim();

    if (chat.type === 'private') return ctx.reply("Lệnh này chỉ dùng trong Group.");
    if (!text) return ctx.reply("❌ Vui lòng nhập giờ. VD: /lichbaocao 18:00");

    let timeString = '';
    const match = text.match(/(\d{1,2})[h:](\d{2})?/i);
    if (match) {
        const h = match[1].padStart(2, '0');
        const m = (match[2] || '00').padStart(2, '0');
        timeString = `${h}:${m}:00`;
    } else {
        return ctx.reply("❌ Giờ không hợp lệ. VD: 18:30 hoặc 18h");
    }

    try {
        const groupId = chat.id.toString();
        const res = await pool.query('SELECT id FROM group_settings WHERE telegram_group_id = $1', [groupId]);
        if (res.rows.length > 0) {
            await pool.query('UPDATE group_settings SET deadline_time = $1 WHERE telegram_group_id = $2', [timeString, groupId]);
        } else {
            await pool.query('INSERT INTO group_settings (telegram_group_id, deadline_time) VALUES ($1, $2)', [groupId, timeString]);
        }
        ctx.reply(`✅ Đã chốt Lịch Nộp Báo Cáo là ${timeString} hàng ngày!\nĐến giờ này Bot sẽ điểm danh những ai chưa nộp.\nSau 2 tiếng (tức ${timeString.slice(0, 5)} + 2 tiếng) sẽ chốt sổ phạt!`);
    } catch (err) {
        ctx.reply("❌ Lỗi hệ thống: " + err.message);
    }
});

// Lệnh tạo quy trình mới cho Nhóm (Gắn lệnh báo cáo)
bot.command('taocaulenh', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const chat = ctx.chat;
    const text = ctx.message.text.replace('/taocaulenh', '').trim().toLowerCase();

    // Nếu gõ trong chat riêng tư thì báo lỗi
    if (chat.type === 'private') {
        return ctx.reply("❌ Lệnh này chỉ dùng được khi add Bot vào trong một Nhóm chat.");
    }

    if (!text.startsWith('#') || text.length < 2) {
        return ctx.reply("❌ Cú pháp sai. Vui lòng gõ theo định dạng: /taocaulenh #ten_lenh\nVí dụ: /taocaulenh #doanhthu");
    }

    try {
        const groupId = chat.id.toString();

        // Lưu thông tin nhóm vào bảng telegram_groups (nếu chưa có)
        await pool.query(
            `INSERT INTO telegram_groups (telegram_group_id, group_name) 
             VALUES ($1, $2) ON CONFLICT (telegram_group_id) DO NOTHING`,
            [groupId, chat.title || 'Nhóm KPI']
        );

        // Lưu câu lệnh kích hoạt vào bảng telegram_workflows
        await pool.query(
            `INSERT INTO telegram_workflows (group_id, command_trigger) 
             VALUES ($1, $2) 
             ON CONFLICT (group_id) DO UPDATE SET command_trigger = EXCLUDED.command_trigger`,
            [groupId, text]
        );

        return ctx.reply(`✅ Khởi tạo thành công!\nTừ bây giờ, nhân viên trong nhóm này sẽ dùng lệnh \`${text}\` để báo cáo.\n\nSếp vui lòng lên Web Admin để cấu hình thêm tính năng (như: Bắt gửi ảnh, tính doanh thu...) cho nhóm này nhé!`);
    } catch (err) {
        console.error("Lỗi tạo câu lệnh nhóm:", err);
        return ctx.reply("❌ Có lỗi xảy ra khi lưu cấu hình nhóm: " + err.message);
    }
});

// Lệnh hiển thị danh sách các lệnh hướng dẫn
bot.command('menu', (ctx) => {
    const menuMsg = `
🤖 <b>HƯỚNG DẪN SỬ DỤNG BOT KPI</b> 🤖

👨‍💼 <b>DÀNH CHO QUẢN LÝ (SẾP):</b>
1. <code>/taocaulenh &lt;cú pháp&gt;</code>: Đặt lệnh báo cáo cho nhóm (vd: <code>/taocaulenh #baocao</code>)
2. <code>/hengio &lt;hh:mm&gt;</code>: Đặt giờ nhắc nhở nộp báo cáo (vd: <code>/hengio 17:30</code>). Hạn chót nộp phạt/ảnh sẽ tự động +2 tiếng.
3. <code>/phatvipham &lt;số tiền&gt;</code>: Đặt mức phạt chung cho lỗi Thiếu KPI / Nợ Ảnh. Tối đa 1 lần phạt/ngày. (vd: <code>/phatvipham 100k</code>)
4. <code>/phatbaocao &lt;số tiền&gt;</code>: Đặt mức phạt nặng nếu trốn không nộp báo cáo (vd: <code>/phatbaocao 500k</code>)
5. <code>/kpi &lt;số lượng&gt;</code>: Cài đặt chỉ tiêu KPI chung cho cả nhóm (vd: <code>/kpi 40</code>)

👤 <b>DÀNH CHO NHÂN VIÊN:</b>
1. <b>Bấm lệnh /app để mở Bảng Tiện Ích</b>: Dùng để đăng ký tài khoản, nộp báo cáo và cập nhật báo cáo.
2. <b>Cú pháp báo cáo:</b>
   Theo lệnh Sếp đã cài đặt (vd: <code>#baocao</code>). Xuống dòng để liệt kê:
   - Số tin nhắn gửi: [số]
   - Số doanh thu: [số]
   - Lịch khách: [Tên] - [Dịch vụ] - [Còn lại] / [Tổng]

💡 <i>Lưu ý: Mọi lịch sử vi phạm (Nợ ảnh, Bỏ báo cáo, Thiếu KPI) đều được lưu vào Sổ đen trên Google Sheet để kế toán trừ lương cuối tháng!</i>
`;
    return ctx.replyWithHTML(menuMsg);
});

// Lệnh mở bảng tiện ích cho nhân viên
bot.command(['app', 'form', 'lamviec', 'tienich', 'start'], (ctx) => {
    const botUsername = ctx.botInfo.username;
    const shortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
    const ts = Date.now();
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    
    // Create sig for baocao
    const bcDataString = `baocao:${ctx.chat.id}:${ts}`;
    const bcSig = crypto.createHmac('sha256', token).update(bcDataString).digest('hex');
    const dmUrl = `https://t.me/${botUsername}/${shortName}?startapp=baocao_${ctx.chat.id}_${ts}_${bcSig}`;
    
    // Create sig for schedule
    const schedDataString = `schedule:${ctx.chat.id}:${ts}`;
    const schedSig = crypto.createHmac('sha256', token).update(schedDataString).digest('hex');
    const scheduleUrl = `https://t.me/${botUsername}/${shortName}?startapp=schedule_${ctx.chat.id}_${ts}_${schedSig}`;

    const msg = `🚀 <b>BẢNG TIỆN ÍCH NHÂN VIÊN</b> 🚀\n\nVui lòng chọn chức năng bên dưới:`;

    return ctx.replyWithHTML(msg, {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '👤 Đăng Ký Tài Khoản', callback_data: 'START_SETUP_WIZARD' },
                    { text: '🛌 Đăng Ký Nghỉ Phép', callback_data: 'REQUEST_LEAVE' }
                ],
                [
                    { text: '📝 Điền Form Báo Cáo', url: dmUrl }
                ],
                [
                    { text: '🔄 Cập Nhật Báo Cáo', callback_data: 'CHECK_UPDATE_REPORT' },
                    { text: '📅 Đặt / Check Lịch', url: scheduleUrl }
                ]
            ]
        }
    });
});

bot.action('START_SETUP_WIZARD', (ctx) => {
    ctx.answerCbQuery();
    return ctx.scene.enter('SETUP_WIZARD');
});

bot.action('REQUEST_LEAVE', async (ctx) => {
    ctx.answerCbQuery();
    const name = ctx.from.first_name || ctx.from.username || 'Bạn';
    const telegramId = ctx.from.id;
    return ctx.replyWithHTML(`⚠️ <b>${name}</b> ơi, bạn có chắc chắn muốn <b>đăng ký NGHỈ PHÉP</b> hôm nay không?`, {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Có, tôi xin nghỉ', callback_data: `CONFIRM_LEAVE_${telegramId}` },
                    { text: '❌ Không, tôi bấm nhầm', callback_data: `CANCEL_LEAVE_${telegramId}` }
                ]
            ]
        }
    });
});

bot.action(/^CANCEL_LEAVE_(\d+)$/, (ctx) => {
    const targetId = ctx.match[1];
    if (ctx.from.id.toString() !== targetId) {
        return ctx.answerCbQuery('❌ Nút này không dành cho bạn!', { show_alert: true });
    }
    ctx.answerCbQuery('Đã hủy thao tác xin nghỉ!');
    ctx.deleteMessage().catch(() => { });
});

bot.action(/^CONFIRM_LEAVE_(\d+)$/, async (ctx) => {
    const targetId = ctx.match[1];
    if (ctx.from.id.toString() !== targetId) {
        return ctx.answerCbQuery('❌ Nút này không dành cho bạn!', { show_alert: true });
    }
    ctx.answerCbQuery();
    const telegramId = ctx.from.id.toString();
    const groupId = ctx.chat.id.toString();
    const today = new Date().toISOString().split('T')[0];

    try {
        const userResult = await pool.query('SELECT * FROM employees WHERE telegram_id = $1 LIMIT 1', [telegramId]);
        if (userResult.rows.length === 0) {
            return ctx.reply("❌ Bạn chưa đăng ký tài khoản. Vui lòng bấm [👤 Đăng Ký Tài Khoản] trước.");
        }
        const user = userResult.rows[0];

        // Xóa các pending báo cáo nếu có
        await pool.query(`DELETE FROM pending_reports WHERE telegram_id = $1 AND group_id = $2`, [telegramId, groupId]);

        // Tạo dữ liệu báo cáo 0 để push vào DB và Sheet
        const parsedJSON = {
            is_valid: true,
            kpi_actual: 0,
            doanh_thu: 0,
            lich_khach: 'Nghỉ phép'
        };

        await processReport(user, parsedJSON, 0, telegramId, groupId, 'XIN NGHỈ', ctx, bot);
        ctx.deleteMessage().catch(() => { });
    } catch (err) {
        console.error("Lỗi đăng ký nghỉ:", err);
        ctx.reply("❌ Có lỗi xảy ra khi xử lý yêu cầu nghỉ phép.");
    }
});

bot.action('CHECK_UPDATE_REPORT', async (ctx) => {
    ctx.answerCbQuery();
    const telegramId = ctx.from.id.toString();
    const groupId = ctx.chat.id.toString();
    const today = new Date().toISOString().split('T')[0];

    try {
        // 1. Kiểm tra pending_reports
        const pendingResult = await pool.query(
            `SELECT telegram_id FROM pending_reports WHERE telegram_id = $1 AND group_id = $2 AND status = 'WAITING_PHOTOS' LIMIT 1`,
            [telegramId, groupId]
        );

        let hasReport = pendingResult.rows.length > 0;

        // 2. Nếu không có pending, kiểm tra daily_reports
        if (!hasReport) {
            const userResult = await pool.query('SELECT id FROM employees WHERE telegram_id = $1 LIMIT 1', [telegramId]);
            if (userResult.rows.length > 0) {
                const reportResult = await pool.query(
                    `SELECT id FROM daily_reports WHERE telegram_group_id = $1 AND employee_id = $2 AND report_date = $3 LIMIT 1`,
                    [groupId, userResult.rows[0].id, today]
                );
                hasReport = reportResult.rows.length > 0;
            }
        }

        if (hasReport) {
            const botUsername = ctx.botInfo.username;
            const shortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
            const ts = Date.now();
            const token = process.env.TELEGRAM_BOT_TOKEN || '';
            const bcDataString = `baocao:${groupId}:${ts}`;
            const bcSig = crypto.createHmac('sha256', token).update(bcDataString).digest('hex');
            const dmUrl = `https://t.me/${botUsername}/${shortName}?startapp=baocao_${groupId}_${ts}_${bcSig}`;

            return ctx.reply("✅ Đã tìm thấy báo cáo của bạn hôm nay.\n👉 Vui lòng bấm nút bên dưới để mở Form cập nhật.", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Mở Form Cập Nhật', url: dmUrl }]
                    ]
                }
            });
        } else {
            return ctx.reply("❌ Hôm nay bạn chưa nộp báo cáo nào!\n👉 Vui lòng bấm nút [📝 Điền Form Báo Cáo] ở Menu để nộp mới.");
        }
    } catch (err) {
        console.error("Lỗi CHECK_UPDATE_REPORT:", err);
        return ctx.reply("❌ Lỗi hệ thống khi kiểm tra báo cáo.");
    }
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

bot.action('START_REPORT_WIZARD', (ctx) => {
    ctx.answerCbQuery(); // Clear the loading state
    return ctx.scene.enter('REPORT_WIZARD');
});

// Lệnh setup nhóm để lấy Chat ID hoặc Nhân viên đăng ký tên
bot.command('setup', async (ctx) => {
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
                // Đã có trong DB -> Cập nhật telegram_id và group_id
                const empId = res.rows[0].id;
                const currentKpi = parseFloat(res.rows[0].current_kpi_target);
                const newKpi = (!currentKpi || currentKpi === 0) ? 40 : currentKpi;

                if (groupId) {
                    await pool.query('UPDATE employees SET telegram_id = $1, telegram_username = $2, full_name = $3, current_kpi_target = $4, telegram_group_id = $5 WHERE id = $6', [telegramId, username, fullName, newKpi, groupId, empId]);
                } else {
                    await pool.query('UPDATE employees SET telegram_id = $1, telegram_username = $2, full_name = $3, current_kpi_target = $4 WHERE id = $5', [telegramId, username, fullName, newKpi, empId]);
                }

                return ctx.reply(`✅ Cập nhật thành công! Đã kết nối với nhân viên: ${fullName}\n🎯 Chỉ tiêu hiện tại của bạn: ${newKpi}`);
            } else {
                // Chưa có -> Tạo mới nhân viên với KPI mặc định là 40
                const tempEmpCode = `NV_${telegramId.slice(-4)}`;
                await pool.query(
                    `INSERT INTO employees (full_name, employee_code, department, position, telegram_id, telegram_username, current_kpi_target, telegram_group_id) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [fullName, tempEmpCode, 'Sales', 'Telesale', telegramId, username, 40, groupId]
                );
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

// Cronjob quét mỗi 1 phút để nhắc nhở và hủy báo cáo nộp ảnh muộn
cron.schedule('* * * * *', async () => {
    try {
        const now = new Date();
        const pendingResult = await pool.query(`SELECT * FROM pending_reports WHERE status = 'WAITING_PHOTOS'`);

        for (const report of pendingResult.rows) {
            const deadline = new Date(report.deadline_at);
            const diffMinutes = Math.floor((deadline - now) / 60000);

            // Nếu đã quá hạn
            if (diffMinutes <= 0) {
                // Lấy thông tin user
                const userResult = await pool.query(`SELECT id, full_name, employee_code, current_kpi_target FROM employees WHERE telegram_id = $1 LIMIT 1`, [report.telegram_id]);
                const user = userResult.rows[0] || { id: null, full_name: 'Nhân viên', employee_code: null, current_kpi_target: 40 };
                const kpiTarget = user.current_kpi_target > 0 ? user.current_kpi_target : 40;

                // Lấy lệnh để parse lại text
                const wfResult = await pool.query(`SELECT command_trigger FROM telegram_workflows WHERE group_id = $1`, [report.group_id]);
                const command_trigger = wfResult.rows[0]?.command_trigger || '#baocao';

                const parsedJSON = parseReport(report.raw_text, command_trigger);

                const debt_info = {
                    missing: report.required_photos - report.received_photos,
                    received: report.received_photos,
                    required: report.required_photos
                };

                // Chuyển status thành DONE_WITH_DEBT
                await pool.query(`UPDATE pending_reports SET status = 'DONE_WITH_DEBT' WHERE telegram_id = $1`, [report.telegram_id]);

                // Gọi processReport đẩy lên DB và Google Sheet với debt_info
                await processReport(user, parsedJSON, kpiTarget, report.telegram_id, report.group_id, report.raw_text, null, bot, debt_info);
            }
            // Nếu còn <= 5 phút (Cảnh báo đỏ) - Chỉ nhắc 1 lần (stage < 2)
            else if (diffMinutes <= 5 && report.last_reminder_stage < 2) {
                const userResult = await pool.query(`SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1`, [report.telegram_id]);
                const fullName = userResult.rows[0]?.full_name || 'Nhân viên';

                await pool.query(`UPDATE pending_reports SET last_reminder_stage = 2 WHERE telegram_id = $1`, [report.telegram_id]);
                bot.telegram.sendMessage(report.group_id, `🚨 CẢNH BÁO CHÓT: ${fullName} ơi, còn đúng ${diffMinutes} phút nữa là hết hạn nộp ảnh! Bạn đang thiếu ${report.required_photos - report.received_photos} ảnh nữa.`);
            }
            // Nếu còn <= 15 phút (Nhắc nhở giữa kỳ) - Chỉ nhắc 1 lần (stage < 1)
            else if (diffMinutes <= 15 && report.last_reminder_stage < 1) {
                const userResult = await pool.query(`SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1`, [report.telegram_id]);
                const fullName = userResult.rows[0]?.full_name || 'Nhân viên';

                await pool.query(`UPDATE pending_reports SET last_reminder_stage = 1 WHERE telegram_id = $1`, [report.telegram_id]);
                bot.telegram.sendMessage(report.group_id, `⚠️ Nhắc nhở: ${fullName} mới tải lên được ${report.received_photos}/${report.required_photos} ảnh. Bạn còn ${diffMinutes} phút để hoàn thành nhé.`);
            }
            // Nhắc nhở nếu đã nộp ảnh nhưng im lặng 5 phút
            else if (report.received_photos > 0 && report.received_photos < report.required_photos && !report.inactivity_reminded && report.last_photo_received_at) {
                const lastPhotoTime = new Date(report.last_photo_received_at);
                const inactiveMinutes = Math.floor((now - lastPhotoTime) / 60000);
                if (inactiveMinutes >= 5) {
                    const userResult = await pool.query(`SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1`, [report.telegram_id]);
                    const fullName = userResult.rows[0]?.full_name || 'Nhân viên';

                    await pool.query(`UPDATE pending_reports SET inactivity_reminded = true WHERE telegram_id = $1`, [report.telegram_id]);
                    bot.telegram.sendMessage(report.group_id, `⚠️ Nhắc nhở: ${fullName} ơi, hệ thống đã ghi nhận ${report.received_photos}/${report.required_photos} ảnh. Còn thiếu ${report.required_photos - report.received_photos} ảnh nữa nhưng đã 5 phút không thấy bạn nộp thêm. Vui lòng gửi nốt để hoàn thành báo cáo nhé!`);
                }
            }
        }
    } catch (err) {
        console.error("Lỗi khi chạy Cronjob đếm giờ:", err);
    }
});

if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE') {
    bot.catch((err, ctx) => {
        console.error(`Lỗi Telegraf cho update ${ctx?.updateType}:`, err);
        process.exit(1); // Ép PM2 khởi động lại để khôi phục polling
    });

    // Auto-update Global Menu Button when bot starts
    bot.telegram.callApi('setChatMenuButton', {
        menu_button: {
            type: 'web_app',
            text: '📝 Điền Báo Cáo',
            web_app: { url: process.env.MINI_APP_URL + "/mini-app/form.html" }
        }
    }).then(() => {
        console.log('[LOG] Đã tự động cập nhật nút Menu Button với URL mới!');
    }).catch(err => {
        console.error('[ERROR] Không thể cập nhật Menu Button:', err.message);
    });

    // Chạy bot
    bot.launch().then(() => {
        console.log("Bot is running and Cron jobs are scheduled.");
    }).catch(err => {
        console.error("Lỗi khi khởi động bot:", err);
        process.exit(1); // Ép PM2 khởi động lại nếu mạng bị kẹt lúc start
    });

} else {
    console.log('TELEGRAM_BOT_TOKEN is missing or invalid.');
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

import express from 'express';
import cors from 'cors';

const botApp = express();
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
    if (isNaN(age) || age > 86400000 || age < -300000) { // 24h expiration
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

        req.body.telegram_id = verifiedId;
        req.query.telegram_id = verifiedId;
        req.query.telegramId = verifiedId;
        req.body.telegramId = verifiedId;

        const groupId = req.query.chatId || req.body.chatId;
        const ts = req.query.ts || req.body.ts;
        const sig = req.query.sig || req.body.sig;
        const action = req.query.action || req.body.action;

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
            } catch (err) {
                console.error('[Auth] Error verifying group membership:', err);
                return res.status(403).json({ success: false, message: 'Không thể xác thực quyền hạn của bạn trong nhóm!' });
            }
        }

        next();
    } catch (err) {
        console.error('[Auth Middleware Error]:', err);
        return res.status(500).json({ success: false, message: 'Lỗi xác thực hệ thống.' });
    }
}

botApp.get('/api/bot/get-report-today', authenticateTelegramMiniApp, async (req, res) => {
    console.log('GET REPORT TODAY CALLED:', req.query);
    try {
        let { telegramId, chatId } = req.query;
        if (!telegramId || !chatId) {
            return res.status(400).json({ success: false });
        }

        chatId = chatId.toString().split('_')[0];

        const userResult = await pool.query('SELECT id FROM employees WHERE telegram_id = $1 LIMIT 1', [telegramId.toString()]);
        if (userResult.rows.length === 0) {
            return res.json({ success: false });
        }
        const employeeId = userResult.rows[0].id;

        const today = new Date().toISOString().split('T')[0];

        // 1. Kiểm tra pending_reports trước (vì đây là báo cáo mới nhất đang chờ ảnh)
        let rawText = null;
        const pendingResult = await pool.query(
            `SELECT raw_text FROM pending_reports 
             WHERE telegram_id = $1 AND group_id = $2 AND status = 'WAITING_PHOTOS'
             LIMIT 1`,
            [telegramId.toString(), chatId.toString()]
        );

        if (pendingResult.rows.length > 0) {
            rawText = pendingResult.rows[0].raw_text;
        } else {
            // 2. Nếu không có pending, kiểm tra daily_reports
            const reportResult = await pool.query(
                `SELECT raw_text FROM daily_reports 
                 WHERE telegram_group_id = $1 AND employee_id = $2 AND report_date = $3
                 ORDER BY id DESC LIMIT 1`,
                [chatId.toString(), employeeId, today]
            );
            if (reportResult.rows.length > 0) {
                rawText = reportResult.rows[0].raw_text;
            }
        }

        if (rawText) {

            // Extract using regex directly
            let tinNhan = '0';
            const tinNhanMatch = rawText.match(/(?:tin nhắn|tin gửi|tin gui).*?:\s*(\d+)/i);
            if (tinNhanMatch) tinNhan = tinNhanMatch[1];

            let doanhThu = '0';
            const doanhThuMatch = rawText.match(/(?:doanh thu|doanh số|số ds).*?:\s*(.+)/i);
            if (doanhThuMatch) doanhThu = doanhThuMatch[1].trim();

            let lichKhach = '';
            const lines = rawText.split('\n');
            let isParsingLichKhach = false;
            let lichKhachLines = [];
            for (const line of lines) {
                if (line.toLowerCase().includes('lịch khách')) {
                    isParsingLichKhach = true;
                    const parts = line.split(':');
                    if (parts.length > 1 && parts[1].trim() !== '') {
                        lichKhachLines.push(parts[1].trim());
                    }
                    continue;
                }
                if (isParsingLichKhach) {
                    if (line.trim() === '' || line.match(/^(số tin|doanh thu|báo cáo)/i)) {
                        isParsingLichKhach = false;
                    } else {
                        lichKhachLines.push(line.trim());
                    }
                }
            }
            lichKhach = lichKhachLines.join('\n');

            return res.json({ success: true, data: { tinNhan, doanhThu, lichKhach } });
        }

        return res.json({ success: false });
    } catch (err) {
        console.error('Lỗi khi lấy báo cáo cũ:', err);
        res.status(500).json({ success: false });
    }
});

// Định nghĩa hàm đẩy dữ liệu sang Sheet Khách Hàng
async function pushCustomersToSheet(dataArray, userInfo) {
    // Bỏ qua lưu vào Sheet Lịch Khách Hàng đối với form báo cáo hàng ngày theo yêu cầu.
    // Dữ liệu khách hàng vẫn sẽ được lưu chung trong text của Báo Cáo ở Sheet KPI chính.
    return;
}

botApp.get('/schedule', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'schedule.html'));
});

// SCHEDULE APIs
botApp.get('/api/schedules', async (req, res) => {
    try {
        const { date } = req.query; // YYYY-MM-DD
        const result = await pool.query(
            `SELECT id, employee_name, customer_name, phone, service, appointment_time, status, cancel_reason
             FROM customer_appointments 
             WHERE DATE(appointment_time) = $1 AND status = 'ACTIVE'
             ORDER BY appointment_time ASC`,
            [date]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
});

botApp.get('/api/schedules/search', async (req, res) => {
    try {
        const { phone } = req.query;
        const result = await pool.query(
            `SELECT id, employee_name, customer_name, phone, service, sessions, appointment_time, status, cancel_reason 
             FROM customer_appointments 
             WHERE phone ILIKE $1
             ORDER BY appointment_time DESC LIMIT 20`,
            [`%${phone}%`]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Check if a schedule overlaps within 1 hour
async function checkOverlap(appointmentTimeStr, excludeId = null) {
    const query = `
        SELECT id, employee_name, customer_name, appointment_time 
        FROM customer_appointments 
        WHERE status = 'ACTIVE' 
        AND appointment_time BETWEEN ($1::timestamp - INTERVAL '59 minutes') AND ($1::timestamp + INTERVAL '59 minutes')
        ${excludeId ? 'AND id != $2' : ''}
        LIMIT 1
    `;
    const params = excludeId ? [appointmentTimeStr, excludeId] : [appointmentTimeStr];
    const res = await pool.query(query, params);
    return res.rows.length > 0 ? res.rows[0] : null;
}

function isValidSessions(val) {
    if (!val) return true;
    const cleanVal = val.trim().toLowerCase();
    if (cleanVal === '0') return true;
    if (cleanVal.includes('/')) {
        const parts = cleanVal.split('/');
        if (parts.length !== 2) return false;
        const left = parts[0].trim();
        const right = parts[1].trim();
        if (!/^\d+$/.test(left)) return false;
        if (/^\d+$/.test(right)) return true;
        if (right === 'tái khám' || right === 'tai kham') return true;
        return false;
    }
    return false;
}

botApp.post('/api/schedules/add', async (req, res) => {
    try {
        const { initData, customer_name, phone, service, sessions, revenue, appointment_time, is_urgent } = req.body;

        if (sessions && !isValidSessions(sessions)) {
            return res.json({
                success: false,
                error: "Định dạng Số Buổi Làm chưa đúng! Vui lòng điền dạng X/Y (ví dụ: 2/10) hoặc X/Tái khám (ví dụ: 1/Tái khám)."
            });
        }
        // Authenticate via initData here if needed, skipping for brevity
        const parsedData = new URLSearchParams(initData);
        let userStr = parsedData.get('user');
        const startParam = parsedData.get('start_param') || '';
        let groupId = 'MINI_APP';
        if (startParam.startsWith('schedule_')) {
            const parts = startParam.split('_');
            if (parts.length >= 3) groupId = parts[1];
        }

        if (!userStr) return res.status(401).json({ success: false, error: "Unauthorized" });
        const tgUser = JSON.parse(decodeURIComponent(userStr));

        // Check overlap
        if (!is_urgent) {
            const overlap = await checkOverlap(appointment_time);
            if (overlap) {
                const timeOverlap = new Date(overlap.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                return res.json({
                    success: false,
                    error: `Khung giờ này đã có nhân viên ${overlap.employee_name} đặt lịch cho khách ${overlap.customer_name} lúc ${timeOverlap}. Vui lòng chọn giờ cách ít nhất 1 tiếng!`
                });
            }
        }

        const eRes = await pool.query('SELECT full_name, employee_code FROM employees WHERE telegram_id = $1 LIMIT 1', [tgUser.id.toString()]);
        const employeeName = eRes.rows.length > 0 ? eRes.rows[0].full_name : tgUser.first_name;
        const employeeCode = eRes.rows.length > 0 && eRes.rows[0].employee_code ? eRes.rows[0].employee_code : '';

        const isRemindedVal = is_urgent ? true : false;

        // Insert
        const insertRes = await pool.query(
            `INSERT INTO customer_appointments (telegram_id, employee_name, group_id, customer_name, phone, service, sessions, revenue, appointment_time, is_reminded, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE') RETURNING id`,
            [tgUser.id.toString(), employeeName, groupId, customer_name, phone, service, sessions, revenue, appointment_time, isRemindedVal]
        );
        const newId = insertRes.rows[0].id;

        // Sync to Sheet
        if (customerDoc) {
            customerSheetQueue = customerSheetQueue.then(async () => {
                await customerDoc.loadInfo();
                const headers = ['Ngày', 'Nhân Viên', 'Mã NV', 'Khách Hàng', 'SĐT', 'Dịch Vụ', 'Buổi Làm', 'Thời Gian', 'Trạng Thái', 'Lý Do Hủy', 'Thu Tiền'];
                // --- OLD CODE COMMENTED OUT B/C SEPARATE TABS FOR EACH EMP ---
                // let sheet = customerDoc.sheetsByTitle['Lịch Khách Hàng'];
                // if (!sheet) sheet = await customerDoc.addSheet({ headerValues: headers, title: 'Lịch Khách Hàng' });
                // else await sheet.setHeaderRow(headers);

                let sheet = customerDoc.sheetsByTitle[employeeName];
                if (!sheet) sheet = await customerDoc.addSheet({ headerValues: headers, title: employeeName });
                else await sheet.setHeaderRow(headers);

                const row = await sheet.addRow({
                    'Ngày': new Date().toLocaleString('vi-VN'),
                    'Nhân Viên': employeeName,
                    'Mã NV': employeeCode,
                    'Khách Hàng': customer_name,
                    'SĐT': phone,
                    'Dịch Vụ': service || '',
                    'Buổi Làm': sessions || '',
                    'Thời Gian': new Date(appointment_time).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }),
                    'Trạng Thái': 'Chờ khách',
                    'Lý Do Hủy': '',
                    'Thu Tiền': revenue || ''
                });
                await pool.query('UPDATE customer_appointments SET sheet_row_index = $1 WHERE id = $2', [row.rowNumber, newId]);
            }).catch(err => console.error("Lỗi sync Google Sheet add:", err));
        }

        // Send immediate alert if is_urgent is true
        if (is_urgent) {
            try {
                let targetGroups = [];
                if (groupId && groupId !== 'MINI_APP') {
                    targetGroups.push(groupId);
                } else {
                    const groupsRes = await pool.query('SELECT group_id FROM schedule_notification_groups');
                    for (const g of groupsRes.rows) targetGroups.push(g.group_id);
                }
                const timeStr = new Date(appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                const revenueLine = revenue ? `💰 Thu tiền: ${revenue}\n` : '';
                const msg = `🚨 <b>BÁO ĐỘNG LỊCH KHÁCH ĐI LUÔN</b> 🚨\n\n` +
                    `⏰ Giờ hẹn: <b>${timeStr}</b>\n` +
                    `👤 Khách hàng: <b>${customer_name}</b> (SĐT: ${phone})\n` +
                    `💇 Dịch vụ: ${service || ''} - Buổi: ${sessions || ''}\n` +
                    revenueLine +
                    `💼 Nhân viên chốt: <b>${employeeName}</b>\n\n` +
                    `👉 <i>KTV vui lòng chuẩn bị đón khách</i>`;

                for (const gId of targetGroups) {
                    await bot.telegram.sendMessage(gId, msg, {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '✅ Đã đến', callback_data: `arr_${newId}` },
                                    { text: '❌ Hủy lịch/ Rời lịch', callback_data: `can_${newId}` }
                                ]
                            ]
                        }
                    });
                }
            } catch (tgErr) {
                console.error("Lỗi gửi tin nhắn khách khẩn cấp:", tgErr);
            }
        }

        res.json({ success: true, message: "Đăng ký lịch thành công!" });
    } catch (e) {
        console.error("Lỗi add schedule:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

botApp.post('/api/schedules/edit', async (req, res) => {
    try {
        const { id, customer_name, phone, service, sessions, appointment_time } = req.body;

        // Check overlap excluding this id
        const overlap = await checkOverlap(appointment_time, id);
        if (overlap) {
            const timeOverlap = new Date(overlap.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            return res.json({
                success: false,
                error: `Khung giờ mới bị trùng! Nhân viên ${overlap.employee_name} đã đặt lịch cho khách ${overlap.customer_name} lúc ${timeOverlap}.`
            });
        }

        const dbRes = await pool.query(
            `UPDATE customer_appointments 
             SET customer_name = $1, phone = $2, appointment_time = $3, is_reminded = FALSE, status = 'ACTIVE'
             WHERE id = $4 RETURNING sheet_row_index, employee_name`,
            [customer_name, phone, appointment_time, id]
        );
        const rowIndex = dbRes.rows[0]?.sheet_row_index;
        const empName = dbRes.rows[0]?.employee_name;

        if (rowIndex && customerDoc) {
            customerSheetQueue = customerSheetQueue.then(async () => {
                await customerDoc.loadInfo();
                // const sheet = customerDoc.sheetsByTitle['Lịch Khách Hàng'];
                const sheet = customerDoc.sheetsByTitle[empName];
                if (sheet) {
                    await sheet.loadCells(`D${rowIndex}:E${rowIndex}`); // Only load D and E
                    await sheet.loadCells(`H${rowIndex}:H${rowIndex}`); // And H (time)

                    sheet.getCell(rowIndex - 1, 3).value = customer_name; // 3 = D
                    sheet.getCell(rowIndex - 1, 4).value = phone;         // 4 = E
                    // Skip F and G (service and sessions)
                    sheet.getCell(rowIndex - 1, 7).value = new Date(appointment_time).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }); // 7 = H
                    await sheet.saveUpdatedCells();
                }
            }).catch(err => console.error("Lỗi sync Google Sheet edit:", err));
        }

        res.json({ success: true, message: "Sửa lịch thành công!" });
    } catch (e) {
        console.error("Lỗi edit schedule:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

botApp.post('/api/schedules/cancel', async (req, res) => {
    try {
        const { id, cancel_reason } = req.body;
        const dbRes = await pool.query(
            `UPDATE customer_appointments SET status = 'CANCELLED', cancel_reason = $1 WHERE id = $2 RETURNING sheet_row_index, employee_name`,
            [cancel_reason, id]
        );
        const rowIndex = dbRes.rows[0]?.sheet_row_index;
        const empName = dbRes.rows[0]?.employee_name;

        if (rowIndex && customerDoc) {
            customerSheetQueue = customerSheetQueue.then(async () => {
                await customerDoc.loadInfo();
                // const sheet = customerDoc.sheetsByTitle['Lịch Khách Hàng'];
                const sheet = customerDoc.sheetsByTitle[empName];
                if (sheet) {
                    await sheet.loadCells(`I${rowIndex}:J${rowIndex}`);
                    sheet.getCell(rowIndex - 1, 8).value = 'Đã hủy';   // 8 = I
                    sheet.getCell(rowIndex - 1, 9).value = cancel_reason; // 9 = J
                    await sheet.saveUpdatedCells();
                }
            }).catch(err => console.error("Lỗi sync Google Sheet cancel:", err));
        }

        res.json({ success: true, message: "Đã hủy lịch!" });
    } catch (e) {
        console.error("Lỗi cancel schedule:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

botApp.post('/api/bot/submit-report', authenticateTelegramMiniApp, async (req, res) => {
    try {
        let { telegramId, chatId, tinNhan, doanhThu, lichKhach, customersData, images } = req.body;
        if (!telegramId || !chatId) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin xác thực.' });
        }

        chatId = chatId.toString().split('_')[0];

        // Lấy thông tin user từ DB
        const userResult = await pool.query('SELECT * FROM employees WHERE telegram_id = $1 LIMIT 1', [telegramId.toString()]);
        if (userResult.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Bạn chưa dùng lệnh /setup để đăng ký tài khoản.' });
        }
        const user = userResult.rows[0];

        // 1. Kiểm tra cấu hình nhóm
        const wfResult = await pool.query('SELECT command_trigger FROM telegram_workflows WHERE group_id = $1', [chatId.toString()]);
        const command_trigger = wfResult.rows[0]?.command_trigger || '#baocao';
        let is_photo_required = true; // Luôn yêu cầu ảnh nếu có KPI thực tế > 0 theo logic cũ

        let remind_time_1 = '17:00:00';
        const settingsResult = await pool.query(`SELECT remind_time_1 FROM group_settings WHERE telegram_group_id = $1`, [chatId.toString()]);
        if (settingsResult.rows.length > 0 && settingsResult.rows[0].remind_time_1) {
            remind_time_1 = settingsResult.rows[0].remind_time_1;
        }

        const finalReportText =
            `${command_trigger}
Số tin nhắn: ${tinNhan}
Doanh thu: ${doanhThu}
Lịch khách:
${lichKhach}`;

        const parsedJSON = parseReport(finalReportText, command_trigger);

        if (!parsedJSON.is_valid) {
            return res.status(400).json({ success: false, message: parsedJSON.error_msg || 'Báo cáo sai cú pháp. Vui lòng kiểm tra lại.' });
        }

        // Lưu lịch khách hàng vào DB để nhắc nhở
        if (customersData && Array.isArray(customersData)) {
            for (const c of customersData) {
                if (c.thoiGianRaw) {
                    try {
                        const aptTime = new Date(c.thoiGianRaw);
                        if (!isNaN(aptTime.getTime())) {
                            const existing = await pool.query(
                                `SELECT id FROM customer_appointments 
                                 WHERE telegram_id = $1 AND customer_name = $2 AND phone = $3
                                 AND DATE(appointment_time) = DATE($4) LIMIT 1`,
                                [user.telegram_id, c.ten, c.sdt, aptTime]
                            );

                            if (existing.rows.length > 0) {
                                // Nếu đã tồn tại thì cập nhật lại giờ và các thông tin khác
                                await pool.query(
                                    `UPDATE customer_appointments 
                                     SET appointment_time = $1, phone = $2, service = $3, sessions = $4, is_reminded = FALSE
                                     WHERE id = $5`,
                                    [aptTime, c.sdt, c.dv, c.soBuoi, existing.rows[0].id]
                                );
                            } else {
                                // Thêm mới
                                await pool.query(
                                    `INSERT INTO customer_appointments (telegram_id, employee_name, group_id, customer_name, phone, service, sessions, appointment_time, is_reminded)
                                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)`,
                                    [user.telegram_id, user.full_name, chatId.toString(), c.ten, c.sdt, c.dv, c.soBuoi, aptTime]
                                );
                            }
                        }
                    } catch (e) {
                        console.error('Lỗi parse ngày hẹn:', e);
                    }
                }
            }
        }

        const kpiTarget = user.current_kpi_target > 0 ? user.current_kpi_target : 40;

        // Xử lý Ghi đè (Tính toán số ảnh còn thiếu so với báo cáo cũ)
        const today = new Date().toISOString().split('T')[0];
        const oldReportResult = await pool.query(
            `SELECT kpi_actual FROM daily_reports 
             WHERE telegram_group_id = $1 AND employee_id = $2 AND report_date = $3
             ORDER BY id DESC LIMIT 1`,
            [chatId.toString(), user.id, today]
        );
        const old_kpi = oldReportResult.rows.length > 0 ? oldReportResult.rows[0].kpi_actual : 0;

        let new_photos_needed = parsedJSON.kpi_actual - old_kpi;
        if (new_photos_needed < 0) new_photos_needed = 0; // Nếu giảm số đi thì không cần nộp thêm ảnh

        // Xử lý gửi ảnh từ form lên Group
        let sentPhotos = 0;
        let hashedImages = [];

        if (images && Array.isArray(images) && images.length > 0) {
            try {
                // Telegram API giới hạn tối đa 10 ảnh mỗi MediaGroup
                for (let i = 0; i < images.length; i += 10) {
                    const chunk = images.slice(i, i + 10);
                    const mediaGroup = chunk.map((base64str, idx) => {
                        const base64Data = base64str.replace(/^data:image\/\w+;base64,/, '');
                        return {
                            type: 'photo',
                            media: { source: Buffer.from(base64Data, 'base64') },
                            caption: (i === 0 && idx === 0) ? `📸 Ảnh đính kèm từ Báo cáo của ${user.full_name}` : ''
                        };
                    });

                    let successChunk = false;
                    let retries = 0;
                    let sentMessages = null;
                    while (!successChunk && retries < 3) {
                        try {
                            sentMessages = await bot.telegram.sendMediaGroup(chatId.toString(), mediaGroup);
                            successChunk = true;
                        } catch (err) {
                            if (err.response && err.response.error_code === 429) {
                                const retryAfter = err.response.parameters.retry_after || 10;
                                console.log(`[Rate Limit] Bị chặn gửi ảnh, tự động chờ ${retryAfter} giây...`);
                                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                                retries++;
                            } else {
                                console.error(`[Error] Bị chặn gửi ảnh tại chunk ${i}:`, err.message);
                                break;
                            }
                        }
                    }

                    if (!successChunk) {
                        console.error('Đã ngừng gửi các ảnh còn lại do lỗi API Telegram.');
                        break;
                    }

                    sentPhotos += chunk.length;

                    // Thu thập vân tay và mã file_id để lưu lịch sử
                    if (sentMessages && sentMessages.length > 0) {
                        const hashPromises = chunk.map(async (base64str, idx) => {
                            const base64Data = base64str.replace(/^data:image\/\w+;base64,/, '');
                            const hashVal = await computeHashFromBase64(base64Data);
                            const photoArray = sentMessages[idx]?.photo;
                            const file_id = (photoArray && photoArray.length > 0) ? photoArray[photoArray.length - 1].file_id : null;
                            return { index: i + idx + 1, hash: hashVal, file_id: file_id };
                        });
                        const results = await Promise.all(hashPromises);
                        hashedImages.push(...results);
                    }

                    // Nghỉ 5 giây giữa các mảng 10 ảnh (tăng từ 3s lên 5s cho an toàn)
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }

                // --- ĐỐI CHIẾU VÀ BÁO CÁO ẢNH TRÙNG LẶP ---
                if (hashedImages.length > 0) {
                    const duplicates = await findDuplicateImages(pool, hashedImages);
                    if (duplicates.length > 0) {
                        let warnMsg = `🚨 <b>PHÁT HIỆN NGHI VẤN XÀI LẠI ẢNH CŨ</b> 🚨\n`;
                        warnMsg += `👤 Nhân viên nộp: <b>${user.full_name}</b>\n\n`;

                        const mediaWarnGroup = [];
                        for (const dup of duplicates) {
                            const dateStr = new Date(dup.old_date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                            warnMsg += `⚠️ Ảnh thứ ${dup.new_index} giống ${dup.similarity}% với ảnh của <b>${dup.old_employee}</b> nộp lúc ${dateStr}.\n`;

                            mediaWarnGroup.push({ type: 'photo', media: dup.old_file_id, caption: `BẢN GỐC của ${dup.old_employee} nộp ${dateStr}` });
                            mediaWarnGroup.push({ type: 'photo', media: dup.new_file_id, caption: `BẢN MỚI do ${user.full_name} nộp hôm nay` });
                        }
                        warnMsg += `\n<i>👇 Mời Sếp xem đối chiếu ảnh bên dưới:</i>`;

                        await bot.telegram.sendMessage(chatId.toString(), warnMsg, { parse_mode: 'HTML' });
                        if (mediaWarnGroup.length > 0) {
                            await bot.telegram.sendMediaGroup(chatId.toString(), mediaWarnGroup.slice(0, 10)); // Giới hạn 10 ảnh gửi 1 lúc
                        }
                    }
                    // Lưu dữ liệu vân tay mới vào DB
                    await saveHashesToDB(pool, user.id, hashedImages);
                }

            } catch (e) {
                console.error('Lỗi gửi ảnh từ form (bị bắt ở catch ngoài):', e);
            }
        }

        const remaining_photos = new_photos_needed - sentPhotos;

        if (remaining_photos <= 0 || !is_photo_required) {
            const formattedDate = new Date().toLocaleDateString('vi-VN');
            await processReport(user, parsedJSON, kpiTarget, telegramId.toString(), chatId.toString(), finalReportText, null, bot);
            // Đã đủ ảnh -> Đẩy sang Sheet Khách Hàng
            await pushCustomersToSheet(customersData, user);
            await bot.telegram.sendMessage(chatId.toString(),
                `👤 <b>Cập nhật báo cáo: ${user.full_name} ngày ${formattedDate}</b>\n` +
                `💬 Số tin: ${tinNhan}\n` +
                `💰 Doanh thu: ${parsedJSON.doanh_thu.toLocaleString('vi-VN')}đ\n` +
                `📅 Lịch khách:\n${lichKhach}\n` +
                `✅ Đã lưu lên hệ thống thành công (Đã nhận đủ ảnh)!`,
                { parse_mode: 'HTML' }
            );

            // Xóa pending_report nếu có để tránh nhắc nhở sau này (nếu họ vừa nộp đủ qua form)
            await pool.query(`DELETE FROM pending_reports WHERE telegram_id = $1`, [telegramId.toString()]);

        } else {
            // Cần nộp THÊM ảnh (chưa đủ hoặc chưa gửi ảnh nào)
            const [h, m, s] = remind_time_1.split(':').map(Number);
            let deadlineDate = new Date();
            deadlineDate.setHours(h, m + 120, 0, 0);

            const minDeadline = new Date(Date.now() + 5 * 60 * 1000);
            const deadline_at = deadlineDate > minDeadline ? deadlineDate : minDeadline;

            await pool.query(
                `INSERT INTO pending_reports 
                (telegram_id, group_id, raw_text, kpi_actual, required_photos, received_photos, deadline_at, status, last_reminder_stage, customers_data) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'WAITING_PHOTOS', 0, $8)
                ON CONFLICT (telegram_id) DO UPDATE SET
                    group_id = EXCLUDED.group_id,
                    raw_text = EXCLUDED.raw_text,
                    kpi_actual = EXCLUDED.kpi_actual,
                    required_photos = EXCLUDED.required_photos,
                    received_photos = $6,
                    deadline_at = EXCLUDED.deadline_at,
                    status = 'WAITING_PHOTOS',
                    last_reminder_stage = 0,
                    customers_data = EXCLUDED.customers_data`,
                [telegramId.toString(), chatId.toString(), finalReportText, parsedJSON.kpi_actual, new_photos_needed, sentPhotos, deadline_at, JSON.stringify(customersData || [])]
            );

            const formattedDate = new Date().toLocaleDateString('vi-VN');
            const strReceived = sentPhotos > 0 ? `(Đã tải lên form: ${sentPhotos} ảnh) ` : '';
            await bot.telegram.sendMessage(chatId.toString(),
                `👤 <b>Cập nhật báo cáo: ${user.full_name} ngày ${formattedDate}</b>\n` +
                `💬 Số tin nhắn: ${tinNhan}\n` +
                `💰 Doanh thu: ${parsedJSON.doanh_thu.toLocaleString('vi-VN')}đ\n` +
                `📅 Lịch khách:\n${lichKhach}\n\n` +
                `⏳ Hệ thống đã ghi nhận.\n` +
                `📸 ${strReceived}VUI LÒNG GỬI THÊM ĐÚNG ${remaining_photos} ẢNH MINH CHỨNG VÀO NHÓM NÀY.\n` +
                `⏰ Hạn chót nộp ảnh: ${deadline_at.toLocaleTimeString('vi-VN')} để chốt số liệu!`,
                { parse_mode: 'HTML' }
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Lỗi khi submit report từ form:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});
// CRON: 20h02 tối báo cáo lịch khách hàng ngày mai
cron.schedule('2 20 * * *', async () => {
    try {
        const groupsRes = await pool.query('SELECT group_id FROM schedule_notification_groups');
        if (groupsRes.rows.length === 0) return;

        const tomorrowStr = new Date(Date.now() + 86400000).toLocaleDateString('vi-VN');
        const apsRes = await pool.query(
            `SELECT * 
             FROM customer_appointments 
             WHERE DATE(appointment_time) = CURRENT_DATE + INTERVAL '1 day' AND status = 'ACTIVE'
             ORDER BY appointment_time ASC`
        );
        if (apsRes.rows.length === 0) return;

        let msg = `🌅 <b>BÁO CÁO LỊCH KHÁCH HÀNG NGÀY MAI (${tomorrowStr})</b>\n\n`;
        apsRes.rows.forEach(a => {
            const timeStr = new Date(a.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const revenueStr = a.revenue ? ` - Thu tiền: ${a.revenue}` : '';
            msg += `⏰ <b>${timeStr}</b> | Khách: ${a.customer_name} (${a.phone})\n`;
            msg += `   └ NV: ${a.employee_name} - DV: ${a.service} - Buổi: ${a.sessions}${revenueStr}\n\n`;
        });

        for (const g of groupsRes.rows) {
            await bot.telegram.sendMessage(g.group_id, msg, { parse_mode: 'HTML' });
        }
    } catch (e) {
        console.error('Lỗi cron 20h02 lịch ngày mai:', e);
    }
});

// CRON: 22h đêm tổng kết lịch khách hàng đã qua
cron.schedule('0 22 * * *', async () => {
    try {
        const groupsRes = await pool.query('SELECT group_id FROM schedule_notification_groups');
        if (groupsRes.rows.length === 0) return;

        const apsRes = await pool.query(
            `SELECT * 
             FROM customer_appointments 
             WHERE DATE(appointment_time) = CURRENT_DATE
             ORDER BY appointment_time ASC`
        );
        if (apsRes.rows.length === 0) return;

        let msg = `🌙 <b>TỔNG KẾT LỊCH KHÁCH HÀNG HÔM NAY (${new Date().toLocaleDateString('vi-VN')})</b>\n\n`;
        apsRes.rows.forEach(a => {
            const timeStr = new Date(a.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const revenueStr = a.revenue ? ` - Thu tiền: ${a.revenue}` : '';
            let statusText = '';
            if (a.status === 'ACTIVE') statusText = ' (Chờ khách)';
            else if (a.status === 'ARRIVED') statusText = ' (Đã đến)';
            else if (a.status === 'CANCELLED') statusText = ' (Đã hủy)';

            msg += `⏰ <b>${timeStr}</b> | Khách: ${a.customer_name} (${a.phone})${statusText}\n`;
            msg += `   └ NV: ${a.employee_name} - DV: ${a.service} - Buổi: ${a.sessions}${revenueStr}\n\n`;
        });

        for (const g of groupsRes.rows) {
            await bot.telegram.sendMessage(g.group_id, msg, { parse_mode: 'HTML' });
        }
    } catch (e) {
        console.error('Lỗi cron 22h đêm lịch khách:', e);
    }
});

// CRON: Nhắc nhở khi tới giờ (quét mỗi phút)
cron.schedule('* * * * *', async () => {
    try {
        const groupsRes = await pool.query('SELECT group_id FROM schedule_notification_groups');
        const defaultGroups = groupsRes.rows.map(g => g.group_id);
        if (defaultGroups.length === 0) return;

        const apsRes = await pool.query(
            `SELECT * 
             FROM customer_appointments 
             WHERE (is_reminded = FALSE OR is_reminded IS NULL) AND status = 'ACTIVE'
             AND appointment_time BETWEEN (NOW() - INTERVAL '1 minute') AND (NOW() + INTERVAL '1 minute')`
        );

        for (const a of apsRes.rows) {
            const timeStr = new Date(a.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const revenueLine = a.revenue ? `💰 Thu tiền: ${a.revenue}\n` : '';
            const msg = `🚨 <b>BÁO ĐỘNG LỊCH KHÁCH HÀNG ĐẾN GIỜ</b> 🚨\n\n` +
                `⏰ Giờ hẹn: <b>${timeStr}</b>\n` +
                `👤 Khách hàng: <b>${a.customer_name}</b> (SĐT: ${a.phone})\n` +
                `💇 Dịch vụ: ${a.service} - Buổi: ${a.sessions}\n` +
                revenueLine +
                `💼 Nhân viên phụ trách: <b>${a.employee_name}</b>\n\n` +
                `👉 <i>Vui lòng chuẩn bị đón khách!</i>`;

            let targetGroups = [];
            if (a.group_id && a.group_id !== 'MINI_APP') {
                targetGroups.push(a.group_id);
            } else {
                targetGroups = defaultGroups;
            }

            for (const gId of targetGroups) {
                await bot.telegram.sendMessage(gId, msg, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Đã đến', callback_data: `arr_${a.id}` },
                                { text: '❌ Hủy lịch/ Rời lịch', callback_data: `can_${a.id}` }
                            ]
                        ]
                    }
                });
            }

            // Cập nhật trạng thái đã nhắc
            await pool.query('UPDATE customer_appointments SET is_reminded = TRUE WHERE id = $1', [a.id]);
        }
    } catch (e) {
        console.error('Lỗi cron nhắc lịch khách đúng giờ:', e);
    }
});

// Xử lý nút bấm thông báo khách đến
bot.action(/^arr_(\d+)$/, async (ctx) => {
    try {
        const id = ctx.match[1];

        // Check permission
        const aptRes = await pool.query('SELECT telegram_id FROM customer_appointments WHERE id = $1', [id]);
        if (aptRes.rows.length === 0) {
            return ctx.answerCbQuery('Không tìm thấy lịch hẹn này!', { show_alert: true });
        }
        if (aptRes.rows[0].telegram_id !== ctx.from.id.toString()) {
            return ctx.answerCbQuery('Chỉ người đăng ký lịch này mới được ấn xác nhận Đã đến!', { show_alert: true });
        }

        const dbRes = await pool.query('UPDATE customer_appointments SET status = $1, is_photo_debt = TRUE WHERE id = $2 RETURNING sheet_row_index, employee_name', ['ARRIVED', id]);

        const rowIndex = dbRes.rows[0]?.sheet_row_index;
        const empName = dbRes.rows[0]?.employee_name;

        if (rowIndex && customerDoc) {
            customerSheetQueue = customerSheetQueue.then(async () => {
                await customerDoc.loadInfo();
                // const sheet = customerDoc.sheetsByTitle['Lịch Khách Hàng'];
                const sheet = customerDoc.sheetsByTitle[empName];
                if (sheet) {
                    await sheet.loadCells(`I${rowIndex}:I${rowIndex}`); // Trạng Thái column
                    sheet.getCell(rowIndex - 1, 8).value = 'Đã đến';
                    await sheet.saveUpdatedCells();
                }
            }).catch(err => console.error("Lỗi sync Google Sheet arr:", err));
        }

        const originalMsg = ctx.callbackQuery.message.text || '';
        const newMsg = `✅ <b>ĐÃ ĐẾN</b> ✅\n\n` + originalMsg + `\n\n⚠️ <b>LƯU Ý:</b> Bạn đang NỢ 1 ẢNH BẰNG CHỨNG cho khách này!\n👉 Hãy vào <b>Bảng Tiện Ích (/app) ➔ Nhiệm Vụ</b> để tải ảnh lên nhé!\n\n🆔 Mã Lịch: #${id}`;

        await ctx.editMessageText(newMsg, { parse_mode: 'HTML' });
        await ctx.answerCbQuery('Đã cập nhật trạng thái: Đã đến!');
    } catch (e) {
        console.error('Lỗi nút Đã đến:', e);
        await ctx.answerCbQuery('Có lỗi xảy ra!');
    }
});

bot.action(/^can_(\d+)$/, async (ctx) => {
    try {
        const id = ctx.match[1];

        // Check permission
        const aptRes = await pool.query('SELECT telegram_id FROM customer_appointments WHERE id = $1', [id]);
        if (aptRes.rows.length === 0) {
            return ctx.answerCbQuery('Không tìm thấy lịch hẹn này!', { show_alert: true });
        }
        if (aptRes.rows[0].telegram_id !== ctx.from.id.toString()) {
            return ctx.answerCbQuery('Chỉ người đăng ký lịch này mới được phép ấn Hủy lịch!', { show_alert: true });
        }

        const originalMsg = ctx.callbackQuery.message.text || '';
        await ctx.editMessageText(originalMsg + '\n\n👇 <b>VUI LÒNG CHỌN LÝ DO HỦY:</b>', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👻 Khách bom lịch', callback_data: `cr_bom_${id}` }],
                    [{ text: '📅 Bận đột xuất / Xin dời ngày', callback_data: `cr_ban_${id}` }],
                    [{ text: '💸 Chưa đủ tài chính / Chê đắt', callback_data: `cr_tien_${id}` }],
                    [{ text: '🏃 Đã qua cơ sở khác', callback_data: `cr_khacspa_${id}` }],
                    [{ text: '✍️ Lý do khác (Vào App)', callback_data: `cr_app_${id}` }],
                    [{ text: '⬅️ Quay lại', callback_data: `cr_back_${id}` }]
                ]
            }
        });
        await ctx.answerCbQuery();
    } catch (e) {
        console.error('Lỗi nút Hủy:', e);
        await ctx.answerCbQuery('Có lỗi xảy ra!');
    }
});

bot.action(/^cr_back_(\d+)$/, async (ctx) => {
    try {
        const id = ctx.match[1];
        let originalMsg = ctx.callbackQuery.message.text || '';
        originalMsg = originalMsg.replace('\n\n👇 VUI LÒNG CHỌN LÝ DO HỦY:', '');

        await ctx.editMessageText(originalMsg, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Đã đến', callback_data: `arr_${id}` },
                        { text: '❌ Hủy lịch/ Rời lịch', callback_data: `can_${id}` }
                    ]
                ]
            }
        });
    } catch (e) {
        console.error('Lỗi nút Quay lại:', e);
    }
});

bot.action(/^cr_(bom|ban|tien|khacspa|app)_(\d+)$/, async (ctx) => {
    try {
        const type = ctx.match[1];
        const id = ctx.match[2];

        if (type === 'app') {
            return ctx.answerCbQuery('Vui lòng mở Hệ thống (Mini App) để gõ lý do khác nhé!', { show_alert: true });
        }

        let reason = '';
        if (type === 'bom') reason = 'Khách bom lịch (Không nghe, chặn số)';
        if (type === 'ban') reason = 'Bận đột xuất / Xin dời ngày';
        if (type === 'tien') reason = 'Chưa đủ tài chính / Chê đắt';
        if (type === 'khacspa') reason = 'Đã qua cơ sở khác làm';

        const dbRes = await pool.query('UPDATE customer_appointments SET status = $1, cancel_reason = $2 WHERE id = $3 RETURNING sheet_row_index, employee_name', ['CANCELLED', reason, id]);

        const rowIndex = dbRes.rows[0]?.sheet_row_index;
        const empName = dbRes.rows[0]?.employee_name;

        if (rowIndex && customerDoc) {
            customerSheetQueue = customerSheetQueue.then(async () => {
                await customerDoc.loadInfo();
                const sheet = customerDoc.sheetsByTitle[empName];
                if (sheet) {
                    await sheet.loadCells(`I${rowIndex}:J${rowIndex}`);
                    sheet.getCell(rowIndex - 1, 8).value = 'Đã hủy';
                    sheet.getCell(rowIndex - 1, 9).value = reason;
                    await sheet.saveUpdatedCells();
                }
            }).catch(err => console.error("Lỗi sync Google Sheet can:", err));
        }

        let originalMsg = ctx.callbackQuery.message.text || '';
        originalMsg = originalMsg.replace('\n\n👇 VUI LÒNG CHỌN LÝ DO HỦY:', '');
        const newMsg = `❌ <b>ĐÃ HỦY/ RỜI LỊCH</b> ❌\nLý do: ${reason}\n\n` + originalMsg;

        await ctx.editMessageText(newMsg, { parse_mode: 'HTML' });
        await ctx.answerCbQuery('Đã cập nhật trạng thái: Đã hủy/ Rời lịch!');
    } catch (e) {
        console.error('Lỗi nút Lý do Hủy:', e);
        await ctx.answerCbQuery('Có lỗi xảy ra!');
    }
});

botApp.get('/api/photo-debts', async (req, res) => {
    try {
        const { date, telegram_id } = req.query; // optional

        let query = `
            SELECT id, customer_name, employee_name, appointment_time, service, status, is_photo_debt, proof_image 
            FROM customer_appointments 
            WHERE is_photo_debt = TRUE AND status = 'ARRIVED'
        `;
        let params = [];
        let paramCount = 1;

        if (date) {
            query += ` AND DATE(appointment_time) = $${paramCount}`;
            params.push(date);
            paramCount++;
        }
        if (telegram_id) {
            query += ` AND telegram_id = $${paramCount}`;
            params.push(telegram_id);
            paramCount++;
        }
        query += ` ORDER BY appointment_time DESC`;

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Lỗi API lấy nợ ảnh:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

botApp.post('/api/upload-proof', async (req, res) => {
    try {
        const { id, imageBase64 } = req.body;
        if (!id || !imageBase64) {
            return res.status(400).json({ success: false, error: 'Thiếu dữ liệu ảnh' });
        }

        const aptRes = await pool.query('SELECT * FROM customer_appointments WHERE id = $1', [id]);
        if (aptRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy lịch hẹn' });
        const apt = aptRes.rows[0];

        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        // MimeType mặc định
        const match = imageBase64.match(/^data:(image\/\w+);base64,/);
        const mimeType = match ? match[1] : 'image/jpeg';

        const timestamp = Date.now();
        const filename = `Proof_${apt.id}_${timestamp}.jpg`;

        // Upload Local Storage
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, buffer);

        const proofUrl = process.env.MINI_APP_URL + '/mini-app/uploads/' + filename;

        // Cập nhật DB
        await pool.query(
            'UPDATE customer_appointments SET is_photo_debt = FALSE, proof_image = $1 WHERE id = $2',
            [proofUrl, id]
        );

        // Cập nhật Google Sheet
        const rowIndex = apt.sheet_row_index;
        const empName = apt.employee_name;
        if (rowIndex && customerDoc) {
            customerSheetQueue = customerSheetQueue.then(async () => {
                await customerDoc.loadInfo();
                const sheet = customerDoc.sheetsByTitle[empName];
                if (sheet) {
                    await sheet.loadCells(`L${rowIndex}:L${rowIndex}`); // Giả sử cột L (cột thứ 12) là Ảnh Chứng Thực
                    sheet.getCell(rowIndex - 1, 11).value = proofUrl; // Index 11 là cột L
                    await sheet.saveUpdatedCells();
                }
            }).catch(err => console.error("Lỗi sync Google Sheet upload ảnh:", err));
        }

        // Gửi thông báo ảnh lên Telegram Group
        try {
            const timeStr = new Date(apt.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            let targetGroup = apt.group_id;
            if (!targetGroup || targetGroup === 'MINI_APP') {
                const groupsRes = await pool.query('SELECT group_id FROM schedule_notification_groups LIMIT 1');
                if (groupsRes.rows.length > 0) targetGroup = groupsRes.rows[0].group_id;
            }
            if (targetGroup) {
                const caption = `📸 <b>ĐÃ NHẬN ẢNH BẰNG CHỨNG</b> 📸\n\n` +
                    `👤 Khách hàng: <b>${apt.customer_name}</b> (Lúc ${timeStr})\n` +
                    `💼 KTV: <b>${apt.employee_name}</b>\n\n` +
                    `✅ <i>Đã lưu ảnh vào hệ thống thành công!</i>`;
                await bot.telegram.sendPhoto(targetGroup, { source: buffer }, { caption: caption, parse_mode: 'HTML' });
            }
        } catch (tgErr) {
            console.error('Lỗi gửi ảnh chứng thực lên Telegram:', tgErr);
        }

        res.json({ success: true, proof_image: proofUrl });
    } catch (err) {
        console.error('Lỗi upload ảnh chứng thực:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
// Lắng nghe nhân viên reply ảnh trực tiếp trên Telegram
bot.on('photo', async (ctx) => {
    try {
        const replyMsg = ctx.message.reply_to_message;
        if (!replyMsg || replyMsg.from.id !== ctx.botInfo.id) return;

        const text = replyMsg.text || replyMsg.caption || '';
        if (!text.includes('ĐÃ ĐẾN')) return;

        // Cố gắng tìm Mã Lịch nếu có (cho tương lai)
        let aptId = null;
        const idMatch = text.match(/Mã Lịch: #(\d+)/);
        if (idMatch) {
            aptId = idMatch[1];
        } else {
            // Cho các tin nhắn cũ
            const regex = /Khách hàng:\s*(.+)\s*\(SĐT:\s*(\d+)\)/;
            const match = text.match(regex);
            if (match) {
                const customer_name = match[1].trim();
                const phone = match[2].trim();
                const aptRes = await pool.query(
                    "SELECT id FROM customer_appointments WHERE customer_name = $1 AND phone = $2 AND status = 'ARRIVED' AND is_photo_debt = TRUE ORDER BY appointment_time DESC LIMIT 1",
                    [customer_name, phone]
                );
                if (aptRes.rows.length > 0) {
                    aptId = aptRes.rows[0].id;
                }
            }
        }

        if (!aptId) {
            return ctx.reply('⚠️ Không tìm thấy thông tin lịch hẹn hoặc ảnh này đã được nộp!', { reply_to_message_id: ctx.message.message_id });
        }

        const aptRes = await pool.query('SELECT * FROM customer_appointments WHERE id = $1 AND is_photo_debt = TRUE', [aptId]);
        if (aptRes.rows.length === 0) {
            return ctx.reply('⚠️ Ảnh chứng thực cho lịch này đã được nộp trước đó!', { reply_to_message_id: ctx.message.message_id });
        }
        const apt = aptRes.rows[0];

        // Lấy file_id lớn nhất (độ phân giải cao nhất)
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);

        // Tải ảnh về buffer
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        const resPhoto = await fetch(fileLink.href);
        const buffer = Buffer.from(await resPhoto.arrayBuffer());

        // Lưu vào Local Storage
        const timestamp = Date.now();
        const filename = `Proof_${apt.id}_${timestamp}.jpg`;
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, buffer);

        const proofUrl = process.env.MINI_APP_URL + '/mini-app/uploads/' + filename;

        // Cập nhật DB
        await pool.query(
            'UPDATE customer_appointments SET is_photo_debt = FALSE, proof_image = $1 WHERE id = $2',
            [proofUrl, aptId]
        );

        // Cập nhật Google Sheet
        const rowIndex = apt.sheet_row_index;
        const empName = apt.employee_name;
        if (rowIndex && customerDoc) {
            customerSheetQueue = customerSheetQueue.then(async () => {
                await customerDoc.loadInfo();
                const sheet = customerDoc.sheetsByTitle[empName];
                if (sheet) {
                    await sheet.loadCells(`L${rowIndex}:L${rowIndex}`);
                    sheet.getCell(rowIndex - 1, 11).value = proofUrl;
                    await sheet.saveUpdatedCells();
                }
            }).catch(err => console.error("Lỗi sync Google Sheet upload ảnh (Telegram):", err));
        }

        // Reply báo thành công
        const timeStr = new Date(apt.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        await ctx.reply(`✅ <b>ĐÃ LƯU ẢNH CHỨNG THỰC (TỪ TELEGRAM)</b> ✅\n\n👤 Khách hàng: <b>${apt.customer_name}</b> (Lúc ${timeStr})\n💼 KTV: <b>${apt.employee_name}</b>\n\n<i>Ảnh đã được tự động đồng bộ vào kho dữ liệu và Google Sheet!</i>`, { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });

    } catch (e) {
        console.error('Lỗi nhận ảnh từ Telegram:', e);
        ctx.reply('❌ Có lỗi xảy ra khi lưu ảnh, vui lòng tải lên bằng Mini App!', { reply_to_message_id: ctx.message.message_id });
    }
});

botApp.listen(3002, () => console.log('Bot Mini-App Server is running on port 3002'));
