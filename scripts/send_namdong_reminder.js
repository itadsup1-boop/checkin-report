import 'dotenv/config';
import { Telegraf } from 'telegraf';
import pool from '../packages/database/index.js';
import crypto from 'crypto';
import { createSundayReminderRepository } from '../domains/timekeep/infrastructure/postgres/sunday-reminder-repository.js';

async function main() {
    const tgid = '-5589101669';
    const groupName = '00. CHECK IN vp Nam Đồng';
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    const repo = createSundayReminderRepository({ pool });

    // 1. Mở đăng ký lịch
    await pool.query('UPDATE telegram_groups SET schedule_registration_open = true WHERE telegram_group_id = $1', [tgid]);

    // 2. Tạo link đăng ký Mini App
    const botInfo = await bot.telegram.getMe();
    const botUsername = botInfo.username || process.env.BOT_USERNAME || 'baocao_kpi_adsup_bot';
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const ts = Date.now();
    const appShortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
    const dataString = `schedule:${tgid}:${ts}`;
    const sig = crypto.createHmac('sha256', token).update(dataString).digest('hex');
    const scheduleUrl = `https://t.me/${botUsername}/${appShortName}?startapp=schedule_${tgid}_${ts}_${sig}`;

    // 3. Tìm nhân sự chưa đăng ký
    const fromDate = '2026-09-28';
    const toDate = '2026-10-04';
    const unregisteredStaff = await repo.findUnregisteredStaff(tgid, fromDate, toDate);

    function tagOf(employee) {
        if (employee.telegram_username) {
            return `@${employee.telegram_username.replace('@', '')} (${employee.full_name})`;
        }
        return `<a href="tg://user?id=${employee.telegram_id}">${employee.full_name}</a>`;
    }

    const tagList = unregisteredStaff.map(tagOf).join(', ');
    const message = `🔔 <b>[NHẮC NHỞ & CẢNH BÁO ĐĂNG KÝ LỊCH TUẦN MỚI]</b>\n\n` +
        `Các bạn thành viên nhóm <b>${groupName}</b> ơi, vui lòng nhấp vào nút dưới đây để hoàn tất đăng ký lịch làm việc cho tuần tới!\n` +
        `⏰ Hạn chót đóng đăng ký: <b>20:00 tối nay (Chủ Nhật)</b>. Quá hạn hệ thống sẽ tự động bổ sung Ca sáng cho các ngày còn trống.\n\n` +
        (unregisteredStaff.length > 0 ? `👉 Các bạn chưa đăng ký đủ: ${tagList}` : '');

    const sent = await bot.telegram.sendMessage(tgid, message, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: '📅 Đăng ký lịch tuần', url: scheduleUrl }]]
        }
    });
    console.log('Sent Nam Dong reminder, message_id:', sent.message_id);

    process.exit(0);
}

main().catch(console.error);
