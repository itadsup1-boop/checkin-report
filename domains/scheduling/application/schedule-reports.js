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
    buildPhotoDebtSummary,
    buildTourIncomplete,
    buildTourValidSummary,
    TOUR_EMPTY_MESSAGE
} from '../domain/appointment-messages.js';

const DAY_MS = 86400000;
const viDate = timestamp => new Date(timestamp).toLocaleDateString('vi-VN');

export function createScheduleReportService({ repository, notifier, now = () => Date.now(), summarizeTourDaily }) {
    /** 20:02 — lịch của ngày mai. */
    async function reportTomorrow() {
        try {
            const groups = await repository.findNotifyGroups();
            if (groups.length === 0) return;

            const tomorrowStr = viDate(now() + DAY_MS);
            for (const g of groups) {
                if (g.bot_role === 'report_tour') continue;

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
                if (g.bot_role === 'report_tour' && summarizeTourDaily) {
                    await summarizeTourDaily(g.group_id);
                    continue;
                }
                const appointments = await repository.findTodayOf(g.group_id);
                await notifier.send(g.group_id, g.bot_role,
                    buildDailySummary(appointments, todayStr), 'schedule_daily_summary');

                // Nhóm report không còn yêu cầu gửi ảnh nên không gửi danh sách thiếu ảnh vào cuối ngày.
            }
        } catch (e) {
            console.error('Lỗi cron 22h đêm lịch khách:', e);
        }
    }

    /**
     * 00:00 — nhóm report_tour đã chốt công tour trong ngày lúc 22:00,
     * nên không gửi lại bản báo cáo lúc 00:00.
     */
    async function summarizeTourWork() {
        return;
    }

    return { reportTomorrow, reportToday, summarizeTourWork };
}
