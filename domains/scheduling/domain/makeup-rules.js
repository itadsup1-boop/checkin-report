/**
 * Quy tắc nghiệp vụ của "Báo bù công tour" — thuần, không pg/express/telegraf.
 *
 * Vì sao có chức năng này: nhân viên tour đôi khi làm xong cho khách nhưng quên
 * báo cáo hoặc thiếu ảnh minh chứng. Báo bù cho phép khai lại, nhưng phải có
 * người duyệt vì nó ảnh hưởng trực tiếp tới công và doanh thu.
 */

/** Chỉ cho báo bù trong 48 giờ: quá mốc này thì không còn ai nhớ để đối chiếu. */
export const MAKEUP_WINDOW_HOURS = 48;

/** Ảnh sau khi giải mã base64 không được vượt mức này. */
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;

/** Giới hạn payload HTTP — base64 phình ~33% so với ảnh gốc. */
export const MAX_PAYLOAD_BYTES = 14 * 1024 * 1024;

export const REQUEST_TYPES = {
    EXISTING: 'EXISTING_APPOINTMENT',
    MISSING: 'MISSING_APPOINTMENT'
};

/** Các trạng thái coi như "đã có yêu cầu", dùng để chặn gửi trùng. */
export const BLOCKING_STATUSES = ['PENDING_NOTIFICATION', 'PENDING', 'APPROVED', 'NOTIFICATION_FAILED'];

export const REQUIRED_FIELDS = [
    'request_type', 'appointment_time', 'customer_name', 'phone',
    'service', 'sessions', 'reason', 'imageBase64', 'groupId'
];

/** Lỗi nghiệp vụ có mã HTTP đi kèm, để tầng interfaces không phải đoán. */
export class SchedulingError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'SchedulingError';
        this.status = status;
    }
}

/** Bỏ mọi ký tự không phải chữ số — nhân viên hay gõ kèm dấu cách, dấu chấm. */
export function normalizePhone(phone) {
    return String(phone || '').trim().replace(/\D/g, '');
}

/**
 * Kiểm tra dữ liệu gửi lên trước khi chạm database.
 * @throws {SchedulingError}
 */
export function validateMakeupInput(body, now = new Date()) {
    const missing = REQUIRED_FIELDS.some(field => !body[field]);
    if (missing) {
        throw new SchedulingError('Vui lòng nhập đầy đủ tất cả các trường bắt buộc và tải lên 1 ảnh!');
    }

    const phone = normalizePhone(body.phone);
    if (!phone) throw new SchedulingError('Số điện thoại không hợp lệ!');

    const appointmentTime = new Date(body.appointment_time);
    if (Number.isNaN(appointmentTime.getTime())) {
        throw new SchedulingError('Giờ hẹn không hợp lệ!');
    }
    if (appointmentTime > now) {
        throw new SchedulingError('Giờ hẹn không được phép ở tương lai!');
    }
    if (hoursBetween(appointmentTime, now) > MAKEUP_WINDOW_HOURS) {
        throw new SchedulingError(`Giờ hẹn khách phải nằm trong vòng ${MAKEUP_WINDOW_HOURS} giờ qua!`);
    }

    return { phone, appointmentTime };
}

export function hoursBetween(from, to) {
    return (to - from) / (1000 * 60 * 60);
}

/**
 * Câu báo cho hai thời điểm kiểm lịch gốc.
 *
 * Nhân viên GỬI yêu cầu và quản lý DUYỆT yêu cầu đọc hai câu khác nhau ("Lịch hẹn
 * gốc" và "Lịch cũ"). Giữ nguyên đúng chữ của bản cũ để không làm người dùng lạ.
 */
export const SUBMIT_MESSAGES = {
    notFound: 'Không tìm thấy lịch hẹn gốc để bổ sung!',
    notOwned: 'Lịch hẹn gốc này không thuộc quyền quản lý của bạn hoặc sai nhóm!',
    cancelled: 'Lịch hẹn gốc đã bị hủy, không thể báo bù!',
    alreadyDone: 'Lịch hẹn gốc này đã hoàn thành đầy đủ và được ghi nhận trước đó!',
    tooOld: `Lịch hẹn gốc đã quá giới hạn ${MAKEUP_WINDOW_HOURS} giờ!`
};

export const REVIEW_MESSAGES = {
    notFound: '⚠️ Không tìm thấy lịch cũ tương ứng để bổ sung!',
    notOwned: '⚠️ Lịch cũ không thuộc sở hữu của nhân viên hoặc nhóm tương ứng!',
    cancelled: '⚠️ Lịch cũ đã bị hủy, không thể báo bù!',
    alreadyDone: '⚠️ Lịch hẹn gốc này đã hoàn thành đầy đủ và được ghi nhận trước đó!',
    tooOld: '⚠️ Lịch cũ đã quá giới hạn 48 giờ!'
};

/**
 * Lịch hẹn gốc có được phép bổ sung không.
 *
 * Chỉ nhận lịch CÒN THIẾU: đang chờ (ACTIVE) hoặc đã đến nhưng còn nợ ảnh.
 * Lịch đã hoàn tất đủ ảnh mà cho báo bù nữa là tính công hai lần.
 *
 * Kiểm HAI LẦN — lúc gửi và lúc duyệt — vì giữa hai thời điểm đó lịch có thể đã
 * bị người khác hoàn tất hoặc hủy.
 *
 * @throws {SchedulingError}
 */
export function assertOriginalAppointmentUsable(
    appointment, { telegramId, groupId }, now = new Date(), messages = SUBMIT_MESSAGES
) {
    if (!appointment) {
        throw new SchedulingError(messages.notFound);
    }
    if (appointment.telegram_id !== telegramId || appointment.group_id !== groupId) {
        throw new SchedulingError(messages.notOwned, 403);
    }
    if (appointment.status === 'CANCELLED') {
        throw new SchedulingError(messages.cancelled);
    }
    const stillOwing = appointment.status === 'ACTIVE'
        || (appointment.status === 'ARRIVED' && (appointment.is_photo_debt || !appointment.proof_image));
    if (!stillOwing) {
        throw new SchedulingError(messages.alreadyDone);
    }
    if (hoursBetween(new Date(appointment.appointment_time), now) > MAKEUP_WINDOW_HOURS) {
        throw new SchedulingError(messages.tooOld);
    }
}

/* ---------- Quyền duyệt ---------- */

/**
 * Ai được duyệt / từ chối một yêu cầu báo bù.
 *
 * Quy tắc do chủ hệ thống đặt (đổi ngày 14/08/2026):
 *   Người ĐẶT LỊCH — cũng chính là người gửi yêu cầu — tự duyệt được.
 *   Quản lý nhóm hoặc Admin duyệt HỘ khi nhân viên bận hoặc vắng.
 *
 * Trước đây hệ thống CẤM tự duyệt. Chốt đó đã được bỏ theo yêu cầu. Hệ quả cần
 * biết: nhân viên tự xác nhận được công và doanh thu của chính mình, không còn
 * người thứ hai đối chiếu. Ảnh minh chứng vẫn bắt buộc và vẫn lưu lại, nên vẫn
 * truy ngược được — nhưng là hậu kiểm, không phải tiền kiểm.
 *
 * Chốt còn giữ: yêu cầu phải đang PENDING, và người ngoài nhóm không đụng được.
 *
 * @returns {{ok:true} | {ok:false, message:string}}
 */
export function checkReviewPermission({ request, clickerId, isAdmin, isManager, action = 'duyệt' }) {
    if (request.status !== 'PENDING') {
        return { ok: false, message: `⚠️ Yêu cầu đã được xử lý từ trước! (Trạng thái: ${request.status})` };
    }

    // Chính chủ: người đặt lịch và gửi yêu cầu báo bù.
    const isOwner = request.telegram_id === clickerId;

    if (!isOwner && !isAdmin && !isManager) {
        return {
            ok: false,
            message: action === 'duyệt'
                ? '⚠️ Bạn không có quyền phê duyệt yêu cầu của nhóm này!'
                : '⚠️ Bạn không có quyền từ chối yêu cầu của nhóm này!'
        };
    }
    return { ok: true };
}

/** Telegram ID có nằm trong ADMIN_IDS không. Đọc thẳng env để đổi admin không cần restart. */
export function isAdminId(clickerId, adminIdsEnv) {
    return Boolean(adminIdsEnv) && adminIdsEnv.split(',').includes(clickerId);
}

export const requestTypeLabel = type =>
    (type === REQUEST_TYPES.EXISTING ? 'Bổ sung lịch đã tồn tại' : 'Báo bù lịch chưa đăng ký');

/** Che 4 số cuối khi gửi lên nhóm — tin duyệt hiện cho nhiều người thấy. */
export const maskPhone = phone => `${String(phone).substring(0, 6)}****`;
