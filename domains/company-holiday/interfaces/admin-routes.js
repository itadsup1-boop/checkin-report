export function registerCompanyHolidayAdminRoutes({ app, service, requireSuperAdmin }) {
    app.get('/api/admin/company-holidays', async (req, res) => {
        try { res.json(await service.list({ year: req.query.year })); }
        catch (error) { res.status(500).json({ error: error.message }); }
    });
    app.get('/api/admin/company-holidays/status', async (req, res) => {
        try {
            const date = String(req.query.date || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Ngày không hợp lệ.' });
            res.json({ holiday: await service.isHoliday(date) });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });
    app.post('/api/admin/company-holidays', requireSuperAdmin, async (req, res) => {
        try { res.status(201).json(await service.create(req.body, req.admin.id)); }
        catch (error) { res.status(400).json({ error: error.message }); }
    });
    app.put('/api/admin/company-holidays/:id', requireSuperAdmin, async (req, res) => {
        try { res.json(await service.update(req.params.id, req.body)); }
        catch (error) { res.status(400).json({ error: error.message }); }
    });
    app.post('/api/admin/company-holidays/:id/cancel', requireSuperAdmin, async (req, res) => {
        try {
            const holiday = await service.cancel(req.params.id);
            if (!holiday) return res.status(404).json({ error: 'Không tìm thấy kỳ nghỉ.' });
            res.json(holiday);
        } catch (error) { res.status(400).json({ error: error.message }); }
    });
}
