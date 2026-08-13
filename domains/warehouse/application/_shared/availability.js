/**
 * Tính khả năng đáp ứng của đơn: đủ hàng, cần lấy bù từ cơ sở kia, hay thiếu hẳn.
 *
 * Quy tắc nghiệp vụ: tồn của hai cơ sở CHỈ được cộng ngầm khi kiểm tra đủ/thiếu.
 * Khi trừ thật thì vẫn trừ đúng từng cơ sở, và phần lấy từ cơ sở kia phải sinh
 * phiếu điều chuyển để đối chiếu được.
 */

import { WarehouseError } from '../../domain/constants.js';
import { aggregateOrderItems } from '../../domain/order-validation.js';

export function createAvailabilityService({ inventoryRepo }) {
    /**
     * @param {boolean} lock true khi sắp trừ tồn thật — khoá dòng để hai người
     *        duyệt cùng lúc không cùng nhìn thấy một lượng hàng.
     */
    async function getAvailability(client, itemRows, { lock = false } = {}) {
        const totals = aggregateOrderItems(itemRows);
        const productIds = [...totals.keys()].sort();
        if (productIds.length === 0) {
            throw new WarehouseError('Đơn không còn sản phẩm để xuất.');
        }

        // Bảo đảm có đủ dòng tồn ở cả hai cơ sở, nếu không phép trừ sau đó
        // sẽ không khớp số dòng và bị coi là xung đột.
        for (const productId of productIds) {
            await inventoryRepo.ensureBranchRows(client, productId);
        }

        const inventoryRows = await inventoryRepo.listStocks(client, productIds, { lock });
        const stocks = new Map();
        for (const row of inventoryRows) {
            if (!stocks.has(row.product_id)) {
                stocks.set(row.product_id, {
                    product_id: row.product_id,
                    product_name: row.product_name,
                    barcode: row.barcode,
                    US: 0,
                    UK: 0
                });
            }
            stocks.get(row.product_id)[row.branch] = Number(row.quantity);
        }

        const shortages = [];
        const allocations = [];
        for (const [productId, required] of totals) {
            const stock = stocks.get(productId);
            const totalStock = stock.US + stock.UK;
            if (totalStock < required) {
                shortages.push({
                    product_id: productId,
                    product_name: stock.product_name,
                    barcode: stock.barcode,
                    required,
                    stock_us: stock.US,
                    stock_uk: stock.UK,
                    missing: required - totalStock
                });
            }
            allocations.push({ ...stock, required });
        }
        return { totals, stocks, allocations, shortages };
    }

    return { getAvailability };
}
