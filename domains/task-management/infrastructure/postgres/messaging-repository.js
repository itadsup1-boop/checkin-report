// Chạm DB duy nhất của luồng gửi tin theo chỉ định (mục 28): nhật ký gửi +
// cập nhật Telegram message id sau khi outbox worker gửi thành công.

export function createMessagingRepository({ pool }) {
    return {
        async logDirectMessage({ managerId, employeeId = null, employeeCode = null, employeeName = null, chatId, text }) {
            const result = await pool.query(
                `INSERT INTO ai_management.direct_message_logs
                    (manager_id, employee_id, employee_code, employee_name, chat_id, text)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id`,
                [String(managerId), employeeId, employeeCode, employeeName, String(chatId), text]
            );
            return result.rows[0].id;
        },

        async setDirectMessageOutbox(logId, outboxId) {
            await pool.query(
                'UPDATE ai_management.direct_message_logs SET outbox_id = $2 WHERE id = $1',
                [logId, outboxId]
            );
        },

        async markDirectMessageSent(logId, telegramMessageId) {
            await pool.query(
                `UPDATE ai_management.direct_message_logs
                 SET telegram_message_id = $2, sent_at = NOW()
                 WHERE id = $1`,
                [logId, telegramMessageId]
            );
        },

        async listDirectMessagesByManager(managerId, limit = 10) {
            const result = await pool.query(
                `SELECT id, employee_code, employee_name, left(text, 120) AS text_preview,
                        telegram_message_id, sent_at, created_at
                 FROM ai_management.direct_message_logs
                 WHERE manager_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [String(managerId), limit]
            );
            return result.rows;
        }
    };
}
