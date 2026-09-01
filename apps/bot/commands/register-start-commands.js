import crypto from 'crypto';

export function registerStartCommands({ bot, pool, requireGroupRole, timekeepHelpHtml }) {
    // ==========================================
    // 4. CẤU HÌNH BOT TELEGRAM
    // ==========================================
    async function startHandler(ctx) {
        try {
            const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
            const miniAppUrl = process.env.MINI_APP_URL || 'https://YOUR_TUNNEL.trycloudflare.com';
    
            if (isGroup) {
                const groupName = ctx.chat.title || 'Nhóm làm việc';
                const groupId = ctx.chat.id.toString();
    
                // Auto-update/insert group details
                const groupRes = await pool.query(
                    'INSERT INTO telegram_groups (telegram_group_id, group_name) VALUES ($1, $2) ON CONFLICT (telegram_group_id) DO UPDATE SET group_name = EXCLUDED.group_name RETURNING bot_role',
                    [groupId, groupName]
                );
                const botRole = groupRes.rows[0]?.bot_role;
    
                // Sinh Web App URL trực tiếp thay vì startapp
                const botUsername = ctx.botInfo?.username || process.env.BOT_USERNAME || 'bot';
                const appShortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
                const token = process.env.TELEGRAM_BOT_TOKEN || '';
                const ts = Date.now();
    
                const createWebAppUrl = (action, targetPage) => {
                    const dataString = `${action}:${groupId}:${ts}`;
                    const sig = crypto.createHmac('sha256', token).update(dataString).digest('hex');
                    // Bắt buộc dùng deep link (url) vì Telegram chặn web_app trong group chat
                    return `https://t.me/${botUsername}/${appShortName}?startapp=${action}_${groupId}_${ts}_${sig}`;
                };
    
                const registerUrl = createWebAppUrl('register', 'register.html');
                const scheduleclientUrl = createWebAppUrl('scheduleclient', 'schedule_client.html');
                const scheduleUrl = createWebAppUrl('schedule', 'schedule.html');
                const leaveUrl = createWebAppUrl('leave', 'urgent_leave.html');
                const checkinUrl = createWebAppUrl('checkin', 'checkin_upload.html');
                const statsUrl = createWebAppUrl('stats', 'stats.html');
                const baocaoUrl = createWebAppUrl('baocao', 'form.html');
                const customerUrl = createWebAppUrl('customer', 'customer_form.html');
    
                const schedclientSig = crypto.createHmac('sha256', token).update(`scheduleclient:${ctx.chat.id}:${ts}`).digest('hex');
                const scheduleclientUrl2 = `https://t.me/${botUsername}/${appShortName}?startapp=scheduleclient_${ctx.chat.id}_${ts}_${schedclientSig}`;
    
                const makeupclientSig = crypto.createHmac('sha256', token).update(`makeupclient:${ctx.chat.id}:${ts}`).digest('hex');
                const makeupclientUrl = `https://t.me/${botUsername}/${appShortName}?startapp=makeupclient_${ctx.chat.id}_${ts}_${makeupclientSig}`;
    
                // Generate dmUrl (Direct Message URL) for Report Form
                const dmUrl = `https://t.me/${botUsername}`; // Used for 'Điền Form Báo Cáo' which typically opens PM
    
                if (!botRole) {
                    await ctx.reply(
                        `⚠️ Nhóm chưa được phân quyền. Vui lòng liên hệ Admin để set quyền cho Bot trong nhóm này.`,
                        { parse_mode: 'HTML' }
                    );
                } else if (botRole === 'timekeep') {
                    await ctx.reply(
                        `Vui lòng chọn chức năng:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '👤 Đăng ký tài khoản', url: registerUrl },
                                        { text: '📸 Check-in (Upload Video)', url: checkinUrl }
                                    ],
                                    [
                                        { text: '📅 Đăng ký lịch tuần', url: scheduleUrl },
                                        { text: '🚨 Xin nghỉ đột xuất / Đi muộn', url: leaveUrl }
                                    ],
                                    [
                                        { text: '📊 Lịch & Đi muộn tháng này', url: statsUrl }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (botRole === 'warehouse') {
                    const whImportUrl = createWebAppUrl('whimport', 'warehouse_import.html');
                    const whExportUrl = createWebAppUrl('whexport', 'warehouse_export.html');
                    const whInventoryUrl = createWebAppUrl('whinventory', 'warehouse_inventory.html');
                    const whPricingUrl = createWebAppUrl('whpricing', 'warehouse_pricing.html');
    
                    await ctx.reply(
                        `Vui lòng chọn chức năng:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '👤 Đăng ký tài khoản', url: registerUrl }
                                    ],
                                    [
                                        { text: '📥 Nhập kho', url: whImportUrl },
                                        { text: '📤 Xuất kho', url: whExportUrl }
                                    ],
                                    [
                                        { text: '📊 Xem tồn kho', url: whInventoryUrl }
                                    ],
                                    [
                                        // Chỉ Admin/kế toán có quyền MANAGE_PRICING mới thao tác được —
                                        // ai không có quyền bấm vào vẫn bị chặn ở app, đây chỉ là lối vào chung.
                                        { text: '💰 Nhập đơn giá', url: whPricingUrl }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (botRole === 'report') {
                    await ctx.reply(
                        `Vui lòng chọn chức năng:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '👤 Đăng Ký Tài Khoản', url: registerUrl }
                                    ],
                                    [
                                        { text: '📝 Điền Báo Cáo KPI (Form)', url: baocaoUrl }
                                    ],
                                    [
                                        { text: '🔄 Cập Nhật Báo Cáo', callback_data: 'CHECK_UPDATE_REPORT' },
                                        { text: '📅 Đặt Lịch / Check Lịch', url: scheduleclientUrl2 }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (botRole === 'report_tour') {
                    await ctx.reply(
                        `Vui lòng chọn chức năng:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '👤 Đăng Ký Tài Khoản', url: registerUrl }
                                    ],
                                    [
                                        { text: '📅 Đặt Lịch / Check Lịch', url: scheduleclientUrl2 }
                                    ],
                                    [
                                        { text: '🕘 Báo Bù / Báo Công Muộn', url: makeupclientUrl }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (botRole === 'customer' || botRole === 'customer_record') {
                    await ctx.reply(
                        `Vui lòng chọn chức năng:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '👤 Đăng Ký Tài Khoản', url: registerUrl }
                                    ],
                                    [
                                        { text: '☘️ Điền Thông Tin Khách Hàng', url: customerUrl }
                                    ]
                                ]
                            }
                        }
                    );
                }
            } else {
                // Private Chat Flow
                const startPayload = ctx.startPayload;
    
                if (startPayload && startPayload.startsWith('reg_')) {
                    const groupId = startPayload.replace('reg_', '');
                    const registerUrl = `${miniAppUrl}/mini-app/register.html?chat_id=${groupId}`;
    
                    await ctx.reply(
                        `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                        `Vui lòng nhấn nút <b>Đăng ký ngay</b> dưới đây để hoàn tất thông tin cá nhân:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '👤 Đăng ký ngay', web_app: { url: registerUrl } }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (startPayload && startPayload.startsWith('sched_')) {
                    const groupId = startPayload.replace('sched_', '');
                    const scheduleUrl = `${miniAppUrl}/mini-app/schedule.html?chat_id=${groupId}`;
    
                    await ctx.reply(
                        `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                        `Vui lòng nhấn nút <b>Đăng ký lịch</b> dưới đây để xếp ca làm việc tuần tiếp theo:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📅 Đăng ký lịch tuần', web_app: { url: scheduleUrl } }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (startPayload && startPayload.startsWith('leave_')) {
                    const groupId = startPayload.replace('leave_', '');
                    const leaveUrl = `${miniAppUrl}/mini-app/urgent_leave.html?chat_id=${groupId}`;
    
                    await ctx.reply(
                        `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                        `Vui lòng nhấn nút <b>Báo nghỉ đột xuất</b> dưới đây để gửi yêu cầu nghỉ hoặc đi muộn:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '🚨 Xin nghỉ / Đi muộn', web_app: { url: leaveUrl } }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (startPayload && startPayload.startsWith('checkin_')) {
                    const groupId = startPayload.replace('checkin_', '');
                    const checkinUrl = `${miniAppUrl}/mini-app/checkin_upload.html?chat_id=${groupId}`;
    
                    await ctx.reply(
                        `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                        `Vui lòng nhấn nút <b>Tải Up Video Check-in</b> dưới đây để điểm danh bằng Video:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📸 Tải Up Video Check-in', web_app: { url: checkinUrl } }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (startPayload && startPayload.startsWith('stats_')) {
                    const groupId = startPayload.replace('stats_', '');
                    const statsUrl = `${miniAppUrl}/mini-app/stats.html?chat_id=${groupId}`;
    
                    await ctx.reply(
                        `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                        `Vui lòng nhấn nút <b>Xem thống kê của tôi</b> dưới đây để theo dõi lịch tuần này, tuần sau và lịch sử đi muộn/tiền phạt tháng này:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📊 Xem thống kê của tôi', web_app: { url: statsUrl } }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (startPayload && startPayload.startsWith('customer_')) {
                    const payloadParts = startPayload.split('_');
                    const groupId = payloadParts[1] || startPayload.replace('customer_', '');
                    const formUrl = `${miniAppUrl}/mini-app/customer_form.html?chat_id=${groupId}`;
    
                    await ctx.reply(
                        `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                        `Vui lòng nhấn nút <b>Điền thông tin khách hàng</b> dưới đây để bắt đầu nhập thông tin:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '☘️ Điền Thông Tin Khách Hàng', web_app: { url: formUrl } }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (startPayload && startPayload.startsWith('whimport_')) {
                    const payloadParts = startPayload.split('_');
                    const groupId = payloadParts[1];
                    const ts = payloadParts[2];
                    const sig = payloadParts[3];
                    const formUrl = `${miniAppUrl}/mini-app/warehouse_import.html?chat_id=${groupId}&ts=${ts}&sig=${sig}&action=whimport`;
    
                    await ctx.reply(
                        `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                        `Vui lòng nhấn nút <b>Nhập Kho</b> dưới đây để bắt đầu nhập sản phẩm:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📥 Nhập Kho', web_app: { url: formUrl } }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (startPayload && startPayload.startsWith('whexport_')) {
                    const payloadParts = startPayload.split('_');
                    const groupId = payloadParts[1];
                    const ts = payloadParts[2];
                    const sig = payloadParts[3];
                    // Mini App xuất kho tự đọc cờ warehouse_service_order_enabled qua
                    // /api/warehouse/service-order/bootstrap rồi bật hoặc khóa luồng đơn
                    // theo dịch vụ ngay trong màn hình chọn loại đơn. Bot không cần truy
                    // vấn cờ để chọn trang nữa nên bỏ được một query mỗi lần mở link.
                    const formUrl = `${miniAppUrl}/mini-app/warehouse_export.html?chat_id=${groupId}&ts=${ts}&sig=${sig}&action=whexport`;
    
                    await ctx.reply(
                        `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                        `Vui lòng nhấn nút <b>Xuất Kho</b> dưới đây để gửi yêu cầu xuất sản phẩm:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📤 Xuất Kho', web_app: { url: formUrl } }
                                    ]
                                ]
                            }
                        }
                    );
                } else if (startPayload && startPayload.startsWith('whinventory_')) {
                    const payloadParts = startPayload.split('_');
                    const groupId = payloadParts[1];
                    const ts = payloadParts[2];
                    const sig = payloadParts[3];
                    const formUrl = `${miniAppUrl}/mini-app/warehouse_inventory.html?chat_id=${groupId}&ts=${ts}&sig=${sig}&action=whinventory`;
    
                    await ctx.reply(
                        `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                        `Vui lòng nhấn nút <b>Xem Tồn Kho</b> dưới đây để kiểm tra số lượng hàng trong kho:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📊 Xem Tồn Kho', web_app: { url: formUrl } }
                                    ]
                                ]
                            }
                        }
                    );
                } else {
                    const botInfo = await ctx.telegram.getMe();
                    const addToGroupUrl = `https://t.me/${botInfo.username}?startgroup=true`;
    
                    await ctx.reply(
                        `👋 Xin chào <b>${ctx.from.first_name}</b>!\n\n` +
                        `Để đăng ký tài khoản hoặc lịch làm việc, vui lòng nhấn các nút trong nhóm làm việc của bạn.\n\n` +
                        `👉 Nếu Bot chưa được đưa vào nhóm làm việc, nhấn nút dưới đây để thêm:`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '➕ Thêm Bot vào nhóm', url: addToGroupUrl }
                                    ]
                                ]
                            }
                        }
                    );
                }
            }
        } catch (e) {
            console.error('Lỗi startHandler:', e?.stack || e);
        }
    }
    
    bot.start(startHandler);
    bot.command(['app', 'menu', 'setup', 'chamcong', 'form', 'lamviec', 'tienich'], startHandler);
    bot.command(['help', 'huongdan'], async (ctx) => {
        if (!(await requireGroupRole(ctx, 'timekeep'))) return;
        return ctx.replyWithHTML(timekeepHelpHtml);
    });
}
