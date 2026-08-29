/**
 * Nhắc đăng ký lịch tuần vào Chủ Nhật — 5 mốc giờ khác nhau dùng chung một hàm:
 * nhắc chung (17h/18h), nhắc đích danh người chưa đăng ký (19h/19h50), rồi tự
 * động xếp Ca sớm + khoá đăng ký lúc 20h.
 */
export function createSendSundayScheduleReminder({ repository, bot, moment, crypto }) {
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

    function tagOf(employee) {
        if (employee.telegram_username) {
            return `@${employee.telegram_username.replace('@', '')} (${employee.full_name})`;
        }
        return `<a href="tg://user?id=${employee.telegram_id}">${employee.full_name}</a>`;
    }

    async function sendGeneralReminder(groupId, groupName, scheduleUrl) {
        const message = `🔔 <b>[NHẮC NHỞ ĐĂNG KÝ LỊCH TUẦN MỚI]</b>\n\n` +
            `Các bạn thành viên nhóm <b>${groupName}</b> ơi, vui lòng nhấp vào nút dưới đây để đăng ký lịch làm việc cho tuần tới nhé!\n` +
            `⏰ Hạn chót đóng đăng ký: <b>20:00 tối nay (Chủ Nhật)</b>.`;
        await bot.telegram.sendMessage(groupId, message, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '📅 Đăng ký lịch tuần', url: scheduleUrl }]] }
        });
    }

    async function sendTargetedReminder(groupId, type, unregisteredStaff, scheduleUrl) {
        if (unregisteredStaff.length === 0) return;
        const tagList = unregisteredStaff.map(tagOf).join(', ');

        const message = type === 'targeted_19'
            ? `🔔 <b>[CẢNH BÁO ĐĂNG KÝ LỊCH TUẦN MỚI]</b>\n\n` +
              `Các thành viên sau đây vui lòng nhấn nút dưới đây để hoàn tất đăng ký lịch làm việc tuần tới trước 20:00:\n\n👉 ${tagList}`
            : `🚨 <b>[CẢNH BÁO ĐĂNG KÝ LỊCH LẦN CUỐI]</b>\n\n` +
              `⏰ <b>Chỉ còn đúng 10 phút!</b> Nếu quá 20:00 chưa hoàn tất đăng ký lịch, hệ thống sẽ tự động xếp toàn bộ ca của bạn thành <b>Ca sớm (8:30)</b> cho cả tuần sau.\n\n` +
              `👉 Các bạn chưa đăng ký: ${tagList}`;

        await bot.telegram.sendMessage(groupId, message, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '📅 Đăng ký lịch tuần', url: scheduleUrl }]] }
        });
    }

    async function autoAssignAndClose(group, groupName, unregisteredStaff, nextWeekDates) {
        if (unregisteredStaff.length > 0) {
            for (const employee of unregisteredStaff) {
                for (const dateStr of nextWeekDates) {
                    await repository.insertAutoAssignedShift(group.id, employee.id, dateStr);
                }
            }

            const namesList = unregisteredStaff.map(employee => employee.full_name).join(', ');
            const message = `🔒 <b>[HẾT HẠN ĐĂNG KÝ & TỰ ĐỘNG XẾP CA]</b>\n\n` +
                `Hạn đăng ký lịch làm việc tuần tới đã kết thúc.\n\n` +
                `Các thành viên chưa đăng ký đã được hệ thống tự động xếp lịch <b>Ca sớm (8:30)</b> cho cả tuần từ Thứ 2 đến Chủ Nhật:\n` +
                `👉 <b>${namesList}</b>`;
            await bot.telegram.sendMessage(group.telegram_group_id, message, { parse_mode: 'HTML' });
        }

        await repository.closeScheduleRegistration(group.id);
        console.log(`[Cron] Đã đóng đăng ký lịch cho nhóm ${groupName}`);
    }

    async function sendSundayScheduleReminder(type) {
        try {
            console.log(`[Sunday Cron] Chạy trình nhắc nhở lịch: ${type}`);
            const groups = await repository.findActiveTimekeepGroups();
            if (groups.length === 0) return;

            const nextMonday = moment().utcOffset(7).add(1, 'day').startOf('day');
            const nextWeekDates = Array.from({ length: 7 }, (_, i) => moment(nextMonday).add(i, 'days').format('YYYY-MM-DD'));
            const botUsername = await getBotUsername();

            for (const group of groups) {
                const groupId = group.telegram_group_id;
                const scheduleUrl = generateScheduleLink(groupId, botUsername);
                const unregisteredStaff = await repository.findUnregisteredStaff(groupId, nextWeekDates[0], nextWeekDates[6]);

                if (type === 'general_17' || type === 'general_18') {
                    await sendGeneralReminder(groupId, group.group_name, scheduleUrl);
                } else if (type === 'targeted_19' || type === 'targeted_1950') {
                    await sendTargetedReminder(groupId, type, unregisteredStaff, scheduleUrl);
                } else if (type === 'auto_set_2000') {
                    await autoAssignAndClose(group, group.group_name, unregisteredStaff, nextWeekDates);
                }
            }
        } catch (e) {
            console.error(`[Sunday Cron Error] Lỗi khi xử lý reminder ${type}:`, e);
        }
    }

    return { sendSundayScheduleReminder };
}
