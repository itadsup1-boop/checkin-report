export function registerGroupedWarehouseOrderActions({
    bot,
    pool,
    escapeHtml,
    syncWarehouseSheets
}) {
    bot.action(/^(wh_appgrp|wh_rejgrp)_(.+)$/, async (ctx) => {
        let client = null;
        let transactionOpen = false;
        try {
            const action = ctx.match[1]; // 'wh_appgrp' or 'wh_rejgrp'
            const requestGroupId = ctx.match[2];
            const clickerId = ctx.from.id.toString();

            const isAdmin = process.env.ADMIN_IDS && process.env.ADMIN_IDS.split(',').includes(clickerId);
            const managerCheckRes = await pool.query(
                `SELECT e.*, ARRAY_AGG(wp.permission_code) AS warehouse_permissions
                 FROM employees e
                 JOIN tk_warehouse_permissions wp ON wp.employee_id = e.id
                 WHERE e.telegram_id = $1
                   AND e.is_active = TRUE
                   AND wp.telegram_group_id = $2
                   AND wp.permission_code IN ('APPROVE_EXPORT', 'APPROVE_TRANSFER')
                   AND wp.is_active = TRUE
                 GROUP BY e.id
                 HAVING BOOL_OR(wp.permission_code = 'APPROVE_EXPORT')
                 LIMIT 1`,
                [clickerId, String(ctx.chat.id)]
            );
            const isManager = managerCheckRes.rows.length > 0;

            if (!isAdmin && !isManager) {
                return ctx.answerCbQuery('⚠️ Bạn không có quyền phê duyệt yêu cầu này!', { show_alert: true });
            }

            const manager = managerCheckRes.rows[0];
            const managerName = manager ? manager.full_name : 'Admin';
            const managerId = manager ? manager.id : null;
            const canApproveTransfer = isAdmin
                || (manager?.warehouse_permissions || []).includes('APPROVE_TRANSFER');

            client = await pool.connect();
            await client.query('BEGIN');
            transactionOpen = true;

            // Lấy tất cả giao dịch trong group này
            const txsRes = await client.query(`
                SELECT t.*, p.product_name, p.barcode, e.full_name as emp_name, e.telegram_id as emp_tg_id
                FROM tk_warehouse_transactions t
                JOIN tk_products p ON t.product_id = p.id
                JOIN employees e ON t.user_id = e.id
                JOIN telegram_groups g ON g.id = t.group_id
                WHERE t.request_group_id = $1
                  AND g.telegram_group_id = $2
                  AND g.bot_role = 'warehouse'
                ORDER BY t.product_id, t.id
                FOR UPDATE OF t
            `, [requestGroupId, String(ctx.chat.id)]);

            if (txsRes.rows.length === 0) {
                return ctx.answerCbQuery('⚠️ Yêu cầu không tồn tại hoặc đã bị xóa!', { show_alert: true });
            }

            const pendingTxs = txsRes.rows.filter(tx => tx.status === 'PENDING');
            if (pendingTxs.length === 0) {
                return ctx.answerCbQuery('⚠️ Yêu cầu này đã được xử lý từ trước!', { show_alert: true });
            }

            const requesterName = txsRes.rows[0].emp_name;

            const cleanBranch = txsRes.rows[0].branch || 'US';

            if (action === 'wh_rejgrp') {
                // Từ chối toàn bộ group
                await client.query(`
                    UPDATE tk_warehouse_transactions
                    SET status = 'REJECTED', approved_by = $2, approved_at = NOW()
                    WHERE request_group_id = $1 AND status = 'PENDING'
                `, [requestGroupId, managerId]);

                await client.query('COMMIT');
                transactionOpen = false;

                await ctx.answerCbQuery('❌ Đã từ chối yêu cầu xuất kho!', { show_alert: true });

                let message = `❌ <b>[YÊU CẦU XUẤT KHO BỊ TỪ CHỐI]</b>\n\n` +
                    `🏢 <b>Cơ sở:</b> ${cleanBranch}\n` +
                    `👤 <b>Nhân viên yêu cầu:</b> ${escapeHtml(requesterName)}\n` +
                    `📦 <b>Sản phẩm từ chối xuất:</b>\n`;

                txsRes.rows.forEach((tx, idx) => {
                    message += `${idx + 1}. <b>${escapeHtml(tx.product_name)}</b> (<code>${escapeHtml(tx.barcode)}</code>): ${tx.quantity}\n`;
                });
                message += `----------------------------------\n` +
                    `🚫 <b>Trạng thái:</b> Đã bị từ chối bởi <b>${escapeHtml(managerName)}</b>`;

                await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });

                // Đồng bộ sheet từng giao dịch trong background
                (async () => {
                    for (const tx of txsRes.rows) {
                        try {
                            await syncWarehouseSheets(tx.product_id, tx.id);
                        } catch (sheetErr) {
                            console.error('[Warehouse Sync Error] Đồng bộ Sheet từ chối thất bại:', sheetErr);
                        }
                    }
                })().catch(err => console.error(err));

                return;
            }

            // DUYỆT XUẤT KHO: Kiểm tra tồn kho khả dụng tổng hợp từ cả 2 cơ sở cho từng sản phẩm
            const checkedItems = [];
            for (const tx of pendingTxs) {
                const txBranch = tx.branch || 'US';

                const usRes = await client.query('SELECT quantity FROM tk_inventory WHERE product_id = $1 AND branch = $2 FOR UPDATE', [tx.product_id, 'US']);
                const ukRes = await client.query('SELECT quantity FROM tk_inventory WHERE product_id = $1 AND branch = $2 FOR UPDATE', [tx.product_id, 'UK']);
                const usQty = usRes.rows.length > 0 ? usRes.rows[0].quantity : 0;
                const ukQty = ukRes.rows.length > 0 ? ukRes.rows[0].quantity : 0;
                const totalStock = usQty + ukQty;

                if (totalStock < tx.quantity) {
                    return ctx.answerCbQuery(`❌ Lỗi duyệt: Sản phẩm "${tx.product_name}" không đủ hàng! (Tổng tồn cả 2 cơ sở: ${totalStock})`, { show_alert: true });
                }

                checkedItems.push({
                    tx: tx,
                    stockUs: usQty,
                    stockUk: ukQty,
                    totalStock: totalStock,
                    prefBranch: txBranch
                });
            }

            const requiresTransfer = checkedItems.some(item => {
                const localStock = item.prefBranch === 'US' ? item.stockUs : item.stockUk;
                return Number(item.tx.quantity) > Number(localStock);
            });
            if (requiresTransfer && !canApproveTransfer) {
                return ctx.answerCbQuery(
                    '⚠️ Đơn cần lấy hàng từ cơ sở khác; bạn chưa có quyền duyệt điều chuyển.',
                    { show_alert: true }
                );
            }

            // Thực hiện trừ kho và cập nhật transaction APPROVED
            const approvedList = [];
            const txsToSync = [];
            for (const item of checkedItems) {
                const tx = item.tx;
                const prefBranch = item.prefBranch;
                const otherBranch = prefBranch === 'US' ? 'UK' : 'US';
                const prefStock = prefBranch === 'US' ? item.stockUs : item.stockUk;
                const otherStock = prefBranch === 'US' ? item.stockUk : item.stockUs;

                const prefDeduct = Math.min(tx.quantity, prefStock);
                const otherDeduct = tx.quantity - prefDeduct;

                let detailsStr = '';

                if (prefDeduct > 0) {
                    const updated = await client.query('UPDATE tk_inventory SET quantity = quantity - $3, updated_at = NOW() WHERE product_id = $1 AND branch = $2 AND quantity >= $3', [tx.product_id, prefBranch, prefDeduct]);
                    if (updated.rowCount !== 1) throw new Error('Tồn kho cơ sở ưu tiên vừa thay đổi.');
                }
                if (otherDeduct > 0) {
                    const updated = await client.query('UPDATE tk_inventory SET quantity = quantity - $3, updated_at = NOW() WHERE product_id = $1 AND branch = $2 AND quantity >= $3', [tx.product_id, otherBranch, otherDeduct]);
                    if (updated.rowCount !== 1) throw new Error('Tồn kho cơ sở điều chuyển vừa thay đổi.');
                }

                if (otherDeduct > 0) {
                    // Cập nhật giao dịch ban đầu về số lượng trừ ở cơ sở ưu tiên
                    await client.query(`
                        UPDATE tk_warehouse_transactions
                        SET quantity = $2, status = 'APPROVED', approved_by = $3, approved_at = NOW()
                        WHERE id = $1
                    `, [tx.id, prefDeduct, managerId]);
                    txsToSync.push({ productId: tx.product_id, txId: tx.id });

                    // Thêm giao dịch mới cho cơ sở bù trừ
                    const txNewRes = await client.query(
                        `INSERT INTO tk_warehouse_transactions (group_id, user_id, transaction_type, product_id, quantity, status, approved_by, approved_at, request_group_id, branch, proof_folder_url)
                         VALUES ($1, $2, 'EXPORT', $3, $4, 'APPROVED', $5, NOW(), $6, $7, $8)
                         RETURNING id`,
                        [tx.group_id, tx.user_id, tx.product_id, otherDeduct, managerId, tx.request_group_id, otherBranch, tx.proof_folder_url || '']
                    );
                    const txNewId = txNewRes.rows[0].id;
                    txsToSync.push({ productId: tx.product_id, txId: txNewId });

                    detailsStr = `Trừ ${prefDeduct} tại ${prefBranch} và bù ${otherDeduct} từ ${otherBranch}`;
                } else {
                    // Không cần tách giao dịch
                    await client.query(`
                        UPDATE tk_warehouse_transactions
                        SET status = 'APPROVED', approved_by = $2, approved_at = NOW()
                        WHERE id = $1
                    `, [tx.id, managerId]);
                    txsToSync.push({ productId: tx.product_id, txId: tx.id });

                    detailsStr = `Trừ ${prefDeduct} tại ${prefBranch}`;
                }

                const finalStockUs = prefBranch === 'US' ? (prefStock - prefDeduct) : (otherStock - otherDeduct);
                const finalStockUk = prefBranch === 'UK' ? (prefStock - prefDeduct) : (otherStock - otherDeduct);

                approvedList.push({
                    product_name: tx.product_name,
                    barcode: tx.barcode,
                    quantity: tx.quantity,
                    details: detailsStr,
                    newStock: (prefStock + otherStock) - tx.quantity,
                    finalStockUs,
                    finalStockUk
                });
            }

            await client.query('COMMIT');
            transactionOpen = false;

            await ctx.answerCbQuery('✅ Đã duyệt xuất kho thành công!', { show_alert: true });

            let message = `🟢 <b>[YÊU CẦU XUẤT KHO ĐÃ DUYỆT]</b>\n\n` +
                `🏢 <b>Cơ sở ưu tiên:</b> ${cleanBranch}\n` +
                `👤 <b>Nhân viên yêu cầu:</b> ${escapeHtml(requesterName)}\n` +
                `📦 <b>Sản phẩm đã duyệt xuất:</b>\n`;

            approvedList.forEach((item, idx) => {
                message += `${idx + 1}. <b>${escapeHtml(item.product_name)}</b> (<code>${escapeHtml(item.barcode)}</code>): -${item.quantity} (Tồn: <b>${item.newStock}</b> [US: ${item.finalStockUs}, UK: ${item.finalStockUk}])\n`;
                message += `   └─ <i>Chi tiết: ${item.details}</i>\n`;
            });

            message += `----------------------------------\n` +
                `✅ <b>Người duyệt:</b> <b>${escapeHtml(managerName)}</b>\n\n` +
                `👉 <b>Nhân viên yêu cầu</b> vui lòng <b>Reply (Trả lời)</b> tin nhắn này và gửi 1 ảnh chụp sản phẩm thực tế để xác nhận đã lấy hàng.\n` +
                `🆔 <b>Mã Đơn Nhóm:</b> <code>${requestGroupId}</code>`;

            await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });

            // CHẠY ĐỒNG BỘ SHEET TRONG BACKGROUND
            (async () => {
                for (const item of txsToSync) {
                    try {
                        await syncWarehouseSheets(item.productId, item.txId);
                    } catch (sheetErr) {
                        console.error(`[Warehouse Sync Error] Đồng bộ Sheet xuất kho thất bại cho ${item.txId}:`, sheetErr);
                    }
                }
            })().catch(err => {
                console.error('[Warehouse Export Background Error]:', err);
            });

        } catch (e) {
            if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
            console.error('Lỗi bot.action warehouse group:', e);
            ctx.answerCbQuery('❌ Lỗi hệ thống khi xử lý yêu cầu!', { show_alert: true });
        } finally {
            client?.release();
        }
    });
}
