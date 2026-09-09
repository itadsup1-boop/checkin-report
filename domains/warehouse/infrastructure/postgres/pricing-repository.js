/**
 * Đơn giá sản phẩm (`tk_product_prices`) và các cột giá liên quan trên đơn xuất
 * kho (`tk_warehouse_order_items.unit_price_snapshot`,
 * `tk_warehouse_orders.total_amount`/`has_missing_price`).
 *
 * `tk_product_prices` CHỈ INSERT, không UPDATE/DELETE — giá cũ luôn còn để tra
 * cứu. Giá "hiện tại" của một sản phẩm luôn là dòng mới nhất theo created_at.
 *
 * QUAN TRỌNG: `unit_price`/`unit_price_snapshot` lưu ĐÚNG giá nhân viên nhập —
 * theo đơn vị ĐÓNG GÓI (vd Lọ), không quy đổi gì cả lúc lưu. Đơn xuất kho lại
 * tính tiền theo actual_quantity ở đơn vị CƠ SỞ (ml), nên việc quy đổi
 * (chia cho conversion_rate) chỉ xảy ra một chỗ duy nhất — lúc tính tổng tiền
 * đơn ở `recomputeOrderTotal`, dùng domain function `calculateBasePrice`.
 * Nhờ vậy giá lưu trong DB/Sheet luôn khớp với giá trên hóa đơn nhập hàng
 * thật, dễ đối chiếu, không phải một con số đã bị chia sẵn.
 */

import { calculateBasePrice } from '../../domain/unit-conversion.js';

export function createPricingRepository(pool) {
    /* ---------- Đọc: tìm kiếm + giá hiện tại ---------- */

    /** Sản phẩm khớp tên/barcode, kèm giá mới nhất (nếu có) — giá theo đúng đơn vị đã nhập (vd Lọ). */
    async function searchProductsWithPrice(query) {
        const keyword = `%${(query || '').trim()}%`;
        const result = await pool.query(
            `SELECT p.id, p.barcode, p.product_name, p.base_unit, p.import_unit,
                    latest.unit_price AS current_price,
                    latest.created_at AS price_updated_at
             FROM tk_products p
             LEFT JOIN LATERAL (
                 SELECT unit_price, created_at
                 FROM tk_product_prices
                 WHERE product_id = p.id
                 ORDER BY created_at DESC
                 LIMIT 1
             ) latest ON TRUE
             WHERE p.is_active = TRUE
               AND (p.product_name ILIKE $1 OR p.barcode ILIKE $1)
             ORDER BY p.product_name ASC
             LIMIT 30`,
            [keyword]
        );
        return result.rows;
    }

    /** Toàn bộ danh mục sản phẩm kèm giá hiện tại — dùng cho màn "Giá sản phẩm" xem nhanh cả danh sách. */
    async function listAllProductsWithPrice() {
        const result = await pool.query(
            `SELECT p.id, p.barcode, p.product_name, p.base_unit, p.import_unit,
                    latest.unit_price AS current_price,
                    latest.created_at AS price_updated_at
             FROM tk_products p
             LEFT JOIN LATERAL (
                 SELECT unit_price, created_at
                 FROM tk_product_prices
                 WHERE product_id = p.id
                 ORDER BY created_at DESC
                 LIMIT 1
             ) latest ON TRUE
             WHERE p.is_active = TRUE
             ORDER BY p.product_name ASC
             LIMIT 1000`
        );
        return result.rows;
    }

    async function findProductById(productId) {
        const result = await pool.query(
            `SELECT p.id, p.barcode, p.product_name, p.base_unit, p.import_unit,
                    latest.unit_price AS current_price,
                    latest.created_at AS price_updated_at
             FROM tk_products p
             LEFT JOIN LATERAL (
                 SELECT unit_price, created_at
                 FROM tk_product_prices
                 WHERE product_id = p.id
                 ORDER BY created_at DESC
                 LIMIT 1
             ) latest ON TRUE
             WHERE p.id = $1`,
            [productId]
        );
        return result.rows[0] || null;
    }

    /** Toàn bộ lịch sử giá của một sản phẩm, mới nhất trước — dùng cho màn xem lịch sử. */
    async function findPriceHistory(productId) {
        const result = await pool.query(
            `SELECT pp.id, pp.unit_price, pp.created_at,
                    COALESCE(e.full_name, 'Admin') AS created_by_name
             FROM tk_product_prices pp
             LEFT JOIN employees e ON e.id = pp.created_by_employee_id
             WHERE pp.product_id = $1
             ORDER BY pp.created_at DESC
             LIMIT 50`,
            [productId]
        );
        return result.rows;
    }

    /* ---------- Ghi: nhập giá mới ---------- */

    async function insertPrice(client, { productId, unitPrice, employeeId, telegramId }) {
        const result = await client.query(
            `INSERT INTO tk_product_prices (product_id, unit_price, created_by_employee_id, created_by_telegram_id)
             VALUES ($1, $2, $3, $4)
             RETURNING id, unit_price, created_at`,
            [productId, unitPrice, employeeId || null, telegramId ? String(telegramId) : null]
        );
        return result.rows[0];
    }

    /* ---------- Vá giá cho đơn cũ đang thiếu ---------- */

    /**
     * Các đơn ĐÃ DUYỆT có dòng hàng của đúng sản phẩm này mà chưa có giá —
     * gộp theo order_id để biết cần tính lại tổng tiền cho những đơn nào.
     */
    async function findOrdersMissingPriceForProduct(client, productId) {
        const result = await client.query(
            `SELECT DISTINCT os.order_id
             FROM tk_warehouse_order_items oi
             JOIN tk_warehouse_order_services os ON os.id = oi.order_service_id
             JOIN tk_warehouse_orders o ON o.id = os.order_id
             WHERE oi.product_id = $1
               AND oi.is_removed = FALSE
               AND oi.unit_price_snapshot IS NULL
               AND o.status IN ('APPROVED', 'REVERSED')`,
            [productId]
        );
        return result.rows.map(row => row.order_id);
    }

    /** Gán giá vừa nhập vào mọi dòng hàng đang NULL của đúng sản phẩm này, trong 1 đơn. */
    async function patchOrderItemsPrice(client, orderId, productId, unitPrice) {
        await client.query(
            `UPDATE tk_warehouse_order_items oi
             SET unit_price_snapshot = $3
             FROM tk_warehouse_order_services os
             WHERE oi.order_service_id = os.id
               AND os.order_id = $1
               AND oi.product_id = $2
               AND oi.is_removed = FALSE
               AND oi.unit_price_snapshot IS NULL`,
            [orderId, productId, unitPrice]
        );
    }

    /** Snapshot giá lúc duyệt đơn — dùng bởi approve-order.js. NULL nếu chưa có giá. */
    async function snapshotPriceForApproval(client, productId) {
        const result = await client.query(
            `SELECT unit_price FROM tk_product_prices
             WHERE product_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [productId]
        );
        return result.rows[0]?.unit_price ?? null;
    }

    async function setOrderItemPriceSnapshot(client, itemId, unitPrice) {
        await client.query(
            `UPDATE tk_warehouse_order_items SET unit_price_snapshot = $2 WHERE id = $1`,
            [itemId, unitPrice]
        );
    }

    /**
     * Tính lại tổng tiền + cờ thiếu giá của một đơn. `unit_price_snapshot` lưu
     * theo đơn vị đóng gói (vd Lọ) nên phải quy đổi về giá/đơn vị cơ sở (vd ml)
     * bằng `calculateBasePrice` (domain) rồi mới nhân với actual_quantity (ml)
     * — quy đổi CHỈ xảy ra ở đây, một chỗ duy nhất trong toàn bộ tính năng.
     */
    async function recomputeOrderTotal(client, orderId) {
        const result = await client.query(
            `SELECT oi.unit_price_snapshot, oi.actual_quantity, p.conversion_rate
             FROM tk_warehouse_order_items oi
             JOIN tk_warehouse_order_services os ON os.id = oi.order_service_id
             JOIN tk_products p ON p.id = oi.product_id
             WHERE os.order_id = $1 AND oi.is_removed = FALSE`,
            [orderId]
        );

        let totalAmount = 0;
        let hasMissingPrice = false;
        for (const row of result.rows) {
            if (row.unit_price_snapshot === null) {
                hasMissingPrice = true;
                continue;
            }
            totalAmount += Number(row.actual_quantity) * calculateBasePrice(row.unit_price_snapshot, row.conversion_rate);
        }
        totalAmount = Math.round(totalAmount * 100) / 100;

        await client.query(
            `UPDATE tk_warehouse_orders SET total_amount = $2, has_missing_price = $3, updated_at = NOW() WHERE id = $1`,
            [orderId, totalAmount, hasMissingPrice]
        );
        return { totalAmount, hasMissingPrice };
    }

    /** Thông tin gọn của 1 đơn để ghi dòng "Tổng giá đơn xuất" — đọc SAU khi đã tính lại tổng. */
    async function findOrderSummary(db, orderId) {
        const result = await db.query(
            `SELECT order_code, group_id, branch, approved_at, total_amount, has_missing_price
             FROM tk_warehouse_orders WHERE id = $1`,
            [orderId]
        );
        return result.rows[0] || null;
    }

    /** Danh sách đơn đã duyệt kèm tổng tiền — dùng cho màn "Tổng tiền các đơn" của Mini App. */
    async function listOrderTotals(groupId, { limit = 100 } = {}) {
        const result = await pool.query(
            `SELECT o.id, o.order_code, o.branch, o.status, o.approved_at, o.total_amount, o.has_missing_price,
                    COALESCE(e.full_name, 'Không rõ') AS created_by_name
             FROM tk_warehouse_orders o
             LEFT JOIN employees e ON e.id = o.created_by
             WHERE o.group_id = $1
               AND o.status IN ('APPROVED', 'REVERSED')
             ORDER BY o.approved_at DESC NULLS LAST
             LIMIT $2`,
            [groupId, limit]
        );
        return result.rows;
    }

    return {
        searchProductsWithPrice,
        listAllProductsWithPrice,
        findOrderSummary,
        findProductById,
        findPriceHistory,
        insertPrice,
        findOrdersMissingPriceForProduct,
        patchOrderItemsPrice,
        snapshotPriceForApproval,
        setOrderItemPriceSnapshot,
        recomputeOrderTotal,
        listOrderTotals
    };
}
