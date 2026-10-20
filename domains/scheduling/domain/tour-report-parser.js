/**
 * Parser và quy tắc nghiệp vụ thuần của Báo Công Tour KTV.
 *
 * Tầng domain thuần — không import express, pg, telegraf hay Google API.
 */

/** Chuẩn hoá chuỗi văn bản một dòng. */
function cleanLine(text) {
    return String(text || '').replace(/\r/g, '').trim();
}

/** Tách danh sách KTV từ chuỗi văn bản (phân tách bởi dấu phẩy, gạch chéo, hoặc dấu gạch ngang). */
export function parseKtvNames(raw) {
    if (!raw) return [];
    return raw
        .split(/[,/+-]| và /i)
        .map(name => cleanLine(name.replace(/\(.*?\)/g, '')))
        .filter(name => name.length > 0 && !/^\d+$/.test(name));
}

/**
 * Tính số công tour cho mỗi KTV được ghi trong phiếu/tin.
 * Quy tắc: 1 KTV = 1.0 công; 2 KTV = 0.5 công mỗi người.
 */
export function calculateTourCredit(ktvCount) {
    if (ktvCount <= 0) return 0;
    if (ktvCount === 1) return 1.0;
    if (ktvCount === 2) return 0.5;
    return Number((1 / ktvCount).toFixed(2));
}

/** Chuẩn hoá ngày DD/MM hoặc DD/MM/YYYY thành YYYY-MM-DD. */
export function normalizeReportDate(rawDate, fallbackDate = new Date()) {
    const currentYear = fallbackDate.getFullYear();
    const clean = cleanLine(rawDate);
    const match = clean.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/);
    if (!match) {
        const y = fallbackDate.getFullYear();
        const m = String(fallbackDate.getMonth() + 1).padStart(2, '0');
        const d = String(fallbackDate.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const day = String(match[1]).padStart(2, '0');
    const month = String(match[2]).padStart(2, '0');
    const year = match[3] || String(currentYear);
    return `${year}-${month}-${day}`;
}

/** Trích xuất các trường từ cú pháp tin nhắn văn bản hoặc caption ảnh. */
export function parseTourMessage(text, { hasPhoto = false, now = new Date() } = {}) {
    const lines = cleanLine(text).split('\n').map(l => l.trim()).filter(Boolean);

    let rawDate = '';
    let customerName = '';
    let customerType = 'Khách cũ';
    let doctor = '';
    let phone = '';
    let service = '';
    let rawKtv = '';
    let notes = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 1. Ngày:
        const dateMatch = line.match(/^(?:Ngày|Ngay)\s*[:：]\s*(.+)$/i);
        if (dateMatch) {
            rawDate = dateMatch[1].trim();
            continue;
        }

        // 2. Khách:
        const custMatch = line.match(/^(?:Khách|Khach|KH)\s*[:：]\s*(.+)$/i);
        if (custMatch) {
            customerName = custMatch[1].trim();
            if (/\(khách mới\)|\[khách mới\]/i.test(customerName)) {
                customerType = 'Khách mới';
                customerName = customerName.replace(/\(khách mới\)|\[khách mới\]/gi, '').trim();
            } else if (/\(khách cũ\)|\[khách cũ\]/i.test(customerName)) {
                customerType = 'Khách cũ';
                customerName = customerName.replace(/\(khách cũ\)|\[khách cũ\]/gi, '').trim();
            }
            continue;
        }

        // 3. Loại khách:
        const typeMatch = line.match(/^(?:Loại khách|Loai khach)\s*[:：]\s*(.+)$/i);
        if (typeMatch) {
            if (/mới|moi/i.test(typeMatch[1])) customerType = 'Khách mới';
            else customerType = 'Khách cũ';
            continue;
        }

        // 4. Bác sĩ:
        const docMatch = line.match(/^(?:Bác sĩ|Bac si|BS|Bs|Doctor)\s*[:：]\s*(.+)$/i);
        if (docMatch) {
            doctor = docMatch[1].trim();
            continue;
        }

        // 5. SĐT:
        const phoneMatch = line.match(/^(?:SĐT|SDT|ĐT|DT|Số ĐT|So DT|Phone)\s*[:：]\s*(.+)$/i);
        if (phoneMatch) {
            phone = phoneMatch[1].replace(/[^\d]/g, '').trim();
            continue;
        }

        // 6. DV:
        const srvMatch = line.match(/^(?:DV|Dịch vụ|Dich vu)\s*[:：]\s*(.+)$/i);
        if (srvMatch) {
            service = srvMatch[1].trim();
            continue;
        }

        // 7. KTV:
        const ktvMatch = line.match(/^(?:KTV|Kỹ thuật viên|Ky thuat vien)\s*[:：]\s*(.+)$/i);
        if (ktvMatch) {
            rawKtv = ktvMatch[1].trim();
            continue;
        }

        // 8. Ghi chú:
        const noteMatch = line.match(/^(?:Ghi chú|Ghi chu|Note|Notes)\s*[:：]\s*(.+)$/i);
        if (noteMatch) {
            notes = noteMatch[1].trim();
            continue;
        }

        // Nhận diện dòng bác sĩ tự do (nằm trước SĐT hoặc DV, bắt đầu bằng BS hoặc Bác sĩ)
        if (!doctor && /^(?:BS\b|Bác sĩ\b)/i.test(line)) {
            doctor = line.replace(/^(?:BS|Bác sĩ)\s*[:：.]?\s*/i, '').trim();
        }
    }

    const reportDate = normalizeReportDate(rawDate, now);
    const ktvNames = parseKtvNames(rawKtv);
    const tourCredit = calculateTourCredit(ktvNames.length);

    const hasCustomer = Boolean(customerName && phone);
    const hasDoctor = Boolean(doctor);
    const hasService = Boolean(service);
    const hasKtv = ktvNames.length > 0;
    const isValid = Boolean(hasCustomer && hasDoctor && hasService && hasKtv && hasPhoto);

    let missingReason = null;
    if (!isValid) {
        if (!hasPhoto && !hasKtv) {
            missingReason = 'Thiếu ảnh chứng thực khách tại cơ sở và thiếu tên KTV';
        } else if (!hasPhoto) {
            missingReason = 'Thiếu ảnh chứng thực khách tại cơ sở';
        } else if (!hasCustomer) {
            missingReason = 'Thiếu tên khách hàng hoặc số điện thoại';
        } else if (!hasKtv) {
            missingReason = 'Thiếu tên KTV thực hiện tour';
        } else if (!hasDoctor) {
            missingReason = 'Thiếu tên bác sĩ phụ trách';
        } else if (!hasService) {
            missingReason = 'Thiếu tên dịch vụ';
        }
    }

    return {
        reportDate,
        customerName,
        customerType,
        doctor,
        phone,
        service,
        ktvNames,
        tourCredit,
        notes: notes || '',
        hasPhoto,
        isValid,
        missingReason,
        rawText: text
    };
}

/** Soạn nội dung tin nhắn Telegram chuẩn cho 1 ca báo công tour. */
export function buildTourReportNotice(report) {
    const dParts = report.reportDate.split('-');
    const displayDate = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}` : report.reportDate;
    const typeSuffix = report.customerType ? ` (${report.customerType})` : '';
    const docLine = report.doctor ? `👨‍⚕️ Bác sĩ: ${report.doctor}\n` : '';
    const creditStr = report.tourCredit === 1 ? '1 công' : `${report.tourCredit} công`;
    const ktvLine = report.ktvNames.map(name => `${name} (${creditStr})`).join(', ');
    const noteLine = report.notes ? `\n📝 Ghi chú: ${report.notes}` : '';

    return `Ngày: ${displayDate}\n`
        + `Khách: ${report.customerName}${typeSuffix}\n`
        + docLine
        + `SĐT: ${report.phone}\n`
        + `DV: ${report.service || 'Chưa nhập'}\n`
        + `KTV: ${ktvLine || 'Chưa nhập'}`
        + noteLine;
}

/** Soạn nội dung thông báo chốt công tour cuối ngày (22:00). */
export function buildDailyTourSummaryMessage(ktvSummaries, totalTours, dateStr) {
    let msg = `📊 <b>TỔNG HỢP CÔNG TOUR NGÀY ${dateStr}</b>\n\n`;

    if (!ktvSummaries || ktvSummaries.length === 0) {
        msg += '<i>Hôm nay chưa có công tour nào được ghi nhận.</i>';
        return msg;
    }

    for (const item of ktvSummaries) {
        const count = Number(item.total_credit || 0);
        msg += `${item.ktv_name}: ${count} tour\n`;
    }

    msg += `━━━━━━━━━━━━━━━━\n<b>Tổng: ${Number(totalTours || 0)} tour</b>`;
    return msg;
}
