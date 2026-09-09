/**
 * Toàn bộ SQL của hồ sơ khách hàng — nơi DUY NHẤT trong domain này được viết SQL.
 *
 * Hai bảng:
 *   public.customer_records                 hồ sơ khách
 *   public.customer_record_telegram_media   hàng đợi ảnh nhận qua Telegram reply
 */

export function createCustomerRepository({ pool }) {
    /* ---------- Hồ sơ ---------- */

    async function findEmployeeByTelegramId(telegramId) {
        const result = await pool.query(
            'SELECT * FROM employees WHERE telegram_id = $1 LIMIT 1',
            [telegramId]
        );
        return result.rows[0] || null;
    }

    async function findGroup(telegramGroupId) {
        const result = await pool.query(
            'SELECT * FROM telegram_groups WHERE telegram_group_id = $1 LIMIT 1',
            [telegramGroupId]
        );
        return result.rows[0] || null;
    }

    async function insertRecord(record) {
        const result = await pool.query(
            `INSERT INTO public.customer_records
             (group_id, creator_employee_id, record_date, consultant, customer_type,
              customer_name, address, phone, service, gift, bill_amount, paid_amount,
              debt_amount, operator, warranty, drive_folder_link, media_urls)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NULL, NULL)
             RETURNING id`,
            [
                record.groupId, record.employeeId, record.recordDate, record.consultant,
                record.customerType, record.customerName, record.address || null, record.phone,
                record.service, record.gift || null, record.billAmount, record.paidAmount,
                record.debtAmount, record.operator, record.warranty || null
            ]
        );
        return result.rows[0].id;
    }

    /** Gỡ hồ sơ khi không đăng nổi tin nhắn đích của chế độ reply. */
    async function deleteRecord(recordId) {
        await pool.query('DELETE FROM public.customer_records WHERE id = $1', [recordId])
            .catch(() => { /* dọn dẹp: hỏng cũng không được che lỗi gốc */ });
    }

    /**
     * Chế độ reply KHÔNG được ghi đè media_urls về rỗng: ảnh từ Telegram có thể
     * đã về trong lúc đang tạo thư mục Drive.
     */
    async function attachDriveFolder(recordId, driveFolderLink, { keepExistingMedia }) {
        if (keepExistingMedia) {
            await pool.query(
                `UPDATE public.customer_records
                 SET drive_folder_link = $1,
                     media_urls = COALESCE(media_urls, '[]'::jsonb)
                 WHERE id = $2`,
                [driveFolderLink, recordId]
            );
            return;
        }
        await pool.query(
            `UPDATE public.customer_records
             SET drive_folder_link = $1, media_urls = $2
             WHERE id = $3`,
            [driveFolderLink, JSON.stringify([]), recordId]
        );
    }

    async function setMediaUrls(recordId, driveFolderLink, mediaUrls) {
        await pool.query(
            `UPDATE public.customer_records
             SET drive_folder_link = $1, media_urls = $2
             WHERE id = $3`,
            [driveFolderLink, JSON.stringify(mediaUrls), recordId]
        );
    }

    /** Hồ sơ kèm nhóm và người tạo — dùng khi nhận ảnh reply để kiểm quyền. */
    async function findRecordWithGroup(recordId) {
        const result = await pool.query(
            `SELECT r.*, tg.telegram_group_id, tg.bot_role,
                    e.telegram_id AS creator_telegram_id
             FROM public.customer_records r
             JOIN public.telegram_groups tg ON tg.id = r.group_id
             LEFT JOIN public.employees e ON e.id = r.creator_employee_id
             WHERE r.id = $1
             LIMIT 1`,
            [recordId]
        );
        return result.rows[0] || null;
    }

    async function findRecordForUpload(recordId) {
        const result = await pool.query(
            `SELECT r.*, tg.customer_drive_folder_id, tg.telegram_group_id, tg.bot_role
             FROM public.customer_records r
             JOIN public.telegram_groups tg ON tg.id = r.group_id
             WHERE r.id = $1
             LIMIT 1`,
            [recordId]
        );
        return result.rows[0] || null;
    }

    /* ---------- Tổng kết cuối ngày ---------- */

    async function findActiveCustomerGroups() {
        const result = await pool.query(
            `SELECT id, telegram_group_id, group_name
             FROM telegram_groups
             WHERE bot_role IN ('customer', 'customer_record')
               AND is_active = true
               AND COALESCE(is_deleted, false) = false`
        );
        return result.rows;
    }

    async function findRecordsOfDay(groupId, dateStr) {
        const result = await pool.query(
            `SELECT r.*, e.full_name AS creator_name
             FROM customer_records r
             LEFT JOIN employees e ON r.creator_employee_id = e.id
             WHERE r.group_id = $1 AND r.record_date = $2
             ORDER BY r.created_at ASC`,
            [groupId, dateStr]
        );
        return result.rows;
    }

    /* ---------- Hàng đợi media nhận qua Telegram ---------- */

    /**
     * Xếp một file vào hàng đợi.
     * `ON CONFLICT DO NOTHING` theo (hồ sơ, file_unique_id): Telegram có thể gửi
     * lại cùng một file, không được tải trùng lên Drive.
     * @returns {?string} id của job, null nếu file đã có sẵn trong hàng đợi
     */
    async function enqueueMedia(media) {
        const result = await pool.query(
            `INSERT INTO public.customer_record_telegram_media
             (customer_record_id, telegram_file_id, telegram_file_unique_id,
              telegram_chat_id, telegram_message_id, telegram_media_group_id,
              media_type, mime_type, file_name, file_size)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (customer_record_id, telegram_file_unique_id) DO NOTHING
             RETURNING id`,
            [
                media.recordId, media.fileId, media.fileUniqueId, media.chatId,
                media.messageId, media.mediaGroupId, media.mediaType,
                media.mimeType, media.fileName, media.fileSize
            ]
        );
        return result.rows[0]?.id || null;
    }

    /**
     * Nhận một việc trong hàng đợi.
     *
     * `FOR UPDATE SKIP LOCKED` để nhiều tiến trình bot không giành cùng một file.
     * Nhận lại cả việc PROCESSING quá 10 phút — đó là việc của tiến trình đã chết.
     */
    async function claimNextMediaJob() {
        const result = await pool.query(`
            WITH next_job AS (
                SELECT id
                FROM public.customer_record_telegram_media
                WHERE (status = 'PENDING')
                   OR (status = 'FAILED' AND next_retry_at <= NOW())
                   OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '10 minutes')
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE public.customer_record_telegram_media queue
            SET status = 'PROCESSING',
                attempts = attempts + 1,
                updated_at = NOW(),
                last_error = NULL
            FROM next_job
            WHERE queue.id = next_job.id
            RETURNING queue.*
        `);
        return result.rows[0] || null;
    }

    /** Đánh dấu tải xong: cập nhật cả job lẫn hồ sơ trong CÙNG một transaction. */
    async function markMediaUploaded(job, { driveUrl, folderLink }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `UPDATE public.customer_record_telegram_media
                 SET status = 'UPLOADED', drive_url = $2, uploaded_at = NOW(), updated_at = NOW()
                 WHERE id = $1`,
                [job.id, driveUrl]
            );
            await client.query(
                `UPDATE public.customer_records
                 SET drive_folder_link = $2,
                     media_urls = COALESCE(media_urls, '[]'::jsonb) || jsonb_build_array($3::text)
                 WHERE id = $1`,
                [job.customer_record_id, folderLink, driveUrl]
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function markMediaFailed(job, message, retryMinutes) {
        await pool.query(
            `UPDATE public.customer_record_telegram_media
             SET status = 'FAILED',
                 last_error = $2,
                 next_retry_at = NOW() + ($3 * INTERVAL '1 minute'),
                 updated_at = NOW()
             WHERE id = $1`,
            [job.id, String(message).slice(0, 2000), retryMinutes]
        );
    }

    return {
        findEmployeeByTelegramId,
        findGroup,
        insertRecord,
        deleteRecord,
        attachDriveFolder,
        setMediaUrls,
        findRecordWithGroup,
        findRecordForUpload,
        findActiveCustomerGroups,
        findRecordsOfDay,
        enqueueMedia,
        claimNextMediaJob,
        markMediaUploaded,
        markMediaFailed
    };
}
