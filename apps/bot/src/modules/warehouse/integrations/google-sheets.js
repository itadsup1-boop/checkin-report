/**
 * Adapter đồng bộ báo cáo kho lên Google Sheets.
 * Database vẫn là nguồn dữ liệu chính; lỗi Sheet không rollback giao dịch kho.
 */
export function createWarehouseSheetSync({ pool, moment, getDocById }) {
    // Google Sheets Sync helpers for Warehouse
    async function getWarehouseDocForGroup(telegram_group_id) {
        return await getDocById(process.env.WAREHOUSE_SPREADSHEET_ID);
    }

    async function syncWarehouseSheets(productId, transactionId) {
        try {
            console.log(`[Warehouse Sync] Bắt đầu đồng bộ cho sản phẩm ${productId}...`);

            // 1. Lấy thông tin sản phẩm
            const productRes = await pool.query(`
                SELECT p.barcode, p.product_name
                FROM tk_products p
                WHERE p.id = $1
            `, [productId]);

            if (productRes.rows.length === 0) return;
            const product = productRes.rows[0];

            // 2. Lấy thông tin giao dịch hiện tại
            const txRes = await pool.query(`
                SELECT t.*, e.full_name as emp_name, g.telegram_group_id
                FROM tk_warehouse_transactions t
                JOIN employees e ON t.user_id = e.id
                JOIN telegram_groups g ON t.group_id = g.id
                WHERE t.id = $1
            `, [transactionId]);

            if (txRes.rows.length === 0) return;
            const tx = txRes.rows[0];

            // Chỉ đồng bộ các giao dịch đã duyệt (APPROVED)
            if (tx.status !== 'APPROVED') return;

            // 3. Lấy Google Sheet Document
            const doc = await getWarehouseDocForGroup(tx.telegram_group_id);
            if (!doc) {
                console.error('[Warehouse Sync Error] Không tìm thấy Spreadsheet!');
                return;
            }

            await doc.loadInfo();

            // 4. Đồng bộ Tab 1 & 2: 1. Xuất kho / 2. Nhập kho
            const isImport = tx.transaction_type === 'IMPORT';
            const sheetTitle = isImport ? '2. Nhập kho' : '1. Xuất kho';
            const headers = ['Mã giao dịch', 'Người thực hiện', 'Tên sản phẩm', 'Mã vạch', 'Số lượng', 'Cơ sở', 'Người duyệt', 'Ngày giờ', 'Ảnh chứng thực'];

            let sheetLog = doc.sheetsByTitle[sheetTitle];
            if (!sheetLog) {
                sheetLog = await doc.addSheet({
                    title: sheetTitle,
                    headerValues: headers
                });
                await new Promise(r => setTimeout(r, 1000));
            } else {
                await sheetLog.setHeaderRow(headers);
            }

            const timeStr = moment(tx.created_at).utcOffset(7).format('DD/MM/YYYY HH:mm:ss');
            let approverName = '';
            if (tx.approved_by) {
                const appRes = await pool.query('SELECT full_name FROM employees WHERE id = $1', [tx.approved_by]);
                if (appRes.rows.length > 0) {
                    approverName = appRes.rows[0].full_name;
                } else {
                    approverName = 'Admin';
                }
            }

            const transactionCode = tx.id.substring(0, 8).toUpperCase();
            const existingLogRows = await sheetLog.getRows();
            const existingLogRow = existingLogRows.find(
                row => row.get('Mã giao dịch') === transactionCode
            );
            if (existingLogRow) {
                existingLogRow.set('Ảnh chứng thực', tx.proof_folder_url || '');
                await existingLogRow.save();
            } else {
                await sheetLog.addRow({
                    'Mã giao dịch': transactionCode,
                    'Người thực hiện': tx.emp_name,
                    'Tên sản phẩm': product.product_name,
                    'Mã vạch': product.barcode,
                    'Số lượng': tx.quantity,
                    'Cơ sở': tx.branch || 'US',
                    'Người duyệt': approverName,
                    'Ngày giờ': timeStr,
                    'Ảnh chứng thực': tx.proof_folder_url || ''
                });
            }
            await new Promise(r => setTimeout(r, 1000));

            // 5. Đồng bộ Tab 3 & 4: 3. Tồn kho US / 4. Tồn kho UK
            const branches = ['US', 'UK'];
            for (const br of branches) {
                const sheetStockTitle = br === 'US' ? '3. Tồn kho US' : '4. Tồn kho UK';
                let sheetStock = doc.sheetsByTitle[sheetStockTitle];
                const headersStock = ['Mã vạch', 'Tên sản phẩm', 'Số lượng tồn kho', 'Cập nhật cuối'];
                if (!sheetStock) {
                    sheetStock = await doc.addSheet({
                        title: sheetStockTitle,
                        headerValues: headersStock
                    });
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    await sheetStock.setHeaderRow(headersStock);
                }

                const brRes = await pool.query('SELECT quantity FROM tk_inventory WHERE product_id = $1 AND branch = $2', [productId, br]);
                const brQty = brRes.rows.length > 0 ? brRes.rows[0].quantity : 0;

                const rows = await sheetStock.getRows();
                let existingRow = rows.find(r => r.get('Mã vạch') === product.barcode);
                const updateTimeStr = moment().utcOffset(7).format('DD/MM/YYYY HH:mm:ss');

                if (existingRow) {
                    existingRow.set('Số lượng tồn kho', brQty);
                    existingRow.set('Cập nhật cuối', updateTimeStr);
                    existingRow.set('Tên sản phẩm', product.product_name);
                    await existingRow.save();
                } else {
                    await sheetStock.addRow({
                        'Mã vạch': product.barcode,
                        'Tên sản phẩm': product.product_name,
                        'Số lượng tồn kho': brQty,
                        'Cập nhật cuối': updateTimeStr
                    });
                }
                await new Promise(r => setTimeout(r, 1000));
            }

            // 6. Đồng bộ Tab 5: 5. Tổng kho (Tổng hợp tồn kho của cả US & UK)
            const sheetTotalTitle = '5. Tổng kho';
            let sheetTotal = doc.sheetsByTitle[sheetTotalTitle];
            const headersTotal = ['Mã vạch', 'Tên sản phẩm', 'Số lượng tồn kho', 'Cập nhật cuối'];
            if (!sheetTotal) {
                sheetTotal = await doc.addSheet({
                    title: sheetTotalTitle,
                    headerValues: headersTotal
                });
                await new Promise(r => setTimeout(r, 1000));
            } else {
                await sheetTotal.setHeaderRow(headersTotal);
            }

            const totalRes = await pool.query('SELECT SUM(quantity) as total FROM tk_inventory WHERE product_id = $1', [productId]);
            const totalQty = totalRes.rows.length > 0 ? (parseInt(totalRes.rows[0].total) || 0) : 0;

            const totalRows = await sheetTotal.getRows();
            let existingTotalRow = totalRows.find(r => r.get('Mã vạch') === product.barcode);
            const totalUpdateTimeStr = moment().utcOffset(7).format('DD/MM/YYYY HH:mm:ss');

            if (existingTotalRow) {
                existingTotalRow.set('Số lượng tồn kho', totalQty);
                existingTotalRow.set('Cập nhật cuối', totalUpdateTimeStr);
                existingTotalRow.set('Tên sản phẩm', product.product_name);
                await existingTotalRow.save();
            } else {
                await sheetTotal.addRow({
                    'Mã vạch': product.barcode,
                    'Tên sản phẩm': product.product_name,
                    'Số lượng tồn kho': totalQty,
                    'Cập nhật cuối': totalUpdateTimeStr
                });
            }
            await new Promise(r => setTimeout(r, 1000));

            console.log(`[Warehouse Sync] Đồng bộ thành công lên Sheet cho sản phẩm: ${product.product_name}`);
        } catch (e) {
            console.error('[Warehouse Sync Error] Thất bại khi đồng bộ lên Google Sheet:', e);
        }
    }

    // Helper function to update Google Sheet with proof photo url
    async function updateWarehouseSheetProof(transactionId, folderUrl) {
        try {
            const txRes = await pool.query(`
                SELECT t.*, tg.telegram_group_id
                FROM tk_warehouse_transactions t
                JOIN telegram_groups tg ON t.group_id = tg.id
                WHERE t.id = $1
            `, [transactionId]);
            if (txRes.rows.length === 0) return;
            const tx = txRes.rows[0];

            const doc = await getWarehouseDocForGroup(tx.telegram_group_id);
            if (!doc) return;

            await doc.loadInfo();
            const sheetTitle = tx.transaction_type === 'IMPORT' ? '2. Nhập kho' : '1. Xuất kho';
            let sheetLog = doc.sheetsByTitle[sheetTitle];
            if (sheetLog) {
                const rows = await sheetLog.getRows();
                const txShortId = tx.id.substring(0, 8).toUpperCase();
                const matchRow = rows.find(r => r.get('Mã giao dịch') === txShortId);
                if (matchRow) {
                    matchRow.set('Ảnh chứng thực', folderUrl);
                    await matchRow.save();
                    console.log(`[Google Sheet] Updated proof for transaction: ${txShortId}`);
                }
            }
        } catch (err) {
            console.error('[Warehouse Sheet Update Error] Lỗi cập nhật ảnh chứng thực:', err);
        }
    }

    return {
        syncWarehouseSheets,
        updateWarehouseSheetProof
    };
}
