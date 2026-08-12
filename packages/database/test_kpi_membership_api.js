import pool from './index.js';

const API_URL = process.env.KPI_API_TEST_URL || 'http://127.0.0.1:3001';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function updateMembership(employeeId, groupId, status, reason = null) {
    const response = await fetch(`${API_URL}/api/admin/tk-users/${employeeId}/group-membership`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            telegram_group_id: groupId,
            status,
            pause_reason: reason
        })
    });
    const body = await response.json().catch(() => ({}));
    assert(response.ok, `Membership API returned HTTP ${response.status}: ${body.error || 'unknown error'}`);
    return body;
}

async function run() {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const employeeCode = `API-KPI-${suffix}`;
    const telegramId = `api-kpi-${suffix}`;
    let employeeId = null;

    try {
        const healthResponse = await fetch(`${API_URL}/api/health`);
        assert(healthResponse.ok, `KPI API health check returned HTTP ${healthResponse.status}`);

        const groupResult = await pool.query(`
            SELECT telegram_group_id
            FROM telegram_groups
            WHERE bot_role IN ('report', 'report_tour')
              AND is_active = TRUE
              AND COALESCE(is_deleted, FALSE) = FALSE
            ORDER BY telegram_group_id
            LIMIT 2
        `);
        assert(groupResult.rows.length === 2, 'Two active KPI groups are required for the API test');
        const [firstGroup, secondGroup] = groupResult.rows.map(row => String(row.telegram_group_id));

        const employeeResult = await pool.query(
            `INSERT INTO employees
                (employee_code, full_name, telegram_id, telegram_group_id,
                 department, position, role, need_report, is_active, current_kpi_target)
             VALUES ($1, 'KPI API automated test', $2, $3,
                     'AUTOMATED_TEST', 'AUTOMATED_TEST', 'Nhân viên', TRUE, TRUE, 40)
             RETURNING id`,
            [employeeCode, telegramId, firstGroup]
        );
        employeeId = employeeResult.rows[0].id;

        for (const groupId of [firstGroup, secondGroup]) {
            await pool.query(
                `INSERT INTO employee_group_memberships
                    (employee_id, telegram_group_id, status, need_report,
                     current_kpi_target, updated_by)
                 VALUES ($1, $2, 'ACTIVE', TRUE, 40, 'automated_api_test')`,
                [employeeId, groupId]
            );
            await pool.query(
                `INSERT INTO pending_reports
                    (telegram_id, group_id, raw_text, kpi_actual, required_photos,
                     received_photos, deadline_at, status)
                 VALUES ($1, $2, 'automated API test', 1, 1, 0,
                         NOW() + INTERVAL '10 minutes', 'WAITING_PHOTOS')`,
                [telegramId, groupId]
            );
        }

        const paused = await updateMembership(employeeId, firstGroup, 'PAUSED', 'automated API isolation test');
        assert(paused.membership_status === 'PAUSED', 'Pause API did not return PAUSED');

        const staffResponse = await fetch(
            `${API_URL}/api/admin/tk-users?group_id=${encodeURIComponent(firstGroup)}`
        );
        assert(staffResponse.ok, `Scoped staff API returned HTTP ${staffResponse.status}`);
        const scopedStaff = await staffResponse.json();
        const testStaff = scopedStaff.find(row => row.id === employeeId);
        assert(testStaff?.membership_status === 'PAUSED', 'Scoped staff API did not expose the paused state');
        assert(
            testStaff?.membership_pause_reason === 'automated API isolation test',
            'Scoped staff API did not expose the pause reason'
        );

        let states = await pool.query(
            `SELECT telegram_group_id, status
             FROM employee_group_memberships
             WHERE employee_id = $1 AND telegram_group_id = ANY($2::varchar[])`,
            [employeeId, [firstGroup, secondGroup]]
        );
        let statusMap = new Map(states.rows.map(row => [String(row.telegram_group_id), row.status]));
        assert(statusMap.get(firstGroup) === 'PAUSED', 'API did not pause the selected group');
        assert(statusMap.get(secondGroup) === 'ACTIVE', 'API pause leaked into the second group');

        let pending = await pool.query(
            'SELECT group_id FROM pending_reports WHERE telegram_id = $1 ORDER BY group_id',
            [telegramId]
        );
        assert(
            pending.rows.length === 1 && String(pending.rows[0].group_id) === secondGroup,
            'API pause did not delete only the selected group pending report'
        );

        const resumed = await updateMembership(employeeId, firstGroup, 'ACTIVE');
        assert(resumed.membership_status === 'ACTIVE', 'Resume API did not return ACTIVE');

        states = await pool.query(
            `SELECT telegram_group_id, status
             FROM employee_group_memberships
             WHERE employee_id = $1 AND telegram_group_id = ANY($2::varchar[])`,
            [employeeId, [firstGroup, secondGroup]]
        );
        statusMap = new Map(states.rows.map(row => [String(row.telegram_group_id), row.status]));
        assert(statusMap.get(firstGroup) === 'ACTIVE', 'API did not resume the selected group');
        assert(statusMap.get(secondGroup) === 'ACTIVE', 'API resume changed the second group');

        const events = await pool.query(
            `SELECT old_status, new_status
             FROM employee_group_membership_events
             WHERE employee_id = $1 AND telegram_group_id = $2
             ORDER BY created_at`,
            [employeeId, firstGroup]
        );
        assert(events.rows.length === 2, 'Pause/resume audit history was not recorded');
        assert(
            events.rows[0].old_status === 'ACTIVE' && events.rows[0].new_status === 'PAUSED' &&
            events.rows[1].old_status === 'PAUSED' && events.rows[1].new_status === 'ACTIVE',
            'Pause/resume audit history contains incorrect state transitions'
        );

        console.log('PASS: live KPI membership API pause/resume and cross-group isolation');
    } finally {
        try {
            await pool.query('DELETE FROM pending_reports WHERE telegram_id = $1', [telegramId]);
            if (employeeId) {
                await pool.query('DELETE FROM employees WHERE id = $1 AND employee_code = $2', [employeeId, employeeCode]);
            }
            const leftovers = await pool.query(
                `SELECT
                    (SELECT COUNT(*)::int FROM pending_reports WHERE telegram_id = $1) AS pending_count,
                    (SELECT COUNT(*)::int FROM employees WHERE employee_code = $2) AS employee_count`,
                [telegramId, employeeCode]
            );
            assert(
                leftovers.rows[0].pending_count === 0 && leftovers.rows[0].employee_count === 0,
                'Automated API test data cleanup was incomplete'
            );
        } finally {
            await pool.end();
        }
    }
}

run().catch(error => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
});
