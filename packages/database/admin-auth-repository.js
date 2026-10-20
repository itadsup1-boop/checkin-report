export function createAdminAuthRepository({ pool }) {
    async function findActiveAdminByUsername(username) {
        const result = await pool.query(
            `SELECT id, username, password_hash, full_name, role, is_active
             FROM admin_accounts
             WHERE LOWER(username) = LOWER($1) AND is_active = TRUE
             LIMIT 1`,
            [username]
        );
        return result.rows[0] || null;
    }

    async function updatePasswordHash(adminId, passwordHash) {
        await pool.query(
            `UPDATE admin_accounts
             SET password_hash = $1, password_changed_at = NOW()
             WHERE id = $2`,
            [passwordHash, adminId]
        );
    }

    async function updateLastLogin(adminId) {
        await pool.query('UPDATE admin_accounts SET last_login_at = NOW() WHERE id = $1', [adminId]);
    }

    async function getAssignedGroupIds(adminId, role) {
        if (role === 'SUPER_ADMIN') {
            const result = await pool.query(
                'SELECT telegram_group_id FROM telegram_groups WHERE is_deleted = FALSE OR is_deleted IS NULL'
            );
            return result.rows.map(row => row.telegram_group_id);
        }
        const result = await pool.query(
            'SELECT telegram_group_id FROM admin_group_mappings WHERE admin_id = $1',
            [adminId]
        );
        return result.rows.map(row => row.telegram_group_id);
    }

    async function createSession({ adminId, tokenHash, expiresAt, ipAddress, userAgent }) {
        await pool.query(
            `INSERT INTO admin_sessions
                (admin_id, token_hash, expires_at, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5)`,
            [adminId, tokenHash, expiresAt, ipAddress || null, userAgent || null]
        );
    }

    async function findSession(tokenHash) {
        const result = await pool.query(
            `SELECT session.id AS session_id, session.expires_at, session.last_used_at,
                    admin.id, admin.username, admin.full_name, admin.role, admin.is_active
             FROM admin_sessions session
             JOIN admin_accounts admin ON admin.id = session.admin_id
             WHERE session.token_hash = $1
               AND session.revoked_at IS NULL
               AND session.expires_at > NOW()
               AND admin.is_active = TRUE
             LIMIT 1`,
            [tokenHash]
        );
        return result.rows[0] || null;
    }

    async function touchSession(sessionId) {
        await pool.query(
            `UPDATE admin_sessions
             SET last_used_at = NOW()
             WHERE id = $1 AND last_used_at < NOW() - INTERVAL '5 minutes'`,
            [sessionId]
        );
    }

    async function revokeSession(tokenHash) {
        await pool.query(
            'UPDATE admin_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
            [tokenHash]
        );
    }

    async function revokeAdminSessions(adminId) {
        await pool.query(
            'UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_id = $1 AND revoked_at IS NULL',
            [adminId]
        );
    }

    async function deleteExpiredSessions() {
        await pool.query(
            `DELETE FROM admin_sessions
             WHERE expires_at < NOW() - INTERVAL '7 days' OR revoked_at < NOW() - INTERVAL '7 days'`
        );
    }

    return {
        findActiveAdminByUsername,
        updatePasswordHash,
        updateLastLogin,
        getAssignedGroupIds,
        createSession,
        findSession,
        touchSession,
        revokeSession,
        revokeAdminSessions,
        deleteExpiredSessions
    };
}
