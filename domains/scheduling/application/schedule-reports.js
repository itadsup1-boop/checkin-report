/**
 * Ba bản báo cáo lịch khách chạy theo giờ:
 *   20:02  lịch của ngày mai        → nhóm report + report_tour (opt-out)
 *   22:00  tổng kết lịch trong ngày → nhóm report + report_tour (opt-out)
 *   00:00  tổng hợp công tour       → CHỈ nhóm report_tour
 *
 * Lỗi ở một nhóm không được chặn các nhóm còn lại, nên toàn bộ vòng lặp nằm
 * trong một try chung như bản cũ.
 */

import { APPOINTMENT_STATUS, findMissingTourFields, parseRevenue } from '../domain/appointment-rules.js';
import {
    buildTomorrowReport,
    buildDailySummary,
    buildTourIncomplete,
    buildTourValidSummary,
    TOUR_EMPTY_MESSAGE
} from '../domain/appointment-messages.js';

const DAY_MS = 86400000;
const viDate = timestamp => new Date(timestamp).toLocaleDateString('vi-VN');

export function createScheduleReportService({ repository, notifier, now = () => Date.now() }) {
    /** 20:02 — lịch của ngày mai. */
    async function reportTomorrow() {
        try {
            const groups = await repository.findNotifyGroups();
            if (groups.length === 0) return;

            const tomorrowStr = viDate(now() + DAY_MS);
            for (const g of groups) {
                const appointments = await repository.findTomorrowOf(g.group_id);
                await notifier.send(g.group_id, g.bot_role,
                    buildTomorrowReport(appointments, tomorrowStr), 'schedule_tomorrow_report');
            }
        } catch (e) {
            console.error('Lỗi cron 20h02 lịch ngày mai:', e);
        }
    }

    /** 22:00 — tổng kết lịch trong ngày. */
    async function reportToday() {
        try {
            const groups = await repository.findNotifyGroups();
            if (groups.length === 0) return;

            const todayStr = viDate(now());
            for (const g of groups) {
                const appointments = await repository.findTodayOf(g.group_id);
                await notifier.send(g.group_id, g.bot_role,
                    buildDailySummary(appointments, todayStr), 'schedule_daily_summary');
            }
        } catch (e) {
            console.error('Lỗi cron 22h đêm lịch khách:', e);
        }
    }

    /**
     * 00:00 — chốt công tour của hôm qua.
     *
     * Lịch đã hủy không tính vào cả hai danh sách: không đủ công nhưng cũng
     * không phải lỗi của nhân viên.
     */
    async function summarizeTourWork() {
        try {
            const groups = await repository.findTourGroups();
            if (groups.length === 0) return;

            const yesterdayStr = viDate(now() - DAY_MS);

            for (const g of groups) {
                const appointments = await repository.findYesterdayOf(g.group_id);
                if (appointments.length === 0) continue;

                const incompleteItems = [];
                const validItems = [];
                let totalRevenue = 0;

                for (const item of appointments) {
                    if (item.status === APPOINTMENT_STATUS.CANCELLED) continue;

                    const missingFields = findMissingTourFields(item);
                    if (missingFields.length > 0) {
                        incompleteItems.push({ item, missingFields });
                        continue;
                    }

                    const revenue = parseRevenue(item.revenue);
                    totalRevenue += revenue;
                    if (revenue > 0 && item.revenue !== String(revenue)) {
                        await repository.normalizeRevenue(item.id, revenue);
                    }
                    validItems.push(item);
                }

                if (incompleteItems.length > 0) {
                    await notifier.send(g.group_id, 'report_tour',
                        buildTourIncomplete(incompleteItems, yesterdayStr), 'tour_cong_tour_incomplete');
                }

                if (validItems.length > 0) {
                    await notifier.send(g.group_id, 'report_tour',
                        buildTourValidSummary(validItems, totalRevenue, yesterdayStr), 'tour_cong_tour_valid_summary');
                } else if (incompleteItems.length === 0) {
                    await notifier.send(g.group_id, 'report_tour', TOUR_EMPTY_MESSAGE, 'tour_cong_tour_empty');
                }
            }
        } catch (e) {
            console.error('Lỗi cron 00:00 tổng hợp công tour report_tour:', e);
        }
    }

    return { reportTomorrow, reportToday, summarizeTourWork };
}
