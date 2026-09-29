/**
 * Module phân tích cú pháp tin nhắn văn bản báo cáo Telesale.
 *
 * Thuần nghiệp vụ — CẤM import Express, pg, telegraf hay Google API.
 */

/**
 * Chuyển đổi chuỗi tiền tệ hoặc số lượng sang số nguyên.
 * Hỗ trợ: "15.000.000", "15,000,000", "15000000", "15tr", "15 triệu", "500k", v.v.
 */
export function parseTelesaleNumber(text, isCurrency = false) {
    if (!text) return 0;
    let val = String(text).trim().toLowerCase();
    if (!val || val === '-' || val === 'không' || val === 'ko' || val === 'k' || val === 'none') {
        return 0;
    }

    if (isCurrency) {
        // Kiểm tra tiền tố triệu, tr, củ, k, nghìn
        const hasMillion = val.includes('tr') || val.includes('triệu') || val.includes('m') || val.includes('củ');
        const hasThousand = val.includes('k') || val.includes('nghìn') || val.includes('ngàn') || val.includes('lít');

        // Lấy phần số (có thể có dấu chấm thập phân như 1.5tr)
        let numClean = val.replace(/,/g, '');
        if (hasMillion || hasThousand) {
            const floatMatch = numClean.match(/[\d.]+/);
            if (floatMatch) {
                let num = parseFloat(floatMatch[0]);
                if (hasMillion) num *= 1000000;
                else if (hasThousand) num *= 1000;
                return Math.round(num);
            }
        }

        // Nếu là số thuần có phân cách nghìn (vd 15.000.000)
        numClean = numClean.replace(/\./g, '');
        const numMatch = numClean.match(/\d+/);
        if (numMatch) {
            return parseInt(numMatch[0], 10) || 0;
        }
        return 0;
    }

    // Đối với số lượng thông thường (data, lịch, tới, bong...)
    // Loại bỏ dấu chấm, phẩy nếu có
    const clean = val.replace(/[.,]/g, '');
    const match = clean.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
}

/**
 * Kiểm tra xem tin nhắn có phải là tin nhắn báo cáo Telesale theo mẫu hay không.
 * Yêu cầu: Khớp tiêu đề báo cáo HOẶC chứa tối thiểu 3 trường đặc trưng.
 */
export function isTelesaleReportMessage(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase();

    // Dấu hiệu rõ ràng: tiêu đề báo cáo
    if (lower.includes('báo cáo tele') || lower.includes('bao cao tele') || lower.includes('bc tele')) {
        return true;
    }

    // Đếm số lượng trường đặc trưng xuất hiện
    const patterns = [
        /(?:nhân\s*sự|nhân\s*viên|nv|tên)\s*[:：]/i,
        /số\s*nhận\s*[:：]/i,
        /(?:trùng|knc|văng)\s*[:：]/i,
        /lịch\s*pv\s*mới\s*[:：]/i,
        /lịch\s*pv\s*cũ\s*[:：]/i,
        /lịch\s*(?:hẹn\s*)?ngày\s*mai\s*[:：]/i,
        /(?:tổng\s*)?tới\s*h(?:ôm\s*)?nay\s*[:：]/i,
        /(?:tổng\s*)?bong\s*h(?:ôm\s*)?nay\s*[:：]/i,
        /(?:tổng\s*)?ds\s*h(?:ôm\s*)?nay\s*[:：]/i
    ];

    let matchCount = 0;
    for (const pattern of patterns) {
        if (pattern.test(text)) {
            matchCount++;
        }
    }

    return matchCount >= 3;
}

/**
 * Bóc tách nội dung tin nhắn báo cáo Telesale thành cấu trúc dữ liệu chuẩn.
 *
 * Mẫu chuẩn:
 * Nhân sự: ...
 * Số nhận: ...
 * Số trùng / KNC/ Văng: ...
 * Số lịch PV mới: ...
 * Số lịch PV cũ: ...
 * Lịch hẹn ngày mai: ...
 * Tổng tới hôm nay: ...
 * Tổng bong hôm nay: ...
 * TỔNG DS hnay: ...
 */
export function parseTelesaleTextMessage(text) {
    if (!text || typeof text !== 'string') {
        return { isValid: false, message: 'Nội dung tin nhắn trống' };
    }

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    let employee_name = '';
    let so_nhan = 0;
    let so_trung_knc_vang = 0;
    let lich_pv_moi = 0;
    let lich_pv_cu = 0;
    let lich_ngay_mai = 0;
    let tong_toi_hnay = 0;
    let tong_bong_hnay = 0;
    let tong_ds_hnay = 0;

    let matchedFieldsCount = 0;

    for (const line of lines) {
        // 1. Nhân sự: (hỗ trợ Nhân sự, Nhân viên, NV, Họ và tên, Tên...)
        const empMatch = line.match(/^(?:nhân\s*sự|nhan\s*su|nhân\s*viên|nhan\s*vien|nv|họ\s*và\s*tên|ho\s*va\s*ten|tên|ten)\s*[:：]\s*(.*)$/i);
        if (empMatch) {
            employee_name = empMatch[1].trim();
            matchedFieldsCount++;
            continue;
        }

        // 2. Số nhận:
        const nhanMatch = line.match(/^(?:số\s*nhận|so\s*nhan)\s*[:：]\s*(.*)$/i);
        if (nhanMatch) {
            so_nhan = parseTelesaleNumber(nhanMatch[1]);
            matchedFieldsCount++;
            continue;
        }

        // 3. Số trùng / KNC/ Văng:
        const trungMatch = line.match(/^(?:số\s*trùng\s*[\/\\]\s*knc\s*[\/\\]\s*văng|số\s*trùng|trùng\s*[\/\\]\s*knc\s*[\/\\]\s*văng|so\s*trung)\s*[:：]\s*(.*)$/i);
        if (trungMatch) {
            so_trung_knc_vang = parseTelesaleNumber(trungMatch[1]);
            matchedFieldsCount++;
            continue;
        }

        // 4. Số lịch PV mới:
        const pvMoiMatch = line.match(/^(?:số\s*lịch\s*pv\s*mới|lịch\s*pv\s*mới|lich\s*pv\s*moi|số\s*lịch\s*mới)\s*[:：]\s*(.*)$/i);
        if (pvMoiMatch) {
            lich_pv_moi = parseTelesaleNumber(pvMoiMatch[1]);
            matchedFieldsCount++;
            continue;
        }

        // 5. Số lịch PV cũ:
        const pvCuMatch = line.match(/^(?:số\s*lịch\s*pv\s*cũ|lịch\s*pv\s*cũ|lich\s*pv\s*cu|số\s*lịch\s*cũ)\s*[:：]\s*(.*)$/i);
        if (pvCuMatch) {
            lich_pv_cu = parseTelesaleNumber(pvCuMatch[1]);
            matchedFieldsCount++;
            continue;
        }

        // 6. Lịch hẹn ngày mai:
        const ngayMaiMatch = line.match(/^(?:lịch\s*hẹn\s*ngày\s*mai|lịch\s*ngày\s*mai|lich\s*hen\s*ngay\s*mai|lich\s*ngay\s*mai)\s*[:：]\s*(.*)$/i);
        if (ngayMaiMatch) {
            lich_ngay_mai = parseTelesaleNumber(ngayMaiMatch[1]);
            matchedFieldsCount++;
            continue;
        }

        // 7. Tổng tới hôm nay:
        const toiMatch = line.match(/^(?:(?:tổng\s*|khách\s*)?tới\s*h(?:ôm\s*)?nay|(?:tổng\s*|khách\s*)?tới|tong\s*toi\s*hnay|tong\s*toi)\s*[:：]\s*(.*)$/i);
        if (toiMatch) {
            tong_toi_hnay = parseTelesaleNumber(toiMatch[1]);
            matchedFieldsCount++;
            continue;
        }

        // 8. Tổng bong hôm nay:
        const bongMatch = line.match(/^(?:(?:tổng\s*|khách\s*)?bong\s*h(?:ôm\s*)?nay|(?:tổng\s*|khách\s*)?bong|tong\s*bong\s*hnay|tong\s*bong)\s*[:：]\s*(.*)$/i);
        if (bongMatch) {
            tong_bong_hnay = parseTelesaleNumber(bongMatch[1]);
            matchedFieldsCount++;
            continue;
        }

        // 9. TỔNG DS hnay:
        const dsMatch = line.match(/^(?:tổng\s*ds\s*h(?:ôm\s*)?nay|tong\s*ds\s*hnay|doanh\s*số\s*h(?:ôm\s*)?nay|doanh\s*thu\s*h(?:ôm\s*)?nay|tổng\s*ds|doanh\s*số|ds\s*hnay)\s*[:：]\s*(.*)$/i);
        if (dsMatch) {
            tong_ds_hnay = parseTelesaleNumber(dsMatch[1], true);
            matchedFieldsCount++;
            continue;
        }
    }

    return {
        isValid: matchedFieldsCount >= 2,
        matchedFieldsCount,
        employee_name,
        so_nhan,
        so_trung_knc_vang,
        lich_pv_moi,
        lich_pv_cu,
        lich_ngay_mai,
        tong_toi_hnay,
        tong_bong_hnay,
        tong_ds_hnay
    };
}
