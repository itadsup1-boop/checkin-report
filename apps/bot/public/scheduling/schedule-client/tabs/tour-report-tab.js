/**
 * Tab 1 — Báo Tour (dành riêng cho nhóm role `report_tour`).
 *
 * Cho phép KTV báo công tour nhanh: gợi ý từ lịch đặt trước, chọn khách cũ/mới,
 * chọn bác sĩ theo danh sách, tự điền tên KTV, tải ảnh chứng thực và gửi báo cáo.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { loadTodaySuggestions, loadKtvs, submitTourReport } from '../data/schedule-repo.js';
import { toCompressedDataUrl, MAKEUP_PHOTO_QUALITY } from '../media/photo.js';
import { card, sectionTitle, field, textInput, selectInput, button, createAlert } from '../ui/components.js';

export function createTourReportTab() {
    const alert = createAlert();
    let suggestions = [];
    let imageBase64 = '';
    let selectedAppointmentId = null;

    let savedDoctor = (typeof localStorage !== 'undefined' && localStorage.getItem('last_tour_doctor')) || '';
    if (savedDoctor === 'zsb dg' || savedDoctor.toLowerCase().includes('zsb')) {
        savedDoctor = '';
        try { localStorage.removeItem('last_tour_doctor'); } catch (_) {}
    }

    const KNOWN_KTVS = ['Bàn Thị Nhung', 'Huệ', 'Mỹ', 'Ngân', 'Trần Ngọc', 'Trần Phương Hoa', 'Trần Quang Trung'];
    const tgUser = globalThis.Telegram?.WebApp?.initDataUnsafe?.user;
    const tgFullName = [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ').trim();
    let initialKtv = (typeof localStorage !== 'undefined' && localStorage.getItem('last_tour_ktv1')) || '';
    if (!initialKtv && tgFullName) {
        const normTg = tgFullName.toLowerCase().replace(/\s+/g, '');
        const matched = KNOWN_KTVS.find(k => {
            const normK = k.toLowerCase().replace(/\s+/g, '');
            return normK === normTg || normK.includes(normTg) || normTg.includes(normK);
        });
        initialKtv = matched || tgFullName;
    }
    const initialOptions = [...KNOWN_KTVS];
    if (initialKtv && !initialOptions.includes(initialKtv)) {
        initialOptions.unshift(initialKtv);
    }

    const ktvDatalist = h('datalist', { id: 'tour-ktv-suggestions' },
        ...initialOptions.map(k => h('option', { value: k }))
    );

    const inputs = {
        customerName: textInput({ placeholder: 'Họ và tên khách hàng' }),
        phone: textInput({ type: 'tel', placeholder: 'Số điện thoại hoặc đuôi SĐT' }),
        customerType: selectInput({
            options: [
                { value: 'Khách cũ', label: 'Khách cũ' },
                { value: 'Khách mới', label: 'Khách mới' }
            ],
            value: 'Khách cũ'
        }),
        doctor: textInput({ placeholder: 'Tên bác sĩ phụ trách (VD: BS Tuấn)', value: savedDoctor }),
        service: textInput({ placeholder: 'Tên dịch vụ (dùng / để điền nhiều dịch vụ, VD: RF / Tái khám B2)' }),
        ktv1: textInput({ placeholder: 'Tên KTV 1 *', value: initialKtv }),
        ktv2: textInput({ placeholder: 'Tên KTV 2 (nếu có)' }),
        notes: textInput({ placeholder: 'Ghi chú thêm về ca tour (nếu có)' })
    };
    ['ktv1', 'ktv2'].forEach(k => { inputs[k].setAttribute('list', 'tour-ktv-suggestions'); inputs[k].setAttribute('autocomplete', 'off'); });
    inputs.doctor.setAttribute('autocomplete', 'off');

    inputs.ktv1.addEventListener('input', () => {
        if (typeof localStorage !== 'undefined') {
            const v = inputs.ktv1.value.trim();
            if (v) localStorage.setItem('last_tour_ktv1', v);
            else localStorage.removeItem('last_tour_ktv1');
        }
    });

    // Ô gợi ý lịch đặt trước
    const suggestionSelect = h('select', {
        class: 'form-control',
        onChange: event => onSelectSuggestion(event.target.value)
    }, h('option', { value: '' }, '-- Chọn từ lịch khách đã đặt hôm nay (nếu có) --'));

    const photoInput = h('input', {
        type: 'file', accept: 'image/*', class: 'form-control',
        onChange: event => onPhotoChosen(event.target.files[0])
    });

    const photoPreview = h('div', { style: { marginTop: '8px', display: 'none' } },
        h('img', {
            style: { maxWidth: '100%', maxHeight: '180px', borderRadius: '8px', objectFit: 'cover' }
        })
    );

    const submitBtn = button({
        label: '🚀 GỬI BÁO CÔNG TOUR',
        onClick: submit
    });

    /* ---------- Logic xử lý sự kiện ---------- */

    function onSelectSuggestion(id) {
        if (!id) {
            selectedAppointmentId = null;
            return;
        }
        const item = suggestions.find(s => String(s.id) === String(id));
        if (!item) return;

        selectedAppointmentId = item.id;
        inputs.customerName.value = item.customer_name || '';
        inputs.phone.value = item.phone || '';
        inputs.service.value = item.service || '';
        if (item.session_type === 'Mới') inputs.customerType.value = 'Khách mới';
        else inputs.customerType.value = 'Khách cũ';

        if (item.doctor) {
            inputs.doctor.value = item.doctor;
        }
    }

    async function onPhotoChosen(file) {
        if (!file) {
            imageBase64 = '';
            photoPreview.style.display = 'none';
            return;
        }
        alert.progress('Đang nén ảnh chứng thực...');
        try {
            imageBase64 = await toCompressedDataUrl(file, MAKEUP_PHOTO_QUALITY);
            const img = photoPreview.querySelector('img');
            img.src = imageBase64;
            photoPreview.style.display = 'block';
            alert.show('Đã chọn ảnh thành công!', false);
        } catch (_) {
            alert.show('Không thể xử lý ảnh này. Vui lòng chọn ảnh khác!');
            imageBase64 = '';
            photoPreview.style.display = 'none';
        }
    }

    async function submit() {
        const name = inputs.customerName.value.trim();
        const phone = inputs.phone.value.trim();
        const doc = inputs.doctor.value.trim();
        const service = inputs.service.value.trim();
        const ktv1 = inputs.ktv1.value.trim();
        const ktv2 = inputs.ktv2.value.trim();

        if (!name || !phone || !doc || !service || !ktv1 || !imageBase64) {
            alert.show('⚠️ Bắt buộc điền đủ tất cả các mục (*) kèm ảnh thực tế khách tại cơ sở để được tính 1 công tour.');
            (!name ? inputs.customerName : !phone ? inputs.phone : !doc ? inputs.doctor : !service ? inputs.service : !ktv1 ? inputs.ktv1 : photoInput).focus();
            return;
        }

        if (ktv1 && ktv2 && ktv1 === ktv2) {
            alert.show('KTV 1 và KTV 2 không thể là cùng một người!');
            inputs.ktv2.focus();
            return;
        }

        const ktvList = [ktv1];
        if (ktv2) ktvList.push(ktv2);

        submitBtn.disabled = true;
        submitBtn.textContent = 'Đang gửi báo tour...';

        try {
            const res = await submitTourReport({
                customerName: name,
                phone,
                customerType: inputs.customerType.value,
                doctor: doc,
                service,
                ktvNames: ktvList,
                appointmentId: selectedAppointmentId,
                notes: inputs.notes.value.trim(),
                imageBase64
            });

            if (res.success) {
                alert.show(res.message || 'Báo công tour thành công!', false);
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('last_tour_doctor', doc);
                    if (ktv1) localStorage.setItem('last_tour_ktv1', ktv1);
                }
                // Reset form
                inputs.customerName.value = '';
                inputs.phone.value = '';
                inputs.service.value = '';
                inputs.ktv2.value = '';
                inputs.notes.value = '';
                inputs.doctor.value = doc; // Giữ nguyên tên bác sĩ vừa điền cho các ca tiếp theo
                photoInput.value = '';
                photoPreview.style.display = 'none';
                imageBase64 = '';
                selectedAppointmentId = null;
                suggestionSelect.value = '';
                loadData(); // Tải lại gợi ý lịch
                return;
            }
            alert.show(res.error || 'Có lỗi xảy ra khi gửi báo tour');
        } catch (_) {
            alert.show('Lỗi kết nối máy chủ!');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '🚀 GỬI BÁO CÔNG TOUR';
        }
    }

    async function loadData() {
        try {
            const [sugList, ktvList] = await Promise.all([
                loadTodaySuggestions(),
                loadKtvs()
            ]);
            suggestions = sugList;

            // Đổ gợi ý lịch
            replaceChildren(suggestionSelect,
                h('option', { value: '' }, '-- Chọn từ lịch khách đã đặt hôm nay (nếu có) --'),
                ...sugList.map(s => h('option', { value: s.id },
                    `${s.customer_name} (${s.phone}) — ${s.service || 'Chưa có DV'} [${s.appointment_time ? s.appointment_time.slice(11, 16) : ''}]`
                ))
            );

            // Cập nhật danh sách gợi ý KTV từ server
            const names = ktvList.map(k => typeof k === 'object' ? k.name : k);
            const tgId = String(tgUser?.id || '');
            let matchedKtv = ktvList.userLastKtv || '';
            if (!matchedKtv && typeof localStorage !== 'undefined') {
                matchedKtv = localStorage.getItem('last_tour_ktv1') || '';
            }
            if (!matchedKtv && tgId) {
                const found = ktvList.find(k => typeof k === 'object' && k.telegram_id && String(k.telegram_id) === tgId);
                if (found) matchedKtv = found.name;
            }
            if (!matchedKtv && ktvList.userEmpName) matchedKtv = ktvList.userEmpName;
            if (!matchedKtv && tgFullName) matchedKtv = tgFullName;

            if (matchedKtv && !names.includes(matchedKtv)) {
                names.unshift(matchedKtv);
            }

            replaceChildren(ktvDatalist,
                ...names.map(name => h('option', { value: name }))
            );

            if ((!inputs.ktv1.value || inputs.ktv1.value === tgFullName) && matchedKtv) {
                inputs.ktv1.value = matchedKtv;
            }

            // Giữ lại tên bác sĩ đã điền lần trước nếu ô đang trống
            if (!inputs.doctor.value && typeof localStorage !== 'undefined') {
                const stored = localStorage.getItem('last_tour_doctor') || '';
                if (stored && stored !== 'zsb dg' && !stored.toLowerCase().includes('zsb')) {
                    inputs.doctor.value = stored;
                } else if (stored) {
                    try { localStorage.removeItem('last_tour_doctor'); } catch (_) {}
                }
            }
        } catch (e) {
            console.error('Lỗi tải dữ liệu gợi ý tour:', e);
        }
    }

    const node = h('div', { class: 'tab-inner' },
        alert.node,
        card(
            sectionTitle('💆‍♀️ BÁO CÔNG TOUR KTV'),
            field({ label: 'Gợi ý từ lịch đặt trước (nếu có)', input: suggestionSelect }),
            field({ label: 'Loại khách hàng *', input: inputs.customerType }),
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
            field({ label: 'Ảnh thực tế khách tại cơ sở *', input: photoInput }),
            photoPreview,
            field({ label: 'Ghi chú (nếu có)', input: inputs.notes }),
            h('div', { style: { marginTop: '20px' } }, submitBtn)
        )
    );

    return {
        node,
        onOpen: loadData
    };
}
