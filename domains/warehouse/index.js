import { registerWarehouseHttpRoutes } from './interfaces/miniapp-api/register-warehouse-routes.js';
import { createWarehouseImageReceiver } from './interfaces/miniapp-api/warehouse-image-upload.js';
import { createWarehouseSheetSync } from './infrastructure/google-sheet/google-sheets.js';
import { createServiceOrderSheetSync } from './infrastructure/google-sheet/service-order-sheet-sync.js';
import { createPricingSheetSync } from './infrastructure/google-sheet/pricing-sheet-sync.js';
import { startWarehouseOutboxWorker } from './infrastructure/outbox/outbox-worker.js';
import { registerWarehouseTelegramHandlers } from './interfaces/telegram/register-warehouse-handlers.js';
import { createWarehouseOrderService } from './application/warehouse-order-service.js';
import { createSetProductPriceUseCase } from './application/set-product-price.js';
import { createPricingRepository } from './infrastructure/postgres/pricing-repository.js';
import { createTransactionRunner } from './application/_shared/with-transaction.js';
import { createOrderEditRepository } from './infrastructure/postgres/order-edit-repository.js';
import { createGetOrderEditDetailUseCase } from './application/get-order-edit-detail.js';
import { createEditCustomerOrderUseCase } from './application/edit-customer-order.js';
import { createEditWarehouseImportUseCase } from './application/edit-warehouse-import.js';

/**
 * Cổng vào công khai DUY NHẤT của domain kho.
 *
 * Các app bên ngoài (apps/bot, apps/api) chỉ được import từ file này, tuyệt đối
 * không với tay vào file bên trong domain/, application/, infrastructure/ hay
 * interfaces/ — quy tắc này được test tự động kiểm tra.
 *
 * Domain có hai cửa vào, mỗi app lắp cửa nó cần:
 *   - registerWarehouseModule      -> Telegram Bot (callback duyệt + API Mini App)
 *   - registerWarehouseAdminRoutes -> Web Admin (quản lý dịch vụ, quyền, đơn, sổ kho)
 * Cả hai dùng chung application/ và infrastructure/ bên dưới.
 */

// Cửa vào cho Web Admin.
export { registerWarehouseAdminRoutes } from './interfaces/admin-api/index.js';

// Nguyên thủy của tầng domain, cho phép app và các domain khác dùng lại.
export {
    WAREHOUSE_BRANCHES,
    WAREHOUSE_ORDER_STATUSES,
    WAREHOUSE_PERMISSIONS,
    WarehouseError
} from './domain/constants.js';
export {
    aggregateOrderItems,
    validateOrderInput
} from './domain/order-validation.js';
export {
    MAX_QUANTITY_DECIMALS,
    QUANTITY_MODES,
    normalizeQuantityMode,
    parseQuantity,
    quantityModeLabel,
    roundQuantity
} from './domain/quantity-rules.js';
export {
    LOW_STOCK_THRESHOLD,
    filterLowStockItems,
    buildLowStockWarningMessage
} from './domain/low-stock-alert.js';
export { validateStockReceiptInput } from './domain/stock-receipt-rules.js';
export { createWarehouseOrderService } from './application/warehouse-order-service.js';
export { createWarehouseQueryRepository } from './infrastructure/postgres/warehouse-query-repository.js';
export { createOrderEditRepository } from './infrastructure/postgres/order-edit-repository.js';
export { createGetOrderEditDetailUseCase } from './application/get-order-edit-detail.js';
export { createEditCustomerOrderUseCase } from './application/edit-customer-order.js';
export { createEditWarehouseImportUseCase } from './application/edit-warehouse-import.js';

/**
 * Lắp toàn bộ phần kho vào Telegram Bot: route Mini App, callback duyệt đơn,
 * đồng bộ Google Sheet và tiến trình nền outbox.
 */
export function registerWarehouseModule(dependencies) {
    const {
        pool,
        moment,
        getDocById
    } = dependencies;

    const sheetSync = createWarehouseSheetSync({
        pool,
        moment,
        getDocById
    });
    const serviceOrderSheetSync = createServiceOrderSheetSync({
        pool,
        moment,
        getDocById
    });
    const pricingSheetSync = createPricingSheetSync({
        pool,
        moment,
        getDocById
    });
    const warehouseOrderService = createWarehouseOrderService({
        pool,
        adminIds: process.env.ADMIN_IDS
    });
    const pricingRepo = createPricingRepository(pool);
    const withTransaction = createTransactionRunner(pool);
    const setProductPrice = createSetProductPriceUseCase({
        pool,
        pricingRepo,
        withTransaction,
        sheetSync: pricingSheetSync
    }).setProductPrice;
    const orderEditRepo = createOrderEditRepository(pool);
    const getOrderEditDetail = createGetOrderEditDetailUseCase({
        orderEditRepo,
        warehouseOrderService
    });
    const editCustomerOrder = createEditCustomerOrderUseCase({
        orderEditRepo,
        warehouseOrderService,
        withTransaction
    });
    const editWarehouseImport = createEditWarehouseImportUseCase({
        orderEditRepo,
        warehouseOrderService,
        withTransaction
    });
    const receiveWarehouseImages = dependencies.receiveWarehouseImages
        || createWarehouseImageReceiver({
            uploadDir: dependencies.warehouseTempUploadDir
        });

    registerWarehouseHttpRoutes({
        ...dependencies,
        receiveWarehouseImages,
        warehouseOrderService,
        pricingRepo,
        setProductPrice,
        orderEditRepo,
        getOrderEditDetail,
        editCustomerOrder,
        editWarehouseImport,
        syncWarehouseSheets: sheetSync.syncWarehouseSheets
    });

    registerWarehouseTelegramHandlers({
        ...dependencies,
        warehouseOrderService,
        ...sheetSync
    });

    const outboxWorker = dependencies.enableBackgroundWorkers === false
        ? null
        : startWarehouseOutboxWorker({
            ...dependencies,
            warehouseOrderService,
            syncWarehouseOrder: serviceOrderSheetSync.syncWarehouseOrder,
            syncWarehouseSheets: sheetSync.syncWarehouseSheets
        });

    return Object.freeze({
        syncWarehouseSheets: sheetSync.syncWarehouseSheets,
        updateWarehouseSheetProof: sheetSync.updateWarehouseSheetProof,
        syncWarehouseOrder: serviceOrderSheetSync.syncWarehouseOrder,
        warehouseOrderService,
        stop: () => outboxWorker?.stop()
    });
}
