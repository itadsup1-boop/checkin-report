import { rebuildStockSheets } from './stock-sheet.js';

export function createServiceOrderSheetSync({ pool, moment, getDocById }) {
    /**
     * MỘT ĐƠN = MỘT DÒNG.
     *
     * Bản cũ ghi mỗi mặt hàng một dòng, nên một đơn 8 món chiếm 8 dòng và lặp lại
     * tên khách, dịch vụ, ngày giờ 8 lần — 21 đơn phình thành 178 dòng, không đọc nổi.
     *
     * Đã bỏ 4 cột: 'Mã dòng' và 'Mã vạch' (chủ hệ thống yêu cầu), 'Mã giao dịch'
     * (trùng y hệt 'Mã đơn') và 'Ảnh chứng thực' (chưa bao giờ được điền).
     *
     * 'Mã đơn' giờ là chìa khoá tìm lại dòng cũ khi cập nhật trạng thái hoàn tác —
     * trước đây việc đó do 'Mã dòng' đảm nhiệm.
     */
    const exportHeaders = [
        'Mã đơn',
        'Ngày giờ',
        'Người thực hiện',
        'Tên khách',
        'Số điện thoại',
        'Bác sĩ',
        'Kỹ thuật viên',
        'Dịch vụ',
        'Cơ sở sử dụng',
        'Mặt hàng',
        'Số mặt hàng',
        'Lấy từ cơ sở khác',
        'Người duyệt',
        'Trạng thái đơn',
        'Người hoàn tác',
        'Thời gian hoàn tác'
    ];

    /** "Kim tiểu đường ×1 chiếc, Filler deep ×1.2 ml" — số lẻ giữ nguyên 1.2, số tròn bỏ đuôi .0 */
    const soLuong = value => {
        const n = Number(value);
        return Number.isInteger(n) ? String(n) : String(n);
    };
    const gopMatHang = items => items
        .map(item => `${item.product_name_snapshot} ×${soLuong(item.actual_quantity)}${item.unit_snapshot ? ' ' + item.unit_snapshot : ''}`)
        .join(', ');

    /** Chỉ ghi khi thật sự phải lấy hàng từ cơ sở kia, còn lại để trống cho đỡ rối. */
    const gopDieuChuyen = items => items
        .filter(item => Number(item.transfer_allocated_quantity) > 0)
        .map(item => `${item.product_name_snapshot} ×${soLuong(item.transfer_allocated_quantity)}${item.unit_snapshot ? ' ' + item.unit_snapshot : ''} từ ${item.transfer_from_branch}`)
        .join(', ');

    const gopDichVu = items => [...new Set(items.map(item => item.service_name_snapshot))].join(' · ');
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
                        oi.unit_snapshot,
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
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'US'), 0) AS stock_us,
                        COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'UK'), 0) AS stock_uk
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
        const rowByOrderCode = new Map(
            existingExportRows
                .map(row => [row.get('Mã đơn'), row])
                .filter(([code]) => code)
        );
        const createdAt = moment(order.approved_at || order.created_at).utcOffset(7).format('DD/MM/YYYY HH:mm:ss');
        const trangThai = order.status === 'REVERSED' ? 'Đã hoàn tác' : 'Đã duyệt';
        const nguoiHoanTac = order.reversed_by_admin_id || '';
        const gioHoanTac = order.reversed_at
            ? moment(order.reversed_at).utcOffset(7).format('DD/MM/YYYY HH:mm:ss')
            : '';

        const items = itemsResult.rows;
        const existingRow = rowByOrderCode.get(order.order_code);
        if (existingRow) {
            // Đơn đã có dòng: chỉ cập nhật trạng thái, không ghi thêm dòng mới.
            existingRow.set('Trạng thái đơn', trangThai);
            existingRow.set('Người hoàn tác', nguoiHoanTac);
            existingRow.set('Thời gian hoàn tác', gioHoanTac);
            await existingRow.save();
        } else if (items.length > 0) {
            await exportSheet.addRow({
                'Mã đơn': order.order_code,
                'Ngày giờ': createdAt,
                'Người thực hiện': order.creator_name,
                'Tên khách': order.customer_name,
                'Số điện thoại': order.customer_phone,
                'Bác sĩ': order.doctor_name || '',
                'Kỹ thuật viên': order.technician_name || '',
                'Dịch vụ': gopDichVu(items),
                'Cơ sở sử dụng': order.branch,
                'Mặt hàng': gopMatHang(items),
                'Số mặt hàng': items.length,
                'Lấy từ cơ sở khác': gopDieuChuyen(items),
                'Người duyệt': order.approver_name,
                'Trạng thái đơn': trangThai,
                'Người hoàn tác': nguoiHoanTac,
                'Thời gian hoàn tác': gioHoanTac
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
