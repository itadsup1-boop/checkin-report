/**
 * Use case: Xử lý nộp báo cáo Telesale từ Mini App hoặc Telegram.
 */

import { calculateTelesaleStats } from '../domain/telesale-rules.js';
import { buildTelesaleReportMessage } from '../domain/telesale-messages.js';

export function createSubmitTelesaleReport({
    telesaleRepository,
    telesaleSheetSync,
    bot,
    now = () => new Date()
}) {
    return async function submitTelesaleReport({
        telegramGroupId,
        telegramUserId,
        employeeId = null,
        payload = {},
        replyToMessageId = null
    }) {
        if (!telegramGroupId) {
            throw new Error('Thiếu telegramGroupId');
        }

        // Tìm nhân viên: ƯU TIÊN SỐ 1 theo Họ Tên trên form để phân biệt độc lập khi dùng chung nick Telegram
        let emp = null;
        if (payload.employee_name) {
            if (telesaleRepository.findOrCreateEmployee) {
                emp = await telesaleRepository.findOrCreateEmployee({
                    fullName: payload.employee_name,
                    telegramId: telegramUserId,
                    telegramGroupId
                });
            } else if (telesaleRepository.findEmployeeByName) {
                emp = await telesaleRepository.findEmployeeByName(payload.employee_name, telegramGroupId);
            }
        }
        if (!emp && employeeId) {
            emp = { id: employeeId };
        }
        if (!emp && telegramUserId) {
            emp = await telesaleRepository.findEmployeeByTelegramId(telegramUserId);
        }

        if (!emp) {
            emp = {
                id: null,
                telegram_id: telegramUserId,
                full_name: payload.employee_name || 'Nhân sự Telesale',
                role: 'Telesale'
            };
        }

        const employeeName = emp.full_name || payload.employee_name || 'Nhân sự Telesale';

        // Xác định ngày và giờ nộp (Giờ VN - UTC+7)
        const currentDate = now();
        const vnDateObj = new Date(currentDate.getTime() + 7 * 3600 * 1000);
        const dateStr = vnDateObj.toISOString().split('T')[0];
        const timeStr = `${String(vnDateObj.getUTCHours()).padStart(2, '0')}:${String(vnDateObj.getUTCMinutes()).padStart(2, '0')}`;
        const dParts = dateStr.split('-');
        const displayDate = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}/${dParts[0]}` : dateStr;

        // Lấy doanh số luỹ kế của các ngày trước trong tháng
        const monthlyPrevRevenue = await telesaleRepository.getMonthlyPreviousRevenue(telegramGroupId, emp.id, dateStr);

        // Tính toán toàn bộ chỉ số
        const stats = calculateTelesaleStats(payload, monthlyPrevRevenue);

        // Lưu vào cơ sở dữ liệu
        const savedReport = await telesaleRepository.upsertDailyReport({
            telegramGroupId,
            employeeId: emp.id,
            telegramUserId: telegramUserId || emp.telegram_id,
            employeeName,
            reportDate: dateStr,
            soNhan: stats.so_nhan,
            soTrungKncVang: stats.so_trung_knc_vang,
            lichPvMoi: stats.lich_pv_moi,
            lichPvCu: stats.lich_pv_cu,
            lichNgayMai: stats.lich_ngay_mai,
            tongToiHnay: stats.tong_toi_hnay,
            tongBongHnay: stats.tong_bong_hnay,
            tongDsHnay: stats.tong_ds_hnay,
            tongLich: stats.tong_lich,
            tongDsThang: stats.tong_ds_thang,
            tyLeKhachToiDs: stats.ty_le_khach_toi_ds,
            tyLeLich: stats.ty_le_lich,
            tyLeToi: stats.ty_le_toi,
            rawPayload: payload
        });

        // Đồng bộ sang Google Sheet
        let sheetUrl = null;
        if (telesaleSheetSync) {
            sheetUrl = await telesaleSheetSync.syncDailyReport({
                spreadsheetId: payload.spreadsheetId,
                dateStr: displayDate,
                timeStr,
                employeeName,
                stats
            });
        }

        // Gửi tin nhắn thông báo lên nhóm Telegram
        if (bot) {
            const message = buildTelesaleReportMessage({
                employeeName,
                dateStr: displayDate,
                stats,
                sheetUrl
            });

            try {
                const sendOptions = {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                };
                if (replyToMessageId) {
                    sendOptions.reply_parameters = { message_id: replyToMessageId };
                }
                await bot.telegram.sendMessage(telegramGroupId, message, sendOptions);
            } catch (tgErr) {
                // Fallback nếu reply_parameters không được hỗ trợ ở phiên bản Telegraf cũ
                try {
                    const fallbackOptions = {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    };
                    if (replyToMessageId) {
                        fallbackOptions.reply_to_message_id = replyToMessageId;
                    }
                    await bot.telegram.sendMessage(telegramGroupId, message, fallbackOptions);
                } catch (fallbackErr) {
                    // Fallback gửi plain-text nếu parse_mode HTML bị lỗi entities
                    try {
                        const plainText = message
                            .replace(/<[^>]*>/g, '')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/&amp;/g, '&');
                        const plainOptions = {
                            disable_web_page_preview: true
                        };
                        if (replyToMessageId) {
                            plainOptions.reply_to_message_id = replyToMessageId;
                        }
                        await bot.telegram.sendMessage(telegramGroupId, plainText, plainOptions);
                    } catch (finalErr) {
                        console.error('[Telesale] Lỗi khi gửi tin Telegram lên nhóm:', finalErr.message || finalErr);
                    }
                }
            }
        }

        return {
            success: true,
            report: savedReport,
            stats,
            sheetUrl,
            employeeId: emp.id,
            employeeName
        };
    };
}
