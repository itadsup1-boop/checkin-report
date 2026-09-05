/**
 * Toàn bộ câu truy vấn cơ sở dữ liệu cho module Retail Check-in.
 */

export function createRetailRepository({ pool }) {
    async function findEmployeeByTelegramId(telegramId) {
        const result = await pool.query(
            `SELECT * FROM public.employees WHERE telegram_id = $1 AND is_active = true LIMIT 1`,
            [String(telegramId)]
        );
        return result.rows[0] || null;
    }

    async function findGroupByTelegramId(telegramGroupId) {
        const result = await pool.query(
            `SELECT * FROM public.telegram_groups WHERE telegram_group_id = $1 AND is_active = true LIMIT 1`,
            [String(telegramGroupId)]
        );
        return result.rows[0] || null;
    }

    async function findLastCheckin(employeeId) {
        const result = await pool.query(
            `SELECT * FROM public.retail_checkins 
             WHERE employee_id = $1 
             ORDER BY checkin_time DESC 
             LIMIT 1`,
            [employeeId]
        );
        return result.rows[0] || null;
    }

    async function insertCheckin({
        groupId,
        employeeId,
        storeName,
        storeAddress,
        selfiePhotoUrl,
        storePhotoUrl,
        mediaUrls = [],
        checkinTime,
        checkinDate,
        isValid = true,
        rejectReason = null,
        photoHashes = []
    }) {
        const result = await pool.query(
            `INSERT INTO public.retail_checkins
             (group_id, employee_id, store_name, store_address, selfie_photo_url, store_photo_url,
              media_urls, checkin_time, checkin_date, is_valid, reject_reason, photo_hashes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id`,
            [
                groupId,
                employeeId,
                storeName,
                storeAddress,
                selfiePhotoUrl || null,
                storePhotoUrl || null,
                JSON.stringify(mediaUrls),
                checkinTime,
                checkinDate,
                isValid,
                rejectReason,
                photoHashes
            ]
        );
        return result.rows[0].id;
    }

    async function countDailyValidCheckins(employeeId, dateStr, groupId) {
        const result = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM public.retail_checkins
             WHERE employee_id = $1 AND checkin_date = $2 AND group_id = $3 AND is_valid = true`,
            [employeeId, dateStr, groupId]
        );
        return result.rows[0]?.count || 0;
    }

    async function findTodayCheckins(employeeId, dateStr, groupId = null) {
        let query = `SELECT * FROM public.retail_checkins WHERE employee_id = $1 AND checkin_date = $2`;
        const params = [employeeId, dateStr];
        if (groupId) {
            query += ` AND group_id = $3`;
            params.push(groupId);
        }
        query += ` ORDER BY checkin_time DESC`;
        const result = await pool.query(query, params);
        return result.rows;
    }

    async function findRecentPhotoHashes(employeeId, days = 30) {
        const result = await pool.query(
            `SELECT UNNEST(photo_hashes) AS hash
             FROM public.retail_checkins
             WHERE employee_id = $1 
               AND checkin_time >= NOW() - INTERVAL '${parseInt(days, 10)} days'
               AND photo_hashes IS NOT NULL`,
            [employeeId]
        );
        return new Set(result.rows.map(r => r.hash));
    }

    async function upsertDailySummary({
        groupId,
        employeeId,
        recordDate,
        validPointsCount,
        targetPoints = 15,
        isCompleted,
        status
    }) {
        const result = await pool.query(
            `INSERT INTO public.retail_daily_summaries
             (group_id, employee_id, record_date, valid_points_count, target_points, is_completed, status, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (employee_id, record_date, group_id)
             DO UPDATE SET
                 valid_points_count = EXCLUDED.valid_points_count,
                 is_completed = EXCLUDED.is_completed,
                 status = EXCLUDED.status,
                 updated_at = NOW()
             RETURNING id`,
            [groupId, employeeId, recordDate, validPointsCount, targetPoints, isCompleted, status]
        );
        return result.rows[0].id;
    }

    async function findRetailGroups() {
        const result = await pool.query(
            `SELECT * FROM public.telegram_groups 
             WHERE bot_role = 'retail_checkin' 
               AND is_active = true 
               AND COALESCE(is_deleted, false) = false`
        );
        return result.rows;
    }

    async function findActiveEmployeesInGroup(groupId) {
        const result = await pool.query(
            `SELECT DISTINCT e.*
             FROM public.employees e
             WHERE e.telegram_group_id = (SELECT telegram_group_id FROM public.telegram_groups WHERE id = $1)
                OR e.group_id = $1
               AND e.is_active = true`,
            [groupId]
        );
        return result.rows;
    }

    async function getDailyProgressForGroup(groupId, dateStr) {
        const result = await pool.query(
            `SELECT e.id AS employee_id, e.full_name AS employee_name,
                    COALESCE(s.valid_points_count, (
                        SELECT COUNT(*)::int FROM public.retail_checkins c
                        WHERE c.employee_id = e.id AND c.checkin_date = $2 AND c.group_id = $1 AND c.is_valid = true
                    )) AS valid_points,
                    COALESCE(s.is_completed, false) AS is_completed
             FROM public.employees e
             LEFT JOIN public.retail_daily_summaries s 
                    ON s.employee_id = e.id AND s.record_date = $2 AND s.group_id = $1
             WHERE (e.telegram_group_id = (SELECT telegram_group_id FROM public.telegram_groups WHERE id = $1)
                    OR e.group_id = $1)
               AND e.is_active = true`,
            [groupId, dateStr]
        );
        return result.rows.map(r => ({
            employeeId: r.employee_id,
            employeeName: r.employee_name,
            validPoints: parseInt(r.valid_points, 10) || 0,
            isCompleted: (parseInt(r.valid_points, 10) || 0) >= 15
        }));
    }

    return {
        findEmployeeByTelegramId,
        findGroupByTelegramId,
        findLastCheckin,
        insertCheckin,
        findTodayCheckins,
        countDailyValidCheckins,
        findRecentPhotoHashes,
        upsertDailySummary,
        findRetailGroups,
        findActiveEmployeesInGroup,
        getDailyProgressForGroup
    };
}
