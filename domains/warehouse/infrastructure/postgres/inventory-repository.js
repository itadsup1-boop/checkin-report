/**
 * Truy vấn tồn kho (bảng tk_inventory).
 *
 * Mọi câu SQL đụng tới tồn kho nằm ở đây, không rải trong tầng application.
 * Các hàm nhận `db` là client của transaction đang mở — trừ tồn phải nằm trong
 * cùng transaction với việc ghi sổ ledger, nếu không sổ sẽ lệch với tồn thực.
 */

export function createInventoryRepository(pool) {
    /**
     * Bảo đảm sản phẩm có đủ dòng tồn ở cả hai cơ sở trước khi tính toán.
     * Thiếu dòng thì phép trừ tồn sau đó sẽ không khớp số dòng và bị coi là lỗi.
     */
    async function ensureBranchRows(db, productId) {
        await db.query(
            `INSERT INTO tk_inventory (product_id, branch, quantity, updated_at)
             VALUES ($1, 'US', 0, NOW()), ($1, 'UK', 0, NOW())
             ON CONFLICT (product_id, branch) DO NOTHING`,
            [productId]
        );
    }

    /**
     * Đọc tồn của nhiều sản phẩm kèm tên và mã vạch.
     * @param {boolean} lock true thì khóa dòng tồn (FOR UPDATE) để chống hai
     *        người duyệt cùng lúc trừ trùng số lượng.
     */
    async function listStocks(db, productIds, { lock = false } = {}) {
        const result = await db.query(
            `SELECT i.product_id, i.branch, i.quantity, p.product_name, p.barcode
             FROM tk_inventory i
             JOIN tk_products p ON p.id = i.product_id
             WHERE i.product_id = ANY($1::uuid[])
             ORDER BY i.product_id, i.branch
             ${lock ? 'FOR UPDATE OF i' : ''}`,
            [productIds]
        );
        return result.rows;
    }

    /**
     * Trừ tồn có điều kiện `quantity >= số cần trừ`.
     * @returns {Promise<boolean>} false nghĩa là tồn vừa bị người khác thay đổi.
     */
    async function deduct(db, productId, branch, quantity) {
        const result = await db.query(
            `UPDATE tk_inventory
             SET quantity = quantity - $3, updated_at = NOW()
             WHERE product_id = $1 AND branch = $2 AND quantity >= $3`,
            [productId, branch, quantity]
        );
        return result.rowCount === 1;
    }

    /** Đọc và khóa đúng một dòng tồn, dùng khi hoàn tác đơn. */
    async function getForUpdate(db, productId, branch) {
        const result = await db.query(
            `SELECT quantity
             FROM tk_inventory
             WHERE product_id = $1 AND branch = $2
             FOR UPDATE`,
            [productId, branch]
        );
        return result.rows[0] || null;
    }

    /** Đặt lại tồn về một số cụ thể (dùng khi hoàn tác, đã tính sẵn số cuối). */
    async function setQuantity(db, productId, branch, quantity) {
        await db.query(
            `UPDATE tk_inventory
             SET quantity = $3, updated_at = NOW()
             WHERE product_id = $1 AND branch = $2`,
            [productId, branch, quantity]
        );
    }

    return {
        ensureBranchRows,
        listStocks,
        deduct,
        getForUpdate,
        setQuantity
    };
}
