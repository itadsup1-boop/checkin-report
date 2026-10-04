import { Api, TelegramClient, sessions } from 'teleproto';

function credentials() {
    const apiId = Number(process.env.TELEGRAM_API_ID);
    const apiHash = String(process.env.TELEGRAM_API_HASH || '');
    if (!Number.isInteger(apiId) || !apiHash) throw new Error('Chưa cấu hình TELEGRAM_API_ID/TELEGRAM_API_HASH.');
    return { apiId, apiHash };
}

async function openClient(session = '') {
    const { apiId, apiHash } = credentials();
    const client = new TelegramClient(new sessions.StringSession(session), apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    return client;
}

export function createMtprotoGateway() {
    return {
        async sendCode(phone) {
            const client = await openClient();
            try {
                const result = await client.sendCode(credentials(), phone);
                return { ...result, session: client.session.save() };
            } finally { await client.disconnect(); }
        },

        async signInCode({ session, phone, phoneCodeHash, code }) {
            const client = await openClient(session);
            try {
                const result = await client.invoke(new Api.auth.SignIn({
                    phoneNumber: phone,
                    phoneCodeHash,
                    phoneCode: code
                }));
                if (result instanceof Api.auth.AuthorizationSignUpRequired) {
                    throw new Error('Tài khoản Telegram này chưa đăng ký; hệ thống không tự tạo tài khoản mới.');
                }
                return { user: result.user, session: client.session.save() };
            } catch (error) {
                if (error?.errorMessage === 'SESSION_PASSWORD_NEEDED') {
                    return { passwordNeeded: true, session: client.session.save() };
                }
                throw error;
            } finally { await client.disconnect(); }
        },

        async signInPassword({ session, password }) {
            const client = await openClient(session);
            try {
                const user = await client.signInWithPassword(credentials(), {
                    password: async () => password,
                    onError: async () => true
                });
                return { user, session: client.session.save() };
            } finally { await client.disconnect(); }
        },

        async listGroups(session) {
            const client = await openClient(session);
            try {
                if (!await client.checkAuthorization()) throw new Error('Phiên Telegram đã hết hiệu lực.');
                const dialogs = await client.getDialogs({ limit: 500 });
                return dialogs.filter(dialog => dialog.isGroup).map(dialog => {
                    const entity = dialog.entity;
                    const rights = entity?.adminRights;
                    const owner = Boolean(entity?.creator);
                    const admin = owner || Boolean(rights);
                    return {
                        telegramGroupId: String(dialog.id),
                        title: dialog.title || dialog.name || 'Nhóm không tên',
                        groupType: entity instanceof Api.Channel ? 'supergroup' : 'group',
                        memberCount: Number(entity?.participantsCount || 0) || null,
                        isOwner: owner,
                        isAdmin: admin,
                        canDeleteMessages: owner || Boolean(rights?.deleteMessages),
                        canRestrictMembers: owner || Boolean(rights?.banUsers),
                        canDeleteGroup: owner
                    };
                });
            } finally { await client.disconnect(); }
        },

        async execute({ session, telegramGroupId, action, onMemberRemoved }) {
            const client = await openClient(session);
            try {
                const entity = await client.getEntity(telegramGroupId);
                const owner = Boolean(entity?.creator);
                const rights = entity?.adminRights;
                if (action === 'DELETE') {
                    if (!owner) throw new Error('Chỉ chủ sở hữu Telegram mới có thể xóa hẳn nhóm.');
                    if (entity instanceof Api.Channel) await client.invoke(new Api.channels.DeleteChannel({ channel: entity }));
                    else await client.invoke(new Api.messages.DeleteChat({ chatId: entity.id }));
                    return { removedMembers: 0 };
                }
                if (!(owner || rights?.banUsers) || !(owner || rights?.deleteMessages)) {
                    throw new Error('Tài khoản không còn đủ quyền xóa thành viên và tin nhắn.');
                }
                const self = await client.getMe();
                const participants = await client.getParticipants(entity, { limit: 10000 });
                let removedMembers = 0;
                for (const participant of participants) {
                    if (String(participant.id) === String(self.id) || participant.bot) continue;
                    try {
                        await client.kickParticipant(entity, participant);
                        removedMembers += 1;
                        await onMemberRemoved?.(removedMembers);
                    } catch (error) {
                        if (!['USER_ADMIN_INVALID', 'CHAT_ADMIN_REQUIRED'].includes(error?.errorMessage)) throw error;
                    }
                }
                await client.deleteHistory(entity, { maxId: 2147483647, revoke: true });
                return { removedMembers };
            } finally { await client.disconnect(); }
        }
    };
}
