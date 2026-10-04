export function registerWarehouseProofHandler({
    bot,
    pool,
    moment,
    createWarehouseFolder,
    uploadToDrive,
    updateWarehouseSheetProof
}) {
    // Lắng nghe nhân viên reply ảnh/tài liệu xác nhận đã lấy hàng sau khi đơn xuất kho được duyệt
    bot.on(['photo', 'document'], async (ctx, next) => {
        try {
            const replyMsg = ctx.message.reply_to_message;
            if (!replyMsg || !replyMsg.from || !replyMsg.from.is_bot) return next();

            const text = replyMsg.text || replyMsg.caption || '';
            const isWhApproved = text.includes('[YÊU CẦU XUẤT KHO ĐÃ DUYỆT]');
            if (!isWhApproved) return next();

            const activeGroup = await pool.query(
                `SELECT id, warehouse_drive_folder_id, customer_drive_folder_id
                 FROM telegram_groups
                 WHERE telegram_group_id = $1
                   AND bot_role = 'warehouse'
                   AND is_active = TRUE
                   AND COALESCE(is_deleted, FALSE) = FALSE
                 LIMIT 1`,
                [String(ctx.chat.id)]
            );
            if (!activeGroup.rows[0]) return next();

            // Kiểm tra xem tin nhắn gửi lên là gì (photo hay document)
            let fileId = null;
            let mimeType = 'image/jpeg';
            let fileName = 'Confirmation.jpg';

            if (ctx.message.photo && ctx.message.photo.length > 0) {
                const photo = ctx.message.photo[ctx.message.photo.length - 1];
                fileId = photo.file_id;
            } else if (ctx.message.document) {
                const doc = ctx.message.document;
                // Chỉ nhận tài liệu dạng ảnh
                if (!doc.mime_type || !doc.mime_type.startsWith('image/')) {
                    return next();
                }
                fileId = doc.file_id;
                mimeType = doc.mime_type;
                fileName = doc.file_name || 'Confirmation.jpg';
            }

            if (!fileId) return next();

            let requestGroupId = null;
            let singleTxId = null;

            const groupMatch = text.match(/Mã Đơn Nhóm:\s*([a-zA-Z0-9-]+)/);
            const singleMatch = text.match(/Mã Đơn:\s*([a-zA-Z0-9-]+)/);

            if (groupMatch) {
                requestGroupId = groupMatch[1];
            } else if (singleMatch) {
                singleTxId = singleMatch[1];
            } else {
                return next();
            }

            let txs = [];
            if (requestGroupId) {
                const res = await pool.query(`
                    SELECT t.*, e.full_name as emp_name, e.telegram_id AS emp_telegram_id
                    FROM tk_warehouse_transactions t
                    JOIN employees e ON t.user_id = e.id
                    WHERE t.request_group_id = $1 AND t.group_id = $2
                `, [requestGroupId, activeGroup.rows[0].id]);
                txs = res.rows;
            } else if (singleTxId) {
                const res = await pool.query(`
                    SELECT t.*, e.full_name as emp_name, e.telegram_id AS emp_telegram_id
                    FROM tk_warehouse_transactions t
                    JOIN employees e ON t.user_id = e.id
                    WHERE t.id = $1 AND t.group_id = $2
                `, [singleTxId, activeGroup.rows[0].id]);
                txs = res.rows;
            }

            if (txs.length === 0) {
                return ctx.reply('⚠️ Không tìm thấy giao dịch xuất kho tương ứng trong hệ thống!', { reply_to_message_id: ctx.message.message_id });
            }

            const exportTxs = txs.filter(t => t.transaction_type === 'EXPORT' && t.status === 'APPROVED');
            if (exportTxs.length === 0) {
                return ctx.reply('⚠️ Đơn hàng này không hợp lệ hoặc chưa được duyệt!', { reply_to_message_id: ctx.message.message_id });
            }

            if (exportTxs.some(t => t.proof_folder_url)) {
                return ctx.reply('⚠️ Ảnh xác nhận cho đơn xuất kho này đã được nộp trước đó!', { reply_to_message_id: ctx.message.message_id });
            }

            const senderId = String(ctx.from.id);
            const isRequester = exportTxs.some(tx => String(tx.emp_telegram_id) === senderId);
            const isAdmin = String(process.env.ADMIN_IDS || '').split(',').map(value => value.trim()).includes(senderId);
            const permission = isRequester || isAdmin ? null : await pool.query(
                `SELECT 1
                 FROM employees e
                 JOIN tk_warehouse_permissions wp ON wp.employee_id = e.id
                 WHERE e.telegram_id = $1 AND e.is_active = TRUE
                   AND wp.telegram_group_id = $2
                   AND wp.permission_code = 'APPROVE_EXPORT'
                   AND wp.is_active = TRUE
                 LIMIT 1`,
                [senderId, String(ctx.chat.id)]
            );
            if (!isRequester && !isAdmin && !permission?.rows[0]) {
                return ctx.reply('⚠️ Chỉ người tạo đơn hoặc người có quyền kho mới được nộp ảnh xác nhận.', {
                    reply_to_message_id: ctx.message.message_id
                });
            }

            const fileLink = await ctx.telegram.getFileLink(fileId);
            if (typeof globalThis.fetch !== 'function') {
                throw new Error('Node.js runtime không hỗ trợ fetch để tải ảnh Telegram.');
            }
            const resPhoto = await globalThis.fetch(fileLink.href);
            const buffer = Buffer.from(await resPhoto.arrayBuffer());

            const group = activeGroup.rows[0];
            const parentFolderId = group.warehouse_drive_folder_id
                || group.customer_drive_folder_id
                || process.env.WAREHOUSE_DRIVE_PARENT_FOLDER_ID
                || '1VDcvrEc5nvVrvYsz1ShImZ21GsK7dQ8P';

            const empNameClean = exportTxs[0].emp_name ? exportTxs[0].emp_name.replace(/\s+/g, '_') : 'NhanVien';
            const txShortId = (requestGroupId || singleTxId).substring(0, 8).toUpperCase();
            const folderName = `XuatKho_${moment().utcOffset(7).format('DD-MM-YYYY_HH[h]mm')}_${empNameClean}_Ma_${txShortId}`;

            console.log(`[Warehouse Confirmation] Đang tạo folder ${folderName} trên Drive...`);
            const folder = await createWarehouseFolder(parentFolderId, folderName);
            const folderUrl = folder.webViewLink;

            console.log(`[Warehouse Confirmation] Đang tải ảnh lên Drive...`);
            await uploadToDrive(buffer, fileName, mimeType, folder.id);

            if (requestGroupId) {
                await pool.query(
                    "UPDATE tk_warehouse_transactions SET proof_folder_url = $1 WHERE request_group_id = $2",
                    [folderUrl, requestGroupId]
                );
            } else if (singleTxId) {
                await pool.query(
                    "UPDATE tk_warehouse_transactions SET proof_folder_url = $1 WHERE id = $2",
                    [folderUrl, singleTxId]
                );
            }

            for (const tx of exportTxs) {
                await updateWarehouseSheetProof(tx.id, folderUrl);
            }

            await ctx.reply(`✅ <b>XÁC NHẬN ĐÃ LẤY HÀNG THÀNH CÔNG</b> ✅\n\n📸 Ảnh xác nhận đã được lưu trữ lên Google Drive và đồng bộ vào Google Sheet!\n📂 Link thư mục ảnh: <a href="${folderUrl}">Google Drive</a>`, {
                parse_mode: 'HTML',
                reply_to_message_id: ctx.message.message_id,
                disable_web_page_preview: true
            });

        } catch (e) {
            console.error('Lỗi khi xử lý ảnh xác nhận xuất kho:', e);
            ctx.reply('❌ Có lỗi xảy ra khi lưu ảnh xác nhận xuất kho. Vui lòng thử lại!', { reply_to_message_id: ctx.message.message_id });
        }
    });
}
