/**
 * Use case: tổng kết danh sách khách hàng trong ngày, gửi vào từng nhóm lúc 22:00.
 *
 * Nhóm không có khách vẫn nhận tin — im lặng dễ bị hiểu là bot chết.
 */

export function createSummarizeDailyCustomers({ repository, notifier, moment, escapeHtml }) {
    function buildSummary(groupName, records, displayDate) {
        let message = `📋 <b>TỔNG HỢP DANH SÁCH KHÁCH HÀNG HÔM NAY (${displayDate})</b>\n`
            + `<b>Nhóm:</b> ${escapeHtml(groupName)}\n`
            + '-------------------------------------------\n\n';

        if (records.length === 0) {
            return message + '😔 Hôm nay không có khách hàng nào được ghi nhận.';
        }

        records.forEach((r, idx) => {
            const custType = r.customer_type === 'NEW' ? 'Khách mới ☘️' : 'Khách cũ 🔁';
            message += `${idx + 1}. <b>Khách hàng:</b> ${escapeHtml(r.customer_name)} (${custType})\n`
                + `   📞 <b>Điện thoại:</b> ${escapeHtml(r.phone)}\n`
                + `   👩‍💼 <b>Tư vấn:</b> ${escapeHtml(r.consultant)}\n`
                + `   🛠️ <b>Dịch vụ:</b> ${escapeHtml(r.service)}\n`
                + `   💸 <b>Tổng Bill:</b> ${(Number(r.bill_amount) || 0).toLocaleString('vi-VN')}đ`
                + ` | 💳 <b>Đã TT:</b> ${(Number(r.paid_amount) || 0).toLocaleString('vi-VN')}đ`
                + ` | 🚨 <b>Nợ:</b> ${(Number(r.debt_amount) || 0).toLocaleString('vi-VN')}đ\n`
                + `   🧑‍⚕️ <b>Người thực hiện:</b> ${escapeHtml(r.operator)}\n`
                + `   📁 <b>Drive Folder:</b> <a href="${r.drive_folder_link}">Xem folder ảnh</a>\n\n`;
        });
        return message;
    }

    async function summarizeDailyCustomers() {
        try {
            console.log('[Cron] Khởi chạy tổng hợp danh sách khách hàng lúc 22:00 hàng ngày...');
            const todayStr = moment().utcOffset(7).format('YYYY-MM-DD');
            const displayDate = moment().utcOffset(7).format('DD/MM/YYYY');

            for (const group of await repository.findActiveCustomerGroups()) {
                const records = await repository.findRecordsOfDay(group.id, todayStr);
                await notifier.sendHtml(group.telegram_group_id, buildSummary(group.group_name, records, displayDate));
                console.log(`[Cron] Đã gửi báo cáo tổng kết khách hàng cho nhóm: ${group.group_name}`);
            }
        } catch (e) {
            console.error('[Cron Error] Lỗi khi chạy tổng kết khách hàng cuối ngày lúc 22:00:', e);
        }
    }

    return { summarizeDailyCustomers, buildSummary };
}
