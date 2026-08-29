/**
 * Ca sử dụng: tạo một yêu cầu báo bù công tour.
 *
 * Thứ tự cố ý, đừng đảo:
 *   1. Kiểm dữ liệu và giải mã ảnh — chưa chạm database, chưa ghi đĩa.
 *   2. Ghi file ảnh.
 *   3. Transaction: khoá nhóm, khoá nhân sự, khoá lịch gốc, chặn trùng, INSERT.
 *   4. COMMIT rồi mới gửi Telegram — KHÔNG gửi trong transaction vì Telegram
 *      chậm sẽ giữ khoá và làm nghẽn người khác.
 *
 * Hệ quả của bước 4: có một khoảnh khắc bản ghi đã lưu nhưng chưa ai được báo.
 * Trạng thái PENDING_NOTIFICATION đánh dấu đúng khoảnh khắc đó; gửi xong đổi
 * thành PENDING, gửi hỏng đổi thành NOTIFICATION_FAILED để bot gửi lại sau.
 */

import {
    REQUEST_TYPES, SchedulingError,
    validateMakeupInput, assertOriginalAppointmentUsable
} from '../domain/makeup-rules.js';

export function createMakeupRequestService({ pool, repository, imageStore, notifier, moment }) {
    /**
     * @param {object} params
     * @param {string} params.telegramId đã xác thực từ initData
     * @param {object} params.body payload từ Mini App
     * @returns {Promise<{message:string}>}
     */
    async function execute({ telegramId, body }) {
        const now = new Date();
        const { phone, appointmentTime } = validateMakeupInput(body, now);
        const workDate = moment().format('YYYY-MM-DD');

        // Giải mã trước khi ghi: ảnh hỏng thì không để lại file rác trên đĩa.
        const buffer = imageStore.decode(body.imageBase64);
        const { filePath, proofUrl } = imageStore.save(buffer, telegramId);

        let requestId = null;
        let employeeName = null;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            if (!await repository.lockActiveGroup(client, body.groupId)) {
                throw new SchedulingError('Nhóm làm việc không hợp lệ hoặc đã bị vô hiệu hóa!');
            }

            const member = await repository.lockGroupMember(client, telegramId, body.groupId);
            if (!member) {
                throw new SchedulingError(
                    'Bạn không thuộc nhóm làm việc này hoặc tài khoản của bạn đã bị vô hiệu hóa!', 403);
            }
            employeeName = member.full_name;

            if (body.request_type === REQUEST_TYPES.EXISTING) {
                const appointment = await repository.lockAppointment(client, body.original_appointment_id);
                assertOriginalAppointmentUsable(appointment, { telegramId, groupId: body.groupId }, now);
            }

            const duplicateRequest = await repository.findBlockingRequest(client, {
                telegramId, groupId: body.groupId, workDate, phone
            });
            if (duplicateRequest) {
                throw new SchedulingError(
                    'Yêu cầu báo bù cho khách hàng này vào ngày đã chọn đang chờ duyệt hoặc đã được duyệt!');
            }

            const completed = await repository.findCompletedAppointment(client, {
                telegramId, groupId: body.groupId, workDate, phone
            });
            if (completed) {
                throw new SchedulingError(
                    'Công tour cho khách hàng này vào ngày đã chọn đã được ghi nhận thành công trên hệ thống!');
            }

            requestId = await repository.insertRequest(client, {
                groupId: body.groupId,
                telegramId,
                employeeName,
                requestType: body.request_type,
                originalAppointmentId: body.original_appointment_id,
                workDate,
                appointmentTime: body.appointment_time,
                customerName: body.customer_name,
                phone,
                service: body.service,
                sessions: body.sessions,
                sessionType: body.session_type,
                revenue: body.revenue,
                reason: body.reason,
                proofUrl
            });

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => { /* kết nối có thể đã đứt */ });
            imageStore.remove(filePath);
            throw error;
        } finally {
            client.release();
        }

        return notifyApprovers({
            requestId, buffer, groupId: body.groupId,
            request: {
                employeeName,
                appointmentTime: body.appointment_time,
                customerName: body.customer_name,
                phone,
                service: body.service,
                sessions: body.sessions,
                sessionType: body.session_type,
                revenue: body.revenue,
                reason: body.reason,
                requestType: body.request_type
            }
        });
    }

    /**
     * Gửi tin duyệt. Gửi hỏng KHÔNG làm hỏng yêu cầu — dữ liệu đã lưu rồi, chỉ
     * đánh dấu để bot gửi lại, và vẫn trả success để nhân viên không gửi lại lần hai.
     */
    async function notifyApprovers({ requestId, buffer, groupId, request }) {
        try {
            const sent = await notifier.send({ groupId, requestId, buffer, request });
            if (!sent) throw new Error('Gửi thông báo Telegram thất bại (trả về null)');

            await repository.markStatus(requestId, 'PENDING');
            return { message: 'Gửi yêu cầu báo bù thành công! Vui lòng chờ quản lý duyệt.' };
        } catch (error) {
            console.error('Lỗi khi gửi thông báo Telegram ngoài transaction:', error.message);
            await repository.markStatus(requestId, 'NOTIFICATION_FAILED');
            return {
                message: 'Yêu cầu đã được lưu vào hệ thống nhưng gặp sự cố gửi thông báo Telegram. '
                    + 'Bot sẽ tự động gửi lại sau vài phút!'
            };
        }
    }

    return { execute };
}
