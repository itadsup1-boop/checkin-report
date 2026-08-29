/**
 * Bổ sung ảnh chứng thực cho một lịch khách — dùng chung cho hai lối vào:
 * Mini App (`POST /api/upload-proof`, ảnh base64) và reply ảnh trực tiếp trên
 * Telegram (ảnh tải từ Telegram file server). Cả hai đều cần: ghi file, cập
 * nhật database, đồng bộ Sheet, rồi báo cho nhóm — gom một chỗ để hai luồng
 * không lệch hành vi khi sửa sau này.
 */

import { SchedulingError } from '../domain/makeup-rules.js';

export function createSubmitProofPhoto({ repository, sheetSync, moment, fs, path, uploadDir, publicBaseUrl }) {
    /** Ghi buffer ảnh xuống đĩa, trả về URL công khai — tên file giữ đúng tiền tố cũ để không lẫn với ảnh báo bù. */
    function saveBuffer(appointmentId, buffer) {
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const filename = `Proof_${appointmentId}_${Date.now()}.jpg`;
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, buffer);
        return { filePath, proofUrl: `${publicBaseUrl}/mini-app/uploads/${filename}` };
    }

    /**
     * Cập nhật đúng dòng cũ nếu đã từng ghi Sheet (`sheet_row_index`), hoặc ghi
     * dòng mới nếu đây là lần đầu. Lỗi Sheet chỉ log, không chặn việc lưu ảnh —
     * ảnh đã lưu vào database mới là căn cứ, Sheet chỉ là bản sao để đối chiếu.
     */
    async function syncProofToSheet(apt, proofUrl) {
        try {
            if (apt.sheet_row_index) {
                await sheetSync.updateProofOnRow(apt.group_id, apt.employee_name, apt.sheet_row_index, apt, proofUrl);
                return;
            }

            const employeeCode = await repository.findEmployeeCode(apt.telegram_id, apt.group_id);
            const rowData = {
                'Ngày': moment(apt.appointment_time).format('DD/MM/YYYY'),
                'Nhân Viên': apt.employee_name,
                'Mã NV': employeeCode,
                'Khách Hàng': apt.customer_name,
                'SĐT': apt.phone,
                'Dịch Vụ': apt.service,
                'Buổi Làm': apt.sessions,
                'Thời Gian': moment(apt.appointment_time).format('HH:mm DD/MM/YYYY'),
                'Trạng Thái': 'Đã hoàn thành',
                'Lý Do Hủy': '',
                'Thu Tiền': apt.revenue || '',
                'Ảnh Chứng Thực': proofUrl
            };
            const rowNumber = await sheetSync.writeAppointmentRow(apt.group_id, apt.employee_name, rowData);
            if (rowNumber) await repository.markSheetRowIndex(apt.id, rowNumber);
        } catch (sheetErr) {
            console.error('[Sheet Sync Error] Không thể đồng bộ ảnh lên Google Sheet:', sheetErr);
        }
    }

    /** Luồng Mini App: chính chủ tự bổ sung ảnh, `report` giới hạn 48 giờ. */
    async function uploadFromMiniApp({ id, groupId, telegramId, imageBase64 }) {
        if (!id || !imageBase64 || !groupId) {
            throw new SchedulingError('Thiếu dữ liệu ảnh');
        }

        const apt = await repository.findForProofUpload(id, groupId, telegramId);
        if (!apt) throw new SchedulingError('Không tìm thấy lịch hẹn', 404);

        if (apt.bot_role === 'report' && moment().diff(moment(apt.appointment_time), 'hours', true) > 48) {
            throw new SchedulingError(
                'Lịch đã quá 48 giờ. Vui lòng nhờ Quản lý hoặc Admin bổ sung ảnh trên Telegram.', 403
            );
        }

        const base64Data = String(imageBase64).replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const { proofUrl } = saveBuffer(apt.id, buffer);

        await repository.markProofSaved(id, proofUrl);
        await syncProofToSheet(apt, proofUrl);

        return { apt, proofUrl, buffer };
    }

    return { saveBuffer, syncProofToSheet, uploadFromMiniApp };
}
