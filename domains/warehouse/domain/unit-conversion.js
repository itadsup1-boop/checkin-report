import { roundQuantity } from './quantity-rules.js';

export const DEFAULT_BASE_UNIT = 'chiếc';

/**
 * Quy đổi số lượng từ đơn vị nhập sang đơn vị cơ sở lưu kho.
 * Ví dụ: 2 Lọ (hệ số 2.5 ml/lọ) => 5.0 ml
 */
export function calculateBaseQuantity(importQuantity, conversionRate = 1) {
    const qty = Number(importQuantity) || 0;
    const rate = Number(conversionRate) > 0 ? Number(conversionRate) : 1;
    return roundQuantity(qty * rate);
}

/**
 * Quy đổi NGƯỢC: giá nhân viên nhập theo đơn vị đóng gói (ví dụ 1 Lọ) về giá
 * theo đơn vị cơ sở lưu/xuất kho (ví dụ 1 ml) — vì đơn xuất luôn tính tiền
 * theo actual_quantity ở đơn vị cơ sở, không phải đơn vị đóng gói.
 * Ví dụ: 1 Lọ = 2.5 ml, giá 1 Lọ = 50.000đ => giá cơ sở = 50.000 / 2.5 = 20.000đ/ml.
 */
export function calculateBasePrice(packUnitPrice, conversionRate = 1) {
    const price = Number(packUnitPrice) || 0;
    const rate = Number(conversionRate) > 0 ? Number(conversionRate) : 1;
    return Math.round((price / rate) * 100) / 100;
}

/**
 * Định dạng chuỗi hiển thị số lượng kèm đơn vị.
 * Ví dụ: formatUnitLabel(1.2, 'ml') => '1.2 ml'
 */
export function formatUnitLabel(quantity, unit = DEFAULT_BASE_UNIT) {
    const cleanUnit = (unit && String(unit).trim()) || DEFAULT_BASE_UNIT;
    return `${quantity} ${cleanUnit}`;
}

/**
 * Định dạng hiển thị tồn kho kép (vừa hiện đơn vị cơ sở, vừa quy đổi ra số lượng đóng gói).
 * Ví dụ: formatDualUnitDisplay({ baseQuantity: 3.8, baseUnit: 'ml', importUnit: 'Lọ', conversionRate: 2.5 })
 *        => '3.8 ml (~1 Lọ + 1.3 ml)'
 */
export function formatDualUnitDisplay({
    baseQuantity,
    baseUnit = DEFAULT_BASE_UNIT,
    importUnit = null,
    conversionRate = 1
} = {}) {
    const qty = Number(baseQuantity) || 0;
    const cleanBaseUnit = (baseUnit && String(baseUnit).trim()) || DEFAULT_BASE_UNIT;
    const cleanImportUnit = importUnit && String(importUnit).trim();
    const rate = Number(conversionRate) || 1;

    if (!cleanImportUnit || rate <= 1 || cleanImportUnit.toLowerCase() === cleanBaseUnit.toLowerCase()) {
        return `${qty} ${cleanBaseUnit}`;
    }

    const fullPacks = Math.floor(qty / rate);
    const remainder = roundQuantity(qty - (fullPacks * rate));

    if (fullPacks === 0) {
        return `${qty} ${cleanBaseUnit}`;
    }

    if (remainder === 0) {
        return `${qty} ${cleanBaseUnit} (~${fullPacks} ${cleanImportUnit})`;
    }

    return `${qty} ${cleanBaseUnit} (~${fullPacks} ${cleanImportUnit} + ${remainder} ${cleanBaseUnit})`;
}

/**
 * Kiểm tra và chuẩn hóa cấu hình đơn vị tính của sản phẩm.
 */
export function validateConversionConfig({
    base_unit,
    import_unit,
    conversion_rate
} = {}) {
    const cleanBaseUnit = (base_unit && String(base_unit).trim()) || DEFAULT_BASE_UNIT;
    const cleanImportUnit = (import_unit && String(import_unit).trim()) || null;
    let rate = Number(conversion_rate);

    if (!cleanImportUnit) {
        return {
            base_unit: cleanBaseUnit,
            import_unit: null,
            conversion_rate: 1.0
        };
    }

    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Hệ số quy đổi đóng gói phải là số dương lớn hơn 0.');
    }

    return {
        base_unit: cleanBaseUnit,
        import_unit: cleanImportUnit,
        conversion_rate: roundQuantity(rate)
    };
}
