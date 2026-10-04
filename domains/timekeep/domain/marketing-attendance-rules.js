/**
 * Quy tắc chấm công riêng cho Team Marketing (áp dụng từ 24/09/2026).
 * Thuần - không express, pg, telegraf.
 */

export const MARKETING_CHECKIN_DEADLINE = '08:30:00';
export const MARKETING_CHECKIN_GRACE_MINUTES = 5;
export const MARKETING_LATE_HALF_DAY_DEADLINE = '09:30:00';
export const MARKETING_SUNDAY_CHECKIN_DEADLINE = '09:00:00';
export const MARKETING_SUNDAY_LATE_HALF_DAY_DEADLINE = '10:00:00';
export const MARKETING_CHECKOUT_MIN_TIME = '18:30:00';

export const MARKETING_PENALTIES = Object.freeze({
    CHECKIN_VIOLATION: 50000,
    MISSED_CHECKOUT: 20000
});

export const ATTENDANCE_POLICIES = Object.freeze({
    CLINIC: 'CLINIC',
    MARKETING: 'MARKETING'
});

export function isMarketingPolicy(policy) {
    return String(policy || '').toUpperCase() === ATTENDANCE_POLICIES.MARKETING;
}

/**
 * Đánh giá lượt check-in của nhân viên Marketing dựa trên giờ gửi video (HH:mm:ss).
 *
 * 1. Trước hoặc đúng deadline (mặc định 08:30) -> Đúng giờ, công 1.0, phạt 0đ.
 * 2. Từ deadline đến lateCutoff (mặc định 09:30) -> Muộn, phạt 50.000đ (hoặc cấu hình), công 1.0.
 * 3. Sau lateCutoff (muộn > 60 phút) -> Muộn, phạt tiền & trừ 1/2 ngày công (công 0.5).
 */
export function evaluateMarketingCheckin(timeStr, options = {}) {
    const penaltyAmount = options.penalty !== undefined ? Number(options.penalty) : MARKETING_PENALTIES.CHECKIN_VIOLATION;
    const deadline = options.deadline ? (options.deadline.length === 5 ? `${options.deadline}:00` : options.deadline) : MARKETING_CHECKIN_DEADLINE;
    const lateCutoff = options.lateCutoff ? (options.lateCutoff.length === 5 ? `${options.lateCutoff}:00` : options.lateCutoff) : MARKETING_LATE_HALF_DAY_DEADLINE;

    if (!timeStr) {
        return {
            isLate: true,
            penalty: penaltyAmount,
            workCredit: 0.0,
            status: 'KHONG_CHECKIN',
            reason: `Không check-in (Phạt ${penaltyAmount.toLocaleString('vi-VN')}đ)`
        };
    }

    const cleanTime = String(timeStr).trim().slice(0, 8);

    if (cleanTime <= deadline) {
        return {
            isLate: false,
            penalty: 0,
            workCredit: 1.0,
            status: 'DUNG_GIO',
            reason: 'Check-in đúng giờ'
        };
    }

    if (cleanTime <= lateCutoff) {
        return {
            isLate: true,
            penalty: penaltyAmount,
            workCredit: 1.0,
            status: 'MUON_DUOI_60P',
            reason: `Check-in sau ${deadline.slice(0, 5)} (Phạt ${penaltyAmount.toLocaleString('vi-VN')}đ)`
        };
    }

    return {
        isLate: true,
        penalty: penaltyAmount,
        workCredit: 0.5,
        status: 'MUON_TREN_60P',
        reason: `Đi muộn quá 60 phút - sau ${lateCutoff.slice(0, 5)} (Phạt ${penaltyAmount.toLocaleString('vi-VN')}đ & Trừ 1/2 ngày công)`
    };
}

/**
 * Kiểm tra xem thời điểm gửi có đủ điều kiện check-out (sau checkout_min_time, mặc định 18:30).
 */
export function isMarketingCheckoutEligible(timeStr, minTime = MARKETING_CHECKOUT_MIN_TIME) {
    if (!timeStr) return false;
    const cleanTime = String(timeStr).trim().slice(0, 8);
    const cleanMin = String(minTime).trim().slice(0, 8);
    return cleanTime >= cleanMin;
}

/**
 * Nhận diện từ khoá / tín hiệu check-out trong tin nhắn hoặc caption.
 */
export function isCheckoutTrigger(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase();
    return lower.includes('#checkout') ||
           lower.includes('/checkout') ||
           /(?:^|\s)(?:check\s*out|checkout)(?:$|\s)/i.test(lower);
}

/**
 * Soạn tin nhắn Telegram phản hồi check-in cho Marketing.
 */
export function formatMarketingCheckinReply({ fullName, role, timeStr, evaluation }) {
    if (!evaluation.isLate) {
        const statusText = evaluation.reason && (evaluation.reason.includes('đơn xin') || evaluation.reason.includes('xin đi muộn'))
            ? 'Đúng giờ (Có đơn xin đi muộn hợp lệ, Công 1.0)'
            : 'Đúng giờ (Công 1.0)';
        return (
            `🎬 <b>[CHECK-IN HỢP LỆ – MARKETING]</b> 🎬\n\n` +
            `👤 <b>Nhân viên:</b> ${fullName}\n` +
            `💼 <b>Vị trí:</b> ${role || 'Marketing'}\n` +
            `⏰ <b>Thời gian:</b> ${timeStr}\n` +
            `✅ <b>Trạng thái:</b> ${statusText}\n\n` +
            `<i>Chúc bạn một ngày làm việc hiệu quả và bùng nổ KPI!</i>`
        );
    }

    const penaltyFormatted = Number(evaluation.penalty || 0).toLocaleString('vi-VN');
    const creditText = evaluation.workCredit === 0.5 ? 'Trừ 1/2 ngày công (còn 0.5 công)' : 'Tính đủ 1.0 công';

    return (
        `⚠️ <b>[GHI NHẬN ĐI MUỘN – MARKETING]</b> ⚠️\n\n` +
        `👤 <b>Nhân viên:</b> ${fullName}\n` +
        `💼 <b>Vị trí:</b> ${role || 'Marketing'}\n` +
        `⏰ <b>Thời gian:</b> ${timeStr}\n` +
        `🔴 <b>Chi tiết:</b> ${evaluation.reason}\n` +
        `💸 <b>Mức phạt:</b> <b>${penaltyFormatted}đ</b>\n` +
        `📝 <b>Chế tài ngày công:</b> ${creditText}\n\n` +
        `<i>Lưu ý: Mọi trường hợp đặc biệt cần báo trước cho Quản lý để được xem xét.</i>`
    );
}

/**
 * Soạn tin nhắn Telegram phản hồi check-out thành công cho Marketing.
 */
export function formatMarketingCheckoutReply({ fullName, role, timeStr }) {
    return (
        `🏁 <b>[CHECK-OUT THÀNH CÔNG – MARKETING]</b> 🏁\n\n` +
        `👤 <b>Nhân viên:</b> ${fullName}\n` +
        `💼 <b>Vị trí:</b> ${role || 'Marketing'}\n` +
        `⏰ <b>Giờ kết thúc ca:</b> ${timeStr}\n` +
        `✅ <b>Trạng thái:</b> Đã hoàn thành ngày làm việc!\n\n` +
        `<i>Hẹn gặp lại bạn vào ca làm việc tiếp theo!</i>`
    );
}

/**
 * Soạn tin nhắn thông báo phạt những nhân sự quên check-out cuối ngày.
 */
export function formatMissedCheckoutNotification({ dateFormatted, employees, penaltyPerEmployee = MARKETING_PENALTIES.MISSED_CHECKOUT }) {
    const penaltyFormatted = Number(penaltyPerEmployee).toLocaleString('vi-VN');
    const names = employees.map(e => `• ${e.fullName} — phạt ${penaltyFormatted}đ (Quên check-out)`).join('\n');
    const total = employees.length * penaltyPerEmployee;
    return (
        `⚠️ <b>THÔNG BÁO QUÊN CHECK-OUT – MARKETING</b>\n\n` +
        `⏰ Kết thúc ngày làm việc <b>${dateFormatted}</b>, các nhân sự sau có check-in nhưng không thực hiện check-out:\n\n` +
        `${names}\n\n` +
        `💰 Tổng tiền phạt: <b>${total.toLocaleString('vi-VN')}đ</b>\n` +
        `<i>Quy định: Quên check-out phạt ${penaltyFormatted}đ/lần. Dữ liệu đã lưu vào hệ thống chấm công.</i>`
    );
}

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
}

function minutesToTime(totalMinutes) {
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Tính toán mốc deadline, lateCutoff và shiftStartTime cho Marketing check-in:
 * - Có đơn xin đi muộn (approvedLateLeave): chỉ cộng approvedMinutes, không cộng thêm 5 phút ân hạn.
 * - Không có đơn xin đi muộn: cộng thêm 5 phút ân hạn vào deadline (8h30 -> 8h35),
 *   nhưng shiftStartTime giữ nguyên mốc ca (8h30) để tính phạt nếu check-in muộn quá 8h35.
 */
export function resolveMarketingCheckinDeadlines({
    policyInfo,
    telegramGroupId,
    isSunday = false,
    isCa2 = false,
    approvedLateLeave = null,
    approvedMinutes = 0
}) {
    const hasSundaySpecial = isSunday && (Boolean(policyInfo?.marketing_sunday_checkin_deadline) || String(telegramGroupId) === '-5470063387');
    let baseDeadline;
    let lateCutoff;
    if (isCa2) {
        baseDeadline = '09:30:00';
        lateCutoff = '10:30:00';
    } else {
        baseDeadline = hasSundaySpecial
            ? (policyInfo?.marketing_sunday_checkin_deadline || '09:00:00')
            : (policyInfo?.marketing_checkin_deadline || '08:30:00');
        lateCutoff = hasSundaySpecial
            ? (policyInfo?.marketing_sunday_late_cutoff || '10:00:00')
            : (policyInfo?.marketing_late_cutoff || '09:30:00');
    }

    const graceMinutes = policyInfo?.marketing_checkin_grace_minutes !== undefined
        ? Number(policyInfo.marketing_checkin_grace_minutes)
        : MARKETING_CHECKIN_GRACE_MINUTES;

    let deadline = baseDeadline;
    let shiftStartTime = baseDeadline;

    if (approvedLateLeave) {
        if (approvedMinutes > 0) {
            const baseMin = timeToMinutes(baseDeadline);
            shiftStartTime = minutesToTime(baseMin + approvedMinutes);
            deadline = shiftStartTime;
            lateCutoff = minutesToTime(baseMin + approvedMinutes + 60);
        }
    } else if (graceMinutes > 0) {
        const baseMin = timeToMinutes(baseDeadline);
        deadline = minutesToTime(baseMin + graceMinutes);
    }

    return { deadline, lateCutoff, shiftStartTime, baseDeadline };
}

