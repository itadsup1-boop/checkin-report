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
export function buildDynamicTelesaleReportMessage({ employeeName, dateStr, fields, dynamicResult, sheetUrl, customers = [] }) {
    let msg = `📊 <b>BÁO CÁO TELE HÀNG NGÀY</b>\n`;
    if (dateStr) msg += `📅 Ngày: ${escapeHtml(dateStr)}\n`;
    msg += `Nhân sự: <b>${escapeHtml(employeeName) || 'Chưa xác định'}</b>\n\n`;

    const activeFields = (fields || []).filter(f => !f.is_hidden).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
    const inputFields = activeFields.filter(f => f.category === 'INPUT');
    const calcFields = activeFields.filter(f => f.category !== 'INPUT');

    for (const f of inputFields) {
        const valFormatted = dynamicResult.formatted?.[f.key] ?? dynamicResult.values?.[f.key] ?? 0;
        msg += `${escapeHtml(f.label)}: <b>${valFormatted}</b>\n`;
    }

    if (customers && customers.length > 0) {
        msg += `\n📋 <b>Chi tiết khách hàng:</b>\n`;
        customers.forEach((c, idx) => {
            const cName = escapeHtml(c.name || `Khách hàng ${idx + 1}`);
            const cAmount = c.amount ? ` - <b>${formatVnd(c.amount)}</b>` : '';
            msg += `${idx + 1}. ${cName}${cAmount}\n`;
        });
    }

    if (calcFields.length > 0) {
        msg += `\n<b>🤖 BOT tự tính toán:</b>\n`;
        for (const f of calcFields) {
            const valFormatted = dynamicResult.formatted?.[f.key] ?? dynamicResult.values?.[f.key] ?? 0;
            const badgeObj = dynamicResult.badges?.[f.key];
            const badgeText = badgeObj ? ` ${escapeHtml(badgeObj.badge)}` : '';
            msg += `• ${escapeHtml(f.label)}: <b>${valFormatted}</b>${badgeText}\n`;
        }
    }

    return msg;
}

export function buildTelesaleReportMessage({ employeeName, dateStr, stats, sheetUrl, fields = null, dynamicResult = null, customers = [] }) {
    if (fields && Array.isArray(fields) && fields.length > 0 && dynamicResult) {
        const custList = customers?.length ? customers : (stats?.services?.length ? stats.services.map((s, idx) => ({ index: idx + 1, name: s.service_name, amount: s.ds })) : []);
        return buildDynamicTelesaleReportMessage({ employeeName, dateStr, fields, dynamicResult, sheetUrl, customers: custList });
    }

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
 * Soạn tin nhắn nhắc nộp báo cáo lúc 18:00 (hoặc giờ cấu hình theo nhóm).
 */
export function buildTelesaleReminderMessage({
    groupName,
    pendingStaff = [],
    formTemplate = null,
    fields = null,
    remindTime = '18:00',
    deadlineTime = '19:00',
    penaltyAmount = 50000
}) {
    let msg = `⏰ <b>NHẮC NỘP BÁO CÁO TELESALE HÀNG NGÀY</b>\n`;
    if (groupName) msg += `Nhóm: <b>${escapeHtml(groupName)}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `• Thời gian báo cáo: trước <b>${escapeHtml(remindTime)}</b>\n`;
    msg += `• Cập nhật muộn nhất: <b>${escapeHtml(deadlineTime)}</b>\n`;
    const penaltyStr = `${new Intl.NumberFormat('vi-VN').format(penaltyAmount)}đ`;
    msg += `• Quá ${escapeHtml(deadlineTime)}: Phạt <b>${penaltyStr}/lần</b> theo quy định (trừ nhân sự có lịch OFF / không đi làm).\n\n`;

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

    let template = formTemplate;
    if (!template && fields && Array.isArray(fields) && fields.length > 0) {
        const inputFields = fields.filter(f => !f.is_hidden && f.category === 'INPUT').sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
        template = `Nhân sự: \n` + inputFields.map(f => `${f.label}: `).join('\n');
    }
    if (!template) template = TELESALE_FORM_TEMPLATE;

    msg += `👇 <b>Chạm vào khung bên dưới để sao chép mẫu báo cáo:</b>\n`;
    msg += `<code>${escapeHtml(template)}</code>\n\n`;
    msg += `<i>(Mọi người điền đúng tên của mình và gửi trực tiếp vào nhóm nhé)</i>`;
    return msg;
}

/**
 * Soạn tin nhắn phạt muộn nộp báo cáo (sau 19:00 hoặc giờ tuỳ biến).
 */
export function buildTelesalePenaltyNotice({ employeeName, telegramId, dateStr, penaltyAmount = 50000, deadlineTime = '19:00' }) {
    const safeName = escapeHtml(employeeName);
    const mention = telegramId ? `<a href="tg://user?id=${telegramId}">${safeName}</a>` : `<b>${safeName}</b>`;
    let msg = `⚠️ <b>QUÁ HẠN BÁO CÁO TELESALE (SAU ${escapeHtml(deadlineTime)})</b>\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `Nhân sự: ${mention}\n`;
    msg += `Ngày vi phạm: <b>${escapeHtml(dateStr)}</b>\n`;
    msg += `Lỗi vi phạm: Chưa nộp báo cáo Telesale trước ${escapeHtml(deadlineTime)} (không có lịch nghỉ OFF).\n`;
    msg += `Mức phạt: <b>${formatVnd(penaltyAmount)}</b> (đã ghi nhận vào sổ phạt).`;
    return msg;
}

/**
 * Soạn tin tổng kết toàn đội trong ngày (chốt lúc 19:00 hoặc giờ tuỳ biến).
 */
export function buildTelesaleDailyTeamSummary({
    dateStr,
    teamTotals,
    memberSummaries = [],
    sheetUrl,
    dynamicFields = null,
    summaryFields = null,
    dynamicTotals = {}
}) {
    let msg = `📊 <b>TỔNG KẾT TELESALE TOÀN ĐỘI NGÀY ${escapeHtml(dateStr)}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;

    if (dynamicFields && Array.isArray(dynamicFields) && summaryFields && Array.isArray(summaryFields) && summaryFields.length > 0) {
        let effectiveSummaryFields = [...summaryFields];
        if (!effectiveSummaryFields.includes('so_trung_knc_vang') && dynamicFields.some(f => f.key === 'so_trung_knc_vang')) {
            const soNhanIdx = effectiveSummaryFields.indexOf('so_nhan');
            if (soNhanIdx !== -1) {
                effectiveSummaryFields.splice(soNhanIdx + 1, 0, 'so_trung_knc_vang');
            } else {
                effectiveSummaryFields.unshift('so_trung_knc_vang');
            }
        }

        if (!effectiveSummaryFields.includes('lich_ngay_mai') && dynamicFields.some(f => f.key === 'lich_ngay_mai')) {
            const tongToiIdx = effectiveSummaryFields.indexOf('tong_toi');
            if (tongToiIdx !== -1) {
                effectiveSummaryFields.splice(tongToiIdx + 1, 0, 'lich_ngay_mai');
            } else {
                const tongLichIdx = effectiveSummaryFields.indexOf('tong_lich');
                if (tongLichIdx !== -1) {
                    effectiveSummaryFields.splice(tongLichIdx + 1, 0, 'lich_ngay_mai');
                } else {
                    effectiveSummaryFields.push('lich_ngay_mai');
                }
            }
        }

        for (const fKey of effectiveSummaryFields) {
            const f = dynamicFields.find(field => field.key === fKey);
            if (!f) continue;
            const rawVal = dynamicTotals[fKey] ?? teamTotals[fKey] ?? (fKey === 'so_trung_knc_vang' ? (teamTotals.tong_vang || teamTotals.so_trung_knc_vang || 0) : (fKey === 'lich_ngay_mai' ? (teamTotals.lich_ngay_mai || 0) : 0));
            let valStr = '';
            if (f.data_type === 'currency' || f.type === 'currency') {
                valStr = formatVnd(rawVal);
            } else if (f.data_type === 'percentage' || f.type === 'percentage') {
                valStr = `${Number(rawVal).toFixed(1)}%`;
            } else {
                valStr = new Intl.NumberFormat('vi-VN').format(Number(rawVal) || 0);
            }
            let label = f.label;
            if (fKey === 'so_trung_knc_vang' || fKey === 'tong_vang') {
                if (!label.startsWith('🌪')) {
                    label = `🌪 Tổng khách văng/knc`;
                }
            }
            msg += `• ${escapeHtml(label)}: <b>${valStr}</b>\n`;
        }
    } else {
        msg += `📥 Tổng số nhận: <b>${teamTotals.so_nhan}</b>\n`;
        msg += `🌪 Tổng khách văng/knc: <b>${teamTotals.tong_vang || teamTotals.so_trung_knc_vang || 0}</b>\n`;
        msg += `🗓 Tổng lịch chốt: <b>${teamTotals.tong_lich}</b>\n`;
        msg += `🚶‍♂️ Tổng khách tới: <b>${teamTotals.tong_toi}</b>\n`;
        msg += `❌ Tổng khách bong: <b>${teamTotals.tong_bong}</b>\n`;
        msg += `📅 Tổng lịch hẹn ngày mai: <b>${teamTotals.lich_ngay_mai || 0}</b>\n`;
        msg += `💰 <b>TỔNG DOANH SỐ: ${formatVnd(teamTotals.tong_ds)}</b>\n`;
    }

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
