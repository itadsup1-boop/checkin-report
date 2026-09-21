/**
 * Quy tắc cảnh báo hàng gần hết (dưới 5) sau mỗi lần xuất kho.
 *
 * Tầng domain thuần túy: không chứa SQL, không phụ thuộc framework hay hạ tầng.
 */

export const LOW_STOCK_THRESHOLD = 5;

/**
 * Lọc danh sách các sản phẩm có số lượng tồn sau khi xuất dưới ngưỡng tối thiểu.
 *
 * @param {Array<{
 *   productId?: string,
 *   product_id?: string,
 *   productName?: string,
 *   product_name?: string,
 *   barcode?: string,
 *   branch: string,
 *   remaining: number
 * }>} items
 * @param {number} [threshold=LOW_STOCK_THRESHOLD]
 * @returns {Array}
 */
export function filterLowStockItems(items, threshold = LOW_STOCK_THRESHOLD) {
    if (!Array.isArray(items)) return [];
    return items.filter(item => {
        const remaining = Number(item.remaining);
        return !Number.isNaN(remaining) && remaining < threshold;
    });
}

/**
 * Thu thập sản phẩm có tồn kho dưới ngưỡng từ danh sách đã xuất (dành cho luồng duyệt xuất cũ).
 */
export function collectLowStockFromApprovedList(approvedList, threshold = LOW_STOCK_THRESHOLD) {
    const lowStockItems = [];
    for (const item of approvedList || []) {
        const prefRemaining = item.prefBranch === 'US' ? item.finalStockUs : item.finalStockUk;
        if (prefRemaining < threshold) {
            lowStockItems.push({
                productName: item.product_name,
                barcode: item.barcode,
                branch: item.prefBranch,
                remaining: prefRemaining
            });
        }
        if (item.otherDeduct > 0) {
            const otherRemaining = item.otherBranch === 'US' ? item.finalStockUs : item.finalStockUk;
            if (otherRemaining < threshold) {
                lowStockItems.push({
                    productName: item.product_name,
                    barcode: item.barcode,
                    branch: item.otherBranch,
                    remaining: otherRemaining
                });
            }
        }
    }
    return lowStockItems;
}

/**
 * Soạn tin nhắn HTML thông báo lên nhóm Telegram khi có sản phẩm dưới ngưỡng 5.
 *
 * @param {Array<{
 *   productId?: string,
 *   product_id?: string,
 *   productName?: string,
 *   product_name?: string,
 *   barcode?: string,
 *   branch: string,
 *   remaining: number
 * }>} items
 * @param {(str: string) => string} [escapeHtml]
 * @returns {string}
 */
export function buildLowStockWarningMessage(items, escapeHtml = (s => s || '')) {
    const validItems = filterLowStockItems(items);
    if (validItems.length === 0) return '';

    // Khử trùng lặp theo cơ sở + mã/tên sản phẩm
    const seen = new Set();
    const byBranch = new Map();
    for (const item of validItems) {
        const branch = item.branch || 'Chưa xác định';
        const key = `${branch}::${item.productId || item.product_id || item.productName || item.product_name}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (!byBranch.has(branch)) {
            byBranch.set(branch, []);
        }
        byBranch.get(branch).push(item);
    }

    let message = `⚠️ <b>[CẢNH BÁO HÀNG GẦN HẾT - CẦN BỔ SUNG]</b>\n\n`;

    if (byBranch.size === 1) {
        const [branch, branchItems] = [...byBranch.entries()][0];
        message += `🏢 <b>Cơ sở:</b> ${escapeHtml(branch)}\n` +
            `📦 Các sản phẩm sau khi xuất đã xuống dưới mức tối thiểu (&lt; ${LOW_STOCK_THRESHOLD}):\n`;
        for (const item of branchItems) {
            const name = item.productName || item.product_name || 'Sản phẩm';
            const barcode = item.barcode ? ` (<code>${escapeHtml(item.barcode)}</code>)` : '';
            message += `• <b>${escapeHtml(name)}</b>${barcode}: còn <b>${item.remaining}</b>\n`;
        }
    } else {
        message += `📦 Các sản phẩm sau khi xuất đã xuống dưới mức tối thiểu (&lt; ${LOW_STOCK_THRESHOLD}):\n\n`;
        for (const [branch, branchItems] of byBranch.entries()) {
            message += `🏢 <b>Cơ sở ${escapeHtml(branch)}:</b>\n`;
            for (const item of branchItems) {
                const name = item.productName || item.product_name || 'Sản phẩm';
                const barcode = item.barcode ? ` (<code>${escapeHtml(item.barcode)}</code>)` : '';
                message += `• <b>${escapeHtml(name)}</b>${barcode}: còn <b>${item.remaining}</b>\n`;
            }
            message += '\n';
        }
    }

    message += `\n👉 Vui lòng lên kế hoạch nhập bổ sung hàng.`;
    return message.trim();
}
