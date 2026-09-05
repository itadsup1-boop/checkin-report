/**
 * Handler tiếp nhận tin nhắn check-in điểm bán trong các nhóm có bot_role = 'retail_checkin'.
 * Hoàn toàn cô lập — nếu nhóm không phải role này thì next() ngay.
 */

export function registerRetailTelegramHandler({
    bot,
    processStoreCheckin,
    getGroupRole,
    crypto
}) {
    // Bộ đệm gom ảnh gửi theo Album (media_group_id)
    const mediaGroupBuffer = new Map();
    // Bộ đệm lưu ảnh gửi gần nhất theo người dùng (trong vòng 2 phút nếu quên gõ caption)
    const recentPhotosByUser = new Map();
    const CACHE_TTL_MS = 2 * 60 * 1000;

    bot.on(['photo', 'text'], async (ctx, next) => {
        try {
            if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) {
                return next();
            }

            const role = await getGroupRole(ctx.chat.id);
            if (role !== 'retail_checkin') {
                return next();
            }

            const msg = ctx.message;
            if (!msg || !msg.from) return next();

            const telegramId = msg.from.id.toString();
            const telegramGroupId = ctx.chat.id.toString();
            const mediaGroupId = msg.media_group_id;

            // Trường hợp 1: Nhận tin nhắn có ảnh
            if (msg.photo && msg.photo.length > 0) {
                // Lấy ảnh có độ phân giải cao nhất (phần tử cuối mảng)
                const largestPhoto = msg.photo[msg.photo.length - 1];

                // Nếu là một phần của Album ảnh (gửi nhiều ảnh 1 lúc)
                if (mediaGroupId) {
                    if (!mediaGroupBuffer.has(mediaGroupId)) {
                        mediaGroupBuffer.set(mediaGroupId, {
                            telegramId,
                            telegramGroupId,
                            caption: msg.caption || '',
                            photos: [largestPhoto],
                            messageId: msg.message_id,
                            timer: null
                        });

                        // Chờ 1.5 giây để gom đủ các ảnh trong Album gửi đến
                        const entry = mediaGroupBuffer.get(mediaGroupId);
                        entry.timer = setTimeout(async () => {
                            try {
                                const finalEntry = mediaGroupBuffer.get(mediaGroupId);
                                mediaGroupBuffer.delete(mediaGroupId);
                                if (!finalEntry) return;

                                const photoHashes = [];
                                if (crypto) {
                                    finalEntry.photos.forEach(p => {
                                        photoHashes.push(crypto.createHash('md5').update(p.file_id || p.file_unique_id).digest('hex'));
                                    });
                                }

                                const result = await processStoreCheckin({
                                    telegramId: finalEntry.telegramId,
                                    telegramGroupId: finalEntry.telegramGroupId,
                                    caption: finalEntry.caption,
                                    photos: finalEntry.photos,
                                    photoHashes
                                });

                                await ctx.telegram.sendMessage(finalEntry.telegramGroupId, result.replyText, {
                                    parse_mode: 'HTML',
                                    reply_to_message_id: finalEntry.messageId
                                });
                            } catch (e) {
                                console.error('[Retail MediaGroup Timer Error]:', e);
                            }
                        }, 1500);
                    } else {
                        const entry = mediaGroupBuffer.get(mediaGroupId);
                        entry.photos.push(largestPhoto);
                        if (!entry.caption && msg.caption) {
                            entry.caption = msg.caption;
                        }
                    }
                    return; // Đang chờ gom album
                }

                // Nếu là 1 ảnh đơn lẻ: lưu vào cache chờ ảnh thứ 2 hoặc xử lý
                let cached = recentPhotosByUser.get(telegramId);
                if (!cached || (Date.now() - cached.timestamp > CACHE_TTL_MS)) {
                    cached = { photos: [], caption: msg.caption || '', timestamp: Date.now(), messageId: msg.message_id };
                }
                cached.photos.push(largestPhoto);
                if (msg.caption) cached.caption = msg.caption;
                cached.timestamp = Date.now();
                recentPhotosByUser.set(telegramId, cached);

                // Nếu mới chỉ có 1 ảnh và chưa đủ 2 ảnh
                if (cached.photos.length < 2) {
                    // Chờ thêm ảnh thứ 2 trong 2 phút
                    return;
                }

                // Đã gom đủ ≥ 2 ảnh đơn lẻ
                const photoHashes = [];
                if (crypto) {
                    cached.photos.forEach(p => {
                        photoHashes.push(crypto.createHash('md5').update(p.file_id || p.file_unique_id).digest('hex'));
                    });
                }

                const result = await processStoreCheckin({
                    telegramId,
                    telegramGroupId,
                    caption: cached.caption,
                    photos: cached.photos,
                    photoHashes
                });

                recentPhotosByUser.delete(telegramId);

                await ctx.reply(result.replyText, {
                    parse_mode: 'HTML',
                    reply_to_message_id: msg.message_id
                });
                return;
            }

            // Trường hợp 2: Nhắn tin text sau khi đã gửi ảnh (hoặc reply lại ảnh cũ kèm cú pháp)
            if (msg.text && msg.text.includes('-')) {
                const cached = recentPhotosByUser.get(telegramId);
                let photos = [];
                let replyMsgId = msg.message_id;

                if (cached && (Date.now() - cached.timestamp <= CACHE_TTL_MS) && cached.photos.length >= 2) {
                    photos = cached.photos;
                    replyMsgId = cached.messageId;
                    recentPhotosByUser.delete(telegramId);
                } else if (msg.reply_to_message && msg.reply_to_message.photo) {
                    const replyPhoto = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1];
                    photos = [replyPhoto];
                }

                if (photos.length > 0) {
                    const result = await processStoreCheckin({
                        telegramId,
                        telegramGroupId,
                        caption: msg.text,
                        photos,
                        photoHashes: []
                    });

                    await ctx.reply(result.replyText, {
                        parse_mode: 'HTML',
                        reply_to_message_id: replyMsgId
                    });
                    return;
                }
            }
        } catch (err) {
            console.error('[Retail Telegram Handler Error]:', err.message || err);
        }

        return next();
    });
}
