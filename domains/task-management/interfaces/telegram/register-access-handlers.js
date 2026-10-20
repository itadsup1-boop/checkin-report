import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Đọc lại ADMIN_IDS từ .env mỗi lần gọi để nhận thay đổi mà không cần restart
// (cùng cách với checkAdmin trong apps/bot/kpi_features.js). Khác kpi_features:
// thiếu hoặc để trống ADMIN_IDS thì TỪ CHỐI, vì /capma là lệnh cấp quyền quản lý.
export function loadTaskAdminIds() {
    try {
        const envPath = path.resolve(__dirname, '../../../../.env');
        const content = fs.readFileSync(envPath, 'utf8');
        const line = content.split('\n').find(l => l.startsWith('ADMIN_IDS='));
        if (!line) return [];
        return (line.split('=')[1] || '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean);
    } catch (error) {
        console.error('[TaskManagement] Lỗi đọc ADMIN_IDS từ .env:', error.message);
        return [];
    }
}

function formatScope(scope) {
    const groups = scope.filter(s => s.type === 'TELEGRAM_GROUP').map(s => s.value);
    const employees = scope.filter(s => s.type === 'EMPLOYEE').map(s => s.value);
    const parts = [];
    if (groups.length) parts.push(`Nhóm: ${groups.join(', ')}`);
    if (employees.length) parts.push(`Nhân viên: ${employees.join(', ')}`);
    return parts.length ? parts.join(' | ') : 'Toàn hệ thống (chưa giới hạn)';
}

function formatDateTime(date) {
    return new Date(date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

export function registerTaskAccessHandlers({ bot, accessService, loadAdminIds = loadTaskAdminIds }) {
    const isDm = (ctx) => ctx.chat?.type === 'private';

    bot.command('capma', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Mã kích hoạt chỉ được tạo trong tin nhắn riêng với bot.');
        }
        const adminId = String(ctx.from.id);
        if (!loadAdminIds().includes(adminId)) {
            return ctx.reply('❌ Lệnh này chỉ dành cho quản trị viên (danh sách ADMIN_IDS trong .env).');
        }

        const parts = (ctx.message.text || '').trim().split(/\s+/).slice(1);
        if (!parts.length) {
            return ctx.reply([
                'Cú pháp: /capma <ROLE> [group_id1,group_id2,...] [bind:<telegram_id>]',
                'Ví dụ: /capma MANAGER -1001234567890,-1009876543210',
                'Ví dụ: /capma TEAM_LEAD bind:8031762214',
                'Role: OWNER | MANAGER | TEAM_LEAD. Mã dùng một lần, hết hạn sau 24 giờ.'
            ].join('\n'));
        }

        const role = parts[0].toUpperCase();
        const groupIds = [];
        let boundTelegramUserId = null;
        for (const token of parts.slice(1)) {
            if (token.toLowerCase().startsWith('bind:')) {
                boundTelegramUserId = token.slice(5);
            } else if (/^-?\d+$/.test(token)) {
                groupIds.push(token);
            } else {
                return ctx.reply(`❌ Tham số không hợp lệ: "${token}". Group ID phải là số (ví dụ -1001234567890).`);
            }
        }

        try {
            const created = await accessService.createAccessCode({
                role,
                scope: groupIds.map(id => ({ type: 'TELEGRAM_GROUP', value: id })),
                createdBy: adminId,
                boundTelegramUserId
            });
            return ctx.reply([
                '✅ Đã tạo mã kích hoạt (dùng một lần):',
                `<code>${created.code}</code>`,
                `Role: ${created.role}`,
                `Hết hạn: ${formatDateTime(created.expiresAt)}`,
                boundTelegramUserId ? `Ràng buộc Telegram ID: ${boundTelegramUserId}` : 'Không ràng buộc người nhận.',
                `Phạm vi: ${formatScope(created.scope)}`,
                'Gửi mã cho quản lý qua kênh an toàn. Quản lý nhắn riêng cho bot: /kichhoat <mã>'
            ].join('\n'), { parse_mode: 'HTML' });
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    });

    bot.command('kichhoat', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Mã kích hoạt chỉ được nhập trong tin nhắn riêng với bot. Hãy nhắn riêng cho bot.');
        }
        const parts = (ctx.message.text || '').trim().split(/\s+/).slice(1);
        if (!parts.length) {
            return ctx.reply('Cú pháp: /kichhoat <mã>. Mã do quản trị viên cấp.');
        }
        const telegramUserId = String(ctx.from.id);
        try {
            const result = await accessService.redeemCode({ code: parts.join(' '), telegramUserId });
            return ctx.reply([
                '🎉 Kích hoạt thành công!',
                `Role: ${result.role}`,
                `Quyền: ${result.permissions.join(', ')}`,
                `Phạm vi: ${formatScope(result.scope)}`,
                'Giờ bạn có thể giao việc ngay tại đây: /giao NV001,NV002 | nội dung | 17:30'
            ].join('\n'));
        } catch (error) {
            return ctx.reply(error.message || '❌ Kích hoạt thất bại.');
        }
    });

    bot.command('thuhoi', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Lệnh thu hồi chỉ dùng trong tin nhắn riêng với bot.');
        }
        const adminId = String(ctx.from.id);
        if (!loadAdminIds().includes(adminId)) {
            return ctx.reply('❌ Lệnh này chỉ dành cho quản trị viên (danh sách ADMIN_IDS trong .env).');
        }
        const target = (ctx.message.text || '').trim().split(/\s+/)[1];
        if (!target || !/^\d+$/.test(target)) {
            return ctx.reply('Cú pháp: /thuhoi <telegram_user_id>. Lấy ID bằng lệnh /myid của người đó.');
        }
        try {
            await accessService.revokeManager({ telegramUserId: target, revokedBy: adminId });
            return ctx.reply(`✅ Đã thu hồi quyền quản lý của Telegram ID ${target}.`);
        } catch (error) {
            return ctx.reply(error.message || '❌ Thu hồi thất bại.');
        }
    });

    bot.command('quyen', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Lệnh này chỉ dùng trong tin nhắn riêng với bot.');
        }
        const manager = await accessService.getManager(String(ctx.from.id));
        if (!manager) {
            return ctx.reply('Bạn chưa kích hoạt quyền quản lý. Nếu có mã, hãy nhắn: /kichhoat <mã>');
        }
        return ctx.reply([
            `👤 Role: ${manager.role}`,
            `Trạng thái: ${manager.status}`,
            `Quyền: ${(manager.permissions || []).join(', ') || '(không có)'}`,
            `Phạm vi: ${formatScope(manager.scopes || [])}`,
            `Kích hoạt lúc: ${formatDateTime(manager.activated_at)}`
        ].join('\n'));
    });
}
