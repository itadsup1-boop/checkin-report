/**
 * Mini App số liệu cá nhân.
 *
 * Hợp đồng tương thích — giữ nguyên đường dẫn `GET /api/timekeep/personal-stats`
 * và shape lỗi `{ error }` (KHÔNG bọc `success`, khác quy ước các route khác
 * của domain này — Mini App đang đọc đúng như vậy).
 */
export function registerPersonalStatsRoutes({ botApp, getPersonalStats }) {
    botApp.get('/api/timekeep/personal-stats', async (req, res) => {
        try {
            const { chat_id } = req.query;
            const telegram_id = req.verifiedTelegramId || req.query.telegram_id;

            const result = await getPersonalStats({ telegramId: telegram_id, chatId: chat_id });
            if (!result.ok) {
                return res.status(result.status).json({ error: result.message });
            }
            res.json(result.data);
        } catch (error) {
            console.error('[Personal Stats Error]', error);
            res.status(500).json({ error: error.message });
        }
    });
}
