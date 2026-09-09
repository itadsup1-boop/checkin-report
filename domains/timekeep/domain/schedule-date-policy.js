function normalizeDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        return null;
    }

    return value;
}

/**
 * Nhân viên chỉ được đăng ký từ ngày hiện tại trở đi. Admin vẫn có thể sửa
 * lịch sử để xử lý đối soát, nhưng mọi ngày gửi lên đều phải đúng YYYY-MM-DD.
 */
export function validateScheduleDates({ days, today, isAdmin = false }) {
    const todayKey = normalizeDateKey(today);
    if (!todayKey) {
        throw new Error('Ngày hiện tại không hợp lệ.');
    }
    if (!Array.isArray(days) || days.length === 0) {
        return { valid: false, reason: 'EMPTY_DAYS' };
    }

    for (const day of days) {
        const dateKey = normalizeDateKey(day?.date);
        if (!dateKey) {
            return { valid: false, reason: 'INVALID_DATE', date: day?.date ?? null };
        }
        if (!isAdmin && dateKey < todayKey) {
            return { valid: false, reason: 'PAST_DATE', date: dateKey };
        }
    }

    return { valid: true };
}

export { normalizeDateKey };
