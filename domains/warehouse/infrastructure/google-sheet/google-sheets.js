/**
 * Adapter đồng bộ báo cáo kho lên Google Sheets.
 * Database vẫn là nguồn dữ liệu chính; lỗi Sheet không rollback giao dịch kho.
 */
import { rebuildStockSheets } from './stock-sheet.js';

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
                // Database là nguồn dữ liệu chính. Khi quản lý sửa một giao dịch
                // nhập/xuất bị bấm nhầm, lần đồng bộ kế tiếp phải phản ánh lại toàn
                // bộ dòng lịch sử chứ không chỉ cập nhật ảnh chứng thực.
                existingLogRow.set('Người thực hiện', tx.emp_name);
                existingLogRow.set('Tên sản phẩm', product.product_name);
                existingLogRow.set('Mã vạch', product.barcode);
                existingLogRow.set('Số lượng', tx.quantity);
                existingLogRow.set('Cơ sở', tx.branch || 'US');
                existingLogRow.set('Người duyệt', approverName);
                existingLogRow.set('Ngày giờ', timeStr);
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

            // 5. Ghi lại ba tab tồn kho (3. Tồn kho US / 4. Tồn kho UK / 5. Tổng kho)
            // từ database. Xem quy tắc ba trường hợp trong integrations/stock-sheet.js.
            // Cách cũ dò và sửa từng dòng cho mỗi sản phẩm × mỗi cơ sở nên vừa sinh ra
            // dòng tồn 0 ở cơ sở chưa từng nhập, vừa hay bị Google trả 429 quota.
            await rebuildStockSheets({ pool, moment, doc });

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
