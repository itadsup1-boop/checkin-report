/**
 * Cửa vào HTTP dành cho Web Admin của domain kho.
 *
 * Trước đây toàn bộ 20 route nằm trong một file 777 dòng ở
 * apps/api/src/modules/warehouse-admin/. Nay chia theo nhóm nghiệp vụ và
 * chuyển vào trong domain để Web Admin và Telegram Bot dùng chung một lõi.
 *
 * Thứ tự đăng ký đã đổi so với bản cũ (gom theo nhóm). Việc này an toàn vì
 * không có cặp route nào che khuất nhau — đã kiểm chứng bằng đối chiếu từng
 * cặp cùng method, cùng số đoạn đường dẫn.
 */

import { createWarehouseOrderService } from '../../application/warehouse-order-service.js';
import { createAdminContext } from './admin-context.js';
import { registerServiceRoutes } from './routes/service-routes.js';
import { registerProductRoutes } from './routes/product-routes.js';
import { registerPermissionRoutes } from './routes/permission-routes.js';
import { registerOrderRoutes } from './routes/order-routes.js';
import { registerOpsRoutes } from './routes/ops-routes.js';

export function registerWarehouseAdminRoutes({ app, pool }) {
    const warehouseOrderService = createWarehouseOrderService({ pool });
    const { getContext, requireWarehouseGroup, requireWarehouseCatalogAccess } =
        createAdminContext({ pool });

    const deps = {
        app,
        pool,
        warehouseOrderService,
        getContext,
        requireWarehouseGroup,
        requireWarehouseCatalogAccess
    };

    registerServiceRoutes(deps);
    registerProductRoutes(deps);
    registerPermissionRoutes(deps);
    registerOrderRoutes(deps);
    registerOpsRoutes(deps);
}
