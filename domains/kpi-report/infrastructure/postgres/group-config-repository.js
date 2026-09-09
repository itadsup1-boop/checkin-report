/**
 * Cấu hình báo cáo KPI theo từng nhóm: lệnh kích hoạt (`telegram_workflows`) và
 * giờ giấc/mức phạt (`group_settings`). Domain này SỞ HỮU các cột phạt/giờ báo
 * cáo dưới đây — vì logic nghiệp vụ đọc chúng để tính phạt nằm trong domain
 * này, dù `domains/timekeep` cũng có sẵn code đọc/ghi cùng bảng `group_settings`
 * cho phần cấu hình chấm công (hai domain dùng chung bảng, khác cột).
 */

export function createGroupConfigRepository({ pool }) {
    async function findWorkflowTrigger(groupId) {
        const result = await pool.query('SELECT command_trigger FROM telegram_workflows WHERE group_id = $1', [groupId]);
        return result.rows[0]?.command_trigger || null;
    }

    async function findRemindTime(groupId) {
        const result = await pool.query('SELECT remind_time_1 FROM group_settings WHERE telegram_group_id = $1', [groupId]);
        return result.rows[0]?.remind_time_1 || null;
    }

    async function findPenaltyMissingKpi(groupId) {
        const result = await pool.query('SELECT penalty_missing_kpi FROM group_settings WHERE telegram_group_id = $1', [groupId]);
        return result.rows[0]?.penalty_missing_kpi ?? null;
    }

    async function upsertGroupSettingColumn(groupId, column, value) {
        const existing = await pool.query('SELECT id FROM group_settings WHERE telegram_group_id = $1', [groupId]);
        if (existing.rows.length > 0) {
            await pool.query(`UPDATE group_settings SET ${column} = $1 WHERE telegram_group_id = $2`, [value, groupId]);
        } else {
            await pool.query(`INSERT INTO group_settings (telegram_group_id, ${column}) VALUES ($1, $2)`, [groupId, value]);
        }
    }

    const setRemindTime = (groupId, timeString) => upsertGroupSettingColumn(groupId, 'remind_time_1', timeString);
    const setDeadlineTime = (groupId, timeString) => upsertGroupSettingColumn(groupId, 'deadline_time', timeString);
    const setPenaltyMissingKpi = (groupId, amount) => upsertGroupSettingColumn(groupId, 'penalty_missing_kpi', amount);
    const setPenaltyMissingReport = (groupId, amount) => upsertGroupSettingColumn(groupId, 'penalty_missing_report', amount);

    /** Gắn lệnh kích hoạt báo cáo cho nhóm — lệnh /taocaulenh. Tạo nhóm nếu chưa có. */
    async function setWorkflowTrigger(groupId, groupName, trigger) {
        await pool.query(
            `INSERT INTO telegram_groups (telegram_group_id, group_name)
             VALUES ($1, $2) ON CONFLICT (telegram_group_id) DO NOTHING`,
            [groupId, groupName]
        );
        await pool.query(
            `INSERT INTO telegram_workflows (group_id, command_trigger)
             VALUES ($1, $2)
             ON CONFLICT (group_id) DO UPDATE SET command_trigger = EXCLUDED.command_trigger`,
            [groupId, trigger]
        );
    }

    return {
        findWorkflowTrigger,
        findRemindTime,
        findPenaltyMissingKpi,
        setRemindTime,
        setDeadlineTime,
        setPenaltyMissingKpi,
        setPenaltyMissingReport,
        setWorkflowTrigger
    };
}
