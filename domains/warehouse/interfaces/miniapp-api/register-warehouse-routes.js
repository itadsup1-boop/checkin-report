import { registerWarehouseCatalogRoutes } from './catalog-routes.js';
import { registerWarehouseImportRoutes } from './import-routes.js';
import { registerWarehouseExportRoutes } from './export-routes.js';
import { registerWarehouseServiceOrderRoutes } from './service-order-routes.js';
import { registerWarehouseStockTransferRoutes } from './stock-transfer-routes.js';
import { registerWarehousePricingRoutes } from './pricing-routes.js';

/**
 * Composition root cho toàn bộ HTTP adapter của module kho.
 */
export function registerWarehouseHttpRoutes(dependencies) {
    registerWarehouseCatalogRoutes(dependencies);
    registerWarehouseImportRoutes(dependencies);
    registerWarehouseExportRoutes(dependencies);
    registerWarehouseServiceOrderRoutes(dependencies);
    registerWarehouseStockTransferRoutes(dependencies);
    registerWarehousePricingRoutes(dependencies);
}
