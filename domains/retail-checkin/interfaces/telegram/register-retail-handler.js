/**
 * Handler tiếp nhận tin nhắn check-in điểm bán trong các nhóm có bot_role = 'retail_checkin'.
 * Hoàn toàn cô lập — nếu nhóm không phải role này thì next() ngay.
 */

function extractImageFromMessage(msg) {
    if (!msg) return null;
    if (msg.photo && msg.photo.length > 0) {
        return msg.photo[msg.photo.length - 1];
    }
    if (msg.document) {
        const mime = (msg.document.mime_type || '').toLowerCase();
        const fileName = (msg.document.file_name || '').toLowerCase();
        const isImage = mime.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(fileName);
        if (isImage) {
            return {
                file_id: msg.document.file_id,
                file_unique_id: msg.document.file_unique_id,
                is_document: true
            };
        }
    }
    return null;
}

export function registerRetailTelegramHandler({
    bot,
    processStoreCheckin,
    getGroupRole,
    crypto
}) {
    // Bộ đệm gom ảnh gửi theo Album (media_group_id)
    const mediaGroupBuffer = new Map();
    // Bộ đệm lưu ảnh gửi gần nhất theo người dùng (trong vòng 3 phút nếu gửi ảnh trước nhắn tin sau)
    const recentPhotosByUser = new Map();
    const CACHE_TTL_MS = 3 * 60 * 1000;

    bot.on(['photo', 'document', 'text'], async (ctx, next) => {
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

            const currentImage = extractImageFromMessage(msg);

            // Trường hợp 1: Nhận tin nhắn có ảnh (hoặc file ảnh document)
            if (currentImage) {
                // Nếu là một phần của Album ảnh (gửi nhiều ảnh 1 lúc)
                if (mediaGroupId) {
                    if (!mediaGroupBuffer.has(mediaGroupId)) {
                        mediaGroupBuffer.set(mediaGroupId, {
                            telegramId,
                            telegramGroupId,
                            caption: msg.caption || '',
                            photos: [currentImage],
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

                                // Nếu album có caption chứa dấu "-" (tên điểm bán - địa chỉ) -> xử lý luôn
                                if (finalEntry.caption && finalEntry.caption.includes('-')) {
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
                                } else {
                                    // Chưa có caption hợp lệ -> Lưu vào cache chờ tin nhắn text hoặc reply
                                    recentPhotosByUser.set(finalEntry.telegramId, {
                                        photos: finalEntry.photos,
                                        caption: finalEntry.caption || '',
                                        timestamp: Date.now(),
                                        messageId: finalEntry.messageId
                                    });
                                }
                            } catch (e) {
                                console.error('[Retail MediaGroup Timer Error]:', e);
                            }
                        }, 1500);
                    } else {
                        const entry = mediaGroupBuffer.get(mediaGroupId);
                        entry.photos.push(currentImage);
                        if (!entry.caption && msg.caption) {
                            entry.caption = msg.caption;
                        }
                    }
                    return; // Đang chờ gom album
                }

                // Nếu là ảnh đơn lẻ: lưu vào cache chờ ảnh tiếp theo hoặc tin nhắn caption
                let cached = recentPhotosByUser.get(telegramId);
                if (!cached || (Date.now() - cached.timestamp > CACHE_TTL_MS)) {
                    cached = { photos: [], caption: msg.caption || '', timestamp: Date.now(), messageId: msg.message_id };
                }
                cached.photos.push(currentImage);
                if (msg.caption) cached.caption = msg.caption;
                cached.timestamp = Date.now();
                recentPhotosByUser.set(telegramId, cached);

                // Nếu chưa đủ 2 ảnh: tiếp tục chờ
                if (cached.photos.length < 2) {
                    return;
                }

                // Đã có từ 2 ảnh trở lên:
                // Nếu ĐÃ CÓ caption chứa dấu "-" -> xử lý check-in ngay lập tức
                if (cached.caption && cached.caption.includes('-')) {
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
                }
                // Nếu chưa có caption -> tiếp tục giữ cached trong 3 phút chờ nhân viên gửi text tên điểm bán
                return;
            }

            // Trường hợp 2: Nhắn tin text sau khi đã gửi ảnh (hoặc reply lại ảnh cũ kèm cú pháp [Tên] - [Địa chỉ])
            if (msg.text && msg.text.includes('-')) {
                const cached = recentPhotosByUser.get(telegramId);
                let photos = [];
                let replyMsgId = msg.message_id;

                if (cached && (Date.now() - cached.timestamp <= CACHE_TTL_MS) && cached.photos.length >= 2) {
                    photos = cached.photos;
                    replyMsgId = cached.messageId || msg.message_id;
                    recentPhotosByUser.delete(telegramId);
                } else if (msg.reply_to_message) {
                    const replyImg = extractImageFromMessage(msg.reply_to_message);
                    if (replyImg) {
                        if (cached && cached.photos.length > 0 && (Date.now() - cached.timestamp <= CACHE_TTL_MS)) {
                            photos = [...cached.photos, replyImg];
                            recentPhotosByUser.delete(telegramId);
                        } else {
                            photos = [replyImg];
                        }
                    }
                }

                if (photos.length > 0) {
                    const photoHashes = [];
                    if (crypto) {
                        photos.forEach(p => {
                            photoHashes.push(crypto.createHash('md5').update(p.file_id || p.file_unique_id).digest('hex'));
                        });
                    }

                    const result = await processStoreCheckin({
                        telegramId,
                        telegramGroupId,
                        caption: msg.text,
                        photos,
                        photoHashes
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
