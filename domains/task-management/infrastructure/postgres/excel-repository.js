// Chạm DB duy nhất của luồng Excel: ghi lịch sử sync (mục 27.1 — lưu checksum
// file, người thực hiện, đếm dòng OK/lỗi/conflict). Bảng nhiệm vụ/form truy
// cập qua task-repository/form-repository có sẵn.

export function createExcelRepository({ pool }) {
    return {
        async logExcelSync({ entity, mode, fileName = null, fileChecksum, rowsTotal = 0, rowsOk = 0, rowsError = 0, rowsConflict = 0, mapping = null, rowErrors = null, createdBy }) {
            const result = await pool.query(
                `INSERT INTO ai_management.excel_sync_logs
                    (entity, mode, file_name, file_checksum, rows_total, rows_ok, rows_error, rows_conflict, mapping, row_errors, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING id`,
                [entity, mode, fileName, fileChecksum, rowsTotal, rowsOk, rowsError, rowsConflict,
                 mapping ? JSON.stringify(mapping) : null,
                 rowErrors ? JSON.stringify(rowErrors) : null,
                 String(createdBy)]
            );
            return result.rows[0].id;
        },

        async listSyncLogsByCreator(createdBy, limit = 10) {
            const result = await pool.query(
                `SELECT id, entity, mode, file_name, file_checksum, rows_total,
                        rows_ok, rows_error, rows_conflict, created_at
                 FROM ai_management.excel_sync_logs
                 WHERE created_by = $1
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [String(createdBy), limit]
            );
            return result.rows;
        }
    };
}
