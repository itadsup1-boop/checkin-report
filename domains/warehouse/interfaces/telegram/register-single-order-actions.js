export function registerSingleWarehouseOrderActions({
    bot,
    pool,
    escapeHtml,
    syncWarehouseSheets
}) {
    bot.action(/^(wh_approve|wh_reject)_(.+)$/, async (ctx) => {
        let client = null;
        let transactionOpen = false;
        try {
            const action = ctx.match[1]; // 'wh_approve' or 'wh_reject'
            const transactionId = ctx.match[2];
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

            const txRes = await client.query(`
                SELECT t.*, p.product_name, p.barcode, e.full_name as emp_name, e.telegram_id as emp_tg_id
                FROM tk_warehouse_transactions t
                JOIN tk_products p ON t.product_id = p.id
                JOIN employees e ON t.user_id = e.id
                JOIN telegram_groups g ON g.id = t.group_id
                WHERE t.id = $1
                  AND g.telegram_group_id = $2
                  AND g.bot_role = 'warehouse'
                FOR UPDATE OF t
            `, [transactionId, String(ctx.chat.id)]);

            if (txRes.rows.length === 0) {
                return ctx.answerCbQuery('⚠️ Yêu cầu không tồn tại hoặc đã bị xóa!', { show_alert: true });
            }

            const tx = txRes.rows[0];
            const cleanBranch = tx.branch || 'US';

            if (tx.status !== 'PENDING') {
                return ctx.answerCbQuery(`⚠️ Yêu cầu này đã được xử lý từ trước! (Trạng thái: ${tx.status})`, { show_alert: true });
            }

            if (action === 'wh_reject') {
                await client.query(`
                    UPDATE tk_warehouse_transactions
                    SET status = 'REJECTED', approved_by = $2, approved_at = NOW()
                    WHERE id = $1
                `, [transactionId, managerId]);

                await client.query('COMMIT');
                transactionOpen = false;

                await ctx.answerCbQuery('❌ Đã từ chối yêu cầu xuất kho!', { show_alert: true });

                await ctx.editMessageText(
                    `❌ <b>[YÊU CẦU XUẤT KHO BỊ TỪ CHỐI]</b>\n\n` +
                    `🏢 <b>Cơ sở:</b> ${cleanBranch}\n` +
                    `👤 <b>Nhân viên yêu cầu:</b> ${escapeHtml(tx.emp_name)}\n` +
                    `📦 <b>Sản phẩm:</b> ${escapeHtml(tx.product_name)} (<code>${escapeHtml(tx.barcode)}</code>)\n` +
                    `➖ <b>Số lượng xuất:</b> ${tx.quantity}\n` +
                    `----------------------------------\n` +
                    `🚫 <b>Trạng thái:</b> Đã bị từ chối bởi <b>${escapeHtml(managerName)}</b>`,
                    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
                );

                // Đồng bộ Google Sheets và gửi thông báo trong background
                (async () => {
                    // A. Gửi tin nhắn trực tiếp cho nhân viên
                    try {
                        const rejectMsg = `❌ <b>[YÊU CẦU XUẤT KHO BỊ TỪ CHỐI]</b>\n\n` +
                            `🏢 <b>Cơ sở:</b> ${cleanBranch}\n` +
                            `📦 <b>Sản phẩm:</b> <b>${escapeHtml(tx.product_name)}</b>\n` +
                            `➖ <b>Số lượng:</b> ${tx.quantity}\n` +
                            `🚫 <b>Lý do:</b> Bị từ chối bởi <b>${escapeHtml(managerName)}</b>.`;
                        await bot.telegram.sendMessage(tx.emp_tg_id, rejectMsg, { parse_mode: 'HTML' });
                    } catch (notifyErr) {
                        console.warn(`[Notify Direct Error] Không thể gửi tin nhắn trực tiếp cho ${tx.emp_name}:`, notifyErr.message);
                    }

                    // B. Gửi tin nhắn mới vào nhóm chat
                    try {
                        const groupNotifyMsg = `🔕 <b>[TỪ CHỐI XUẤT KHO]</b>\n\n` +
                            `👤 <b>Nhân viên:</b> ${escapeHtml(tx.emp_name)}\n` +
                            `📦 <b>Sản phẩm:</b> <b>${escapeHtml(tx.product_name)}</b>\n` +
                            `🚫 <b>Người từ chối:</b> <b>${escapeHtml(managerName)}</b>`;
                        await bot.telegram.sendMessage(ctx.chat.id, groupNotifyMsg, { parse_mode: 'HTML' });
                    } catch (groupNotifyErr) {
                        console.warn('[Notify Group Error] Không thể gửi tin nhắn thông báo từ chối vào nhóm:', groupNotifyErr.message);
                    }

                    try {
                        await syncWarehouseSheets(tx.product_id, transactionId);
                    } catch (sheetErr) {
                        console.error('[Warehouse Sync Error] Đồng bộ Sheet từ chối thất bại:', sheetErr);
                    }
                })().catch(err => console.error(err));

                return;
            }

            // Lấy tồn kho 2 cơ sở
            const usRes = await client.query('SELECT quantity FROM tk_inventory WHERE product_id = $1 AND branch = $2 FOR UPDATE', [tx.product_id, 'US']);
            const ukRes = await client.query('SELECT quantity FROM tk_inventory WHERE product_id = $1 AND branch = $2 FOR UPDATE', [tx.product_id, 'UK']);
            const usQty = usRes.rows.length > 0 ? usRes.rows[0].quantity : 0;
            const ukQty = ukRes.rows.length > 0 ? ukRes.rows[0].quantity : 0;
            const totalStock = usQty + ukQty;

            if (totalStock < tx.quantity) {
                return ctx.answerCbQuery(`❌ Lỗi duyệt: Tổng tồn 2 cơ sở không đủ hàng! (Hiện chỉ còn: ${totalStock})`, { show_alert: true });
            }

            const prefBranch = cleanBranch;
            const otherBranch = cleanBranch === 'US' ? 'UK' : 'US';
            const prefStock = prefBranch === 'US' ? usQty : ukQty;
            const otherStock = prefBranch === 'US' ? ukQty : usQty;

            const prefDeduct = Math.min(tx.quantity, prefStock);
            const otherDeduct = tx.quantity - prefDeduct;

            if (otherDeduct > 0 && !canApproveTransfer) {
                return ctx.answerCbQuery(
                    '⚠️ Đơn cần lấy hàng từ cơ sở khác; bạn chưa có quyền duyệt điều chuyển.',
                    { show_alert: true }
                );
            }

            let detailsStr = '';
            const txsToSync = [];

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
                `, [transactionId, prefDeduct, managerId]);
                txsToSync.push({ productId: tx.product_id, txId: transactionId });

                // Thêm giao dịch mới cho cơ sở bù trừ
                const txNewRes = await client.query(
                    `INSERT INTO tk_warehouse_transactions (group_id, user_id, transaction_type, product_id, quantity, status, approved_by, approved_at, request_group_id, branch, proof_folder_url)
                     VALUES ($1, $2, 'EXPORT', $3, $4, 'APPROVED', $5, NOW(), $6, $7, $8)
                     RETURNING id`,
                    [tx.group_id, tx.user_id, tx.product_id, otherDeduct, managerId, tx.request_group_id || null, otherBranch, tx.proof_folder_url || '']
                );
                const txNewId = txNewRes.rows[0].id;
                txsToSync.push({ productId: tx.product_id, txId: txNewId });

                detailsStr = `Trừ ${prefDeduct} tại ${prefBranch} và lấy bù thêm ${otherDeduct} từ ${otherBranch}`;
            } else {
                // Không cần tách giao dịch
                await client.query(`
                    UPDATE tk_warehouse_transactions
                    SET status = 'APPROVED', approved_by = $2, approved_at = NOW()
                    WHERE id = $1
                `, [transactionId, managerId]);
                txsToSync.push({ productId: tx.product_id, txId: transactionId });

                detailsStr = `Trừ ${prefDeduct} tại ${prefBranch}`;
            }

            await client.query('COMMIT');
            transactionOpen = false;

            await ctx.answerCbQuery('✅ Đã duyệt xuất kho thành công!', { show_alert: true });

            const finalStockUs = prefBranch === 'US' ? (prefStock - prefDeduct) : (otherStock - otherDeduct);
            const finalStockUk = prefBranch === 'UK' ? (prefStock - prefDeduct) : (otherStock - otherDeduct);

            await ctx.editMessageText(
                `🟢 <b>[YÊU CẦU XUẤT KHO ĐÃ DUYỆT]</b>\n\n` +
                `🏢 <b>Cơ sở ưu tiên:</b> ${cleanBranch}\n` +
                `👤 <b>Nhân viên yêu cầu:</b> ${escapeHtml(tx.emp_name)}\n` +
                `📦 <b>Sản phẩm:</b> ${escapeHtml(tx.product_name)} (<code>${escapeHtml(tx.barcode)}</code>)\n` +
                `➖ <b>Số lượng xuất:</b> ${tx.quantity}\n` +
                `📊 <b>Tồn kho hiện tại:</b> [US: ${finalStockUs}, UK: ${finalStockUk}] (Tổng: <b>${finalStockUs + finalStockUk}</b>)\n` +
                `📝 <b>Chi tiết phân bổ:</b> <i>${detailsStr}</i>\n` +
                `----------------------------------\n` +
                `✅ <b>Người duyệt:</b> <b>${escapeHtml(managerName)}</b>\n\n` +
                `👉 <b>Nhân viên yêu cầu</b> vui lòng <b>Reply (Trả lời)</b> tin nhắn này và gửi 1 ảnh chụp sản phẩm thực tế để xác nhận đã lấy hàng.\n` +
                `🆔 <b>Mã Đơn:</b> <code>${tx.id}</code>`,
                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
            );

            // CHẠY ĐỒNG BỘ SHEET VÀ GỬI THÔNG BÁO TRONG BACKGROUND
            (async () => {
                // A. Gửi tin nhắn trực tiếp cho nhân viên
                try {
                    const approveMsg = `🟢 <b>[YÊU CẦU XUẤT KHO ĐÃ DUYỆT]</b>\n\n` +
                        `🏢 <b>Cơ sở:</b> ${cleanBranch}\n` +
                        `📦 <b>Sản phẩm:</b> <b>${escapeHtml(tx.product_name)}</b> (<code>${escapeHtml(tx.barcode)}</code>)\n` +
                        `➖ <b>Số lượng xuất:</b> ${tx.quantity}\n` +
                        `✅ <b>Người duyệt:</b> <b>${escapeHtml(managerName)}</b>\n\n` +
                        `👉 Vui lòng reply lại tin nhắn này hoặc tin nhắn trong nhóm và gửi 1 ảnh chụp sản phẩm thực tế để xác nhận đã lấy hàng.`;
                    await bot.telegram.sendMessage(tx.emp_tg_id, approveMsg, { parse_mode: 'HTML' });
                } catch (notifyErr) {
                    console.warn(`[Notify Direct Error] Không thể gửi tin nhắn trực tiếp cho ${tx.emp_name}:`, notifyErr.message);
                }

                // B. Gửi tin nhắn mới vào nhóm chat
                try {
                    const groupNotifyMsg = `🔔 <b>[ĐÃ DUYỆT XUẤT KHO]</b>\n\n` +
                        `👤 <b>Nhân viên:</b> ${escapeHtml(tx.emp_name)}\n` +
                        `📦 <b>Sản phẩm:</b> <b>${escapeHtml(tx.product_name)}</b> (-${tx.quantity})\n` +
                        `✅ <b>Người duyệt:</b> <b>${escapeHtml(managerName)}</b>`;
                    await bot.telegram.sendMessage(ctx.chat.id, groupNotifyMsg, { parse_mode: 'HTML' });
                } catch (groupNotifyErr) {
                    console.warn('[Notify Group Error] Không thể gửi tin nhắn thông báo mới vào nhóm:', groupNotifyErr.message);
                }

                // C. Đồng bộ Sheets
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
            console.error('Lỗi bot.action warehouse:', e);
            ctx.answerCbQuery('❌ Lỗi hệ thống khi xử lý yêu cầu!', { show_alert: true });
        } finally {
            client?.release();
        }
    });
}
