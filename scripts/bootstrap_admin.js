import pool from '../packages/database/index.js';
import { hashAdminPassword, validateAdminPassword } from '../packages/shared/admin-auth-crypto.js';

async function run() {
    const username = String(process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin').trim();
    const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '');
    const fullName = String(process.env.ADMIN_BOOTSTRAP_FULL_NAME || 'System Administrator').trim();
    const validation = validateAdminPassword(password, username);
    if (!validation.ok) throw new Error(`ADMIN_BOOTSTRAP_PASSWORD: ${validation.message}`);

    const passwordHash = await hashAdminPassword(password);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO admin_accounts
                (username, password_hash, full_name, role, is_active, password_changed_at)
             VALUES ($1, $2, $3, 'SUPER_ADMIN', TRUE, NOW())
             ON CONFLICT (username) DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                full_name = EXCLUDED.full_name,
                role = 'SUPER_ADMIN',
                is_active = TRUE,
                password_changed_at = NOW()
             RETURNING id, username`,
            [username, passwordHash, fullName]
        );
        await client.query(
            'UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_id = $1 AND revoked_at IS NULL',
            [result.rows[0].id]
        );
        await client.query('COMMIT');
        console.log(`Super Admin "${result.rows[0].username}" is ready. Existing sessions were revoked.`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

run()
    .catch(error => {
        console.error('Bootstrap Admin failed:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => pool.end());
