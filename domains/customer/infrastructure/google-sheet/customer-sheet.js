/**
 * Đồng bộ hồ sơ khách hàng sang Google Sheet của nhóm.
 *
 * Sheet là bản sao ĐỌC cho quản lý — nguồn sự thật vẫn là Postgres. Hỏng ở đây
 * không được làm hỏng hồ sơ đã ghi.
 */

const SHEET_TITLE = 'THÔNG TIN KHÁCH HÀNG THỰC TẾ';

const HEADERS = [
    'Ngày', 'Nhân viên', 'Mã NV', 'Tư vấn', 'Khách mới/cũ', 'Tên KH',
    'Địa chỉ', 'Điện thoại', 'Dịch vụ', 'Tặng', 'Bill (đ)',
    'Đã TT (đ)', 'Nợ (đ)', 'Người thực hiện', 'Bảo hành', 'Link Folder Drive'
];

export function createCustomerSheet({ getCustomerDocForGroup }) {
    async function syncRecord(telegramGroupId, data) {
        try {
            const doc = await getCustomerDocForGroup(telegramGroupId);
            if (!doc) {
                console.warn(`[Sheet Sync Warning] Không tìm thấy Spreadsheet cấu hình cho nhóm ${telegramGroupId}`);
                return;
            }
            await doc.loadInfo();

            let sheet = doc.sheetsByTitle[SHEET_TITLE];
            if (!sheet) {
                sheet = await doc.addSheet({ headerValues: HEADERS, title: SHEET_TITLE });
            } else {
                await sheet.setHeaderRow(HEADERS);
            }

            await sheet.addRow({
                'Ngày': data.date,
                'Nhân viên': data.employeeName,
                'Mã NV': data.employeeCode,
                'Tư vấn': data.consultant,
                'Khách mới/cũ': data.customerType,
                'Tên KH': data.customerName,
                'Địa chỉ': data.address || '',
                'Điện thoại': data.phone,
                'Dịch vụ': data.service,
                'Tặng': data.gift || '',
                'Bill (đ)': data.billAmount,
                'Đã TT (đ)': data.paidAmount,
                'Nợ (đ)': data.debtAmount,
                'Người thực hiện': data.operator,
                'Bảo hành': data.warranty || '',
                'Link Folder Drive': data.driveFolderLink
            });
            console.log(`[Sheet Sync] Đồng bộ thành công thông tin KH ${data.customerName} lên Sheet.`);
        } catch (error) {
            console.error('[Sheet Sync Error] Thất bại khi ghi dữ liệu lên Google Sheet:', error);
            throw error;
        }
    }

    return { syncRecord, SHEET_TITLE, HEADERS };
}
