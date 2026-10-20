import crypto from 'node:crypto';

function encryptionKey() {
    const configured = String(process.env.TELEGRAM_SESSION_ENCRYPTION_KEY || '');
    if (!configured) throw new Error('Chưa cấu hình TELEGRAM_SESSION_ENCRYPTION_KEY.');
    return crypto.createHash('sha256').update(configured).digest();
}

export function encryptSecret(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(payload) {
    const [version, iv, tag, data] = String(payload || '').split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Dữ liệu phiên Telegram không hợp lệ.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export function telegramConfiguration() {
    return {
        apiCredentials: Boolean(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH),
        encryptionKey: Boolean(process.env.TELEGRAM_SESSION_ENCRYPTION_KEY)
    };
}
