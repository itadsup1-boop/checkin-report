/**
 * Ca sử dụng: duyệt hoặc từ chối một yêu cầu báo bù công tour.
 *
 * Duyệt là lúc công và doanh thu thật sự được ghi nhận. Ai được bấm:
 *   - Chính người đặt lịch (cũng là người gửi yêu cầu) — tự duyệt được.
 *   - Quản lý nhóm hoặc Admin — duyệt hộ khi nhân viên bận hoặc vắng.
 *
 * Chốt còn giữ:
 *   1. Yêu cầu phải còn PENDING, khoá FOR UPDATE để hai người bấm cùng lúc thì
 *      người sau thấy trạng thái đã đổi.
 *   2. Người ngoài nhóm không đụng được.
 *   3. Kiểm lại lịch gốc LẦN HAI ở đây: giữa lúc gửi và lúc duyệt, lịch có thể đã
 *      bị người khác hoàn tất hoặc hủy.
 */

import {
    REQUEST_TYPES, REVIEW_MESSAGES, SchedulingError,
    assertOriginalAppointmentUsable, checkReviewPermission, isAdminId
} from '../domain/makeup-rules.js';

export function createReviewMakeupService({ pool, repository, syncToSheet }) {
    /**
     * Phần chung của duyệt và từ chối: khoá yêu cầu, kiểm quyền, lấy tên người duyệt.
     * @returns {{request:object, reviewer:string}}
     */
    async function authorize(client, { requestId, clicker, action }) {
        const request = await repository.lockRequest(client, requestId);
        if (!request) {
            throw new SchedulingError('⚠️ Yêu cầu không tồn tại trong hệ thống!');
        }

        const isAdmin = isAdminId(clicker.id, process.env.ADMIN_IDS);
        const isManager = await repository.isGroupManager(client, clicker.id, request.telegram_group_id);

        const verdict = checkReviewPermission({
            request, clickerId: clicker.id, isAdmin, isManager, action
        });
        if (!verdict.ok) throw new SchedulingError(verdict.message);

        const fullName = await repository.findEmployeeName(client, clicker.id);
        const reviewer = fullName
            || (clicker.username ? `@${clicker.username}` : clicker.firstName);

        // Tự duyệt được phép, nhưng phải nhìn ra được trên tin nhắn: sau khi bỏ
        // chốt tiền kiểm thì đây là dấu vết duy nhất để hậu kiểm.
        return { request, reviewer, isSelfReview: request.telegram_id === clicker.id };
    }

    /**
     * @param {object} params
     * @param {string} params.requestId
     * @param {{id:string, username?:string, firstName?:string}} params.clicker
     * @returns {Promise<{reviewer:string}>}
     */
    async function approve({ requestId, clicker }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { request, reviewer, isSelfReview } = await authorize(client, {
                requestId, clicker, action: 'duyệt'
            });

            let appointmentId = request.original_appointment_id;

            if (request.request_type === REQUEST_TYPES.EXISTING) {
                const appointment = await repository.lockAppointmentForUpdate(
                    client, request.original_appointment_id);
                assertOriginalAppointmentUsable(
                    appointment,
                    { telegramId: request.telegram_id, groupId: request.telegram_group_id },
                    new Date(),
                    REVIEW_MESSAGES
                );
                await repository.completeExistingAppointment(client, request);
            } else {
                // Kiểm trùng LẠI ngay lúc duyệt: giữa gửi và duyệt có thể đã có
                // lịch hoàn tất cho cùng khách trong cùng ngày.
                const completed = await repository.findCompletedAppointment(client, {
                    telegramId: request.telegram_id,
                    groupId: request.telegram_group_id,
                    workDate: request.work_date,
                    phone: request.customer_phone
                });
                if (completed) {
                    throw new SchedulingError(
                        '⚠️ Công tour cho khách hàng này vào ngày đã chọn đã được ghi nhận thành công từ trước!');
                }
                appointmentId = await repository.insertApprovedAppointment(client, request);
            }

            await repository.markApproved(client, { requestId, reviewer, appointmentId });
            await client.query('COMMIT');

            // Đồng bộ Sheet chạy nền: Google chậm không được giữ khoá database và
            // cũng không được làm hỏng việc duyệt đã thành công.
            syncToSheet(requestId).catch(error => {
                console.error(`[SYNC FATAL ERROR] Lỗi đồng bộ Sheet vĩnh viễn cho yêu cầu ${requestId}:`, error);
            });

            return { reviewer, isSelfReview };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => { /* kết nối có thể đã đứt */ });
            throw error;
        } finally {
            client.release();
        }
    }

    async function reject({ requestId, clicker }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { reviewer, isSelfReview } = await authorize(client, {
                requestId, clicker, action: 'từ chối'
            });
            await repository.markRejected(client, { requestId, reviewer });
            await client.query('COMMIT');
            return { reviewer, isSelfReview };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => { /* kết nối có thể đã đứt */ });
            throw error;
        } finally {
            client.release();
        }
    }

    return { approve, reject };
}
