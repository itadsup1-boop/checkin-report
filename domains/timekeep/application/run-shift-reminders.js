/**
 * Nhắc trước ca 5 phút, và báo đi muộn 1 phút sau giờ vào ca — cho từng nhóm,
 * từng ca (sớm/muộn/bù chiều), bỏ qua nhân sự được miễn check-in hoặc đã bị vô
 * hiệu hóa.
 */
export function createRunShiftReminders({ repository, sendMessageToRoleGroup, bot, moment }) {
    async function runShiftReminders({ todayStr, currentTimeStr }) {
        let attendanceSheetDirty = false;
        const groups = await repository.findTimekeepGroupsWithShiftTimes();

        for (const row of groups) {
            const { group_uuid: groupUuid, telegram_group_id: telegramGroupId, group_name: groupName, shift_1_time, shift_2_time } = row;

            const shifts = [
                { num: 1, label: 'Ca sớm', startStr: shift_1_time, types: ['CA_1', 'CA_SANG', 'FULL_DAY'] },
                { num: 2, label: 'Ca muộn', startStr: shift_2_time, types: ['CA_2', 'CA_CHIEU', 'FULL_DAY'] },
                { num: 3, label: 'Ca làm bù chiều', startStr: '13:30:00', types: ['HALF_DAY_PM_WORK'] }
            ];

            for (const shift of shifts) {
                const shiftStartMoment = moment(shift.startStr, 'HH:mm:ss');
                const remindMinutes = 5;
                const remindTime = shiftStartMoment.clone().subtract(remindMinutes, 'minutes').format('HH:mm');
                const lateTime = shiftStartMoment.clone().add(2, 'minutes').format('HH:mm');

                if (currentTimeStr === remindTime) {
                    const unchecked = await repository.findUncheckedForShift({ groupUuid, date: todayStr, shiftTypes: shift.types, telegramGroupId });
                    if (unchecked.length > 0) {
                        const names = unchecked.map(r => `👤 ${r.full_name}`).join('\n');
                        const msg = `🔔 <b>NHẮC NHỞ ĐIỂM DANH (${shift.label})</b> 🔔\n\n` +
                            `⏰ Chỉ còn ${remindMinutes} phút nữa là đến giờ vào làm (<b>${shift.startStr.substring(0, 5)}</b>).\n` +
                            `Các nhân sự sau chưa điểm danh, vui lòng check-in ngay nhé:\n\n${names}`;
                        try {
                            const sent = await sendMessageToRoleGroup(bot, telegramGroupId, 'timekeep', msg, { parse_mode: 'HTML' }, `checkin_reminder_${remindMinutes}min`);
                            if (sent) {
                                for (const employee of unchecked) {
                                    await repository.markReminderSent(groupUuid, employee.user_id, todayStr);
                                }
                            }
                        } catch (err) {
                            console.error(`Lỗi gửi nhắc nhở checkin ca ${shift.num} cho nhóm ${groupName}:`, err.message);
                        }
                    }
                }

                if (currentTimeStr === lateTime) {
                    const late = await repository.findLateForShift({ groupUuid, date: todayStr, shiftTypes: shift.types, telegramGroupId });
                    if (late.length > 0) {
                        const names = late.map(r => `❌ ${r.full_name}`).join('\n');
                        const msg = `⏰ <b>THÔNG BÁO NHÂN SỰ ĐI MUỘN (${shift.label})</b> ⏰\n\n` +
                            `🚫 Đã quá giờ vào làm 2 phút (<b>${shift.startStr.substring(0, 5)}</b>).\n` +
                            `Các nhân sự sau chưa điểm danh (ghi nhận đi muộn):\n\n${names}`;
                        try {
                            const sent = await sendMessageToRoleGroup(bot, telegramGroupId, 'timekeep', msg, { parse_mode: 'HTML' }, 'checkin_late_warning_1min');
                            if (sent) {
                                for (const employee of late) {
                                    await repository.markLateWarningSent(groupUuid, employee.user_id, todayStr);
                                    attendanceSheetDirty = true;
                                }
                            }
                        } catch (err) {
                            console.error(`Lỗi gửi báo muộn ca ${shift.num} cho nhóm ${groupName}:`, err.message);
                        }
                    }
                }
            }
        }

        return attendanceSheetDirty;
    }

    return { runShiftReminders };
}
