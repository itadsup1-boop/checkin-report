export function registerWarehouseImportRoutes({
    botApp,
    pool,
    authenticateTelegramMiniApp,
    receiveWarehouseImages
}) {
    botApp.post(
        '/api/warehouse/import',
        authenticateTelegramMiniApp,
        receiveWarehouseImages,
        async (req, res) => {
            if (!req.files?.length) {
                return res.status(400).json({
                    success: false,
                    message: 'Nhập kho bắt buộc có ít nhất một ảnh minh chứng.'
                });
            }

            const telegramId = req.verifiedTelegramId;
            const { chat_id: chatId, items: rawItems, branch: rawBranch } = req.body;
            const branch = String(rawBranch || '').toUpperCase();
            if (!chatId) {
                return res.status(400).json({ success: false, message: 'Thiếu thông tin ID nhóm.' });
            }
            if (!['US', 'UK'].includes(branch)) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn cơ sở US/MEDITECH hoặc UK.' });
            }

            let items;
            try {
                items = JSON.parse(rawItems);
            } catch (_) {
                return res.status(400).json({ success: false, message: 'Danh sách sản phẩm không hợp lệ.' });
            }
            if (!Array.isArray(items) || !items.length) {
                return res.status(400).json({ success: false, message: 'Danh sách sản phẩm trống.' });
            }

            const normalizedItems = items.map(item => ({
                barcode: String(item?.barcode || '').trim(),
                productName: String(item?.product_name || '').trim(),
                quantity: Number(item?.quantity)
            }));
            if (normalizedItems.some(item =>
                !item.barcode || !item.productName ||
                !Number.isInteger(item.quantity) || item.quantity <= 0
            )) {
                return res.status(400).json({
                    success: false,
                    message: 'Mỗi sản phẩm phải có mã vạch, tên và số lượng nguyên dương.'
                });
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const [userResult, groupResult] = await Promise.all([
                    client.query(
                        `SELECT * FROM employees
                         WHERE telegram_id = $1 AND is_active = TRUE
                         ORDER BY CASE WHEN telegram_group_id = $2 THEN 0 ELSE 1 END ASC, created_at ASC
                         LIMIT 1`,
                        [telegramId, String(chatId)]
                    ),
                    client.query(
                        `SELECT * FROM telegram_groups
                         WHERE telegram_group_id = $1 AND bot_role = 'warehouse'
                           AND is_active = TRUE AND COALESCE(is_deleted, FALSE) = FALSE
                         LIMIT 1`,
                        [String(chatId)]
                    )
                ]);
                const user = userResult.rows[0];
                const group = groupResult.rows[0];
                if (!user) {
                    throw Object.assign(new Error('Nhân sự chưa đăng ký hoặc đã bị vô hiệu hóa.'), { status: 403 });
                }
                if (!group) {
                    throw Object.assign(new Error('Nhóm chưa được phân quyền quản lý kho.'), { status: 403 });
                }
                const accessResult = await client.query(
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
                    [user.id, user.telegram_group_id, String(chatId)]
                );
                if (!accessResult.rows[0]?.allowed) {
                    throw Object.assign(new Error('Bạn không phải thành viên của nhóm kho này.'), { status: 403 });
                }

                // Chặn trùng mã vạch trước khi ghi bất cứ thứ gì.
                //
                // Trước đây câu upsert dùng ON CONFLICT (barcode) DO UPDATE product_name,
                // nên nhập mã đã tồn tại với tên khác sẽ ÂM THẦM đổi tên sản phẩm cũ và
                // gộp tồn kho của hai mặt hàng khác nhau làm một. Thực tế đã xảy ra:
                // UK nhập "Cannula 23g" mã 002, sau đó US nhập "Kim canula27g" cũng mã
                // 002 -> tên "Cannula 23g" biến mất, 5 cái của UK bị dán nhãn sai.
                //
                // Giờ hệ thống từ chối và nói rõ mã đang thuộc về sản phẩm nào để người
                // nhập tự quyết, thay vì tự ý gộp.
                const normalizeName = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
                const existingProducts = await client.query(
                    'SELECT barcode, product_name FROM tk_products WHERE barcode = ANY($1::text[])',
                    [normalizedItems.map(item => item.barcode)]
                );
                const barcodeConflicts = [];
                for (const row of existingProducts.rows) {
                    const typed = normalizedItems.find(item => item.barcode === row.barcode);
                    if (!typed) continue;
                    if (normalizeName(typed.productName) !== normalizeName(row.product_name)) {
                        barcodeConflicts.push(
                            `• Mã "${row.barcode}" đang là sản phẩm "${row.product_name}", ` +
                            `nhưng bạn đang nhập tên "${typed.productName}".`
                        );
                    }
                }
                if (barcodeConflicts.length) {
                    throw Object.assign(
                        new Error(
                            'Mã vạch đã thuộc về sản phẩm khác:\n' +
                            barcodeConflicts.join('\n') +
                            '\n\nNếu đúng là sản phẩm đó, hãy nhập lại đúng tên cũ. ' +
                            'Nếu là sản phẩm mới, hãy dùng mã vạch khác.'
                        ),
                        { status: 409 }
                    );
                }

                const resultItems = [];
                const transactionItems = [];
                for (const item of normalizedItems) {
                    // Chốt chặn cuối cùng, nằm ở tầng database nên chống được cả tình
                    // huống hai cơ sở nhập cùng lúc:
                    //
                    // Kiểm tra ở phía trên chỉ đọc dữ liệu tại một thời điểm. Nếu US và
                    // UK cùng nhận mã đề xuất "014" rồi cùng bấm lưu, cả hai đều thấy mã
                    // còn trống. Người lưu sau sẽ rơi vào ON CONFLICT, và nếu cho DO
                    // UPDATE vô điều kiện thì hàng của họ bị gắn nhầm vào sản phẩm của
                    // người lưu trước.
                    //
                    // Mệnh đề WHERE dưới đây chỉ cho phép "nhận" sản phẩm đã tồn tại khi
                    // TÊN khớp nhau. Khác tên thì không dòng nào được trả về -> báo lỗi.
                    // So sánh bỏ qua hoa/thường và khoảng trắng thừa cho giống phía trên.
                    const productResult = await client.query(
                        `INSERT INTO tk_products (barcode, product_name, is_active)
                         VALUES ($1, $2, TRUE)
                         ON CONFLICT (barcode) DO UPDATE SET
                            is_active = TRUE
                         WHERE lower(regexp_replace(btrim(tk_products.product_name), '[[:space:]]+', ' ', 'g'))
                             = lower(regexp_replace(btrim(EXCLUDED.product_name), '[[:space:]]+', ' ', 'g'))
                         RETURNING id, barcode, product_name`,
                        [item.barcode, item.productName]
                    );
                    const product = productResult.rows[0];
                    if (!product) {
                        throw Object.assign(
                            new Error(
                                `Mã vạch "${item.barcode}" vừa được người khác dùng cho một sản phẩm khác ` +
                                `trong lúc bạn đang nhập.\n\nHãy đóng và mở lại màn hình nhập kho để lấy mã mới.`
                            ),
                            { status: 409 }
                        );
                    }
                    const inventoryResult = await client.query(
                        `INSERT INTO tk_inventory (product_id, branch, quantity, updated_at)
                         VALUES ($1, $2, $3, NOW())
                         ON CONFLICT (product_id, branch) DO UPDATE SET
                            quantity = tk_inventory.quantity + EXCLUDED.quantity,
                            updated_at = NOW()
                         RETURNING quantity`,
                        [product.id, branch, item.quantity]
                    );
                    const balanceAfter = Number(inventoryResult.rows[0].quantity);
                    const balanceBefore = balanceAfter - item.quantity;
                    const transactionResult = await client.query(
                        `INSERT INTO tk_warehouse_transactions
                            (group_id, user_id, transaction_type, product_id, quantity,
                             status, proof_folder_url, branch)
                         VALUES ($1, $2, 'IMPORT', $3, $4, 'APPROVED', NULL, $5)
                         RETURNING id`,
                        [group.id, user.id, product.id, item.quantity, branch]
                    );
                    const transactionId = transactionResult.rows[0].id;
                    await client.query(
                        `INSERT INTO tk_warehouse_ledger
                            (event_key, event_type, legacy_transaction_id, group_id,
                             product_id, branch, quantity_delta, balance_before,
                             balance_after, actor_employee_id, actor_telegram_id,
                             approved_by_employee_id, metadata)
                         VALUES ($1, 'PRODUCT_IMPORT', $2, $3, $4, $5, $6, $7, $8,
                                 $9, $10, $9, $11::jsonb)`,
                        [
                            'legacy-import:' + transactionId,
                            transactionId,
                            group.id,
                            product.id,
                            branch,
                            item.quantity,
                            balanceBefore,
                            balanceAfter,
                            user.id,
                            String(telegramId),
                            JSON.stringify({ source: 'MINI_APP' })
                        ]
                    );
                    resultItems.push({
                        product_name: product.product_name,
                        barcode: product.barcode,
                        quantity: item.quantity,
                        newStock: balanceAfter
                    });
                    transactionItems.push({
                        transactionId,
                        productId: product.id,
                        productName: product.product_name
                    });
                }

                const aggregateId = transactionItems[0].transactionId;
                const payload = {
                    chatId: String(chatId),
                    groupId: group.id,
                    parentFolderId: group.warehouse_drive_folder_id
                        || group.customer_drive_folder_id
                        || process.env.WAREHOUSE_DRIVE_PARENT_FOLDER_ID
                        || '1VDcvrEc5nvVrvYsz1ShImZ21GsK7dQ8P',
                    branch,
                    userName: user.full_name,
                    resultItems,
                    transactionItems,
                    files: req.files.map(file => ({
                        path: file.path,
                        originalname: file.originalname,
                        mimetype: file.mimetype,
                        size: file.size
                    }))
                };
                await client.query(
                    `INSERT INTO tk_warehouse_outbox
                        (aggregate_type, aggregate_id, event_type, payload)
                     VALUES ('WAREHOUSE_IMPORT', $1, 'IMPORT_PROOF_UPLOAD', $2::jsonb)
                     ON CONFLICT (aggregate_type, aggregate_id, event_type) DO NOTHING`,
                    [aggregateId, JSON.stringify(payload)]
                );
                await client.query('COMMIT');
                return res.json({
                    success: true,
                    message: 'Nhập kho thành công. Ảnh đang được đồng bộ nền.',
                    transaction_group_id: aggregateId
                });
            } catch (error) {
                await client.query('ROLLBACK');
                console.error('[Warehouse Import]', error);
                return res.status(error.status || 500).json({
                    success: false,
                    message: error.status ? error.message : 'Lỗi máy chủ khi xử lý nhập kho.'
                });
            } finally {
                client.release();
            }
        }
    );
}
