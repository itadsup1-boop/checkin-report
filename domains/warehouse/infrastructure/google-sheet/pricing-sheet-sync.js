/**
 * Đồng bộ Google Sheet ĐƠN GIÁ — CỐ Ý dùng một spreadsheet riêng, tách biệt
 * hẳn với WAREHOUSE_SPREADSHEET_ID (sheet xuất/nhập/tồn kho hiện có) để hạn
 * chế người xem giá. ID sheet lấy theo TỪNG NHÓM kho (`telegram_groups.pricing_sheet_id`,
 * điền trên Web Admin) — không phải một biến .env chung cho toàn hệ thống.
 *
 * Hai tab, cùng cách vận hành với `service-order-sheet-sync.js` — MỘT SẢN PHẨM /
 * MỘT ĐƠN chỉ chiếm ĐÚNG MỘT DÒNG, update đè khi có giá trị mới, không phình
 * to thành log:
 *   "Đơn giá sản phẩm"   — mỗi sản phẩm 1 dòng, luôn hiện giá MỚI NHẤT. Lịch
 *                          sử đầy đủ vẫn nằm trong DB (`tk_product_prices`) và
 *                          màn "Xem lịch sử" của Mini App — Sheet chỉ cần nhìn
 *                          nhanh giá hiện tại, không cần cuộn dò nhiều dòng.
 *   "Tổng giá đơn xuất"  — một đơn một dòng, update lại khi tổng tiền đổi
 *                          (đơn được vá giá sau khi trước đó thiếu).
 */

const priceHeaders = [
    'Thời gian',
    'Sản phẩm',
    'Mã vạch',
    'Giá mới',
    'Đơn vị tính giá',
    'Người nhập'
];

const orderTotalHeaders = [
    'Mã đơn',
    'Ngày duyệt',
    'Cơ sở',
    'Tổng tiền',
    'Còn thiếu giá?'
];

export function createPricingSheetSync({ pool, moment, getDocById }) {
    async function ensureSheet(doc, title, headers) {
        let sheet = doc.sheetsByTitle[title];
        if (!sheet) {
            sheet = await doc.addSheet({ title, headerValues: headers });
        } else {
            await sheet.setHeaderRow(headers);
        }
        return sheet;
    }

    /**
     * Định dạng ô tiền theo kiểu số có dấu chấm ngăn cách hàng nghìn (100.000)
     * thay vì để Google Sheet tự hiện dạng thập phân mặc định (100000.00).
     * Chỉ format đúng ô vừa ghi — tự "chữa" dần từng dòng qua mỗi lần đồng bộ,
     * không cần quét lại cả cột.
     */
    async function formatCurrencyCell(sheet, rowNumber, columnIndex) {
        if (typeof sheet.loadCells !== 'function' || typeof sheet.getCell !== 'function') return;
        try {
            const rowIndex = rowNumber - 1;
            await sheet.loadCells({
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: columnIndex,
                endColumnIndex: columnIndex + 1
            });
            const cell = sheet.getCell(rowIndex, columnIndex);
            cell.numberFormat = { type: 'NUMBER', pattern: '#,##0' };
            await sheet.saveUpdatedCells();
        } catch (error) {
            console.error('[Pricing Sheet] Không đặt được định dạng số:', error.message);
        }
    }

    async function openGroupPricingDoc(groupId) {
        const groupResult = await pool.query(
            `SELECT pricing_sheet_id FROM telegram_groups WHERE id = $1`,
            [groupId]
        );
        const sheetId = groupResult.rows[0]?.pricing_sheet_id;
        if (!sheetId) return null;

        const doc = await getDocById(sheetId);
        if (!doc) return null;
        await doc.loadInfo();
        return doc;
    }

    /** Một sản phẩm = một dòng — upsert theo Mã vạch, luôn hiện giá mới nhất. */
    async function syncNewPrice({ groupId, productName, barcode, unitPrice, priceUnit, actorName, createdAt }) {
        const doc = await openGroupPricingDoc(groupId);
        if (!doc) return;

        const sheet = await ensureSheet(doc, 'Đơn giá sản phẩm', priceHeaders);
        const rows = await sheet.getRows();
        const existingRow = rows.find(row => row.get('Mã vạch') === barcode);

        const values = {
            'Thời gian': moment(createdAt).utcOffset(7).format('DD/MM/YYYY HH:mm:ss'),
            'Sản phẩm': productName,
            'Mã vạch': barcode,
            'Giá mới': unitPrice,
            'Đơn vị tính giá': priceUnit || '',
            'Người nhập': actorName
        };

        const savedRow = existingRow || (await sheet.addRow(values));
        if (existingRow) {
            Object.entries(values).forEach(([key, value]) => existingRow.set(key, value));
            await existingRow.save();
        }
        await formatCurrencyCell(sheet, savedRow.rowNumber, priceHeaders.indexOf('Giá mới'));
    }

    /** Ghi/cập nhật tổng tiền của một đơn — upsert theo Mã đơn. */
    async function syncOrderTotal({ groupId, orderCode, approvedAt, branch, totalAmount, hasMissingPrice }) {
        const doc = await openGroupPricingDoc(groupId);
        if (!doc) return;

        const sheet = await ensureSheet(doc, 'Tổng giá đơn xuất', orderTotalHeaders);
        const rows = await sheet.getRows();
        const existingRow = rows.find(row => row.get('Mã đơn') === orderCode);

        const values = {
            'Mã đơn': orderCode,
            'Ngày duyệt': approvedAt ? moment(approvedAt).utcOffset(7).format('DD/MM/YYYY HH:mm:ss') : '',
            'Cơ sở': branch,
            'Tổng tiền': totalAmount,
            'Còn thiếu giá?': hasMissingPrice ? 'Có' : ''
        };

        const savedRow = existingRow || (await sheet.addRow(values));
        if (existingRow) {
            Object.entries(values).forEach(([key, value]) => existingRow.set(key, value));
            await existingRow.save();
        }
        await formatCurrencyCell(sheet, savedRow.rowNumber, orderTotalHeaders.indexOf('Tổng tiền'));
    }

    return { syncNewPrice, syncOrderTotal };
}
