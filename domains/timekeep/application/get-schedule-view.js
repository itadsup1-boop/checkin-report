/**
 * Dữ liệu cho Mini App "Đăng ký lịch tuần": lịch tuần này/tuần sau của nhân
 * viên, lịch cả nhóm để đối chiếu, và danh sách nhân sự (chỉ khi Admin xem hộ).
 */

export function createGetScheduleView({ repository, findEmployeeContext, isSystemAdmin, moment }) {
    async function getScheduleView({ telegramId, chatId, targetUserId }) {
        if (!telegramId) {
            return { ok: false, status: 400, message: 'Thiếu telegram_id!' };
        }

        const user = await findEmployeeContext(telegramId, chatId);
        if (!user) {
            return { ok: false, status: 404, message: 'Nhân sự chưa đăng ký tài khoản! Vui lòng đăng ký trước.' };
        }

        const isAdmin = isSystemAdmin(telegramId) || user.role === 'admin';
        user.is_admin = isAdmin;

        let scheduleRegistrationOpen = true;
        if (chatId) {
            const group = await repository.findGroupByTelegramGroupId(chatId);
            if (group) {
                scheduleRegistrationOpen = group.schedule_registration_open;
                if (!isAdmin && user.group_id !== group.id) {
                    return { ok: false, status: 404, message: 'Nhân sự chưa đăng ký tài khoản trong nhóm này!' };
                }
            } else if (!isAdmin) {
                return { ok: false, status: 404, message: 'Nhóm Telegram này chưa được đăng ký trong hệ thống!' };
            }
        } else if (user.group_id) {
            scheduleRegistrationOpen = await repository.findGroupRegistrationFlag(user.group_id);
        }
        user.schedule_registration_open = scheduleRegistrationOpen;

        let targetUser = user;
        if (targetUserId && targetUserId !== String(user.id) && isAdmin) {
            const fetchedTarget = await repository.findEmployeeById(targetUserId);
            if (fetchedTarget) {
                if (fetchedTarget.group_id !== user.group_id) {
                    return { ok: false, status: 403, message: 'Không thể xem lịch của nhân viên thuộc nhóm khác!' };
                }
                targetUser = fetchedTarget;
            }
        }

        const groupId = user.group_id;

        // Tuần ISO: Thứ 2 -> Chủ nhật. Khoá lúc 23:00 Chủ nhật của tuần trước.
        const startOfCurrentWeek = moment().startOf('isoWeek');
        const startOfNextWeek = moment().add(1, 'week').startOf('isoWeek');

        const currentWeekDays = Array.from({ length: 7 }, (_, i) => moment(startOfCurrentWeek).add(i, 'days').format('YYYY-MM-DD'));
        const nextWeekDays = Array.from({ length: 7 }, (_, i) => moment(startOfNextWeek).add(i, 'days').format('YYYY-MM-DD'));

        const currentWeekThreshold = moment(startOfCurrentWeek).subtract(1, 'days').hours(23).minutes(0).seconds(0);
        const nextWeekThreshold = moment(startOfNextWeek).subtract(1, 'days').hours(23).minutes(0).seconds(0);

        const isCurrentWeekLocked = !isAdmin && moment().isSameOrAfter(currentWeekThreshold) && (scheduleRegistrationOpen === false);
        const isNextWeekLocked = !isAdmin && moment().isSameOrAfter(nextWeekThreshold) && (scheduleRegistrationOpen === false);

        const mySchedules = await repository.findSchedulesInRange(targetUser.id, currentWeekDays[0], nextWeekDays[6]);
        const groupSchedules = await repository.findGroupSchedulesInRange(groupId, currentWeekDays[0], nextWeekDays[6]);
        const groupUsers = isAdmin ? await repository.findGroupEmployees(groupId) : [];

        return {
            ok: true,
            data: {
                user, target_user: targetUser, is_admin: isAdmin,
                currentWeekDays, nextWeekDays,
                is_current_week_locked: isCurrentWeekLocked, is_next_week_locked: isNextWeekLocked,
                mySchedules, groupSchedules, groupUsers
            }
        };
    }

    return { getScheduleView };
}
