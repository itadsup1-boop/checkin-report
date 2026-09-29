/**
 * Tab 2 — Sửa Công Tour (dành riêng cho nhóm role `report_tour`).
 *
 * Cho phép KTV chỉnh sửa lại thông tin các ca tour đã báo nếu lỡ nhập nhầm
 * (tên khách, SĐT, KTV, bác sĩ, dịch vụ, hoặc đổi ảnh).
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { loadRecentTours, updateTourReport, loadKtvs } from '../data/schedule-repo.js';
import { toCompressedDataUrl, MAKEUP_PHOTO_QUALITY } from '../media/photo.js';
import { card, sectionTitle, field, textInput, selectInput, button, createAlert, loader, emptyText, badge } from '../ui/components.js';

export function createTourEditTab() {
    const alert = createAlert();
    let tours = [];
    let editingItem = null;
    let newImageBase64 = '';

    const listContainer = h('div');
    const editContainer = h('div', { style: { display: 'none' } });

    // Các ô nhập ở form sửa
    const inputs = {
        customerName: textInput({ placeholder: 'Tên khách hàng' }),
        phone: textInput({ type: 'tel', placeholder: 'Số điện thoại' }),
        customerType: selectInput({
            options: [
                { value: 'Khách cũ', label: 'Khách cũ' },
                { value: 'Khách mới', label: 'Khách mới' }
            ],
            value: 'Khách cũ'
        }),
        doctor: textInput({ placeholder: 'Tên bác sĩ' }),
        service: textInput({ placeholder: 'Tên dịch vụ (dùng / để điền nhiều dịch vụ, VD: RF / Tái khám B2)' }),
        ktv1: textInput({ placeholder: 'Tên KTV 1 *' }),
        ktv2: textInput({ placeholder: 'Tên KTV 2 (nếu có)' }),
        notes: textInput({ placeholder: 'Ghi chú thêm về ca tour (nếu có)' })
    };
    const ktvDatalist = h('datalist', { id: 'tour-edit-ktv-suggestions' });
    inputs.ktv1.setAttribute('list', 'tour-edit-ktv-suggestions');
    inputs.ktv2.setAttribute('list', 'tour-edit-ktv-suggestions');
    inputs.ktv1.setAttribute('autocomplete', 'off');
    inputs.ktv2.setAttribute('autocomplete', 'off');
    inputs.doctor.setAttribute('autocomplete', 'off');

    const photoInput = h('input', {
        type: 'file', accept: 'image/*', class: 'form-control',
        onChange: event => onPhotoChosen(event.target.files[0])
    });

    const photoPreview = h('div', { style: { marginTop: '8px' } },
        h('img', {
            style: { maxWidth: '100%', maxHeight: '160px', borderRadius: '8px', objectFit: 'cover' }
        })
    );

    const saveBtn = button({ label: '💾 LƯU THAY ĐỔI', onClick: saveEdit });
    const cancelBtn = button({
        label: '↩️ Quay lại danh sách',
        class: 'btn-secondary',
        onClick: cancelEdit
    });

    async function onPhotoChosen(file) {
        if (!file) return;
        alert.progress('Đang nén ảnh...');
        try {
            newImageBase64 = await toCompressedDataUrl(file, MAKEUP_PHOTO_QUALITY);
            photoPreview.querySelector('img').src = newImageBase64;
            alert.show('Đã chọn ảnh mới!', false);
        } catch (_) {
            alert.show('Lỗi xử lý ảnh mới!');
        }
    }

    function openEdit(item) {
        editingItem = item;
        inputs.customerName.value = item.customer_name || '';
        inputs.phone.value = item.phone || '';
        inputs.customerType.value = item.customer_type || 'Khách cũ';
        inputs.doctor.value = item.doctor || '';
        inputs.service.value = item.service || '';

        const ktvs = Array.isArray(item.ktv_names) ? item.ktv_names : [];
        inputs.ktv1.value = ktvs[0] || '';
        inputs.ktv2.value = ktvs[1] || '';
        inputs.notes.value = item.notes || '';

        newImageBase64 = '';
        photoInput.value = '';
        if (item.photo_url) {
            photoPreview.querySelector('img').src = item.photo_url;
            photoPreview.style.display = 'block';
        } else {
            photoPreview.style.display = 'none';
        }

        listContainer.style.display = 'none';
        editContainer.style.display = 'block';
    }

    function cancelEdit() {
        editingItem = null;
        editContainer.style.display = 'none';
        listContainer.style.display = 'block';
    }

    async function saveEdit() {
        if (!editingItem) return;
        const name = inputs.customerName.value.trim();
        const phone = inputs.phone.value.trim();
        const ktv1 = inputs.ktv1.value.trim();
        const ktv2 = inputs.ktv2.value.trim();

        const doctorVal = inputs.doctor.value.trim();
        const serviceVal = inputs.service.value.trim();
        const hasPhoto = !!(editingItem.photo_url || newImageBase64);

        if (!name || !phone || !doctorVal || !serviceVal || !ktv1 || !hasPhoto) {
            alert.show('⚠️ Bắt buộc điền đủ tất cả các mục (*) kèm ảnh thực tế khách tại cơ sở để được tính 1 công tour.');
            if (!name) inputs.customerName.focus();
            else if (!phone) inputs.phone.focus();
            else if (!doctorVal) inputs.doctor.focus();
            else if (!serviceVal) inputs.service.focus();
            else if (!ktv1) inputs.ktv1.focus();
            else if (!hasPhoto) photoInput.focus();
            return;
        }

        if (ktv1 && ktv2 && ktv1 === ktv2) {
            alert.show('KTV 1 và KTV 2 không thể là cùng một người!');
            inputs.ktv2.focus();
            return;
        }

        const ktvList = [ktv1];
        if (ktv2) ktvList.push(ktv2);

        saveBtn.disabled = true;
        saveBtn.textContent = 'Đang lưu...';

        try {
            const res = await updateTourReport(editingItem.id, {
                customerName: name,
                phone,
                customerType: inputs.customerType.value,
                doctor: inputs.doctor.value.trim(),
                service: inputs.service.value.trim(),
                ktvNames: ktvList,
                notes: inputs.notes.value.trim(),
                imageBase64: newImageBase64 || undefined
            });

            if (res.success) {
                alert.show('Cập nhật công tour thành công!', false);
                cancelEdit();
                loadData();
                return;
            }
            alert.show(res.error || 'Có lỗi khi cập nhật');
        } catch (_) {
            alert.show('Lỗi kết nối máy chủ!');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 LƯU THAY ĐỔI';
        }
    }

    async function loadData() {
        replaceChildren(listContainer, loader());
        try {
            const [tourList, ktvList] = await Promise.all([
                loadRecentTours(),
                loadKtvs()
            ]);
            tours = tourList;
            replaceChildren(ktvDatalist,
                ...ktvList.map(k => {
                    const name = typeof k === 'object' ? k.name : k;
                    return h('option', { value: name });
                })
            );
            if (tours.length === 0) {
                replaceChildren(listContainer, h('div', {
                    class: 'card',
                    style: { textAlign: 'center', padding: '24px 16px', color: '#64748b' }
                },
                    h('div', { style: { fontSize: '28px', marginBottom: '8px' } }, '📝'),
                    h('strong', { style: { fontSize: '15px', color: '#1e293b' } }, 'Chưa có ca báo tour nào của bạn'),
                    h('p', { style: { fontSize: '13px', margin: '8px 0 16px', lineHeight: '1.4' } },
                        'Bạn chỉ xem và sửa các ca tour do chính mình báo trong nhóm này. Khi có ca bạn đã gửi, ca đó sẽ xuất hiện tại đây.'
                    ),
                    h('button', {
                        type: 'button',
                        class: 'btn',
                        style: { maxWidth: '220px', margin: '0 auto' },
                        onClick: () => {
                            const r = document.getElementById('radio-tour');
                            if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
                        }
                    }, '💆‍♀️ Sang tab Báo Tour')
                ));
                return;
            }

            const items = tours.map(t => {
                const ktvs = Array.isArray(t.ktv_names) ? t.ktv_names.join(', ') : '';
                const credit = t.tour_credit ? `${t.tour_credit} tour` : '';
                return h('div', {
                    class: 'card',
                    style: { cursor: 'pointer', marginBottom: '12px', padding: '12px', borderLeft: '4px solid var(--accent, #2481cc)' },
                    onClick: () => openEdit(t)
                },
                    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
                        h('strong', { style: { fontSize: '15px' } }, `${t.customer_name} (${t.phone || 'Không SĐT'})`),
                        badge(credit, 'green')
                    ),
                    h('div', { style: { fontSize: '13px', color: '#555', lineHeight: '1.4' } },
                        h('div', null, `📅 Ngày: ${t.report_date} | Loại: ${t.customer_type || 'Khách cũ'}`),
                        h('div', null, `🩺 DV: ${t.service || 'Chưa nhập'}`),
                        t.doctor ? h('div', null, `👨‍⚕️ Bác sĩ: ${t.doctor}`) : null,
                        h('div', null, `💆‍♀️ KTV: <b>${ktvs}</b>`),
                        t.notes ? h('div', null, `📝 Ghi chú: ${t.notes}`) : null
                    ),
                    h('div', { style: { marginTop: '8px', textAlign: 'right' } },
                        h('span', { style: { color: 'var(--accent, #2481cc)', fontSize: '12px', fontWeight: 'bold' } }, '✏️ Bấm để sửa')
                    )
                );
            });

            replaceChildren(listContainer, ...items);
        } catch (e) {
            console.error('Lỗi tải danh sách tour:', e);
            replaceChildren(listContainer, emptyText('Lỗi kết nối khi tải danh sách tour.'));
        }
    }

    // Giao diện chỉnh sửa
    replaceChildren(editContainer, card(
        sectionTitle('✏️ CHỈNH SỬA CÔNG TOUR'),
        field({ label: 'Loại khách hàng', input: inputs.customerType }),
        h('div', { style: { display: 'flex', gap: '8px' } },
            h('div', { style: { flex: 1 } }, field({ label: 'Tên khách hàng *', input: inputs.customerName })),
            h('div', { style: { flex: 1 } }, field({ label: 'Số điện thoại *', input: inputs.phone }))
        ),
        field({ label: 'Bác sĩ phụ trách *', input: inputs.doctor }),
        field({ label: 'Tên dịch vụ *', input: inputs.service }),
        ktvDatalist,
        h('div', { style: { display: 'flex', gap: '8px' } },
            h('div', { style: { flex: 1 } }, field({ label: 'KTV 1 *', input: inputs.ktv1 })),
            h('div', { style: { flex: 1 } }, field({ label: 'KTV 2', input: inputs.ktv2 }))
        ),
        field({ label: 'Cập nhật lại ảnh chứng thực (nếu cần)', input: photoInput }),
        photoPreview,
        field({ label: 'Ghi chú (nếu có)', input: inputs.notes }),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } },
            h('div', { style: { flex: 1 } }, saveBtn),
            h('div', { style: { flex: 1 } }, cancelBtn)
        )
    ));

    const node = h('div', { class: 'tab-inner' },
        alert.node,
        h('div', { class: 'section-header', style: { marginBottom: '12px' } },
            sectionTitle('✏️ SỬA CÔNG TOUR ĐÃ BÁO'),
            h('p', { class: 'text-muted', style: { fontSize: '13px' } }, 'Danh sách ca tour do bạn báo hoặc thực hiện. Bấm vào ca để sửa thông tin.')
        ),
        listContainer,
        editContainer
    );

    return {
        node,
        onOpen: () => {
            cancelEdit();
            loadData();
        }
    };
}
