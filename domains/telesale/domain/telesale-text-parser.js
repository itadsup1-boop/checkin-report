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
        /(?:trùng|knc|văng)(?:\s*\([^)]*\))?\s*[:：]/i,
        /lịch\s*pv\s*mới\s*[:：]/i,
        /lịch\s*pv\s*cũ\s*[:：]/i,
        /(?:số\s*)?đơn\s*chốt\s*mới\s*[:：]/i,
        /(?:số\s*)?đơn\s*chốt\s*cũ\s*[:：]/i,
        /(?:khách|đơn)\s*chốt\s*[:：]/i,
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

    return matchCount >= 2;
}

/**
 * Bóc tách nội dung tin nhắn báo cáo Telesale thành cấu trúc dữ liệu chuẩn.
 * Hỗ trợ linh hoạt cả form chuẩn 9 trường và form tùy biến (như nhóm Xây Dựng 24h).
 *
 * @param {string} text Nội dung tin nhắn Telegram
 * @param {Array} dynamicFields Danh sách cấu hình trường động của nhóm (nếu có)
 */
export function parseTelesaleTextMessage(text, dynamicFields = null) {
    if (!text || typeof text !== 'string') {
        return { isValid: false, message: 'Nội dung tin nhắn trống' };
    }

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    let employee_name = '';
    let so_nhan = 0;
    let so_trung_knc_vang = 0;
    let lich_pv_moi = 0;
    let lich_pv_cu = 0;
    let so_don_chot_moi = 0;
    let so_don_chot_cu = 0;
    let lich_ngay_mai = 0;
    let tong_toi_hnay = 0;
    let tong_bong_hnay = 0;
    let tong_ds_hnay = 0;

    const customValues = {};
    const customers = [];
    let matchedFieldsCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

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
            customValues.so_nhan = so_nhan;
            matchedFieldsCount++;
            continue;
        }

        // 3. Số trùng / KNC/ Văng (hỗ trợ cả có ghi chú trong ngoặc ví dụ "(trên 200km)"):
        const trungMatch = line.match(/^(?:số\s*trùng\s*[\/\\]\s*knc\s*[\/\\]\s*văng|số\s*trùng|trùng\s*[\/\\]\s*knc\s*[\/\\]\s*văng|so\s*trung)(?:\s*\([^)]*\))?\s*[:：]\s*(.*)$/i);
        if (trungMatch) {
            so_trung_knc_vang = parseTelesaleNumber(trungMatch[1]);
            customValues.so_trung_knc_vang = so_trung_knc_vang;
            matchedFieldsCount++;
            continue;
        }

        // 4. Số lịch PV mới:
        const pvMoiMatch = line.match(/^(?:số\s*lịch\s*pv\s*mới|lịch\s*pv\s*mới|lich\s*pv\s*moi|số\s*lịch\s*mới)\s*[:：]\s*(.*)$/i);
        if (pvMoiMatch) {
            lich_pv_moi = parseTelesaleNumber(pvMoiMatch[1]);
            customValues.lich_pv_moi = lich_pv_moi;
            matchedFieldsCount++;
            continue;
        }

        // 5. Số lịch PV cũ:
        const pvCuMatch = line.match(/^(?:số\s*lịch\s*pv\s*cũ|lịch\s*pv\s*cũ|lich\s*pv\s*cu|số\s*lịch\s*cũ)\s*[:：]\s*(.*)$/i);
        if (pvCuMatch) {
            lich_pv_cu = parseTelesaleNumber(pvCuMatch[1]);
            customValues.lich_pv_cu = lich_pv_cu;
            matchedFieldsCount++;
            continue;
        }

        // 6. Số đơn chốt mới:
        const chotMoiMatch = line.match(/^(?:số\s*đơn\s*chốt\s*mới|đơn\s*chốt\s*mới|don\s*chot\s*moi)\s*[:：]\s*(.*)$/i);
        if (chotMoiMatch) {
            so_don_chot_moi = parseTelesaleNumber(chotMoiMatch[1]);
            customValues.so_don_chot_moi = so_don_chot_moi;
            matchedFieldsCount++;
            continue;
        }

        // 7. Số đơn chốt cũ:
        const chotCuMatch = line.match(/^(?:số\s*đơn\s*chốt\s*cũ|đơn\s*chốt\s*cũ|don\s*chot\s*cu)\s*[:：]\s*(.*)$/i);
        if (chotCuMatch) {
            so_don_chot_cu = parseTelesaleNumber(chotCuMatch[1]);
            customValues.so_don_chot_cu = so_don_chot_cu;
            matchedFieldsCount++;
            continue;
        }

        // 8. Lịch hẹn ngày mai:
        const ngayMaiMatch = line.match(/^(?:lịch\s*hẹn\s*ngày\s*mai|lịch\s*ngày\s*mai|lich\s*hen\s*ngay\s*mai|lich\s*ngay\s*mai)\s*[:：]\s*(.*)$/i);
        if (ngayMaiMatch) {
            lich_ngay_mai = parseTelesaleNumber(ngayMaiMatch[1]);
            customValues.lich_ngay_mai = lich_ngay_mai;
            matchedFieldsCount++;
            continue;
        }

        // 9. Tổng tới hôm nay:
        const toiMatch = line.match(/^(?:(?:tổng\s*|khách\s*)?tới\s*h(?:ôm\s*)?nay|(?:tổng\s*|khách\s*)?tới|tong\s*toi\s*hnay|tong\s*toi)\s*[:：]\s*(.*)$/i);
        if (toiMatch) {
            tong_toi_hnay = parseTelesaleNumber(toiMatch[1]);
            customValues.tong_toi_hnay = tong_toi_hnay;
            matchedFieldsCount++;
            continue;
        }

        // 10. Tổng bong hôm nay:
        const bongMatch = line.match(/^(?:(?:tổng\s*|khách\s*)?bong\s*h(?:ôm\s*)?nay|(?:tổng\s*|khách\s*)?bong|tong\s*bong\s*hnay|tong\s*bong)\s*[:：]\s*(.*)$/i);
        if (bongMatch) {
            tong_bong_hnay = parseTelesaleNumber(bongMatch[1]);
            customValues.tong_bong_hnay = tong_bong_hnay;
            matchedFieldsCount++;
            continue;
        }

        // 11. TỔNG DS hnay:
        const dsMatch = line.match(/^(?:tổng\s*ds\s*h(?:ôm\s*)?nay|tong\s*ds\s*hnay|doanh\s*số\s*h(?:ôm\s*)?nay|doanh\s*thu\s*h(?:ôm\s*)?nay|tổng\s*ds|doanh\s*số|ds\s*hnay)\s*[:：]\s*(.*)$/i);
        if (dsMatch) {
            tong_ds_hnay = parseTelesaleNumber(dsMatch[1], true);
            customValues.tong_ds_hnay = tong_ds_hnay;
            matchedFieldsCount++;
            continue;
        }

        // 12. Khớp trường tuỳ biến từ dynamicFields (nếu có)
        if (dynamicFields && Array.isArray(dynamicFields)) {
            let fieldMatched = false;
            for (const f of dynamicFields) {
                if (f.category !== 'INPUT') continue;
                const cleanLabel = f.label.replace(/\([^)]*\)/g, '').trim().toLowerCase();
                const cleanLine = line.toLowerCase();
                if (cleanLine.startsWith(cleanLabel) || cleanLine.startsWith(f.key.toLowerCase())) {
                    const colonIdx = line.indexOf(':') !== -1 ? line.indexOf(':') : line.indexOf('：');
                    if (colonIdx !== -1) {
                        const valStr = line.slice(colonIdx + 1).trim();
                        const isCurr = f.type === 'currency' || f.data_type === 'currency';
                        const parsedVal = (f.type === 'number' || isCurr) ? parseTelesaleNumber(valStr, isCurr) : valStr;
                        customValues[f.key] = parsedVal;
                        matchedFieldsCount++;
                        fieldMatched = true;
                        break;
                    }
                }
            }
            if (fieldMatched) continue;
        }

        // 13. Khớp danh sách chi tiết khách hàng: "1. tên khách hàng 1"
        const custMatch = line.match(/^(\d+)[\.\-\/]\s*(.+)$/);
        if (custMatch) {
            const idx = parseInt(custMatch[1], 10);
            const content = custMatch[2].trim();
            const colonIdx = line.indexOf(':') !== -1 ? line.lastIndexOf(':') : line.lastIndexOf('：');
            if (colonIdx > line.indexOf(content)) {
                const name = line.slice(line.indexOf(content), colonIdx).trim();
                const amt = parseTelesaleNumber(line.slice(colonIdx + 1), true);
                customers.push({ index: idx, name, amount: amt });
            } else {
                let amt = 0;
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1].trim();
                    if (/^[\d.,\s]+(?:đ|k|tr|triệu)?$/i.test(nextLine) || /ds/i.test(nextLine)) {
                        amt = parseTelesaleNumber(nextLine, true);
                        i++;
                    }
                }
                customers.push({ index: idx, name: content, amount: amt });
            }
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
        so_don_chot_moi,
        so_don_chot_cu,
        lich_ngay_mai,
        tong_toi_hnay,
        tong_bong_hnay,
        tong_ds_hnay,
        customValues,
        customers
    };
}
