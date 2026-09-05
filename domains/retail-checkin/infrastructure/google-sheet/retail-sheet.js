/**
 * Đồng bộ dữ liệu check-in điểm bán thị trường sang Google Sheets của nhóm.
 */

const SHEET_TITLE = 'CHECK-IN TUYẾN ĐIỂM BÁN';

const HEADERS = [
    'Ngày',
    'Thời gian',
    'Nhân viên',
    'Điểm bán',
    'Địa chỉ chi tiết',
    'Tiến độ trong ngày',
    'Ảnh Selfie cổng',
    'Ảnh Quầy kệ sản phẩm',
    'Trạng thái'
];

export function createRetailSheetSync({ getDocForGroup }) {
    async function syncCheckin(telegramGroupId, data) {
        try {
            const doc = await getDocForGroup(telegramGroupId);
            if (!doc) {
                console.warn(`[Retail Sheet Warning] Không tìm thấy Google Spreadsheet cho nhóm ${telegramGroupId}`);
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
                'Ngày': data.dateStr,
                'Thời gian': data.timeStr,
                'Nhân viên': data.employeeName,
                'Điểm bán': data.storeName,
                'Địa chỉ chi tiết': data.storeAddress,
                'Tiến độ trong ngày': data.progressStr,
                'Ảnh Selfie cổng': data.selfieUrl || '',
                'Ảnh Quầy kệ sản phẩm': data.storePhotoUrl || '',
                'Trạng thái': data.isValid ? 'Hợp lệ' : `Không hợp lệ (${data.rejectReason || ''})`
            });

            console.log(`[Retail Sheet] Đồng bộ thành công điểm bán ${data.storeName} (${data.employeeName}) lên Google Sheet.`);
        } catch (error) {
            console.error('[Retail Sheet Error] Lỗi khi đồng bộ lên Google Sheet:', error.message || error);
        }
    }

    return { syncCheckin, SHEET_TITLE, HEADERS };
}
