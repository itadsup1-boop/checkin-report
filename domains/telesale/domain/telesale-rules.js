/**
 * Domain Rules cho Báo Cáo Telesale.
 *
 * Thuần nghiệp vụ — CẤM import Express, pg, telegraf hay Google API.
 */

export const TELESALE_THRESHOLDS = {
    LICH_WARNING_PERCENT: 25,
    TOI_WARNING_PERCENT: 15,
    TOI_REWARD_PERCENT: 19,
    PENALTY_AMOUNT: 50000,
    REMIND_HOUR: 18,
    REMIND_MINUTE: 0,
    DEADLINE_HOUR: 19,
    DEADLINE_MINUTE: 0
};

/**
 * Chuẩn hoá dữ liệu thô từ Mini App hoặc tin nhắn.
 * Mọi trường đều là số (all là số hết), nếu để trống/undefined thì mặc định = 0.
 */
export function normalizeTelesalePayload(raw = {}) {
    const parseNum = val => {
        if (val === null || val === undefined || val === '') return 0;
        let str = String(val).trim();
        // Hỗ trợ cả dấu chấm phân cách hàng nghìn (ví dụ 8.000.000)
        if (/\.\d{3}/.test(str)) {
            str = str.replace(/\./g, '');
        }
        str = str.replace(/,/g, '');
        const n = Number(str);
        return isNaN(n) || n < 0 ? 0 : n;
    };

    let services = [];
    if (Array.isArray(raw.services)) {
        services = raw.services
            .map(s => ({
                service_name: String(s.service_name || '').trim(),
                lich: Math.round(parseNum(s.lich)),
                toi: Math.round(parseNum(s.toi)),
                ds: Math.round(parseNum(s.ds))
            }))
            .filter(s => s.service_name !== '');
    }

    return {
        so_nhan: Math.round(parseNum(raw.so_nhan)),
        so_trung_knc_vang: Math.round(parseNum(raw.so_trung_knc_vang)),
        lich_pv_moi: Math.round(parseNum(raw.lich_pv_moi)),
        lich_pv_cu: Math.round(parseNum(raw.lich_pv_cu)),
        lich_ngay_mai: Math.round(parseNum(raw.lich_ngay_mai)),
        tong_toi_hnay: Math.round(parseNum(raw.tong_toi_hnay)),
        tong_bong_hnay: Math.round(parseNum(raw.tong_bong_hnay)),
        tong_ds_hnay: Math.round(parseNum(raw.tong_ds_hnay)),
        services
    };
}

/**
 * Tính toán các chỉ số tự động cộng (5 mục trong ngày + 1 mục luỹ kế tháng).
 *
 * @param {Object} data Dữ liệu đã chuẩn hoá trong ngày của nhân sự
 * @param {number} monthlyPreviousRevenue Doanh số luỹ kế của các ngày trước trong tháng (không gồm hôm nay)
 * @returns {Object} Các chỉ số và trạng thái cảnh báo / khen thưởng
 */
export function calculateTelesaleStats(data, monthlyPreviousRevenue = 0) {
    const norm = normalizeTelesalePayload(data);

    // 1. Tổng lịch cộng dồn trong ngày
    const tong_lich = norm.lich_pv_moi + norm.lich_pv_cu;

    // 2. Tổng DS cộng dồn tháng
    const tong_ds_thang = Math.round(Number(monthlyPreviousRevenue || 0) + norm.tong_ds_hnay);

    // 3. Tổng khách tới cộng dồn trong ngày
    const tong_toi = norm.tong_toi_hnay;

    // 4. Tỷ lệ khách tới / doanh số cộng dồn (Doanh số trung bình trên mỗi khách tới hôm nay)
    const ty_le_khach_toi_ds = norm.tong_toi_hnay > 0
        ? Math.round(norm.tong_ds_hnay / norm.tong_toi_hnay)
        : 0;

    // 5. Tỷ lệ lịch cộng dồn (% chốt lịch trên số nhận trong ngày)
    const ty_le_lich = norm.so_nhan > 0
        ? Number(((tong_lich / norm.so_nhan) * 100).toFixed(1))
        : 0;

    // 6. Tỉ lệ tới cộng dồn (% khách tới trên số nhận trong ngày)
    const ty_le_toi = norm.so_nhan > 0
        ? Number(((norm.tong_toi_hnay / norm.so_nhan) * 100).toFixed(1))
        : 0;

    // Các ngưỡng cảnh báo và khen thưởng
    const isLichWarning = norm.so_nhan > 0 && ty_le_lich < TELESALE_THRESHOLDS.LICH_WARNING_PERCENT;
    const isToiWarning = norm.so_nhan > 0 && ty_le_toi < TELESALE_THRESHOLDS.TOI_WARNING_PERCENT;
    const isToiReward = norm.so_nhan > 0 && ty_le_toi > TELESALE_THRESHOLDS.TOI_REWARD_PERCENT;

    return {
        ...norm,
        tong_lich,
        tong_ds_thang,
        tong_toi,
        ty_le_khach_toi_ds,
        ty_le_lich,
        ty_le_toi,
        isLichWarning,
        isToiWarning,
        isToiReward,
        services: norm.services || []
    };
}

/**
 * Định dạng tiền tệ VNĐ (ví dụ: 10.000.000 đ).
 */
export function formatVnd(amount) {
    const n = Number(amount || 0);
    return new Intl.NumberFormat('vi-VN').format(n) + ' đ';
}
