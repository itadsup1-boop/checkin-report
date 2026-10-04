export function createTelegramAutomationRepository(pool) {
    return {
        async createAccount(data) {
            const result = await pool.query(`INSERT INTO telegram_user_accounts
                (display_name, phone_masked, phone_encrypted, session_encrypted, phone_code_hash_encrypted, created_by)
                VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,status,display_name,phone_masked`,
            [data.displayName, data.phoneMasked, data.phoneEncrypted, data.sessionEncrypted, data.codeHashEncrypted, data.adminId]);
            return result.rows[0];
        },
        async account(id) {
            return (await pool.query('SELECT * FROM telegram_user_accounts WHERE id=$1', [id])).rows[0];
        },
        async accounts() {
            return (await pool.query(`SELECT id,display_name,phone_masked,telegram_user_id,telegram_username,status,last_error,last_synced_at,created_at
                FROM telegram_user_accounts ORDER BY created_at DESC`)).rows;
        },
        async updateLogin(id, fields) {
            const result = await pool.query(`UPDATE telegram_user_accounts SET
                session_encrypted=COALESCE($2,session_encrypted), phone_code_hash_encrypted=COALESCE($3,phone_code_hash_encrypted),
                telegram_user_id=COALESCE($4,telegram_user_id), telegram_username=COALESCE($5,telegram_username),
                status=$6,last_error=NULL,updated_at=NOW() WHERE id=$1 RETURNING id,status,display_name,phone_masked,telegram_username`,
            [id, fields.session, fields.codeHash || null, fields.userId || null, fields.username || null, fields.status]);
            return result.rows[0];
        },
        async syncGroups(accountId, groups) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query('UPDATE telegram_managed_groups SET is_visible=FALSE WHERE account_id=$1', [accountId]);
                for (const group of groups) await client.query(`INSERT INTO telegram_managed_groups
                    (account_id,telegram_group_id,title,group_type,member_count,is_owner,is_admin,can_delete_messages,can_restrict_members,can_delete_group)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                    ON CONFLICT(account_id,telegram_group_id) DO UPDATE SET title=EXCLUDED.title,group_type=EXCLUDED.group_type,
                    member_count=EXCLUDED.member_count,is_owner=EXCLUDED.is_owner,is_admin=EXCLUDED.is_admin,
                    can_delete_messages=EXCLUDED.can_delete_messages,can_restrict_members=EXCLUDED.can_restrict_members,
                    can_delete_group=EXCLUDED.can_delete_group,is_visible=TRUE,last_synced_at=NOW()`, [accountId, group.telegramGroupId, group.title, group.groupType,
                    group.memberCount, group.isOwner, group.isAdmin, group.canDeleteMessages, group.canRestrictMembers, group.canDeleteGroup]);
                await client.query('UPDATE telegram_user_accounts SET last_synced_at=NOW(),updated_at=NOW() WHERE id=$1', [accountId]);
                await client.query('COMMIT');
            } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
        },
        async groups(accountId) {
            return (await pool.query('SELECT * FROM telegram_managed_groups WHERE account_id=$1 AND is_visible=TRUE ORDER BY title', [accountId])).rows;
        },
        async setCredential(adminId, hash) {
            await pool.query(`INSERT INTO admin_destructive_credentials(admin_id,password_hash) VALUES($1,$2)
                ON CONFLICT(admin_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,failed_attempts=0,locked_until=NULL,changed_at=NOW()`, [adminId, hash]);
        },
        async credential(adminId) { return (await pool.query('SELECT * FROM admin_destructive_credentials WHERE admin_id=$1', [adminId])).rows[0]; },
        async credentialFailure(adminId, success) {
            await pool.query(success
                ? 'UPDATE admin_destructive_credentials SET failed_attempts=0,locked_until=NULL WHERE admin_id=$1'
                : `UPDATE admin_destructive_credentials SET failed_attempts=failed_attempts+1,
                   locked_until=CASE WHEN failed_attempts+1>=5 THEN NOW()+INTERVAL '15 minutes' ELSE locked_until END WHERE admin_id=$1`, [adminId]);
        },
        async createOperation({ accountId, adminId, action, phrase, groupIds }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const operation = (await client.query(`INSERT INTO telegram_destructive_operations
                    (account_id,requested_by,requested_action,confirmation_phrase,expires_at,total_groups)
                    VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes',$5) RETURNING *`, [accountId, adminId, action, phrase, groupIds.length])).rows[0];
                for (const id of groupIds) {
                    const group = (await client.query('SELECT * FROM telegram_managed_groups WHERE id=$1 AND account_id=$2 AND is_visible=TRUE', [id, accountId])).rows[0];
                    if (!group) throw new Error('Nhóm đã chọn không tồn tại trong tài khoản này.');
                    const resolved = action === 'DELETE' && group.can_delete_group ? 'DELETE' : 'RESET';
                    if (resolved === 'RESET' && !(group.can_restrict_members && group.can_delete_messages)) throw new Error(`Không đủ quyền xử lý nhóm ${group.title}.`);
                    await client.query(`INSERT INTO telegram_operation_groups(operation_id,managed_group_id,title_snapshot,resolved_action)
                        VALUES($1,$2,$3,$4)`, [operation.id, id, group.title, resolved]);
                }
                await client.query('COMMIT');
                return operation;
            } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
        },
        async operation(id) {
            const operation = (await pool.query('SELECT * FROM telegram_destructive_operations WHERE id=$1', [id])).rows[0];
            if (!operation) return null;
            operation.groups = (await pool.query(`SELECT og.*,mg.telegram_group_id FROM telegram_operation_groups og
                JOIN telegram_managed_groups mg ON mg.id=og.managed_group_id WHERE operation_id=$1 ORDER BY title_snapshot`, [id])).rows;
            return operation;
        },
        async queueOperation(id) { await pool.query(`UPDATE telegram_destructive_operations SET status='QUEUED',confirmed_at=NOW() WHERE id=$1`, [id]); },
        async claimOperation() {
            const result = await pool.query(`UPDATE telegram_destructive_operations SET status='RUNNING',started_at=NOW()
                WHERE id=(SELECT id FROM telegram_destructive_operations WHERE status='QUEUED' ORDER BY confirmed_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
            return result.rows[0];
        },
        async startGroup(operationId, groupId) { await pool.query(`UPDATE telegram_operation_groups SET status='RUNNING',started_at=NOW() WHERE operation_id=$1 AND managed_group_id=$2`, [operationId, groupId]); },
        async finishGroup(operationId, groupId, removed, error) {
            await pool.query(`UPDATE telegram_operation_groups SET status=$3,removed_members=$4,error=$5,finished_at=NOW() WHERE operation_id=$1 AND managed_group_id=$2`, [operationId, groupId, error ? 'FAILED' : 'COMPLETED', removed, error]);
            await pool.query(`UPDATE telegram_destructive_operations SET completed_groups=completed_groups+$2,failed_groups=failed_groups+$3 WHERE id=$1`, [operationId, error ? 0 : 1, error ? 1 : 0]);
        },
        async finishOperation(id) { await pool.query(`UPDATE telegram_destructive_operations SET status=CASE WHEN failed_groups=0 THEN 'COMPLETED' WHEN completed_groups=0 THEN 'FAILED' ELSE 'PARTIAL' END,finished_at=NOW() WHERE id=$1`, [id]); }
    };
}
