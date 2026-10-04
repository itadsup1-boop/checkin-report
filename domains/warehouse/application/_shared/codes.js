/**
 * Sinh mã đơn và mã phiếu điều chuyển.
 *
 * Dạng: ORD-20260813-A1B2C3D4
 *   - có ngày để nhân sự đọc là biết đơn của hôm nào
 *   - 8 ký tự ngẫu nhiên từ UUID để không đụng nhau khi hai cơ sở tạo cùng lúc
 */

import { randomUUID } from 'node:crypto';

export function makeCode(prefix) {
    const date = new Date();
    const ymd = date.toISOString().slice(0, 10).replaceAll('-', '');
    return `${prefix}-${ymd}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
