/**
 * Số liệu cá nhân cho Mini App: lịch làm việc của cả nhóm 2 tuần (hiện tại +
 * kế tiếp), và số lượt đi muộn/tiền phạt của chính mình trong tháng.
 */
export function createGetPersonalStats({ attendanceRepository, scheduleRepository, findEmployeeContext, isSystemAdmin, moment }) {
    async function getPersonalStats({ telegramId, chatId }) {
        if (!telegramId || !chatId) {
            return { ok: false, status: 400, message: 'Thiếu telegram_id hoặc chat_id' };
        }

        const group = await scheduleRepository.findGroupByTelegramGroupId(chatId);
        if (!group) {
            return { ok: false, status: 404, message: 'Không tìm thấy nhóm làm việc tương ứng' };
        }

        const user = await findEmployeeContext(telegramId, chatId);
        if (!user) {
            return { ok: false, status: 404, message: 'Tài khoản chưa được đăng ký trong hệ thống' };
        }

        const isAdmin = isSystemAdmin(telegramId) || user.role === 'admin';
        if (!isAdmin && user.group_id !== group.id) {
            return { ok: false, status: 404, message: 'Tài khoản chưa được đăng ký trong nhóm này' };
        }

        // Tuần hiện tại + tuần kế tiếp theo giờ UTC+7.
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

        const currentWeekRange = { start: currMonday.toISOString().slice(0, 10), end: currSunday.toISOString().slice(0, 10) };
        const nextWeekRange = { start: nextMonday.toISOString().slice(0, 10), end: nextSunday.toISOString().slice(0, 10) };

        const schedules = await attendanceRepository.findGroupSchedulesForRange(group.id, currentWeekRange.start, nextWeekRange.end);

        const startOfMonthStr = moment().utcOffset(7).startOf('month').format('YYYY-MM-DD');
        const endOfMonthStr = moment().utcOffset(7).endOf('month').format('YYYY-MM-DD');
        const penalties = await attendanceRepository.findLatePenaltiesInRange(user.id, startOfMonthStr, endOfMonthStr);

        const totalLateCount = penalties.length;
        const totalPenaltyAmount = penalties.reduce((sum, p) => sum + parseInt(p.amount), 0);

        return {
            ok: true,
            data: {
                user, group_name: group.group_name,
                current_week: currentWeekRange, next_week: nextWeekRange,
                schedules,
                personal_stats: { total_late_count: totalLateCount, total_penalty_amount: totalPenaltyAmount, penalties }
            }
        };
    }

    return { getPersonalStats };
}
