/**
 * Mini App "Điền báo cáo": đọc báo cáo hôm nay để prefill form, và nộp báo cáo
 * (kèm ảnh) khi nhân viên gửi từ form thay vì gõ tay trong Telegram.
 *
 * Hợp đồng tương thích — hai đường dẫn và hình dạng phản hồi giữ nguyên như cũ
 * vì Mini App đang chạy thật gọi vào: `GET /api/bot/get-report-today`,
 * `POST /api/bot/submit-report`.
 */

import { parseReport, computeReportDeadline } from '../../domain/report-parsing.js';
import { getEffectiveKpiTarget } from '../../domain/kpi-target.js';

function extractPrefillFields(rawText) {
    let tinNhan = '0';
    const tinNhanMatch = rawText.match(/(?:tin nhắn|tin gửi|tin gui).*?:\s*(\d+)/i);
    if (tinNhanMatch) tinNhan = tinNhanMatch[1];

    let doanhThu = '0';
    const doanhThuMatch = rawText.match(/(?:doanh thu|doanh số|số ds).*?:\s*(.+)/i);
    if (doanhThuMatch) doanhThu = doanhThuMatch[1].trim();

    const lines = rawText.split('\n');
    let isParsingLichKhach = false;
    const lichKhachLines = [];
    for (const line of lines) {
        if (line.toLowerCase().includes('lịch khách')) {
            isParsingLichKhach = true;
            const parts = line.split(':');
            if (parts.length > 1 && parts[1].trim() !== '') {
                lichKhachLines.push(parts[1].trim());
            }
            continue;
        }
        if (isParsingLichKhach) {
            if (line.trim() === '' || line.match(/^(số tin|doanh thu|báo cáo)/i)) {
                isParsingLichKhach = false;
            } else {
                lichKhachLines.push(line.trim());
            }
        }
    }

    return { tinNhan, doanhThu, lichKhach: lichKhachLines.join('\n') };
}

export function registerReportFormRoutes({
    botApp, authenticateTelegramMiniApp, getGroupRole, pool,
    reportRepository, groupConfigRepository, finalizeReport, sendReportPhotos,
    getEmployeeMembership, sendMessageToRoleGroup, bot
}) {
    // API KPI endpoints role guard — chỉ nhóm role 'report' mới được gọi các route dưới.
    botApp.use('/api/bot', async (req, res, next) => {
        const groupId =
            req.body?.telegram_group_id || req.body?.chat_id || req.body?.chatId ||
            req.query?.chat_id || req.query?.chatId || req.query?.telegram_group_id;
        if (groupId) {
            const role = await getGroupRole(groupId);
            if (role !== 'report') {
                return res.status(403).json({ success: false, message: 'Nhóm này không được cấu hình chức năng báo cáo KPI.' });
            }
        }
        next();
    });

    botApp.get('/api/bot/get-report-today', authenticateTelegramMiniApp, async (req, res) => {
        try {
            const telegramId = req.verifiedTelegramId || req.query.telegramId;
            let { chatId } = req.query;
            if (!telegramId) {
                return res.status(400).json({ success: false, message: 'Thiếu thông tin xác thực.' });
            }

            const employee = await reportRepository.findEmployeeByTelegramId(telegramId.toString());
            if (!employee || employee.is_active === false) {
                return res.json({ success: false, message: 'Tài khoản của bạn đã bị vô hiệu hóa trong hệ thống.' });
            }
            if (!chatId || chatId === 'undefined' || chatId === 'null') {
                chatId = employee.telegram_group_id;
            }
            if (!chatId) {
                return res.status(400).json({ success: false, message: 'Không xác định được nhóm báo cáo.' });
            }
            chatId = chatId.toString().split('_')[0];

            const scopedUser = await getEmployeeMembership(pool, telegramId, chatId);
            if (!scopedUser) {
                return res.status(403).json({ success: false, message: 'Bạn chưa đăng ký KPI trong nhóm này.' });
            }
            if (scopedUser.membership_status !== 'ACTIVE') {
                return res.status(403).json({ success: false, message: 'Bạn đang được tạm dừng KPI trong nhóm này.' });
            }

            const today = new Date().toISOString().split('T')[0];
            let rawText = null;

            const pending = await reportRepository.findPendingRawText(telegramId.toString(), chatId.toString());
            if (pending) {
                rawText = pending.raw_text;
            } else {
                const report = await reportRepository.findTodayReport(chatId.toString(), scopedUser.id, today);
                if (report) rawText = report.raw_text;
            }

            if (rawText) {
                return res.json({ success: true, data: extractPrefillFields(rawText) });
            }
            return res.json({ success: false });
        } catch (err) {
            console.error('Lỗi khi lấy báo cáo cũ:', err);
            res.status(500).json({ success: false });
        }
    });

    botApp.post('/api/bot/submit-report', authenticateTelegramMiniApp, async (req, res) => {
        try {
            let { chatId, tinNhan, doanhThu, lichKhach, customersData, images } = req.body;
            const telegramId = req.verifiedTelegramId || req.body.telegramId;
            if (!telegramId) {
                return res.status(400).json({ success: false, message: 'Thiếu thông tin xác thực.' });
            }

            let user = await reportRepository.findEmployeeByTelegramId(telegramId.toString());
            if (!user) {
                return res.status(400).json({ success: false, message: 'Bạn chưa dùng lệnh /setup để đăng ký tài khoản.' });
            }
            if (user.is_active === false) {
                return res.status(403).json({ success: false, message: 'Tài khoản của bạn đã bị vô hiệu hóa trong hệ thống. Vui lòng liên hệ Admin.' });
            }

            if (!chatId || chatId === 'undefined' || chatId === 'null') {
                chatId = user.telegram_group_id;
            }
            if (!chatId) {
                return res.status(400).json({ success: false, message: 'Không xác định được nhóm báo cáo. Vui lòng thử lại từ trong nhóm Telegram.' });
            }
            chatId = chatId.toString().split('_')[0];

            const scopedUser = await getEmployeeMembership(pool, telegramId, chatId);
            if (!scopedUser) {
                return res.status(403).json({ success: false, message: 'Bạn chưa đăng ký KPI trong nhóm này. Vui lòng dùng /setup trong đúng nhóm.' });
            }
            if (scopedUser.membership_status !== 'ACTIVE') {
                return res.status(403).json({ success: false, message: 'Bạn đang được Admin tạm dừng báo cáo KPI trong nhóm này.' });
            }
            user = scopedUser;

            const command_trigger = (await groupConfigRepository.findWorkflowTrigger(chatId.toString())) || '#baocao';
            const remind_time_1 = (await groupConfigRepository.findRemindTime(chatId.toString())) || '17:00:00';

            const finalReportText = `${command_trigger}\nSố tin nhắn: ${tinNhan}\nDoanh thu: ${doanhThu}\nLịch khách:\n${lichKhach}`;
            const parsedJSON = parseReport(finalReportText, command_trigger);

            if (!parsedJSON.is_valid) {
                return res.status(400).json({ success: false, message: parsedJSON.error_msg || 'Báo cáo sai cú pháp. Vui lòng kiểm tra lại.' });
            }

            // Lưu lịch khách hàng vào DB để nhắc nhở
            if (customersData && Array.isArray(customersData)) {
                for (const c of customersData) {
                    if (!c.thoiGianRaw) continue;
                    try {
                        const aptTime = new Date(c.thoiGianRaw);
                        if (!isNaN(aptTime.getTime())) {
                            await reportRepository.upsertReportAppointment({
                                telegramId: user.telegram_id,
                                employeeName: user.full_name,
                                groupId: chatId.toString(),
                                customerName: c.ten,
                                phone: c.sdt,
                                service: c.dv,
                                sessions: c.soBuoi,
                                appointmentTime: aptTime
                            });
                        }
                    } catch (e) {
                        console.error('Lỗi parse ngày hẹn:', e);
                    }
                }
            }

            const kpiTarget = getEffectiveKpiTarget(user);

            const today = new Date().toISOString().split('T')[0];
            const oldReport = await reportRepository.findTodayReport(chatId.toString(), user.id, today);
            const old_kpi = oldReport ? oldReport.kpi_actual : 0;

            let new_photos_needed = parsedJSON.kpi_actual - old_kpi;
            if (new_photos_needed < 0) new_photos_needed = 0;

            let sentPhotos = 0;
            const reportRoles = ['report', 'report_tour'];

            if (images && Array.isArray(images) && images.length > 0) {
                try {
                    const { sentPhotos: sent, hashedImages } = await sendReportPhotos.sendAndHash(chatId.toString(), images, user.full_name);
                    sentPhotos = sent;
                    await sendReportPhotos.warnDuplicatesAndSaveHashes(chatId.toString(), hashedImages, user.id, user.full_name);
                } catch (e) {
                    console.error('Lỗi gửi ảnh từ form (bị bắt ở catch ngoài):', e);
                }
            }

            const remaining_photos = new_photos_needed - sentPhotos;

            if (remaining_photos <= 0) {
                const formattedDate = new Date().toLocaleDateString('vi-VN');
                await finalizeReport(user, parsedJSON, kpiTarget, telegramId.toString(), chatId.toString(), finalReportText, bot);

                const completionMessage = await sendMessageToRoleGroup(bot, chatId.toString(), reportRoles,
                    `👤 <b>Cập nhật báo cáo: ${user.full_name} ngày ${formattedDate}</b>\n` +
                    `💬 Số tin: ${tinNhan}\n` +
                    `💰 Doanh thu: ${parsedJSON.doanh_thu.toLocaleString('vi-VN')}đ\n` +
                    `📅 Lịch khách:\n${lichKhach}\n` +
                    `✅ Đã lưu lên hệ thống thành công (Đã nhận đủ ảnh)!`,
                    { parse_mode: 'HTML' },
                    'submit_report_complete'
                );

                if (!completionMessage) {
                    return res.status(502).json({
                        success: false,
                        reportSaved: true,
                        message: 'Báo cáo đã được lưu nhưng không thể gửi thông báo vào nhóm Telegram. Vui lòng liên hệ Admin kiểm tra trạng thái nhóm và quyền gửi tin của Bot.'
                    });
                }

                await reportRepository.deletePendingReport(telegramId.toString(), chatId.toString());
            } else {
                const deadline_at = computeReportDeadline(remind_time_1);

                await reportRepository.upsertPendingReportFromForm({
                    telegramId: telegramId.toString(),
                    groupId: chatId.toString(),
                    rawText: finalReportText,
                    kpiActual: parsedJSON.kpi_actual,
                    requiredPhotos: new_photos_needed,
                    receivedPhotos: sentPhotos,
                    deadlineAt: deadline_at,
                    customersData
                });

                const formattedDate = new Date().toLocaleDateString('vi-VN');
                const strReceived = sentPhotos > 0 ? `(Đã tải lên form: ${sentPhotos} ảnh) ` : '';
                const pendingMessage = await sendMessageToRoleGroup(bot, chatId.toString(), reportRoles,
                    `👤 <b>Cập nhật báo cáo: ${user.full_name} ngày ${formattedDate}</b>\n` +
                    `💬 Số tin nhắn: ${tinNhan}\n` +
                    `💰 Doanh thu: ${parsedJSON.doanh_thu.toLocaleString('vi-VN')}đ\n` +
                    `📅 Lịch khách:\n${lichKhach}\n\n` +
                    `⏳ Hệ thống đã ghi nhận.\n` +
                    `📸 ${strReceived}VUI LÒNG GỬI THÊM ĐÚNG ${remaining_photos} ẢNH MINH CHỨNG VÀO NHÓM NÀY.\n` +
                    `⏰ Hạn chót nộp ảnh: ${deadline_at.toLocaleTimeString('vi-VN')} để chốt số liệu!`,
                    { parse_mode: 'HTML' },
                    'submit_report_waiting_photos'
                );

                if (!pendingMessage) {
                    return res.status(502).json({
                        success: false,
                        reportSaved: true,
                        message: 'Báo cáo đã được ghi nhận nhưng không thể gửi yêu cầu bổ sung ảnh vào nhóm Telegram. Vui lòng liên hệ Admin kiểm tra trạng thái nhóm và quyền gửi tin của Bot.'
                    });
                }
            }

            res.json({ success: true });
        } catch (err) {
            console.error('Lỗi khi submit report từ form:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
