/**
 * Điều phối Mini App xem tồn kho.
 *
 * Nhiệm vụ duy nhất: khởi tạo Telegram, nạp dữ liệu tồn kho thật, rồi giao lại
 * cho màn hình tổng quan. Không chứa logic nghiệp vụ, không chứa markup.
 */

import { replaceChildren, el } from '../../shared-ui/core/dom.js';
import { initTelegram, isInsideTelegram, getLaunchParams } from '../../shared-ui/core/telegram.js';
import { loadInventory } from './data/inventory-repo.js';
import { loadingScreen, errorScreen } from './ui/components.js';
import { createInventoryOverview } from './screens/inventory-overview.js';

const mount = el('app');

function show(...children) {
    replaceChildren(mount, ...children);
    mount.scrollTop = 0;
    globalThis.scrollTo?.(0, 0);
}

async function start() {
    const { chatId } = getLaunchParams();

    if (!chatId || !isInsideTelegram()) {
        show(errorScreen({
            message: 'Vui lòng mở Mini App từ nút Xem Tồn Kho trong Telegram để hệ thống xác thực được phiên làm việc.'
        }));
        return;
    }

    show(loadingScreen());

    try {
        const items = await loadInventory();
        show(createInventoryOverview({ items }));
    } catch (error) {
        show(errorScreen({ message: error.message, onRetry: start }));
    }
}

initTelegram();
start();
