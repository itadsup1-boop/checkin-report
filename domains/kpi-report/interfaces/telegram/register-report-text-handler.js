/**
 * Nhận diện tin nhắn báo cáo và xử lý: chốt luôn nếu không cần ảnh, hoặc ghi
 * vào `pending_reports` chờ đủ ảnh minh chứng.
 */

import { parseReport, detectReportTrigger, computeReportDeadline } from '../../domain/report-parsing.js';
import { getEffectiveKpiTarget } from '../../domain/kpi-target.js';

export function registerReportTextHandler({
    kpiComposer, reportRepository, groupConfigRepository, finalizeReport, getEmployeeMembership, pool
}) {
    kpiComposer.on('text', async (ctx, next) => {
        const text = ctx.message.text;
        const telegram_id = ctx.message.from.id.toString();
        const group_id = ctx.chat.id.toString();

        try {
            // Mỗi nhóm có thể gắn lệnh kích hoạt riêng qua /taocaulenh; mặc định #baocao.
            const workflowTrigger = await groupConfigRepository.findWorkflowTrigger(group_id);
            const command_trigger = workflowTrigger || '#baocao';

            let remind_time_1 = await groupConfigRepository.findRemindTime(group_id) || '17:00:00';

            const { matched: isCommandMatched, usedTrigger } = detectReportTrigger(text, command_trigger);

            if (isCommandMatched) {
                const parsedJSON = parseReport(text, usedTrigger);
                if (!parsedJSON.is_valid) {
                    // Chỉ báo lỗi cú pháp nếu họ dùng ĐÚNG lệnh trigger (vd: #baocao)
                    // Hoặc nếu nó chắc chắn là lệnh báo cáo tự nhiên (có đủ 3 thành phần)
                    if (usedTrigger !== '' || parsedJSON.is_definitely_report) {
                        return ctx.reply(parsedJSON.error_msg || `❌ Báo cáo sai cú pháp mẫu!`);
                    }
                    return next(); // Bỏ qua nếu bắt nhầm tự nhiên
                }

                const user = await getEmployeeMembership(pool, telegram_id, group_id);
                if (!user) {
                    return ctx.reply('❌ Bạn chưa đăng ký hoạt động KPI trong nhóm này. Vui lòng dùng /setup Họ và tên.');
                }
                if (user.is_active === false) {
                    return ctx.reply('⚠️ Tài khoản của bạn đã bị vô hiệu hóa trong hệ thống. Vui lòng liên hệ Admin nếu muốn bật lại.');
                }
                if (user.membership_status === 'PAUSED') {
                    return ctx.reply('⏸ Bạn đang được tạm dừng báo cáo KPI trong nhóm này. Việc đăng ký ở nhóm khác vẫn hoạt động bình thường.');
                }
                const kpiTarget = getEffectiveKpiTarget(user);

                if (parsedJSON.kpi_actual === 0) {
                    // Báo cáo 0 -> Xử lý luôn, không cần chờ ảnh
                    await finalizeReport(user, parsedJSON, kpiTarget, telegram_id, group_id, text, ctx);
                } else {
                    const deadline_at = computeReportDeadline(remind_time_1);

                    await reportRepository.upsertPendingReportFromText({
                        telegramId: telegram_id,
                        groupId: group_id,
                        rawText: text,
                        kpiActual: parsedJSON.kpi_actual,
                        requiredPhotos: parsedJSON.total_photos_needed,
                        deadlineAt: deadline_at
                    });

                    ctx.reply(`⏳ Đã ghi nhận lệnh báo cáo của ${user.full_name} (Tin nhắn: ${parsedJSON.kpi_actual} | Doanh thu: ${parsedJSON.doanh_thu.toLocaleString('vi-VN')}đ).\n\n📸 VUI LÒNG GỬI ĐÚNG ${parsedJSON.total_photos_needed} ẢNH MINH CHỨNG.\n⏰ Vui lòng nộp ảnh trước hạn chót lúc ${deadline_at.toLocaleTimeString('vi-VN')} để không bị phạt!`);
                }
            }
        } catch (error) {
            console.error('Lỗi khi xử lý text message:', error);
            ctx.reply('⚠️ Có lỗi xảy ra khi lưu hệ thống. Đội kỹ thuật đang xử lý!');
        }

        // Rất quan trọng: cho phép các lệnh khác như /setup được chạy
        return next();
    });
}
