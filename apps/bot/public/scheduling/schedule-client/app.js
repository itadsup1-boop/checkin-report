/**
 * Điều phối Mini App lịch khách (dành cho nhân viên).
 *
 * Năm tab: Check lịch · Thêm lịch · Sửa/Hủy · Nhiệm vụ · Báo Bù Công Tour.
 *
 * Tab chuyển bằng radio thuần CSS như bản cũ — không có JS chuyển tab, nên vẫn
 * đổi được tab kể cả khi một tab nào đó lỗi. JS chỉ lắng nghe `change` để biết
 * lúc nào cần nạp dữ liệu.
 *
 * Ba đường mở đặc biệt, giữ nguyên hành vi cũ:
 *   ?tab=edit                     mở thẳng tab Sửa/Hủy và tự tìm lịch gần đây
 *   ?tab=makeup / makeupclient_…  mở thẳng tab Báo Bù (chỉ nhóm tour)
 *   ?action=update&id=…           ẩn thanh tab, mở tab Thêm ở chế độ cập nhật
 */

import { h, replaceChildren, el } from '../../shared-ui/core/dom.js';
import { initTelegram } from '../../shared-ui/core/telegram.js';
import { loadGroupRole } from './data/schedule-repo.js';
import { todayString } from './domain/schedule-rules.js';
import { createCheckTab } from './tabs/check-tab.js';
import { createAddTab } from './tabs/add-tab.js';
import { createEditTab } from './tabs/edit-tab.js';
import { createTasksTab } from './tabs/tasks-tab.js';
import { createMakeupTab } from './tabs/makeup-tab.js';
import { createCompletionTab } from './tabs/completion-tab.js';

const TABS = [
    { key: 'check', label: 'Check Lịch' },
    { key: 'add', label: 'Thêm Lịch' },
    { key: 'edit', label: 'Sửa/Hủy' },
    { key: 'tasks', label: 'Nhiệm Vụ', tourOnly: true },
    { key: 'makeup', label: role => role === 'report_tour' ? 'Báo Bù' : 'Hoàn Tất Lịch', schedulingOnly: true }
];

const params = new URLSearchParams(location.search);
const updateId = params.get('action') === 'update' ? params.get('id') : null;

/** Ô chọn ngày dùng chung cho tab Check lịch và tab Nhiệm vụ. */
const dateInput = h('input', { type: 'date', class: 'form-control', value: todayString() });
const getDate = () => dateInput.value;

function wantedTab(payload) {
    if (updateId) return 'add';
    if (params.get('tab') === 'edit') return 'edit';
    if (params.get('tab') === 'makeup' || payload.startsWith('makeupclient_')) return 'makeup';
    return 'check';
}

function start() {
    initTelegram();

    const webApp = globalThis.Telegram?.WebApp;
    const payload = webApp?.initDataUnsafe?.start_param || params.get('payload') || '';

    // Vẽ khung trước, quyết định vai trò sau: mạng chậm cũng không để màn hình trắng.
    loadGroupRole()
        .then(role => render(role, payload))
        .catch(() => render(null, payload));
}

function render(role, payload) {
    const mount = el('app');
    const isTour = role === 'report_tour';
    const isScheduling = role === 'report' || isTour;

    const tabs = {
        check: createCheckTab({ dateInput, getDate }),
        add: createAddTab({
            isTour,
            updateId,
            onAdded: addedDate => {
                // Chỉ tải lại dòng thời gian khi lịch vừa thêm rơi đúng ngày đang xem.
                if (addedDate === getDate()) tabs.check.reload();
            }
        }),
        edit: createEditTab({ isTour, onChanged: () => tabs.check.reload() }),
        tasks: createTasksTab({ getDate }),
        makeup: isTour ? createMakeupTab() : createCompletionTab()
    };

    const visible = TABS.filter(tab =>
        (!tab.schedulingOnly || isScheduling) && (!tab.tourOnly || isTour));
    const requested = wantedTab(payload);
    const active = visible.some(tab => tab.key === requested) ? requested : 'check';

    const radios = {};
    const labels = [];
    const panels = [];

    for (const tab of visible) {
        const radio = h('input', {
            type: 'radio', name: 'tab', id: `radio-${tab.key}`, class: 'tab-radio',
            checked: tab.key === active,
            onChange: event => { if (event.target.checked) tabs[tab.key].onOpen?.(); }
        });
        radios[tab.key] = radio;
        labels.push(h('label', { class: 'tab-label', for: `radio-${tab.key}` },
            typeof tab.label === 'function' ? tab.label(role) : tab.label));
        panels.push(h('div', { id: `tab-${tab.key}`, class: 'tab-content' }, tabs[tab.key].node));
    }

    replaceChildren(mount,
        ...Object.values(radios),
        // Chế độ cập nhật ẩn thanh tab: nhân viên chỉ được sửa đúng lịch đã chọn.
        updateId ? null : h('div', { class: 'tabs' }, labels),
        ...panels
    );

    dateInput.addEventListener('change', () => {
        tabs.check.reload();
        if (radios.tasks?.checked) tabs.tasks.reload();
    });

    // Tab đang mở sẵn cũng phải được nạp dữ liệu.
    tabs[active]?.onOpen?.();

    // Mở thẳng vào Báo Bù thì KHÔNG nạp dòng thời gian và nhiệm vụ — giống bản cũ,
    // tránh ba request thừa khi nhân viên chỉ vào để báo bù.
    // Chế độ cập nhật cũng bỏ qua vì thanh tab đang bị ẩn.
    if (active !== 'makeup' && !updateId) {
        tabs.check.reload();
        if (radios.tasks) tabs.tasks.reload();
    }
}

start();
