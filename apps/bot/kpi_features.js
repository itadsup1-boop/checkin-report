import express from 'express';
import moment from 'moment';
import cors from 'cors';
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
import { Composer } from 'telegraf';
import { requireGroupRole, getGroupRole, sendMessageToRoleGroup, sendPhotoToRoleGroup, sendMediaGroupToRoleGroup } from './role_guard.js';
import { REPORT_BOT_HELP_HTML } from './user_guide_report.js';
import {
    getEmployeeMembership,
    registerEmployeeInKpiGroup
} from '../../packages/shared/kpiMembership.js';

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
const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || 'hybrid-flame-499905-r2-3034c23f309c.json';
const credsPath = path.isAbsolute(keyFile) ? keyFile : path.join(__dirname, '../../', keyFile);
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || 'SPREADSHEET_ID_CHUA_CAI_DAT';
const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

const CUSTOMER_SPREADSHEET_ID = process.env.CUSTOMER_SPREADSHEET_ID;
const TOUR_SPREADSHEET_ID = process.env.TOUR_SPREADSHEET_ID;
let customerDoc = null;
if (CUSTOMER_SPREADSHEET_ID) {
    customerDoc = new GoogleSpreadsheet(CUSTOMER_SPREADSHEET_ID, serviceAccountAuth);
}
let tourDoc = null;
if (TOUR_SPREADSHEET_ID) {
    tourDoc = new GoogleSpreadsheet(TOUR_SPREADSHEET_ID, serviceAccountAuth);
}
let customerSheetQueue = Promise.resolve();

let sheetQueue = Promise.resolve();

export function setupKpiBot(bot, botApp) {
    const kpiComposer = new Composer();

    async function getCustomerSheetTarget(groupId, employeeName) {
        const role = groupId && groupId !== 'MINI_APP' ? await getGroupRole(groupId) : null;
        const isTour = role === 'report_tour';
        const targetDoc = isTour ? tourDoc : customerDoc;
        const sheetSuffix = isTour ? ' [Tour]' : '';
        return {
            doc: targetDoc,
            role,
            sheetName: `${employeeName}${sheetSuffix}`.substring(0, 100)
        };
    }

    async function writeToGoogleSheets(groupId, employeeName, rowData) {
        const target = await getCustomerSheetTarget(groupId, employeeName);
        if (!target.doc) {
            console.warn(`[Customer Sheet] group_id=${groupId} status=skipped reason=spreadsheet_not_configured`);
            return null;
        }
        await target.doc.loadInfo();
        const headers = ['Ngày', 'Nhân Viên', 'Mã NV', 'Khách Hàng', 'SĐT', 'Dịch Vụ', 'Buổi Làm', 'Thời Gian', 'Trạng Thái', 'Lý Do Hủy', 'Thu Tiền', 'Ảnh Chứng Thực'];
        
        // Ghi vào Sheet Tổng Hợp
        const masterSheetName = target.role === 'report_tour' ? 'TỔNG HỢP TOUR' : 'TỔNG HỢP KHÁCH HÀNG';
        let masterSheet = target.doc.sheetsByTitle[masterSheetName];
        if (!masterSheet) masterSheet = await target.doc.addSheet({ headerValues: headers, title: masterSheetName });
        else await masterSheet.setHeaderRow(headers);
        await masterSheet.addRow(rowData);

        // Ghi vào Sheet Cá Nhân
        let individualSheet = target.doc.sheetsByTitle[target.sheetName];
        if (!individualSheet) individualSheet = await target.doc.addSheet({ headerValues: headers, title: target.sheetName });
        else await individualSheet.setHeaderRow(headers);
        const row = await individualSheet.addRow(rowData);
        
        return row.rowNumber;
    }

    function getEffectiveKpiTarget(user, fallback = 40) {
        if (!user || user.need_report === false) return 0;
        if (user.current_kpi_target === null || user.current_kpi_target === undefined || user.current_kpi_target === '') {
            return fallback;
        }
        const target = Number(user.current_kpi_target);
        return Number.isFinite(target) && target > 0 ? target : 0;
    }

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

    kpiComposer.command('myid', (ctx) => {
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

            // Chỉ áp dụng cho các nhóm role = 'report' (không áp dụng cho report_tour)
            const query = `
            SELECT tg.telegram_group_id, tg.group_name, gs.remind_time_1, gs.deadline_time, gs.penalty_missing_report
            FROM telegram_groups tg
            LEFT JOIN group_settings gs ON tg.telegram_group_id = gs.telegram_group_id
            WHERE tg.is_active = true
              AND tg.bot_role = 'report'
              AND COALESCE(tg.is_deleted, false) = false
        `;
            const res = await pool.query(query);
            const groups = res.rows;

            for (const group of groups) {
                // 1. Nhắc nhở nộp báo cáo
                const remindTime = group.remind_time_1 || '17:00:00';
                if (remindTime === currentTimeString) {
                    console.log(`⏰ Đến giờ nhắc nhở cho nhóm: ${group.group_name}`);

                    const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().split('T')[0];
                    const empRes = await pool.query(`
                        SELECT e.full_name, e.telegram_id, e.id
                        FROM employee_group_memberships m
                        JOIN employees e ON e.id = m.employee_id
                        WHERE e.is_active = true
                          AND e.telegram_id IS NOT NULL
                          AND m.telegram_group_id = $1
                          AND m.status = 'ACTIVE'
                          AND m.need_report = true
                          AND COALESCE(m.current_kpi_target, 0) > 0
                          AND LOWER(e.role) NOT IN ('quản lý', 'quản lý kho', 'admin')
                    `, [group.telegram_group_id]);

                    const repRes = await pool.query(`
                        SELECT e.telegram_id FROM daily_reports dr
                        JOIN employees e ON dr.employee_id = e.id
                        WHERE dr.report_date = $1
                          AND dr.telegram_group_id = $2
                    `, [todayStr, group.telegram_group_id]);
                    
                    const offRes = await pool.query(`
                        SELECT e.telegram_id FROM tk_schedules s
                        JOIN employees e ON s.user_id = e.id
                        WHERE s.date = $1 AND UPPER(s.shift_type) = 'OFF'
                    `, [todayStr]);
                    
                    const leaveRes = await pool.query(`
                        SELECT e.telegram_id FROM tk_leave_requests l
                        JOIN employees e ON l.user_id = e.id
                        WHERE l.date = $1 AND l.status IN ('approved', 'pending')
                    `, [todayStr]);

                    const exemptedOrReportedTgIds = new Set([
                        ...repRes.rows.map(r => r.telegram_id),
                        ...offRes.rows.map(r => r.telegram_id),
                        ...leaveRes.rows.map(r => r.telegram_id)
                    ].filter(Boolean));

                    const missing = empRes.rows.filter(e => !exemptedOrReportedTgIds.has(e.telegram_id));
                    if (missing.length > 0) {
                        const names = missing.map(m => m.full_name).join(', ');
                        await sendMessageToRoleGroup(bot, group.telegram_group_id, ['report', 'report_tour'], `⚠️ ĐÃ ĐẾN GIỜ BÁO CÁO KPI!\nDanh sách chưa nộp: ${names}\n⏰ Các bạn có đúng 2 tiếng nữa để nộp trước khi hệ thống chốt phạt tiền!`, {}, 'kpi_daily_reminder');
                    } else {
                        await sendMessageToRoleGroup(bot, group.telegram_group_id, ['report', 'report_tour'], `🎉 Tuyệt vời! Tất cả nhân sự đã nộp báo cáo đúng hạn ngày hôm nay.`, {}, 'kpi_all_reported');
                    }
                }

                // 2. Chốt sổ phạt sau deadline 2 tiếng
                if (group.remind_time_1) {
                    const [h, m, s] = group.remind_time_1.split(':').map(Number);
                    let penaltyDate = new Date();
                    penaltyDate.setHours(h, m + 120, 0, 0);

                    const penaltyHour = String(penaltyDate.getHours()).padStart(2, '0');
                    const penaltyMinute = String(penaltyDate.getMinutes()).padStart(2, '0');
                    const penaltyTimeString = `${penaltyHour}:${penaltyMinute}:00`;

                    if (currentTimeString === penaltyTimeString) {
                        const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().split('T')[0];
                        const empRes = await pool.query(`
                            SELECT e.full_name, e.telegram_id, e.employee_code, e.id,
                                   m.current_kpi_target
                            FROM employee_group_memberships m
                            JOIN employees e ON e.id = m.employee_id
                            WHERE e.is_active = true
                              AND e.telegram_id IS NOT NULL
                              AND m.telegram_group_id = $1
                              AND m.status = 'ACTIVE'
                              AND m.need_report = true
                              AND COALESCE(m.current_kpi_target, 0) > 0
                              AND LOWER(e.role) NOT IN ('quản lý', 'quản lý kho', 'admin')
                        `, [group.telegram_group_id]);

                        const repRes = await pool.query(`
                            SELECT e.telegram_id FROM daily_reports dr
                            JOIN employees e ON dr.employee_id = e.id
                            WHERE dr.report_date = $1
                              AND dr.telegram_group_id = $2
                        `, [todayStr, group.telegram_group_id]);
                        
                        const offRes = await pool.query(`
                            SELECT e.telegram_id FROM tk_schedules s
                            JOIN employees e ON s.user_id = e.id
                            WHERE s.date = $1 AND UPPER(s.shift_type) = 'OFF'
                        `, [todayStr]);
                        
                        const leaveRes = await pool.query(`
                            SELECT e.telegram_id FROM tk_leave_requests l
                            JOIN employees e ON l.user_id = e.id
                            WHERE l.date = $1 AND l.status IN ('approved', 'pending')
                        `, [todayStr]);

                        const exemptedOrReportedTgIds = new Set([
                            ...repRes.rows.map(r => r.telegram_id),
                            ...offRes.rows.map(r => r.telegram_id),
                            ...leaveRes.rows.map(r => r.telegram_id)
                        ].filter(Boolean));

                        const missing = empRes.rows.filter(e => !exemptedOrReportedTgIds.has(e.telegram_id));
                        if (missing.length > 0) {
                            const parsedAmount = parseFloat(group.penalty_missing_report);
                            const amount = isNaN(parsedAmount) ? 100000 : parsedAmount;
                            let penaltyMsg = amount > 0 ? `\n💸 Phạt: -${amount.toLocaleString('vi-VN')}đ / người` : '';
                            const names = missing.map(m => m.full_name).join(', ');

                            await sendMessageToRoleGroup(bot, group.telegram_group_id, ['report', 'report_tour'], `⛔ ĐÃ HẾT THỜI GIAN ÂN HẠN!\nDanh sách KHÔNG nộp báo cáo: ${names}${penaltyMsg}\n📋 Hệ thống đã lưu vào sổ đen cuối tháng!`, {}, 'kpi_grace_period_expired');

                            // Đã loại bỏ logPenaltyToSheet ở đây vì ngay bên dưới đã có khối push data lên Sheet đầy đủ hơn

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
                                                'Số tin nhắn (KPI)': Number(e.current_kpi_target),
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
    kpiComposer.command('hengio', async (ctx) => {
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

    const pendingReports = new Map();

    async function processReport(user, parsedJSON, kpiTarget, telegram_id, group_id, text, ctx, botInstance = null, debt_info = null) {
        try {
            kpiTarget = getEffectiveKpiTarget(user, kpiTarget);
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

            const reportRoles = ['report', 'report_tour'];

            if (debt_info) {
                let debtMsg = `🚨 BÁO CÁO GHI NỢ ẢNH!\nĐã lưu báo cáo của ${user.full_name} lên hệ thống.\n⚠️ Tình trạng: Thiếu ${debt_info.missing} ảnh minh chứng (Nộp ${debt_info.received}/${debt_info.required}).${penaltyKpiMsg}`;
                if (total_penalty > 0) {
                    debtMsg += `\n🔥 Mức phạt vi phạm: -${total_penalty.toLocaleString('vi-VN')}đ (Đã tính trọn gói 1 lần/ngày)`;
                }
                debtMsg += `\nSếp sẽ kiểm tra và trừ thưởng cuối tháng!`;

                const tgBot = botInstance || ctx;
                if (tgBot) {
                    await sendMessageToRoleGroup(tgBot, group_id, reportRoles, debtMsg, {}, 'report_debt_photos');
                }
            } else if (text === 'XIN NGHỈ') {
                const tgBot = botInstance || ctx;
                if (tgBot) {
                    await sendMessageToRoleGroup(tgBot, group_id, reportRoles, `✅ Đã ghi nhận: ${user.full_name} xin nghỉ phép hôm nay!\nHệ thống sẽ miễn báo cáo cho bạn.`, {}, 'report_leave_notice');
                }
            } else {
                const tgBot = botInstance || ctx;
                if (tgBot) {
                    await sendMessageToRoleGroup(tgBot, group_id, reportRoles, `✅ Đã nhận đủ ảnh minh chứng!\nĐã lưu báo cáo của ${user.full_name}.${kpiMsg}${penaltyKpiMsg}\n💾 Hệ thống đã ghi nhận thành công!`, {}, 'report_complete_notice');
                }
            }
            console.log(`[LOG] Đã lưu báo cáo của ${user.full_name} vào DB và đưa vào hàng đợi Sheet.`);

        } catch (error) {
            console.error("Lỗi khi lưu báo cáo:", error);
            ctx.reply(`⚠️ Có lỗi xảy ra khi lưu hệ thống. Đội kỹ thuật đang xử lý!`);
        }
    }

    // Xử lý khi nhận được ảnh/video minh chứng
    kpiComposer.on(['photo', 'video'], async (ctx, next) => {
        const telegram_id = ctx.message.from.id.toString();
        const group_id = ctx.chat.id.toString();

        try {
            // --- CHỐT CHẶN VÂN TAY CHO ẢNH GỬI TRỰC TIẾP ---
            const user = await getEmployeeMembership(pool, telegram_id, group_id, { activeOnly: true });

            if (!user) {
                return next();
            }

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

                                await sendMessageToRoleGroup(bot, ctx.chat.id, ['report', 'report_tour'], warnMsg, { parse_mode: 'HTML' }, 'direct_duplicate_photo_warning_msg');
                                await sendMediaGroupToRoleGroup(bot, ctx.chat.id, ['report', 'report_tour'], [
                                    { type: 'photo', media: dup.old_file_id, caption: `BẢN GỐC của ${dup.old_employee} nộp ${dateStr}` },
                                    { type: 'photo', media: dup.new_file_id, caption: `BẢN MỚI do ${user.full_name} gửi lên` }
                                ], {}, 'direct_duplicate_photo_warning_media');
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
             WHERE telegram_id = $1 AND group_id = $2 AND status = 'WAITING_PHOTOS' 
             RETURNING *`,
                [telegram_id, group_id]
            );

            if (updateResult.rows.length > 0) {
                const report = updateResult.rows[0];

                if (report.received_photos >= report.required_photos) {
                    // Đủ ảnh -> Cập nhật thành DONE an toàn
                    const doneResult = await pool.query(
                        `UPDATE pending_reports SET status = 'DONE' WHERE telegram_id = $1 AND group_id = $2 AND status = 'WAITING_PHOTOS' RETURNING telegram_id`,
                        [telegram_id, group_id]
                    );

                    if (doneResult.rowCount > 0) {
                        // Lấy cấu hình KPI đúng theo nhóm chứa pending report.
                        const scopedUser = await getEmployeeMembership(pool, telegram_id, report.group_id, { activeOnly: true });
                        if (!scopedUser) return next();
                        const user = scopedUser;
                        const kpiTarget = getEffectiveKpiTarget(user);

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

    kpiComposer.on('text', async (ctx, next) => {
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

                const user = await getEmployeeMembership(pool, telegram_id, group_id);
                if (!user) {
                    return ctx.reply("❌ Bạn chưa đăng ký hoạt động KPI trong nhóm này. Vui lòng dùng /setup Họ và tên.");
                }
                if (user.is_active === false) {
                    return ctx.reply("⚠️ Tài khoản của bạn đã bị vô hiệu hóa trong hệ thống. Vui lòng liên hệ Admin nếu muốn bật lại.");
                }
                if (user.membership_status === 'PAUSED') {
                    return ctx.reply("⏸ Bạn đang được tạm dừng báo cáo KPI trong nhóm này. Việc đăng ký ở nhóm khác vẫn hoạt động bình thường.");
                }
                const kpiTarget = getEffectiveKpiTarget(user);

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
                    ON CONFLICT (telegram_id, group_id) DO UPDATE SET
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
    kpiComposer.command('phatvipham', async (ctx) => {
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
    kpiComposer.command('phatbaocao', async (ctx) => {
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
    kpiComposer.command('kpi', async (ctx) => {
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
            // Cập nhật KPI riêng cho membership của nhóm hiện tại.
            const result = await pool.query(
                `UPDATE employee_group_memberships
                 SET current_kpi_target = $1, updated_at = NOW(), updated_by = $3
                 WHERE telegram_group_id = $2 AND status = 'ACTIVE'
                 RETURNING employee_id`,
                [newKpi, groupId, `telegram:${ctx.from.id}`]
            );

            if (newKpi === 0) {
                await pool.query(`
                    DELETE FROM pending_reports
                    WHERE group_id = $1
                `, [groupId]);
            }

            ctx.reply(`🎯 Đã cập nhật chỉ tiêu KPI chung cho nhóm là: ${newKpi} tin nhắn/ngày!\n(Đã áp dụng cho ${result.rowCount} nhân viên trong nhóm)`);
        } catch (err) {
            console.error("Lỗi cài đặt KPI:", err);
            ctx.reply("❌ Có lỗi xảy ra: " + err.message);
        }
    });

    // Lệnh thiết lập lịch chốt báo cáo: /lichbaocao 18:00 hoặc 18h
    kpiComposer.command('lichbaocao', async (ctx) => {
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
    kpiComposer.command('taocaulenh', async (ctx) => {
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

    // Lệnh hiển thị danh sách các lệnh hướng dẫn chi tiết
    kpiComposer.command(['help', 'huongdan'], (ctx) => {
        return ctx.replyWithHTML(REPORT_BOT_HELP_HTML);
    });

    kpiComposer.action('START_SETUP_WIZARD', (ctx) => {
        ctx.answerCbQuery();
        return ctx.scene.enter('SETUP_WIZARD');
    });

    kpiComposer.action('REQUEST_LEAVE', async (ctx) => {
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

    kpiComposer.action(/^CANCEL_LEAVE_(\d+)$/, (ctx) => {
        const targetId = ctx.match[1];
        if (ctx.from.id.toString() !== targetId) {
            return ctx.answerCbQuery('❌ Nút này không dành cho bạn!', { show_alert: true });
        }
        ctx.answerCbQuery('Đã hủy thao tác xin nghỉ!');
        ctx.deleteMessage().catch(() => { });
    });

    kpiComposer.action(/^CONFIRM_LEAVE_(\d+)$/, async (ctx) => {
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
            if (user.is_active === false) {
                return ctx.reply("⚠️ Tài khoản của bạn đã bị vô hiệu hóa trong hệ thống. Vui lòng liên hệ Admin nếu muốn bật lại.");
            }

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

    kpiComposer.action('CHECK_UPDATE_REPORT', async (ctx) => {
        ctx.answerCbQuery();
        const telegramId = ctx.from.id.toString();
        const groupId = ctx.chat.id.toString();
        const today = new Date().toISOString().split('T')[0];

        try {
            const userCheck = await pool.query('SELECT is_active FROM employees WHERE telegram_id = $1 LIMIT 1', [telegramId]);
            if (userCheck.rows.length === 0 || userCheck.rows[0].is_active === false) {
                return ctx.reply("⚠️ Tài khoản của bạn đã bị vô hiệu hóa trong hệ thống. Vui lòng liên hệ Admin nếu muốn bật lại.");
            }

            // 1. Kiểm tra pending_reports
            const pendingResult = await pool.query(
                `SELECT telegram_id FROM pending_reports WHERE telegram_id = $1 AND group_id = $2 AND status = 'WAITING_PHOTOS' LIMIT 1`,
                [telegramId, groupId]
            );

            let hasReport = pendingResult.rows.length > 0;

            // 2. Nếu không có pending, kiểm tra daily_reports
            if (!hasReport) {
                const userResult = await pool.query('SELECT id FROM employees WHERE telegram_id = $1 AND is_active = true LIMIT 1', [telegramId]);
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

    // Cronjob quét mỗi 1 phút để nhắc nhở và hủy báo cáo nộp ảnh muộn
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();

            // 1. Tự động xóa tất cả pending_reports của nhân viên bị vô hiệu hóa
            await pool.query(`
            DELETE FROM pending_reports
            WHERE telegram_id IN (
                SELECT telegram_id FROM employees WHERE is_active = false AND telegram_id IS NOT NULL
            )
        `);

            // 2. Chỉ quét pending_reports của các nhân viên ĐANG HOẠT ĐỘNG
            const pendingResult = await pool.query(`
            SELECT pr.* 
            FROM pending_reports pr
            JOIN telegram_groups tg ON tg.telegram_group_id = pr.group_id
            JOIN employees e ON e.telegram_id = pr.telegram_id
            JOIN employee_group_memberships m
              ON m.employee_id = e.id AND m.telegram_group_id = pr.group_id
            WHERE pr.status = 'WAITING_PHOTOS'
              AND tg.bot_role IN ('report', 'report_tour')
              AND tg.is_active = true
              AND COALESCE(tg.is_deleted, false) = false
              AND COALESCE(e.is_active, true) = true
              AND m.status = 'ACTIVE'
              AND m.need_report = true
              AND COALESCE(m.current_kpi_target, 0) > 0
        `);

            for (const report of pendingResult.rows) {
                const deadline = new Date(report.deadline_at);
                const diffMinutes = Math.floor((deadline - now) / 60000);

                // Nếu đã quá hạn
                if (diffMinutes <= 0) {
                    // Lấy thông tin user
                    const user = await getEmployeeMembership(pool, report.telegram_id, report.group_id, { activeOnly: true }) ||
                        { id: null, full_name: 'Nhân viên', employee_code: null, current_kpi_target: 40 };
                    const kpiTarget = getEffectiveKpiTarget(user);

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
                    await pool.query(`UPDATE pending_reports SET status = 'DONE_WITH_DEBT' WHERE telegram_id = $1 AND group_id = $2`, [report.telegram_id, report.group_id]);

                    // Gọi processReport đẩy lên DB và Google Sheet với debt_info
                    await processReport(user, parsedJSON, kpiTarget, report.telegram_id, report.group_id, report.raw_text, null, bot, debt_info);
                }
                // Nếu còn <= 5 phút (Cảnh báo đỏ) - Chỉ nhắc 1 lần (stage < 2)
                else if (diffMinutes <= 5 && report.last_reminder_stage < 2) {
                    const userResult = await pool.query(`SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1`, [report.telegram_id]);
                    const fullName = userResult.rows[0]?.full_name || 'Nhân viên';

                    await pool.query(`UPDATE pending_reports SET last_reminder_stage = 2 WHERE telegram_id = $1 AND group_id = $2`, [report.telegram_id, report.group_id]);
                    await sendMessageToRoleGroup(bot, report.group_id, ['report', 'report_tour'], `🚨 CẢNH BÁO CHÓT: ${fullName} ơi, còn đúng ${diffMinutes} phút nữa là hết hạn nộp ảnh! Bạn đang thiếu ${report.required_photos - report.received_photos} ảnh nữa.`, {}, 'photo_deadline_stage_2');
                }
                // Nếu còn <= 15 phút (Nhắc nhở giữa kỳ) - Chỉ nhắc 1 lần (stage < 1)
                else if (diffMinutes <= 15 && report.last_reminder_stage < 1) {
                    const userResult = await pool.query(`SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1`, [report.telegram_id]);
                    const fullName = userResult.rows[0]?.full_name || 'Nhân viên';

                    await pool.query(`UPDATE pending_reports SET last_reminder_stage = 1 WHERE telegram_id = $1 AND group_id = $2`, [report.telegram_id, report.group_id]);
                    await sendMessageToRoleGroup(bot, report.group_id, ['report', 'report_tour'], `⚠️ Nhắc nhở: ${fullName} mới tải lên được ${report.received_photos}/${report.required_photos} ảnh. Bạn còn ${diffMinutes} phút để hoàn thành nhé.`, {}, 'photo_deadline_stage_1');
                }
                // Nhắc nhở nếu đã nộp ảnh nhưng im lặng 5 phút
                else if (report.received_photos > 0 && report.received_photos < report.required_photos && !report.inactivity_reminded && report.last_photo_received_at) {
                    const lastPhotoTime = new Date(report.last_photo_received_at);
                    const inactiveMinutes = Math.floor((now - lastPhotoTime) / 60000);
                    if (inactiveMinutes >= 5) {
                        const userResult = await pool.query(`SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1`, [report.telegram_id]);
                        const fullName = userResult.rows[0]?.full_name || 'Nhân viên';

                        await pool.query(`UPDATE pending_reports SET inactivity_reminded = true WHERE telegram_id = $1 AND group_id = $2`, [report.telegram_id, report.group_id]);
                        await sendMessageToRoleGroup(bot, report.group_id, ['report', 'report_tour'], `⚠️ Nhắc nhở: ${fullName} ơi, hệ thống đã ghi nhận ${report.received_photos}/${report.required_photos} ảnh. Còn thiếu ${report.required_photos - report.received_photos} ảnh nữa nhưng đã 5 phút không thấy bạn nộp thêm. Vui lòng gửi nốt để hoàn thành báo cáo nhé!`, {}, 'photo_inactivity_reminder');
                    }
                }
            }
        } catch (err) {
            console.error("Lỗi khi chạy Cronjob đếm giờ:", err);
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

    // API KPI endpoints role guard
    botApp.use('/api/bot', async (req, res, next) => {
        const groupId =
            req.body?.telegram_group_id ||
            req.body?.chat_id ||
            req.body?.chatId ||
            req.query?.chat_id ||
            req.query?.chatId ||
            req.query?.telegram_group_id;
        if (groupId) {
            const role = await getGroupRole(groupId);
            if (role !== 'report') {
                return res.status(403).json({
                    success: false,
                    message: 'Nhóm này không được cấu hình chức năng báo cáo KPI.'
                });
            }
        }
        next();
    });

    botApp.get('/api/bot/get-report-today', authenticateTelegramMiniApp, async (req, res) => {
        console.log('GET REPORT TODAY CALLED:', req.query, 'verifiedTelegramId:', req.verifiedTelegramId);
        try {
            const telegramId = req.verifiedTelegramId || req.query.telegramId;
            let { chatId } = req.query;
            if (!telegramId) {
                return res.status(400).json({ success: false, message: 'Thiếu thông tin xác thực.' });
            }

            // Lấy thông tin user sớm để fallback chatId
            const userResult = await pool.query('SELECT id, is_active, telegram_group_id FROM employees WHERE telegram_id = $1 LIMIT 1', [telegramId.toString()]);
            if (userResult.rows.length === 0 || userResult.rows[0].is_active === false) {
                return res.json({ success: false, message: 'Tài khoản của bạn đã bị vô hiệu hóa trong hệ thống.' });
            }
            // Fallback chatId: nếu WebApp mở từ menu toàn cục
            if (!chatId || chatId === 'undefined' || chatId === 'null') {
                chatId = userResult.rows[0].telegram_group_id;
            }
            if (!chatId) {
                return res.status(400).json({ success: false, message: 'Không xác định được nhóm báo cáo.' });
            }

            chatId = chatId.toString().split('_')[0];
            const scopedUser = await getEmployeeMembership(pool, telegramId, chatId);
            if (!scopedUser) {
                return res.status(403).json({ success: false, message: 'Bạn chưa đăng ký KPI trong nhóm này.' });
            }
            if (scopedUser.membership_status !== 'ACTIVE') {
                return res.status(403).json({ success: false, message: 'Bạn đang được tạm dừng KPI trong nhóm này.' });
            }
            const employeeId = scopedUser.id;

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
            const { date, groupId } = req.query; // YYYY-MM-DD
            if (!groupId || groupId === 'MINI_APP') {
                return res.status(400).json({ success: false, error: 'Missing valid groupId' });
            }
            const result = await pool.query(
                `SELECT id, employee_name, customer_name, phone, service, sessions, session_type, today_incurred, doctor, nurse, revenue, appointment_time, status, cancel_reason
                 FROM customer_appointments
                 WHERE (DATE(appointment_time AT TIME ZONE 'Asia/Ho_Chi_Minh') = $1::date OR DATE(appointment_time) = $1::date)
                   AND group_id = $2
                 ORDER BY appointment_time ASC`,
                [date, groupId.toString()]
            );
            res.json({ success: true, data: result.rows });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    botApp.get('/api/schedules/search', async (req, res) => {
        try {
            const { phone, groupId } = req.query;
            if (!groupId) {
                return res.status(400).json({ success: false, error: 'Thiếu groupId' });
            }
            let queryStr = `SELECT id, employee_name, customer_name, phone, service, sessions, appointment_time, status, cancel_reason 
             FROM customer_appointments 
             WHERE phone ILIKE $1 AND group_id = $2`;
             
            if (!phone || phone.trim() === '') {
                queryStr += ` AND (DATE(appointment_time AT TIME ZONE 'Asia/Ho_Chi_Minh') = CURRENT_DATE OR DATE(appointment_time) = CURRENT_DATE) ORDER BY appointment_time ASC`;
            } else {
                queryStr += ` ORDER BY appointment_time DESC LIMIT 20`;
            }
             
            const result = await pool.query(queryStr, [`%${phone || ''}%`, groupId]);
            res.json({ success: true, data: result.rows });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Check if a schedule overlaps within 1 hour (scoped to group)
    async function checkOverlap(appointmentTimeStr, groupId, excludeId = null) {
        const query = `
        SELECT id, employee_name, customer_name, appointment_time 
        FROM customer_appointments 
        WHERE status = 'ACTIVE' 
        AND group_id = $2
        AND appointment_time BETWEEN ($1::timestamp - INTERVAL '59 minutes') AND ($1::timestamp + INTERVAL '59 minutes')
        ${excludeId ? 'AND id != $3' : ''}
        LIMIT 1
    `;
        const params = excludeId ? [appointmentTimeStr, groupId, excludeId] : [appointmentTimeStr, groupId];
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
            const { initData, customer_name, phone, service, sessions, session_type, revenue, today_incurred, doctor, nurse, appointment_time, is_urgent, groupId: requestedGroupId } = req.body;

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
            let groupId = '';
            if (startParam.startsWith('schedule_') || startParam.startsWith('scheduleclient_')) {
                const parts = startParam.split('_');
                if (parts.length >= 2) groupId = parts[1];
            }
            // Fallback: nếu vẫn là MINI_APP, thử lấy group từ employee
            if (!groupId && requestedGroupId) {
                groupId = requestedGroupId.toString();
            }
            if (!groupId || groupId === 'MINI_APP') {
                return res.status(400).json({ success: false, error: 'Cannot determine schedule group' });
            }
            if (requestedGroupId && requestedGroupId.toString() !== groupId) {
                return res.status(403).json({ success: false, error: 'Schedule group does not match context' });
            }

            if (!userStr) return res.status(401).json({ success: false, error: "Unauthorized" });
            const tgUser = JSON.parse(decodeURIComponent(userStr));

            // Check overlap
            if (!is_urgent) {
                const overlap = await checkOverlap(appointment_time, groupId);
                if (overlap) {
                    const timeOverlap = new Date(overlap.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    return res.json({
                        success: false,
                        error: `Khung giờ này đã có nhân viên ${overlap.employee_name} đặt lịch cho khách ${overlap.customer_name} lúc ${timeOverlap}. Vui lòng chọn giờ cách ít nhất 1 tiếng!`
                    });
                }
            }

            let eRes = await pool.query(
                'SELECT full_name, employee_code FROM employees WHERE telegram_id = $1 AND telegram_group_id = $2 LIMIT 1',
                [tgUser.id.toString(), groupId]
            );
            if (eRes.rows.length === 0) {
                eRes = await pool.query(
                    'SELECT full_name, employee_code FROM employees WHERE telegram_id = $1 LIMIT 1',
                    [tgUser.id.toString()]
                );
            }
            if (eRes.rows.length === 0) {
                return res.json({ success: false, error: '⚠️ Tài khoản Telegram của bạn chưa được đăng ký trong danh sách nhân sự. Vui lòng đăng ký nhân sự trước!' });
            }
            const employeeName = eRes.rows.length > 0 ? eRes.rows[0].full_name : tgUser.first_name;
            const employeeCode = eRes.rows.length > 0 && eRes.rows[0].employee_code ? eRes.rows[0].employee_code : '';

            const isRemindedVal = is_urgent ? true : false;
            const sessionTypeVal = session_type || 'Bán';

            const insertRes = await pool.query(
                `INSERT INTO customer_appointments (telegram_id, employee_name, group_id, customer_name, phone, service, sessions, session_type, revenue, today_incurred, doctor, nurse, appointment_time, is_reminded, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ACTIVE') RETURNING id`,
                [tgUser.id.toString(), employeeName, groupId, customer_name, phone, service, sessions, sessionTypeVal, revenue, today_incurred || null, doctor || null, nurse || null, appointment_time, isRemindedVal]
            );
            const newId = insertRes.rows[0].id;

            // Đồng bộ Google Sheet đã được chuyển sang chế độ "Delayed Sync" (chỉ ghi khi hoàn thành hoặc sau 48h)

            // Send immediate alert if is_urgent is true
            if (is_urgent) {
                try {
                    let targetGroupsWithRole = [];
                    if (groupId && groupId !== 'MINI_APP') {
                        const role = await getGroupRole(groupId);
                        if (role === 'report' || role === 'report_tour') {
                            targetGroupsWithRole.push({ gId: groupId, role });
                        }
                    } else {
                        const groupsRes = await pool.query(`
            SELECT s.group_id, g.bot_role
            FROM schedule_notification_groups s
            JOIN telegram_groups g ON s.group_id = g.telegram_group_id
            WHERE g.bot_role IN ('report', 'report_tour') AND g.is_active = true AND COALESCE(g.is_deleted, false) = false
        `);
                        for (const g of groupsRes.rows) targetGroupsWithRole.push({ gId: g.group_id, role: g.bot_role });
                    }
                    const timeStr = new Date(appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    const revenueLine = revenue ? `💰 Thu tiền: ${revenue}\n` : '';
                    const sessionTypeLine = sessionTypeVal ? `🏷 Dạng buổi: <b>${sessionTypeVal}</b>\n` : '';
                    const incurredLine = today_incurred ? `📝 Phát sinh: ${today_incurred}\n` : '';
                    const doctorLine = doctor ? `👨‍⚕️ Bác sĩ: ${doctor}\n` : '';
                    const nurseLine = nurse ? `👩‍⚕️ Điều dưỡng: ${nurse}\n` : '';
                    
                    const msg = `🚨 <b>BÁO ĐỘNG LỊCH KHÁCH ĐI LUÔN</b> 🚨\n\n` +
                        `⏰ Giờ hẹn: <b>${timeStr}</b>\n` +
                        `👤 Khách hàng: <b>${customer_name}</b> (SĐT: ${phone})\n` +
                        `💇 Dịch vụ: ${service || ''} - Buổi: ${sessions || ''}\n` +
                        sessionTypeLine +
                        doctorLine +
                        nurseLine +
                        incurredLine +
                        revenueLine +
                        `💼 Nhân viên chốt: <b>${employeeName}</b>\n\n` +
                        `👉 <i>KTV vui lòng chuẩn bị đón khách</i>`;

                    for (const { gId, role } of targetGroupsWithRole) {
                        const inline_keyboard = [
                            [
                                { text: '✅ Đã đến', callback_data: `arr_${newId}` },
                                { text: '❌ Hủy lịch/ Rời lịch', callback_data: `can_${newId}` }
                            ]
                        ];

                        await sendMessageToRoleGroup(bot, gId, role, msg, {
                            parse_mode: 'HTML',
                            reply_markup: { inline_keyboard }
                        }, 'urgent_schedule_alert');
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

    botApp.get('/api/schedules/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const apsRes = await pool.query(
                `SELECT * FROM customer_appointments WHERE id = $1`,
                [id]
            );
            if (apsRes.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Không tìm thấy lịch hẹn' });
            }
            res.json({ success: true, data: apsRes.rows[0] });
        } catch (e) {
            console.error('Lỗi GET /api/schedules/:id', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    botApp.put('/api/schedules/update', async (req, res) => {
        try {
            const { id, service, revenue, today_incurred, doctor, nurse } = req.body;
            
            const dbRes = await pool.query(
                `UPDATE customer_appointments 
                 SET service = $1, revenue = $2, today_incurred = $3, doctor = $4, nurse = $5
                 WHERE id = $6
                 RETURNING *`,
                [service, revenue, today_incurred || null, doctor || null, nurse || null, id]
            );

            if (dbRes.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Không tìm thấy lịch hẹn' });
            }

            const apt = dbRes.rows[0];

            if (apt.group_id) {
                try {
                    const now = new Date();
                    const aptTime = new Date(apt.appointment_time);
                    
                    // Nếu chưa đến giờ thì KHÔNG gửi thông báo
                    if (aptTime > now) {
                        return res.json({ success: true, data: apt });
                    }

                    const timeStr = aptTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    const revenueLine = apt.revenue ? `💰 Thu tiền: ${apt.revenue}\n` : '';
                    const sessionTypeLine = apt.session_type ? `🏷 Dạng buổi: <b>${apt.session_type}</b>\n` : '';
                    const incurredLine = apt.today_incurred ? `📝 Phát sinh: ${apt.today_incurred}\n` : '';
                    const doctorLine = apt.doctor ? `👨‍⚕️ Bác sĩ: ${apt.doctor}\n` : '';
                    const nurseLine = apt.nurse ? `👩‍⚕️ Điều dưỡng: ${apt.nurse}\n` : '';
                    
                    const msg = `🚨 <b>BÁO CÁO CẬP NHẬT PHÁT SINH</b> 🚨\n\n` +
                        `⏰ Giờ hẹn: <b>${timeStr}</b>\n` +
                        `👤 Khách hàng: <b>${apt.customer_name}</b> (SĐT: ${apt.phone})\n` +
                        `💇 Dịch vụ: ${apt.service || ''} - Buổi: ${apt.sessions || ''}\n` +
                        sessionTypeLine +
                        doctorLine +
                        nurseLine +
                        incurredLine +
                        revenueLine +
                        `💼 Nhân viên chốt: <b>${apt.employee_name}</b>\n\n` +
                        `👉 <i>Bản ghi đã được cập nhật thành công! Vui lòng rep ảnh hoàn thành công tour.</i>`;
                    
                    const roleRes = await pool.query('SELECT bot_role FROM telegram_groups WHERE telegram_group_id = $1', [apt.group_id]);
                    const role = roleRes.rows.length > 0 ? roleRes.rows[0].bot_role : 'report';
                    
                    const inline_keyboard = [ [] ];
                    if (apt.status !== 'ARRIVED') {
                        inline_keyboard[0].push({ text: '✅ Đã đến', callback_data: `arr_${apt.id}` });
                    }
                    inline_keyboard[0].push({ text: '❌ Hủy/ Rời lịch', callback_data: `can_${apt.id}` });
                    
                    const replyMarkup = { inline_keyboard };
                    
                    await sendMessageToRoleGroup(bot, apt.group_id, role, msg, { parse_mode: 'HTML', reply_markup: replyMarkup }, 'urgent_schedule_update');
                } catch (tgErr) {
                    console.error("Lỗi gửi tin báo cáo cập nhật:", tgErr);
                }
            }

            res.json({ success: true, message: 'Cập nhật thành công!' });
        } catch (e) {
            console.error('Lỗi PUT /api/schedules/update', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    botApp.post('/api/schedules/edit', async (req, res) => {
        try {
            const { id, customer_name, phone, service, sessions, appointment_time, groupId } = req.body;

            if (!groupId || groupId === 'MINI_APP') {
                return res.status(400).json({ success: false, error: 'Missing valid groupId' });
            }

            // Lấy group_id từ bản ghi hiện tại để kiểm tra
            const existingRes = await pool.query('SELECT group_id FROM customer_appointments WHERE id = $1', [id]);
            if (existingRes.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Không tìm thấy lịch hẹn' });
            }
            const recordGroupId = existingRes.rows[0]?.group_id;

            // Kiểm tra phân quyền group nếu truyền groupId từ client
            if (recordGroupId !== groupId.toString()) {
                return res.status(403).json({ success: false, error: 'Lịch hẹn thuộc nhóm khác, bạn không có quyền sửa!' });
            }

            const editGroupId = recordGroupId;

            // Check overlap excluding this id (scoped to group)
            const overlap = await checkOverlap(appointment_time, editGroupId, id);
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
             WHERE id = $4 AND group_id = $5 RETURNING sheet_row_index, employee_name`,
                [customer_name, phone, appointment_time, id, groupId.toString()]
            );
            const rowIndex = dbRes.rows[0]?.sheet_row_index;
            const empName = dbRes.rows[0]?.employee_name;

            // Đồng bộ Google Sheet đã được chuyển sang chế độ "Delayed Sync"

            res.json({ success: true, message: "Sửa lịch thành công!" });
        } catch (e) {
            console.error("Lỗi edit schedule:", e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    botApp.post('/api/schedules/cancel', async (req, res) => {
        try {
            const { id, cancel_reason, groupId } = req.body;

            if (!groupId || groupId === 'MINI_APP') {
                return res.status(400).json({ success: false, error: 'Missing valid groupId' });
            }

            const existingRes = await pool.query('SELECT group_id FROM customer_appointments WHERE id = $1', [id]);
            if (existingRes.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Không tìm thấy lịch hẹn' });
            }
            const recordGroupId = existingRes.rows[0]?.group_id;

            if (recordGroupId !== groupId.toString()) {
                return res.status(403).json({ success: false, error: 'Lịch hẹn thuộc nhóm khác, bạn không có quyền hủy!' });
            }

            const dbRes = await pool.query(
                `UPDATE customer_appointments SET status = 'CANCELLED', cancel_reason = $1 WHERE id = $2 AND group_id = $3 RETURNING sheet_row_index, employee_name`,
                [cancel_reason, id, groupId.toString()]
            );
            const rowIndex = dbRes.rows[0]?.sheet_row_index;
            const empName = dbRes.rows[0]?.employee_name;

            // Đồng bộ Google Sheet đã được chuyển sang chế độ "Delayed Sync"

            res.json({ success: true, message: "Đã hủy lịch!" });
        } catch (e) {
            console.error("Lỗi cancel schedule:", e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    botApp.post('/api/bot/submit-report', authenticateTelegramMiniApp, async (req, res) => {
        try {
            let { chatId, tinNhan, doanhThu, lichKhach, customersData, images } = req.body;
            const telegramId = req.verifiedTelegramId || req.body.telegramId;
            if (!telegramId) {
                return res.status(400).json({ success: false, message: 'Thiếu thông tin xác thực.' });
            }

            // Lấy thông tin user từ DB (cần sớm để fallback chatId)
            const userResult = await pool.query('SELECT * FROM employees WHERE telegram_id = $1 LIMIT 1', [telegramId.toString()]);
            if (userResult.rows.length === 0) {
                return res.status(400).json({ success: false, message: 'Bạn chưa dùng lệnh /setup để đăng ký tài khoản.' });
            }
            let user = userResult.rows[0];
            if (user.is_active === false) {
                return res.status(403).json({ success: false, message: 'Tài khoản của bạn đã bị vô hiệu hóa trong hệ thống. Vui lòng liên hệ Admin.' });
            }

            // Fallback chatId: nếu WebApp mở từ menu toàn cục (không có chatId), dùng nhóm mặc định của nhân viên
            if (!chatId || chatId === 'undefined' || chatId === 'null') {
                chatId = user.telegram_group_id;
            }
            if (!chatId) {
                return res.status(400).json({ success: false, message: 'Không xác định được nhóm báo cáo. Vui lòng thử lại từ trong nhóm Telegram.' });
            }

            chatId = chatId.toString().split('_')[0];

            const scopedUser = await getEmployeeMembership(pool, telegramId, chatId);
            if (!scopedUser) {
                return res.status(403).json({ success: false, message: 'Bạn chưa đăng ký KPI trong nhóm này. Vui lòng dùng /setup trong đúng nhóm.' });
            }
            if (scopedUser.membership_status !== 'ACTIVE') {
                return res.status(403).json({ success: false, message: 'Bạn đang được Admin tạm dừng báo cáo KPI trong nhóm này.' });
            }
            user = scopedUser;

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

            const kpiTarget = getEffectiveKpiTarget(user);

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
            const reportRoles = ['report', 'report_tour'];

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
                                sentMessages = await sendMediaGroupToRoleGroup(bot, chatId.toString(), reportRoles, mediaGroup, {}, 'submit_report_photos');
                                if (sentMessages) {
                                    successChunk = true;
                                } else {
                                    console.error(`[Error] Gửi media group bị chặn bởi role guard cho group ${chatId}`);
                                    break;
                                }
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
                            console.error('Đã ngừng gửi các ảnh còn lại do lỗi API Telegram hoặc bị chặn vai trò.');
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
                                warnMsg += `⚠️ Ảnh thứ ${dup.new_index} giống ${dup.similarity}% với ảnh của <b>${dup.old_employee}</b> nộp lúc ${dateStr}\n`;

                                mediaWarnGroup.push({ type: 'photo', media: dup.old_file_id, caption: `BẢN GỐC của ${dup.old_employee} nộp ${dateStr}` });
                                mediaWarnGroup.push({ type: 'photo', media: dup.new_file_id, caption: `BẢN MỚI do ${user.full_name} nộp hôm nay` });
                            }
                            warnMsg += `\n<i>👇 Mời Sếp xem đối chiếu ảnh bên dưới:</i>`;

                            await sendMessageToRoleGroup(bot, chatId.toString(), reportRoles, warnMsg, { parse_mode: 'HTML' }, 'report_duplicate_photo_warning');
                            if (mediaWarnGroup.length > 0) {
                                await sendMediaGroupToRoleGroup(bot, chatId.toString(), reportRoles, mediaWarnGroup.slice(0, 10), {}, 'report_duplicate_photo_media');
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
                const completionMessage = await sendMessageToRoleGroup(bot, chatId.toString(), reportRoles,
                    `👤 <b>Cập nhật báo cáo: ${user.full_name} ngày ${formattedDate}</b>\n` +
                    `💬 Số tin: ${tinNhan}\n` +
                    `💰 Doanh thu: ${parsedJSON.doanh_thu.toLocaleString('vi-VN')}đ\n` +
                    `📅 Lịch khách:\n${lichKhach}\n` +
                    `✅ Đã lưu lên hệ thống thành công (Đã nhận đủ ảnh)!`,
                    { parse_mode: 'HTML' },
                    'submit_report_complete'
                );

                if (!completionMessage) {
                    return res.status(502).json({
                        success: false,
                        reportSaved: true,
                        message: 'Báo cáo đã được lưu nhưng không thể gửi thông báo vào nhóm Telegram. Vui lòng liên hệ Admin kiểm tra trạng thái nhóm và quyền gửi tin của Bot.'
                    });
                }

                // Xóa pending_report nếu có để tránh nhắc nhở sau này (nếu họ vừa nộp đủ qua form)
                await pool.query(`DELETE FROM pending_reports WHERE telegram_id = $1 AND group_id = $2`, [telegramId.toString(), chatId.toString()]);

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
                ON CONFLICT (telegram_id, group_id) DO UPDATE SET
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
                const pendingMessage = await sendMessageToRoleGroup(bot, chatId.toString(), reportRoles,
                    `👤 <b>Cập nhật báo cáo: ${user.full_name} ngày ${formattedDate}</b>\n` +
                    `💬 Số tin nhắn: ${tinNhan}\n` +
                    `💰 Doanh thu: ${parsedJSON.doanh_thu.toLocaleString('vi-VN')}đ\n` +
                    `📅 Lịch khách:\n${lichKhach}\n\n` +
                    `⏳ Hệ thống đã ghi nhận.\n` +
                    `📸 ${strReceived}VUI LÒNG GỬI THÊM ĐÚNG ${remaining_photos} ẢNH MINH CHỨNG VÀO NHÓM NÀY.\n` +
                    `⏰ Hạn chót nộp ảnh: ${deadline_at.toLocaleTimeString('vi-VN')} để chốt số liệu!`,
                    { parse_mode: 'HTML' },
                    'submit_report_waiting_photos'
                );

                if (!pendingMessage) {
                    return res.status(502).json({
                        success: false,
                        reportSaved: true,
                        message: 'Báo cáo đã được ghi nhận nhưng không thể gửi yêu cầu bổ sung ảnh vào nhóm Telegram. Vui lòng liên hệ Admin kiểm tra trạng thái nhóm và quyền gửi tin của Bot.'
                    });
                }
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
            // Opt-out model: gửi cho tất cả nhóm report/report_tour trừ nhóm đã tắt (is_disabled=true)
            const groupsRes = await pool.query(`
            SELECT g.telegram_group_id AS group_id, g.bot_role
            FROM telegram_groups g
            LEFT JOIN schedule_notification_groups s ON s.group_id = g.telegram_group_id
            WHERE g.bot_role IN ('report', 'report_tour') AND g.is_active = true AND COALESCE(g.is_deleted, false) = false
              AND COALESCE(s.is_disabled, false) = false
        `);
            if (groupsRes.rows.length === 0) return;

            const tomorrowStr = new Date(Date.now() + 86400000).toLocaleDateString('vi-VN');

            for (const g of groupsRes.rows) {
                const apsRes = await pool.query(
                    `SELECT * 
                 FROM customer_appointments 
                 WHERE DATE(appointment_time) = CURRENT_DATE + INTERVAL '1 day' AND status = 'ACTIVE' AND group_id = $1
                 ORDER BY appointment_time ASC`,
                    [g.group_id]
                );
                let msg = `🌅 <b>BÁO CÁO LỊCH KHÁCH HÀNG NGÀY MAI (${tomorrowStr})</b>\n\n`;
                if (apsRes.rows.length === 0) {
                    msg += `📭 Hiện tại chưa có lịch hẹn khách hàng nào được đặt cho ngày mai.`;
                } else {
                    apsRes.rows.forEach(a => {
                        const timeStr = new Date(a.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                        const revenueStr = a.revenue ? ` - Thu tiền: ${a.revenue}` : '';
                        const sessionTypeStr = a.session_type ? ` - Dạng buổi: ${a.session_type}` : '';
                        const incurredStr = a.today_incurred ? `\n   └ 📝 Phát sinh: ${a.today_incurred}` : '';
                        const doctorStr = a.doctor ? `\n   └ 👨‍⚕️ Bác sĩ: ${a.doctor}` : '';
                        const nurseStr = a.nurse ? `\n   └ 👩‍⚕️ Điều dưỡng: ${a.nurse}` : '';
                        msg += `⏰ <b>${timeStr}</b> | Khách: ${a.customer_name} (${a.phone})\n`;
                        msg += `   └ NV: ${a.employee_name} - DV: ${a.service} - Buổi: ${a.sessions}${sessionTypeStr}${revenueStr}${incurredStr}\n\n`;
                    });
                }

                await sendMessageToRoleGroup(bot, g.group_id, g.bot_role, msg, { parse_mode: 'HTML' }, 'schedule_tomorrow_report');
            }
        } catch (e) {
            console.error('Lỗi cron 20h02 lịch ngày mai:', e);
        }
    });

    // CRON: 22h đêm tổng kết lịch khách hàng đã qua
    cron.schedule('0 22 * * *', async () => {
        try {
            // Opt-out model: gửi cho tất cả nhóm report/report_tour trừ nhóm đã tắt (is_disabled=true)
            const groupsRes = await pool.query(`
            SELECT g.telegram_group_id AS group_id, g.bot_role
            FROM telegram_groups g
            LEFT JOIN schedule_notification_groups s ON s.group_id = g.telegram_group_id
            WHERE g.bot_role IN ('report', 'report_tour') AND g.is_active = true AND COALESCE(g.is_deleted, false) = false
              AND COALESCE(s.is_disabled, false) = false
        `);
            if (groupsRes.rows.length === 0) return;

            for (const g of groupsRes.rows) {
                const apsRes = await pool.query(
                    `SELECT * 
                 FROM customer_appointments 
                 WHERE DATE(appointment_time) = CURRENT_DATE AND group_id = $1
                 ORDER BY appointment_time ASC`,
                    [g.group_id]
                );
                let msg = `🌙 <b>TỔNG KẾT LỊCH KHÁCH HÀNG HÔM NAY (${new Date().toLocaleDateString('vi-VN')})</b>\n\n`;
                if (apsRes.rows.length === 0) {
                    msg += `📭 Hôm nay không có lịch hẹn khách hàng nào.`;
                } else {
                    apsRes.rows.forEach(a => {
                        const timeStr = new Date(a.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                        const revenueStr = a.revenue ? ` - Thu tiền: ${a.revenue}` : '';
                        const sessionTypeStr = a.session_type ? ` - Dạng buổi: ${a.session_type}` : '';
                        const incurredStr = a.today_incurred ? `\n   └ 📝 Phát sinh: ${a.today_incurred}` : '';
                        const doctorStr = a.doctor ? `\n   └ 👨‍⚕️ Bác sĩ: ${a.doctor}` : '';
                        const nurseStr = a.nurse ? `\n   └ 👩‍⚕️ Điều dưỡng: ${a.nurse}` : '';
                        let statusText = '';
                        if (a.status === 'ACTIVE') statusText = ' (Chờ khách)';
                        else if (a.status === 'ARRIVED') statusText = ' (Đã đến)';
                        else if (a.status === 'CANCELLED') statusText = ' (Đã hủy)';

                        msg += `⏰ <b>${timeStr}</b> | Khách: ${a.customer_name} (${a.phone})${statusText}\n`;
                        msg += `   └ NV: ${a.employee_name} - DV: ${a.service} - Buổi: ${a.sessions}${sessionTypeStr}${revenueStr}${incurredStr}\n\n`;
                    });
                }

                await sendMessageToRoleGroup(bot, g.group_id, g.bot_role, msg, { parse_mode: 'HTML' }, 'schedule_daily_summary');
            }
        } catch (e) {
            console.error('Lỗi cron 22h đêm lịch khách:', e);
        }
    });

    // CRON: 00:00 đêm — Tổng hợp công tour cho nhóm report_tour
    cron.schedule('0 0 * * *', async () => {
        try {
            // Hàm parse doanh thu từ text tự do: "500,000đ" → 500000
            const parseRevenue = (str) => {
                if (!str) return 0;
                const cleaned = String(str).replace(/[^\d]/g, '');
                const num = parseInt(cleaned, 10);
                return isNaN(num) ? 0 : num;
            };

            const groupsRes = await pool.query(`
                SELECT g.telegram_group_id AS group_id
                FROM telegram_groups g
                WHERE g.bot_role = 'report_tour'
                  AND g.is_active = true
                  AND COALESCE(g.is_deleted, false) = false
            `);
            if (groupsRes.rows.length === 0) return;

            const yesterdayStr = new Date(Date.now() - 86400000).toLocaleDateString('vi-VN');

            for (const g of groupsRes.rows) {
                const apsRes = await pool.query(
                    `SELECT * FROM customer_appointments
                     WHERE (DATE(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = CURRENT_DATE - INTERVAL '1 day'
                        OR DATE(appointment_time AT TIME ZONE 'Asia/Ho_Chi_Minh') = CURRENT_DATE - INTERVAL '1 day')
                     AND group_id = $1
                     ORDER BY appointment_time ASC`,
                    [g.group_id]
                );
                if (apsRes.rows.length === 0) continue;

                const incompleteItems = [];
                const validItems = [];
                let totalRevenue = 0;

                for (const item of apsRes.rows) {
                    // Bỏ qua lịch đã hủy
                    if (item.status === 'CANCELLED') continue;

                    const missingFields = [];
                    if (!item.customer_name || !String(item.customer_name).trim()) missingFields.push('Tên khách');
                    if (!item.phone || !String(item.phone).trim()) missingFields.push('SĐT');
                    if (!item.service || !String(item.service).trim()) missingFields.push('Dịch vụ');
                    if (!item.sessions || !String(item.sessions).trim()) missingFields.push('Buổi làm');
                    if (!item.revenue || !String(item.revenue).trim()) missingFields.push('Thu tiền');
                    if (!item.session_type || !String(item.session_type).trim()) missingFields.push('Dạng buổi');

                    // Ảnh chứng thực: bắt buộc nếu khách đã đến (ARRIVED)
                    if (item.status === 'ARRIVED' && (item.is_photo_debt === true || !item.proof_image)) {
                        missingFields.push('Ảnh chứng thực');
                    }

                    // Lịch ACTIVE đến 00:00 = chưa xác nhận đến/hủy → Chưa đủ công tour
                    if (item.status === 'ACTIVE') {
                        missingFields.push('Chưa xác nhận khách đến hoặc hủy lịch');
                    }

                    if (missingFields.length > 0) {
                        incompleteItems.push({ item, missingFields });
                    } else {
                        // ARRIVED + đủ tất cả trường + có ảnh → hợp lệ
                        const revenueNum = parseRevenue(item.revenue);
                        totalRevenue += revenueNum;
                        // Chuẩn hóa revenue thành số nguyên
                        if (revenueNum > 0 && item.revenue !== String(revenueNum)) {
                            await pool.query('UPDATE customer_appointments SET revenue = $1 WHERE id = $2', [String(revenueNum), item.id]).catch(() => { });
                        }
                        validItems.push(item);
                    }
                }

                // Gửi thông báo "Chưa đủ công tour" nếu có lịch thiếu
                if (incompleteItems.length > 0) {
                    let incompleteMsg = `⚠️ <b>THÔNG BÁO CHƯA ĐỦ CÔNG TOUR — ${yesterdayStr}</b>\n\n`;
                    incompleteMsg += `Có <b>${incompleteItems.length}</b> lịch khách thiếu thông tin:\n\n`;
                    incompleteItems.forEach(({ item, missingFields }, idx) => {
                        const timeStr = new Date(item.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                        incompleteMsg += `${idx + 1}. ❌ <b>Chưa đủ công tour</b>\n`;
                        incompleteMsg += `   Khách: <b>${item.customer_name || 'N/A'}</b> (${item.phone || 'N/A'}) — ${timeStr}\n`;
                        incompleteMsg += `   NV: ${item.employee_name || 'N/A'}\n`;
                        incompleteMsg += `   Thiếu: ${missingFields.join(', ')}\n\n`;
                    });
                    await sendMessageToRoleGroup(bot, g.group_id, 'report_tour', incompleteMsg, { parse_mode: 'HTML' }, 'tour_cong_tour_incomplete');
                }

                // Gửi thông báo tổng kết hợp lệ + doanh thu
                if (validItems.length > 0) {
                    let validMsg = `✅ <b>TỔNG KẾT LỊCH HỢP LỆ — ${yesterdayStr}</b>\n\n`;
                    validItems.forEach((item, idx) => {
                        const timeStr = new Date(item.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                        const sessionTypeStr = item.session_type ? ` | Dạng: ${item.session_type}` : '';
                        const incurredStr = item.today_incurred ? `\n   └ 📝 Phát sinh: ${item.today_incurred}` : '';
                        const doctorStr = item.doctor ? `\n   └ 👨‍⚕️ Bác sĩ: ${item.doctor}` : '';
                        const nurseStr = item.nurse ? `\n   └ 👩‍⚕️ Điều dưỡng: ${item.nurse}` : '';
                        validMsg += `${idx + 1}. ✅ <b>${item.customer_name}</b> (${item.phone}) — ${timeStr}\n`;
                        validMsg += `   NV: ${item.employee_name} | DV: ${item.service} | Buổi: ${item.sessions}${sessionTypeStr}${incurredStr}${doctorStr}${nurseStr}\n`;
                        validMsg += `   💰 Thu tiền: ${parseRevenue(item.revenue).toLocaleString('vi-VN')}đ\n\n`;
                    });
                    validMsg += `━━━━━━━━━━━━━━━━\n`;
                    validMsg += `📊 Tổng số lịch đầy đủ: <b>${validItems.length}</b>\n`;
                    validMsg += `💵 Tổng doanh thu ngày: <b>${totalRevenue.toLocaleString('vi-VN')}đ</b>`;
                    await sendMessageToRoleGroup(bot, g.group_id, 'report_tour', validMsg, { parse_mode: 'HTML' }, 'tour_cong_tour_valid_summary');
                } else if (incompleteItems.length === 0) {
                    await sendMessageToRoleGroup(bot, g.group_id, 'report_tour', `📋 <i>Hôm qua không có lịch khách nào được ghi nhận.</i>`, { parse_mode: 'HTML' }, 'tour_cong_tour_empty');
                }
            }
        } catch (e) {
            console.error('Lỗi cron 00:00 tổng hợp công tour report_tour:', e);
        }
    });



    // CRON: Nhắc nhở khi tới giờ (quét mỗi phút)
    cron.schedule('* * * * *', async () => {
        try {
            // Opt-out model: gửi cho tất cả nhóm report/report_tour trừ nhóm đã tắt (is_disabled=true)
            const groupsRes = await pool.query(`
            SELECT g.telegram_group_id AS group_id, g.bot_role
            FROM telegram_groups g
            LEFT JOIN schedule_notification_groups s ON s.group_id = g.telegram_group_id
            WHERE g.bot_role IN ('report', 'report_tour') AND g.is_active = true AND COALESCE(g.is_deleted, false) = false
              AND COALESCE(s.is_disabled, false) = false
        `);
            const defaultGroupsWithRole = groupsRes.rows.map(g => ({ gId: g.group_id, role: g.bot_role }));
            if (defaultGroupsWithRole.length === 0) return;

            const apsRes = await pool.query(
                `SELECT * 
             FROM customer_appointments 
             WHERE (is_reminded = FALSE OR is_reminded IS NULL) AND status = 'ACTIVE'
             AND appointment_time BETWEEN (NOW() - INTERVAL '1 minute') AND (NOW() + INTERVAL '1 minute')`
            );

            for (const a of apsRes.rows) {
                const timeStr = new Date(a.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                const revenueLine = a.revenue ? `💰 Thu tiền: ${a.revenue}\n` : '';
                const sessionTypeLine = a.session_type ? `🏷 Dạng buổi: <b>${a.session_type}</b>\n` : '';
                const incurredLine = a.today_incurred ? `📝 Phát sinh: ${a.today_incurred}\n` : '';
                const doctorLine = a.doctor ? `👨‍⚕️ Bác sĩ: ${a.doctor}\n` : '';
                const nurseLine = a.nurse ? `👩‍⚕️ Điều dưỡng: ${a.nurse}\n` : '';
                const msg = `🚨 <b>BÁO ĐỘNG LỊCH KHÁCH HÀNG ĐẾN GIỜ</b> 🚨\n\n` +
                    `⏰ Giờ hẹn: <b>${timeStr}</b>\n` +
                    `👤 Khách hàng: <b>${a.customer_name}</b> (SĐT: ${a.phone})\n` +
                    `💇 Dịch vụ: ${a.service} - Buổi: ${a.sessions}\n` +
                    sessionTypeLine +
                    incurredLine +
                    doctorLine +
                    nurseLine +
                    revenueLine +
                    `💼 Nhân viên phụ trách: <b>${a.employee_name}</b>\n\n` +
                    `👉 <i>Vui lòng chuẩn bị đón khách!</i>`;

                let targetGroupsWithRole = [];
                if (!a.group_id || a.group_id === 'MINI_APP') {
                    targetGroupsWithRole = defaultGroupsWithRole;
                } else {
                    const role = await getGroupRole(a.group_id);
                    if (role === 'report' || role === 'report_tour') {
                        targetGroupsWithRole.push({ gId: a.group_id, role });
                    } else {
                        console.log(`[Cảnh báo] Lịch khách có group_id ${a.group_id} nhưng không phải nhóm report/report_tour, bỏ qua.`);
                    }
                }

                for (const { gId, role } of targetGroupsWithRole) {
                    const inline_keyboard = [
                        [
                            { text: '✅ Đã đến', callback_data: `arr_${a.id}` },
                            { text: '❌ Hủy lịch/ Rời lịch', callback_data: `can_${a.id}` }
                        ]
                    ];

                    await sendMessageToRoleGroup(bot, gId, role, msg, {
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard }
                    }, 'schedule_time_reminder');
                }

                // Cập nhật trạng thái đã nhắc
                await pool.query('UPDATE customer_appointments SET is_reminded = TRUE WHERE id = $1', [a.id]);
            }
        } catch (e) {
            console.error('Lỗi cron nhắc lịch khách đúng giờ:', e);
        }
    });

    // Xử lý nút bấm thông báo khách đến
    kpiComposer.action(/^arr_(\d+)$/, async (ctx) => {
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

            const dbRes = await pool.query('UPDATE customer_appointments SET status = $1, is_photo_debt = TRUE WHERE id = $2 RETURNING sheet_row_index, employee_name, group_id', ['ARRIVED', id]);

            const rowIndex = dbRes.rows[0]?.sheet_row_index;
            const empName = dbRes.rows[0]?.employee_name;
            const arrivalGroupId = dbRes.rows[0]?.group_id;
            const role = await getGroupRole(arrivalGroupId);

            // Đồng bộ Google Sheet đã được chuyển sang chế độ "Delayed Sync"

            const originalMsg = ctx.callbackQuery.message.text || '';
            const newMsg = `✅ <b>ĐÃ ĐẾN</b> ✅\n\n` + originalMsg + `\n\n⚠️ <b>LƯU Ý:</b> Bạn đang NỢ 1 ẢNH BẰNG CHỨNG cho khách này!\n👉 Hãy vào <b>Bảng Tiện Ích (/app) ➔ Nhiệm Vụ</b> để tải ảnh lên nhé!\n\n🆔 Mã Lịch: #${id}`;

            const inline_keyboard = [
                [ { text: '❌ Hủy lịch/ Rời lịch', callback_data: `can_${id}` } ]
            ];

            await ctx.editMessageText(newMsg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
            await ctx.answerCbQuery('Đã cập nhật trạng thái: Đã đến!');
        } catch (e) {
            console.error('Lỗi nút Đã đến:', e);
            await ctx.answerCbQuery('Có lỗi xảy ra!');
        }
    });

    kpiComposer.action(/^makeup_app_(.+)$/, async (ctx) => {
        const client = await pool.connect();
        try {
            const reqId = ctx.match[1];
            const clickerId = ctx.from.id.toString();

            await client.query('BEGIN');

            const reqRes = await client.query('SELECT * FROM tour_makeup_requests WHERE id = $1 FOR UPDATE', [reqId]);
            if (reqRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return ctx.answerCbQuery('⚠️ Yêu cầu không tồn tại trong hệ thống!', { show_alert: true });
            }
            const request = reqRes.rows[0];

            if (request.status !== 'PENDING') {
                await client.query('ROLLBACK');
                return ctx.answerCbQuery(`⚠️ Yêu cầu đã được xử lý từ trước! (Trạng thái: ${request.status})`, { show_alert: true });
            }

            // 1. Cấm tự phê duyệt
            if (request.telegram_id === clickerId) {
                await client.query('ROLLBACK');
                return ctx.answerCbQuery('⚠️ Quản lý không được phép tự phê duyệt yêu cầu báo bù của chính mình!', { show_alert: true });
            }

            // 2. Kiểm tra quyền duyệt (Admin hoặc Quản lý nhóm đó)
            const isAdmin = process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(clickerId);
            let isManager = false;
            const managerRes = await client.query(
                `SELECT e.role
                 FROM employees e
                 JOIN employee_group_memberships m ON m.employee_id = e.id
                 WHERE e.telegram_id = $1 AND m.telegram_group_id = $2
                   AND e.is_active = true AND m.status = 'ACTIVE'
                   AND e.role = 'Quản lý'
                 LIMIT 1`,
                [clickerId, request.telegram_group_id]
            );
            if (managerRes.rows.length > 0) {
                isManager = true;
            }

            if (!isAdmin && !isManager) {
                await client.query('ROLLBACK');
                return ctx.answerCbQuery('⚠️ Bạn không có quyền phê duyệt yêu cầu của nhóm này!', { show_alert: true });
            }

            // Lấy tên Quản lý/Admin duyệt
            const adminRes = await client.query('SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1', [clickerId]);
            const adminName = adminRes.rows.length > 0 ? adminRes.rows[0].full_name : (ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name);

            let approvedAptId = request.original_appointment_id;

            if (request.request_type === 'EXISTING_APPOINTMENT') {
                // Bổ sung vào lịch cũ
                const aptRes = await client.query('SELECT * FROM customer_appointments WHERE id = $1 FOR UPDATE', [request.original_appointment_id]);
                if (aptRes.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return ctx.answerCbQuery('⚠️ Không tìm thấy lịch cũ tương ứng để bổ sung!', { show_alert: true });
                }
                const apt = aptRes.rows[0];

                // Xác minh lại quyền sở hữu lịch cũ & nhóm & trạng thái & thời gian 48h
                if (apt.telegram_id !== request.telegram_id || apt.group_id !== request.telegram_group_id) {
                    await client.query('ROLLBACK');
                    return ctx.answerCbQuery('⚠️ Lịch cũ không thuộc sở hữu của nhân viên hoặc nhóm tương ứng!', { show_alert: true });
                }
                if (apt.status === 'CANCELLED') {
                    await client.query('ROLLBACK');
                    return ctx.answerCbQuery('⚠️ Lịch cũ đã bị hủy, không thể báo bù!', { show_alert: true });
                }
                // LỊCH PHẢI CHƯA HOÀN THÀNH HOẶC THIẾU ẢNH
                if (!(apt.status === 'ACTIVE' || (apt.status === 'ARRIVED' && (apt.is_photo_debt === true || !apt.proof_image)))) {
                    await client.query('ROLLBACK');
                    return ctx.answerCbQuery('⚠️ Lịch hẹn gốc này đã hoàn thành đầy đủ và được ghi nhận trước đó!', { show_alert: true });
                }
                const aptTime = new Date(apt.appointment_time);
                const now = new Date();
                if ((now - aptTime) > 48 * 60 * 60 * 1000) {
                    await client.query('ROLLBACK');
                    return ctx.answerCbQuery('⚠️ Lịch cũ đã quá giới hạn 48 giờ!', { show_alert: true });
                }

                await client.query(
                    `UPDATE customer_appointments 
                     SET status = 'ARRIVED', is_photo_debt = FALSE, proof_image = $1, revenue = $2, service = $3, sessions = $4, session_type = $5 
                     WHERE id = $6`,
                    [request.proof_image, request.revenue, request.service, request.sessions, request.session_type, request.original_appointment_id]
                );

            } else {
                // Báo bù lịch mới -> Tạo mới lịch
                // Kiểm tra trùng công tour lại ngay lúc duyệt để tránh race condition
                const dupAptRes = await client.query(
                    `SELECT id FROM customer_appointments 
                     WHERE telegram_id = $1 AND group_id = $2 AND DATE(appointment_time) = $3 AND phone = $4 
                       AND status = 'ARRIVED' AND is_photo_debt = FALSE AND proof_image IS NOT NULL LIMIT 1 FOR SHARE`,
                    [request.telegram_id, request.telegram_group_id, request.work_date, request.customer_phone]
                );
                if (dupAptRes.rows.length > 0) {
                    await client.query('ROLLBACK');
                    return ctx.answerCbQuery('⚠️ Công tour cho khách hàng này vào ngày đã chọn đã được ghi nhận thành công từ trước!', { show_alert: true });
                }

                const insertRes = await client.query(
                    `INSERT INTO customer_appointments (
                        telegram_id, employee_name, group_id, customer_name, phone, service, sessions, session_type, revenue, appointment_time, is_reminded, status, is_photo_debt, proof_image
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, 'ARRIVED', FALSE, $11) RETURNING id`,
                    [
                        request.telegram_id, request.employee_name, request.telegram_group_id, request.customer_name, request.customer_phone,
                        request.service, request.sessions, request.session_type, request.revenue, request.appointment_time, request.proof_image
                    ]
                );
                approvedAptId = insertRes.rows[0].id;
            }

            // Cập nhật trạng thái yêu cầu
            await client.query(
                `UPDATE tour_makeup_requests 
                 SET status = 'APPROVED', reviewed_at = NOW(), reviewed_by = $1, approved_appointment_id = $2 
                 WHERE id = $3`,
                [adminName, approvedAptId, reqId]
            );

            await client.query('COMMIT');

            // --- BẮT ĐẦU ĐỒNG BỘ GOOGLE SHEET AN TOÀN ---
            syncMakeupToGoogleSheetWithRetry(reqId).catch(err => {
                console.error(`[SYNC FATAL ERROR] Lỗi đồng bộ Sheet vĩnh viễn cho yêu cầu ${reqId}:`, err);
            });

            // Cập nhật nội dung tin nhắn Telegram
            const originalCaption = ctx.callbackQuery.message.caption || '';
            const updatedCaption = 
                `✅ <b>ĐÃ DUYỆT CÔNG TOUR</b> ✅\n\n` + 
                originalCaption + 
                `\n\n👤 <b>Người duyệt:</b> ${adminName}\n⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`;

            await ctx.editMessageCaption(updatedCaption, { parse_mode: 'HTML' });
            await ctx.answerCbQuery('Đã duyệt yêu cầu báo công tour!');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('Lỗi khi duyệt yêu cầu báo bù:', e);
            await ctx.answerCbQuery('Có lỗi xảy ra khi xử lý duyệt!');
        } finally {
            client.release();
        }
    });

    kpiComposer.action(/^makeup_rej_(.+)$/, async (ctx) => {
        const client = await pool.connect();
        try {
            const reqId = ctx.match[1];
            const clickerId = ctx.from.id.toString();

            await client.query('BEGIN');

            const reqRes = await client.query('SELECT * FROM tour_makeup_requests WHERE id = $1 FOR UPDATE', [reqId]);
            if (reqRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return ctx.answerCbQuery('⚠️ Yêu cầu không tồn tại trong hệ thống!', { show_alert: true });
            }
            const request = reqRes.rows[0];

            if (request.status !== 'PENDING') {
                await client.query('ROLLBACK');
                return ctx.answerCbQuery(`⚠️ Yêu cầu đã được xử lý từ trước! (Trạng thái: ${request.status})`, { show_alert: true });
            }

            // 1. Cấm tự từ chối/duyệt
            if (request.telegram_id === clickerId) {
                await client.query('ROLLBACK');
                return ctx.answerCbQuery('⚠️ Bạn không được phép tự xử lý yêu cầu báo bù của chính mình!', { show_alert: true });
            }

            // 2. Kiểm tra quyền (Admin hoặc Quản lý nhóm đó)
            const isAdmin = process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(clickerId);
            let isManager = false;
            const managerRes = await client.query(
                `SELECT e.role
                 FROM employees e
                 JOIN employee_group_memberships m ON m.employee_id = e.id
                 WHERE e.telegram_id = $1 AND m.telegram_group_id = $2
                   AND e.is_active = true AND m.status = 'ACTIVE'
                   AND e.role = 'Quản lý'
                 LIMIT 1`,
                [clickerId, request.telegram_group_id]
            );
            if (managerRes.rows.length > 0) {
                isManager = true;
            }

            if (!isAdmin && !isManager) {
                await client.query('ROLLBACK');
                return ctx.answerCbQuery('⚠️ Bạn không có quyền từ chối yêu cầu của nhóm này!', { show_alert: true });
            }

            // Lấy tên Quản lý/Admin từ chối
            const adminRes = await client.query('SELECT full_name FROM employees WHERE telegram_id = $1 LIMIT 1', [clickerId]);
            const adminName = adminRes.rows.length > 0 ? adminRes.rows[0].full_name : (ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name);

            // Cập nhật trạng thái yêu cầu sang REJECTED
            await client.query(
                `UPDATE tour_makeup_requests 
                 SET status = 'REJECTED', reviewed_at = NOW(), reviewed_by = $1 
                 WHERE id = $2`,
                [adminName, reqId]
            );

            await client.query('COMMIT');

            // Cập nhật nội dung tin nhắn Telegram
            const originalCaption = ctx.callbackQuery.message.caption || '';
            const updatedCaption = 
                `❌ <b>ĐÃ TỪ CHỐI YÊU CẦU</b> ❌\n\n` + 
                originalCaption + 
                `\n\n👤 <b>Người từ chối:</b> ${adminName}\n⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`;

            await ctx.editMessageCaption(updatedCaption, { parse_mode: 'HTML' });
            await ctx.answerCbQuery('Đã từ chối yêu cầu báo công tour!');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('Lỗi khi từ chối yêu cầu báo bù:', e);
            await ctx.answerCbQuery('Có lỗi xảy ra khi xử lý từ chối!');
        } finally {
            client.release();
        }
    });

    kpiComposer.action(/^can_(\d+)$/, async (ctx) => {
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

    kpiComposer.action(/^cr_back_(\d+)$/, async (ctx) => {
        try {
            const id = ctx.match[1];
            
            const aptRes = await pool.query('SELECT group_id FROM customer_appointments WHERE id = $1', [id]);
            const groupId = aptRes.rows[0]?.group_id;
            const role = await getGroupRole(groupId);

            let originalMsg = ctx.callbackQuery.message.text || '';
            originalMsg = originalMsg.replace('\n\n👇 VUI LÒNG CHỌN LÝ DO HỦY:', '');

            const inline_keyboard = [
                [
                    { text: '✅ Đã đến', callback_data: `arr_${id}` },
                    { text: '❌ Hủy lịch/ Rời lịch', callback_data: `can_${id}` }
                ]
            ];

            await ctx.editMessageText(originalMsg, {
                reply_markup: { inline_keyboard }
            });
        } catch (e) {
            console.error('Lỗi nút Quay lại:', e);
        }
    });

    kpiComposer.action(/^cr_(bom|ban|tien|khacspa|app)_(\d+)$/, async (ctx) => {
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

            const dbRes = await pool.query('UPDATE customer_appointments SET status = $1, cancel_reason = $2 WHERE id = $3 RETURNING sheet_row_index, employee_name, group_id', ['CANCELLED', reason, id]);

            const rowIndex = dbRes.rows[0]?.sheet_row_index;
            const empName = dbRes.rows[0]?.employee_name;
            const cancelGroupId = dbRes.rows[0]?.group_id;

            // Đồng bộ Google Sheet đã được chuyển sang chế độ "Delayed Sync"

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
            try {
                const rowIndex = apt.sheet_row_index;
                const empName = apt.employee_name;
                const workDateFormatted = moment(apt.appointment_time).format('DD/MM/YYYY');
                const codeRes = await pool.query('SELECT employee_code FROM employees WHERE telegram_id = $1 AND telegram_group_id = $2 LIMIT 1', [apt.telegram_id, apt.group_id]);
                const employeeCode = codeRes.rows.length > 0 ? codeRes.rows[0].employee_code : '';

                if (rowIndex) {
                    const target = await getCustomerSheetTarget(apt.group_id, empName);
                    if (target.doc) {
                        await target.doc.loadInfo();
                        let sheet = target.doc.sheetsByTitle[target.sheetName];
                        if (sheet) {
                            const rows = await sheet.getRows();
                            const matchRow = rows.find(r => r.rowNumber === rowIndex);
                            if (matchRow) {
                                matchRow.set('Trạng Thái', 'Đã hoàn thành');
                                matchRow.set('Ảnh Chứng Thực', proofUrl);
                                if (apt.revenue) matchRow.set('Thu Tiền', apt.revenue);
                                await matchRow.save();
                            }
                        }
                        const masterSheetName = target.role === 'report_tour' ? 'TỔNG HỢP TOUR' : 'TỔNG HỢP KHÁCH HÀNG';
                        let masterSheet = target.doc.sheetsByTitle[masterSheetName];
                        if (masterSheet) {
                            const mRows = await masterSheet.getRows();
                            const appTimeStr = moment(apt.appointment_time).format('HH:mm DD/MM/YYYY');
                            const matchMRow = mRows.find(r => r.get('Khách Hàng') === apt.customer_name && r.get('SĐT') === apt.phone && r.get('Thời Gian') === appTimeStr);
                            if (matchMRow) {
                                matchMRow.set('Trạng Thái', 'Đã hoàn thành');
                                matchMRow.set('Ảnh Chứng Thực', proofUrl);
                                if (apt.revenue) matchMRow.set('Thu Tiền', apt.revenue);
                                await matchMRow.save();
                            }
                        }
                    }
                } else {
                    const rowData = {
                        'Ngày': workDateFormatted,
                        'Nhân Viên': empName,
                        'Mã NV': employeeCode,
                        'Khách Hàng': apt.customer_name,
                        'SĐT': apt.phone,
                        'Dịch Vụ': apt.service,
                        'Buổi Làm': apt.sessions,
                        'Thời Gian': moment(apt.appointment_time).format('HH:mm DD/MM/YYYY'),
                        'Trạng Thái': 'Đã hoàn thành',
                        'Lý Do Hủy': '',
                        'Thu Tiền': apt.revenue || '',
                        'Ảnh Chứng Thực': proofUrl
                    };
                    const rowNumber = await writeToGoogleSheets(apt.group_id, empName, rowData);
                    if (rowNumber) {
                        await pool.query('UPDATE customer_appointments SET sheet_row_index = $1 WHERE id = $2', [rowNumber, apt.id]);
                    }
                }
            } catch (sheetErr) {
                console.error('[Sheet Sync Error] Không thể đồng bộ ảnh lên Google Sheet:', sheetErr);
            }

            // Gửi thông báo ảnh lên Telegram Group
            try {
                const timeStr = new Date(apt.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                let targetGroup = apt.group_id;
                if (!targetGroup || targetGroup === 'MINI_APP') {
                    const groupsRes = await pool.query(`
                    SELECT s.group_id
                    FROM schedule_notification_groups s
                    JOIN telegram_groups tg ON tg.telegram_group_id = s.group_id
                    WHERE tg.bot_role IN ('report', 'report_tour') AND tg.is_active = true AND COALESCE(tg.is_deleted, false) = false
                    LIMIT 1
                `);
                    if (groupsRes.rows.length > 0) targetGroup = groupsRes.rows[0].group_id;
                }
                if (targetGroup) {
                    const caption = `📸 <b>ĐÃ NHẬN ẢNH BẰNG CHỨNG</b> 📸\n\n` +
                        `👤 Khách hàng: <b>${apt.customer_name}</b> (Lúc ${timeStr})\n` +
                        `💼 KTV: <b>${apt.employee_name}</b>\n\n` +
                        `✅ <i>Đã lưu ảnh vào hệ thống thành công!</i>`;
                    await sendPhotoToRoleGroup(bot, targetGroup, ['report', 'report_tour'], { source: buffer }, { caption: caption, parse_mode: 'HTML' }, 'upload_proof_api');
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

    async function syncMakeupToGoogleSheetWithRetry(reqId, maxAttempts = 3) {
        let attempts = 0;
        let delay = 2000;

        while (attempts < maxAttempts) {
            attempts++;
            try {
                const reqRes = await pool.query('SELECT * FROM tour_makeup_requests WHERE id = $1', [reqId]);
                if (reqRes.rows.length === 0) return;
                const request = reqRes.rows[0];

                if (request.status !== 'APPROVED') return;

                if (!customerDoc && !tourDoc) {
                    await pool.query(
                        "UPDATE tour_makeup_requests SET sheet_sync_status = 'FAILED', sheet_sync_error = $1 WHERE id = $2",
                        ['Cả customerDoc và tourDoc đều chưa được cấu hình trên máy chủ', reqId]
                    );
                    return;
                }

                const target = await getCustomerSheetTarget(request.telegram_group_id, request.employee_name);
                if (!target.doc) {
                    await pool.query(
                        "UPDATE tour_makeup_requests SET sheet_sync_status = 'FAILED', sheet_sync_error = $1 WHERE id = $2",
                        ['Không tìm thấy Google Sheet cấu hình phù hợp cho nhóm này', reqId]
                    );
                    return;
                }
                
                await target.doc.loadInfo();

                const headers = ['Ngày', 'Nhân Viên', 'Mã NV', 'Khách Hàng', 'SĐT', 'Dịch Vụ', 'Buổi Làm', 'Thời Gian', 'Trạng Thái', 'Lý Do Hủy', 'Thu Tiền', 'Ảnh Chứng Thực'];
                let sheet = target.doc.sheetsByTitle[target.sheetName];
                if (!sheet) {
                    sheet = await target.doc.addSheet({ headerValues: headers, title: target.sheetName });
                }

                const workDateFormatted = moment(request.work_date).format('DD/MM/YYYY');
                const codeRes = await pool.query('SELECT employee_code FROM employees WHERE telegram_id = $1 AND telegram_group_id = $2 LIMIT 1', [request.telegram_id, request.telegram_group_id]);
                const employeeCode = codeRes.rows.length > 0 ? codeRes.rows[0].employee_code : '';

                const rowData = {
                    'Ngày': workDateFormatted,
                    'Nhân Viên': request.employee_name,
                    'Mã NV': employeeCode,
                    'Khách Hàng': request.customer_name,
                    'SĐT': request.customer_phone,
                    'Dịch Vụ': request.service,
                    'Buổi Làm': request.sessions,
                    'Thời Gian': moment(request.appointment_time).format('HH:mm DD/MM/YYYY'),
                    'Trạng Thái': 'Đã hoàn thành',
                    'Lý Do Hủy': '',
                    'Thu Tiền': request.revenue,
                    'Ảnh Chứng Thực': request.proof_image
                };

                const rowNumber = await writeToGoogleSheets(request.telegram_group_id, request.employee_name, rowData);
                if (!rowNumber) {
                    throw new Error("Không thể ghi vào Google Sheet (chưa cài đặt hoặc lỗi)");
                }

                if (request.approved_appointment_id) {
                    await pool.query('UPDATE customer_appointments SET sheet_row_index = $1 WHERE id = $2', [rowNumber, request.approved_appointment_id]);
                }
                await pool.query(
                    "UPDATE tour_makeup_requests SET sheet_sync_status = 'SUCCESS', sheet_sync_error = NULL WHERE id = $1",
                    [reqId]
                );
                console.log(`[Google Sheet Sync SUCCESS] Yêu cầu ${reqId} đã được đồng bộ lên Sheet.`);
                return;
            } catch (err) {
                console.warn(`[SYNC ATTEMPT ${attempts} FAILED] Lỗi đồng bộ Sheet cho yêu cầu ${reqId}:`, err.message);
                if (attempts >= maxAttempts) {
                    await pool.query(
                        "UPDATE tour_makeup_requests SET sheet_sync_status = 'FAILED', sheet_sync_error = $1 WHERE id = $2",
                        [err.message, reqId]
                    );
                    throw err;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            }
        }
    }

    // Cronjob chạy mỗi 5 phút xử lý retry gửi Telegram và đồng bộ Google Sheet
    cron.schedule('*/5 * * * *', async () => {
        console.log('[CRON MAKEUP] Đang chạy quét xử lý bù tin nhắn Telegram và đồng bộ Sheet...');
        
        // 1. Quét gửi bù tin nhắn Telegram
        try {
            const pendingTg = await pool.query(
                `SELECT * FROM tour_makeup_requests 
                 WHERE status IN ('PENDING_NOTIFICATION', 'NOTIFICATION_FAILED') 
                 ORDER BY created_at ASC LIMIT 10`
            );
            for (const req of pendingTg.rows) {
                try {
                    console.log(`[CRON MAKEUP] Đang gửi lại tin nhắn Telegram cho yêu cầu ${req.id}...`);
                    
                    const filename = path.basename(req.proof_image);
                    const filePath = path.join(__dirname, 'public', 'uploads', filename);
                    if (!fs.existsSync(filePath)) {
                        console.warn(`[CRON MAKEUP] File ảnh không tồn tại tại ${filePath}, chuyển trạng thái sang REJECTED do mất tài liệu.`);
                        await pool.query("UPDATE tour_makeup_requests SET status = 'REJECTED', review_note = 'Không tìm thấy ảnh chứng thực trên máy chủ' WHERE id = $1", [req.id]);
                        continue;
                    }
                    const buffer = fs.readFileSync(filePath);

                    const workDateStr = moment(req.work_date).format('DD/MM/YYYY');
                    const appTimeStr = moment(req.appointment_time).format('HH:mm');
                    const reqTypeLabel = req.request_type === 'EXISTING_APPOINTMENT' ? 'Bổ sung lịch đã tồn tại' : 'Báo bù lịch chưa đăng ký';

                    const safeEmpName = escapeHtml(req.employee_name);
                    const safeCustName = escapeHtml(req.customer_name);
                    const safePhone = escapeHtml(req.customer_phone);
                    const safeService = escapeHtml(req.service);
                    const safeSessions = escapeHtml(req.sessions);
                    const safeSessionType = escapeHtml(req.session_type || 'Bán');
                    const safeRevenue = escapeHtml(req.revenue);
                    const safeReason = escapeHtml(req.reason);

                    const notifyMsg = 
                        `🕘 <b>YÊU CẦU BÁO BÙ CÔNG TOUR (GỬI LẠI)</b> 🕘\n\n` +
                        `👤 <b>Nhân viên:</b> ${safeEmpName}\n` +
                        `📅 <b>Ngày làm thực tế:</b> ${workDateStr}\n` +
                        `⏰ <b>Giờ hẹn khách:</b> ${appTimeStr}\n` +
                        `👤 <b>Khách hàng:</b> ${safeCustName}\n` +
                        `📞 <b>SĐT:</b> ${safePhone.substring(0, 6)}****\n` +
                        `💇 <b>Dịch vụ:</b> ${safeService} (Buổi: ${safeSessions})\n` +
                        `💰 <b>Doanh thu:</b> ${safeRevenue}\n` +
                        `📌 <b>Dạng buổi:</b> ${safeSessionType}\n` +
                        `❓ <b>Loại yêu cầu:</b> ${reqTypeLabel}\n` +
                        `📝 <b>Lý do báo bù:</b> ${safeReason}\n\n` +
                        `<i>Sếp hoặc Quản lý vui lòng xem ảnh đính kèm bên dưới và nhấn duyệt:</i>`;

                    const replyMarkup = {
                        inline_keyboard: [
                            [
                                { text: '✅ Duyệt', callback_data: `makeup_app_${req.id}` },
                                { text: '❌ Từ chối', callback_data: `makeup_rej_${req.id}` }
                            ]
                        ]
                    };

                    const sentMessage = await sendPhotoToRoleGroup(bot, req.telegram_group_id, 'report_tour', { source: buffer }, {
                        caption: notifyMsg,
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup
                    }, 'tour_makeup_cron_retry');

                    if (sentMessage) {
                        await pool.query("UPDATE tour_makeup_requests SET status = 'PENDING' WHERE id = $1", [req.id]);
                        console.log(`[CRON MAKEUP] Đã gửi lại tin nhắn Telegram thành công cho yêu cầu ${req.id}.`);
                    } else {
                        throw new Error('Gửi Telegram nhận kết quả rỗng (null/undefined)');
                    }
                } catch (err) {
                    console.error(`[CRON MAKEUP] Lỗi gửi lại Telegram cho yêu cầu ${req.id}:`, err.message);
                    await pool.query("UPDATE tour_makeup_requests SET status = 'NOTIFICATION_FAILED' WHERE id = $1", [req.id]);
                }
            }
        } catch (err) {
            console.error('[CRON MAKEUP] Lỗi trong tiến trình quét gửi Telegram:', err.message);
        }

        // 2. Quét đồng bộ Google Sheet bị lỗi hoặc chưa chạy
        try {
            const pendingSheet = await pool.query(
                `SELECT id FROM tour_makeup_requests 
                 WHERE status = 'APPROVED' 
                   AND (sheet_sync_status IS NULL OR sheet_sync_status != 'SUCCESS') 
                 ORDER BY reviewed_at ASC LIMIT 10`
            );
            for (const req of pendingSheet.rows) {
                try {
                    console.log(`[CRON MAKEUP] Đang đồng bộ lại Sheet cho yêu cầu ${req.id}...`);
                    await syncMakeupToGoogleSheetWithRetry(req.id);
                } catch (err) {
                    console.error(`[CRON MAKEUP] Lỗi đồng bộ lại Sheet cho yêu cầu ${req.id}:`, err.message);
                }
            }
        } catch (err) {
            console.error('[CRON MAKEUP] Lỗi trong tiến trình quét đồng bộ Sheet:', err.message);
        }

        // 3. Quét các công tour quá 48h chưa hoàn thành để ghi lên Sheet
        try {
            const uncompletedRes = await pool.query(
                `SELECT a.*, e.employee_code 
                 FROM customer_appointments a
                 LEFT JOIN employees e ON a.telegram_id = e.telegram_id AND a.group_id = e.telegram_group_id
                 WHERE a.status != 'CANCELLED'
                   AND a.sheet_row_index IS NULL
                   AND a.appointment_time < NOW() - INTERVAL '48 hours'
                   AND NOT EXISTS (
                       SELECT 1 FROM tour_makeup_requests r 
                       WHERE r.original_appointment_id = a.id AND r.status = 'APPROVED'
                   )
                 ORDER BY a.appointment_time ASC LIMIT 20`
            );

            for (const apt of uncompletedRes.rows) {
                try {
                    console.log(`[CRON MAKEUP] Đang đồng bộ lịch quá 48h chưa hoàn thành (ID: ${apt.id})...`);
                    const workDateFormatted = moment(apt.appointment_time).format('DD/MM/YYYY');
                    const rowData = {
                        'Ngày': workDateFormatted,
                        'Nhân Viên': apt.employee_name,
                        'Mã NV': apt.employee_code || '',
                        'Khách Hàng': apt.customer_name,
                        'SĐT': apt.phone,
                        'Dịch Vụ': apt.service,
                        'Buổi Làm': apt.sessions,
                        'Thời Gian': moment(apt.appointment_time).format('HH:mm DD/MM/YYYY'),
                        'Trạng Thái': 'Có lịch nhưng chưa hoàn thành công tour',
                        'Lý Do Hủy': '',
                        'Thu Tiền': apt.revenue || '',
                        'Ảnh Chứng Thực': ''
                    };

                    const rowNumber = await writeToGoogleSheets(apt.group_id, apt.employee_name, rowData);
                    if (rowNumber) {
                        await pool.query('UPDATE customer_appointments SET sheet_row_index = $1 WHERE id = $2', [rowNumber, apt.id]);
                    }
                } catch (err) {
                    console.error(`[CRON MAKEUP] Lỗi đồng bộ lịch quá 48h (ID: ${apt.id}):`, err.message);
                }
            }
        } catch (err) {
            console.error('[CRON MAKEUP] Lỗi quét lịch quá 48h:', err.message);
        }
    });

    botApp.get('/api/schedules/incomplete', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const telegram_id = req.verifiedTelegramId;
            const { groupId } = req.query;
            if (!groupId) {
                return res.status(400).json({ success: false, error: 'Thiếu thông tin groupId!' });
            }

            let memberCheck = await pool.query(
                'SELECT id FROM employees WHERE telegram_id = $1 AND telegram_group_id = $2 AND is_active = true LIMIT 1',
                [telegram_id, groupId]
            );
            if (memberCheck.rows.length === 0) {
                memberCheck = await pool.query(
                    'SELECT id FROM employees WHERE telegram_id = $1 AND is_active = true LIMIT 1',
                    [telegram_id]
                );
            }
            if (memberCheck.rows.length === 0) {
                return res.status(403).json({ success: false, error: 'Bạn không thuộc nhóm làm việc này!' });
            }

            const result = await pool.query(
                `SELECT id, customer_name, phone, appointment_time, service, sessions, session_type, revenue, status, is_photo_debt 
                 FROM customer_appointments 
                 WHERE telegram_id = $1 
                   AND group_id = $2
                   AND appointment_time >= NOW() - INTERVAL '48 hours'
                   AND appointment_time <= NOW()
                   AND status != 'CANCELLED'
                   AND (status = 'ACTIVE' OR (status = 'ARRIVED' AND (is_photo_debt = TRUE OR proof_image IS NULL)))
                 ORDER BY appointment_time DESC`,
                [telegram_id, groupId]
            );
            res.json({ success: true, data: result.rows });
        } catch (err) {
            console.error('Lỗi API lấy lịch chưa hoàn thành:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    botApp.post('/api/schedules/makeup', checkPayloadLimit(14 * 1024 * 1024), authenticateTelegramMiniApp, async (req, res) => {
        const { 
            request_type, 
            original_appointment_id, 
            appointment_time, 
            customer_name, 
            phone, 
            service, 
            sessions, 
            session_type, 
            revenue, 
            reason, 
            imageBase64, 
            groupId 
        } = req.body;

        const work_date = moment().format('YYYY-MM-DD');

        if (!request_type || !appointment_time || !customer_name || !phone || !service || !sessions || !reason || !imageBase64 || !groupId) {
            return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ tất cả các trường bắt buộc và tải lên 1 ảnh!' });
        }

        // Chuẩn hóa số điện thoại
        const normalizedPhone = phone.trim().replace(/\D/g, '');
        if (!normalizedPhone) {
            return res.status(400).json({ success: false, error: 'Số điện thoại không hợp lệ!' });
        }

        const telegram_id = req.verifiedTelegramId;

        // 1. Kiểm tra giới hạn thời gian (trong quá khứ và trong vòng 48 giờ)
        const now = new Date();
        const aptTimeObj = new Date(appointment_time);
        if (isNaN(aptTimeObj.getTime())) {
            return res.status(400).json({ success: false, error: 'Giờ hẹn không hợp lệ!' });
        }
        if (aptTimeObj > now) {
            return res.status(400).json({ success: false, error: 'Giờ hẹn không được phép ở tương lai!' });
        }
        const diffHours = (now - aptTimeObj) / (1000 * 60 * 60);
        if (diffHours > 48) {
            return res.status(400).json({ success: false, error: 'Giờ hẹn khách phải nằm trong vòng 48 giờ qua!' });
        }

        // 2. Không cần kiểm tra Ngày làm thực tế trùng khớp với Giờ hẹn khách nữa vì tự lấy ngày hiện tại.

        // 3. Kiểm định & giải mã Base64 Ảnh (MIME type, Magic Bytes và Kích thước)
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        if (buffer.length > 10 * 1024 * 1024) { 
            return res.status(400).json({ success: false, error: 'Kích thước ảnh giải mã vượt quá giới hạn 10MB!' });
        }
        if (!isValidImage(buffer)) {
            return res.status(400).json({ success: false, error: 'Ảnh tải lên không đúng định dạng hình ảnh hợp lệ (chỉ chấp nhận JPEG, PNG, GIF, WebP)!' });
        }

        const ext = getImageExtension(buffer);
        const timestamp = Date.now();
        const filename = `Makeup_${telegram_id}_${timestamp}${ext}`;
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, buffer);
        const proofUrl = process.env.MINI_APP_URL + '/mini-app/uploads/' + filename;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 4. Xác minh phân quyền nhóm (Cấm group bypass)
            const groupCheck = await client.query('SELECT is_active FROM telegram_groups WHERE telegram_group_id = $1 AND is_active = true LIMIT 1 FOR SHARE', [groupId]);
            if (groupCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Nhóm làm việc không hợp lệ hoặc đã bị vô hiệu hóa!' });
            }

            const mRes = await client.query(
                'SELECT full_name FROM employees WHERE telegram_id = $1 AND telegram_group_id = $2 AND is_active = true LIMIT 1 FOR SHARE',
                [telegram_id, groupId]
            );
            if (mRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, error: 'Bạn không thuộc nhóm làm việc này hoặc tài khoản của bạn đã bị vô hiệu hóa!' });
            }
            const employeeName = mRes.rows[0].full_name;

            // 5. Xác minh lịch cũ (nếu là EXISTING_APPOINTMENT) để ngăn cập nhật chéo của người khác
            if (request_type === 'EXISTING_APPOINTMENT') {
                const aptRes = await client.query('SELECT * FROM customer_appointments WHERE id = $1 FOR SHARE', [original_appointment_id]);
                if (aptRes.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Không tìm thấy lịch hẹn gốc để bổ sung!' });
                }
                const apt = aptRes.rows[0];
                if (apt.telegram_id !== telegram_id || apt.group_id !== groupId) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ success: false, error: 'Lịch hẹn gốc này không thuộc quyền quản lý của bạn hoặc sai nhóm!' });
                }
                if (apt.status === 'CANCELLED') {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Lịch hẹn gốc đã bị hủy, không thể báo bù!' });
                }
                if (!(apt.status === 'ACTIVE' || (apt.status === 'ARRIVED' && (apt.is_photo_debt || !apt.proof_image)))) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Lịch hẹn gốc này đã hoàn thành đầy đủ và được ghi nhận trước đó!' });
                }
                const originalAptTime = new Date(apt.appointment_time);
                if ((now - originalAptTime) > 48 * 60 * 60 * 1000) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Lịch hẹn gốc đã quá giới hạn 48 giờ!' });
                }
            }

            // 6. Kiểm tra trùng lặp công tour (Database level)
            // a. Kiểm tra yêu cầu PENDING_NOTIFICATION / PENDING / APPROVED / NOTIFICATION_FAILED
            const dupReqRes = await client.query(
                `SELECT id FROM tour_makeup_requests 
                 WHERE telegram_id = $1 AND telegram_group_id = $2 AND work_date = $3 AND customer_phone = $4 
                   AND status IN ('PENDING_NOTIFICATION', 'PENDING', 'APPROVED', 'NOTIFICATION_FAILED') FOR UPDATE`,
                [telegram_id, groupId, work_date, normalizedPhone]
            );
            if (dupReqRes.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Yêu cầu báo bù cho khách hàng này vào ngày đã chọn đang chờ duyệt hoặc đã được duyệt!' });
            }

            // b. Kiểm tra công tour hoàn tất thực tế cùng ngày
            const dupAptRes = await client.query(
                `SELECT id FROM customer_appointments 
                 WHERE telegram_id = $1 AND group_id = $2 AND DATE(appointment_time) = $3 AND phone = $4 
                   AND status = 'ARRIVED' AND is_photo_debt = FALSE AND proof_image IS NOT NULL LIMIT 1 FOR SHARE`,
                [telegram_id, groupId, work_date, normalizedPhone]
            );
            if (dupAptRes.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Công tour cho khách hàng này vào ngày đã chọn đã được ghi nhận thành công trên hệ thống!' });
            }

            // 7. Thực hiện INSERT CSDL với trạng thái PENDING_NOTIFICATION
            const insertRes = await client.query(
                `INSERT INTO tour_makeup_requests (
                    telegram_group_id, telegram_id, employee_name, request_type, original_appointment_id,
                    work_date, appointment_time, customer_name, customer_phone, service, sessions,
                    session_type, revenue, reason, proof_image, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'PENDING_NOTIFICATION') RETURNING id`,
                [
                    groupId, telegram_id, employeeName, request_type, original_appointment_id || null,
                    work_date, appointment_time, customer_name, normalizedPhone, service, sessions,
                    session_type || 'Bán', revenue, reason, proofUrl
                ]
            );
            const reqId = insertRes.rows[0].id;

            await client.query('COMMIT');
            client.release();

            // 8. Gửi Telegram bên ngoài transaction
            try {
                const workDateStr = moment(work_date).format('DD/MM/YYYY');
                const appTimeStr = moment(appointment_time).format('HH:mm');
                const reqTypeLabel = request_type === 'EXISTING_APPOINTMENT' ? 'Bổ sung lịch đã tồn tại' : 'Báo bù lịch chưa đăng ký';

                const safeEmpName = escapeHtml(employeeName);
                const safeCustName = escapeHtml(customer_name);
                const safePhone = escapeHtml(normalizedPhone);
                const safeService = escapeHtml(service);
                const safeSessions = escapeHtml(sessions);
                const safeSessionType = escapeHtml(session_type || 'Bán');
                const safeRevenue = escapeHtml(revenue);
                const safeReason = escapeHtml(reason);

                const notifyMsg = 
                    `Base64: ${safeEmpName}\n` + // Cần thiết cho image_hasher hoạt động nếu cần
                    `Base64: ${safeEmpName}\n` +
                    `🕘 <b>YÊU CẦU BÁO BÙ CÔNG TOUR</b> 🕘\n\n` +
                    `👤 <b>Nhân viên:</b> ${safeEmpName}\n` +
                    `⏰ <b>Giờ hẹn khách:</b> ${appTimeStr}\n` +
                    `👤 <b>Khách hàng:</b> ${safeCustName}\n` +
                    `📞 <b>SĐT:</b> ${safePhone.substring(0, 6)}****\n` +
                    `💇 <b>Dịch vụ:</b> ${safeService} (Buổi: ${safeSessions})\n` +
                    `💰 <b>Doanh thu:</b> ${safeRevenue}\n` +
                    `📌 <b>Dạng buổi:</b> ${safeSessionType}\n` +
                    `❓ <b>Loại yêu cầu:</b> ${reqTypeLabel}\n` +
                    `📝 <b>Lý do báo bù:</b> ${safeReason}\n\n` +
                    `<i>Sếp hoặc Quản lý vui lòng xem ảnh đính kèm bên dưới và nhấn duyệt:</i>`;

                const replyMarkup = {
                    inline_keyboard: [
                        [
                            { text: '✅ Duyệt', callback_data: `makeup_app_${reqId}` },
                            { text: '❌ Từ chối', callback_data: `makeup_rej_${reqId}` }
                        ]
                    ]
                };

                const sentMessage = await sendPhotoToRoleGroup(bot, groupId, 'report_tour', { source: buffer }, {
                    caption: notifyMsg,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup
                }, 'tour_makeup_request_notice');

                if (sentMessage) {
                    await pool.query("UPDATE tour_makeup_requests SET status = 'PENDING' WHERE id = $1", [reqId]);
                    return res.json({ success: true, message: 'Gửi yêu cầu báo bù thành công! Vui lòng chờ quản lý duyệt.' });
                } else {
                    throw new Error('Gửi thông báo Telegram thất bại (trả về null)');
                }
            } catch (tgErr) {
                console.error('Lỗi khi gửi thông báo Telegram ngoài transaction:', tgErr.message);
                await pool.query("UPDATE tour_makeup_requests SET status = 'NOTIFICATION_FAILED' WHERE id = $1", [reqId]);
                return res.json({ success: true, message: 'Yêu cầu đã được lưu vào hệ thống nhưng gặp sự cố gửi thông báo Telegram. Bot sẽ tự động gửi lại sau vài phút!' });
            }

        } catch (err) {
            if (client.connection && client.connection.active) {
                await client.query('ROLLBACK');
            }
            client.release();
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch (e) {}
            }
            console.error('Lỗi API tạo yêu cầu báo bù:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    botApp.get('/api/schedules/makeup/history', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const telegram_id = req.verifiedTelegramId;
            const result = await pool.query(
                `SELECT id, request_type, work_date, appointment_time, customer_name, customer_phone, service, sessions, session_type, revenue, reason, proof_image, status, submitted_at, review_note, reviewed_by, sheet_sync_status, sheet_sync_error
                 FROM tour_makeup_requests
                 WHERE telegram_id = $1
                 ORDER BY submitted_at DESC`,
                [telegram_id]
            );
            res.json({ success: true, data: result.rows });
        } catch (err) {
            console.error('Lỗi API lấy lịch sử báo bù:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

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
    // Lắng nghe nhân viên reply ảnh trực tiếp trên Telegram
    kpiComposer.on('photo', async (ctx) => {
        try {
            const replyMsg = ctx.message.reply_to_message;
            if (!replyMsg || !replyMsg.from || !replyMsg.from.is_bot) return;

            const text = replyMsg.text || replyMsg.caption || '';
            const isCustomerNotice = text.includes('ĐÃ ĐẾN') || text.includes('BÁO ĐỘNG LỊCH KHÁCH') || text.includes('Mã Lịch') || text.includes('Khách hàng');
            if (!isCustomerNotice) return;

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

            // Cập nhật Google Sheet — dùng suffix [Tour] cho nhóm report_tour
            try {
                const rowIndex = apt.sheet_row_index;
                const empName = apt.employee_name;
                const workDateFormatted = moment(apt.appointment_time).format('DD/MM/YYYY');
                const codeRes = await pool.query('SELECT employee_code FROM employees WHERE telegram_id = $1 AND telegram_group_id = $2 LIMIT 1', [apt.telegram_id, apt.group_id]);
                const employeeCode = codeRes.rows.length > 0 ? codeRes.rows[0].employee_code : '';

                if (rowIndex) {
                    const target = await getCustomerSheetTarget(apt.group_id, empName);
                    if (target.doc) {
                        await target.doc.loadInfo();
                        let sheet = target.doc.sheetsByTitle[target.sheetName];
                        if (sheet) {
                            const rows = await sheet.getRows();
                            const matchRow = rows.find(r => r.rowNumber === rowIndex);
                            if (matchRow) {
                                matchRow.set('Trạng Thái', 'Đã hoàn thành');
                                matchRow.set('Ảnh Chứng Thực', proofUrl);
                                if (apt.revenue) matchRow.set('Thu Tiền', apt.revenue);
                                await matchRow.save();
                            }
                        }
                        const masterSheetName = target.role === 'report_tour' ? 'TỔNG HỢP TOUR' : 'TỔNG HỢP KHÁCH HÀNG';
                        let masterSheet = target.doc.sheetsByTitle[masterSheetName];
                        if (masterSheet) {
                            const mRows = await masterSheet.getRows();
                            const appTimeStr = moment(apt.appointment_time).format('HH:mm DD/MM/YYYY');
                            const matchMRow = mRows.find(r => r.get('Khách Hàng') === apt.customer_name && r.get('SĐT') === apt.phone && r.get('Thời Gian') === appTimeStr);
                            if (matchMRow) {
                                matchMRow.set('Trạng Thái', 'Đã hoàn thành');
                                matchMRow.set('Ảnh Chứng Thực', proofUrl);
                                if (apt.revenue) matchMRow.set('Thu Tiền', apt.revenue);
                                await matchMRow.save();
                            }
                        }
                    }
                } else {
                    const rowData = {
                        'Ngày': workDateFormatted,
                        'Nhân Viên': empName,
                        'Mã NV': employeeCode,
                        'Khách Hàng': apt.customer_name,
                        'SĐT': apt.phone,
                        'Dịch Vụ': apt.service,
                        'Buổi Làm': apt.sessions,
                        'Thời Gian': moment(apt.appointment_time).format('HH:mm DD/MM/YYYY'),
                        'Trạng Thái': 'Đã hoàn thành',
                        'Lý Do Hủy': '',
                        'Thu Tiền': apt.revenue || '',
                        'Ảnh Chứng Thực': proofUrl
                    };
                    const rowNumber = await writeToGoogleSheets(apt.group_id, empName, rowData);
                    if (rowNumber) {
                        await pool.query('UPDATE customer_appointments SET sheet_row_index = $1 WHERE id = $2', [rowNumber, apt.id]);
                    }
                }
            } catch (sheetErr) {
                console.error('[Sheet Sync Error] Không thể đồng bộ ảnh lên Google Sheet:', sheetErr);
            }

            // Reply báo thành công
            const timeStr = new Date(apt.appointment_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            await ctx.reply(`✅ <b>ĐÃ LƯU ẢNH CHỨNG THỰC (TỪ TELEGRAM)</b> ✅\n\n👤 Khách hàng: <b>${apt.customer_name}</b> (Lúc ${timeStr})\n💼 KTV: <b>${apt.employee_name}</b>\n\n<i>Ảnh đã được tự động đồng bộ vào kho dữ liệu và Google Sheet!</i>`, { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });

        } catch (e) {
            console.error('Lỗi nhận ảnh từ Telegram:', e);
            ctx.reply('❌ Có lỗi xảy ra khi lưu ảnh, vui lòng tải lên bằng Mini App!', { reply_to_message_id: ctx.message.message_id });
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
