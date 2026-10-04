import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

function safeEqualText(left, right) {
    const a = Buffer.from(String(left));
    const b = Buffer.from(String(right));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function validateAdminPassword(password, username = '') {
    const value = String(password || '');
    if (value.length < 12) return { ok: false, message: 'Mật khẩu phải có ít nhất 12 ký tự.' };
    if (value.length > 128) return { ok: false, message: 'Mật khẩu không được vượt quá 128 ký tự.' };
    if (username && value.toLocaleLowerCase('vi').includes(String(username).toLocaleLowerCase('vi'))) {
        return { ok: false, message: 'Mật khẩu không được chứa tên đăng nhập.' };
    }
    return { ok: true };
}

export async function hashAdminPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scryptAsync(String(password), salt, KEY_LENGTH, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: 64 * 1024 * 1024
    });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`;
}

export async function verifyAdminPassword(password, storedHash) {
    const stored = String(storedHash || '');
    if (!stored.startsWith('scrypt$')) {
        return { valid: safeEqualText(password, stored), needsRehash: true };
    }

    const parts = stored.split('$');
    if (parts.length !== 6) return { valid: false, needsRehash: false };
    const [, nText, rText, pText, saltText, keyText] = parts;
    const N = Number(nText);
    const r = Number(rText);
    const p = Number(pText);
    if (![N, r, p].every(Number.isInteger)) return { valid: false, needsRehash: false };

    try {
        const salt = Buffer.from(saltText, 'base64url');
        const expected = Buffer.from(keyText, 'base64url');
        const actual = Buffer.from(await scryptAsync(String(password), salt, expected.length, {
            N,
            r,
            p,
            maxmem: 64 * 1024 * 1024
        }));
        return {
            valid: actual.length === expected.length && crypto.timingSafeEqual(actual, expected),
            needsRehash: N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P
        };
    } catch {
        return { valid: false, needsRehash: false };
    }
}

export function createAdminSessionToken() {
    return crypto.randomBytes(32).toString('base64url');
}

export function hashAdminSessionToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}
