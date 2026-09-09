export async function findEmployeeForTimekeepContext(pool, telegramId, chatId) {
    if (chatId) {
        const scopedResult = await pool.query(
            `SELECT employee.*
             FROM employees employee
             JOIN telegram_groups telegram_group ON telegram_group.id = employee.group_id
             WHERE employee.telegram_id = $1
               AND telegram_group.telegram_group_id = $2
             ORDER BY employee.created_at DESC, employee.id DESC
             LIMIT 1`,
            [String(telegramId), String(chatId)]
        );
        if (scopedResult.rows.length > 0) {
            return scopedResult.rows[0];
        }
    }

    const fallbackResult = await pool.query(
        `SELECT * FROM employees
         WHERE telegram_id = $1
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        [String(telegramId)]
    );
    return fallbackResult.rows[0] || null;
}
