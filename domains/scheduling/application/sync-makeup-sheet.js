/**
 * Đồng bộ một yêu cầu báo bù đã duyệt lên Google Sheet, tự thử lại khi lỗi.
 *
 * Dùng ở hai nơi: ngay sau khi duyệt (review-makeup-request.js, qua tham số
 * `syncToSheet`) và trong cron quét lại mỗi 5 phút cho các yêu cầu bị lỗi lần
 * đầu — cùng một hàm để hai nơi không lệch hành vi.
 */

export function createSyncMakeupSheet({ retryRepository, sheetSync, moment }) {
    async function syncMakeupToGoogleSheet(reqId, maxAttempts = 3) {
        let attempts = 0;
        let delay = 2000;

        while (attempts < maxAttempts) {
            attempts++;
            try {
                const request = await retryRepository.findMakeupRequestById(reqId);
                if (!request) return;
                if (request.status !== 'APPROVED') return;

                const target = await sheetSync.getSheetTarget(request.telegram_group_id, request.employee_name);
                if (!target.doc) {
                    await retryRepository.markSheetSyncStatus(
                        reqId, 'FAILED', 'Không tìm thấy Google Sheet cấu hình phù hợp cho nhóm này'
                    );
                    return;
                }

                const workDateFormatted = moment(request.work_date).format('DD/MM/YYYY');
                const employeeCode = await retryRepository.findEmployeeCode(request.telegram_id, request.telegram_group_id);

                const rowData = {
                    'Ngày': workDateFormatted,
                    'Nhân Viên': request.employee_name,
                    'Mã NV': employeeCode,
                    'Khách Hàng': request.customer_name,
                    'SĐT': request.customer_phone,
                    'Dịch Vụ': request.service,
                    'Buổi Làm': request.sessions,
                    'Thời Gian': moment(request.appointment_time).format('HH:mm DD/MM/YYYY'),
                    'Trạng Thái': 'Đã hoàn thành',
                    'Lý Do Hủy': '',
                    'Thu Tiền': request.revenue,
                    'Ảnh Chứng Thực': request.proof_image
                };

                const rowNumber = await sheetSync.writeAppointmentRow(request.telegram_group_id, request.employee_name, rowData);
                if (!rowNumber) {
                    throw new Error('Không thể ghi vào Google Sheet (chưa cài đặt hoặc lỗi)');
                }

                if (request.approved_appointment_id) {
                    await retryRepository.markApprovedAppointmentSheetRowIndex(request.approved_appointment_id, rowNumber);
                }
                await retryRepository.markSheetSyncStatus(reqId, 'SUCCESS', null);
                console.log(`[Google Sheet Sync SUCCESS] Yêu cầu ${reqId} đã được đồng bộ lên Sheet.`);
                return;
            } catch (err) {
                console.warn(`[SYNC ATTEMPT ${attempts} FAILED] Lỗi đồng bộ Sheet cho yêu cầu ${reqId}:`, err.message);
                if (attempts >= maxAttempts) {
                    await retryRepository.markSheetSyncStatus(reqId, 'FAILED', err.message);
                    throw err;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            }
        }
    }

    return { syncMakeupToGoogleSheet };
}
