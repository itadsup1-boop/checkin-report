/**
 * Danh mục dịch vụ, sản phẩm và mẫu sản phẩm theo dịch vụ
 * (tk_warehouse_services, tk_warehouse_service_products, tk_products).
 *
 * Dùng lúc tạo đơn để chụp lại tên và mã vạch tại thời điểm đó — sau này Admin
 * đổi tên sản phẩm thì đơn cũ vẫn giữ nguyên tên lúc bán, không bị đổi theo.
 */

export function createCatalogRepository(pool) {
    /** Các dịch vụ đang bật, dùng để kiểm tra đơn không chứa dịch vụ đã ẩn. */
    async function listActiveServices(db, serviceIds) {
        const result = await db.query(
            `SELECT id, service_code, service_name
             FROM tk_warehouse_services
             WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
            [serviceIds]
        );
        return result.rows;
    }

    /** Các sản phẩm đang bật. */
    async function listActiveProducts(db, productIds) {
        const result = await db.query(
            `SELECT id, barcode, product_name, quantity_mode
             FROM tk_products
             WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
            [productIds]
        );
        return result.rows;
    }

    /**
     * Mẫu sản phẩm của các dịch vụ, để biết dòng nào là "theo mẫu" và dòng nào
     * do nhân viên tự thêm.
     */
    async function listTemplateItems(db, serviceIds, productIds) {
        const result = await db.query(
            `SELECT service_id, product_id, default_quantity
             FROM tk_warehouse_service_products
             WHERE service_id = ANY($1::uuid[])
               AND product_id = ANY($2::uuid[])
               AND is_active = TRUE`,
            [serviceIds, productIds]
        );
        return result.rows;
    }

    /** Khách đã từng mua theo số điện thoại, để gợi ý điền sẵn tên. */
    async function findLatestCustomerByPhone(db, phone) {
        const result = await db.query(
            `SELECT customer_name, customer_phone, created_at
             FROM tk_warehouse_orders
             WHERE customer_phone = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [phone]
        );
        return result.rows[0] || null;
    }

    return {
        listActiveServices,
        listActiveProducts,
        listTemplateItems,
        findLatestCustomerByPhone
    };
}
