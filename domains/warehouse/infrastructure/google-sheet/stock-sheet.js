/**
 * Ghi lại ba tab tồn kho trên Google Sheet từ database.
 *
 * Vì sao ghi lại cả tab thay vì dò từng dòng:
 *  - Database là nguồn sự thật duy nhất; ba tab này không có cột nào do người vận
 *    hành thêm tay nên tái tạo được 100%.
 *  - Cách dò từng dòng cũ phải gọi getRows + save cho mỗi sản phẩm × mỗi cơ sở
 *    (~84 lệnh gọi với 28 sản phẩm) nên hay bị Google trả 429 quota exceeded.
 *    Ghi lại cả tab chỉ tốn vài lệnh gọi.
 *  - Mọi sai lệch cũ (dòng tồn 0 của cơ sở chưa từng nhập, tên sản phẩm cũ, mã
 *    vạch bị cắt số 0) tự đúng lại sau một lần đồng bộ.
 *
 * Quy tắc hiển thị tab tồn kho theo cơ sở:
 *   tồn > 0                          -> ghi số lượng
 *   tồn = 0 nhưng cơ sở TỪNG có hàng -> ghi 0 (báo hết hàng, cần nhập bù)
 *   cơ sở CHƯA BAO GIỜ có hàng       -> không ghi dòng
 *
 * Dấu hiệu "từng có hàng" là sự tồn tại của dòng trong tk_inventory: dòng chỉ được
 * tạo khi cơ sở đó thực sự nhận hàng lần đầu.
 *
 * Tab "1. Xuất kho" và "2. Nhập kho" là sổ lịch sử, KHÔNG thuộc phạm vi file này.
 */

const STOCK_HEADERS = ['Mã vạch', 'Tên sản phẩm', 'Số lượng tồn kho', 'Cập nhật cuối'];

const SHEET_TITLES = {
    US: '3. Tồn kho US',
    UK: '4. Tồn kho UK',
    TOTAL: '5. Tổng kho'
};

// Một process bot có thể nhận đồng thời sự kiện nhập kho và đơn dịch vụ.
// Serialize các lần rebuild để không có lượt clear/ghi chồng lên nhau trên
// cùng một Google Spreadsheet.
let stockRebuildQueue = Promise.resolve();

/**
 * Lấy toàn bộ tồn kho kèm cờ "cơ sở này từng có hàng chưa".
 */
async function loadStockRows(pool) {
    const result = await pool.query(
        `SELECT p.id,
                p.barcode,
                p.product_name,
                COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'US'), 0) AS stock_us,
                COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'UK'), 0) AS stock_uk,
                BOOL_OR(i.branch = 'US') AS has_us_row,
                BOOL_OR(i.branch = 'UK') AS has_uk_row,
                MAX(i.updated_at) FILTER (WHERE i.branch = 'US') AS updated_us,
                MAX(i.updated_at) FILTER (WHERE i.branch = 'UK') AS updated_uk,
                MAX(i.updated_at) AS updated_any
         FROM tk_products p
         LEFT JOIN tk_inventory i ON i.product_id = p.id
         WHERE p.is_active = TRUE
         GROUP BY p.id, p.barcode, p.product_name
         ORDER BY p.product_name`
    );
    return result.rows;
}

function formatTime(moment, value) {
    if (!value) return '';
    return moment(value).utcOffset(7).format('DD/MM/YYYY HH:mm:ss');
}

/**
 * Ép cột "Mã vạch" về định dạng text để Google Sheet không cắt số 0 đầu
 * (database lưu '001' nhưng Sheet tự hiểu là số 1 nếu để định dạng tự động).
 */
async function forceBarcodeColumnAsText(sheet) {
    if (typeof sheet.loadCells !== 'function' || typeof sheet.getCell !== 'function') return;
    try {
        await sheet.loadCells({
            startRowIndex: 0,
            endRowIndex: Math.max(sheet.rowCount, 1),
            startColumnIndex: 0,
            endColumnIndex: 1
        });
        for (let row = 0; row < sheet.rowCount; row += 1) {
            const cell = sheet.getCell(row, 0);
            cell.numberFormat = { type: 'TEXT' };
        }
        await sheet.saveUpdatedCells();
    } catch (error) {
        // Không để lỗi định dạng làm hỏng việc đồng bộ số liệu.
        console.error('[Warehouse Sheet] Không đặt được định dạng text cho cột mã vạch:', error.message);
    }
}

async function ensureStockSheet(doc, title) {
    let sheet = doc.sheetsByTitle[title];
    if (!sheet) {
        sheet = await doc.addSheet({ title, headerValues: STOCK_HEADERS });
        return sheet;
    }
    await sheet.setHeaderRow(STOCK_HEADERS);
    return sheet;
}

async function writeStockSheet(doc, title, rows) {
    const sheet = await ensureStockSheet(doc, title);
    // google-spreadsheet có clearRows ở runtime thật. Một số adapter cũ/mocks
    // không có hàm này; khi đó cập nhật các dòng hiện có và chỉ thêm dòng mới,
    // tuyệt đối không gọi row.delete() để không phá lịch sử đối chiếu.
    if (typeof sheet.clearRows === 'function') {
        await sheet.clearRows();
        if (rows.length > 0) await sheet.addRows(rows);
    } else {
        const existing = typeof sheet.getRows === 'function' ? await sheet.getRows() : [];
        const byBarcode = new Map(
            existing
                .map(row => [String(row.get('Mã vạch') || '').trim(), row])
                .filter(([barcode]) => barcode)
        );
        const desiredBarcodes = new Set(rows.map(data => String(data['Mã vạch'] || '').trim()));
        for (const data of rows) {
            const barcode = String(data['Mã vạch'] || '').trim();
            const row = byBarcode.get(barcode);
            if (row) {
                for (const [key, value] of Object.entries(data)) row.set(key, value);
                await row.save();
            } else if (typeof sheet.addRow === 'function') {
                await sheet.addRow(data);
            }
        }
        // Adapter cũ không hỗ trợ xóa dòng: giữ dòng đã từng xuất hiện nhưng
        // cập nhật tồn về 0 để lịch sử/đối chiếu không bị mất.
        for (const [barcode, row] of byBarcode) {
            if (desiredBarcodes.has(barcode)) continue;
            row.set('Số lượng tồn kho', 0);
            await row.save();
        }
    }
    await forceBarcodeColumnAsText(sheet);
    return sheet;
}

/**
 * Tính danh sách dòng cho từng tab theo đúng quy tắc ba trường hợp.
 * Tách riêng để test được mà không cần Google Sheet.
 */
export function buildStockSheetRows(stockRows, moment) {
    const branchRows = { US: [], UK: [] };

    for (const row of stockRows) {
        for (const branch of ['US', 'UK']) {
            const quantity = branch === 'US' ? row.stock_us : row.stock_uk;
            const hasRow = branch === 'US' ? row.has_us_row : row.has_uk_row;

            // Cơ sở chưa bao giờ nhận sản phẩm này -> không ghi, tránh rối mắt.
            if (!hasRow && quantity <= 0) continue;

            branchRows[branch].push({
                'Mã vạch': row.barcode,
                'Tên sản phẩm': row.product_name,
                'Số lượng tồn kho': quantity,
                'Cập nhật cuối': formatTime(moment, branch === 'US' ? row.updated_us : row.updated_uk)
            });
        }
    }

    const totalRows = stockRows.map(row => ({
        'Mã vạch': row.barcode,
        'Tên sản phẩm': row.product_name,
        'Số lượng tồn kho': Number(row.stock_us) + Number(row.stock_uk),
        'Cập nhật cuối': formatTime(moment, row.updated_any)
    }));

    return { US: branchRows.US, UK: branchRows.UK, TOTAL: totalRows };
}

/**
 * Ghi lại cả ba tab tồn kho từ database.
 * @returns {Promise<{US:number, UK:number, TOTAL:number}>} số dòng đã ghi mỗi tab
 */
export async function rebuildStockSheets({ pool, moment, doc }) {
    const run = stockRebuildQueue.then(async () => {
        const stockRows = await loadStockRows(pool);
        const plan = buildStockSheetRows(stockRows, moment);

        await writeStockSheet(doc, SHEET_TITLES.US, plan.US);
        await writeStockSheet(doc, SHEET_TITLES.UK, plan.UK);
        await writeStockSheet(doc, SHEET_TITLES.TOTAL, plan.TOTAL);

        return { US: plan.US.length, UK: plan.UK.length, TOTAL: plan.TOTAL.length };
    });
    stockRebuildQueue = run.catch(() => undefined);
    return run;
}

export { STOCK_HEADERS, SHEET_TITLES };
