/**
 * Chạy một khối lệnh trong transaction.
 *
 * Trước đây sáu use case đều lặp lại y hệt khối
 * connect / BEGIN / COMMIT / ROLLBACK / release. Quên `release()` một lần là rò
 * rỉ connection pool và cả hệ thống treo, nên gom về một chỗ.
 *
 * LƯU Ý QUAN TRỌNG: chỉ đọc/ghi trong transaction bằng `client` được truyền vào.
 * Việc đọc lại đơn để trả về cho người dùng phải làm SAU khi hàm này kết thúc,
 * vì repository đọc qua pool (kết nối khác) nên trước lúc COMMIT sẽ không nhìn
 * thấy dữ liệu vừa ghi.
 */

export function createTransactionRunner(pool) {
    return async function withTransaction(work) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    };
}
