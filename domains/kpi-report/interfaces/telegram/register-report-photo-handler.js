/**
 * Ảnh/video minh chứng gửi trực tiếp trong nhóm: chống trùng ảnh cũ (vân tay
 * nhận thức), rồi cộng vào `pending_reports` — đủ ảnh thì chốt báo cáo luôn.
 */

import { parseReport } from '../../domain/report-parsing.js';
import { getEffectiveKpiTarget } from '../../domain/kpi-target.js';

export function registerReportPhotoHandler({
    bot, kpiComposer, pool, reportRepository, finalizeReport, getEmployeeMembership,
    computeHashFromBase64, findDuplicateImages, saveHashesToDB,
    sendMessageToRoleGroup, sendMediaGroupToRoleGroup
}) {
    kpiComposer.on(['photo', 'video'], async (ctx, next) => {
        const telegram_id = ctx.message.from.id.toString();
        const group_id = ctx.chat.id.toString();

        try {
            // --- CHỐT CHẶN VÂN TAY CHO ẢNH GỬI TRỰC TIẾP ---
            const user = await getEmployeeMembership(pool, telegram_id, group_id, { activeOnly: true });

            if (!user) {
                return next();
            }

            if (user && user.id) {
                const photoArray = ctx.message.photo;
                const videoObj = ctx.message.video;

                if (photoArray && photoArray.length > 0) {
                    const bestPhoto = photoArray[photoArray.length - 1];
                    const file_id = bestPhoto.file_id;

                    try {
                        const fileLink = await bot.telegram.getFileLink(file_id);
                        const response = await fetch(fileLink);
                        const arrayBuffer = await response.arrayBuffer();
                        const base64Data = Buffer.from(arrayBuffer).toString('base64');
                        const hashVal = await computeHashFromBase64(base64Data);

                        if (hashVal) {
                            const hashedImages = [{ index: 1, hash: hashVal, file_id: file_id }];
                            const duplicates = await findDuplicateImages(pool, hashedImages);

                            if (duplicates.length > 0) {
                                const dup = duplicates[0];
                                const dateStr = new Date(dup.old_date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                                let warnMsg = `🚨 <b>PHÁT HIỆN NGHI VẤN XÀI LẠI ẢNH CŨ</b> 🚨\n`;
                                warnMsg += `👤 Nhân viên gửi: <b>${user.full_name}</b>\n`;
                                warnMsg += `⚠️ Ảnh gửi lên giống ${dup.similarity}% với ảnh của <b>${dup.old_employee}</b> nộp lúc ${dateStr}.\n`;
                                warnMsg += `<i>👇 Mời Sếp xem đối chiếu (Bên trái: Cũ, Bên phải: Mới):</i>`;

                                await sendMessageToRoleGroup(bot, ctx.chat.id, ['report', 'report_tour'], warnMsg, { parse_mode: 'HTML' }, 'direct_duplicate_photo_warning_msg');
                                await sendMediaGroupToRoleGroup(bot, ctx.chat.id, ['report', 'report_tour'], [
                                    { type: 'photo', media: dup.old_file_id, caption: `BẢN GỐC của ${dup.old_employee} nộp ${dateStr}` },
                                    { type: 'photo', media: dup.new_file_id, caption: `BẢN MỚI do ${user.full_name} gửi lên` }
                                ], {}, 'direct_duplicate_photo_warning_media');
                            }
                            await saveHashesToDB(pool, user.id, hashedImages);
                        }
                    } catch (hashErr) {
                        console.error('Lỗi hash ảnh gửi trực tiếp:', hashErr);
                    }
                } else if (videoObj) {
                    // Nếu là video, tạm thời không check trùng lặp (khó hash video qua base64)
                    console.log(`[LOG] Nhận video từ ${user.full_name} (bỏ qua check hash)`);
                }
            }
            // --- KẾT THÚC CHỐT CHẶN VÂN TAY ---

            const report = await reportRepository.incrementReceivedPhotos(telegram_id, group_id);

            if (report && report.received_photos >= report.required_photos) {
                const done = await reportRepository.markPendingDoneIfWaiting(telegram_id, group_id);

                if (done) {
                    // Lấy cấu hình KPI đúng theo nhóm chứa pending report.
                    const scopedUser = await getEmployeeMembership(pool, telegram_id, report.group_id, { activeOnly: true });
                    if (!scopedUser) return next();

                    const kpiTarget = getEffectiveKpiTarget(scopedUser);
                    // Parse lại báo cáo với trigger rỗng vì nó đã được validate lúc text
                    const parsedJSON = parseReport(report.raw_text, '');

                    await finalizeReport(scopedUser, parsedJSON, kpiTarget, telegram_id, report.group_id, report.raw_text, ctx);
                }
            }
        } catch (err) {
            console.error('Lỗi khi xử lý ảnh minh chứng:', err);
        }

        return next();
    });
}
