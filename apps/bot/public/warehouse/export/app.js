/**
 * Điều phối Mini App xuất kho.
 *
 * Nhiệm vụ: khởi tạo Telegram, nạp danh mục thật một lần, rồi chuyển giữa
 * màn hình chọn loại đơn và hai luồng nghiệp vụ. Không chứa logic nghiệp vụ.
 */

import { h, replaceChildren, el } from '../../shared-ui/core/dom.js';
import { initTelegram, isInsideTelegram, getLaunchParams } from '../../shared-ui/core/telegram.js';
import { loadCatalog } from './data/warehouse-repo.js';
import { loadingScreen, errorScreen, topBar } from './ui/components.js';
import { createEntryScreen } from './flows/entry-screen.js';
import { createQuickExportFlow } from './flows/quick-export.js';
import { createCustomerOrderFlow } from './flows/order/index.js';
import { createStockTransferFlow } from './flows/stock-transfer.js';

const mount = el('app');
let catalog = null;

function show(...children) {
    replaceChildren(mount, ...children);
    mount.scrollTop = 0;
    globalThis.scrollTo?.(0, 0);
}

function showEntry() {
    show(
        h('div', { class: 'topbar' },
            h('div', { style: { padding: '2px 4px 6px' } },
                h('div', { style: { fontSize: '17px', fontWeight: '800' } }, 'Tạo đơn xuất kho'),
                h('div', { class: 'topbar__sub', style: { textAlign: 'left' } }, 'Chọn loại đơn phù hợp')
            )
        ),
        createEntryScreen({
            catalog,
            onPick: flow => {
                if (flow === 'customer') return showCustomerFlow();
                if (flow === 'transfer') return showStockTransferFlow();
                return showQuickFlow();
            }
        })
    );
}

function showQuickFlow() {
    show(createQuickExportFlow({ catalog, onExit: showEntry }));
}

function showCustomerFlow() {
    show(createCustomerOrderFlow({ catalog, onExit: showEntry }));
}

function showStockTransferFlow() {
    show(createStockTransferFlow({ catalog, onExit: showEntry }));
}

async function start() {
    const { chatId } = getLaunchParams();

    if (!chatId || !isInsideTelegram()) {
        show(
            topBar({ title: 'Xuất kho', onBack: () => {} }),
            errorScreen({
                message: 'Vui lòng mở Mini App từ nút Xuất Kho trong Telegram để hệ thống xác thực được phiên làm việc.'
            })
        );
        return;
    }

    show(loadingScreen('Đang tải danh mục và tồn kho…'));

    try {
        catalog = await loadCatalog();
        showEntry();
    } catch (error) {
        show(errorScreen({ message: error.message, onRetry: start }));
    }
}

initTelegram();
start();
