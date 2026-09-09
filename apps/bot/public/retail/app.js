/**
 * Retail Check-in Mini App Client Logic
 * Handles Telegram WebApp init, Geolocation, Photo Capture, KPI Progress, and History.
 */

let tg = null;
try {
    if (window.Telegram && window.Telegram.WebApp) {
        tg = window.Telegram.WebApp;
        tg.expand();
        tg.ready();
    }
} catch (e) {
    console.error('Lỗi khởi tạo Telegram WebApp:', e);
}

let telegramId = '';
let telegramGroupId = '';
let selfieBlob = null;
let storeBlobs = [];

// Đồng hồ thời gian thực
function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    document.getElementById('liveClock').textContent = timeStr;
    document.getElementById('liveDate').textContent = dateStr;
}
setInterval(updateClock, 1000);
updateClock();

const storeNameInput = document.getElementById('storeName');
const storeAddressInput = document.getElementById('storeAddress');
const btnSubmit = document.getElementById('btnSubmit');
const errorBanner = document.getElementById('errorBanner');
const errorTitle = document.getElementById('errorTitle');
const errorText = document.getElementById('errorText');

function showError(msg, customTitle) {
    if (!msg) return;
    let cleanMsg = String(msg).replace(/^([⚠️🚨❌\s]+)+/, '').trim();
    let title = customTitle || 'Không thể check-in';
    if (cleanMsg.toLowerCase().startsWith('không thể check-in:')) {
        title = 'Không thể check-in';
        cleanMsg = cleanMsg.substring('không thể check-in:'.length).trim();
    } else if (cleanMsg.toLowerCase().startsWith('cảnh báo:')) {
        title = 'Cảnh báo';
        cleanMsg = cleanMsg.substring('cảnh báo:'.length).trim();
    }
    if (errorTitle) errorTitle.textContent = title;
    errorText.textContent = cleanMsg;
    errorBanner.classList.add('show');
    errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideError() {
    errorBanner.classList.remove('show');
}

function validateForm() {
    const nameOk = storeNameInput.value.trim().length >= 2;
    const addressOk = storeAddressInput.value.trim().length >= 2;
    const photosOk = selfieBlob !== null || storeBlobs.length >= 1;
    btnSubmit.disabled = !(nameOk && addressOk && photosOk);
}

storeNameInput.addEventListener('input', () => { hideError(); validateForm(); });
storeAddressInput.addEventListener('input', () => { hideError(); validateForm(); });

// Xử lý chọn Ảnh 1: Selfie cổng
const boxSelfie = document.getElementById('boxSelfie');
const fileSelfie = document.getElementById('fileSelfie');
const previewSelfie = document.getElementById('previewSelfie');
const btnRemoveSelfie = document.getElementById('btnRemoveSelfie');

boxSelfie.addEventListener('click', (e) => {
    if (e.target === btnRemoveSelfie) return;
    fileSelfie.click();
});

fileSelfie.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    selfieBlob = file;
    const url = URL.createObjectURL(file);
    previewSelfie.src = url;
    boxSelfie.classList.add('has-file');
    hideError();
    validateForm();
});

btnRemoveSelfie.addEventListener('click', (e) => {
    e.stopPropagation();
    selfieBlob = null;
    fileSelfie.value = '';
    previewSelfie.src = '';
    boxSelfie.classList.remove('has-file');
    validateForm();
});

// Xử lý chọn Ảnh 2+: Quầy kệ đa ảnh
const boxStoreInitial = document.getElementById('boxStoreInitial');
const shelfGalleryBox = document.getElementById('shelfGalleryBox');
const shelfCountBadge = document.getElementById('shelfCountBadge');
const shelfGrid = document.getElementById('shelfGrid');
const fileStore = document.getElementById('fileStore');

function renderShelfGallery() {
    if (storeBlobs.length === 0) {
        boxStoreInitial.style.display = 'flex';
        shelfGalleryBox.classList.remove('show');
    } else {
        boxStoreInitial.style.display = 'none';
        shelfGalleryBox.classList.add('show');
        shelfCountBadge.textContent = `${storeBlobs.length} ảnh`;

        shelfGrid.innerHTML = '';
        storeBlobs.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'shelf-card';
            card.innerHTML = `
                <button type="button" class="shelf-card__remove" title="Xóa ảnh này" data-id="${item.id}">×</button>
                <img src="${item.url}" alt="Quầy kệ ${index + 1}">
                <span class="shelf-card__badge">Quầy #${index + 1}</span>
            `;
            card.querySelector('.shelf-card__remove').addEventListener('click', (e) => {
                e.stopPropagation();
                removeShelfPhoto(item.id);
            });
            shelfGrid.appendChild(card);
        });

        // Thêm ô bấm "+ Thêm ảnh" ngay trong lưới ảnh
        const addCard = document.createElement('div');
        addCard.className = 'shelf-card shelf-card--add';
        addCard.innerHTML = `
            <div class="shelf-card--add-icon">➕</div>
            <div class="shelf-card--add-text">Thêm ảnh<br>quầy kệ</div>
        `;
        addCard.addEventListener('click', () => {
            fileStore.click();
        });
        shelfGrid.appendChild(addCard);
    }
    validateForm();
}

function removeShelfPhoto(id) {
    const idx = storeBlobs.findIndex(b => b.id === id);
    if (idx !== -1) {
        try { URL.revokeObjectURL(storeBlobs[idx].url); } catch (_) {}
        storeBlobs.splice(idx, 1);
        renderShelfGallery();
    }
}

boxStoreInitial.addEventListener('click', () => {
    fileStore.click();
});

fileStore.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach(file => {
        const url = URL.createObjectURL(file);
        storeBlobs.push({
            id: Date.now() + Math.random(),
            file,
            url
        });
    });

    fileStore.value = '';
    hideError();
    renderShelfGallery();
});

function updateProgressUI(todayCount, target = 15) {
    const scoreText = document.getElementById('kpiScoreText');
    const fill = document.getElementById('kpiBarFill');
    const note = document.getElementById('kpiNoteText');
    const badge = document.getElementById('kpiStatusBadge');

    scoreText.innerHTML = `${todayCount} <span>/ ${target} điểm</span>`;
    const pct = Math.min(100, Math.round((todayCount / target) * 100));
    fill.style.width = `${pct}%`;

    if (todayCount >= target) {
        badge.textContent = '🎉 Đã đạt KPI';
        badge.style.background = '#10b981';
        note.textContent = 'Chúc mừng bạn đã hoàn thành chỉ tiêu 15 điểm hôm nay!';
    } else {
        const remain = target - todayCount;
        badge.textContent = 'Đang thực hiện';
        note.textContent = `Còn thiếu ${remain} điểm nữa để hoàn thành KPI hôm nay.`;
    }
}

// Khởi tạo và nạp dữ liệu tiến độ
async function bootstrap() {
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const u = tg.initDataUnsafe.user;
        telegramId = String(u.id);
        document.getElementById('userName').textContent = u.first_name + (u.last_name ? ' ' + u.last_name : '');
        const initials = (u.first_name || 'NV').slice(0, 2).toUpperCase();
        document.getElementById('userAvatar').textContent = initials;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const startParam = (tg && tg.initDataUnsafe ? tg.initDataUnsafe.start_param : null) || urlParams.get('payload') || urlParams.get('startapp') || urlParams.get('tgWebAppStartParam') || '';
    if (startParam) {
        const parts = startParam.split('_');
        if (parts.length >= 2) telegramGroupId = parts[1];
    }
    if (!telegramGroupId) {
        telegramGroupId = urlParams.get('chat_id') || urlParams.get('telegram_group_id') || '';
    }

    if (!telegramId) {
        // Thử lấy từ query params nếu test qua web
        telegramId = urlParams.get('telegram_id') || '';
    }

    if (!telegramId || !telegramGroupId) {
        document.getElementById('tgBlocker').classList.add('show');
        return;
    }

    try {
        const res = await fetch(`/api/retail-checkin/bootstrap?telegram_id=${telegramId}&chat_id=${telegramGroupId}`);
        const data = await res.json();
        if (data.ok) {
            if (data.employee && data.employee.fullName) {
                document.getElementById('userName').textContent = data.employee.fullName;
            }
            if (data.progress) {
                updateProgressUI(data.progress.todayCount, data.progress.target);
            }
            if (data.workingHours && !data.workingHours.isWorkingHour) {
                showError(data.workingHours.message, 'Lưu ý ca làm việc');
            }
        } else if (!data.isRegistered) {
            showError('Tài khoản của bạn chưa được Admin duyệt hồ sơ hoặc chưa đăng ký.');
            btnSubmit.disabled = true;
        }

        // Kiểm tra nếu có query param &tab=history hoặc action=retailhistory -> mở sẵn Tab Lịch Sử
        const activeTabParam = urlParams.get('tab') || (startParam.startsWith('retailhistory') ? 'history' : 'checkin');
        if (activeTabParam === 'history') {
            switchTab('history');
        }
    } catch (err) {
        console.warn('Không tải được bootstrap:', err);
    }

    // Kích hoạt tự động lấy toạ độ GPS ngay khi mở Mini App
    requestGpsLocation();
}

// ---------- XỬ LÝ ĐỊNH VỊ GPS ----------
let currentLatitude = null;
let currentLongitude = null;
let currentLocationAccuracy = null;
let isLocatingGps = false;

function updateGpsUI(status, errorMsg) {
    const card = document.getElementById('gpsCard');
    const badge = document.getElementById('gpsStatusBadge');
    const coordsText = document.getElementById('gpsCoordsText');
    const btnRefresh = document.getElementById('btnRefreshGps');
    const btnRefreshText = document.getElementById('btnRefreshGpsText');
    const mapLink = document.getElementById('linkGoogleMaps');

    if (!card || !badge || !coordsText) return;

    card.classList.remove('success', 'error');
    badge.classList.remove('acquiring', 'success', 'error');

    if (status === 'loading') {
        card.classList.remove('success', 'error');
        badge.classList.add('acquiring');
        badge.textContent = '⏳ Đang định vị...';
        coordsText.textContent = 'Đang kết nối vệ tinh GPS để lấy toạ độ cửa hàng...';
        if (btnRefresh) btnRefresh.classList.add('loading');
        if (btnRefreshText) btnRefreshText.textContent = 'Đang dò...';
        if (mapLink) mapLink.style.display = 'none';
    } else if (status === 'success') {
        card.classList.add('success');
        badge.classList.add('success');
        const accText = currentLocationAccuracy ? ` (±${Math.round(currentLocationAccuracy)}m)` : '';
        badge.textContent = `✓ Đã định vị${accText}`;
        coordsText.textContent = `📍 Toạ độ: ${currentLatitude.toFixed(6)}, ${currentLongitude.toFixed(6)}`;
        if (btnRefresh) btnRefresh.classList.remove('loading');
        if (btnRefreshText) btnRefreshText.textContent = 'Cập nhật lại';
        if (mapLink) {
            mapLink.href = `https://maps.google.com/?q=${currentLatitude},${currentLongitude}`;
            mapLink.style.display = 'inline-flex';
        }
    } else {
        card.classList.add('error');
        badge.classList.add('error');
        badge.textContent = '⚠️ Chưa có GPS';
        coordsText.textContent = errorMsg ? `Lỗi: ${errorMsg}` : 'Chưa lấy được toạ độ GPS. Vui lòng bật vị trí & bấm nút bên cạnh.';
        if (btnRefresh) btnRefresh.classList.remove('loading');
        if (btnRefreshText) btnRefreshText.textContent = 'Lấy vị trí';
        if (mapLink) mapLink.style.display = 'none';
    }
}

function requestGpsLocation() {
    if (isLocatingGps) return;
    isLocatingGps = true;
    updateGpsUI('loading');

    const handleSuccess = (coords) => {
        currentLatitude = coords.latitude;
        currentLongitude = coords.longitude;
        currentLocationAccuracy = coords.accuracy || null;
        isLocatingGps = false;
        updateGpsUI('success');
    };

    const handleError = (err) => {
        isLocatingGps = false;
        console.warn('[GPS Geolocation Error]:', err);
        const msg = err && err.message ? err.message : 'Không thể lấy toạ độ vị trí';
        updateGpsUI('error', msg);
    };

    // 1. Nếu Telegram WebApp hỗ trợ LocationManager (Bot API 8.0+)
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.LocationManager) {
        const lm = window.Telegram.WebApp.LocationManager;
        if (!lm.isInited) {
            try {
                lm.init(() => {
                    if (lm.isLocationAvailable) {
                        lm.getLocation((locationData) => {
                            if (locationData && locationData.latitude != null) {
                                handleSuccess({
                                    latitude: locationData.latitude,
                                    longitude: locationData.longitude,
                                    accuracy: locationData.horizontal_accuracy || null
                                });
                            } else {
                                fallbackHtml5Geo(handleSuccess, handleError);
                            }
                        });
                        return;
                    }
                    fallbackHtml5Geo(handleSuccess, handleError);
                });
                return;
            } catch (e) {
                console.warn('Telegram LocationManager error, falling back to HTML5:', e);
            }
        } else if (lm.isLocationAvailable) {
            try {
                lm.getLocation((locationData) => {
                    if (locationData && locationData.latitude != null) {
                        handleSuccess({
                            latitude: locationData.latitude,
                            longitude: locationData.longitude,
                            accuracy: locationData.horizontal_accuracy || null
                        });
                    } else {
                        fallbackHtml5Geo(handleSuccess, handleError);
                    }
                });
                return;
            } catch (e) {
                console.warn('Telegram LocationManager error, falling back to HTML5:', e);
            }
        }
    }

    // 2. HTML5 Geolocation thông thường
    fallbackHtml5Geo(handleSuccess, handleError);
}

function fallbackHtml5Geo(onSuccess, onError) {
    if (!navigator.geolocation) {
        onError(new Error('Thiết bị hoặc trình duyệt không hỗ trợ GPS'));
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            onSuccess({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            });
        },
        (err) => {
            let msg = 'Chưa cấp quyền truy cập GPS';
            if (err.code === 1) msg = 'Quyền vị trí bị từ chối';
            else if (err.code === 2) msg = 'Không bắt được tín hiệu GPS';
            else if (err.code === 3) msg = 'Hết thời gian chờ GPS';
            onError(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
}

document.getElementById('btnRefreshGps')?.addEventListener('click', () => {
    requestGpsLocation();
});

// ---------- XỬ LÝ CHUYỂN TAB (CHECK-IN / LỊCH SỬ) ----------
let currentTab = 'checkin';
function switchTab(tab) {
    currentTab = tab;
    const tabBtnCheckin = document.getElementById('tabBtnCheckin');
    const tabBtnHistory = document.getElementById('tabBtnHistory');
    const viewCheckin = document.getElementById('viewCheckin');
    const viewHistory = document.getElementById('viewHistory');
    const footbar = document.querySelector('.footbar');

    if (tab === 'history') {
        tabBtnCheckin.classList.remove('active');
        tabBtnHistory.classList.add('active');
        viewCheckin.style.display = 'none';
        viewHistory.style.display = 'block';
        if (footbar) footbar.style.display = 'none';
        hideError();
        loadHistory(selectedHistoryDate);
    } else {
        tabBtnCheckin.classList.add('active');
        tabBtnHistory.classList.remove('active');
        viewCheckin.style.display = 'block';
        viewHistory.style.display = 'none';
        if (footbar) footbar.style.display = 'block';
    }
}

// ---------- XỬ LÝ LỊCH SỬ CHECK-IN THEO NGÀY ----------
function getLocalDateString(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

let todayDateStr = getLocalDateString();
let selectedHistoryDate = todayDateStr;

function formatDisplayDate(dateStr) {
    if (!dateStr) return '--/--/----';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dt = new Date(y, m, d);
    const daysOfWeek = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const dayName = daysOfWeek[dt.getDay()];
    const formatted = `${String(d).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${y}`;
    if (dateStr === todayDateStr) {
        return `Hôm nay (${formatted})`;
    }
    return `${dayName}, ${formatted}`;
}

function changeHistoryDate(offsetDays) {
    const parts = selectedHistoryDate.split('-');
    const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    dt.setDate(dt.getDate() + offsetDays);
    selectedHistoryDate = getLocalDateString(dt);
    loadHistory(selectedHistoryDate);
}

function setHistoryDate(dateStr) {
    if (!dateStr) return;
    selectedHistoryDate = dateStr;
    loadHistory(selectedHistoryDate);
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function escapeAttr(text) {
    if (!text) return '';
    return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadHistory(dateStr) {
    const label = document.getElementById('historyDateLabel');
    const input = document.getElementById('historyDateInput');
    const listEl = document.getElementById('historyStoreList');
    const countEl = document.getElementById('historyListCount');
    const cardTitle = document.getElementById('historyCardDateTitle');
    const scoreText = document.getElementById('historyScoreText');
    const fill = document.getElementById('historyBarFill');
    const note = document.getElementById('historyNoteText');
    const badge = document.getElementById('historyStatusBadge');

    label.textContent = formatDisplayDate(dateStr);
    input.value = dateStr;
    cardTitle.textContent = `🎯 Tiến độ ngày ${formatDisplayDate(dateStr)}`;

    listEl.innerHTML = `
        <div style="text-align:center; padding:32px 16px; color:var(--faint);">
            <div class="spinner" style="border-top-color:var(--brand); margin:0 auto 10px;"></div>
            <div style="font-size:13px; font-weight:700">Đang tải danh sách điểm bán...</div>
        </div>
    `;

    if (!telegramId || !telegramGroupId) {
        listEl.innerHTML = `
            <div class="history-empty-state">
                <div class="history-empty-icon">⚠️</div>
                <div class="history-empty-title">Chưa kết nối Telegram</div>
                <div class="history-empty-sub">Vui lòng mở ứng dụng từ trong nhóm chat Telegram.</div>
            </div>
        `;
        return;
    }

    try {
        const res = await fetch(`/api/retail-checkin/history?telegram_id=${telegramId}&chat_id=${telegramGroupId}&date=${dateStr}`);
        const data = await res.json();

        if (!data.ok) {
            listEl.innerHTML = `
                <div class="history-empty-state">
                    <div class="history-empty-icon">⚠️</div>
                    <div class="history-empty-title">Không thể tải dữ liệu</div>
                    <div class="history-empty-sub">${escapeHtml(data.message || 'Lỗi kết nối máy chủ')}</div>
                </div>
            `;
            return;
        }

        const s = data.summary;
        scoreText.innerHTML = `${s.validCount} <span>/ ${s.target} điểm</span>`;
        fill.style.width = `${s.progressPercent}%`;

        if (s.validCount >= s.target) {
            badge.textContent = '🎉 Đã đạt KPI';
            badge.style.background = '#10b981';
            fill.style.background = '#10b981';
            note.textContent = `Chúc mừng bạn đã hoàn thành xuất sắc chỉ tiêu ${s.target} điểm bán trong ngày!`;
        } else {
            fill.style.background = '#0ea5e9';
            if (dateStr < todayDateStr) {
                badge.textContent = `⚠️ Thiếu ${s.remaining} điểm`;
                badge.style.background = '#f59e0b';
                note.textContent = `Chưa hoàn thành chỉ tiêu (${s.validCount}/${s.target} điểm) - Còn thiếu ${s.remaining} điểm.`;
            } else {
                badge.textContent = 'Đang thực hiện';
                badge.style.background = '#0ea5e9';
                note.textContent = `Còn thiếu ${s.remaining} điểm nữa để hoàn thành chỉ tiêu ${s.target} điểm hôm nay.`;
            }
        }

        countEl.textContent = `${data.checkins.length} điểm`;

        if (data.checkins.length === 0) {
            listEl.innerHTML = `
                <div class="history-empty-state">
                    <div class="history-empty-icon">📭</div>
                    <div class="history-empty-title">Chưa có lượt check-in nào</div>
                    <div class="history-empty-sub">Không có điểm bán nào được ghi nhận trong ngày ${data.displayDate}.</div>
                </div>
            `;
            return;
        }

        let html = '';
        data.checkins.forEach((c) => {
            const statusBadgeHtml = c.isValid
                ? `<span style="font-size:11px; font-weight:800; color:#10b981; background:rgba(16,185,129,0.12); padding:3px 8px; border-radius:4px">✓ Hợp lệ</span>`
                : `<span style="font-size:11px; font-weight:800; color:#ef4444; background:rgba(239,68,68,0.12); padding:3px 8px; border-radius:4px">✕ Không hợp lệ</span>`;

            html += `
                <div class="history-store-card">
                    <div class="store-card__top">
                        <div class="store-card__order-name">
                            <span class="store-card__order-badge">#${c.orderNumber}</span>
                            <span class="store-card__name" title="${escapeAttr(c.storeName)}">${escapeHtml(c.storeName)}</span>
                        </div>
                        <span class="store-card__time-badge">⏰ ${c.timeFormatted}</span>
                    </div>
                    <div class="store-card__address">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--brand)">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        <span>${escapeHtml(c.storeAddress)}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; gap:8px; flex-wrap:wrap">
                        ${c.googleMapsUrl ? `
                            <a href="${escapeAttr(c.googleMapsUrl)}" target="_blank" rel="noopener noreferrer" class="history-gps-link" title="Xem trên Google Maps">
                                📍 Xem vị trí GPS ${c.locationAccuracy ? `(±${Math.round(c.locationAccuracy)}m)` : ''}
                            </a>
                        ` : '<span></span>'}
                        ${statusBadgeHtml}
                    </div>
                </div>
            `;
        });

        listEl.innerHTML = html;
    } catch (err) {
        console.error('[Retail History Fetch Error]:', err);
        listEl.innerHTML = `
            <div class="history-empty-state">
                <div class="history-empty-icon">⚠️</div>
                <div class="history-empty-title">Lỗi kết nối</div>
                <div class="history-empty-sub">Không thể kết nối đến máy chủ. Vui lòng thử lại.</div>
            </div>
        `;
    }
}

// Lightbox Modal
const lightboxModal = document.getElementById('lightboxModal');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxTitle = document.getElementById('lightboxTitle');
const btnCloseLightbox = document.getElementById('btnCloseLightbox');

function openLightbox(src, title) {
    lightboxImage.src = src;
    lightboxTitle.textContent = title || 'Ảnh điểm bán';
    lightboxModal.classList.add('show');
}
function closeLightbox() {
    lightboxModal.classList.remove('show');
    lightboxImage.src = '';
}
btnCloseLightbox.addEventListener('click', closeLightbox);
lightboxModal.addEventListener('click', (e) => {
    if (e.target === lightboxModal) closeLightbox();
});

// Event listeners điều hướng ngày
document.getElementById('btnPrevDate').addEventListener('click', () => changeHistoryDate(-1));
document.getElementById('btnNextDate').addEventListener('click', () => changeHistoryDate(1));
document.getElementById('btnToday').addEventListener('click', () => setHistoryDate(todayDateStr));
document.getElementById('historyDateInput').addEventListener('change', function () {
    setHistoryDate(this.value);
});
document.getElementById('btnRefreshHistory').addEventListener('click', () => loadHistory(selectedHistoryDate));

document.addEventListener('DOMContentLoaded', bootstrap);

// Gửi Check-in
btnSubmit.addEventListener('click', async function () {
    if (this.disabled) return;

    const name = storeNameInput.value.trim();
    const address = storeAddressInput.value.trim();

    if (!name || !address || (!selfieBlob && storeBlobs.length < 1)) {
        showError('Vui lòng điền đầy đủ tên điểm bán, địa chỉ và chụp ít nhất 1 ảnh minh chứng!');
        return;
    }

    hideError();
    this.disabled = true;
    const originalContent = this.innerHTML;
    this.innerHTML = '<div class="spinner"></div> Đang gửi check-in...';

    const formData = new FormData();
    formData.append('telegram_id', telegramId);
    formData.append('chat_id', telegramGroupId);
    formData.append('store_name', name);
    formData.append('store_address', address);
    if (currentLatitude != null && currentLongitude != null) {
        formData.append('latitude', currentLatitude);
        formData.append('longitude', currentLongitude);
        if (currentLocationAccuracy != null) {
            formData.append('location_accuracy', currentLocationAccuracy);
        }
    }
    if (selfieBlob) {
        formData.append('photo_selfie', selfieBlob, 'selfie.jpg');
    }
    storeBlobs.forEach((item, idx) => {
        formData.append('photo_store', item.file, `store_${idx + 1}.jpg`);
    });

    try {
        const res = await fetch('/api/retail-checkin/submit', {
            method: 'POST',
            headers: {
                'x-telegram-init-data': tg && tg.initData ? tg.initData : ''
            },
            body: formData
        });

        const data = await res.json();

        if (data.ok && data.success) {
            // Cập nhật thẻ KPI
            if (data.progress) {
                updateProgressUI(data.progress.todayCount, data.progress.target);
            }

            // Hiện Modal Thành Công
            document.getElementById('successStoreName').textContent = name;
            document.getElementById('successStoreAddress').textContent = address;
            document.getElementById('successProgressText').textContent =
                `🎯 Tiến độ hôm nay: ${data.progress.todayCount} / ${data.progress.target} điểm`;
            document.getElementById('successOverlay').classList.add('show');
        } else {
            showError(data.message || 'Đã có lỗi xảy ra khi gửi check-in!');
            this.disabled = false;
            this.innerHTML = originalContent;
            validateForm();
        }
    } catch (err) {
        console.error(err);
        showError('Lỗi kết nối máy chủ! Vui lòng kiểm tra lại mạng.');
        this.disabled = false;
        this.innerHTML = originalContent;
        validateForm();
    }
});

// Nút tiếp tục sau khi check-in thành công
document.getElementById('btnContinue').addEventListener('click', () => {
    document.getElementById('successOverlay').classList.remove('show');
    // Reset form cho điểm bán tiếp theo
    storeNameInput.value = '';
    storeAddressInput.value = '';
    btnRemoveSelfie.click();
    storeBlobs.forEach(b => { try { URL.revokeObjectURL(b.url); } catch (_) {} });
    storeBlobs = [];
    renderShelfGallery();
    btnSubmit.innerHTML = '<span>Xác nhận Check-in</span>';
    btnSubmit.disabled = true;
    // Làm mới toạ độ GPS cho điểm bán kế tiếp
    requestGpsLocation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

document.getElementById('btnCloseApp').addEventListener('click', () => {
    if (tg) tg.close();
});
