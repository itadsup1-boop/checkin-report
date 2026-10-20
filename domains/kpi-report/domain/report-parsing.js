/**
 * Phân tích nội dung báo cáo KPI hàng ngày (role `report`/`report_tour`).
 *
 * Thuần — không pg/express/telegraf. Tách từ apps/bot/kpi_features.js, giữ
 * nguyên từng quy tắc chữ/số để không đổi cách nhận diện báo cáo hợp lệ.
 */

/** "12tr", "500k", "2 triệu" -> số nguyên VNĐ. */
export function parseCurrency(text) {
    if (!text) return 0;
    let val = text.toLowerCase().replace(/,/g, '').replace(/\./g, '').trim();
    let numMatch = val.match(/[\d]+/);
    if (!numMatch) return 0;
    let num = parseInt(numMatch[0]);
    if (val.includes('tr') || val.includes('triệu') || val.includes('m') || val.includes('củ')) {
        num *= 1000000;
    } else if (val.includes('k') || val.includes('nghìn') || val.includes('ngàn') || val.includes('lít')) {
        num *= 1000;
    }
    return num;
}

/**
 * Kiểm tra và tách nội dung báo cáo theo mẫu 3 dòng: số tin nhắn, doanh thu,
 * lịch khách. `command_trigger` rỗng nghĩa là bỏ qua kiểm tra tiền tố (dùng khi
 * đã xác định chắc chắn đây là báo cáo từ trước, ví dụ parse lại từ raw_text).
 */
export function parseReport(text, command_trigger = '#baocao') {
    const safeTrigger = command_trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const triggerRegex = new RegExp(`^${safeTrigger}`, 'i');

    if (!triggerRegex.test(text.trim())) {
        return { is_valid: false };
    }

    const lines = text.split('\n').map(line => line.trim().toLowerCase());

    // Hỗ trợ mượt mà: Nếu gõ kiểu cũ "#baocao 15" trên 1 dòng
    if (lines.length === 1) {
        const fallbackMatch = text.match(new RegExp(`^${safeTrigger}\\s+(\\d+)`, 'i'));
        if (fallbackMatch) {
            const num = parseInt(fallbackMatch[1]);
            return {
                is_valid: true,
                kpi_actual: num,
                doanh_thu: 0,
                lich_khach: 'Không có',
                total_photos_needed: num
            };
        }
        return { is_valid: false };
    }

    let kpi_actual = 0;
    let doanh_thu = 0;
    let lich_khach = '';
    let hasTinNhan = false;
    let hasDoanhThu = false;
    let hasLichKhach = false;

    const textLower = text.toLowerCase();

    const tinNhanMatch = textLower.match(/(?:tin nhắn|tin gửi|tin gui).*?:\s*(\d+)/);
    if (tinNhanMatch) {
        kpi_actual = parseInt(tinNhanMatch[1]);
        hasTinNhan = true;
    }

    const doanhThuMatch = textLower.match(/(?:doanh thu|doanh số|số ds).*?:\s*(.+)/);
    if (doanhThuMatch) {
        doanh_thu = parseCurrency(doanhThuMatch[1]);
        hasDoanhThu = true;
    }

    let lichKhachLines = [];
    let isParsingLichKhach = false;

    for (const line of lines) {
        if (line.includes('lịch khách')) {
            hasLichKhach = true;
            isParsingLichKhach = true;
            const parts = line.split(':');
            if (parts.length > 1 && parts[1].trim() !== '') {
                lichKhachLines.push(parts.slice(1).join(':').trim());
            }
        } else if (isParsingLichKhach) {
            // Cứ thế thu thập các dòng lịch khách ở bên dưới
            lichKhachLines.push(line);
        }
    }

    if (lichKhachLines.length > 0) {
        lich_khach = lichKhachLines.join('\n').trim();
    }

    // Validate 1: Thiếu dòng nào không?
    const is_definitely_report = hasTinNhan && hasDoanhThu && hasLichKhach;

    if (!hasTinNhan || !hasDoanhThu || !hasLichKhach) {
        let missing = [];
        if (!hasTinNhan) missing.push('Số tin nhắn gửi');
        if (!hasDoanhThu) missing.push('Số doanh thu');
        if (!hasLichKhach) missing.push('Lịch khách');
        return {
            is_valid: false,
            is_definitely_report,
            error_msg: `❌ Báo cáo thiếu hoặc bỏ trống các mục: ${missing.join(', ')}.\n👉 Vui lòng điền ĐẦY ĐỦ form mẫu!`
        };
    }

    // Validate 2: Định dạng lịch khách
    if (lich_khach !== '0' && !lich_khach.includes('không') && !lich_khach.includes('ko có')) {
        const hasSlash = lich_khach.includes('/');
        const isTaiKham = lich_khach.toLowerCase().includes('tái khám') || lich_khach.toLowerCase().includes('tai kham');
        if (!hasSlash && !isTaiKham) {
            return {
                is_valid: false,
                is_definitely_report,
                error_msg: `❌ Định dạng Lịch khách chưa đúng!\n👉 Nếu có khách, bắt buộc phải ghi rành mạch có dấu gạch chéo '/' báo số buổi (Ví dụ: 3/10) hoặc ghi 'tái khám' (Ví dụ: khách tái khám / tái khám).\n👉 Nếu KHÔNG có khách, hãy ghi: Lịch khách: 0`
            };
        }
    }

    return {
        is_valid: true,
        kpi_actual,
        doanh_thu,
        lich_khach,
        total_photos_needed: kpi_actual + (doanh_thu > 0 ? 1 : 0)
    };
}

/**
 * Có phải tin nhắn này là một báo cáo không — theo đúng lệnh trigger của nhóm,
 * hoặc "nhận diện thông minh" khi nhân viên gõ tự nhiên không đúng cú pháp lệnh.
 *
 * @returns {{matched:boolean, usedTrigger:string}} `usedTrigger` rỗng nghĩa là
 *          bắt được theo kiểu tự nhiên — `parseReport` sẽ bỏ qua kiểm tra tiền tố.
 */
export function detectReportTrigger(text, commandTrigger) {
    const textLower = text.toLowerCase();

    if (textLower.startsWith(commandTrigger)) {
        return { matched: true, usedTrigger: commandTrigger };
    }

    if (textLower.includes('báo cáo') || textLower.includes('bao cao')) {
        const hasNumbers = /\d/.test(textLower);
        const hasDoanhThu = textLower.includes('doanh thu') || textLower.includes('doanh số') || textLower.includes('số ds');
        const hasKhach = textLower.includes('khách');
        const hasTinNhan = textLower.includes('tin nhắn') || textLower.includes('tin gửi') || textLower.includes('tin gui');

        // Nhận diện thông minh: Có số liệu và ít nhất 2 từ khóa báo cáo đặc trưng
        if (hasNumbers && ((hasDoanhThu && hasKhach) || (hasDoanhThu && hasTinNhan) || (hasKhach && hasTinNhan) || text.split('\n').length > 3)) {
            return { matched: true, usedTrigger: '' };
        }
    }

    return { matched: false, usedTrigger: commandTrigger };
}

/**
 * Hạn chót nộp ảnh minh chứng = giờ nhắc nhở của nhóm + 2 tiếng, nhưng tối
 * thiểu 5 phút kể từ lúc nộp để nhân viên kịp tải ảnh nếu nộp sát/trễ giờ.
 */
export function computeReportDeadline(remindTime1, now = new Date()) {
    const [h, m] = remindTime1.split(':').map(Number);
    const deadlineDate = new Date(now);
    deadlineDate.setHours(h, m + 120, 0, 0);

    const minDeadline = new Date(now.getTime() + 5 * 60 * 1000);
    return deadlineDate > minDeadline ? deadlineDate : minDeadline;
}
