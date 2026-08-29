import { hasPricingAccess } from '../../domain/pricing-access.js';

/**
 * `current_price` từ repository đã đúng là giá theo đơn vị đóng gói (vd Lọ) —
 * DB lưu thẳng giá nhân viên nhập, không cần quy đổi gì khi hiển thị. Chỉ cần
 * gắn thêm nhãn đơn vị để Mini App biết ghi "theo Lọ" hay "theo chiếc".
 */
function withPriceUnit(row) {
    return { ...row, price_unit: row.import_unit || row.base_unit || 'đơn vị' };
}

/**
 * Mini App "Đơn giá sản phẩm" — vào được nếu là Admin hệ thống, được cấp
 * quyền MANAGE_PRICING/VIEW_PRICING theo nhóm, HOẶC nhãn vai trò
 * (`employees.role`) là "Kế toán" (xem domain/pricing-access.js).
 */
export function registerWarehousePricingRoutes({
    botApp,
    authenticateTelegramMiniApp,
    warehouseOrderService,
    pricingRepo,
    setProductPrice
}) {
    async function requireActor(req, res, requiredPermission) {
        const requiredPermissions = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
        const chatId = req.query.chat_id || req.body?.chat_id;
        if (!chatId) {
            res.status(400).json({ success: false, message: 'Thiếu thông tin ID nhóm.' });
            return null;
        }
        try {
            const actorContext = await warehouseOrderService.authorizeActor({
                telegramId: req.verifiedTelegramId,
                chatId
            });
            if (!requiredPermissions.some(permission => hasPricingAccess(actorContext, permission))) {
                res.status(403).json({
                    success: false,
                    code: `${requiredPermissions[0]}_REQUIRED`,
                    message: 'Chức năng này chỉ dành cho Admin hoặc kế toán có quyền quản lý đơn giá.'
                });
                return null;
            }
            return actorContext;
        } catch (error) {
            res.status(error.status || 403).json({ success: false, message: error.message });
            return null;
        }
    }

    /** Mini App gọi lúc khởi động để biết có nên hiện mục này hay chặn lại. */
    botApp.get('/api/warehouse/pricing/access', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const chatId = req.query.chat_id;
            if (!chatId) return res.status(400).json({ success: false, message: 'Thiếu thông tin ID nhóm.' });
            const actorContext = await warehouseOrderService.authorizeActor({
                telegramId: req.verifiedTelegramId,
                chatId
            });
            res.json({
                success: true,
                full_name: actorContext.employee?.full_name || 'Admin',
                role: actorContext.isAdmin ? 'Admin hệ thống' : (actorContext.employee?.role || 'Nhân viên'),
                group_name: actorContext.group.group_name || null,
                can_manage: hasPricingAccess(actorContext, 'MANAGE_PRICING'),
                can_view: hasPricingAccess(actorContext, 'VIEW_PRICING')
            });
        } catch (error) {
            res.status(error.status || 403).json({ success: false, message: error.message });
        }
    });

    botApp.get('/api/warehouse/pricing/search', authenticateTelegramMiniApp, async (req, res) => {
        try {
            if (!await requireActor(req, res, 'MANAGE_PRICING')) return;
            const products = await pricingRepo.searchProductsWithPrice(req.query.q || '');
            res.json({ success: true, products: products.map(withPriceUnit) });
        } catch (error) {
            console.error('Lỗi tìm sản phẩm để nhập giá:', error);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tìm sản phẩm.' });
        }
    });

    botApp.get('/api/warehouse/pricing/products', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const actorContext = await requireActor(req, res, ['VIEW_PRICING', 'MANAGE_PRICING']);
            if (!actorContext) return;
            const products = await pricingRepo.listAllProductsWithPrice();
            res.json({ success: true, products: products.map(withPriceUnit) });
        } catch (error) {
            console.error('Lỗi lấy danh sách giá sản phẩm:', error);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách giá sản phẩm.' });
        }
    });

    botApp.get('/api/warehouse/pricing/history', authenticateTelegramMiniApp, async (req, res) => {
        try {
            if (!await requireActor(req, res, 'MANAGE_PRICING')) return;
            const productId = String(req.query.product_id || '').trim();
            if (!productId) return res.status(400).json({ success: false, message: 'Thiếu mã sản phẩm.' });
            const history = await pricingRepo.findPriceHistory(productId);
            res.json({ success: true, history });
        } catch (error) {
            console.error('Lỗi lấy lịch sử giá:', error);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy lịch sử giá.' });
        }
    });

    botApp.get('/api/warehouse/pricing/orders', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const actorContext = await requireActor(req, res, ['VIEW_PRICING', 'MANAGE_PRICING']);
            if (!actorContext) return;
            const orders = await pricingRepo.listOrderTotals(actorContext.group.id);
            res.json({ success: true, orders });
        } catch (error) {
            console.error('Lỗi lấy danh sách tổng tiền đơn xuất:', error);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách đơn xuất.' });
        }
    });

    botApp.post('/api/warehouse/pricing/save', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const actorContext = await requireActor(req, res, 'MANAGE_PRICING');
            if (!actorContext) return;

            const { product_id, unit_price } = req.body;
            if (!product_id || unit_price === undefined || unit_price === null) {
                return res.status(400).json({ success: false, message: 'Thiếu sản phẩm hoặc đơn giá.' });
            }

            const result = await setProductPrice({ productId: product_id, unitPrice: unit_price, actorContext });
            res.json({ success: true, ...result });
        } catch (error) {
            const status = error.status || 500;
            if (status >= 500) console.error('Lỗi lưu đơn giá:', error);
            res.status(status).json({ success: false, message: error.message || 'Lỗi máy chủ khi lưu đơn giá.' });
        }
    });

    /**
     * Lưu nhiều đơn giá trong một lần gửi (kế toán sửa nhiều sản phẩm rồi gửi chung).
     * Mỗi sản phẩm được lưu độc lập bằng use case setProductPrice hiện có — một
     * sản phẩm lỗi không chặn các sản phẩm còn lại, kết quả trả về từng dòng.
     */
    botApp.post('/api/warehouse/pricing/save-batch', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const actorContext = await requireActor(req, res, 'MANAGE_PRICING');
            if (!actorContext) return;

            const items = Array.isArray(req.body?.items) ? req.body.items : [];
            if (!items.length) {
                return res.status(400).json({ success: false, message: 'Danh sách đơn giá trống.' });
            }

            const results = [];
            for (const item of items) {
                try {
                    const result = await setProductPrice({
                        productId: item.product_id,
                        unitPrice: item.unit_price,
                        actorContext
                    });
                    results.push({ productId: item.product_id, success: true, ...result });
                } catch (error) {
                    results.push({
                        productId: item.product_id,
                        success: false,
                        message: error.message || 'Lỗi khi lưu đơn giá.'
                    });
                }
            }

            res.json({ success: true, results });
        } catch (error) {
            console.error('Lỗi lưu nhiều đơn giá:', error);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lưu nhiều đơn giá.' });
        }
    });
}
