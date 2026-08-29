import {
    createAdminSessionToken,
    hashAdminPassword,
    hashAdminSessionToken,
    verifyAdminPassword
} from '../../packages/shared/admin-auth-crypto.js';
import { createAdminAuthRepository } from '../../packages/database/admin-auth-repository.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();

function sessionHours() {
    const configured = Number(process.env.ADMIN_SESSION_HOURS || 8);
    return Number.isFinite(configured) ? Math.min(Math.max(configured, 1), 24) : 8;
}

function bearerToken(req) {
    const header = String(req.headers.authorization || '');
    const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{40,})$/);
    return match?.[1] || null;
}

function loginKey(req, username) {
    return `${req.ip || req.socket?.remoteAddress || 'unknown'}:${String(username).toLocaleLowerCase('vi')}`;
}

function currentFailure(key) {
    const entry = loginFailures.get(key);
    if (!entry || entry.resetAt <= Date.now()) {
        loginFailures.delete(key);
        return null;
    }
    return entry;
}

function recordFailure(key) {
    const current = currentFailure(key);
    loginFailures.set(key, current
        ? { count: current.count + 1, resetAt: current.resetAt }
        : { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
}

export function createAdminAuth({ pool }) {
    const repository = createAdminAuthRepository({ pool });

    function registerLoginRoute(app) {
        app.post('/api/admin/login', async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            const username = String(req.body.username || '').trim().slice(0, 100);
            const password = String(req.body.password || '');
            const key = loginKey(req, username);
            const failures = currentFailure(key);
            if (failures?.count >= LOGIN_MAX_FAILURES) {
                const retrySeconds = Math.max(1, Math.ceil((failures.resetAt - Date.now()) / 1000));
                res.setHeader('Retry-After', String(retrySeconds));
                return res.status(429).json({ success: false, message: 'Đăng nhập bị tạm khóa. Vui lòng thử lại sau.' });
            }

            try {
                const admin = username ? await repository.findActiveAdminByUsername(username) : null;
                const verification = admin
                    ? await verifyAdminPassword(password, admin.password_hash)
                    : { valid: false, needsRehash: false };

                // Tài khoản mặc định cũ là thông tin công khai trong source; bắt buộc bootstrap lại.
                const insecureDefault = admin?.username === 'admin' && admin.password_hash === 'admin123';
                if (!admin || !verification.valid || insecureDefault) {
                    recordFailure(key);
                    return res.status(401).json({ success: false, message: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
                }

                if (verification.needsRehash) {
                    await repository.updatePasswordHash(admin.id, await hashAdminPassword(password));
                }

                const token = createAdminSessionToken();
                const expiresAt = new Date(Date.now() + sessionHours() * 60 * 60 * 1000);
                await repository.createSession({
                    adminId: admin.id,
                    tokenHash: hashAdminSessionToken(token),
                    expiresAt,
                    ipAddress: req.ip || req.socket?.remoteAddress,
                    userAgent: String(req.headers['user-agent'] || '').slice(0, 500)
                });
                await Promise.all([
                    repository.updateLastLogin(admin.id),
                    repository.deleteExpiredSessions()
                ]);
                loginFailures.delete(key);

                const assignedGroups = await repository.getAssignedGroupIds(admin.id, admin.role);
                return res.json({
                    success: true,
                    token,
                    expires_at: expiresAt.toISOString(),
                    user: {
                        id: admin.id,
                        username: admin.username,
                        full_name: admin.full_name || admin.username,
                        role: admin.role,
                        assigned_groups: assignedGroups
                    }
                });
            } catch (error) {
                console.error('[Admin Auth] Login failed:', error);
                return res.status(500).json({ success: false, message: 'Không thể đăng nhập vào lúc này.' });
            }
        });
    }

    async function authenticateAdmin(req, res, next) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        const token = bearerToken(req);
        if (!token) return res.status(401).json({ success: false, message: 'Phiên Admin không hợp lệ.' });

        try {
            const session = await repository.findSession(hashAdminSessionToken(token));
            if (!session) return res.status(401).json({ success: false, message: 'Phiên Admin đã hết hạn hoặc bị thu hồi.' });
            const allowedGroupIds = await repository.getAssignedGroupIds(session.id, session.role);
            req.admin = {
                id: String(session.id),
                sessionId: session.session_id,
                username: session.username,
                fullName: session.full_name,
                role: session.role,
                isSuperAdmin: session.role === 'SUPER_ADMIN',
                allowedGroupIds: allowedGroupIds.map(String),
                tokenHash: hashAdminSessionToken(token)
            };
            await repository.touchSession(session.session_id);
            return next();
        } catch (error) {
            console.error('[Admin Auth] Session validation failed:', error);
            return res.status(500).json({ success: false, message: 'Không thể xác thực phiên Admin.' });
        }
    }

    function requireSuperAdmin(req, res, next) {
        if (!req.admin?.isSuperAdmin) {
            return res.status(403).json({ success: false, message: 'Chỉ Super Admin được thực hiện thao tác này.' });
        }
        return next();
    }

    function registerSessionRoutes(app) {
        app.get('/api/admin/session', (req, res) => res.json({
            success: true,
            user: {
                id: req.admin.id,
                username: req.admin.username,
                full_name: req.admin.fullName || req.admin.username,
                role: req.admin.role,
                assigned_groups: req.admin.allowedGroupIds
            }
        }));

        app.post('/api/admin/logout', async (req, res) => {
            await repository.revokeSession(req.admin.tokenHash);
            res.json({ success: true });
        });
    }

    async function getAdminAuthContext(req) {
        return {
            isSuperAdmin: req.admin.isSuperAdmin,
            allowedGroupIds: req.admin.allowedGroupIds
        };
    }

    return {
        repository,
        registerLoginRoute,
        authenticateAdmin,
        requireSuperAdmin,
        registerSessionRoutes,
        getAdminAuthContext
    };
}
