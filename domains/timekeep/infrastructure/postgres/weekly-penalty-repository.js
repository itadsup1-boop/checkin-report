/**
 * SQL của tổng kết phạt chấm công hàng tuần: tra nhóm nhận tin, đọc dòng phạt
 * trong tuần, và khóa chống gửi trùng (mỗi tuần mỗi nhóm chỉ gửi 1 lần).
 */

const DEDUP_TABLE = 'timekeep_cron_dedup';

let dedupTableReady = false;

export function createWeeklyPenaltyRepository({ pool }) {
    async function ensureDedupTable() {
        if (dedupTableReady) return;
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ${DEDUP_TABLE} (
                dedup_key VARCHAR(150) PRIMARY KEY,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        dedupTableReady = true;
    }

    /** Các nhóm check-in đang hoạt động khớp danh sách tên nhóm nhận tổng kết tuần. */
    async function findWeeklySummaryGroups(groupNames) {
        const result = await pool.query(
            `SELECT g.id AS group_uuid, g.telegram_group_id, g.group_name
             FROM telegram_groups g
             WHERE g.group_name = ANY($1::text[])
               AND g.bot_role = 'timekeep'
               AND g.is_active = TRUE
               AND COALESCE(g.is_deleted, FALSE) = FALSE`,
            [groupNames]
        );
        return result.rows;
    }

    /** Dòng phạt trong khoảng tuần của các nhóm — chỉ loại phạt chấm công, bỏ dòng đã miễn trừ (amount = 0). */
    async function findWeeklyPenaltyRows({ groupIds, startDate, endDate, violationTypes }) {
        const result = await pool.query(
            `SELECT p.group_id,
                    p.user_id,
                    e.full_name,
                    p.date::text AS date,
                    p.violation_type,
                    p.late_minutes,
                    p.amount
             FROM tk_penalties p
             JOIN employees e ON e.id = p.user_id
             WHERE p.group_id = ANY($1::uuid[])
               AND p.date BETWEEN $2::date AND $3::date
               AND p.violation_type = ANY($4::text[])
               AND p.amount > 0
             ORDER BY e.full_name, p.date, p.created_at`,
            [groupIds, startDate, endDate, violationTypes]
        );
        return result.rows;
    }

    /**
     * Chiếm khóa gửi tin tuần. true = lần đầu (được phép gửi), false = tuần này
     * đã gửi rồi. Lỗi DB trả false để tick sau (mỗi phút) thử lại thay vì gửi
     * trùng hàng loạt.
     */
    async function acquireWeeklySummaryLock(dedupKey) {
        try {
            await ensureDedupTable();
            const result = await pool.query(
                `INSERT INTO ${DEDUP_TABLE} (dedup_key)
                 VALUES ($1)
                 ON CONFLICT (dedup_key) DO NOTHING
                 RETURNING dedup_key`,
                [dedupKey]
            );
            return result.rowCount > 0;
        } catch (error) {
            console.error('[Weekly Penalty Dedup Error]:', error.message || error);
            return false;
        }
    }

    /** Nhả khóa khi gửi thất bại để tick phút sau gửi lại được. */
    async function releaseWeeklySummaryLock(dedupKey) {
        try {
            await ensureDedupTable();
            await pool.query(`DELETE FROM ${DEDUP_TABLE} WHERE dedup_key = $1`, [dedupKey]);
        } catch (error) {
            console.error('[Weekly Penalty Dedup Release Error]:', error.message || error);
        }
    }

    return {
        findWeeklySummaryGroups,
        findWeeklyPenaltyRows,
        acquireWeeklySummaryLock,
        releaseWeeklySummaryLock
    };
}
