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
            const groupId = String(req.params.telegram_group_id);
            if (!req.admin.isSuperAdmin && !req.admin.allowedGroupIds.includes(groupId)) {
                return res.status(403).json({ error: 'Bạn không có quyền sửa cấu hình nhóm này.' });
            }
            await saveGroupSettings(groupId, req.body);
            res.json({ success: true });
        } catch (error) {
            console.error('[group_settings API] Error:', error);
            res.status(500).json({ error: error.message });
        }
    });
}
