/**
 * Cron chấm công chạy mỗi phút: nhắc trước ca, báo đi muộn, tính phạt từ
 * check-in, và (từ 14:00) chốt người không check-in + gửi thông báo vắng.
 */
export function registerAttendanceCron({
    cron, runShiftReminders, runLatePenaltyCheck,
    finalizeUnauthorizedAbsences, getPendingAbsenceNotifications, markAbsenceNotificationsSent,
    groupAbsenceNotifications, buildAbsenceNotificationText,
    scanMarketingCheckout,
    pool, sendMessageToRoleGroup, bot, syncSheets, moment, isCompanyHoliday
}) {
    return cron.schedule('*/1 * * * *', async () => {
        try {
            let attendanceSheetDirty = false;
            const nowVN = moment().utcOffset(7);
            const todayStr = nowVN.format('YYYY-MM-DD');
            const currentTimeStr = nowVN.format('HH:mm');
            const currentMonth = nowVN.month() + 1;
            const currentYear = nowVN.year();

            const holiday = await isCompanyHoliday(todayStr);
            if (holiday) {
                console.log(`[Company Holiday] Bỏ qua nhắc và phạt chấm công ngày ${todayStr}: ${holiday.name}`);
                return;
            }

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

            // 23:59 (12h cuối ngày): chốt nhân sự Marketing quên check-out
            if (currentTimeStr >= '23:59' && typeof scanMarketingCheckout?.scanEveningCheckout === 'function') {
                try {
                    const checkoutDirty = await scanMarketingCheckout.scanEveningCheckout(todayStr);
                    if (checkoutDirty) {
                        attendanceSheetDirty = true;
                    }
                } catch (error) {
                    console.error('[23:59 Marketing Checkout Sweep Error]:', error.message);
                }
            }

            // Quét bù nếu vừa qua ngày mới (00:00 - 00:05) mà ngày hôm trước chưa chốt hết
            if (currentTimeStr <= '00:05' && typeof scanMarketingCheckout?.scanEveningCheckout === 'function') {
                try {
                    const yesterdayStr = nowVN.clone().subtract(1, 'day').format('YYYY-MM-DD');
                    const checkoutDirty = await scanMarketingCheckout.scanEveningCheckout(yesterdayStr);
                    if (checkoutDirty) {
                        attendanceSheetDirty = true;
                    }
                } catch (error) {
                    console.error('[00:00 Marketing Checkout Sweep Catchup Error]:', error.message);
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
