/**
 * Use case: ghi nhận một hồ sơ khách hàng từ Mini App.
 *
 * Chia làm hai nửa có chủ đích:
 *   1. Nửa đồng bộ  — kiểm tra, INSERT, (nếu chế độ reply) đăng tin đích.
 *      Xong là Mini App được trả lời ngay, nhân viên đóng form.
 *   2. Nửa nền     — tạo thư mục Drive, tải ảnh, đăng tin nhóm, ghi Sheet.
 *      Chậm cỡ nào cũng không giữ chân nhân viên.
 *
 * Tin đích của chế độ reply PHẢI đăng ở nửa đồng bộ: nếu đăng hụt thì hồ sơ bị
 * gỡ và nhân viên nhập lại, còn hơn để họ đi tìm một tin nhắn không tồn tại.
 */

import {
    CustomerError,
    buildRecordNotification,
    isUsableCustomerGroup
} from '../domain/record-rules.js';

export function createCustomerRecordUseCase({
    repository, drive, sheet, notifier, moment, fs, escapeHtml, initializationJobs
}) {
    return async function createCustomerRecord({ telegramId, chatId, files = [], mediaMode, form }) {
        const useTelegramReply = mediaMode === 'telegram_reply';

        if (!telegramId) throw new CustomerError('Thiếu thông tin Telegram ID!', 400);

        const user = await repository.findEmployeeByTelegramId(telegramId);
        if (!user) throw new CustomerError('Nhân sự chưa đăng ký tài khoản trên hệ thống!', 404);

        const tgGroupId = chatId || user.telegram_group_id;
        const groupRecord = tgGroupId ? await repository.findGroup(tgGroupId) : null;
        if (!isUsableCustomerGroup(groupRecord)) {
            throw new CustomerError('Chức năng hồ sơ khách hàng không được bật trong nhóm này.', 403);
        }

        const billVal = parseFloat(form.bill_amount) || 0;
        const paidVal = parseFloat(form.paid_amount) || 0;
        const debtVal = parseFloat(form.debt_amount) || 0;

        const recordId = await repository.insertRecord({
            groupId: groupRecord.id,
            employeeId: user.id,
            recordDate: moment().utcOffset(7).format('YYYY-MM-DD'),
            consultant: form.consultant,
            customerType: form.customer_type,
            customerName: form.customer_name,
            address: form.address,
            phone: form.phone,
            service: form.service,
            gift: form.gift,
            billAmount: billVal,
            paidAmount: paidVal,
            debtAmount: debtVal,
            operator: form.operator,
            warranty: form.warranty
        });

        const notificationData = {
            employeeName: user.full_name,
            consultant: form.consultant,
            customerType: form.customer_type,
            customerName: form.customer_name,
            phone: form.phone,
            address: form.address,
            service: form.service,
            gift: form.gift,
            billAmount: billVal,
            paidAmount: paidVal,
            debtAmount: debtVal,
            operator: form.operator,
            warranty: form.warranty
        };

        const renderNotification = replyMode => buildRecordNotification(notificationData, recordId, {
            replyMode,
            escapeHtml,
            displayDate: moment().utcOffset(7).format('DD/MM/YYYY HH:mm')
        });

        if (useTelegramReply) {
            try {
                await notifier.sendHtml(tgGroupId, renderNotification(true));
            } catch (telegramError) {
                await repository.deleteRecord(recordId);
                console.error('[Customer Reply Mode] Không thể tạo tin nhắn nhận media:', telegramError);
                throw new CustomerError('Không thể tạo tin nhắn nhận ảnh/video trong nhóm. Vui lòng thử lại.', 502);
            }
        }

        /** Chạy sau khi đã trả lời Mini App. Không throw ra ngoài. */
        function runBackground() {
            const job = (async () => {
                const customerFolder = await drive.folderForCustomer(
                    groupRecord.customer_drive_folder_id, form.phone
                );
                const driveFolderLink = customerFolder.webViewLink;

                const mediaUrls = [];
                for (const file of files) {
                    try {
                        const buffer = fs.readFileSync(file.path);
                        const uploaded = await drive.upload(
                            buffer, file.originalname, file.mimetype, customerFolder.id
                        );
                        mediaUrls.push(uploaded.webViewLink);
                    } catch (driveErr) {
                        console.error('[Customer Save Drive Upload Error]:', driveErr);
                    }
                }

                if (useTelegramReply) {
                    await repository.attachDriveFolder(recordId, driveFolderLink, { keepExistingMedia: true });
                } else {
                    await repository.setMediaUrls(recordId, driveFolderLink, mediaUrls);
                }

                // Chế độ reply đã đăng tin đích ở nửa đồng bộ; không đăng lặp.
                if (tgGroupId && !useTelegramReply) {
                    const notifyMsg = renderNotification(false);
                    if (files.length > 0) {
                        try {
                            await notifier.sendAlbum(tgGroupId, files, notifyMsg);
                        } catch (tgErr) {
                            console.error('[Customer Save Telegram Media Error] Thất bại khi gửi media group, gửi tin nhắn text dự phòng:', tgErr);
                            await notifier.sendHtml(tgGroupId, notifyMsg);
                        } finally {
                            for (const file of files) {
                                try { fs.unlinkSync(file.path); } catch { /* file tạm, mất cũng không sao */ }
                            }
                        }
                    } else {
                        await notifier.sendHtml(tgGroupId, notifyMsg);
                    }
                }

                try {
                    await sheet.syncRecord(tgGroupId, {
                        date: moment().utcOffset(7).format('DD/MM/YYYY'),
                        employeeName: user.full_name,
                        employeeCode: user.employee_code || '',
                        consultant: form.consultant,
                        customerType: form.customer_type === 'NEW' ? 'Khách mới' : 'Khách cũ',
                        customerName: form.customer_name,
                        address: form.address,
                        phone: form.phone,
                        service: form.service,
                        gift: form.gift,
                        billAmount: billVal,
                        paidAmount: paidVal,
                        debtAmount: debtVal,
                        operator: form.operator,
                        warranty: form.warranty,
                        driveFolderLink
                    });
                } catch (sheetErr) {
                    console.error('[Sheet Sync Error] Lỗi khi đồng bộ khách hàng lên Google Sheet:', sheetErr);
                }
            })();

            // Ảnh reply có thể về TRƯỚC khi thư mục Drive kịp tạo; worker media
            // chờ đúng job này rồi mới tải, nên không tạo hai thư mục cho một khách.
            initializationJobs.set(recordId, job);
            job.catch(err => {
                console.error('[Customer Save Background Error]:', err);
            }).finally(() => {
                if (initializationJobs.get(recordId) === job) initializationJobs.delete(recordId);
            });
            return job;
        }

        return {
            recordId,
            mediaMode: useTelegramReply ? 'telegram_reply' : 'mini_app',
            message: useTelegramReply
                ? 'Đã tạo hồ sơ. Vui lòng quay lại nhóm và reply ảnh/video vào tin nhắn Bot vừa gửi.'
                : 'Ghi nhận thông tin khách hàng thành công!',
            runBackground
        };
    };
}
