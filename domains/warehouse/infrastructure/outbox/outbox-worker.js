export function buildPendingMessage(order, escapeHtml, transferSuggestions = [], moment) {
    const createdAt = moment(order.created_at).utcOffset(7);
    let message = `⚠️ <b>[ĐƠN XUẤT KHÁCH CHỜ DUYỆT]</b>\n\n` +
        `🆔 <b>Mã đơn:</b> <code>${escapeHtml(order.order_code)}</code>\n` +
        `👤 <b>Nhân viên:</b> ${escapeHtml(order.creator_name)}\n` +
        `🙋 <b>Khách:</b> ${escapeHtml(order.customer_name)}\n` +
        `📞 <b>SĐT:</b> ${escapeHtml(order.customer_phone)}\n` +
        `🩺 <b>Bác sĩ:</b> ${escapeHtml(order.doctor_name || 'Chưa nhập')}\n` +
        `🧑‍🔧 <b>Kỹ thuật viên:</b> ${escapeHtml(order.technician_name || 'Chưa nhập')}\n` +
        `🏢 <b>Cơ sở:</b> ${escapeHtml(order.branch)}\n` +
        `📅 <b>Ngày tạo đơn:</b> ${createdAt.format('DD/MM/YYYY')}\n` +
        `🕒 <b>Giờ tạo đơn:</b> ${createdAt.format('HH:mm')}\n\n`;
    for (const service of order.services) {
        message += `<b>• ${escapeHtml(service.service_name_snapshot)}</b>\n`;
        service.items.filter(item => !item.is_removed).forEach(item => {
            message += `  - ${escapeHtml(item.product_name)}: ${item.actual_quantity}\n`;
        });
    }
    if (transferSuggestions.length) {
        message += '\n🚨 <b>CẦN LẤY HÀNG TỪ CƠ SỞ KHÁC:</b>\n';
        transferSuggestions.forEach(item => {
            message += `  - ${escapeHtml(item.product_name)}: ${item.quantity} (${item.from_branch} → ${item.to_branch})\n`;
        });
        message += '<b>Người duyệt cần có quyền duyệt điều chuyển.</b>\n';
    }
    message += '\n👉 Quản lý/Admin kiểm tra và duyệt đơn.';
    return message;
}

function buildApprovedMessage(order, escapeHtml) {
    let message = `✅ <b>[XUẤT KHO CHO KHÁCH THÀNH CÔNG]</b>\n\n` +
        `🆔 <b>Mã đơn:</b> <code>${escapeHtml(order.order_code)}</code>\n` +
        `🙋 <b>Khách:</b> ${escapeHtml(order.customer_name)}\n` +
        `📞 <b>SĐT:</b> ${escapeHtml(order.customer_phone)}\n` +
        `🩺 <b>Bác sĩ:</b> ${escapeHtml(order.doctor_name || 'Chưa nhập')}\n` +
        `🧑‍🔧 <b>Kỹ thuật viên:</b> ${escapeHtml(order.technician_name || 'Chưa nhập')}\n` +
        `🏢 <b>Cơ sở sử dụng:</b> ${escapeHtml(order.branch)}\n` +
        `👤 <b>Người order/bàn giao:</b> ${escapeHtml(order.creator_name)}\n`;
    if (order.transfers.length) {
        message += '\n🚚 <b>MANG HÀNG QUA CƠ SỞ SỬ DỤNG:</b>\n';
        order.transfers.forEach(transfer => {
            message += `Từ ${transfer.from_branch} → ${transfer.to_branch}\n`;
            transfer.items.forEach(item => {
                message += `  - ${escapeHtml(item.product_name)}: ${item.quantity}\n`;
            });
        });
    }
    return message;
}

function isTelegramMessageAlreadyUpdated(error) {
    return /message is not modified/i.test(String(error?.description || error?.message || error));
}

export function startWarehouseOutboxWorker({
    pool,
    bot,
    sendMessageToRoleGroup,
    sendMediaGroupToRoleGroup,
    warehouseOrderService,
    syncWarehouseOrder,
    syncWarehouseSheets,
    fs,
    moment,
    createWarehouseFolder,
    uploadToDrive,
    escapeHtml,
    intervalMs = 5000,
    autoStart = true
}) {
    let running = false;

    async function claimNext() {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(
                `SELECT id
                 FROM tk_warehouse_outbox
                 WHERE status IN ('PENDING', 'PROCESSING')
                   AND next_retry_at <= NOW()
                   AND (status = 'PENDING' OR next_retry_at <= NOW() - INTERVAL '10 minutes')
                 ORDER BY created_at
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1`
            );
            if (!result.rows[0]) {
                await client.query('COMMIT');
                return null;
            }
            const claimed = await client.query(
                `UPDATE tk_warehouse_outbox
                 SET status = 'PROCESSING', attempts = attempts + 1,
                     next_retry_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [result.rows[0].id]
            );
            await client.query('COMMIT');
            return claimed.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function processEvent(event) {
        if (event.event_type === 'LEGACY_EXPORT_PENDING') {
            const payload = event.payload;
            const sent = await sendMessageToRoleGroup(
                bot,
                payload.chatId,
                'warehouse',
                payload.message,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '✅ Duyệt Xuất Kho',
                                callback_data: `wh_appgrp_${payload.requestGroupId}`
                            },
                            {
                                text: '❌ Từ Chối',
                                callback_data: `wh_rejgrp_${payload.requestGroupId}`
                            }
                        ]]
                    }
                },
                'warehouse_legacy_export_pending'
            );
            if (!sent) throw new Error('Không gửi được yêu cầu xuất kho cũ chờ duyệt');
            return;
        }

        if (event.event_type === 'IMPORT_PROOF_UPLOAD') {
            const payload = event.payload;
            if (!payload.parentFolderId) {
                throw new Error('Chưa cấu hình thư mục Google Drive dành cho kho.');
            }
            let folder = payload.driveFolderId
                ? { id: payload.driveFolderId, webViewLink: payload.driveFolderUrl }
                : null;
            if (!folder) {
                const folderName = `NhapKho_${payload.branch}_${moment().utcOffset(7).format('DD-MM-YYYY_HH[h]mm')}_${event.aggregate_id.slice(0, 8)}`;
                folder = await createWarehouseFolder(payload.parentFolderId, folderName);
                payload.driveFolderId = folder.id;
                payload.driveFolderUrl = folder.webViewLink;
                payload.uploadedFileIndexes = [];
                await pool.query(
                    'UPDATE tk_warehouse_outbox SET payload = $2::jsonb WHERE id = $1',
                    [event.id, JSON.stringify(payload)]
                );
            }
            const uploadedIndexes = new Set(payload.uploadedFileIndexes || []);
            for (let index = 0; index < payload.files.length; index += 1) {
                if (uploadedIndexes.has(index)) continue;
                const file = payload.files[index];
                const buffer = fs.readFileSync(file.path);
                await uploadToDrive(buffer, file.originalname, file.mimetype, folder.id);
                uploadedIndexes.add(index);
                payload.uploadedFileIndexes = [...uploadedIndexes];
                await pool.query(
                    'UPDATE tk_warehouse_outbox SET payload = $2::jsonb WHERE id = $1',
                    [event.id, JSON.stringify(payload)]
                );
            }
            const transactionIds = payload.transactionItems.map(item => item.transactionId);
            await pool.query(
                `UPDATE tk_warehouse_transactions
                 SET proof_folder_url = $1
                 WHERE id = ANY($2::uuid[])`,
                [folder.webViewLink, transactionIds]
            );
            await pool.query(
                `UPDATE tk_warehouse_ledger
                 SET proof_folder_url = $1
                 WHERE legacy_transaction_id = ANY($2::uuid[])`,
                [folder.webViewLink, transactionIds]
            );

            let message = `📥 <b>[NHẬP KHO THÀNH CÔNG]</b>\n\n` +
                `👤 <b>Người thực hiện:</b> ${escapeHtml(payload.userName)}\n` +
                `🏢 <b>Cơ sở:</b> ${escapeHtml(payload.branch)}\n` +
                `📦 <b>Danh sách sản phẩm:</b>\n`;
            payload.resultItems.forEach((item, index) => {
                message += `${index + 1}. <b>${escapeHtml(item.product_name)}</b>: +${item.quantity} (Tồn: ${item.newStock})\n`;
            });
            if (!payload.notificationSent) {
                const media = payload.files.map((file, index) => ({
                    type: 'photo',
                    media: { source: file.path },
                    ...(index === 0 ? { caption: message, parse_mode: 'HTML' } : {})
                }));
                const sent = await sendMediaGroupToRoleGroup(
                    bot,
                    payload.chatId,
                    'warehouse',
                    media,
                    {},
                    'warehouse_import_completed'
                );
                if (!sent) throw new Error('Không gửi được thông báo ảnh nhập kho');
                payload.notificationSent = true;
                await pool.query(
                    'UPDATE tk_warehouse_outbox SET payload = $2::jsonb WHERE id = $1',
                    [event.id, JSON.stringify(payload)]
                );
            }

            for (const item of payload.transactionItems) {
                await syncWarehouseSheets(item.productId, item.transactionId);
            }
            for (const file of payload.files) {
                try {
                    fs.unlinkSync(file.path);
                } catch (error) {
                    console.warn('[Warehouse Import Cleanup]', error.message);
                }
            }
            return;
        }

        const order = await warehouseOrderService.repository.getOrderDetail(event.aggregate_id);
        if (!order) throw new Error(`Không tìm thấy order ${event.aggregate_id}`);

        if (event.event_type === 'SYNC_ORDER_SHEET' || event.event_type === 'SYNC_ORDER_REVERSAL_SHEET') {
            return syncWarehouseOrder(order.id);
        }

        if (event.event_type === 'ORDER_PENDING_APPROVAL') {
            if (order.status !== 'PENDING_APPROVAL') return;
            if (order.telegram_message_id) return;
            const sent = await sendMessageToRoleGroup(
                bot,
                order.telegram_group_id,
                'warehouse',
                buildPendingMessage(order, escapeHtml, event.payload?.transfer_suggestions || [], moment),
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '✅ Duyệt và trừ kho',
                                callback_data: `wh_svc_approve_${order.id}`
                            },
                            {
                                text: '❌ Từ chối',
                                callback_data: `wh_svc_reject_${order.id}`
                            }
                        ]]
                    }
                },
                'warehouse_service_order_pending'
            );
            if (!sent) throw new Error('Không gửi được thông báo đơn chờ duyệt');
            await pool.query(
                `UPDATE tk_warehouse_orders
                 SET telegram_message_id = $2, updated_at = NOW()
                 WHERE id = $1`,
                [order.id, sent.message_id]
            );
            return;
        }

        if (event.event_type === 'ORDER_APPROVED') {
            if (order.status !== 'APPROVED') return;
            if (order.telegram_message_id) {
                try {
                    await bot.telegram.editMessageText(
                        order.telegram_group_id,
                        order.telegram_message_id,
                        undefined,
                        buildApprovedMessage(order, escapeHtml),
                        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
                    );
                } catch (error) {
                    if (!isTelegramMessageAlreadyUpdated(error)) throw error;
                }
                return;
            }
            if (event.payload?.notificationSent) return;
            const sent = await sendMessageToRoleGroup(
                bot,
                order.telegram_group_id,
                'warehouse',
                buildApprovedMessage(order, escapeHtml),
                { parse_mode: 'HTML' },
                'warehouse_service_order_approved'
            );
            if (!sent) throw new Error('Không gửi được thông báo đơn đã duyệt');
            await pool.query(
                `UPDATE tk_warehouse_outbox
                 SET payload = payload || '{"notificationSent": true}'::jsonb
                 WHERE id = $1`,
                [event.id]
            );
            return;
        }

        if (event.event_type === 'ORDER_REJECTED') {
            if (order.status !== 'REJECTED') return;
            const rejectedMessage = `❌ <b>[ĐƠN XUẤT KHÁCH BỊ TỪ CHỐI]</b>\n\n` +
                `🆔 <code>${escapeHtml(order.order_code)}</code>\n` +
                `🙋 Khách: ${escapeHtml(order.customer_name)}\n` +
                `🩺 Bác sĩ: ${escapeHtml(order.doctor_name || 'Chưa nhập')}\n` +
                `🧑‍🔧 Kỹ thuật viên: ${escapeHtml(order.technician_name || 'Chưa nhập')}\n` +
                `🏢 Cơ sở: ${escapeHtml(order.branch)}`;
            if (order.telegram_message_id) {
                try {
                    await bot.telegram.editMessageText(
                        order.telegram_group_id,
                        order.telegram_message_id,
                        undefined,
                        rejectedMessage,
                        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
                    );
                } catch (error) {
                    if (!isTelegramMessageAlreadyUpdated(error)) throw error;
                }
                return;
            }
            if (event.payload?.notificationSent) return;
            const sent = await sendMessageToRoleGroup(
                bot,
                order.telegram_group_id,
                'warehouse',
                rejectedMessage,
                { parse_mode: 'HTML' },
                'warehouse_service_order_rejected'
            );
            if (!sent) throw new Error('Không gửi được thông báo đơn bị từ chối');
            await pool.query(
                `UPDATE tk_warehouse_outbox
                 SET payload = payload || '{"notificationSent": true}'::jsonb
                 WHERE id = $1`,
                [event.id]
            );
            return;
        }

        if (event.event_type === 'ORDER_REVERSED') {
            if (order.status !== 'REVERSED') return;
            if (event.payload?.notificationSent) return;
            const sent = await sendMessageToRoleGroup(
                bot,
                order.telegram_group_id,
                'warehouse',
                `↩️ <b>[ĐÃ HOÀN TÁC ĐƠN XUẤT KHO]</b>\n\n` +
                    `🆔 <code>${escapeHtml(order.order_code)}</code>\n` +
                    `🙋 Khách: ${escapeHtml(order.customer_name)}\n` +
                    `🩺 Bác sĩ: ${escapeHtml(order.doctor_name || 'Chưa nhập')}\n` +
                    `🧑‍🔧 Kỹ thuật viên: ${escapeHtml(order.technician_name || 'Chưa nhập')}\n` +
                    `🏢 Cơ sở: ${escapeHtml(order.branch)}\n` +
                    'Tồn kho đã được cộng trả bằng bút toán đảo; lịch sử cũ vẫn được giữ nguyên.',
                { parse_mode: 'HTML' },
                'warehouse_service_order_reversed'
            );
            if (!sent) throw new Error('Không gửi được thông báo hoàn tác đơn');
            await pool.query(
                `UPDATE tk_warehouse_outbox
                 SET payload = payload || '{"notificationSent": true}'::jsonb
                 WHERE id = $1`,
                [event.id]
            );
        }
    }

    async function markDone(id) {
        await pool.query(
            `UPDATE tk_warehouse_outbox
             SET status = 'DONE', processed_at = NOW(), last_error = NULL
             WHERE id = $1`,
            [id]
        );
    }

    async function markFailed(event, error) {
        const terminal = Number(event.attempts) >= 8;
        const delaySeconds = Math.min(1800, Math.max(10, 2 ** Number(event.attempts) * 5));
        await pool.query(
            `UPDATE tk_warehouse_outbox
             SET status = $2,
                 next_retry_at = NOW() + ($3::text || ' seconds')::interval,
                 last_error = $4
             WHERE id = $1`,
            [event.id, terminal ? 'FAILED' : 'PENDING', delaySeconds, String(error.message || error).slice(0, 2000)]
        );
        if (terminal
            && event.aggregate_type === 'WAREHOUSE_ORDER'
            && ['SYNC_ORDER_SHEET', 'SYNC_ORDER_REVERSAL_SHEET'].includes(event.event_type)) {
            await pool.query(
                `UPDATE tk_warehouse_orders
                 SET sync_status = 'FAILED', updated_at = NOW()
                 WHERE id = $1`,
                [event.aggregate_id]
            );
        }
    }

    async function tick() {
        if (running) return;
        running = true;
        try {
            for (let index = 0; index < 10; index += 1) {
                const event = await claimNext();
                if (!event) break;
                try {
                    await processEvent(event);
                    await markDone(event.id);
                } catch (error) {
                    console.error('[Warehouse Outbox]', event.event_type, error);
                    await markFailed(event, error);
                }
            }
        } catch (error) {
            console.error('[Warehouse Outbox Worker]', error);
        } finally {
            running = false;
        }
    }

    const timer = autoStart ? setInterval(tick, intervalMs) : null;
    timer?.unref?.();
    if (autoStart) setTimeout(tick, 1000).unref?.();
    return {
        stop: () => timer && clearInterval(timer),
        runOnce: tick
    };
}
