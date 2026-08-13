/**
 * Lưu nháp đơn vào localStorage.
 *
 * Mini App trên điện thoại rất dễ bị đóng giữa lúc nhập (gọi đến, kéo xuống, hết pin).
 * Mỗi nhóm (chat_id) và mỗi luồng có nháp riêng để không lẫn dữ liệu giữa các cơ sở.
 */

import { getLaunchParams } from './telegram.js';

const PREFIX = 'warehouse-export-draft';

function keyFor(flowName) {
    const { chatId } = getLaunchParams();
    return `${PREFIX}:${flowName}:${chatId}`;
}

export function createDraftStore(flowName) {
    const storageKey = keyFor(flowName);

    return {
        save(data) {
            try {
                localStorage.setItem(storageKey, JSON.stringify(data));
            } catch {
                /* Hết quota hoặc chế độ riêng tư: bỏ qua, không làm hỏng luồng nhập. */
            }
        },

        load() {
            try {
                const raw = localStorage.getItem(storageKey);
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        },

        clear() {
            try {
                localStorage.removeItem(storageKey);
            } catch {
                /* không cần xử lý */
            }
        }
    };
}
