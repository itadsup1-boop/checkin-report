/**
 * Tổng hợp phạt chấm công theo tuần (Thứ Hai → Chủ nhật) và soạn tin gửi nhóm.
 *
 * Thuần — không pg/express/telegraf.
 */

import { formatVietnameseDate } from './attendance-penalty-rules.js';

/**
 * Nhóm nhận tổng kết phạt tuần. Trước mắt chỉ nhóm check-in VP Nam Đồng;
 * muốn mở rộng nhóm khác chỉ cần thêm tên nhóm vào đây.
 */
export const WEEKLY_PENALTY_GROUP_NAMES = Object.freeze([
    '00. CHECK IN vp Nam Đồng'
]);

export const WEEKLY_SUMMARY_VIOLATION_TYPES = Object.freeze([
    'LATE',
    'UNAUTHORIZED_ABSENT',
    'SUDDEN_LEAVE',
    'CONSECUTIVE_LEAVE'
]);

export function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function formatVnd(amount) {
    return `${Number(amount || 0).toLocaleString('vi-VN')}đ`;
}

/**
 * Gom dòng phạt trong tuần về từng nhân viên. Bỏ qua dòng đã được miễn trừ
 * (amount = 0) — giống query phía SQL nhưng chặn nốt ở đây cho chắc.
 */
export function aggregateWeeklyPenalties(rows) {
    const employees = new Map();
    for (const row of rows) {
        if (!WEEKLY_SUMMARY_VIOLATION_TYPES.includes(row.violation_type)) continue;
        const amount = Number(row.amount) || 0;
        if (amount <= 0) continue;

        if (!employees.has(row.user_id)) {
            employees.set(row.user_id, {
                userId: row.user_id,
                fullName: row.full_name || 'Chưa xác định',
                lateCount: 0,
                lateMinutesList: [],
                lateAmount: 0,
                absentCount: 0,
                absentAmount: 0,
                suddenLeaveCount: 0,
                suddenLeaveAmount: 0,
                totalAmount: 0
            });
        }

        const employee = employees.get(row.user_id);
        employee.totalAmount += amount;

        if (row.violation_type === 'LATE') {
            employee.lateCount += 1;
            employee.lateMinutesList.push(Number(row.late_minutes) || 0);
            employee.lateAmount += amount;
        } else if (row.violation_type === 'UNAUTHORIZED_ABSENT') {
            employee.absentCount += 1;
            employee.absentAmount += amount;
        } else if (row.violation_type === 'SUDDEN_LEAVE' || row.violation_type === 'CONSECUTIVE_LEAVE') {
            employee.suddenLeaveCount += 1;
            employee.suddenLeaveAmount += amount;
        }
    }
    return [...employees.values()];
}

function appendViolationLines(employee) {
    const lines = [];
    if (employee.lateCount > 0) {
        const minutes = employee.lateMinutesList.map(minute => `${minute}p`).join(', ');
        lines.push(`• Đi muộn ${employee.lateCount} lần (${minutes}): ${formatVnd(employee.lateAmount)}`);
    }
    if (employee.absentCount > 0) {
        lines.push(`• Vắng không phép ${employee.absentCount} ngày: ${formatVnd(employee.absentAmount)}`);
    }
    if (employee.suddenLeaveCount > 0) {
        lines.push(`• Nghỉ đột xuất không phép ${employee.suddenLeaveCount} lần: ${formatVnd(employee.suddenLeaveAmount)}`);
    }
    return lines;
}

/**
 * Soạn tin tổng kết phạt tuần theo mẫu đã chốt với sếp. Không bao giờ trả null —
 * tuần không ai vi phạm vẫn gửi tin báo "không ai vi phạm".
 */
export function buildWeeklyPenaltyMessage({ groupName, startDate, endDate, employees = [] }) {
    let msg = `⚠️ <b>TỔNG HỢP PHẠT CHẤM CÔNG TUẦN (${formatVietnameseDate(startDate)} → ${formatVietnameseDate(endDate)})</b>\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    if (groupName) {
        msg += `Nhóm: <b>${escapeHtml(groupName)}</b>\n`;
    }

    if (employees.length === 0) {
        msg += `\n✅ Tuần này không có nhân sự nào vi phạm chấm công.`;
        return msg;
    }

    const totalGroupAmount = employees.reduce((sum, employee) => sum + employee.totalAmount, 0);
    const totalViolationCount = employees.reduce((sum, employee) =>
        sum + employee.lateCount + employee.absentCount + employee.suddenLeaveCount, 0);

    for (const employee of employees) {
        msg += `\n👤 <b>${escapeHtml(employee.fullName)}</b>\n`;
        for (const line of appendViolationLines(employee)) {
            msg += `${line}\n`;
        }
        msg += `→ Tổng: <b>${formatVnd(employee.totalAmount)}</b>\n`;
    }

    msg += `\n━━━━━━━━━━━━━━━━\n`;
    msg += `Tổng nhóm: <b>${employees.length}</b> người vi phạm — <b>${formatVnd(totalGroupAmount)}</b> (${totalViolationCount} lần vi phạm)`;
    return msg;
}
