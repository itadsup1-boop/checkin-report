/**
 * Tính phạt đi muộn từ check-in đầu tiên trong ngày của mỗi người: lần đầu
 * trong tháng được miễn, sau đó luỹ tiến theo số phút muộn.
 *
 * Ân hạn chung cho MỌI ca (sáng/chiều/cả ngày/làm bù): đến trong vòng
 * `LATE_GRACE_MINUTES` phút đầu kể từ giờ vào ca vẫn tính ON_TIME, không ghi
 * nhận đi muộn, không cần báo trước gì cả. Chỉ từ phút thứ
 * `LATE_GRACE_MINUTES + 1` trở đi mới bắt đầu tính là đi muộn.
 *
 * Có đơn báo trước (bất kể báo trước giờ làm bao lâu, kể cả sát giờ — không
 * còn mốc "phải báo trước 30 phút"), áp dụng cho phần vượt quá ân hạn ở trên:
 *   - Đến trong đúng số phút đã báo (vd báo muộn 5 phút, đến muộn ≤ 5 phút
 *     tính từ giờ vào ca) → miễn hoàn toàn.
 *   - Đến muộn hơn số phút đã báo → vẫn giảm 50% trên mức phạt theo số phút
 *     muộn THỰC TẾ.
 */
const LATE_ELIGIBLE_SHIFTS = ['CA_1', 'CA_2', 'CA_SANG', 'CA_CHIEU', 'FULL_DAY', 'HALF_DAY_PM_WORK'];
const LATE_GRACE_MINUTES = 32;

function computePenaltyAmount(lateMinutes, prevCount, currentMonth, currentYear) {
    if (prevCount === 0) {
        return { amount: 0, reason: `Đi muộn lần 1 trong tháng ${currentMonth}/${currentYear} (Miễn phạt)` };
    }
    if (lateMinutes < 15) {
        return { amount: 20000, reason: `Đi muộn lần ${prevCount + 1} trong tháng (${lateMinutes} phút - dưới 15p)` };
    }
    if (lateMinutes < 90) {
        return { amount: 20000 + (lateMinutes - 15) * 2000, reason: `Đi muộn lần ${prevCount + 1} trong tháng (${lateMinutes} phút - phạt 2k/phút từ phút 16)` };
    }
    return { amount: 200000, reason: `Đi muộn lần ${prevCount + 1} trong tháng (${lateMinutes} phút - từ 90p trở lên)` };
}

export function createRunLatePenaltyCheck({ repository, sendMessageToRoleGroup, bot, moment, extraUnannouncedLatePenaltyEnabled = false }) {
    function shiftStartTimeOf(checkin) {
        if (checkin.shift_type === 'CA_1' || checkin.shift_type === 'CA_SANG' || checkin.shift_type === 'FULL_DAY') {
            return checkin.shift_1_time || '08:00:00';
        }
        if (checkin.shift_type === 'CA_2' || checkin.shift_type === 'CA_CHIEU') {
            return checkin.shift_2_time || '13:30:00';
        }
        if (checkin.shift_type === 'HALF_DAY_PM_WORK') return '13:30:00';
        return '08:00:00';
    }

    async function processCheckin(checkin, currentMonth, currentYear) {
        let attendanceSheetDirty = false;
        if (!LATE_ELIGIBLE_SHIFTS.includes(checkin.shift_type)) return attendanceSheetDirty;

        const shiftStart = shiftStartTimeOf(checkin);
        const checkInTimeStr = moment(checkin.check_in_time).utcOffset(7).format('HH:mm:ss');
        const checkInMoment = moment(checkInTimeStr, 'HH:mm:ss');
        const shiftStartMoment = moment(shiftStart, 'HH:mm:ss');

        const lateMinutes = checkInMoment.diff(shiftStartMoment, 'minutes');
        if (lateMinutes <= LATE_GRACE_MINUTES) {
            await repository.upsertAttendanceResult(checkin.group_id, checkin.user_id, checkin.date, 'ON_TIME');
            return true;
        }

        const existingPenalty = await repository.findExistingLatePenalty(checkin.user_id, checkin.date);
        if (!existingPenalty) {
            const prevCount = await repository.findLatePenaltyCountInMonth(checkin.user_id, currentMonth, currentYear);
            let { amount, reason } = computePenaltyAmount(lateMinutes, prevCount, currentMonth, currentYear);

            const approvedLateLeave = await repository.findApprovedLateLeaveRequest(checkin.user_id, checkin.date);
            if (approvedLateLeave && amount > 0) {
                const declaredMinutes = Number(approvedLateLeave.late_minutes) || 0;
                if (declaredMinutes > 0 && lateMinutes <= declaredMinutes) {
                    amount = 0;
                    reason = `Đã báo trước đi muộn ${declaredMinutes} phút, đến đúng trong thời gian đã báo (Miễn phạt)`;
                } else {
                    amount = amount / 2;
                    reason += ' (Đã giảm 50% do có đơn báo trước)';
                }
            } else if (amount > 0 && extraUnannouncedLatePenaltyEnabled) {
                amount += 100000;
                reason += ' (Phạt thêm 100k do không có đơn báo trước)';
            }

            await repository.insertLatePenalty({ groupId: checkin.group_id, userId: checkin.user_id, date: checkin.date, lateMinutes, amount, reason });

            if (checkin.telegram_group_id) {
                const penaltyText = amount > 0 ? `💸 Bị phạt: <b>${amount.toLocaleString('vi-VN')} VNĐ</b>` : `✅ Miễn phạt (Đi muộn lần đầu)`;
                const msg = `⏰ <b>THÔNG BÁO GHI NHẬN ĐI MUỘN</b> ⏰\n\n` +
                    `👤 <b>Nhân sự:</b> ${checkin.full_name}\n` +
                    `📅 <b>Ngày:</b> ${moment(checkin.date).format('DD/MM/YYYY')}\n` +
                    `🔴 <b>Số phút đi muộn:</b> ${lateMinutes} phút\n` +
                    `💰 <b>Trạng thái phạt:</b> ${penaltyText}\n` +
                    `📝 <b>Chi tiết:</b> ${reason}`;
                try {
                    await sendMessageToRoleGroup(bot, checkin.telegram_group_id, 'timekeep', msg, { parse_mode: 'HTML' }, 'late_penalty_notice');
                } catch (err) {
                    console.error(err);
                }
            }
        }

        await repository.upsertAttendanceResult(checkin.group_id, checkin.user_id, checkin.date, 'LATE');
        return true;
    }

    async function runLatePenaltyCheck({ todayStr, currentMonth, currentYear }) {
        let attendanceSheetDirty = false;
        const checkins = await repository.findFirstCheckInsOfDay(todayStr);
        for (const checkin of checkins) {
            const dirty = await processCheckin(checkin, currentMonth, currentYear);
            attendanceSheetDirty = attendanceSheetDirty || dirty;
        }
        return attendanceSheetDirty;
    }

    return { runLatePenaltyCheck };
}
