/**
 * Mốc thời gian theo giờ Việt Nam (UTC+7).
 *
 * Cộng thẳng 7 giờ vào mốc UTC thay vì dựa vào múi giờ của máy: bot chạy cả trên
 * máy Windows lẫn trong Docker, mà container thường để TZ=UTC. Dựa vào giờ máy
 * thì cùng một lệnh sẽ ra hai kết quả khác nhau ở hai nơi.
 */

const nowVN = () => new Date(Date.now() + 7 * 60 * 60 * 1000);

/** Hôm nay dạng YYYY-MM-DD theo giờ Việt Nam. */
export function getTodayVN() {
    return nowVN().toISOString().slice(0, 10);
}

/**
 * Tuần hiện tại theo chuẩn ISO: thứ Hai → Chủ Nhật.
 * Chủ Nhật thuộc về tuần VỪA QUA, không phải tuần mới bắt đầu.
 */
export function getIsoWeekRangeVN() {
    const now = nowVN();
    const day = now.getUTCDay();
    const diffToMonday = (day === 0) ? -6 : 1 - day;

    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    return {
        start: monday.toISOString().slice(0, 10),
        end: sunday.toISOString().slice(0, 10)
    };
}
