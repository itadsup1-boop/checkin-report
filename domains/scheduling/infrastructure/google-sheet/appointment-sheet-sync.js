/**
 * Đồng bộ Google Sheet cho lịch khách và báo bù công tour.
 *
 * Tách từ apps/bot/kpi_features.js — hàm này từng nằm trong vùng có người sửa
 * dở, giờ đã ổn định (xem lịch sử commit) nên chuyển vào domain theo đúng khung
 * đã dùng cho warehouse/customer.
 *
 * Hai sheet luôn được ghi: một sheet "Tổng Hợp" (chung cho cả nhóm/tour) và một
 * sheet riêng theo tên nhân viên — dò trùng bằng khoá ở domain/sheet-row-matching.js
 * để lần ghi sau tìm đúng dòng cũ thay vì luôn thêm dòng mới.
 */

import { buildCustomerSheetRowKey, findCustomerSheetRow } from '../../domain/sheet-row-matching.js';

const SHEET_HEADERS = [
    'Ngày', 'Nhân Viên', 'Mã NV', 'Khách Hàng', 'SĐT', 'Dịch Vụ', 'Buổi Làm',
    'Thời Gian', 'Trạng Thái', 'Lý Do Hủy', 'Thu Tiền', 'Ảnh Chứng Thực'
];

export function createAppointmentSheetSync({ getCustomerDocForGroup, getGroupRole, moment }) {
    /** Nhóm report_tour ghi vào sheet cá nhân có hậu tố " [Tour]" để phân biệt với nhóm report. */
    async function getSheetTarget(groupId, employeeName) {
        const role = groupId && groupId !== 'MINI_APP' ? await getGroupRole(groupId) : null;
        const isTour = role === 'report_tour';
        const targetDoc = await getCustomerDocForGroup(groupId && groupId !== 'MINI_APP' ? groupId : null);
        const sheetSuffix = isTour ? ' [Tour]' : '';
        return {
            doc: targetDoc,
            role,
            sheetName: `${employeeName}${sheetSuffix}`.substring(0, 100)
        };
    }

    function masterSheetNameOf(target) {
        return target.role === 'report_tour' ? 'TỔNG HỢP TOUR' : 'TỔNG HỢP KHÁCH HÀNG';
    }

    /** Ghi một dòng mới hoặc cập nhật dòng trùng (theo khoá), vào cả sheet tổng hợp lẫn sheet cá nhân. */
    async function writeAppointmentRow(groupId, employeeName, rowData) {
        const target = await getSheetTarget(groupId, employeeName);
        if (!target.doc) {
            console.warn(`[Customer Sheet] group_id=${groupId} status=skipped reason=spreadsheet_not_configured`);
            return null;
        }
        await target.doc.loadInfo();

        const upsertRow = async sheet => {
            const rows = await sheet.getRows();
            const rowKey = buildCustomerSheetRowKey(rowData);
            let row = rows.find(item => buildCustomerSheetRowKey(item) === rowKey);
            if (!row) return await sheet.addRow(rowData);

            for (const header of SHEET_HEADERS) {
                row.set(header, rowData[header] ?? '');
            }
            await row.save();
            return row;
        };

        const masterSheetName = masterSheetNameOf(target);
        let masterSheet = target.doc.sheetsByTitle[masterSheetName];
        if (!masterSheet) masterSheet = await target.doc.addSheet({ headerValues: SHEET_HEADERS, title: masterSheetName });
        else await masterSheet.setHeaderRow(SHEET_HEADERS);
        await upsertRow(masterSheet);

        let individualSheet = target.doc.sheetsByTitle[target.sheetName];
        if (!individualSheet) individualSheet = await target.doc.addSheet({ headerValues: SHEET_HEADERS, title: target.sheetName });
        else await individualSheet.setHeaderRow(SHEET_HEADERS);
        const row = await upsertRow(individualSheet);

        return row.rowNumber;
    }

    /**
     * Cập nhật đúng dòng đã ghi trước đó (biết `rowIndex`) khi chỉ bổ sung ảnh
     * chứng thực — không tìm/tạo dòng mới như `writeAppointmentRow`.
     */
    async function updateProofOnRow(groupId, employeeName, rowIndex, apt, proofUrl) {
        const target = await getSheetTarget(groupId, employeeName);
        if (!target.doc) return;
        await target.doc.loadInfo();

        const matchFields = {
            'Nhân Viên': employeeName,
            'Khách Hàng': apt.customer_name,
            'SĐT': apt.phone,
            'Thời Gian': moment(apt.appointment_time).format('HH:mm DD/MM/YYYY')
        };

        const sheet = target.doc.sheetsByTitle[target.sheetName];
        if (sheet) {
            const rows = await sheet.getRows();
            const matchRow = findCustomerSheetRow(rows, matchFields, rowIndex);
            if (matchRow) {
                matchRow.set('Trạng Thái', 'Đã hoàn thành');
                matchRow.set('Ảnh Chứng Thực', proofUrl);
                if (apt.revenue) matchRow.set('Thu Tiền', apt.revenue);
                await matchRow.save();
            }
        }

        const masterSheet = target.doc.sheetsByTitle[masterSheetNameOf(target)];
        if (masterSheet) {
            const mRows = await masterSheet.getRows();
            const appTimeStr = matchFields['Thời Gian'];
            const matchMRow = mRows.find(row =>
                row.get('Khách Hàng') === apt.customer_name &&
                row.get('SĐT') === apt.phone &&
                row.get('Thời Gian') === appTimeStr);
            if (matchMRow) {
                matchMRow.set('Trạng Thái', 'Đã hoàn thành');
                matchMRow.set('Ảnh Chứng Thực', proofUrl);
                if (apt.revenue) matchMRow.set('Thu Tiền', apt.revenue);
                await matchMRow.save();
            }
        }
    }

    return { getSheetTarget, writeAppointmentRow, updateProofOnRow };
}
