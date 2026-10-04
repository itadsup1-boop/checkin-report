import crypto from 'node:crypto';
import { hashAdminPassword, validateAdminPassword, verifyAdminPassword } from '../../../packages/shared/admin-auth-crypto.js';
import { decryptSecret, encryptSecret, telegramConfiguration } from '../infrastructure/secret-box.js';

const cleanPhone = value => String(value || '').replace(/[\s()-]/g, '');
const maskPhone = phone => `${phone.slice(0, Math.min(4, phone.length))}${'*'.repeat(Math.max(0, phone.length - 7))}${phone.slice(-3)}`;

export function createTelegramAutomationService({ repository, gateway }) {
    async function connectedAccount(id) {
        const account = await repository.account(id);
        if (!account || account.status !== 'CONNECTED' || !account.session_encrypted) throw new Error('Tài khoản Telegram chưa kết nối.');
        return account;
    }

    return {
        config: async adminId => ({ ...telegramConfiguration(), destructivePasswordSet: Boolean(await repository.credential(adminId)) }),
        accounts: () => repository.accounts(),
        groups: id => repository.groups(id),
        async startConnection({ displayName, phone, adminId }) {
            const normalized = cleanPhone(phone);
            if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new Error('Số điện thoại phải có mã quốc gia, ví dụ +84901234567.');
            const sent = await gateway.sendCode(normalized);
            return repository.createAccount({
                displayName: String(displayName || 'Tài khoản Telegram').trim().slice(0, 100),
                phoneMasked: maskPhone(normalized), phoneEncrypted: encryptSecret(normalized),
                sessionEncrypted: encryptSecret(sent.session), codeHashEncrypted: encryptSecret(sent.phoneCodeHash), adminId
            });
        },
        async submitCode(id, code) {
            const account = await repository.account(id);
            if (!account || account.status !== 'PENDING_CODE') throw new Error('Yêu cầu mã xác minh không còn hiệu lực.');
            const result = await gateway.signInCode({ session: decryptSecret(account.session_encrypted), phone: decryptSecret(account.phone_encrypted),
                phoneCodeHash: decryptSecret(account.phone_code_hash_encrypted), code: String(code || '').trim() });
            if (result.passwordNeeded) return repository.updateLogin(id, { session: encryptSecret(result.session), status: 'PENDING_PASSWORD' });
            return repository.updateLogin(id, { session: encryptSecret(result.session), userId: String(result.user.id), username: result.user.username, status: 'CONNECTED' });
        },
        async submitPassword(id, password) {
            const account = await repository.account(id);
            if (!account || account.status !== 'PENDING_PASSWORD') throw new Error('Tài khoản không chờ mật khẩu Telegram.');
            const result = await gateway.signInPassword({ session: decryptSecret(account.session_encrypted), password: String(password || '') });
            return repository.updateLogin(id, { session: encryptSecret(result.session), userId: String(result.user.id), username: result.user.username, status: 'CONNECTED' });
        },
        async sync(id) {
            const account = await connectedAccount(id);
            const groups = await gateway.listGroups(decryptSecret(account.session_encrypted));
            await repository.syncGroups(id, groups);
            return groups;
        },
        async setDestructivePassword(adminId, password, currentPassword) {
            const existing = await repository.credential(adminId);
            if (existing) {
                const current = await verifyAdminPassword(currentPassword, existing.password_hash);
                if (!current.valid) throw new Error('Mật khẩu cấp 2 hiện tại không chính xác.');
            }
            const validation = validateAdminPassword(password);
            if (!validation.ok) throw new Error(validation.message);
            await repository.setCredential(adminId, await hashAdminPassword(password));
        },
        async preview({ accountId, groupIds, action, adminId }) {
            if (!['RESET', 'DELETE'].includes(action)) throw new Error('Loại thao tác không hợp lệ.');
            if (!Array.isArray(groupIds) || groupIds.length < 1 || groupIds.length > 20) throw new Error('Chọn từ 1 đến 20 nhóm.');
            const account = await connectedAccount(accountId);
            const liveGroups = await gateway.listGroups(decryptSecret(account.session_encrypted));
            await repository.syncGroups(accountId, liveGroups);
            const phrase = `XOA ${groupIds.length} NHOM ${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            return repository.createOperation({ accountId, adminId, action, phrase, groupIds: [...new Set(groupIds.map(String))] });
        },
        async confirm({ operationId, phrase, password, adminId }) {
            const operation = await repository.operation(operationId);
            if (!operation || String(operation.requested_by) !== String(adminId)) throw new Error('Phiên thao tác không tồn tại.');
            if (operation.status !== 'AWAITING_CONFIRMATION' || new Date(operation.expires_at) <= new Date()) throw new Error('Phiên xác nhận đã hết hạn.');
            if (String(phrase || '') !== operation.confirmation_phrase) throw new Error('Cụm từ xác nhận không chính xác.');
            const credential = await repository.credential(adminId);
            if (!credential) throw new Error('Bạn chưa thiết lập mật khẩu cấp 2.');
            if (credential.locked_until && new Date(credential.locked_until) > new Date()) throw new Error('Mật khẩu cấp 2 đang bị khóa 15 phút do nhập sai nhiều lần.');
            const verified = await verifyAdminPassword(password, credential.password_hash);
            await repository.credentialFailure(adminId, verified.valid);
            if (!verified.valid) throw new Error('Mật khẩu cấp 2 không chính xác.');
            await repository.queueOperation(operationId);
        },
        operation: id => repository.operation(id),
        async runNext() {
            const operation = await repository.claimOperation();
            if (!operation) return false;
            const account = await connectedAccount(operation.account_id);
            const groups = (await repository.operation(operation.id)).groups;
            for (const group of groups) {
                await repository.startGroup(operation.id, group.managed_group_id);
                try {
                    const result = await gateway.execute({ session: decryptSecret(account.session_encrypted), telegramGroupId: group.telegram_group_id, action: group.resolved_action });
                    await repository.finishGroup(operation.id, group.managed_group_id, result.removedMembers, null);
                } catch (error) {
                    await repository.finishGroup(operation.id, group.managed_group_id, 0, String(error.message || error).slice(0, 1000));
                }
            }
            await repository.finishOperation(operation.id);
            return true;
        }
    };
}
