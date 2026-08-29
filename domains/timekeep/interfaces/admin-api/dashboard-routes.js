/**
 * HTTP bảng điều khiển chấm công.
 *
 *   GET /api/admin/dashboard?group_id=<id|ALL>
 *
 * Trả thẳng payload, KHÔNG bọc trong `{ success }` — Web Admin đang đọc đúng
 * hình dạng phẳng này.
 */

export function registerTimekeepDashboardRoutes({ botApp, buildAttendanceDashboard }) {
    botApp.get('/api/admin/dashboard', async (req, res) => {
        try {
            const allowedGroupIds = req.admin.isSuperAdmin ? null : req.admin.allowedGroupIds;
            const outcome = await buildAttendanceDashboard(req.query.group_id, allowedGroupIds);
            if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
            res.json(outcome.payload);
        } catch (error) {
            console.error('[Dashboard Error]', error);
            res.status(500).json({ error: error.message });
        }
    });
}
