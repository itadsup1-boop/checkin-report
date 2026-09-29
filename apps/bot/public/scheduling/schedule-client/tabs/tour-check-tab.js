/**
 * Tab 3 — Check Công Tour (dành riêng cho nhóm role `report_tour`).
 *
 * Màn hình thống kê công tour cá nhân:
 *   - Số tour hôm nay
 *   - Số tour tháng này
 *   - Tổng số lượng công tour đã hoàn thành
 *   - Danh sách chi tiết các ca theo ngày đã chọn.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { loadTourStats } from '../data/schedule-repo.js';
import { todayString } from '../domain/schedule-rules.js';
import { card, sectionTitle, field, createAlert, loader, emptyText, badge } from '../ui/components.js';

export function createTourCheckTab() {
    const alert = createAlert();
    const dateInput = h('input', {
        type: 'date',
        class: 'form-control',
        value: todayString(),
        onChange: () => loadData()
    });

    const statCardsContainer = h('div');
    const toursListContainer = h('div');

    function renderStatCard(icon, title, value, unit, color) {
        return h('div', {
            style: {
                flex: '1',
                minWidth: '95px',
                padding: '12px 8px',
                borderRadius: '12px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                textAlign: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
            }
        },
            h('div', { style: { fontSize: '20px', marginBottom: '4px' } }, icon),
            h('div', { style: { fontSize: '11px', color: '#64748b', fontWeight: '500' } }, title),
            h('div', { style: { fontSize: '18px', fontWeight: 'bold', color: color || '#1e293b', marginTop: '2px' } }, `${value}`),
            h('div', { style: { fontSize: '10px', color: '#94a3b8' } }, unit)
        );
    }

    async function loadData() {
        replaceChildren(statCardsContainer, loader());
        replaceChildren(toursListContainer, loader());

        try {
            const date = dateInput.value || todayString();
            const stats = await loadTourStats(date);

            // 1. Render 3 thẻ thống kê
            replaceChildren(statCardsContainer,
                h('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' } },
                    renderStatCard('📅', 'Hôm nay', stats.todayCredit, 'công tour', '#2563eb'),
                    renderStatCard('🗓️', 'Tháng này', stats.monthCredit, 'công tour', '#0891b2'),
                    renderStatCard('🏆', 'Tổng hoàn thành', stats.totalCredit, `${stats.totalCount || 0} ca`, '#059669')
                )
            );

            // 2. Render danh sách ca tour trong ngày
            const tours = stats.tours || [];
            if (tours.length === 0) {
                replaceChildren(toursListContainer, emptyText(`Chưa có ca công tour nào trong ngày ${date}.`));
                return;
            }

            const items = tours.map((t, idx) => {
                const ktvs = Array.isArray(t.ktv_names) ? t.ktv_names.join(', ') : '';
                const creditStr = t.tour_credit === 1 ? '1 công' : `${t.tour_credit} công`;
                return h('div', {
                    class: 'card',
                    style: { marginBottom: '10px', padding: '12px' }
                },
                    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
                        h('strong', { style: { fontSize: '14px' } }, `${idx + 1}. ${t.customer_name} (${t.phone || 'SĐT: -'})`),
                        badge(`+${creditStr}`, 'green')
                    ),
                    h('div', { style: { fontSize: '12px', color: '#475569', lineHeight: '1.5' } },
                        h('div', null, `🏷️ Loại khách: <b>${t.customer_type || 'Khách cũ'}</b>`),
                        h('div', null, `🩺 Dịch vụ: <b>${t.service || 'Chưa nhập'}</b>`),
                        t.doctor ? h('div', null, `👨‍⚕️ Bác sĩ: ${t.doctor}`) : null,
                        h('div', null, `💆‍♀️ KTV: <b>${ktvs}</b>`),
                        t.notes ? h('div', null, `📝 Ghi chú: ${t.notes}`) : null
                    ),
                    t.photo_url ? h('div', { style: { marginTop: '8px' } },
                        h('img', {
                            src: t.photo_url,
                            style: { maxHeight: '100px', borderRadius: '6px', objectFit: 'cover' }
                        })
                    ) : null,
                    h('div', { style: { marginTop: '8px', textAlign: 'right' } },
                        h('button', {
                            type: 'button',
                            style: {
                                padding: '3px 8px', fontSize: '11px', background: 'transparent',
                                border: '1px solid var(--accent, #2481cc)', color: 'var(--accent, #2481cc)',
                                borderRadius: '4px', cursor: 'pointer'
                            },
                            onClick: () => {
                                const r = document.getElementById('radio-edit_tour');
                                if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
                            }
                        }, '✏️ Sửa ca này')
                    )
                );
            });

            replaceChildren(toursListContainer,
                h('div', { style: { fontWeight: 'bold', fontSize: '14px', marginBottom: '8px' } },
                    `📋 Danh sách chi tiết ngày ${date} (${tours.length} ca):`
                ),
                ...items
            );
        } catch (err) {
            console.error('Lỗi tải thống kê tour:', err);
            replaceChildren(statCardsContainer, emptyText('Lỗi kết nối khi tải số liệu.'));
            replaceChildren(toursListContainer, emptyText('Lỗi tải danh sách ca tour.'));
        }
    }

    const node = h('div', { class: 'tab-inner' },
        alert.node,
        card(
            sectionTitle('📊 THỐNG KÊ CÔNG TOUR'),
            statCardsContainer,
            field({ label: 'Xem chi tiết theo ngày', input: dateInput }),
            toursListContainer
        )
    );

    return {
        node,
        onOpen: loadData
    };
}
