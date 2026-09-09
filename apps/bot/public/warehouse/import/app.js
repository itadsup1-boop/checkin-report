/**
 * Điều phối Mini App nhập kho.
 *
 * Nhiệm vụ: xác thực, nạp danh mục thật, chuyển giữa 4 bước, và gọi API gửi phiếu.
 * Không chứa quy tắc nghiệp vụ (nằm ở domain/) và không dựng markup (nằm ở ui/, steps/).
 *
 * State của phiếu (cơ sở, danh sách, ảnh) giữ ở đây chứ không ở từng bước, để nhân
 * sự đi qua lại giữa các bước mà không mất dữ liệu đã nhập.
 */

import { h, replaceChildren, el } from '../../shared-ui/core/dom.js';
import { initTelegram, isInsideTelegram, alertUser, notifySuccess, notifyError } from '../../shared-ui/core/telegram.js';
import { configureWarehouseApi, launchParams } from '../../shared-ui/core/api.js';
import { openScanner } from '../../shared-ui/ui/scanner.js';
import { loadProducts, toBarcodeOwners, submitImport } from './data/import-repo.js';
import { addItem, removeItem, toApiItems, checkStep, totalQuantity } from './domain/import-draft.js';
import { compressAll, formatKb } from './media/image-compressor.js';
import { topBar, stepDots, bottomBar, button, loadingScreen, errorScreen } from './ui/components.js';
import { createBranchStep } from './steps/branch-step.js';
import { createProductsStep } from './steps/products-step.js';
import { createPhotosStep } from './steps/photos-step.js';
import { createConfirmStep } from './steps/confirm-step.js';
import { createScanSheet } from './steps/scan-sheet.js';
import { createManualAddSheet } from './steps/manual-add-sheet.js';
import { createItemsSheet } from './steps/items-sheet.js';
import { createDoneScreen } from './steps/done-screen.js';

configureWarehouseApi({ action: 'whimport' });

const STEPS = [
    { key: 'branch', title: 'Cơ sở nhận hàng' },
    { key: 'products', title: 'Thêm sản phẩm' },
    { key: 'photos', title: 'Ảnh minh chứng' },
    { key: 'confirm', title: 'Xác nhận nhập kho' }
];

const mount = el('app');

const state = {
    stepIndex: 0,
    branch: null,
    items: [],
    photos: [],
    products: [],
    barcodeOwners: new Map(),
    submitting: false
};

const getItems = () => state.items;
const getPhotos = () => state.photos;

/* ---------- Vùng hiển thị ---------- */

const topSlot = h('div');
const bodySlot = h('div', { class: 'body' });
const footSlot = h('div');
const sheetSlot = h('div');

/* ---------- Sheet ---------- */

function closeSheet() {
    replaceChildren(sheetSlot);
}

function openSheet(node) {
    replaceChildren(sheetSlot, node);
}

function onItemAdded(item) {
    state.items = addItem(state.items, item);
    renderStep();
    renderFoot();
}

function openScanFlow() {
    openScanner({
        onDetected: code => {
            if (!code) return;
            openSheet(createScanSheet({
                barcode: code,
                onConfirm: item => {
                    onItemAdded(item);
                    closeSheet();
                    // Quét tiếp ngay: nhân sự thường nhập nhiều mặt hàng một lượt.
                    openScanFlow();
                },
                onClose: closeSheet,
                onScanAgain: openScanFlow
            }));
        }
    });
}

function openManualFlow() {
    openSheet(createManualAddSheet({
        products: state.products,
        barcodeOwners: state.barcodeOwners,
        getItems,
        onAdd: onItemAdded,
        onClose: closeSheet
    }));
}

function openItemsList() {
    openSheet(createItemsSheet({
        getItems,
        onRemove: index => {
            state.items = removeItem(state.items, index);
            renderStep();
            renderFoot();
        },
        onClose: closeSheet
    }));
}

/* ---------- Ảnh ---------- */

function addPhotos(files) {
    for (const file of files) {
        state.photos.push({
            id: `${file.name}-${file.size}-${state.photos.length}`,
            file,
            url: URL.createObjectURL(file)
        });
    }
    renderFoot();
}

function removePhoto(id) {
    const photo = state.photos.find(current => current.id === id);
    // Thu hồi blob URL để ảnh 5MB không nằm lại trong bộ nhớ WebView.
    if (photo) URL.revokeObjectURL(photo.url);
    state.photos = state.photos.filter(current => current.id !== id);
    renderFoot();
}

/* ---------- Điều hướng ---------- */

let confirmStep = null;

function goNext() {
    const step = STEPS[state.stepIndex];
    const verdict = checkStep(step.key, state);
    if (!verdict.ok) {
        alertUser(verdict.reason);
        return;
    }
    if (state.stepIndex < STEPS.length - 1) {
        state.stepIndex += 1;
        render();
    }
}

function goBack() {
    if (state.stepIndex === 0) return;
    state.stepIndex -= 1;
    render();
}

/* ---------- Gửi phiếu ---------- */

async function submit() {
    if (state.submitting) return;

    // Kiểm lại cả ba điều kiện: nhân sự có thể đã xóa hết ảnh rồi lùi/tiến bước.
    for (const step of STEPS) {
        const verdict = checkStep(step.key, state);
        if (!verdict.ok) {
            alertUser(verdict.reason);
            return;
        }
    }

    state.submitting = true;
    renderFoot();

    try {
        confirmStep?.setProgress(0, 'Đang nén ảnh minh chứng…');
        const files = await compressAll(
            state.photos.map(photo => photo.file),
            ({ index, total }) => confirmStep?.setProgress(0, `Đang nén ảnh ${index}/${total}…`)
        );

        const totalKb = formatKb(files.reduce((sum, file) => sum + file.size, 0));
        confirmStep?.setProgress(0, `Đang tải ${files.length} ảnh (~${totalKb}KB) lên…`);

        await submitImport({
            branch: state.branch,
            items: toApiItems(state.items),
            files,
            onProgress: percent => confirmStep?.setProgress(
                percent,
                percent >= 100 ? 'Đang ghi nhận nhập kho…' : 'Đang tải ảnh minh chứng lên…'
            )
        });

        notifySuccess();
        showDone();
    } catch (error) {
        notifyError();
        confirmStep?.clearProgress();
        state.submitting = false;
        renderFoot();
        alertUser(error.message || 'Không gửi được phiếu nhập kho.');
    }
}

/* ---------- Render ---------- */

function renderStep() {
    const step = STEPS[state.stepIndex];
    confirmStep = null;

    if (step.key === 'branch') {
        replaceChildren(bodySlot, createBranchStep({
            branch: state.branch,
            onPick: code => {
                state.branch = code;
                renderFoot();
            }
        }));
        return;
    }

    if (step.key === 'products') {
        replaceChildren(bodySlot, createProductsStep({
            getItems,
            onScan: openScanFlow,
            onManual: openManualFlow,
            onOpenList: openItemsList
        }).root);
        return;
    }

    if (step.key === 'photos') {
        replaceChildren(bodySlot, createPhotosStep({
            getPhotos,
            onAdd: addPhotos,
            onRemove: removePhoto
        }).root);
        return;
    }

    confirmStep = createConfirmStep({
        branch: state.branch,
        getItems,
        getPhotos,
        onOpenList: openItemsList
    });
    replaceChildren(bodySlot, confirmStep.root);
}

function renderFoot() {
    const isLast = state.stepIndex === STEPS.length - 1;
    const verdict = checkStep(STEPS[state.stepIndex].key, state);

    replaceChildren(footSlot,
        bottomBar(
            isLast
                ? button({
                    label: state.submitting
                        ? 'Đang xử lý…'
                        : `Xác nhận nhập kho (+${totalQuantity(state.items)})`,
                    iconName: state.submitting ? 'loader' : 'send',
                    spinning: state.submitting,
                    disabled: state.submitting,
                    onClick: submit
                })
                : button({
                    label: 'Tiếp tục',
                    iconName: 'chevronRight',
                    disabled: !verdict.ok,
                    onClick: goNext
                })
        )
    );
}

function render() {
    const step = STEPS[state.stepIndex];
    replaceChildren(topSlot,
        topBar({
            title: step.title,
            subtitle: `Nhập kho hàng hóa · Bước ${state.stepIndex + 1}/${STEPS.length}`,
            onBack: state.stepIndex > 0 && !state.submitting ? goBack : null
        }),
        stepDots({ total: STEPS.length, current: state.stepIndex })
    );
    renderStep();
    renderFoot();
    bodySlot.scrollTop = 0;
}

function showShell() {
    replaceChildren(mount, topSlot, bodySlot, footSlot, sheetSlot);
}

function showDone() {
    for (const photo of state.photos) URL.revokeObjectURL(photo.url);
    replaceChildren(mount, createDoneScreen({
        branch: state.branch,
        items: state.items,
        photoCount: state.photos.length
    }));
}

function showFullScreen(node) {
    replaceChildren(mount, node);
}

/* ---------- Khởi động ---------- */

async function start() {
    const { chatId } = launchParams();

    if (!chatId || !isInsideTelegram()) {
        showFullScreen(errorScreen({
            message: 'Vui lòng mở Mini App từ nút Nhập Kho trong Telegram để hệ thống xác thực được phiên làm việc.'
        }));
        return;
    }

    showFullScreen(loadingScreen());

    try {
        state.products = await loadProducts();
        state.barcodeOwners = toBarcodeOwners(state.products);
        showShell();
        render();
    } catch (error) {
        showFullScreen(errorScreen({ message: error.message, onRetry: start }));
    }
}

initTelegram();
start();
