/**
 * Use case: kế toán (hoặc Admin) nhập đơn giá mới cho một sản phẩm.
 *
 * Ba việc trong CÙNG một transaction: (1) thêm dòng lịch sử giá mới — không
 * bao giờ sửa/xoá dòng cũ, (2) tìm mọi đơn ĐÃ DUYỆT đang thiếu giá của đúng
 * sản phẩm này rồi gán giá vừa nhập vào, (3) tính lại tổng tiền của những đơn
 * đó. Đồng bộ Google Sheet nằm NGOÀI transaction — lỗi mạng/Google không được
 * kéo theo rollback dữ liệu giá đã lưu.
 */

import { WarehouseError } from '../domain/constants.js';
import { hasPricingAccess } from '../domain/pricing-access.js';

/**
 * Nhân viên/kế toán chỉ biết giá theo đơn vị ĐÓNG GÓI khi nhập (vd 1 Lọ =
 * 50.000đ) — DB lưu ĐÚNG con số này, không quy đổi gì cả ở đây, để khớp với
 * giá trên hóa đơn nhập hàng thật và dễ đối chiếu sau này. Đơn xuất kho tính
 * tiền theo đơn vị CƠ SỞ (ml) nên việc quy đổi (chia cho conversion_rate) chỉ
 * xảy ra một chỗ duy nhất — lúc `pricingRepo.recomputeOrderTotal` tính tổng
 * tiền — không phải ở đây.
 */
export function createSetProductPriceUseCase({ pool, pricingRepo, withTransaction, sheetSync }) {
    async function setProductPrice({ productId, unitPrice, actorContext }) {
        if (!hasPricingAccess(actorContext, 'MANAGE_PRICING')) {
            throw new WarehouseError('Bạn không có quyền nhập đơn giá sản phẩm.', {
                status: 403,
                code: 'MANAGE_PRICING_PERMISSION_REQUIRED'
            });
        }

        const enteredPrice = Number(unitPrice);
        if (!Number.isFinite(enteredPrice) || enteredPrice < 0) {
            throw new WarehouseError('Đơn giá không hợp lệ.', { status: 400 });
        }

        const product = await pricingRepo.findProductById(productId);
        if (!product) {
            throw new WarehouseError('Không tìm thấy sản phẩm.', { status: 404 });
        }

        const priceUnit = product.import_unit || product.base_unit || 'đơn vị';
        const oldPrice = product.current_price !== null ? Number(product.current_price) : null;

        const { inserted, patchedOrderIds } = await withTransaction(async client => {
            const inserted = await pricingRepo.insertPrice(client, {
                productId,
                unitPrice: enteredPrice,
                employeeId: actorContext.employee?.id || null,
                telegramId: actorContext.telegramId
            });

            const patchedOrderIds = await pricingRepo.findOrdersMissingPriceForProduct(client, productId);
            for (const orderId of patchedOrderIds) {
                await pricingRepo.patchOrderItemsPrice(client, orderId, productId, enteredPrice);
                await pricingRepo.recomputeOrderTotal(client, orderId);
            }

            return { inserted, patchedOrderIds };
        });

        // Đồng bộ Sheet — best-effort, không rollback dữ liệu đã lưu nếu lỗi.
        // Ghi đúng giá nhân viên đã nhập (theo đơn vị đóng gói) để kế toán đọc
        // lại Sheet không cần tự quy đổi ngược.
        const actorName = actorContext.employee?.full_name || 'Admin';
        try {
            await sheetSync.syncNewPrice({
                groupId: actorContext.group.id,
                productName: product.product_name,
                barcode: product.barcode,
                unitPrice: enteredPrice,
                priceUnit,
                actorName,
                createdAt: inserted.created_at
            });
        } catch (error) {
            console.error('Lỗi đồng bộ Sheet đơn giá:', error);
        }

        for (const orderId of patchedOrderIds) {
            try {
                const order = await pricingRepo.findOrderSummary(pool, orderId);
                if (!order) continue;
                await sheetSync.syncOrderTotal({
                    groupId: order.group_id,
                    orderCode: order.order_code,
                    approvedAt: order.approved_at,
                    branch: order.branch,
                    totalAmount: order.total_amount,
                    hasMissingPrice: order.has_missing_price
                });
            } catch (error) {
                console.error('Lỗi đồng bộ Sheet tổng giá đơn xuất:', error);
            }
        }

        return {
            product: { id: product.id, name: product.product_name, barcode: product.barcode },
            oldPrice,
            newPrice: enteredPrice,
            priceUnit,
            createdAt: inserted.created_at,
            patchedOrderCount: patchedOrderIds.length
        };
    }

    return { setProductPrice };
}
