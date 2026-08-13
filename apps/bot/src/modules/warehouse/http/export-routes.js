import { randomUUID } from 'node:crypto';

export function registerWarehouseExportRoutes({
    botApp,
    bot,
    pool,
    authenticateTelegramMiniApp,
    escapeHtml,
    syncWarehouseSheets
}) {
    botApp.post('/api/warehouse/export/request', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const telegram_id = req.verifiedTelegramId;
            const { chat_id, items, branch: branchRaw } = req.body;
            const cleanBranch = (branchRaw || 'US').toUpperCase() === 'UK' ? 'UK' : 'US';

            if (!chat_id) {
                return res.status(400).json({ success: false, message: 'Thiếu thông tin ID nhóm!' });
            }
            if (!Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ success: false, message: 'Danh sách sản phẩm xuất kho trống!' });
            }

            // 1. Kiểm tra nhân viên
            const userRes = await pool.query(
                `SELECT * FROM employees
                 WHERE telegram_id = $1 AND is_active = TRUE
                 ORDER BY CASE WHEN telegram_group_id = $2 THEN 0 ELSE 1 END ASC, created_at ASC
                 LIMIT 1`,
                [telegram_id, String(chat_id)]
            );
            if (userRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Nhân sự chưa đăng ký tài khoản!' });
            }
            const user = userRes.rows[0];

            // 2. Kiểm tra nhóm
            const groupRes = await pool.query(
                `SELECT * FROM telegram_groups
                 WHERE telegram_group_id = $1 AND bot_role = 'warehouse'
                   AND is_active = TRUE AND COALESCE(is_deleted, FALSE) = FALSE
                 LIMIT 1`,
                [String(chat_id)]
            );
            if (groupRes.rows.length === 0) {
                return res.status(403).json({ success: false, message: 'Nhóm chưa được phân quyền Quản lý kho!' });
            }
            const group = groupRes.rows[0];

            const accessResult = await pool.query(
                `SELECT (
                    $2::text = $3::text
                    OR EXISTS (
                        SELECT 1 FROM employee_group_memberships m
                        WHERE m.employee_id = $1
                          AND m.telegram_group_id = $3
                          AND m.status = 'ACTIVE'
                    )
                    OR EXISTS (
                        SELECT 1 FROM tk_warehouse_permissions wp
                        WHERE wp.employee_id = $1
                          AND wp.telegram_group_id = $3
                          AND wp.is_active = TRUE
                    )
                ) AS allowed`,
                [user.id, user.telegram_group_id, String(chat_id)]
            );
            if (!accessResult.rows[0]?.allowed) {
                return res.status(403).json({ success: false, message: 'Bạn không phải thành viên của nhóm kho này.' });
            }

            // 3. Quyền duyệt kho được Admin cấp riêng theo group; không tin role tự chọn.
            const isAdminId = process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(telegram_id);
            const permissionResult = await pool.query(
                `SELECT permission_code
                 FROM tk_warehouse_permissions
                 WHERE employee_id = $1
                   AND telegram_group_id = $2
                   AND permission_code IN ('APPROVE_EXPORT', 'AUTO_APPROVE_OWN_ORDER', 'APPROVE_TRANSFER')
                   AND is_active = TRUE`,
                [user.id, String(chat_id)]
            );
            const permissionCodes = new Set(permissionResult.rows.map(row => row.permission_code));
            const canApproveOwn = isAdminId
                || permissionCodes.has('APPROVE_EXPORT')
                || permissionCodes.has('AUTO_APPROVE_OWN_ORDER');
            const canApproveTransfer = isAdminId || permissionCodes.has('APPROVE_TRANSFER');

            // Tạo một Request Group ID cho phiên xuất kho này
            const requestGroupId = randomUUID();

            const processedItems = [];
            const failedItems = [];

            // Kiểm tra tồn kho trước khi thực hiện bất kỳ giao dịch nào (Tránh lỗi trừ âm nửa chừng)
            for (const item of items) {
                const cleanBarcode = item.barcode.trim();
                const qtyNum = parseInt(item.quantity, 10);
                if (isNaN(qtyNum) || qtyNum <= 0) continue;

                const prodCheck = await pool.query('SELECT * FROM tk_products WHERE barcode = $1 LIMIT 1', [cleanBarcode]);
                if (prodCheck.rows.length === 0) {
                    failedItems.push({ barcode: cleanBarcode, reason: 'Sản phẩm không tồn tại trong kho' });
                    continue;
                }
                const product = prodCheck.rows[0];

                // Lấy tồn kho 2 cơ sở
                const usRes = await pool.query('SELECT quantity FROM tk_inventory WHERE product_id = $1 AND branch = $2', [product.id, 'US']);
                const ukRes = await pool.query('SELECT quantity FROM tk_inventory WHERE product_id = $1 AND branch = $2', [product.id, 'UK']);
                const usQty = usRes.rows.length > 0 ? usRes.rows[0].quantity : 0;
                const ukQty = ukRes.rows.length > 0 ? ukRes.rows[0].quantity : 0;
                const totalStock = usQty + ukQty;

                if (totalStock < qtyNum) {
                    failedItems.push({
                        product_name: product.product_name,
                        barcode: cleanBarcode,
                        reason: `Không đủ hàng (Yêu cầu: ${qtyNum}, Tổng tồn 2 kho: ${totalStock})`
                    });
                    continue;
                }

                processedItems.push({
                    product: product,
                    quantity: qtyNum,
                    stock_us: usQty,
                    stock_uk: ukQty,
                    total_stock: totalStock
                });
            }

            if (failedItems.length > 0) {
                const errorMsg = failedItems.map(f => f.reason ? `${f.product_name || f.barcode}: ${f.reason}` : '').filter(Boolean).join('\n');
                return res.status(400).json({
                    success: false,
                    message: `Một số sản phẩm không đủ điều kiện xuất:\n${errorMsg}`
                });
            }

            if (processedItems.length === 0) {
                return res.status(400).json({ success: false, message: 'Không có sản phẩm hợp lệ được chọn!' });
            }

            const requiresTransfer = processedItems.some(item => {
                const localStock = cleanBranch === 'US' ? item.stock_us : item.stock_uk;
                return item.quantity > localStock;
            });
            const autoApprove = canApproveOwn && (!requiresTransfer || canApproveTransfer);

            if (autoApprove) {
                // DUYỆT TỰ ĐỘNG cho Quản lý / Admin
                const approvedList = [];
                const txToSync = [];
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    const sortedItems = [...processedItems].sort((left, right) =>
                        String(left.product.id).localeCompare(String(right.product.id))
                    );
                    for (const pItem of sortedItems) {
                        const product = pItem.product;
                        const qtyNum = pItem.quantity;
                        const stocksResult = await client.query(
                            `SELECT branch, quantity
                             FROM tk_inventory
                             WHERE product_id = $1 AND branch IN ('US', 'UK')
                             ORDER BY branch
                             FOR UPDATE`,
                            [product.id]
                        );
                        const stocks = new Map(stocksResult.rows.map(row => [row.branch, Number(row.quantity)]));
                        const stockUs = stocks.get('US') || 0;
                        const stockUk = stocks.get('UK') || 0;
                        if (stockUs + stockUk < qtyNum) {
                            throw new Error(`${product.product_name} không còn đủ tồn khi ghi nhận.`);
                        }

                        const prefBranch = cleanBranch;
                        const otherBranch = cleanBranch === 'US' ? 'UK' : 'US';
                        const prefStock = prefBranch === 'US' ? stockUs : stockUk;
                        const otherStock = prefBranch === 'US' ? stockUk : stockUs;
                        const prefDeduct = Math.min(qtyNum, prefStock);
                        const otherDeduct = qtyNum - prefDeduct;
                        let detailsStr = '';

                        for (const [branch, quantity] of [[prefBranch, prefDeduct], [otherBranch, otherDeduct]]) {
                            if (quantity <= 0) continue;
                            const update = await client.query(
                                `UPDATE tk_inventory
                                 SET quantity = quantity - $3, updated_at = NOW()
                                 WHERE product_id = $1 AND branch = $2 AND quantity >= $3`,
                                [product.id, branch, quantity]
                            );
                            if (update.rowCount !== 1) throw new Error('Tồn kho vừa thay đổi, vui lòng thử lại.');
                            const txRes = await client.query(
                                `INSERT INTO tk_warehouse_transactions
                                    (group_id, user_id, transaction_type, product_id,
                                     quantity, status, approved_by, approved_at,
                                     request_group_id, branch)
                                 VALUES ($1, $2, 'EXPORT', $3, $4, 'APPROVED', $2, NOW(), $5, $6)
                                 RETURNING id`,
                                [group.id, user.id, product.id, quantity, requestGroupId, branch]
                            );
                            txToSync.push({
                                productId: product.id,
                                txId: txRes.rows[0].id,
                                productName: product.product_name
                            });
                        }
                        detailsStr = prefDeduct > 0 ? `Trừ ${prefDeduct} tại ${prefBranch}` : '';
                        if (otherDeduct > 0) {
                            detailsStr += `${detailsStr ? ' và lấy bù thêm' : 'Lấy bù'} ${otherDeduct} từ ${otherBranch}`;
                        }
                        approvedList.push({
                            product_name: product.product_name,
                            barcode: product.barcode,
                            quantity: qtyNum,
                            details: detailsStr,
                            newStock: stockUs + stockUk - qtyNum,
                            finalStockUs: prefBranch === 'US' ? prefStock - prefDeduct : otherStock - otherDeduct,
                            finalStockUk: prefBranch === 'UK' ? prefStock - prefDeduct : otherStock - otherDeduct
                        });
                    }
                    await client.query('COMMIT');
                } catch (error) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ success: false, message: error.message });
                } finally {
                    client.release();
                }

                // Gửi tin nhắn Telegram thông báo Xuất kho thành công
                let message = `📤 <b>[XUẤT KHO THÀNH CÔNG]</b>\n\n` +
                    `👤 <b>Người thực hiện (Quản lý):</b> ${escapeHtml(user.full_name)}\n` +
                    `🏢 <b>Cơ sở ưu tiên:</b> ${cleanBranch}\n` +
                    `📦 <b>Sản phẩm đã xuất:</b>\n`;

                approvedList.forEach((item, idx) => {
                    message += `${idx + 1}. <b>${escapeHtml(item.product_name)}</b> (<code>${escapeHtml(item.barcode)}</code>): -${item.quantity} (Tồn: <b>${item.newStock}</b> [US: ${item.finalStockUs}, UK: ${item.finalStockUk}])\n`;
                    message += `   └─ <i>Chi tiết: ${item.details}</i>\n`;
                });

                // PHẢN HỒI THÀNH CÔNG NGAY LẬP TỨC CHO CLIENT!
                res.json({ success: true, auto_approved: true, message: 'Đã xuất kho thành công!' });

                // Telegram và Sheet chạy sau commit, không giữ request Mini App.
                (async () => {
                    try {
                        await bot.telegram.sendMessage(chat_id, message, { parse_mode: 'HTML' });
                    } catch (telegramError) {
                        console.error('[Warehouse Telegram Error] Không gửi được thông báo xuất kho:', telegramError);
                    }
                    for (const item of txToSync) {
                        try {
                            await syncWarehouseSheets(item.productId, item.txId);
                        } catch (sheetErr) {
                            console.error(`[Warehouse Sync Error] Đồng bộ Sheet xuất kho thất bại cho ${item.productName}:`, sheetErr);
                        }
                    }
                })().catch(err => {
                    console.error('[Warehouse Export Background Error]:', err);
                });

                return;
            } else {
                // YÊU CẦU CHỜ DUYỆT cho Nhân viên thường
                const pendingList = [];
                let message = `⚠️ <b>[YÊU CẦU XUẤT KHO CHỜ DUYỆT]</b>\n\n` +
                    `👤 <b>Nhân viên yêu cầu:</b> ${escapeHtml(user.full_name)}\n` +
                    `🏢 <b>Cơ sở ưu tiên:</b> ${cleanBranch}\n` +
                    `📦 <b>Chi tiết yêu cầu xuất kho:</b>\n`;
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    for (const pItem of processedItems) {
                        const product = pItem.product;
                        const qtyNum = pItem.quantity;
                        await client.query(
                            `INSERT INTO tk_warehouse_transactions
                                (group_id, user_id, transaction_type, product_id,
                                 quantity, status, request_group_id, branch)
                             VALUES ($1, $2, 'EXPORT', $3, $4, 'PENDING', $5, $6)`,
                            [group.id, user.id, product.id, qtyNum, requestGroupId, cleanBranch]
                        );
                        pendingList.push({
                            product_name: product.product_name,
                            barcode: product.barcode,
                            quantity: qtyNum,
                            stockUs: pItem.stock_us,
                            stockUk: pItem.stock_uk,
                            totalStock: pItem.total_stock
                        });
                    }
                    pendingList.forEach((item, idx) => {
                        message += `${idx + 1}. <b>${escapeHtml(item.product_name)}</b> (<code>${escapeHtml(item.barcode)}</code>): ${item.quantity} (Tổng tồn: ${item.totalStock} [US: ${item.stockUs}, UK: ${item.stockUk}])\n`;
                    });
                    message += `\n👉 Quản lý hoặc Admin vui lòng nhấn nút bên dưới để duyệt yêu cầu:`;
                    await client.query(
                        `INSERT INTO tk_warehouse_outbox
                            (aggregate_type, aggregate_id, event_type, payload)
                         VALUES ('LEGACY_WAREHOUSE_EXPORT', $1, 'LEGACY_EXPORT_PENDING', $2::jsonb)
                         ON CONFLICT (aggregate_type, aggregate_id, event_type) DO NOTHING`,
                        [requestGroupId, JSON.stringify({
                            groupId: group.id,
                            chatId: String(chat_id),
                            message,
                            requestGroupId
                        })]
                    );
                    await client.query('COMMIT');
                } catch (error) {
                    await client.query('ROLLBACK');
                    return res.status(500).json({ success: false, message: 'Không thể lưu trọn vẹn yêu cầu xuất kho.' });
                } finally {
                    client.release();
                }
                return res.json({ success: true, auto_approved: false, message: 'Đã gửi yêu cầu xuất kho chờ Quản lý duyệt!' });
            }
        } catch (e) {
            console.error('Lỗi xuất kho API:', e);
            res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xử lý xuất kho' });
        }
    });
}
