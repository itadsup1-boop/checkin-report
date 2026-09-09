/**
 * Quét mỗi 5 phút: gửi bù tin nhắn Telegram báo bù bị lỗi, đồng bộ lại Sheet
 * báo bù bị lỗi, và ghi lên Sheet các công tour quá 48 giờ chưa hoàn tất.
 *
 * Ba việc độc lập, mỗi việc tự try/catch riêng — một việc lỗi không được chặn
 * hai việc còn lại.
 */

export function registerRetryCron({
    cron, retryRepository, syncMakeupToGoogleSheet, sheetSync,
    sendPhotoToRoleGroup, escapeHtml, bot, fs, path, moment, uploadDir
}) {
    return cron.schedule('*/5 * * * *', async () => {
        console.log('[CRON MAKEUP] Đang chạy quét xử lý bù tin nhắn Telegram và đồng bộ Sheet...');

        // 1. Quét gửi bù tin nhắn Telegram
        try {
            const pendingTg = await retryRepository.findPendingNotifications();
            for (const req of pendingTg) {
                try {
                    console.log(`[CRON MAKEUP] Đang gửi lại tin nhắn Telegram cho yêu cầu ${req.id}...`);

                    const filename = path.basename(req.proof_image);
                    const filePath = path.join(uploadDir, filename);
                    if (!fs.existsSync(filePath)) {
                        console.warn(`[CRON MAKEUP] File ảnh không tồn tại tại ${filePath}, chuyển trạng thái sang REJECTED do mất tài liệu.`);
                        await retryRepository.markRejectedMissingProof(req.id);
                        continue;
                    }
                    const buffer = fs.readFileSync(filePath);

                    const workDateStr = moment(req.work_date).format('DD/MM/YYYY');
                    const appTimeStr = moment(req.appointment_time).format('HH:mm');
                    const reqTypeLabel = req.request_type === 'EXISTING_APPOINTMENT' ? 'Bổ sung lịch đã tồn tại' : 'Báo bù lịch chưa đăng ký';

                    const safeEmpName = escapeHtml(req.employee_name);
                    const safeCustName = escapeHtml(req.customer_name);
                    const safePhone = escapeHtml(req.customer_phone);
                    const safeService = escapeHtml(req.service);
                    const safeSessions = escapeHtml(req.sessions);
                    const safeSessionType = escapeHtml(req.session_type || 'Bán');
                    const safeRevenue = escapeHtml(req.revenue);
                    const safeReason = escapeHtml(req.reason);

                    const notifyMsg =
                        `🕘 <b>YÊU CẦU BÁO BÙ CÔNG TOUR (GỬI LẠI)</b> 🕘\n\n` +
                        `👤 <b>Nhân viên:</b> ${safeEmpName}\n` +
                        `📅 <b>Ngày làm thực tế:</b> ${workDateStr}\n` +
                        `⏰ <b>Giờ hẹn khách:</b> ${appTimeStr}\n` +
                        `👤 <b>Khách hàng:</b> ${safeCustName}\n` +
                        `📞 <b>SĐT:</b> ${safePhone.substring(0, 6)}****\n` +
                        `💇 <b>Dịch vụ:</b> ${safeService} (Buổi: ${safeSessions})\n` +
                        `💰 <b>Doanh thu:</b> ${safeRevenue}\n` +
                        `📌 <b>Dạng buổi:</b> ${safeSessionType}\n` +
                        `❓ <b>Loại yêu cầu:</b> ${reqTypeLabel}\n` +
                        `📝 <b>Lý do báo bù:</b> ${safeReason}\n\n` +
                        `<i>Sếp hoặc Quản lý vui lòng xem ảnh đính kèm bên dưới và nhấn duyệt:</i>`;

                    const replyMarkup = {
                        inline_keyboard: [
                            [
                                { text: '✅ Duyệt', callback_data: `makeup_app_${req.id}` },
                                { text: '❌ Từ chối', callback_data: `makeup_rej_${req.id}` }
                            ]
                        ]
                    };

                    const sentMessage = await sendPhotoToRoleGroup(bot, req.telegram_group_id, 'report_tour', { source: buffer }, {
                        caption: notifyMsg,
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup
                    }, 'tour_makeup_cron_retry');

                    if (sentMessage) {
                        await retryRepository.markNotificationPending(req.id);
                        console.log(`[CRON MAKEUP] Đã gửi lại tin nhắn Telegram thành công cho yêu cầu ${req.id}.`);
                    } else {
                        throw new Error('Gửi Telegram nhận kết quả rỗng (null/undefined)');
                    }
                } catch (err) {
                    console.error(`[CRON MAKEUP] Lỗi gửi lại Telegram cho yêu cầu ${req.id}:`, err.message);
                    await retryRepository.markNotificationFailed(req.id);
                }
            }
        } catch (err) {
            console.error('[CRON MAKEUP] Lỗi trong tiến trình quét gửi Telegram:', err.message);
        }

        // 2. Quét đồng bộ Google Sheet bị lỗi hoặc chưa chạy
        try {
            const pendingSheet = await retryRepository.findRequestsNeedingSheetSync();
            for (const req of pendingSheet) {
                try {
                    console.log(`[CRON MAKEUP] Đang đồng bộ lại Sheet cho yêu cầu ${req.id}...`);
                    await syncMakeupToGoogleSheet(req.id);
                } catch (err) {
                    console.error(`[CRON MAKEUP] Lỗi đồng bộ lại Sheet cho yêu cầu ${req.id}:`, err.message);
                }
            }
        } catch (err) {
            console.error('[CRON MAKEUP] Lỗi trong tiến trình quét đồng bộ Sheet:', err.message);
        }

        // 3. Quét các công tour quá 48h chưa hoàn thành để ghi lên Sheet
        try {
            const uncompleted = await retryRepository.findUncompletedTourAppointments();
            for (const apt of uncompleted) {
                try {
                    console.log(`[CRON MAKEUP] Đang đồng bộ lịch quá 48h chưa hoàn thành (ID: ${apt.id})...`);
                    const rowData = {
                        'Ngày': moment(apt.appointment_time).format('DD/MM/YYYY'),
                        'Nhân Viên': apt.employee_name,
                        'Mã NV': apt.employee_code || '',
                        'Khách Hàng': apt.customer_name,
                        'SĐT': apt.phone,
                        'Dịch Vụ': apt.service,
                        'Buổi Làm': apt.sessions,
                        'Thời Gian': moment(apt.appointment_time).format('HH:mm DD/MM/YYYY'),
                        'Trạng Thái': 'Có lịch nhưng chưa hoàn thành công tour',
                        'Lý Do Hủy': '',
                        'Thu Tiền': apt.revenue || '',
                        'Ảnh Chứng Thực': ''
                    };

                    const rowNumber = await sheetSync.writeAppointmentRow(apt.group_id, apt.employee_name, rowData);
                    if (rowNumber) {
                        await retryRepository.markAppointmentSheetRowIndex(apt.id, rowNumber);
                    }
                } catch (err) {
                    console.error(`[CRON MAKEUP] Lỗi đồng bộ lịch quá 48h (ID: ${apt.id}):`, err.message);
                }
            }
        } catch (err) {
            console.error('[CRON MAKEUP] Lỗi quét lịch quá 48h:', err.message);
        }
    });
}
