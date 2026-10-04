export const DEFAULT_TELESALE_FIELDS = [
    { key: 'so_nhan', label: 'Số data nhận', type: 'number', category: 'INPUT', default: 0, required: true, is_monthly_cumulative: false, is_hidden: false, order_index: 1 },
    { key: 'so_trung_knc_vang', label: 'Số trùng / KNC / Văng', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 2 },
    { key: 'lich_pv_moi', label: 'Số lịch PV mới', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 3 },
    { key: 'lich_pv_cu', label: 'Số lịch PV cũ', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 4 },
    { key: 'lich_ngay_mai', label: 'Lịch hẹn ngày mai', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 5 },
    { key: 'tong_toi_hnay', label: 'Tổng tới hôm nay', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 6 },
    { key: 'tong_bong_hnay', label: 'Tổng bong hôm nay', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 7 },
    { key: 'tong_ds_hnay', label: 'TỔNG DS hôm nay', type: 'currency', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 8 },
    { key: 'tong_lich', label: 'Tổng lịch cộng dồn', type: 'number', category: 'CALCULATED', formula: '{lich_pv_moi} + {lich_pv_cu}', is_monthly_cumulative: false, is_hidden: false, order_index: 9 },
    { key: 'tong_ds_thang', label: 'Tổng DS cộng dồn tháng', type: 'currency', category: 'CALCULATED', formula: '{tong_ds_hnay}', is_monthly_cumulative: true, is_hidden: false, order_index: 10 },
    { key: 'tong_toi', label: 'Tổng khách tới cộng dồn', type: 'number', category: 'CALCULATED', formula: '{tong_toi_hnay}', is_monthly_cumulative: false, is_hidden: false, order_index: 11 },
    { key: 'ty_le_khach_toi_ds', label: 'Tỷ lệ khách tới / Doanh số', type: 'currency', category: 'CALCULATED', formula: '{tong_ds_hnay} / {tong_toi_hnay}', is_monthly_cumulative: false, is_hidden: false, order_index: 12 },
    { key: 'ty_le_lich', label: 'Tỷ lệ lịch cộng dồn', type: 'percentage', category: 'CALCULATED', formula: '({tong_lich} / {so_nhan}) * 100', is_monthly_cumulative: false, is_hidden: false, order_index: 13, thresholds: [
        { operator: '<', value: 25, badge: '⚠️ (Cảnh báo < 25%)', type: 'warning' }
    ]},
    { key: 'ty_le_toi', label: 'Tỉ lệ tới cộng dồn', type: 'percentage', category: 'CALCULATED', formula: '({tong_toi} / {so_nhan}) * 100', is_monthly_cumulative: false, is_hidden: false, order_index: 14, thresholds: [
        { operator: '>=', value: 19, badge: '🌟 (Khen thưởng > 19%)', type: 'reward' },
        { operator: '<', value: 15, badge: '⚠️ (Cảnh báo < 15%)', type: 'warning' }
    ]}
];

export const DEFAULT_SCHEDULE_SETTINGS = {
    remind_enabled: true,
    remind_time: '18:00',
    deadline_time: '19:00',
    penalty_enabled: true,
    penalty_amount: 50000,
    summary_enabled: true,
    summary_time: '19:01',
    summary_fields: ['so_nhan', 'so_trung_knc_vang', 'tong_lich', 'tong_toi', 'lich_ngay_mai', 'tong_ds_hnay', 'tong_ds_thang', 'ty_le_lich', 'ty_le_toi']
};

/**
 * Phân tích và tính giá trị biểu thức toán học an toàn bằng Shunting-yard RPN.
 *
 * @param {string} formula Biểu thức chứa các biến dạng {field_key}
 * @param {Record<string, number>} contextValues Giá trị thực tế của các trường
 * @returns {number} Kết quả tính toán (làm tròn 2 chữ số thập phân)
 */
export function evaluateFormula(formula, contextValues = {}) {
    if (!formula || typeof formula !== 'string') return 0;

    // 1. Thay thế các biến {key} bằng giá trị số
    let expr = formula.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
        const val = contextValues[key];
        const num = Number(val);
        return isNaN(num) ? '0' : String(num);
    });

    // 2. Tokenize biểu thức
    const tokens = tokenizeMath(expr);
    if (!tokens.length) return 0;

    // 3. Chuyển sang hậu tố (RPN) bằng Shunting-Yard
    const rpn = shuntingYard(tokens);

    // 4. Tính toán RPN với cơ chế chặn chia cho 0
    return executeRpn(rpn);
}

/**
 * Tách biểu thức thành danh sách Token: số và toán tử.
 */
function tokenizeMath(str) {
    const tokens = [];
    let i = 0;
    const cleanStr = str.replace(/\s+/g, '');

    while (i < cleanStr.length) {
        const ch = cleanStr[i];

        if (ch === '+' || ch === '*' || ch === '/' || ch === '(' || ch === ')') {
            tokens.push(ch);
            i++;
        } else if (ch === '-') {
            // Phân biệt dấu trừ toán tử hay dấu âm của số
            const prev = tokens[tokens.length - 1];
            const isUnary = !prev || prev === '(' || prev === '+' || prev === '-' || prev === '*' || prev === '/';
            if (isUnary) {
                // Đọc tiếp số âm
                let numStr = '-';
                i++;
                while (i < cleanStr.length && (/[\d.]/).test(cleanStr[i])) {
                    numStr += cleanStr[i];
                    i++;
                }
                const n = parseFloat(numStr);
                tokens.push(isNaN(n) ? 0 : n);
            } else {
                tokens.push('-');
                i++;
            }
        } else if (/[\d.]/.test(ch)) {
            let numStr = '';
            while (i < cleanStr.length && (/[\d.]/).test(cleanStr[i])) {
                numStr += cleanStr[i];
                i++;
            }
            const n = parseFloat(numStr);
            tokens.push(isNaN(n) ? 0 : n);
        } else {
            // Ký tự lạ bỏ qua
            i++;
        }
    }

    return tokens;
}

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2 };

function shuntingYard(tokens) {
    const output = [];
    const opStack = [];

    for (const t of tokens) {
        if (typeof t === 'number') {
            output.push(t);
        } else if (t === '(') {
            opStack.push(t);
        } else if (t === ')') {
            while (opStack.length && opStack[opStack.length - 1] !== '(') {
                output.push(opStack.pop());
            }
            opStack.pop(); // Bỏ dấu '('
        } else if (PRECEDENCE[t]) {
            while (
                opStack.length &&
                PRECEDENCE[opStack[opStack.length - 1]] &&
                PRECEDENCE[opStack[opStack.length - 1]] >= PRECEDENCE[t]
            ) {
                output.push(opStack.pop());
            }
            opStack.push(t);
        }
    }

    while (opStack.length) {
        output.push(opStack.pop());
    }

    return output;
}

function executeRpn(rpn) {
    const stack = [];

    for (const t of rpn) {
        if (typeof t === 'number') {
            stack.push(t);
        } else if (PRECEDENCE[t]) {
            const b = stack.pop() ?? 0;
            const a = stack.pop() ?? 0;

            if (t === '+') stack.push(a + b);
            else if (t === '-') stack.push(a - b);
            else if (t === '*') stack.push(a * b);
            else if (t === '/') {
                // Quy tắc nghiệp vụ: Mẫu số <= 0 tự động trả về 0 để an toàn
                if (b <= 0 || isNaN(b)) {
                    stack.push(0);
                } else {
                    stack.push(a / b);
                }
            }
        }
    }

    const res = stack.pop() ?? 0;
    return isNaN(res) || !isFinite(res) ? 0 : Number(res.toFixed(2));
}

/**
 * Kiểm tra giá trị có thỏa mãn mốc khen thưởng/cảnh báo hay không.
 *
 * @param {number} value Giá trị thực tế của trường
 * @param {Array<{operator: string, value: number, badge: string, type: string}>} thresholds
 * @returns {{matched: boolean, badge: string, type: string}|null}
 */
export function matchThreshold(value, thresholds = []) {
    if (!Array.isArray(thresholds) || !thresholds.length) return null;

    const num = Number(value) || 0;
    for (const t of thresholds) {
        const thresholdVal = Number(t.value);
        if (isNaN(thresholdVal)) continue;

        let matched = false;
        switch (t.operator) {
            case '>=':
                matched = num >= thresholdVal;
                break;
            case '>':
                matched = num > thresholdVal;
                break;
            case '<=':
                matched = num <= thresholdVal;
                break;
            case '<':
                matched = num < thresholdVal;
                break;
            case '==':
            case '=':
                matched = Math.abs(num - thresholdVal) < 0.001;
                break;
            default:
                break;
        }

        if (matched) {
            return {
                matched: true,
                badge: t.badge || '',
                type: t.type || 'info'
            };
        }
    }

    return null;
}

/**
 * Định dạng giá trị hiển thị theo loại trường.
 */
export function formatFieldValue(val, type = 'number') {
    const n = Number(val || 0);
    if (type === 'currency') {
        return new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';
    }
    if (type === 'percentage') {
        return (Number.isInteger(n) ? n.toString() : n.toFixed(1)) + '%';
    }
    if (type === 'number') {
        return Number.isInteger(n) ? n.toString() : n.toFixed(1);
    }
    return String(val ?? '');
}

/**
 * Tính toán toàn bộ các trường của một form (bao gồm cả trường nhập liệu và trường tính toán).
 *
 * @param {Array<Object>} fields Danh sách cấu hình trường
 * @param {Record<string, any>} rawInput Giá trị nhập từ người dùng
 * @param {Record<string, number>} monthlyPrevious Lũy kế các ngày trước trong tháng
 * @returns {Record<string, any>} Kết quả các trường đã tính toán kèm format và badge
 */
export function calculateDynamicForm(fields = [], rawInput = {}, monthlyPrevious = {}) {
    const results = {};
    const badges = {};
    const formatted = {};

    // Sắp xếp các trường: INPUT trước, CALCULATED sau (đảm bảo thứ tự)
    const sortedFields = [...fields].sort((a, b) => {
        if (a.category === 'INPUT' && b.category !== 'INPUT') return -1;
        if (a.category !== 'INPUT' && b.category === 'INPUT') return 1;
        return (a.order_index || 0) - (b.order_index || 0);
    });

    for (const f of sortedFields) {
        if (f.is_hidden) continue;

        let val = 0;
        if (f.category === 'INPUT') {
            const raw = rawInput[f.key];
            if (f.type === 'currency' || f.type === 'number' || f.type === 'percentage') {
                const parseNum = v => {
                    if (v === null || v === undefined || v === '') return 0;
                    let str = String(v).trim().replace(/\./g, '').replace(/,/g, '');
                    const n = Number(str);
                    return isNaN(n) ? 0 : n;
                };
                val = parseNum(raw);
            } else {
                val = raw ?? '';
            }
        } else if (f.category === 'CALCULATED') {
            val = evaluateFormula(f.formula, results);
        }

        // Lũy kế tháng nếu có (chỉ áp dụng cho trường tính toán lũy kế)
        if (f.is_monthly_cumulative && f.category === 'CALCULATED') {
            const prev = Number(monthlyPrevious[f.key]) || 0;
            val = Number((val + prev).toFixed(2));
        }

        results[f.key] = val;
        formatted[f.key] = formatFieldValue(val, f.type);

        // Đánh giá ngưỡng khen thưởng / cảnh báo nếu có
        if (f.thresholds && Array.isArray(f.thresholds)) {
            const badgeMatch = matchThreshold(val, f.thresholds);
            if (badgeMatch) {
                badges[f.key] = badgeMatch;
            }
        }
    }

    return {
        values: results,
        formatted,
        badges
    };
}
