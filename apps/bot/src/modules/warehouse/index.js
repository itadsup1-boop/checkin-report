import { registerWarehouseHttpRoutes } from './http/register-warehouse-routes.js';
import { createWarehouseImageReceiver } from './http/warehouse-image-upload.js';
import { createWarehouseSheetSync } from './integrations/google-sheets.js';
import { createServiceOrderSheetSync } from './integrations/service-order-sheet-sync.js';
import { startWarehouseOutboxWorker } from './integrations/outbox-worker.js';
import { registerWarehouseTelegramHandlers } from './telegram/register-warehouse-handlers.js';
import { createWarehouseOrderService } from '../../../../../packages/warehouse/index.js';

/**
 * Public entry point duy nhất của module kho trong Telegram Bot.
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
    const warehouseOrderService = createWarehouseOrderService({
        pool,
        adminIds: process.env.ADMIN_IDS
    });
    const receiveWarehouseImages = dependencies.receiveWarehouseImages
        || createWarehouseImageReceiver({
            uploadDir: dependencies.warehouseTempUploadDir
        });

    registerWarehouseHttpRoutes({
        ...dependencies,
        receiveWarehouseImages,
        warehouseOrderService,
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
