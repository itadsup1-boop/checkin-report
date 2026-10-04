import { createExportOrderEditRepository } from './export-order-edit-repository.js';
import { createImportOrderEditRepository } from './import-order-edit-repository.js';

/**
 * Kho dữ liệu hỗ trợ chỉnh sửa đơn xuất kho và nhập kho trong vòng 24h.
 * Tách biệt logic xuất và nhập để đảm bảo tính module và không vượt quá 300 dòng.
 */
export function createOrderEditRepository(pool) {
    const exportRepo = createExportOrderEditRepository(pool);
    const importRepo = createImportOrderEditRepository(pool);

    return {
        ...exportRepo,
        ...importRepo
    };
}
