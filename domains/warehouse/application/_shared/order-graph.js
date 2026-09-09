/**
 * Kiểm tra và chụp ảnh danh mục tại thời điểm tạo đơn.
 *
 * Vì sao phải "chụp ảnh": tên và mã vạch sản phẩm được lưu thẳng vào đơn. Sau
 * này Admin đổi tên sản phẩm thì đơn cũ vẫn giữ nguyên tên lúc bán, nên đối
 * chiếu sổ sách không bị sai lệch theo thời gian.
 *
 * Đồng thời phân biệt dòng hàng "theo mẫu dịch vụ" và dòng nhân viên tự thêm.
 */

import { WarehouseError } from '../../domain/constants.js';
import { parseQuantity, quantityModeLabel } from '../../domain/quantity-rules.js';

export function createOrderGraphBuilder({ catalogRepo }) {
    async function validateAndSnapshotGraph(client, normalized) {
        const serviceIds = normalized.services.map(service => service.service_id);
        const activeServices = await catalogRepo.listActiveServices(client, serviceIds);
        const serviceMap = new Map(activeServices.map(row => [row.id, row]));
        if (serviceMap.size !== new Set(serviceIds).size) {
            throw new WarehouseError('Có dịch vụ không tồn tại hoặc đã tạm ẩn.', {
                code: 'INACTIVE_SERVICE'
            });
        }

        const productIds = [...new Set(normalized.services.flatMap(service =>
            service.items.map(item => item.product_id)
        ))];
        const activeProducts = await catalogRepo.listActiveProducts(client, productIds);
        const productMap = new Map(activeProducts.map(row => [row.id, row]));
        if (productMap.size !== productIds.length) {
            throw new WarehouseError('Có sản phẩm không tồn tại hoặc đã tạm ẩn.', {
                code: 'INACTIVE_PRODUCT'
            });
        }

        const templateItems = await catalogRepo.listTemplateItems(client, serviceIds, productIds);
        const templateMap = new Map(templateItems.map(row => [
            `${row.service_id}:${row.product_id}`,
            Number(row.default_quantity)
        ]));

        return normalized.services.map(service => ({
            ...service,
            snapshot: serviceMap.get(service.service_id),
            items: service.items.map(item => {
                const product = productMap.get(item.product_id);
                const quantity = parseQuantity(item.actual_quantity, product.quantity_mode);
                if (quantity === null) {
                    throw new WarehouseError(
                        `Số lượng của ${product.product_name} phải là ${quantityModeLabel(product.quantity_mode)}.`,
                        { code: 'INVALID_PRODUCT_QUANTITY' }
                    );
                }
                return {
                    ...item,
                    actual_quantity: quantity,
                    product,
                    template_quantity: templateMap.get(`${service.service_id}:${item.product_id}`) || null,
                    item_source: templateMap.has(`${service.service_id}:${item.product_id}`)
                        ? 'TEMPLATE'
                        : 'MANUAL'
                };
            })
        }));
    }

    return { validateAndSnapshotGraph };
}
