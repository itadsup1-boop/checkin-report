import { buildDailySummaryMessage } from '../domain/retail-messages.js';

export function createSummarizeDailyKpi({ repository, bot, moment, sheetSync }) {
    return async function summarizeDailyKpi({ targetGroupId = null } = {}) {
        const now = moment().utcOffset(7);
        const dateStr = now.format('YYYY-MM-DD');
        const displayDate = now.format('DD/MM/YYYY');

        // Lấy tất cả các nhóm có role retail_checkin
        const retailGroups = await repository.findRetailGroups();
        if (!retailGroups || retailGroups.length === 0) return;

        const groupsToProcess = targetGroupId
            ? retailGroups.filter(g => g.telegram_group_id === targetGroupId || g.id === targetGroupId)
            : retailGroups;

        for (const group of groupsToProcess) {
            try {
                if (group.auto_reminder_enabled === false) {
                    console.log(`[Retail Checkin] Bỏ qua chốt sổ nhóm ${group.group_name} vì auto_reminder_enabled = false`);
                    continue;
                }

                const kpiTarget = Number(group.daily_kpi_target) || 15;
                const results = await repository.getDailyProgressForGroup(group.id, dateStr, kpiTarget);
                if (results.length === 0) continue;

                // Nếu nhóm có cấu hình ngày bắt đầu áp dụng và hôm nay chưa đến ngày đó -> Bỏ qua chốt sổ
                if (group.start_date && dateStr < group.start_date) {
                    console.log(`[Retail Checkin] Bỏ qua chốt sổ nhóm ${group.group_name} (${group.telegram_group_id}) vì chưa đến ngày áp dụng (${dateStr} < ${group.start_date}).`);
                    continue;
                }

                // 1. Cập nhật kết quả chốt sổ vào Database (retail_daily_summaries)
                for (const item of results) {
                    try {
                        await repository.upsertDailySummary({
                            groupId: group.id,
                            employeeId: item.employeeId,
                            recordDate: dateStr,
                            validPointsCount: item.validPoints,
                            targetPoints: kpiTarget,
                            isCompleted: item.isCompleted,
                            status: item.isCompleted ? 'COMPLETED' : 'INCOMPLETE'
                        });
                    } catch (dbErr) {
                        console.error(`[Retail DB Summary Error] Employee ${item.employeeId}:`, dbErr.message || dbErr);
                    }
                }

                // 2. Ghi nhận trạng thái chốt sổ (ĐỦ / THIẾU) vào Google Sheet
                if (sheetSync?.syncDailyClosing) {
                    try {
                        await sheetSync.syncDailyClosing(group.telegram_group_id, {
                            dateStr: displayDate,
                            closingList: results,
                            targetPoints: kpiTarget
                        });
                    } catch (sheetErr) {
                        console.error(`[Retail Sheet Summary Error] Group ${group.telegram_group_id}:`, sheetErr.message || sheetErr);
                    }
                }

                // 3. Gửi thông báo báo cáo chốt sổ 20:00 vào nhóm Telegram
                const message = buildDailySummaryMessage({
                    dateStr: displayDate,
                    results,
                    targetPoints: kpiTarget
                });

                if (bot?.telegram) {
                    await bot.telegram.sendMessage(group.telegram_group_id, message, {
                        parse_mode: 'HTML'
                    });
                }
                console.log(`[Retail Checkin] Đã hoàn tất chốt sổ 20:00 cho nhóm ${group.group_name} (${group.telegram_group_id})`);
            } catch (err) {
                console.error(`[Retail Checkin Summary Error] Nhóm ${group.telegram_group_id}:`, err.message || err);
            }
        }
    };
}
