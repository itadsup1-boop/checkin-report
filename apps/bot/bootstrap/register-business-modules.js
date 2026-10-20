import path from 'node:path';
import crypto from 'node:crypto';
import { registerWarehouseModule } from '../../../domains/warehouse/index.js';
import { registerCustomerModule } from '../../../domains/customer/index.js';
import { registerRetailCheckinModule } from '../../../domains/retail-checkin/index.js';
import { registerTelesaleModule } from '../../../domains/telesale/index.js';
import { registerTaskManagementModule } from '../../../domains/task-management/index.js';
import { getGroupRole } from '../role_guard.js';

export function registerBusinessModules({
    botApp, bot, pool, cron, moment, fs, baseDir, authenticateTelegramMiniApp,
    uploadCustomerMedia, getOrCreateCustomerFolder, uploadToDrive, getCustomerDocForGroup,
    createWarehouseFolder, getDocById, sendMessageToRoleGroup, sendMediaGroupToRoleGroup,
    getOrCreateRetailFolderHierarchy
}) {
    const escapeHtml = (str) => {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };
    
    // Module hồ sơ khách hàng được lắp ghép tại một điểm duy nhất: route Mini App,
    // handler nhận ảnh reply, worker đồng bộ Drive và cron tổng kết 22:00 đều nằm
    // trong domains/customer/, không rải rác trong file này nữa.
    registerCustomerModule({
        botApp,
        bot,
        pool,
        cron,
        moment,
        fs,
        escapeHtml,
        getGroupRole,
        authenticateTelegramMiniApp,
        uploadCustomerMedia,
        getOrCreateCustomerFolder,
        uploadToDrive,
        getCustomerDocForGroup,
        driveParentFolderId: process.env.CUSTOMER_DRIVE_PARENT_FOLDER_ID
    });
    
    // Module kho được lắp ghép tại một điểm duy nhất để không trộn nghiệp vụ kho
    // với các role chấm công, KPI và hồ sơ khách hàng.
    registerWarehouseModule({
        botApp,
        bot,
        pool,
        authenticateTelegramMiniApp,
        warehouseTempUploadDir: path.join(baseDir, 'public/uploads/temp'),
        moment,
        fs,
        createWarehouseFolder,
        uploadToDrive,
        escapeHtml,
        getDocById,
        sendMessageToRoleGroup,
        sendMediaGroupToRoleGroup
    });

    // Module check-in điểm bán thị trường (KPI 15 điểm/ngày)
    registerRetailCheckinModule({
        botApp,
        bot,
        pool,
        cron,
        moment,
        crypto,
        fs,
        uploadToDrive,
        getOrCreateRetailFolderHierarchy,
        retailUploadDir: path.join(baseDir, 'public/uploads/retail'),
        authenticateTelegramMiniApp,
        getGroupRole,
        getDocForGroup: getCustomerDocForGroup || getDocById
    });

    // Module báo cáo Telesale tự động
    registerTelesaleModule({
        botApp,
        bot,
        pool,
        cron,
        getDocById,
        getGroupRole
    });

    // Module quản lý & giao việc — mặc định TẮT, bật bằng TASK_MANAGEMENT_ENABLED=true.
    // Tắt module này thì bot check-in/báo cáo phải chạy y như trước khi có nó.
    registerTaskManagementModule({ botApp, authenticateTelegramMiniApp, bot, pool, cron });
}
