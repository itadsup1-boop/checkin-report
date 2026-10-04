/**
 * Gửi ảnh đính kèm từ form Mini App vào nhóm Telegram theo từng chùm 10 ảnh
 * (giới hạn của Telegram MediaGroup), tự thử lại khi bị rate-limit, rồi chống
 * trùng ảnh cũ bằng vân tay nhận thức — dùng riêng cho `POST /api/bot/submit-report`.
 */

export function createSendReportPhotos({
    bot, pool, sendMediaGroupToRoleGroup, sendMessageToRoleGroup,
    computeHashFromBase64, findDuplicateImages, saveHashesToDB
}) {
    const REPORT_ROLES = ['report', 'report_tour'];

    /**
     * @returns {{sentPhotos:number, hashedImages:Array}}
     */
    async function sendAndHash(chatId, images, fullName) {
        let sentPhotos = 0;
        const hashedImages = [];

        for (let i = 0; i < images.length; i += 10) {
            const chunk = images.slice(i, i + 10);
            const mediaGroup = chunk.map((base64str, idx) => {
                const base64Data = base64str.replace(/^data:image\/\w+;base64,/, '');
                return {
                    type: 'photo',
                    media: { source: Buffer.from(base64Data, 'base64') },
                    caption: (i === 0 && idx === 0) ? `📸 Ảnh đính kèm từ Báo cáo của ${fullName}` : ''
                };
            });

            let successChunk = false;
            let retries = 0;
            let sentMessages = null;
            while (!successChunk && retries < 3) {
                try {
                    sentMessages = await sendMediaGroupToRoleGroup(bot, chatId, REPORT_ROLES, mediaGroup, {}, 'submit_report_photos');
                    if (sentMessages) {
                        successChunk = true;
                    } else {
                        console.error(`[Error] Gửi media group bị chặn bởi role guard cho group ${chatId}`);
                        break;
                    }
                } catch (err) {
                    if (err.response && err.response.error_code === 429) {
                        const retryAfter = err.response.parameters.retry_after || 10;
                        console.log(`[Rate Limit] Bị chặn gửi ảnh, tự động chờ ${retryAfter} giây...`);
                        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                        retries++;
                    } else {
                        console.error(`[Error] Bị chặn gửi ảnh tại chunk ${i}:`, err.message);
                        break;
                    }
                }
            }

            if (!successChunk) {
                console.error('Đã ngừng gửi các ảnh còn lại do lỗi API Telegram hoặc bị chặn vai trò.');
                break;
            }

            sentPhotos += chunk.length;

            if (sentMessages && sentMessages.length > 0) {
                const hashPromises = chunk.map(async (base64str, idx) => {
                    const base64Data = base64str.replace(/^data:image\/\w+;base64,/, '');
                    const hashVal = await computeHashFromBase64(base64Data);
                    const photoArray = sentMessages[idx]?.photo;
                    const file_id = (photoArray && photoArray.length > 0) ? photoArray[photoArray.length - 1].file_id : null;
                    return { index: i + idx + 1, hash: hashVal, file_id };
                });
                hashedImages.push(...await Promise.all(hashPromises));
            }

            // Nghỉ 5 giây giữa các mảng 10 ảnh (tăng từ 3s lên 5s cho an toàn)
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        return { sentPhotos, hashedImages };
    }

    /** Đối chiếu và cảnh báo ảnh trùng, rồi lưu vân tay mới — gọi sau khi gửi xong. */
    async function warnDuplicatesAndSaveHashes(chatId, hashedImages, employeeId, fullName) {
        if (hashedImages.length === 0) return;

        const duplicates = await findDuplicateImages(pool, hashedImages);
        if (duplicates.length > 0) {
            let warnMsg = `🚨 <b>PHÁT HIỆN NGHI VẤN XÀI LẠI ẢNH CŨ</b> 🚨\n`;
            warnMsg += `👤 Nhân viên nộp: <b>${fullName}</b>\n\n`;

            const mediaWarnGroup = [];
            for (const dup of duplicates) {
                const dateStr = new Date(dup.old_date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                warnMsg += `⚠️ Ảnh thứ ${dup.new_index} giống ${dup.similarity}% với ảnh của <b>${dup.old_employee}</b> nộp lúc ${dateStr}\n`;
                mediaWarnGroup.push({ type: 'photo', media: dup.old_file_id, caption: `BẢN GỐC của ${dup.old_employee} nộp ${dateStr}` });
                mediaWarnGroup.push({ type: 'photo', media: dup.new_file_id, caption: `BẢN MỚI do ${fullName} nộp hôm nay` });
            }
            warnMsg += `\n<i>👇 Mời Sếp xem đối chiếu ảnh bên dưới:</i>`;

            await sendMessageToRoleGroup(bot, chatId, REPORT_ROLES, warnMsg, { parse_mode: 'HTML' }, 'report_duplicate_photo_warning');
            if (mediaWarnGroup.length > 0) {
                await sendMediaGroupToRoleGroup(bot, chatId, REPORT_ROLES, mediaWarnGroup.slice(0, 10), {}, 'report_duplicate_photo_media');
            }
        }

        await saveHashesToDB(pool, employeeId, hashedImages);
    }

    return { sendAndHash, warnDuplicatesAndSaveHashes };
}
