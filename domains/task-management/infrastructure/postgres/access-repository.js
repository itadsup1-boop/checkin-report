export function createTaskAccessRepository({ pool }) {
    return {
        async createAccessCode({ codeHash, role, scope, expiresAt, createdBy, boundTelegramUserId }) {
            const result = await pool.query(
                `INSERT INTO ai_management.access_codes
                    (code_hash, role, scope, expires_at, created_by, bound_telegram_user_id)
                 VALUES ($1, $2, $3::jsonb, $4, $5, $6)
                 RETURNING *`,
                [codeHash, role, JSON.stringify(scope), expiresAt, createdBy, boundTelegramUserId]
            );
            return result.rows[0];
        },

        async findAccessCodeByHash(codeHash) {
            const result = await pool.query(
                'SELECT * FROM ai_management.access_codes WHERE code_hash = $1',
                [codeHash]
            );
            return result.rows[0] || null;
        },

        async incrementAccessCodeAttempts(codeId) {
            const result = await pool.query(
                `UPDATE ai_management.access_codes
                 SET attempt_count = attempt_count + 1
                 WHERE id = $1
                 RETURNING attempt_count, max_attempts`,
                [codeId]
            );
            return result.rows[0] || null;
        },

        async lockAccessCode(codeId) {
            await pool.query(
                `UPDATE ai_management.access_codes SET status = 'CANCELLED' WHERE id = $1`,
                [codeId]
            );
        },

        async markAccessCodeRedeemed(codeId, telegramUserId) {
            const result = await pool.query(
                `UPDATE ai_management.access_codes
                 SET status = 'REDEEMED',
                     redeemed_by_telegram_user_id = $2,
                     redeemed_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [codeId, telegramUserId]
            );
            return result.rows[0];
        },

        async upsertManagerAccount({ employeeId, telegramUserId, role, grantedBy }) {
            const result = await pool.query(
                `INSERT INTO ai_management.manager_accounts
                    (employee_id, telegram_user_id, role, granted_by)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (telegram_user_id) DO UPDATE
                 SET role = EXCLUDED.role,
                     employee_id = EXCLUDED.employee_id,
                     status = 'ACTIVE',
                     revoked_at = NULL,
                     granted_by = EXCLUDED.granted_by,
                     updated_at = NOW()
                 RETURNING *`,
                [employeeId, telegramUserId, role, grantedBy]
            );
            return result.rows[0];
        },

        async replaceManagerPermissions(accountId, permissions) {
            await pool.query(
                'DELETE FROM ai_management.manager_permissions WHERE manager_account_id = $1',
                [accountId]
            );
            if (!permissions.length) return;
            await pool.query(
                `INSERT INTO ai_management.manager_permissions (manager_account_id, permission)
                 SELECT $1, unnest($2::text[])
                 ON CONFLICT DO NOTHING`,
                [accountId, permissions]
            );
        },

        async replaceManagerScopes(accountId, scopes) {
            await pool.query(
                'DELETE FROM ai_management.manager_scopes WHERE manager_account_id = $1',
                [accountId]
            );
            for (const scope of scopes) {
                await pool.query(
                    `INSERT INTO ai_management.manager_scopes
                        (manager_account_id, scope_type, scope_value)
                     VALUES ($1, $2, $3)
                     ON CONFLICT DO NOTHING`,
                    [accountId, scope.type, scope.value]
                );
            }
        },

        async getManagerAccountByTelegramId(telegramUserId) {
            const result = await pool.query(
                `SELECT * FROM ai_management.manager_accounts
                 WHERE telegram_user_id = $1 AND status = 'ACTIVE'`,
                [telegramUserId]
            );
            const account = result.rows[0];
            if (!account) return null;

            const perms = await pool.query(
                'SELECT permission FROM ai_management.manager_permissions WHERE manager_account_id = $1',
                [account.id]
            );
            const scopes = await pool.query(
                `SELECT scope_type, scope_value FROM ai_management.manager_scopes
                 WHERE manager_account_id = $1`,
                [account.id]
            );
            return {
                ...account,
                permissions: perms.rows.map(row => row.permission),
                scopes: scopes.rows.map(row => ({ type: row.scope_type, value: row.scope_value }))
            };
        },

        async revokeManagerAccount(telegramUserId) {
            const result = await pool.query(
                `UPDATE ai_management.manager_accounts
                 SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW()
                 WHERE telegram_user_id = $1 AND status = 'ACTIVE'
                 RETURNING *`,
                [telegramUserId]
            );
            return result.rows[0] || null;
        },

        async listAccessCodes() {
            const result = await pool.query(
                `SELECT id, role, scope, status, expires_at, bound_telegram_user_id,
                        redeemed_by_telegram_user_id, redeemed_at,
                        attempt_count, max_attempts, created_by, created_at
                 FROM ai_management.access_codes
                 ORDER BY created_at DESC
                 LIMIT 200`
            );
            return result.rows;
        },

        async cancelAccessCode(codeId) {
            const result = await pool.query(
                `UPDATE ai_management.access_codes
                 SET status = 'CANCELLED'
                 WHERE id = $1 AND status = 'ACTIVE'
                 RETURNING *`,
                [codeId]
            );
            return result.rows[0] || null;
        },

        async listManagerAccounts() {
            const result = await pool.query(
                `SELECT ma.*, e.employee_code, e.full_name
                 FROM ai_management.manager_accounts ma
                 LEFT JOIN employees e ON e.id = ma.employee_id
                 ORDER BY ma.created_at DESC`
            );
            return result.rows;
        },

        async appendAuditLog({ actorType, actorId, action, entityType = null, entityId = null, details = null }) {
            await pool.query(
                `INSERT INTO ai_management.audit_log
                    (actor_type, actor_id, action, entity_type, entity_id, details)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
                [actorType, actorId, action, entityType, entityId, details ? JSON.stringify(details) : null]
            );
        }
    };
}
