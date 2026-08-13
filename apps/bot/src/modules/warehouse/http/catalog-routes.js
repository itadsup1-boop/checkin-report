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

    // Đề xuất mã vạch mới chưa ai dùng, cho trường hợp nhân sự nhập tay sản phẩm mới.
    //
    // Đây chỉ là GỢI Ý để đỡ phải tự nghĩ mã và giảm khả năng trùng. Nhân sự vẫn
    // sửa được thành mã mong muốn, và dù chọn mã nào thì lúc lưu vẫn bị kiểm tra
    // lại ở tầng database (xem import-routes.js) để chặn trường hợp hai cơ sở
    // cùng lúc nhận cùng một mã đề xuất rồi cùng lưu.
    botApp.get('/api/warehouse/next-barcode', authenticateTelegramMiniApp, async (req, res) => {
        try {
            if (!await requireWarehouseGroup(req, res)) return;
            const result = await pool.query('SELECT barcode FROM tk_products');

            // Coi '1', '01', '001' là cùng một mã: Google Sheet hay cắt số 0 đầu nên
            // nhân sự có thể đã nhập lẫn lộn các dạng này.
            const used = new Set();
            for (const row of result.rows) {
                const barcode = String(row.barcode || '').trim();
                if (!barcode) continue;
                used.add(barcode);
                if (/^\d+$/.test(barcode)) used.add(String(Number(barcode)));
            }

            let next = 1;
            while (used.has(String(next)) || used.has(String(next).padStart(3, '0'))) {
                next += 1;
            }

            res.json({ success: true, barcode: String(next).padStart(3, '0') });
        } catch (e) {
            console.error('Lỗi đề xuất mã vạch mới:', e);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đề xuất mã vạch' });
        }
    });

    // Tồn kho tách theo từng cơ sở cho TOÀN BỘ danh mục trong một lần gọi.
    // Mini App xuất kho cần dữ liệu này để hiển thị danh sách kèm tồn thực tế;
    // `/api/warehouse/inventory` cũ trả về một dòng mỗi branch nên không dùng được.
    botApp.get('/api/warehouse/stock-overview', authenticateTelegramMiniApp, async (req, res) => {
        try {
            if (!await requireWarehouseGroup(req, res)) return;
            const result = await pool.query(
                `SELECT p.id AS product_id,
                        p.barcode,
                        p.product_name,
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'US'), 0)::int AS stock_us,
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'UK'), 0)::int AS stock_uk,
                        MAX(i.updated_at) AS updated_at
                 FROM tk_products p
                 LEFT JOIN tk_inventory i ON i.product_id = p.id
                 WHERE p.is_active = TRUE
                 GROUP BY p.id, p.barcode, p.product_name
                 ORDER BY p.product_name`
            );
            res.json({ success: true, products: result.rows });
        } catch (e) {
            console.error('Lỗi get stock overview API:', e);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy tồn kho theo cơ sở' });
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
