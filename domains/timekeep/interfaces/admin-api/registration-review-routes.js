export function registerRegistrationReviewRoutes({ app, reviewRegistrations, getAdminAuthContext }) {
    app.get('/api/admin/registration-requests', async (req, res) => {
        try {
            const auth = await getAdminAuthContext(req);
            const outcome = await reviewRegistrations.listPending(auth, req.query.group_id, req.query.status);
            if (!outcome.ok) return res.status(outcome.status).json({ message: outcome.message });
            return res.json(outcome.requests);
        } catch (error) {
            console.error('[Registration Review] Không tải được yêu cầu:', error);
            return res.status(500).json({ message: 'Không tải được danh sách yêu cầu đăng ký.' });
        }
    });

    app.post('/api/admin/registration-requests/:id/approve', async (req, res) => {
        try {
            const auth = await getAdminAuthContext(req);
            const outcome = await reviewRegistrations.approve({
                requestId: req.params.id,
                targetEmployeeId: req.body.target_employee_id,
                auth,
                reviewedBy: `admin:${req.admin.id}`
            });
            if (!outcome.ok) return res.status(outcome.status).json({ message: outcome.message });
            return res.json({ success: true, employee: outcome.employee });
        } catch (error) {
            console.error('[Registration Review] Duyệt thất bại:', error);
            return res.status(500).json({ message: 'Không thể duyệt yêu cầu đăng ký.' });
        }
    });

    app.post('/api/admin/registration-requests/:id/reject', async (req, res) => {
        try {
            const auth = await getAdminAuthContext(req);
            const outcome = await reviewRegistrations.reject({
                requestId: req.params.id,
                auth,
                reviewedBy: `admin:${req.admin.id}`,
                reason: req.body.reason
            });
            if (!outcome.ok) return res.status(outcome.status).json({ message: outcome.message });
            return res.json({ success: true });
        } catch (error) {
            console.error('[Registration Review] Từ chối thất bại:', error);
            return res.status(500).json({ message: 'Không thể từ chối yêu cầu đăng ký.' });
        }
    });
}
