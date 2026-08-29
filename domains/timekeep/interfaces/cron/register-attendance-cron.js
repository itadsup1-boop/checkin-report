/**
 * Cron chấm công chạy mỗi phút: nhắc trước ca, báo đi muộn, tính phạt từ
 * check-in, và (từ 14:00) chốt người không check-in + gửi thông báo vắng.
 */
export function registerAttendanceCron({
    cron, runShiftReminders, runLatePenaltyCheck,
    finalizeUnauthorizedAbsences, getPendingAbsenceNotifications, markAbsenceNotificationsSent,
    groupAbsenceNotifications, buildAbsenceNotificationText,
    pool, sendMessageToRoleGroup, bot, syncSheets, moment
}) {
    return cron.schedule('*/1 * * * *', async () => {
        try {
            let attendanceSheetDirty = false;
            const nowVN = moment().utcOffset(7);
            const todayStr = nowVN.format('YYYY-MM-DD');
            const currentTimeStr = nowVN.format('HH:mm');
            const currentMonth = nowVN.month() + 1;
            const currentYear = nowVN.year();

            const remindersDirty = await runShiftReminders({ todayStr, currentTimeStr });
            attendanceSheetDirty = attendanceSheetDirty || remindersDirty;

            const penaltyDirty = await runLatePenaltyCheck({ todayStr, currentMonth, currentYear });
            attendanceSheetDirty = attendanceSheetDirty || penaltyDirty;

            // 14:00: chốt người không check-in. Chỉ xử lý ngày hiện tại — dữ liệu
            // lịch sử được bổ sung bằng tác vụ riêng, không đi qua nhánh Telegram
            // ở đây nên sẽ không phát thông báo cũ lên nhóm.
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
                            bot, group.telegramGroupId, 'timekeep',
                            buildAbsenceNotificationText(group), { parse_mode: 'HTML' }, 'checkin_absent_14h'
                        );
                        if (sent) {
                            await markAbsenceNotificationsSent({
                                pool, groupId: group.groupId,
                                userIds: group.employees.map(employee => employee.userId), date: todayStr
                            });
                        }
                    } catch (error) {
                        console.error(`[14:00 Absence Notice] Không gửi được nhóm ${group.groupName}:`, error.message);
                    }
                }
            }

            if (attendanceSheetDirty) {
                syncSheets().catch(error => console.error('[Late Attendance Sheet Sync]', error));
            }
        } catch (error) {
            console.error('[Cron Error] Lỗi khi xử lý tính phạt đi muộn:', error);
        }
    });
}
