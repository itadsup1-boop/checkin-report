/**
 * HTTP quản trị ca trực cho Web Admin.
 *
 *   PUT    /api/admin/schedules/:id        đổi ca
 *   POST   /api/admin/schedules            thêm ca (trùng ngày thì ghi đè)
 *   DELETE /api/admin/schedules/:id        xoá ca
 *   POST   /api/admin/timekeep/sync-sheet  đồng bộ toàn bộ Sheet chấm công
 */

export function registerTimekeepScheduleRoutes({ botApp, manageSchedules, syncSheets }) {
    /** Lỗi nghiệp vụ trả `{ success:false, message }`, lỗi hệ thống trả `{ error }` — đúng bản cũ. */
    const fail = (res, outcome) =>
        res.status(outcome.status).json({ success: false, message: outcome.message });

    botApp.put('/api/admin/schedules/:id', async (req, res) => {
        try {
            const outcome = await manageSchedules.updateShift(req.params.id, req.body.shift_type, req.admin);
            if (!outcome.ok) return fail(res, outcome);
            res.json({ success: true, data: outcome.data });
        } catch (error) {
            console.error('[Admin Schedule PUT Error]', error);
            res.status(500).json({ error: error.message });
        }
    });

    botApp.post('/api/admin/schedules', async (req, res) => {
        try {
            const outcome = await manageSchedules.createSchedule({
                userId: req.body.user_id,
                date: req.body.date,
                shiftType: req.body.shift_type,
                admin: req.admin
            });
            if (!outcome.ok) return fail(res, outcome);
            res.json({ success: true, data: outcome.data });
        } catch (error) {
            console.error('[Admin Schedule POST Error]', error);
            res.status(500).json({ error: error.message });
        }
    });

    botApp.delete('/api/admin/schedules/:id', async (req, res) => {
        try {
            const outcome = await manageSchedules.deleteSchedule(req.params.id, req.admin);
            if (!outcome.ok) return fail(res, outcome);
            res.json({ success: true });
        } catch (error) {
            console.error('[Admin Schedule DELETE Error]', error);
            res.status(500).json({ error: error.message });
        }
    });

    botApp.post('/api/admin/timekeep/sync-sheet', async (req, res) => {
        try {
            if (!req.admin.isSuperAdmin) {
                return res.status(403).json({ success: false, message: 'Chỉ Super Admin được đồng bộ toàn bộ Sheet.' });
            }
            res.json(await syncSheets());
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });
}
