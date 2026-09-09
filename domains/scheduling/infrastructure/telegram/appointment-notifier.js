/**
 * Gửi tin lịch khách vào nhóm.
 *
 * Dùng `sendMessageToRoleGroup` của bot (truyền từ ngoài vào) chứ không gọi
 * thẳng `bot.telegram.sendMessage`: hàm đó còn kiểm role nhóm và ghi log theo
 * `reason`, bỏ qua là mất lớp chặn gửi nhầm nhóm.
 */

const HTML = { parse_mode: 'HTML' };

export function createAppointmentNotifier({ bot, sendMessageToRoleGroup }) {
    /**
     * @param {string} reason nhãn phân loại để tra log — giữ nguyên chuỗi cũ
     */
    async function send(groupId, role, message, reason, replyMarkup = null) {
        const extra = replyMarkup ? { ...HTML, reply_markup: replyMarkup } : { ...HTML };
        return sendMessageToRoleGroup(bot, groupId, role, message, extra, reason);
    }

    return { send };
}
