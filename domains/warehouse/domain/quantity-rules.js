export const QUANTITY_MODES = Object.freeze({
    INTEGER: 'INTEGER',
    DECIMAL: 'DECIMAL'
});

export const MAX_QUANTITY_DECIMALS = 1;

export function normalizeQuantityMode(value) {
    return value === QUANTITY_MODES.DECIMAL
        ? QUANTITY_MODES.DECIMAL
        : QUANTITY_MODES.INTEGER;
}

export function roundQuantity(value) {
    return Number(Number(value).toFixed(MAX_QUANTITY_DECIMALS));
}

export function parseQuantity(value, quantityMode = QUANTITY_MODES.INTEGER) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;

    const scale = 10 ** MAX_QUANTITY_DECIMALS;
    if (Math.abs(quantity * scale - Math.round(quantity * scale)) > 1e-7) return null;
    if (normalizeQuantityMode(quantityMode) === QUANTITY_MODES.INTEGER && !Number.isInteger(quantity)) {
        return null;
    }

    return roundQuantity(quantity);
}

export function quantityModeLabel(quantityMode) {
    return normalizeQuantityMode(quantityMode) === QUANTITY_MODES.DECIMAL
        ? `số dương, tối đa ${MAX_QUANTITY_DECIMALS} chữ số thập phân`
        : 'số nguyên dương';
}
