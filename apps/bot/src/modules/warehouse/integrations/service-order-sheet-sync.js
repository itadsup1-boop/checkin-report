import { rebuildStockSheets } from './stock-sheet.js';

export function createServiceOrderSheetSync({ pool, moment, getDocById }) {
    const exportHeaders = [
        'Mã giao dịch',
        'Mã dòng',
        'Mã đơn',
        'Người thực hiện',
        'Tên khách',
        'Số điện thoại',
        'Dịch vụ',
        'Tên sản phẩm',
        'Mã vạch',
        'Số lượng',
        'Cơ sở sử dụng',
        'Nguồn hàng',
        'Người duyệt',
        'Ngày giờ',
        'Ảnh chứng thực',
        'Trạng thái đơn',
        'Người hoàn tác',
        'Thời gian hoàn tác'
    ];
    const transferHeaders = [
        'Mã điều chuyển',
        'Mã dòng',
        'Mã đơn',
        'Từ cơ sở',
        'Đến cơ sở',
        'Tên sản phẩm',
        'Mã vạch',
        'Số lượng',
        'Người tạo đơn',
        'Người duyệt',
        'Ngày giờ',
        'Trạng thái',
        'Người hoàn tác',
        'Thời gian hoàn tác'
    ];

    async function ensureSheet(doc, title, headers) {
        let sheet = doc.sheetsByTitle[title];
        if (!sheet) {
            sheet = await doc.addSheet({ title, headerValues: headers });
        } else {
            await sheet.setHeaderRow(headers);
        }
        return sheet;
    }

    async function syncWarehouseOrder(orderId) {
        const orderResult = await pool.query(
            `SELECT o.*, COALESCE(creator.full_name,
                        CASE WHEN o.created_by IS NULL THEN 'Admin' END) AS creator_name,
                    COALESCE(approver.full_name,
                        CASE WHEN o.approved_at IS NOT NULL THEN 'Admin' END) AS approver_name
             FROM tk_warehouse_orders o
             LEFT JOIN employees creator ON creator.id = o.created_by
             LEFT JOIN employees approver ON approver.id = o.approved_by
             WHERE o.id = $1 AND o.status IN ('APPROVED', 'REVERSED')`,
            [orderId]
        );
        const order = orderResult.rows[0];
        if (!order) return;

        const [itemsResult, transfersResult, productsResult] = await Promise.all([
            pool.query(
                `SELECT oi.id, oi.product_id, oi.product_name_snapshot,
                        oi.barcode_snapshot, oi.actual_quantity,
                        oi.local_allocated_quantity, oi.transfer_allocated_quantity,
                        oi.transfer_from_branch, os.service_name_snapshot
                 FROM tk_warehouse_order_items oi
                 JOIN tk_warehouse_order_services os ON os.id = oi.order_service_id
                 WHERE os.order_id = $1 AND oi.is_removed = FALSE
                 ORDER BY os.display_order, oi.display_order`,
                [orderId]
            ),
            pool.query(
                `SELECT t.transfer_code, t.from_branch, t.to_branch, t.status,
                        t.confirmed_at, ti.id AS transfer_item_id, ti.quantity,
                        p.product_name, p.barcode
                 FROM tk_warehouse_transfers t
                 JOIN tk_warehouse_transfer_items ti ON ti.transfer_id = t.id
                 JOIN tk_products p ON p.id = ti.product_id
                 WHERE t.order_id = $1
                 ORDER BY t.created_at, p.product_name`,
                [orderId]
            ),
            pool.query(
                `SELECT p.id, p.barcode, p.product_name,
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'US'), 0)::int AS stock_us,
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'UK'), 0)::int AS stock_uk
                 FROM tk_products p
                 JOIN tk_warehouse_order_items oi ON oi.product_id = p.id
                 JOIN tk_warehouse_order_services os ON os.id = oi.order_service_id
                 LEFT JOIN tk_inventory i ON i.product_id = p.id
                 WHERE os.order_id = $1
                 GROUP BY p.id`,
                [orderId]
            )
        ]);

        const doc = await getDocById(process.env.WAREHOUSE_SPREADSHEET_ID);
        if (!doc) throw new Error('Không tìm thấy WAREHOUSE_SPREADSHEET_ID');
        await doc.loadInfo();

        const exportSheet = await ensureSheet(doc, '1. Xuất kho', exportHeaders);
        const existingExportRows = await exportSheet.getRows();
        const existingRowsByLineId = new Map(
            existingExportRows
                .map(row => [row.get('Mã dòng'), row])
                .filter(([lineId]) => lineId)
        );
        const createdAt = moment(order.approved_at || order.created_at).utcOffset(7).format('DD/MM/YYYY HH:mm:ss');
        for (const item of itemsResult.rows) {
            const lineId = `ORDER_ITEM:${item.id}`;
            const existingRow = existingRowsByLineId.get(lineId);
            if (existingRow) {
                existingRow.set('Trạng thái đơn', order.status === 'REVERSED' ? 'Đã hoàn tác' : 'Đã duyệt');
                existingRow.set('Người hoàn tác', order.reversed_by_admin_id || '');
                existingRow.set(
                    'Thời gian hoàn tác',
                    order.reversed_at ? moment(order.reversed_at).utcOffset(7).format('DD/MM/YYYY HH:mm:ss') : ''
                );
                await existingRow.save();
                continue;
            }
            const sources = [];
            if (Number(item.local_allocated_quantity) > 0) {
                sources.push(`${order.branch}: ${item.local_allocated_quantity}`);
            }
            if (Number(item.transfer_allocated_quantity) > 0) {
                sources.push(`${item.transfer_from_branch} điều chuyển: ${item.transfer_allocated_quantity}`);
            }
            await exportSheet.addRow({
                'Mã giao dịch': order.order_code,
                'Mã dòng': lineId,
                'Mã đơn': order.order_code,
                'Người thực hiện': order.creator_name,
                'Tên khách': order.customer_name,
                'Số điện thoại': order.customer_phone,
                'Dịch vụ': item.service_name_snapshot,
                'Tên sản phẩm': item.product_name_snapshot,
                'Mã vạch': item.barcode_snapshot,
                'Số lượng': item.actual_quantity,
                'Cơ sở sử dụng': order.branch,
                'Nguồn hàng': sources.join(' + '),
                'Người duyệt': order.approver_name,
                'Ngày giờ': createdAt,
                'Ảnh chứng thực': '',
                'Trạng thái đơn': order.status === 'REVERSED' ? 'Đã hoàn tác' : 'Đã duyệt',
                'Người hoàn tác': order.reversed_by_admin_id || '',
                'Thời gian hoàn tác': order.reversed_at
                    ? moment(order.reversed_at).utcOffset(7).format('DD/MM/YYYY HH:mm:ss')
                    : ''
            });
        }

        if (transfersResult.rows.length) {
            const transferSheet = await ensureSheet(doc, '6. Điều chuyển nội bộ', transferHeaders);
            const existingTransferRows = await transferSheet.getRows();
            const existingTransferRowsByLineId = new Map(
                existingTransferRows
                    .map(row => [row.get('Mã dòng'), row])
                    .filter(([lineId]) => lineId)
            );
            for (const item of transfersResult.rows) {
                const lineId = `TRANSFER_ITEM:${item.transfer_item_id}`;
                const existingRow = existingTransferRowsByLineId.get(lineId);
                if (existingRow) {
                    existingRow.set('Trạng thái', item.status === 'REVERSED' ? 'Đã hoàn tác' : 'Đã thông báo điều chuyển');
                    existingRow.set('Người hoàn tác', order.reversed_by_admin_id || '');
                    existingRow.set(
                        'Thời gian hoàn tác',
                        order.reversed_at ? moment(order.reversed_at).utcOffset(7).format('DD/MM/YYYY HH:mm:ss') : ''
                    );
                    await existingRow.save();
                    continue;
                }
                await transferSheet.addRow({
                    'Mã điều chuyển': item.transfer_code,
                    'Mã dòng': lineId,
                    'Mã đơn': order.order_code,
                    'Từ cơ sở': item.from_branch,
                    'Đến cơ sở': item.to_branch,
                    'Tên sản phẩm': item.product_name,
                    'Mã vạch': item.barcode,
                    'Số lượng': item.quantity,
                    'Người tạo đơn': order.creator_name,
                    'Người duyệt': order.approver_name,
                    'Ngày giờ': moment(item.confirmed_at).utcOffset(7).format('DD/MM/YYYY HH:mm:ss'),
                    'Trạng thái': item.status === 'REVERSED' ? 'Đã hoàn tác' : 'Đã thông báo điều chuyển',
                    'Người hoàn tác': order.reversed_by_admin_id || '',
                    'Thời gian hoàn tác': order.reversed_at
                        ? moment(order.reversed_at).utcOffset(7).format('DD/MM/YYYY HH:mm:ss')
                        : ''
                });
            }
        }

        // Ghi lại ba tab tồn kho từ database thay vì dò sửa từng dòng.
        // Quy tắc ba trường hợp (có hàng / từng có nhưng hết / chưa bao giờ có)
        // nằm trong integrations/stock-sheet.js.
        await rebuildStockSheets({ pool, moment, doc });

        await pool.query(
            `UPDATE tk_warehouse_orders
             SET sync_status = 'SYNCED', updated_at = NOW()
             WHERE id = $1`,
            [orderId]
        );
    }

    return { syncWarehouseOrder };
}
