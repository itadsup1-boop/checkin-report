/**
 * SQL của lượt điểm danh video (`tk_check_ins`).
 */
export function createCheckinRepository({ pool }) {
    async function insertCheckIn({ groupId, userId, date, checkInTime, videoUrl }) {
        await pool.query(
            `INSERT INTO tk_check_ins (group_id, user_id, date, check_in_time, video_file_id, status)
             VALUES ($1, $2, $3, $4, $5, 'APPROVED')`,
            [groupId, userId, date, checkInTime, videoUrl]
        );
    }

    return { insertCheckIn };
}
