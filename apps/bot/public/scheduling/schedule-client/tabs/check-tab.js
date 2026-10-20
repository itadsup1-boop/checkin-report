/**
 * Tab 1 — Check lịch: xem toàn bộ lịch hẹn của một ngày.
 *
 * Ô chọn ngày dùng chung cho cả tab Nhiệm vụ (bản cũ cũng đọc chung
 * #checkDate), nên nó do app.js sở hữu và truyền vào đây.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { loadSchedules } from '../data/schedule-repo.js';
import { formatTime, isCancelled } from '../domain/schedule-rules.js';
import { card, loader, emptyText, timelineItem } from '../ui/components.js';

function scheduleRow(item) {
    const cancelled = isCancelled(item);

    return timelineItem({
        time: formatTime(item.appointment_time),
        dimmed: cancelled,
        children: [
            h('strong', { style: cancelled ? { textDecoration: 'line-through' } : null },
                item.customer_name,
                cancelled ? h('span', { class: 'tag tag--bad' }, ' (ĐÃ HỦY)') : null,
                item.status === 'ARRIVED' ? h('span', { class: 'tag tag--ok' }, ' (ĐÃ ĐẾN)') : null
            ),
            h('small', null,
                'NV Phụ trách: ', h('b', null, item.employee_name),
                item.session_type ? [' | Dạng buổi: ', h('b', null, item.session_type)] : null
            ),
            h('small', null, `SĐT: ${item.phone} | Dịch vụ: ${item.service || ''}`),
            item.today_incurred
                ? h('small', { class: 'incurred' }, `Phát sinh: ${item.today_incurred}`)
                : null
        ]
    });
}

/**
 * @param {object} params
 * @param {HTMLElement} params.dateInput ô chọn ngày dùng chung
 * @param {() => string} params.getDate
 */
export function createCheckTab({ dateInput, getDate }) {
    const list = h('div', null, emptyText('Vui lòng chọn ngày'));

    async function reload() {
        const date = getDate();
        if (!date) return;

        replaceChildren(list, loader());
        try {
            const items = await loadSchedules(date);
            replaceChildren(list,
                items.length
                    ? items.map(scheduleRow)
                    : emptyText('Trống! Chưa có ai đặt lịch ngày này.')
            );
        } catch (_) {
            replaceChildren(list, emptyText('Lỗi tải dữ liệu!', 'bad'));
        }
    }

    const node = card(
        h('div', { class: 'form-group' },
            h('label', null, 'Chọn ngày để xem lịch:'),
            dateInput
        ),
        list
    );

    return { node, reload };
}
