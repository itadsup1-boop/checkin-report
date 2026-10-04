/**
 * Tự động đồng bộ ca Báo Công Tour KTV lên Google Sheet tab "TỔNG HỢP TOUR".
 *
 * Cấu trúc cột tương thích 100% với bảng mẫu UK / MDT Công Tour:
 * STT, Ngày, Khách (Mới/Cũ), Họ tên khách, SĐT, Dịch vụ, Buổi, Bill, Ghi chú (Tặng/BH),
 * KTV, KTV1, KTV2, Bác sĩ, Số KTV / Ca, Công tua, Công ty, [Các cột KTV], x, Tổng.
 */

import { isExcludedSheetEmployee } from '../../../../packages/shared/excluded-employees.js';

export function createTourSheetSync({ getDocById, pool, moment }) {
    function formatDateVN(dateStr) {
        if (!dateStr) return '';
        if (moment) return moment(dateStr).format('DD/MM/YYYY');
        const [y, m, d] = String(dateStr).split('T')[0].split('-');
        return `${d}/${m}/${y}`;
    }

    async function getSpreadsheetDoc(groupId) {
        const res = await pool.query(
            'SELECT customer_sheet_id, group_name FROM telegram_groups WHERE telegram_group_id = $1 LIMIT 1',
            [String(groupId)]
        );
        const sheetId = res.rows[0]?.customer_sheet_id;
        if (!sheetId) return null;
        return await getDocById(sheetId);
    }

    /** Đồng bộ một ca tour (mới hoặc chỉnh sửa) lên Google Sheet tab "TỔNG HỢP TOUR". */
    async function syncTourToSheet(groupId, tour) {
        if (isExcludedSheetEmployee(tour?.reportedBy) || isExcludedSheetEmployee(tour?.reported_by) || isExcludedSheetEmployee(tour?.customerName) || isExcludedSheetEmployee(tour?.customer_name)) {
            console.log(`[TourSheetSync] Bỏ qua ca tour của nhân sự loại trừ: ${tour?.reportedBy || tour?.reported_by}`);
            return null;
        }

        try {
            const doc = await getSpreadsheetDoc(groupId);

            if (!doc) {
                console.log(`[TourSheetSync] Nhóm ${groupId} chưa cấu hình customer_sheet_id, bỏ qua sync.`);
                return null;
            }
            await doc.loadInfo();

            let sheet = doc.sheetsByTitle['TỔNG HỢP TOUR'];
            if (!sheet) {
                sheet = doc.sheetsByIndex[0];
            }
            await sheet.loadHeaderRow();
            const headers = sheet.headerValues || [];

            const rows = await sheet.getRows();
            const customerName = (tour.customerName || tour.customer_name || '').trim();
            const phone = (tour.phone || '').trim();
            const reportDateVN = formatDateVN(tour.reportDate || tour.report_date);
            const ktvList = Array.isArray(tour.ktvNames || tour.ktv_names)
                ? (tour.ktvNames || tour.ktv_names)
                : [tour.reportedBy || tour.reported_by || 'KTV'];
            const ktv1 = ktvList[0] || '';
            const ktv2 = ktvList[1] || '';
            const credit = tour.tourCredit !== undefined ? tour.tourCredit : (tour.tour_credit || 1);
            const customerType = (tour.customerType || tour.customer_type || '').includes('mới') ? 'Mới' : 'Cũ';

            // Dò tìm dòng đã có sẵn theo Tên khách + SĐT + Ngày để cập nhật (tránh thêm trùng lặp khi sửa)
            const matchRow = rows.find(r => {
                const rName = (r.get('Họ tên khách') || '').trim().toLowerCase();
                const rPhone = (r.get('SĐT') || '').trim();
                const rDate = (r.get('Ngày') || '').trim();
                return rName === customerName.toLowerCase() && rPhone === phone && rDate === reportDateVN;
            });

            const rowData = {
                'STT': matchRow ? matchRow.get('STT') : String(rows.length + 1),
                'Ngày': reportDateVN,
                'Khách\n(Mới/Cũ)': customerType,
                'Họ tên khách': customerName,
                'SĐT': phone,
                'Dịch vụ': tour.service || '',
                'Buổi': tour.sessions || '',
                'Bill': tour.revenue || tour.bill || '',
                'Ghi chú\n(Tặng/BH)': tour.notes || '',
                'KTV': ktvList.join('-'),
                'KTV1': ktv1,
                'KTV2': ktv2,
                'Bác sĩ': tour.doctor || '',
                'Số KTV / Ca': String(ktvList.length || 1),
                'Công tua': String(credit),
                'Công ty': '0',
                'x': '0',
                'Tổng': String(credit)
            };

            // Đổ điểm công vào các cột KTV tương ứng
            for (const h of headers) {
                const hNorm = h.toLowerCase().trim();
                if (['stt', 'ngày', 'họ tên khách', 'sđt', 'dịch vụ', 'buổi', 'bill', 'ktv', 'ktv1', 'ktv2', 'bác sĩ', 'số ktv / ca', 'công tua', 'công ty', 'x', 'tổng'].includes(hNorm) || hNorm.includes('khách\n') || hNorm.includes('ghi chú')) {
                    continue;
                }
                const isMatched = ktvList.some(k => {
                    const kNorm = k.toLowerCase().trim();
                    return hNorm === kNorm || kNorm.includes(hNorm) || hNorm.includes(kNorm);
                });
                rowData[h] = isMatched ? String(credit) : '0';
            }

            if (matchRow) {
                for (const k of Object.keys(rowData)) {
                    if (headers.includes(k)) matchRow.set(k, rowData[k]);
                }
                await matchRow.save();
                console.log(`[TourSheetSync] Đã cập nhật dòng STT ${rowData.STT} trên Google Sheet TỔNG HỢP TOUR.`);
                return matchRow;
            }

            const newRow = await sheet.addRow(rowData);
            console.log(`[TourSheetSync] Đã thêm dòng mới STT ${rowData.STT} trên Google Sheet TỔNG HỢP TOUR.`);
            return newRow;
        } catch (err) {
            console.error('[TourSheetSync] Lỗi đồng bộ Google Sheet:', err.message);
            return null;
        }
    }

    return {
        syncTourToSheet
    };
}
