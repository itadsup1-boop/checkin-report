import { registerSingleWarehouseOrderActions } from './register-single-order-actions.js';
import { registerGroupedWarehouseOrderActions } from './register-group-order-actions.js';
import { registerWarehouseProofHandler } from './register-proof-handler.js';
import { registerWarehouseServiceOrderActions } from './register-service-order-actions.js';

/**
 * Composition root cho callback và message handler Telegram của module kho.
 */
export function registerWarehouseTelegramHandlers(dependencies) {
    registerSingleWarehouseOrderActions(dependencies);
    registerGroupedWarehouseOrderActions(dependencies);
    registerWarehouseProofHandler(dependencies);
    registerWarehouseServiceOrderActions(dependencies);
}
