/**
 * Quét phạt nhân sự Marketing quên check-out cuối ngày.
 * Sử dụng mức phạt cấu hình riêng của từng nhóm (mặc định 20.000đ).
 */
import { formatMissedCheckoutNotification, MARKETING_PENALTIES } from '../domain/marketing-attendance-rules.js';

export function createScanMarketingCheckout({ checkinRepository, bot, sendMessageToRoleGroup, moment, syncSheets, effectiveStartDate = '2026-09-29' }) {
    async function scanEveningCheckout(dateStr) {
        // Chỉ bắt đầu quét phạt check-out Marketing từ ngày có hiệu lực (mặc định 29/09/2026)
        if (dateStr && dateStr < effectiveStartDate) {
            return false;
        }

        const unchecked = await checkinRepository.findMarketingUncheckedOut({ date: dateStr });
        if (!unchecked || unchecked.length === 0) return false;

        const groups = new Map();
        for (const row of unchecked) {
            const key = String(row.telegram_group_id);
            const penaltyAmount = Number(row.marketing_checkout_penalty || MARKETING_PENALTIES.MISSED_CHECKOUT);

            if (!groups.has(key)) {
                groups.set(key, {
                    telegramGroupId: row.telegram_group_id,
                    penaltyPerEmployee: penaltyAmount,
                    employees: []
                });
            }
            groups.get(key).employees.push(row);

            // Đánh dấu QUEN_CHECKOUT và ghi nhận phạt theo cấu hình nhóm
            await checkinRepository.markMissedCheckout({ checkinId: row.id, penaltyAmount });
            await checkinRepository.insertCheckoutPenalty({
                groupId: row.group_id,
                userId: row.user_id,
                date: row.date,
                amount: penaltyAmount,
                reason: `Quên check-out cuối ca (Phạt ${penaltyAmount.toLocaleString('vi-VN')}đ)`
            });
        }

        const dateFormatted = moment(dateStr).format('DD/MM/YYYY');
        for (const group of groups.values()) {
            const msg = formatMissedCheckoutNotification({
                dateFormatted,
                employees: group.employees.map(e => ({ fullName: e.full_name })),
                penaltyPerEmployee: group.penaltyPerEmployee
            });
            try {
                if (typeof sendMessageToRoleGroup === 'function') {
                    await sendMessageToRoleGroup(bot, group.telegramGroupId, 'timekeep', msg, { parse_mode: 'HTML' }, 'marketing_checkout_notice');
                } else if (bot?.telegram?.sendMessage) {
                    await bot.telegram.sendMessage(group.telegramGroupId, msg, { parse_mode: 'HTML' });
                }
            } catch (err) {
                console.error('[Marketing Checkout Sweep Error]', err?.message || err);
            }
        }

        if (typeof syncSheets === 'function') {
            syncSheets().catch(e => console.error('[Sheet sync error in marketing checkout]:', e));
        }

        return true;
    }

    return { scanEveningCheckout };
}
