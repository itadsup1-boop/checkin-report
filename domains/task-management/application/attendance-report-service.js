import { normalizeVi } from '../interfaces/telegram/nlp-parser.js';
import { vietnamToday } from './task-service.js';

const VN_TZ = 'Asia/Ho_Chi_Minh';

function shiftDate(dateText, days) {
    const date = new Date(`${dateText}T12:00:00+07:00`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toLocaleDateString('en-CA', { timeZone: VN_TZ });
}

function parseDateInput(input, now) {
    if (!input) return null;
    const text = normalizeVi(input);
    if (['hom nay', 'nay'].includes(text)) return vietnamToday(now);
    if (text === 'hom qua') return shiftDate(vietnamToday(now), -1);
    if (['ngay mai', 'mai'].includes(text)) return shiftDate(vietnamToday(now), 1);
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    const monthText = /^(\d{1,2})\s+thang\s+(\d{1,2})(?:\s+nam\s+(\d{4}))?$/.exec(text);
    if (monthText) {
        const year = Number(monthText[3] || vietnamToday(now).slice(0, 4));
        return validDate(year, Number(monthText[2]), Number(monthText[1]));
    }
    const vi = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/.exec(text);
    if (vi) {
        const year = Number(vi[3] || vietnamToday(now).slice(0, 4));
        return validDate(year, Number(vi[2]), Number(vi[1]));
    }
    return null;
}

function validDate(year, month, day) {
    const value = new Date(Date.UTC(year, month - 1, day));
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
    return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseTimeInput(input) {
    const normalized = normalizeVi(input);
    const match = /^(?:luc|vao|khoang)?\s*(\d{1,2})(?::(\d{2})|h\s*(\d{1,2})?|\s*gio(?:\s*(\d{1,2})\s*phut)?)\s*(sang|trua|chieu|toi)?$/.exec(normalized);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] || match[3] || match[4] || 0);
    if (['chieu', 'toi'].includes(match[5]) && hour < 12) hour += 12;
    if (match[5] === 'trua' && hour < 11) hour += 12;
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatDate(date) {
    return date.split('-').reverse().join('/');
}

function formatMoney(value) {
    return Number(value || 0).toLocaleString('vi-VN');
}

function dateRange(fromDate, toDate) {
    const dates = [];
    for (let current = fromDate; current <= toDate; current = shiftDate(current, 1)) dates.push(current);
    return dates;
}

function matchesGroup(group, query) {
    if (!query) return true;
    const requested = normalizeVi(query);
    return normalizeVi(group.group_name).includes(requested)
        || requested.includes(normalizeVi(group.group_name))
        || normalizeVi(group.telegram_group_id) === requested;
}

function isInScope(group, manager, accessService) {
    return accessService.isWithinScope(manager, { telegramGroupId: group.telegram_group_id });
}

export function createAttendanceReportService({ reportRepository, accessService, taskRepository }) {
    async function resolveGroups({ groupQuery, groupId = null, manager }) {
        const all = await reportRepository.listGroups();
        const matched = all.filter(group => groupId ? String(group.id) === String(groupId) : matchesGroup(group, groupQuery))
            .filter(group => isInScope(group, manager, accessService));
        if (groupQuery && !all.some(group => matchesGroup(group, groupQuery))) {
            const error = new Error(`Không tìm thấy nhóm "${groupQuery}".`);
            error.code = 'REPORT_GROUP_NOT_FOUND';
            throw error;
        }
        if (groupQuery && !matched.length) {
            const error = new Error(`Bạn không có quyền xem báo cáo nhóm "${groupQuery}".`);
            error.code = 'REPORT_GROUP_FORBIDDEN';
            throw error;
        }
        if (!matched.length) {
            const error = new Error('Không có nhóm nào trong phạm vi báo cáo của bạn.');
            error.code = 'REPORT_GROUP_EMPTY';
            throw error;
        }
        return matched;
    }

    function resolveRange(intent, now = new Date()) {
        const today = vietnamToday(now);
        const fromDate = parseDateInput(intent.fromInput, now) || today;
        const toDate = parseDateInput(intent.toInput, now) || fromDate;
        if (fromDate > toDate) {
            const error = new Error('Khoảng ngày không hợp lệ: ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
            error.code = 'REPORT_DATE_RANGE_INVALID';
            throw error;
        }
        return { fromDate, toDate };
    }

    function formatLateReport(rows, fromDate, toDate) {
        const byGroup = new Map();
        for (const row of rows) {
            if (!row.is_late) continue;
            if (!byGroup.has(row.group_id)) byGroup.set(row.group_id, { name: row.group_name, rows: [] });
            byGroup.get(row.group_id).rows.push(row);
        }
        const lines = [
            '📊 DANH SÁCH ĐI LÀM MUỘN',
            `📅 ${formatDate(fromDate)}${fromDate === toDate ? '' : ` - ${formatDate(toDate)}`}`
        ];
        if (!byGroup.size) return lines.concat('✅ Không có nhân viên đi muộn trong khoảng thời gian này.').join('\n');
        for (const group of byGroup.values()) {
            lines.push('', `👥 Nhóm ${group.name} (${group.rows.length} người)`);
            for (const row of group.rows) {
                const dateLabel = fromDate === toDate ? '' : `${formatDate(row.report_date)} — `;
                const time = row.check_in_time ? new Date(row.check_in_time).toLocaleTimeString('vi-VN', {
                    timeZone: VN_TZ, hour: '2-digit', minute: '2-digit'
                }) : 'chưa có giờ vào';
                const late = Number(row.late_minutes) ? `, muộn ${row.late_minutes} phút` : '';
                lines.push(`• ${dateLabel}${row.full_name} — ${time}${late}`);
            }
        }
        return lines.join('\n');
    }

    function formatSummary(rows, fromDate, toDate) {
        const lines = [
            '📊 BÁO CÁO THỐNG KÊ CHẤM CÔNG',
            `📅 ${formatDate(fromDate)}${fromDate === toDate ? '' : ` - ${formatDate(toDate)}`}`
        ];
        let totals = { active_employee_count: 0, scheduled_count: 0, checkin_count: 0, late_count: 0, absent_count: 0, on_time_count: 0, penalty_total: 0 };
        for (const row of rows) {
            const late = Number(row.late_count || 0);
            const onTime = Number(row.on_time_count || 0);
            lines.push('', `👥 Nhóm ${row.group_name}`,
                `• Nhân sự đang hoạt động: ${row.active_employee_count}`,
                `• Ca đã xếp: ${row.scheduled_count}`,
                `• Đã check-in: ${row.checkin_count}`,
                `• Đúng giờ: ${onTime}`,
                `• Đi muộn: ${late}`,
                `• Vắng/chưa check-in theo lịch: ${row.absent_count}`,
                `• Tiền phạt đi muộn: ${formatMoney(row.penalty_total)} VNĐ`);
            for (const key of Object.keys(totals)) totals[key] += Number(row[key] || 0);
        }
        lines.splice(2, 0, '', `📌 Tổng tất cả nhóm: ${totals.active_employee_count} nhân sự, ${totals.checkin_count} lượt check-in, ${totals.late_count} lượt muộn, ${totals.absent_count} lượt vắng.`);
        return lines.join('\n');
    }

    async function buildReport({ manager, intent, now = new Date() }) {
        const groups = await resolveGroups({ groupQuery: intent.groupQuery, groupId: intent.groupId, manager });
        const { fromDate, toDate } = resolveRange(intent, now);
        const groupIds = groups.map(group => group.id);
        if (intent.metric === 'late') {
            const rows = [];
            for (const date of dateRange(fromDate, toDate)) {
                rows.push(...await reportRepository.listAttendanceForDate(groupIds, date));
            }
            return formatLateReport(rows, fromDate, toDate);
        }
        const summaries = await reportRepository.summarizeAttendance(groupIds, fromDate, toDate);
        return formatSummary(summaries, fromDate, toDate);
    }

    async function scheduleDaily({ manager, managerId, chatId, intent }) {
        if (!intent.groupQuery) throw new Error('Hãy nêu rõ tên nhóm cần gửi báo cáo hằng ngày.');
        const localTime = parseTimeInput(intent.timeInput);
        if (!localTime) throw new Error('Chưa đọc được giờ gửi báo cáo. Ví dụ: 8h sáng, 18:00 hoặc 5h chiều.');
        const groups = await resolveGroups({ groupQuery: intent.groupQuery, manager });
        for (const group of groups) {
            await reportRepository.createSchedule({
                managerId, chatId, groupId: group.id, frequency: 'DAILY', localTime
            });
        }
        return { groups, localTime };
    }

    async function runScheduledReports({ now = new Date() }) {
        const date = vietnamToday(now);
        const localTime = now.toLocaleTimeString('en-GB', { timeZone: VN_TZ, hour: '2-digit', minute: '2-digit' });
        const schedules = await reportRepository.findDueSchedules(date, localTime);
        for (const schedule of schedules) {
            try {
                const manager = await accessService.getManager(schedule.manager_id);
                if (!accessService.hasPermission(manager, 'reports.aggregate')) continue;
                const text = await buildReport({
                    manager,
                    intent: { metric: 'summary', groupId: schedule.group_id, fromInput: 'hôm nay', toInput: 'hôm nay' },
                    now
                });
                await taskRepository.enqueueOutbox({
                    deduplicationKey: `attendance-report:${schedule.id}:${date}`,
                    chatId: schedule.telegram_chat_id,
                    text
                });
                await reportRepository.markScheduleSent(schedule.id, date);
            } catch (error) {
                console.error(`[TaskManagement Attendance Report] Lỗi lịch #${schedule.id}:`, error.message);
            }
        }
        return schedules.length;
    }

    return { buildReport, scheduleDaily, runScheduledReports, resolveRange, parseDateInput, parseTimeInput };
}
