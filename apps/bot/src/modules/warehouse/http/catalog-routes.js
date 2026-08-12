export function registerWarehouseCatalogRoutes({
    botApp,
    pool,
    authenticateTelegramMiniApp,
    warehouseOrderService
}) {
    async function requireWarehouseGroup(req, res) {
        const chatId = req.query.chat_id || req.body?.chat_id;
        if (!chatId) {
            res.status(400).json({ success: false, message: 'Thiếu thông tin ID nhóm.' });
            return null;
        }
        try {
            const context = await warehouseOrderService.authorizeActor({
                telegramId: req.verifiedTelegramId,
                chatId
            });
            return context.group;
        } catch (error) {
            res.status(error.status || 403).json({ success: false, message: error.message });
            return null;
        }
    }

    botApp.get('/api/products/by-barcode/:barcode', authenticateTelegramMiniApp, async (req, res) => {
        try {
            if (!await requireWarehouseGroup(req, res)) return;
            const { barcode } = req.params;
            const productRes = await pool.query('SELECT * FROM tk_products WHERE barcode = $1 LIMIT 1', [barcode]);

            if (productRes.rows.length > 0) {
                const product = productRes.rows[0];

                const usRes = await pool.query('SELECT quantity FROM tk_inventory WHERE product_id = $1 AND branch = $2', [product.id, 'US']);
                const ukRes = await pool.query('SELECT quantity FROM tk_inventory WHERE product_id = $1 AND branch = $2', [product.id, 'UK']);
                const usQty = usRes.rows.length > 0 ? usRes.rows[0].quantity : 0;
                const ukQty = ukRes.rows.length > 0 ? ukRes.rows[0].quantity : 0;

                return res.json({
                    success: true,
                    exists: true,
                    product: {
                        id: product.id,
                        barcode: product.barcode,
                        product_name: product.product_name,
                        stock_us: usQty,
                        stock_uk: ukQty,
                        quantity: usQty + ukQty
                    }
                });
            }

            return res.json({ success: true, exists: false });
        } catch (e) {
            console.error('Lỗi check barcode API:', e);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tra cứu mã vạch' });
        }
    });

    botApp.get('/api/warehouse/products', authenticateTelegramMiniApp, async (req, res) => {
        try {
            if (!await requireWarehouseGroup(req, res)) return;
            const productsRes = await pool.query('SELECT id, barcode, product_name FROM tk_products ORDER BY product_name ASC');
            res.json({ success: true, products: productsRes.rows });
        } catch (e) {
            console.error('Lỗi get products list API:', e);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách sản phẩm' });
        }
    });

    botApp.get('/api/warehouse/inventory', authenticateTelegramMiniApp, async (req, res) => {
        try {
            if (!await requireWarehouseGroup(req, res)) return;
            const query = `
                SELECT p.id, p.barcode, p.product_name, COALESCE(i.quantity, 0) as quantity, i.updated_at
                FROM tk_products p
                LEFT JOIN tk_inventory i ON p.id = i.product_id
                ORDER BY p.product_name ASC
            `;
            const inventoryRes = await pool.query(query);
            res.json({ success: true, inventory: inventoryRes.rows });
        } catch (e) {
            console.error('Lỗi get inventory list API:', e);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy dữ liệu tồn kho' });
        }
    });

    botApp.get('/api/warehouse/check-stock', authenticateTelegramMiniApp, async (req, res) => {
        try {
            if (!await requireWarehouseGroup(req, res)) return;
            const { barcode } = req.query;
            if (!barcode) {
                return res.status(400).json({ success: false, message: 'Thiếu mã vạch!' });
            }

            const productRes = await pool.query('SELECT id FROM tk_products WHERE barcode = $1 LIMIT 1', [barcode]);
            if (productRes.rows.length === 0) {
                return res.json({ success: true, quantity: 0 });
            }

            const stockRes = await pool.query('SELECT quantity FROM tk_inventory WHERE product_id = $1', [productRes.rows[0].id]);
            const quantity = stockRes.rows.length > 0 ? stockRes.rows[0].quantity : 0;
            res.json({ success: true, quantity });
        } catch (e) {
            console.error('Lỗi check stock API:', e);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi kiểm tra tồn kho' });
        }
    });
}
