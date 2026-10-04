/**
 * Quy tắc nghiệp vụ cho tính năng chỉnh sửa đơn xuất/nhập kho:
 * - Cửa sổ hiệu lực tối đa 24 giờ.
 * - Phân quyền người sửa (chính chủ hoặc Quản lý/Admin).
 * - Tính toán chênh lệch (delta) tồn kho.
 * - Chống âm kho khi tăng xuất hoặc giảm nhập.
 */

export function validateEditWindow(createdAt, now = new Date(), maxHours = 24) {
    const createdTime = new Date(createdAt).getTime();
    const currentTime = new Date(now).getTime();
    const diffMs = currentTime - createdTime;
    const maxMs = maxHours * 60 * 60 * 1000;

    if (diffMs > maxMs) {
        return {
            allowed: false,
            reason: 'EXPIRED_24H',
            message: `Đơn đã tạo quá ${maxHours} giờ, không thể chỉnh sửa.`
        };
    }

    const hoursRemaining = Math.max(0, Number(((maxMs - diffMs) / (60 * 60 * 1000)).toFixed(1)));
    return {
        allowed: true,
        hoursRemaining
    };
}

export function validateOrderEditAuthorization({ actor, order, isSystemAdmin = false }) {
    if (isSystemAdmin) {
        return { allowed: true };
    }

    const role = actor?.employee?.role || actor?.role;
    if (role === 'admin' || role === 'Quản lý') {
        return { allowed: true };
    }

    const employeeId = actor?.employee?.id || actor?.id;
    const telegramId = String(actor?.telegramId || actor?.telegram_id || '');

    const isCreator = (employeeId && order?.created_by && String(employeeId) === String(order.created_by))
        || (telegramId && order?.created_by_telegram_id && telegramId === String(order.created_by_telegram_id))
        || (employeeId && order?.user_id && String(employeeId) === String(order.user_id));

    if (isCreator) {
        return { allowed: true };
    }

    return {
        allowed: false,
        reason: 'FORBIDDEN',
        message: 'Bạn không có quyền chỉnh sửa đơn của người khác.'
    };
}

export function calculateExportDeltas({ currentItems = [], updatedItems = [] }) {
    const deltas = [];
    const currentMap = new Map();

    for (const item of currentItems) {
        if (!item.is_removed) {
            currentMap.set(item.product_id, {
                itemId: item.id,
                quantity: Number(item.actual_quantity) || 0
            });
        }
    }

    const processedProducts = new Set();

    for (const item of updatedItems) {
        const prodId = item.product_id;
        processedProducts.add(prodId);
        const oldInfo = currentMap.get(prodId);
        const oldQty = oldInfo ? oldInfo.quantity : 0;
        const newQty = item.is_removed ? 0 : Number(item.actual_quantity) || 0;
        const delta = Number((newQty - oldQty).toFixed(1));

        deltas.push({
            itemId: item.id || oldInfo?.itemId || null,
            productId: prodId,
            productName: item.product_name || item.product_name_snapshot || '',
            barcode: item.barcode || item.barcode_snapshot || '',
            unit: item.unit_snapshot || item.unit || '',
            oldQuantity: oldQty,
            newQuantity: newQty,
            delta, // delta > 0: tăng xuất; delta < 0: giảm xuất
            stockDeduction: delta > 0 ? delta : 0,
            stockRefund: delta < 0 ? Math.abs(delta) : 0,
            isRemoved: Boolean(item.is_removed)
        });
    }

    // Các món cũ không có trong danh sách mới gửi lên (bị xóa)
    for (const [prodId, oldInfo] of currentMap.entries()) {
        if (!processedProducts.has(prodId)) {
            deltas.push({
                itemId: oldInfo.itemId,
                productId: prodId,
                oldQuantity: oldInfo.quantity,
                newQuantity: 0,
                delta: -oldInfo.quantity,
                stockDeduction: 0,
                stockRefund: oldInfo.quantity,
                isRemoved: true
            });
        }
    }

    const hasChanges = deltas.some(d => d.delta !== 0);
    return { deltas, hasChanges };
}

export function validateExportStockAvailability({ deltas, availableStockMap = {} }) {
    const insufficientProducts = [];

    for (const d of deltas) {
        if (d.stockDeduction > 0) {
            const available = Number(availableStockMap[d.productId]) || 0;
            if (available < d.stockDeduction) {
                insufficientProducts.push({
                    productId: d.productId,
                    productName: d.productName,
                    available,
                    required: d.stockDeduction,
                    shortage: Number((d.stockDeduction - available).toFixed(1))
                });
            }
        }
    }

    return {
        valid: insufficientProducts.length === 0,
        insufficientProducts
    };
}

export function calculateImportDeltas({ currentQuantity, newQuantity }) {
    const oldQty = Number(currentQuantity) || 0;
    const newQty = Number(newQuantity) || 0;
    const delta = Number((newQty - oldQty).toFixed(1));
    return {
        oldQuantity: oldQty,
        newQuantity: newQty,
        delta,
        stockAddition: delta > 0 ? delta : 0,
        stockReduction: delta < 0 ? Math.abs(delta) : 0
    };
}

export function validateImportStockReduction({ delta, currentStock }) {
    if (delta >= 0) {
        return { valid: true };
    }

    const reduction = Math.abs(delta);
    const stock = Number(currentStock) || 0;

    if (stock < reduction) {
        return {
            valid: false,
            reason: 'INSUFFICIENT_STOCK_TO_REDUCE',
            currentStock: stock,
            requestedReduction: reduction,
            shortage: Number((reduction - stock).toFixed(1)),
            message: `Hàng đã xuất dùng, tồn kho hiện tại chỉ còn ${stock} không đủ để giảm ${reduction}.`
        };
    }

    return { valid: true };
}
