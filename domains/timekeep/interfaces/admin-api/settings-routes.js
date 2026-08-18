/**
 * HTTP cấu hình nhóm cho Web Admin.
 *
 *   PUT /api/tk_group_settings/:telegram_group_id
 *
 * Tên đường dẫn giữ nguyên tiền tố `tk_` như bản cũ: Web Admin đang chạy gọi
 * đúng chuỗi này.
 */

export function registerTimekeepSettingsRoutes({ botApp, saveGroupSettings }) {
    botApp.put('/api/tk_group_settings/:telegram_group_id', async (req, res) => {
        try {
            await saveGroupSettings(req.params.telegram_group_id, req.body);
            res.json({ success: true });
        } catch (error) {
            console.error('[group_settings API] Error:', error);
            res.status(500).json({ error: error.message });
        }
    });
}
