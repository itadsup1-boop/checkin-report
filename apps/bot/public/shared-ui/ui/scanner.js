/**
 * Overlay quét mã vạch — dùng chung cho Mini App nhập kho và xuất kho.
 *
 * Bọc global window.BarcodeScanner (apps/bot/public/barcode-scanner.js) để các
 * flow chỉ cần gọi openScanner() và nhận về mã đã quét, không phải tự quản lý
 * vòng đời camera. Luôn gọi stop() khi đóng để không giữ camera của điện thoại.
 *
 * Lưu ý: BarcodeScanner tự lo phần chống nhận dạng nhầm (đòi đọc trùng mã trong
 * 1200ms + kiểm tra checksum) rồi TỰ DỪNG camera trước khi gọi onDetected. Đừng
 * tự đếm số lần quét ở tầng UI — sẽ thành hai lớp xác nhận chồng nhau.
 *
 * theme.css của mỗi app phải định nghĩa .scanner, .scanner__stage, .scanner__close.
 */

import { h } from '../core/dom.js';
import { alertUser } from '../core/telegram.js';

/**
 * @param {{onDetected:(code:string)=>void}} params
 * @returns {Promise<void>} resolve khi overlay đã đóng
 */
export function openScanner({ onDetected }) {
    const scanner = globalThis.BarcodeScanner;
    if (!scanner?.start) {
        alertUser('Không tải được bộ quét mã. Hãy nhập tay tên hoặc mã sản phẩm.');
        return Promise.resolve();
    }

    return new Promise(resolve => {
        const stage = h('div', { class: 'scanner__stage' });
        const overlay = h('div', { class: 'scanner' },
            stage,
            h('button', { class: 'scanner__close', type: 'button', onClick: () => close() },
                'Đóng camera'
            )
        );
        document.body.appendChild(overlay);

        let closed = false;
        async function close() {
            if (closed) return;
            closed = true;
            try {
                await scanner.stop();
            } catch {
                /* camera có thể đã tự dừng */
            }
            overlay.remove();
            resolve();
        }

        scanner.start({
            target: stage,
            onDetected: code => {
                onDetected(String(code || '').trim());
                close();
            },
            onError: () => {
                alertUser('Không thể mở camera. Hãy kiểm tra quyền camera của Telegram.');
                close();
            }
        }).catch(() => {
            alertUser('Không thể mở camera. Hãy kiểm tra quyền camera của Telegram.');
            close();
        });
    });
}
