export function registerEmployeeProfileRoutes({ app, getOverview, getAdminAuthContext }) {
    app.get('/api/admin/employees/:employeeId/monthly-overview', async (req, res) => {
        try {
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.employeeId)) {
                return res.status(400).json({ message: 'ID nhân viên không hợp lệ.' });
            }
            const auth = await getAdminAuthContext(req);
            const outcome = await getOverview({
                employeeId: req.params.employeeId,
                month: req.query.month,
                selectedGroupId: req.query.group_id,
                auth
            });
            if (outcome.status !== 200) {
                return res.status(outcome.status).json({ message: outcome.message });
            }
            return res.json(outcome.data);
        } catch (error) {
            console.error('[Employee Monthly Overview]', error);
            return res.status(500).json({ message: 'Không thể tải hồ sơ nhân viên.' });
        }
    });
}
