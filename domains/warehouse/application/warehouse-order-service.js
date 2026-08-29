/**
 * Composition root của tầng application: lắp repository vào các use case.
 *
 * File này CHỈ nối dây, không chứa nghiệp vụ. Muốn hiểu một thao tác thì mở
 * thẳng file use case tương ứng:
 *
 *   create-customer-order.js   tạo đơn theo khách
 *   approve-order.js           duyệt đơn (trừ tồn, ghi sổ, điều chuyển)
 *   reject-order.js            từ chối đơn
 *   rollback-order.js          hoàn tác đơn đã duyệt
 *   suggest-customer.js        gợi ý khách cũ theo số điện thoại
 *
 * Phần dùng chung nằm trong _shared/: ngữ cảnh người thao tác, tính đủ/thiếu
 * hàng, chụp ảnh danh mục, chạy transaction, sinh mã.
 *
 * API công khai giữ nguyên như trước khi tách, để interfaces/ không phải sửa.
 */

import { createWarehouseQueryRepository } from '../infrastructure/postgres/warehouse-query-repository.js';
import { createInventoryRepository } from '../infrastructure/postgres/inventory-repository.js';
import { createLedgerRepository } from '../infrastructure/postgres/ledger-repository.js';
import { createTransferRepository } from '../infrastructure/postgres/transfer-repository.js';
import { createOutboxRepository } from '../infrastructure/postgres/outbox-repository.js';
import { createOrderRepository } from '../infrastructure/postgres/order-repository.js';
import { createCatalogRepository } from '../infrastructure/postgres/catalog-repository.js';
import { createPricingRepository } from '../infrastructure/postgres/pricing-repository.js';
import { createReceiptRepository } from '../infrastructure/postgres/receipt-repository.js';

import { createTransactionRunner } from './_shared/with-transaction.js';
import { createActorContextResolver } from './_shared/actor-context.js';
import { createAvailabilityService } from './_shared/availability.js';
import { createOrderGraphBuilder } from './_shared/order-graph.js';

import { createApproveOrderUseCase } from './approve-order.js';
import { createCreateCustomerOrderUseCase } from './create-customer-order.js';
import { createRejectOrderUseCase } from './reject-order.js';
import { createRollbackOrderUseCase } from './rollback-order.js';
import { createSuggestCustomerUseCase } from './suggest-customer.js';
import { createCreateStockTransferUseCase } from './create-stock-transfer.js';
import { createStockReceiptUseCase } from './create-stock-receipt.js';

export function createWarehouseOrderService({ pool, adminIds = [] }) {
    // Tầng hạ tầng: nơi duy nhất được viết SQL.
    const repository = createWarehouseQueryRepository(pool);
    const inventoryRepo = createInventoryRepository(pool);
    const ledgerRepo = createLedgerRepository(pool);
    const transferRepo = createTransferRepository(pool);
    const outboxRepo = createOutboxRepository(pool);
    const orderRepo = createOrderRepository(pool);
    const catalogRepo = createCatalogRepository(pool);
    const pricingRepo = createPricingRepository(pool);
    const receiptRepo = createReceiptRepository();

    // Phần dùng chung giữa các use case.
    const withTransaction = createTransactionRunner(pool);
    const actorContext = createActorContextResolver({ pool, repository, adminIds });
    const availability = createAvailabilityService({ inventoryRepo });
    const orderGraph = createOrderGraphBuilder({ catalogRepo });

    const chung = {
        repository, orderRepo, inventoryRepo, ledgerRepo, transferRepo, outboxRepo, pricingRepo,
        availability, actorContext, withTransaction
    };

    // Duyệt đơn phải dựng trước, vì tạo đơn có thể tự duyệt luôn khi người tạo
    // đã có quyền.
    const { approveLockedOrder, approveOrder, approveOrderAsAdmin } =
        createApproveOrderUseCase(chung);

    const { createOrder } = createCreateCustomerOrderUseCase({
        ...chung,
        orderGraph,
        approveLockedOrder
    });
    const { rejectOrder, rejectOrderAsAdmin } = createRejectOrderUseCase(chung);
    const { reverseOrder } = createRollbackOrderUseCase(chung);
    const { suggestCustomer } = createSuggestCustomerUseCase({ pool, catalogRepo });
    const { createStockTransfer } = createCreateStockTransferUseCase({ ...chung, catalogRepo });
    const { importProductsAsAdmin } = createStockReceiptUseCase({
        ...chung,
        catalogRepo,
        receiptRepo
    });

    return {
        repository,
        createOrder,
        approveOrder,
        rejectOrder,
        approveOrderAsAdmin,
        rejectOrderAsAdmin,
        reverseOrder,
        suggestCustomer,
        createStockTransfer,
        importProductsAsAdmin,
        authorizeActor: actorContext.authorizeActor
    };
}
