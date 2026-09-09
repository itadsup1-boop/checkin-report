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
    repository,
    moment,
    processStoreCheckin,
    sendProgressReminders,
    summarizeDailyKpi,
    getGroupRole,
    crypto
}) {
    // Bộ đệm gom ảnh gửi theo Album (media_group_id)
    const mediaGroupBuffer = new Map();
    // Bộ đệm lưu ảnh gửi gần nhất theo người dùng (trong vòng 3 phút nếu gửi ảnh kèm caption hoặc text rời)
    const recentPhotosByUser = new Map();
    // Bộ đệm lưu vị trí GPS gần nhất theo người dùng (trong vòng 5 phút)
    const recentLocationByUser = new Map();
    const CACHE_TTL_MS = 3 * 60 * 1000;
    const LOCATION_TTL_MS = 5 * 60 * 1000;

    bot.on(['photo', 'document', 'text', 'location'], async (ctx, next) => {
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

            // Xử lý khi nhân viên chia sẻ vị trí (Location)
            if (msg.location) {
                recentLocationByUser.set(telegramId, {
                    latitude: msg.location.latitude,
                    longitude: msg.location.longitude,
                    locationAccuracy: msg.location.horizontal_accuracy || null,
                    timestamp: Date.now()
                });
                await ctx.reply(`📍 <i>Đã nhận tọa độ GPS (${msg.location.latitude.toFixed(5)}, ${msg.location.longitude.toFixed(5)}). Hãy gửi ảnh và tên điểm bán để hoàn tất check-in!</i>`, {
                    parse_mode: 'HTML',
                    reply_to_message_id: msg.message_id
                });
                return;
            }

            // Lệnh xem thống kê tiến độ nhanh: /tiendo, /kpi
            if (msg.text && /^\/(tiendo|kpi|progress)(@\w+)?$/i.test(msg.text.trim())) {
                if (typeof sendProgressReminders === 'function') {
                    await sendProgressReminders({
                        type: 'one_hour_warning',
                        targetGroupId: telegramGroupId
                    });
                    return;
                }
            }

            // Lệnh chốt sổ nhanh: /chotso, /closing, /baocao20h
            if (msg.text && /^\/(chotso|closing|baocao20h)(@\w+)?$/i.test(msg.text.trim())) {
                if (typeof summarizeDailyKpi === 'function') {
                    await ctx.reply('⏳ <i>Đang thực hiện chốt sổ KPI, cập nhật Database và Google Sheet...</i>', {
                        parse_mode: 'HTML',
                        reply_to_message_id: msg.message_id
                    });
                    await summarizeDailyKpi({ targetGroupId: telegramGroupId });
                    return;
                }
            }

            // Lệnh xem danh sách và lịch sử điểm bán: /lichsu, /diemban, /history, /dsdiem
            if (msg.text && /^\/(lichsu|diemban|history|dsdiem)(@\w+)?$/i.test(msg.text.trim())) {
                if (repository && typeof repository.findEmployeeByTelegramId === 'function') {
                    const employee = await repository.findEmployeeByTelegramId(telegramId);
                    if (!employee) {
                        await ctx.reply('⚠️ Tài khoản của bạn chưa được đăng ký hoặc chưa kích hoạt trong hệ thống.', {
                            reply_to_message_id: msg.message_id
                        });
                        return;
                    }

                    const group = typeof repository.findGroupByTelegramId === 'function'
                        ? await repository.findGroupByTelegramId(telegramGroupId)
                        : null;
                    const kpiTarget = Number(group?.daily_kpi_target) || 15;

                    const mNow = moment ? moment().utcOffset(7) : null;
                    const dateStr = mNow ? mNow.format('YYYY-MM-DD') : new Date().toISOString().slice(0, 10);
                    const displayDate = mNow ? mNow.format('DD/MM/YYYY') : dateStr;

                    const checkins = await repository.findTodayCheckins(employee.id, dateStr, group?.id);
                    const validCount = (checkins || []).filter(c => c.is_valid !== false).length;
                    const isCompleted = validCount >= kpiTarget;

                    let listText = '';
                    if (!checkins || checkins.length === 0) {
                        listText = '<i>Hôm nay bạn chưa có lượt check-in điểm bán nào.</i>';
                    } else {
                        listText = checkins.slice().reverse().map((c, i) => {
                            const timeStr = mNow ? moment(c.checkin_time).utcOffset(7).format('HH:mm') : '';
                            return `${i + 1}. 🏪 <b>${c.store_name}</b> ${timeStr ? `<i>(${timeStr})</i>` : ''}\n   📍 <i>${c.store_address}</i>`;
                        }).join('\n\n');
                    }

                    let replyMarkup = undefined;
                    try {
                        const botUsername = ctx.botInfo?.username || process.env.BOT_USERNAME || 'bot';
                        const appShortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
                        const token = process.env.TELEGRAM_BOT_TOKEN || '';
                        const ts = Date.now();
                        if (crypto && token) {
                            const sig = crypto.createHmac('sha256', token).update(`retailhistory:${telegramGroupId}:${ts}`).digest('hex');
                            const historyDeepLink = `https://t.me/${botUsername}/${appShortName}?startapp=retailhistory_${telegramGroupId}_${ts}_${sig}`;
                            replyMarkup = {
                                inline_keyboard: [
                                    [
                                        { text: '📋 Lịch Sử', url: historyDeepLink }
                                    ]
                                ]
                            };
                        }
                    } catch (_) {}

                    const replyMsg = `📋 <b>DANH SÁCH ĐIỂM CHECK-IN HÔM NAY (${displayDate})</b>\n\n` +
                        `👤 <b>Nhân viên:</b> ${employee.full_name}\n` +
                        `🎯 <b>Tiến độ:</b> ${validCount}/${kpiTarget} điểm ${isCompleted ? '✅ (Hoàn thành)' : '⏳ (Đang thực hiện)'}\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `${listText}\n\n` +
                        `💡 <i>Để xem ảnh chi tiết và tra cứu các ngày trong quá khứ, bấm nút bên dưới:</i>`;

                    await ctx.reply(replyMsg, {
                        parse_mode: 'HTML',
                        reply_to_message_id: msg.message_id,
                        reply_markup: replyMarkup
                    });
                    return;
                }
            }

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
                                    const loc = recentLocationByUser.get(finalEntry.telegramId);
                                    const hasValidLoc = loc && (Date.now() - loc.timestamp <= LOCATION_TTL_MS);
                                    const result = await processStoreCheckin({
                                        telegramId: finalEntry.telegramId,
                                        telegramGroupId: finalEntry.telegramGroupId,
                                        caption: finalEntry.caption,
                                        photos: finalEntry.photos,
                                        photoHashes: [],
                                        latitude: hasValidLoc ? loc.latitude : null,
                                        longitude: hasValidLoc ? loc.longitude : null,
                                        locationAccuracy: hasValidLoc ? loc.locationAccuracy : null
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

                // Nếu ĐÃ CÓ caption chứa dấu "-" -> xử lý check-in ngay lập tức (1 hoặc nhiều ảnh)
                if (cached.caption && cached.caption.includes('-')) {
                    const loc = recentLocationByUser.get(telegramId);
                    const hasValidLoc = loc && (Date.now() - loc.timestamp <= LOCATION_TTL_MS);
                    const result = await processStoreCheckin({
                        telegramId,
                        telegramGroupId,
                        caption: cached.caption,
                        photos: cached.photos,
                        photoHashes: [],
                        latitude: hasValidLoc ? loc.latitude : null,
                        longitude: hasValidLoc ? loc.longitude : null,
                        locationAccuracy: hasValidLoc ? loc.locationAccuracy : null
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

                if (cached && (Date.now() - cached.timestamp <= CACHE_TTL_MS) && cached.photos.length >= 1) {
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
                    const loc = recentLocationByUser.get(telegramId);
                    const hasValidLoc = loc && (Date.now() - loc.timestamp <= LOCATION_TTL_MS);
                    const result = await processStoreCheckin({
                        telegramId,
                        telegramGroupId,
                        caption: msg.text,
                        photos,
                        photoHashes: [],
                        latitude: hasValidLoc ? loc.latitude : null,
                        longitude: hasValidLoc ? loc.longitude : null,
                        locationAccuracy: hasValidLoc ? loc.locationAccuracy : null
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
