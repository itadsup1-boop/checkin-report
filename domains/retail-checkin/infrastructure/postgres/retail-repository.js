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
            `SELECT tkg.*,
                    COALESCE(rc.shift_start_time::text, '08:30') AS shift_start_time,
                    COALESCE(rc.shift_end_time::text,   '18:00') AS shift_end_time,
                    COALESCE(rc.daily_kpi_target, 15)            AS daily_kpi_target
             FROM public.telegram_groups tkg
             LEFT JOIN public.retail_checkin_config rc ON rc.telegram_group_id = tkg.telegram_group_id
             WHERE tkg.telegram_group_id = $1 AND tkg.is_active = true LIMIT 1`,
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
        photoHashes = [],
        driveFolderUrl = null,
        latitude = null,
        longitude = null,
        locationAccuracy = null,
        googleMapsUrl = null
    }) {
        const computedMapsUrl = googleMapsUrl || (latitude && longitude ? `https://maps.google.com/?q=${latitude},${longitude}` : null);
        const result = await pool.query(
            `INSERT INTO public.retail_checkins
             (group_id, employee_id, store_name, store_address, selfie_photo_url, store_photo_url,
              media_urls, checkin_time, checkin_date, is_valid, reject_reason, photo_hashes, drive_folder_url,
              latitude, longitude, location_accuracy, google_maps_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
                photoHashes,
                driveFolderUrl || null,
                latitude !== null && latitude !== undefined ? Number(latitude) : null,
                longitude !== null && longitude !== undefined ? Number(longitude) : null,
                locationAccuracy !== null && locationAccuracy !== undefined ? Number(locationAccuracy) : null,
                computedMapsUrl
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

    async function findDailySummary(employeeId, dateStr, groupId = null) {
        let query = `SELECT * FROM public.retail_daily_summaries WHERE employee_id = $1 AND record_date = $2`;
        const params = [employeeId, dateStr];
        if (groupId) {
            query += ` AND group_id = $3`;
            params.push(groupId);
        }
        const result = await pool.query(query, params);
        return result.rows[0] || null;
    }

    async function findRetailGroups() {
        const result = await pool.query(
            `SELECT tkg.*, 
                    COALESCE(rc.shift_start_time::text, '08:00') AS shift_start_time,
                    COALESCE(rc.shift_end_time::text,   '18:00') AS shift_end_time,
                    COALESCE(rc.daily_kpi_target, 15)            AS daily_kpi_target,
                    rc.start_date::text                          AS start_date,
                    COALESCE(gs.auto_reminder_enabled, true)     AS auto_reminder_enabled
             FROM public.telegram_groups tkg
             LEFT JOIN public.retail_checkin_config rc ON rc.telegram_group_id = tkg.telegram_group_id
             LEFT JOIN public.group_settings gs ON gs.telegram_group_id = tkg.telegram_group_id
             WHERE tkg.bot_role = 'retail_checkin' 
               AND tkg.is_active = true 
               AND COALESCE(tkg.is_deleted, false) = false`
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

    async function getDailyProgressForGroup(groupId, dateStr, kpiTarget = 15) {
        const result = await pool.query(
            `SELECT e.id AS employee_id, e.full_name AS employee_name,
                    e.role AS employee_role, e.department, e.telegram_id,
                    COALESCE(rek.daily_kpi_target, rc.daily_kpi_target, $3) AS target_kpi,
                    rek.daily_kpi_target IS NOT NULL AS has_custom_kpi,
                    GREATEST(
                        COALESCE(s.valid_points_count, 0),
                        (
                            SELECT COUNT(*)::int FROM public.retail_checkins c
                            WHERE c.employee_id = e.id AND c.checkin_date = $2 AND c.group_id = $1 AND c.is_valid = true
                        )
                    ) AS valid_points,
                    COALESCE(s.is_completed, false) AS is_completed,
                    (
                        SELECT json_build_object(
                            'time', to_char(c2.checkin_time AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI:SS'),
                            'storeName', c2.store_name,
                            'storeAddress', c2.store_address
                        )
                        FROM public.retail_checkins c2
                        WHERE c2.employee_id = e.id AND c2.checkin_date = $2 AND c2.group_id = $1 AND c2.is_valid = true
                        ORDER BY c2.checkin_time DESC
                        LIMIT 1
                    ) AS last_checkin
             FROM public.employees e
             LEFT JOIN public.retail_daily_summaries s 
                     ON s.employee_id = e.id AND s.record_date = $2 AND s.group_id = $1
             LEFT JOIN public.telegram_groups tkg ON tkg.id = $1
             LEFT JOIN public.retail_checkin_config rc ON rc.telegram_group_id = tkg.telegram_group_id
             LEFT JOIN public.retail_employee_kpi rek 
                     ON rek.employee_id = e.id AND rek.telegram_group_id = tkg.telegram_group_id
             WHERE (
                     e.telegram_group_id = (SELECT telegram_group_id FROM public.telegram_groups WHERE id = $1)
                     OR e.group_id = $1
                     OR EXISTS (
                         SELECT 1 FROM public.retail_checkins rc2 
                         WHERE rc2.employee_id = e.id AND rc2.group_id = $1 AND rc2.checkin_date = $2
                     )
                     OR EXISTS (
                         SELECT 1 FROM public.retail_daily_summaries rds 
                         WHERE rds.employee_id = e.id AND rds.group_id = $1 AND rds.record_date = $2
                     )
             )
               AND e.is_active = true
             ORDER BY valid_points DESC, e.full_name ASC`,
            [groupId, dateStr, kpiTarget]
        );
        return result.rows.map(r => {
            const points = parseInt(r.valid_points, 10) || 0;
            const target = parseInt(r.target_kpi, 10) || kpiTarget || 15;
            const completed = points >= target;
            return {
                employeeId: r.employee_id,
                employeeName: r.employee_name,
                employeeRole: r.employee_role,
                department: r.department,
                telegramId: r.telegram_id,
                targetKpi: target,
                hasCustomKpi: Boolean(r.has_custom_kpi),
                validPoints: points,
                isCompleted: completed,
                status: completed ? 'COMPLETED' : (points > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'),
                lastCheckin: r.last_checkin || null
            };
        });
    }

    async function getMonthlyProgressForGroup(groupId, monthStr, defaultKpi = 15) {
        const employeesRes = await pool.query(
            `SELECT e.id AS employee_id, e.full_name AS employee_name,
                    e.role AS employee_role, e.department, e.telegram_id,
                    COALESCE(rek.daily_kpi_target, rc.daily_kpi_target, $3) AS target_kpi,
                    rek.daily_kpi_target IS NOT NULL AS has_custom_kpi
             FROM public.employees e
             LEFT JOIN public.telegram_groups tkg ON tkg.id = $1
             LEFT JOIN public.retail_checkin_config rc ON rc.telegram_group_id = tkg.telegram_group_id
             LEFT JOIN public.retail_employee_kpi rek 
                     ON rek.employee_id = e.id AND rek.telegram_group_id = tkg.telegram_group_id
             WHERE (
                     e.telegram_group_id = (SELECT telegram_group_id FROM public.telegram_groups WHERE id = $1)
                     OR e.group_id = $1
                     OR EXISTS (
                         SELECT 1 FROM public.retail_checkins rc2 
                         WHERE rc2.employee_id = e.id AND rc2.group_id = $1 AND to_char(rc2.checkin_date, 'YYYY-MM') = $2
                     )
                     OR EXISTS (
                         SELECT 1 FROM public.retail_daily_summaries rds 
                         WHERE rds.employee_id = e.id AND rds.group_id = $1 AND to_char(rds.record_date, 'YYYY-MM') = $2
                     )
             )
               AND e.is_active = true
             ORDER BY e.full_name ASC`,
            [groupId, monthStr, defaultKpi]
        );

        const daysRes = await pool.query(
            `WITH raw_dates AS (
                SELECT c.employee_id,
                       to_char(c.checkin_date, 'YYYY-MM-DD') AS work_date,
                       COUNT(CASE WHEN c.is_valid = true THEN 1 END)::int AS points
                FROM public.retail_checkins c
                WHERE c.group_id = $1 AND to_char(c.checkin_date, 'YYYY-MM') = $2
                GROUP BY c.employee_id, to_char(c.checkin_date, 'YYYY-MM-DD')
                UNION ALL
                SELECT s.employee_id,
                       to_char(s.record_date, 'YYYY-MM-DD') AS work_date,
                       COALESCE(s.valid_points_count, 0) AS points
                FROM public.retail_daily_summaries s
                WHERE s.group_id = $1 AND to_char(s.record_date, 'YYYY-MM') = $2
                  AND NOT EXISTS (
                      SELECT 1 FROM public.retail_checkins c2
                      WHERE c2.employee_id = s.employee_id AND c2.group_id = $1 AND c2.checkin_date = s.record_date
                  )
            ),
            dedup_dates AS (
                SELECT employee_id, work_date, MAX(points)::int AS valid_points
                FROM raw_dates
                GROUP BY employee_id, work_date
            )
            SELECT d.employee_id,
                   COUNT(d.work_date)::int AS work_days,
                   COALESCE(SUM(d.valid_points), 0)::int AS total_points,
                   COUNT(CASE WHEN d.valid_points >= COALESCE(rek.daily_kpi_target, rc.daily_kpi_target, $3) THEN 1 END)::int AS completed_days
            FROM dedup_dates d
            LEFT JOIN public.employees e ON e.id = d.employee_id
            LEFT JOIN public.telegram_groups tkg ON tkg.id = $1
            LEFT JOIN public.retail_checkin_config rc ON rc.telegram_group_id = tkg.telegram_group_id
            LEFT JOIN public.retail_employee_kpi rek 
                    ON rek.employee_id = e.id AND rek.telegram_group_id = tkg.telegram_group_id
            GROUP BY d.employee_id`,
            [groupId, monthStr, defaultKpi]
        );

        const statsMap = new Map();
        for (const row of daysRes.rows) {
            statsMap.set(row.employee_id, {
                workDays: Number(row.work_days) || 0,
                totalPoints: Number(row.total_points) || 0,
                completedDays: Number(row.completed_days) || 0
            });
        }

        let totalGroupPoints = 0;
        let totalGroupWorkDays = 0;
        let totalGroupCompletedDays = 0;

        const members = employeesRes.rows.map(e => {
            const st = statsMap.get(e.employee_id) || { workDays: 0, totalPoints: 0, completedDays: 0 };
            const target = parseInt(e.target_kpi, 10) || defaultKpi;
            const incompleteDays = Math.max(0, st.workDays - st.completedDays);
            const completionRate = st.workDays > 0 ? Math.round((st.completedDays / st.workDays) * 100) : 0;

            totalGroupPoints += st.totalPoints;
            totalGroupWorkDays += st.workDays;
            totalGroupCompletedDays += st.completedDays;

            return {
                employeeId: e.employee_id,
                employeeName: e.employee_name,
                employeeRole: e.employee_role,
                department: e.department,
                telegramId: e.telegram_id,
                targetKpi: target,
                hasCustomKpi: Boolean(e.has_custom_kpi),
                totalWorkDays: st.workDays,
                completedDays: st.completedDays,
                incompleteDays,
                totalPoints: st.totalPoints,
                completionRate
            };
        });

        members.sort((a, b) => b.totalPoints - a.totalPoints || b.completedDays - a.completedDays || a.employeeName.localeCompare(b.employeeName));

        const overallRate = totalGroupWorkDays > 0 
            ? Math.round((totalGroupCompletedDays / totalGroupWorkDays) * 100) 
            : 0;

        return {
            month: monthStr,
            summary: {
                totalMembers: members.length,
                totalPoints: totalGroupPoints,
                totalWorkDays: totalGroupWorkDays,
                totalCompletedDays: totalGroupCompletedDays,
                overallCompletionRate: overallRate,
                activeMembersCount: members.filter(m => m.totalWorkDays > 0).length
            },
            members
        };
    }

    async function getEmployeeRetailHistory(employeeId, groupId, { month = null } = {}) {
        const empRes = await pool.query(
            `SELECT e.id, e.full_name, e.telegram_id, e.role, e.department,
                    tkg.id AS group_uuid, tkg.telegram_group_id, tkg.group_name,
                    tkg.customer_drive_folder_id,
                    COALESCE(rek.daily_kpi_target, rc.daily_kpi_target, 15) AS target_kpi,
                    rek.daily_kpi_target IS NOT NULL AS has_custom_kpi
             FROM public.employees e
             LEFT JOIN public.telegram_groups tkg ON tkg.id = $2
             LEFT JOIN public.retail_checkin_config rc ON rc.telegram_group_id = tkg.telegram_group_id
             LEFT JOIN public.retail_employee_kpi rek 
                     ON rek.employee_id = e.id AND rek.telegram_group_id = tkg.telegram_group_id
             WHERE e.id = $1`,
            [employeeId, groupId]
        );
        if (empRes.rows.length === 0) return null;
        const employee = empRes.rows[0];

        let dateQuery = `
            SELECT DISTINCT to_char(checkin_date, 'YYYY-MM-DD') AS work_date
            FROM public.retail_checkins
            WHERE employee_id = $1 AND group_id = $2
        `;
        const params = [employeeId, groupId];
        if (month) {
            dateQuery += ` AND to_char(checkin_date, 'YYYY-MM') = $3`;
            params.push(month);
        }
        dateQuery += ` UNION
            SELECT DISTINCT to_char(record_date, 'YYYY-MM-DD') AS work_date
            FROM public.retail_daily_summaries
            WHERE employee_id = $1 AND group_id = $2
        `;
        if (month) {
            dateQuery += ` AND to_char(record_date, 'YYYY-MM') = $3`;
        }
        dateQuery += ` ORDER BY work_date DESC`;

        const datesRes = await pool.query(dateQuery, params);
        const workDates = datesRes.rows.map(r => r.work_date);

        const days = [];
        let completedDaysCount = 0;
        let incompleteDaysCount = 0;
        let totalPointsCount = 0;

        for (const d of workDates) {
            const dateStr = String(d);

            const checkinsRes = await pool.query(
                `SELECT id, store_name, store_address, selfie_photo_url, store_photo_url,
                        media_urls, is_valid, reject_reason, drive_folder_url,
                        to_char(checkin_time AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI:SS') AS checkin_time_str,
                        checkin_time
                 FROM public.retail_checkins
                 WHERE employee_id = $1 AND group_id = $2 AND checkin_date = $3::date
                 ORDER BY checkin_time ASC`,
                [employeeId, groupId, dateStr]
            );

            const summaryRes = await pool.query(
                `SELECT * FROM public.retail_daily_summaries
                 WHERE employee_id = $1 AND group_id = $2 AND record_date = $3::date`,
                [employeeId, groupId, dateStr]
            );
            const summary = summaryRes.rows[0];

            const targetPoints = summary ? summary.target_points : Number(employee.target_kpi);
            const validPoints = summary ? summary.valid_points_count : checkinsRes.rows.filter(c => c.is_valid).length;
            const isCompleted = summary ? summary.is_completed : validPoints >= targetPoints;

            if (isCompleted) completedDaysCount++;
            else incompleteDaysCount++;
            totalPointsCount += validPoints;

            const dayDriveFolderUrl = checkinsRes.rows.find(c => c.drive_folder_url)?.drive_folder_url
                || (employee.customer_drive_folder_id ? `https://drive.google.com/drive/folders/${employee.customer_drive_folder_id}` : null);

            days.push({
                date: dateStr,
                targetPoints,
                validPoints,
                totalPoints: validPoints,
                isCompleted,
                status: isCompleted ? 'COMPLETED' : 'INCOMPLETE',
                driveFolderUrl: dayDriveFolderUrl,
                checkins: checkinsRes.rows.map(c => ({
                    id: c.id,
                    storeName: c.store_name,
                    storeAddress: c.store_address,
                    time: c.checkin_time_str,
                    selfiePhotoUrl: c.selfie_photo_url,
                    storePhotoUrl: c.store_photo_url,
                    mediaUrls: Array.isArray(c.media_urls) ? c.media_urls : [],
                    driveFolderUrl: c.drive_folder_url || dayDriveFolderUrl,
                    isValid: c.is_valid,
                    rejectReason: c.reject_reason
                }))
            });
        }

        return {
            employee: {
                id: employee.id,
                fullName: employee.full_name,
                role: employee.role,
                department: employee.department,
                targetKpi: Number(employee.target_kpi),
                hasCustomKpi: Boolean(employee.has_custom_kpi),
                groupName: employee.group_name,
                telegramGroupId: employee.telegram_group_id
            },
            stats: {
                totalWorkDays: days.length,
                completedDays: completedDaysCount,
                incompleteDays: incompleteDaysCount,
                totalPoints: totalPointsCount
            },
            days
        };
    }

    async function upsertEmployeeKpi(employeeId, telegramGroupId, dailyKpiTarget) {
        if (!dailyKpiTarget || Number(dailyKpiTarget) <= 0) {
            await pool.query(
                `DELETE FROM public.retail_employee_kpi
                 WHERE employee_id = $1 AND telegram_group_id = $2`,
                [employeeId, telegramGroupId]
            );
            return { deleted: true, dailyKpiTarget: null };
        }
        const target = Math.max(1, parseInt(dailyKpiTarget, 10));
        const res = await pool.query(
            `INSERT INTO public.retail_employee_kpi (employee_id, telegram_group_id, daily_kpi_target)
             VALUES ($1, $2, $3)
             ON CONFLICT (employee_id, telegram_group_id) DO UPDATE SET
                 daily_kpi_target = EXCLUDED.daily_kpi_target,
                 updated_at = NOW()
             RETURNING *`,
            [employeeId, telegramGroupId, target]
        );
        return res.rows[0];
    }

    async function upsertRetailConfig(telegramGroupId, { shiftStart, shiftEnd, dailyKpiTarget }) {
        await pool.query(
            `INSERT INTO public.retail_checkin_config (telegram_group_id, shift_start_time, shift_end_time, daily_kpi_target)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (telegram_group_id) DO UPDATE SET
                 shift_start_time = COALESCE(EXCLUDED.shift_start_time, retail_checkin_config.shift_start_time),
                 shift_end_time   = COALESCE(EXCLUDED.shift_end_time,   retail_checkin_config.shift_end_time),
                 daily_kpi_target = COALESCE(EXCLUDED.daily_kpi_target, retail_checkin_config.daily_kpi_target),
                 updated_at = NOW()`,
            [telegramGroupId, shiftStart || null, shiftEnd || null, dailyKpiTarget || null]
        );
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
        findDailySummary,
        findRetailGroups,
        findActiveEmployeesInGroup,
        getDailyProgressForGroup,
        getMonthlyProgressForGroup,
        getEmployeeRetailHistory,
        upsertEmployeeKpi,
        upsertRetailConfig
    };
}
