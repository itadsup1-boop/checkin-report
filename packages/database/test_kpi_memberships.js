import pool from './index.js';
import { registerEmployeeInKpiGroup } from '../shared/kpiMembership.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function run() {
    const client = await pool.connect();
    let transactionOpen = false;

    try {
        await client.query('BEGIN');
        transactionOpen = true;

        const primaryKey = await client.query(`
            SELECT array_agg(a.attname::text ORDER BY key_column.ordinality) AS columns
            FROM pg_constraint c
            CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key_column.attnum
            WHERE c.conrelid = 'public.pending_reports'::regclass
              AND c.contype = 'p'
        `);
        assert(
            JSON.stringify(primaryKey.rows[0]?.columns) === JSON.stringify(['telegram_id', 'group_id']),
            `pending_reports must use the composite primary key (telegram_id, group_id); received ${JSON.stringify(primaryKey.rows)}`
        );

        const groupColumn = await client.query(`
            SELECT is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'pending_reports'
              AND column_name = 'group_id'
        `);
        assert(groupColumn.rows[0]?.is_nullable === 'NO', 'pending_reports.group_id must be NOT NULL');

        const groupsResult = await client.query(`
            SELECT g.telegram_group_id
            FROM telegram_groups g
            WHERE g.bot_role IN ('report', 'report_tour')
              AND g.is_active = TRUE
              AND COALESCE(g.is_deleted, FALSE) = FALSE
            ORDER BY g.telegram_group_id
            LIMIT 2
        `);
        assert(groupsResult.rows.length === 2, 'Two active KPI groups are required for the isolation test');
        const [firstGroup, secondGroup] = groupsResult.rows.map(row => String(row.telegram_group_id));

        const employeeResult = await client.query(`
            SELECT *
            FROM employees
            WHERE telegram_id IS NOT NULL
              AND COALESCE(is_active, TRUE) = TRUE
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE
        `);
        assert(employeeResult.rows.length === 1, 'An active employee is required for the isolation test');
        const employee = employeeResult.rows[0];

        // Start from a clean pair inside this transaction. ROLLBACK below restores all real data.
        await client.query(
            `DELETE FROM employee_group_memberships
             WHERE employee_id = $1 AND telegram_group_id = ANY($2::varchar[])`,
            [employee.id, [firstGroup, secondGroup]]
        );

        const firstRegistration = await registerEmployeeInKpiGroup(client, employee, firstGroup, 'automated_test');
        assert(firstRegistration.ok, 'Registration in the first KPI group failed');

        const refreshedEmployee = (await client.query('SELECT * FROM employees WHERE id = $1', [employee.id])).rows[0];
        const secondRegistration = await registerEmployeeInKpiGroup(client, refreshedEmployee, secondGroup, 'automated_test');
        assert(secondRegistration.ok, 'Registration in the second KPI group failed');

        await client.query(
            `UPDATE employee_group_memberships
             SET status = 'PAUSED', pause_reason = 'automated isolation test', paused_at = NOW()
             WHERE employee_id = $1 AND telegram_group_id = $2`,
            [employee.id, firstGroup]
        );

        const pausedRegistration = await registerEmployeeInKpiGroup(client, refreshedEmployee, firstGroup, 'automated_test');
        assert(!pausedRegistration.ok && pausedRegistration.reason === 'PAUSED', 'A paused group must not self-reactivate');

        const activeRegistration = await registerEmployeeInKpiGroup(client, refreshedEmployee, secondGroup, 'automated_test');
        assert(activeRegistration.ok, 'The other KPI group must remain active');

        const membershipResult = await client.query(
            `SELECT telegram_group_id, status
             FROM employee_group_memberships
             WHERE employee_id = $1 AND telegram_group_id = ANY($2::varchar[])
             ORDER BY telegram_group_id`,
            [employee.id, [firstGroup, secondGroup]]
        );
        const statuses = new Map(membershipResult.rows.map(row => [String(row.telegram_group_id), row.status]));
        assert(statuses.get(firstGroup) === 'PAUSED', 'The first group did not stay paused');
        assert(statuses.get(secondGroup) === 'ACTIVE', 'The second group was affected by the first group pause');

        const fakeTelegramId = `kpi-test-${Date.now()}`;
        const deadline = new Date(Date.now() + 10 * 60 * 1000);
        for (const groupId of [firstGroup, secondGroup]) {
            await client.query(
                `INSERT INTO pending_reports
                    (telegram_id, group_id, raw_text, kpi_actual, required_photos,
                     received_photos, deadline_at, status)
                 VALUES ($1, $2, 'automated test', 1, 1, 0, $3, 'WAITING_PHOTOS')`,
                [fakeTelegramId, groupId, deadline]
            );
        }

        const pendingCount = await client.query(
            'SELECT COUNT(*)::int AS count FROM pending_reports WHERE telegram_id = $1',
            [fakeTelegramId]
        );
        assert(pendingCount.rows[0].count === 2, 'Pending reports are not isolated by group');

        await client.query(
            'DELETE FROM pending_reports WHERE telegram_id = $1 AND group_id = $2',
            [fakeTelegramId, firstGroup]
        );
        const remainingPending = await client.query(
            'SELECT group_id FROM pending_reports WHERE telegram_id = $1',
            [fakeTelegramId]
        );
        assert(
            remainingPending.rows.length === 1 && String(remainingPending.rows[0].group_id) === secondGroup,
            'Pausing one group removed the pending report of another group'
        );

        const reminderEligible = await client.query(
            `SELECT m.telegram_group_id
             FROM employee_group_memberships m
             JOIN employees e ON e.id = m.employee_id
             WHERE m.employee_id = $1
               AND m.telegram_group_id = ANY($2::varchar[])
               AND m.status = 'ACTIVE'
               AND m.need_report = TRUE
               AND COALESCE(e.is_active, TRUE) = TRUE`,
            [employee.id, [firstGroup, secondGroup]]
        );
        assert(
            reminderEligible.rows.length === 1 && String(reminderEligible.rows[0].telegram_group_id) === secondGroup,
            'Reminder eligibility leaked across KPI groups'
        );

        await client.query('SAVEPOINT invalid_membership_status');
        let invalidStatusRejected = false;
        try {
            await client.query(
                `UPDATE employee_group_memberships SET status = 'INVALID'
                 WHERE employee_id = $1 AND telegram_group_id = $2`,
                [employee.id, secondGroup]
            );
        } catch {
            invalidStatusRejected = true;
            await client.query('ROLLBACK TO SAVEPOINT invalid_membership_status');
        }
        assert(invalidStatusRejected, 'The membership status constraint did not reject an invalid status');

        await client.query('ROLLBACK');
        transactionOpen = false;
        console.log('PASS: KPI group membership, pause isolation, pending isolation, and constraints');
    } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(error => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
});
