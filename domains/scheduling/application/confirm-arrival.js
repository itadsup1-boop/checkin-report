/**
 * Use case cho 4 nút trên tin nhắn lịch khách: Đã đến · Hủy · chọn lý do · Quay lại.
 *
 * Chỉ NGƯỜI ĐẶT LỊCH được bấm. Đây là căn cứ tính công tour của chính họ, nên
 * không cho người khác xác nhận hộ — kể cả quản lý.
 */

import { CANCEL_REASONS } from '../domain/appointment-rules.js';

export const CONFIRM_RESULT = {
    OK: 'OK',
    NOT_FOUND: 'NOT_FOUND',
    NOT_OWNER: 'NOT_OWNER'
};

export function createConfirmArrivalService({ repository }) {
    /** @returns {?string} mã lỗi, null nghĩa là được phép */
    async function checkOwner(id, clickerId) {
        const owner = await repository.findOwnerOf(id);
        if (!owner) return CONFIRM_RESULT.NOT_FOUND;
        if (owner.telegram_id !== String(clickerId)) return CONFIRM_RESULT.NOT_OWNER;
        return null;
    }

    async function markArrived({ id, clickerId }) {
        const denial = await checkOwner(id, clickerId);
        if (denial) return { result: denial };

        await repository.markArrived(id);
        return { result: CONFIRM_RESULT.OK };
    }

    /** Bước 1 của hủy: chỉ hỏi lý do, chưa đổi trạng thái. */
    async function askCancelReason({ id, clickerId }) {
        const denial = await checkOwner(id, clickerId);
        if (denial) return { result: denial };
        return { result: CONFIRM_RESULT.OK };
    }

    /** Bước 2: chốt lý do. `app` = "lý do khác", phải gõ trong Mini App. */
    async function cancelWithReason({ id, type }) {
        if (type === 'app') return { result: CONFIRM_RESULT.OK, needsMiniApp: true };

        const reason = CANCEL_REASONS[type];
        await repository.cancelWithReason(id, reason);
        return { result: CONFIRM_RESULT.OK, reason };
    }

    return { markArrived, askCancelReason, cancelWithReason };
}
