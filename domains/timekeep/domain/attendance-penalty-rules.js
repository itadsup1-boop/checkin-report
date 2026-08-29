/**
 * Quy tắc phạt chấm công: mức tiền, ca làm việc hợp lệ, loại đơn nghỉ, và soạn
 * tin thông báo vắng mặt.
 *
 * Thuần — không pg/express/telegraf.
 */

export const WORKING_SHIFTS = [
    'CA_1',
    'CA_2',
    'CA_SANG',
    'CA_CHIEU',
    'FULL_DAY',
    'HALF_DAY_PM_WORK'
];

export const LEAVE_REQUEST_TYPES = ['FULL_DAY', 'HALF_DAY_AM', 'HALF_DAY_PM'];

export const TIMEKEEP_PENALTIES = Object.freeze({
    UNAUTHORIZED_ABSENT: 50000,
    SUDDEN_LEAVE: 100000,
    CONSECUTIVE_LEAVE: 200000
});

export function formatVietnameseDate(date) {
    const [year, month, day] = String(date).split('-');
    return `${day}/${month}/${year}`;
}

/** Gom danh sách người vắng theo nhóm để soạn một tin nhắn mỗi nhóm thay vì mỗi người. */
export function groupAbsenceNotifications(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = String(row.group_id);
        if (!groups.has(key)) {
            groups.set(key, {
                groupId: row.group_id,
                telegramGroupId: row.telegram_group_id,
                groupName: row.group_name,
                date: row.date,
                employees: []
            });
        }
        groups.get(key).employees.push({ userId: row.user_id, fullName: row.full_name });
    }
    return [...groups.values()];
}

export function buildAbsenceNotificationText(group) {
    const names = group.employees.map(employee => `• ${employee.fullName} — phạt 50.000đ`).join('\n');
    const total = group.employees.length * TIMEKEEP_PENALTIES.UNAUTHORIZED_ABSENT;
    return `🚫 <b>THÔNG BÁO NHÂN SỰ KHÔNG CHECK-IN</b>\n\n` +
        `⏰ Đến 14:00 ngày <b>${formatVietnameseDate(group.date)}</b>, các nhân sự sau không check-in và không có đơn báo nghỉ:\n\n` +
        `${names}\n\n` +
        `💰 Tổng tiền phạt: <b>${total.toLocaleString('vi-VN')}đ</b>\n` +
        `<i>Dữ liệu đã được ghi nhận vào bảng chấm công.</i>`;
}
