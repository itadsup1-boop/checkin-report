function fail(res, error, status = 400) {
    console.error('[Telegram Automation]', error);
    return res.status(status).json({ success: false, message: error.message || 'Không thể thực hiện yêu cầu.' });
}

export function registerTelegramAutomationRoutes({ app, service, requireSuperAdmin }) {
    app.use('/api/admin/telegram-automation', requireSuperAdmin);
    app.get('/api/admin/telegram-automation/config', async (req, res) => {
        try { res.json(await service.config(req.admin.id)); } catch (error) { fail(res, error); }
    });
    app.get('/api/admin/telegram-automation/accounts', async (_req, res) => {
        try { res.json(await service.accounts()); } catch (error) { fail(res, error); }
    });
    app.post('/api/admin/telegram-automation/accounts/connect', async (req, res) => {
        try { res.status(201).json(await service.startConnection({ ...req.body, adminId: req.admin.id })); } catch (error) { fail(res, error); }
    });
    app.post('/api/admin/telegram-automation/accounts/:id/code', async (req, res) => {
        try { res.json(await service.submitCode(req.params.id, req.body.code)); } catch (error) { fail(res, error); }
    });
    app.post('/api/admin/telegram-automation/accounts/:id/password', async (req, res) => {
        try { res.json(await service.submitPassword(req.params.id, req.body.password)); } catch (error) { fail(res, error); }
    });
    app.post('/api/admin/telegram-automation/accounts/:id/sync', async (req, res) => {
        try { res.json(await service.sync(req.params.id)); } catch (error) { fail(res, error); }
    });
    app.get('/api/admin/telegram-automation/accounts/:id/groups', async (req, res) => {
        try { res.json(await service.groups(req.params.id)); } catch (error) { fail(res, error); }
    });
    app.put('/api/admin/telegram-automation/destructive-password', async (req, res) => {
        try { await service.setDestructivePassword(req.admin.id, req.body.password, req.body.currentPassword); res.json({ success: true }); } catch (error) { fail(res, error); }
    });
    app.post('/api/admin/telegram-automation/operations/preview', async (req, res) => {
        try { res.status(201).json(await service.preview({ ...req.body, adminId: req.admin.id })); } catch (error) { fail(res, error); }
    });
    app.post('/api/admin/telegram-automation/operations/:id/confirm', async (req, res) => {
        try { await service.confirm({ operationId: req.params.id, ...req.body, adminId: req.admin.id }); res.status(202).json({ success: true }); } catch (error) { fail(res, error); }
    });
    app.get('/api/admin/telegram-automation/operations/:id', async (req, res) => {
        try {
            const operation = await service.operation(req.params.id);
            if (!operation || String(operation.requested_by) !== String(req.admin.id)) return res.status(404).json({ message: 'Không tìm thấy thao tác.' });
            res.json(operation);
        } catch (error) { fail(res, error); }
    });
}
