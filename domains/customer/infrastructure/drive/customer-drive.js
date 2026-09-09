/**
 * Google Drive cho hồ sơ khách hàng.
 *
 * Thư mục được đặt theo SỐ ĐIỆN THOẠI đã làm sạch, nên cùng một khách quay lại
 * nhiều lần vẫn dồn ảnh về một chỗ.
 */

import { cleanPhoneForFolder } from '../../domain/record-rules.js';

/** Thư mục gốc dùng khi nhóm chưa cấu hình và cũng chưa đặt biến môi trường. */
const FALLBACK_PARENT_FOLDER_ID = '1efnVoB6tQXrHKAeTcm3lcqzJqBoGg3QF';

export function createCustomerDrive({ getOrCreateCustomerFolder, uploadToDrive, defaultParentFolderId }) {
    /** Ưu tiên thư mục riêng của nhóm; sau đó tới biến môi trường; cuối cùng là mặc định. */
    const resolveParent = groupFolderId =>
        groupFolderId || defaultParentFolderId || FALLBACK_PARENT_FOLDER_ID;

    async function folderForCustomer(groupFolderId, phone) {
        return getOrCreateCustomerFolder(resolveParent(groupFolderId), cleanPhoneForFolder(phone));
    }

    async function upload(buffer, fileName, mimeType, folderId) {
        return uploadToDrive(buffer, fileName, mimeType, folderId);
    }

    return { folderForCustomer, upload };
}
