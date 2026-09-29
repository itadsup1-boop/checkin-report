/**
 * Soạn nội dung tin nhắn Telegram cho module Báo Cáo Telesale.
 *
 * Thuần nghiệp vụ — không viết SQL, không phụ thuộc thư viện mạng.
 */

import { formatVnd } from './telesale-rules.js';

export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Soạn tin nhắn báo cáo cá nhân chuẩn xác theo mẫu chỉ đạo.
 */
export function buildTelesaleReportMessage({ employeeName, dateStr, stats, sheetUrl }) {
    let lichStatus = '✅';
    if (stats.isLichWarning) {
        lichStatus = '⚠️ (Cảnh báo &lt; 25%)';
    }

    let toiStatus = '✅';
    if (stats.isToiWarning) {
        toiStatus = '⚠️ (Cảnh báo &lt; 15%)';
    } else if (stats.isToiReward) {
        toiStatus = '🌟 (Khen thưởng &gt; 19%)';
    }

    let msg = `📊 <b>BÁO CÁO TELE HÀNG NGÀY</b>\n`;
    if (dateStr) msg += `📅 Ngày: ${escapeHtml(dateStr)}\n`;
    msg += `Nhân sự: <b>${escapeHtml(employeeName) || 'Chưa xác định'}</b>\n`;
    msg += `Số nhận: ${stats.so_nhan}\n`;
    msg += `Số trùng / KNC/ Văng: ${stats.so_trung_knc_vang}\n`;
    msg += `Số lịch PV mới: ${stats.lich_pv_moi}\n`;
    msg += `Số lịch PV cũ: ${stats.lich_pv_cu}\n`;
    msg += `Lịch hẹn ngày mai: ${stats.lich_ngay_mai}\n`;
    msg += `Tổng tới hôm nay: ${stats.tong_toi_hnay}\n`;
    msg += `Tổng bong hôm nay: ${stats.tong_bong_hnay}\n`;
    msg += `TỔNG DS hnay: ${formatVnd(stats.tong_ds_hnay)}\n\n`;

    if (stats.services && stats.services.length > 0) {
        msg += `📋 <b>Chi tiết theo dịch vụ:</b>\n`;
        stats.services.forEach(s => {
            msg += `• <b>${escapeHtml(s.service_name)}</b>: ${s.lich} lịch | ${s.toi} tới | ${formatVnd(s.ds)}\n`;
        });
        msg += `\n`;
    }

    msg += `<b>10. BOT tự cộng:</b>\n`;
    msg += `Tổng lịch cộng dồn: <b>${stats.tong_lich} lịch</b>\n`;
    msg += `Tổng DS cộng dồn tháng: <b>${formatVnd(stats.tong_ds_thang)}</b>\n`;
    msg += `Tổng khách tới cộng dồn: <b>${stats.tong_toi} khách</b>\n`;
    msg += `Tỷ lệ khách tới / doanh số cộng dồn: <b>${formatVnd(stats.ty_le_khach_toi_ds)}/khách</b>\n`;
    msg += `Tỷ lệ lịch cộng dồn: <b>${stats.ty_le_lich}%</b> ${lichStatus}\n`;
    msg += `Tỉ lệ tới cộng dồn: <b>${stats.ty_le_toi}%</b> ${toiStatus}`;

    return msg;
}

export const TELESALE_FORM_TEMPLATE = `Nhân sự: 
Số nhận: 
Số trùng / KNC/ Văng: 
Số lịch PV mới: 
Số lịch PV cũ: 
Lịch hẹn ngày mai: 
Tổng tới hôm nay: 
Tổng bong hôm nay: 
TỔNG DS hnay: `;

/**
 * Soạn tin nhắn nhắc nộp báo cáo lúc 18:00.
 */
export function buildTelesaleReminderMessage({ groupName, pendingStaff = [] }) {
    let msg = `⏰ <b>NHẮC NỘP BÁO CÁO TELESALE HÀNG NGÀY</b>\n`;
    if (groupName) msg += `Nhóm: <b>${escapeHtml(groupName)}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `• Thời gian báo cáo: trước <b>18:00</b>\n`;
    msg += `• Cập nhật muộn nhất: <b>19:00</b>\n`;
    msg += `• Quá 19:00: Phạt <b>50.000đ/lần</b> theo quy định (trừ nhân sự có lịch OFF / không đi làm).\n\n`;

    if (Array.isArray(pendingStaff) && pendingStaff.length > 0) {
        msg += `📋 <b>Nhân sự đi làm hôm nay chưa nộp báo cáo:</b>\n`;
        pendingStaff.forEach((s, idx) => {
            const safeName = escapeHtml(s.full_name);
            const tgId = s.linked_telegram_id || s.telegram_id;
            const mention = tgId ? `<a href="tg://user?id=${tgId}">${safeName}</a>` : `<b>${safeName}</b>`;
            msg += `${idx + 1}. ${mention}\n`;
        });
        msg += `<i>(Nhân sự nghỉ ca OFF / có phép đã được tự động miễn nhắc)</i>\n\n`;
    }

    msg += `👇 <b>Chạm vào khung bên dưới để sao chép mẫu báo cáo:</b>\n`;
    msg += `<code>${escapeHtml(TELESALE_FORM_TEMPLATE)}</code>\n\n`;
    msg += `<i>(Mọi người điền đúng tên của mình và gửi trực tiếp vào nhóm nhé)</i>`;
    return msg;
}

/**
 * Soạn tin nhắn phạt muộn nộp báo cáo (sau 19:00).
 */
export function buildTelesalePenaltyNotice({ employeeName, telegramId, dateStr, penaltyAmount = 50000 }) {
    const safeName = escapeHtml(employeeName);
    const mention = telegramId ? `<a href="tg://user?id=${telegramId}">${safeName}</a>` : `<b>${safeName}</b>`;
    let msg = `⚠️ <b>QUÁ HẠN BÁO CÁO TELESALE (SAU 19:00)</b>\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `Nhân sự: ${mention}\n`;
    msg += `Ngày vi phạm: <b>${escapeHtml(dateStr)}</b>\n`;
    msg += `Lỗi vi phạm: Chưa nộp báo cáo Telesale trước 19:00 (không có lịch nghỉ OFF).\n`;
    msg += `Mức phạt: <b>${formatVnd(penaltyAmount)}</b> (đã ghi nhận vào sổ phạt).`;
    return msg;
}

/**
 * Soạn tin tổng kết toàn đội trong ngày (chốt lúc 19:00).
 */
export function buildTelesaleDailyTeamSummary({ dateStr, teamTotals, memberSummaries = [], sheetUrl }) {
    let msg = `📊 <b>TỔNG KẾT TELESALE TOÀN ĐỘI NGÀY ${escapeHtml(dateStr)}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `📥 Tổng số nhận: <b>${teamTotals.so_nhan}</b>\n`;
    msg += `🌪 Tổng khách văng/knc: <b>${teamTotals.tong_vang || teamTotals.so_trung_knc_vang || 0}</b>\n`;
    msg += `🗓 Tổng lịch chốt: <b>${teamTotals.tong_lich}</b>\n`;
    msg += `🚶‍♂️ Tổng khách tới: <b>${teamTotals.tong_toi}</b>\n`;
    msg += `❌ Tổng khách bong: <b>${teamTotals.tong_bong}</b>\n`;
    msg += `📅 Tổng lịch hẹn ngày mai: <b>${teamTotals.lich_ngay_mai || 0}</b>\n`;
    msg += `💰 <b>TỔNG DOANH SỐ: ${formatVnd(teamTotals.tong_ds)}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `<b>Chi tiết từng nhân sự:</b>\n`;

    if (memberSummaries.length === 0) {
        msg += `<i>Hôm nay chưa có nhân sự nào nộp báo cáo.</i>\n`;
    } else {
        for (const m of memberSummaries) {
            msg += `• <b>${escapeHtml(m.name)}</b>: ${m.so_nhan} số | ${m.tong_lich} lịch | ${m.tong_toi} tới | ${m.lich_ngay_mai || 0} lịch mai | ${formatVnd(m.tong_ds_hnay)}\n`;
        }
    }

    return msg.trimEnd();
}

/**
 * Soạn tin nhắn thống kê hiệu suất:
 * - Khen thưởng Tỷ lệ Tới (> 19%)
 * - Cảnh báo Tỷ lệ Lịch (< 25%)
 * - Cảnh báo Tỷ lệ Tới (< 15%)
 * Trả về null nếu không có ai thuộc các danh sách trên.
 */
export function buildTelesaleWarningSummaryMessage({
    dateStr,
    lichWarnings = [],
    toiWarnings = [],
    toiRewards = []
}) {
    const hasWarnings = (lichWarnings && lichWarnings.length > 0) || (toiWarnings && toiWarnings.length > 0);
    const hasRewards = toiRewards && toiRewards.length > 0;

    if (!hasWarnings && !hasRewards) {
        return null;
    }

    let msg = `📊 <b>THỐNG KÊ HIỆU SUẤT TELESALE NGÀY ${escapeHtml(dateStr)}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;

    if (hasRewards) {
        msg += `🌟 <b>KHEN THƯỞNG TỶ LỆ TỚI (&gt; 19%):</b>\n`;
        for (const r of toiRewards) {
            msg += `• <b>${escapeHtml(r.name)}</b>: ${r.tong_toi}/${r.so_nhan} số (<b>${r.ty_le_toi}%</b> 🌟)\n`;
        }
        msg += `\n`;
    }

    if (lichWarnings && lichWarnings.length > 0) {
        msg += `📉 <b>CẢNH BÁO TỶ LỆ LỊCH (&lt; 25%):</b>\n`;
        for (const w of lichWarnings) {
            msg += `• <b>${escapeHtml(w.name)}</b>: ${w.tong_lich}/${w.so_nhan} số (<b>${w.ty_le_lich}%</b>)\n`;
        }
        msg += `\n`;
    }

    if (toiWarnings && toiWarnings.length > 0) {
        msg += `📉 <b>CẢNH BÁO TỶ LỆ TỚI (&lt; 15%):</b>\n`;
        for (const w of toiWarnings) {
            msg += `• <b>${escapeHtml(w.name)}</b>: ${w.tong_toi}/${w.so_nhan} số (<b>${w.ty_le_toi}%</b>)\n`;
        }
        msg += `\n`;
    }

    return msg.trimEnd();
}
