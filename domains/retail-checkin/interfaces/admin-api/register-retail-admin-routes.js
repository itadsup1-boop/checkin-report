/**
 * Web Admin REST API routes cho Quản lý check-in thị trường (Retail Check-in).
 */
export function registerRetailAdminRoutes({
    app,
    getRetailOverview,
    getRetailMonthlyOverview,
    getMemberRetailHistory,
    updateMemberRetailKpi,
    repository
}) {
    // 1. Danh sách các nhóm retail_checkin được phép quản lý
    app.get('/api/admin/retail/groups', async (req, res) => {
        try {
            const allRetailGroups = await repository.findRetailGroups();
            const allowedGroupIds = req.admin?.allowedGroupIds || [];
            const isSuperAdmin = Boolean(req.admin?.isSuperAdmin);

            const filtered = isSuperAdmin
                ? allRetailGroups
                : allRetailGroups.filter(g => allowedGroupIds.includes(g.telegram_group_id));

            return res.json({ success: true, groups: filtered });
        } catch (err) {
            console.error('[Retail Admin API] Lỗi get groups:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    // 2. Thống kê tổng quan và tiến độ hôm nay của các thành viên trong nhóm
    app.get('/api/admin/retail/overview', async (req, res) => {
        try {
            const requestedGroupId = req.query.group_id || req.query.groupId;
            const date = req.query.date;
            const allRetailGroups = await repository.findRetailGroups();
            const allowedGroupIds = req.admin?.allowedGroupIds || [];
            const isSuperAdmin = Boolean(req.admin?.isSuperAdmin);

            const accessibleGroups = isSuperAdmin
                ? allRetailGroups
                : allRetailGroups.filter(g => allowedGroupIds.includes(g.telegram_group_id));

            if (!accessibleGroups.length) {
                return res.status(403).json({
                    success: false,
                    error: 'Tài khoản chưa được phân quyền quản lý nhóm check-in thị trường nào.'
                });
            }

            let targetGroup = accessibleGroups[0];
            if (requestedGroupId && requestedGroupId !== 'ALL') {
                const found = accessibleGroups.find(g => 
                    g.telegram_group_id === requestedGroupId || g.id === requestedGroupId
                );
                if (found) targetGroup = found;
            }

            const overview = await getRetailOverview({
                groupId: targetGroup.id,
                dateStr: date
            });

            return res.json({ success: true, ...overview });
        } catch (err) {
            console.error('[Retail Admin API] Lỗi get overview:', err);
            return res.status(err.status || 500).json({ success: false, error: err.message });
        }
    });

    // 3. Thống kê tổng quan cả tháng của toàn bộ nhóm check-in thị trường
    app.get('/api/admin/retail/monthly-overview', async (req, res) => {
        try {
            const requestedGroupId = req.query.group_id || req.query.groupId;
            const month = req.query.month;
            const allRetailGroups = await repository.findRetailGroups();
            const allowedGroupIds = req.admin?.allowedGroupIds || [];
            const isSuperAdmin = Boolean(req.admin?.isSuperAdmin);

            const accessibleGroups = isSuperAdmin
                ? allRetailGroups
                : allRetailGroups.filter(g => allowedGroupIds.includes(g.telegram_group_id));

            if (!accessibleGroups.length) {
                return res.status(403).json({
                    success: false,
                    error: 'Tài khoản chưa được phân quyền quản lý nhóm check-in thị trường nào.'
                });
            }

            let targetGroup = accessibleGroups[0];
            if (requestedGroupId && requestedGroupId !== 'ALL') {
                const found = accessibleGroups.find(g => 
                    g.telegram_group_id === requestedGroupId || g.id === requestedGroupId
                );
                if (found) targetGroup = found;
            }

            const monthlyOverview = await getRetailMonthlyOverview({
                groupId: targetGroup.id,
                monthStr: month
            });

            return res.json({ success: true, ...monthlyOverview });
        } catch (err) {
            console.error('[Retail Admin API] Lỗi get monthly overview:', err);
            return res.status(err.status || 500).json({ success: false, error: err.message });
        }
    });

    // 4. Chi tiết lịch sử đi tuyến và các điểm check-in của 1 nhân viên
    app.get('/api/admin/retail/employees/:employeeId/history', async (req, res) => {
        try {
            const { employeeId } = req.params;
            const requestedGroupId = req.query.group_id || req.query.groupId;
            const month = req.query.month;

            const allRetailGroups = await repository.findRetailGroups();
            const allowedGroupIds = req.admin?.allowedGroupIds || [];
            const isSuperAdmin = Boolean(req.admin?.isSuperAdmin);

            const accessibleGroups = isSuperAdmin
                ? allRetailGroups
                : allRetailGroups.filter(g => allowedGroupIds.includes(g.telegram_group_id));

            let targetGroup = accessibleGroups[0];
            if (requestedGroupId) {
                const found = accessibleGroups.find(g => 
                    g.telegram_group_id === requestedGroupId || g.id === requestedGroupId
                );
                if (found) targetGroup = found;
            }

            if (!targetGroup) {
                return res.status(403).json({ success: false, error: 'Không có quyền truy cập nhóm này.' });
            }

            const history = await getMemberRetailHistory({
                employeeId,
                groupId: targetGroup.id,
                month
            });

            return res.json({ success: true, ...history });
        } catch (err) {
            console.error('[Retail Admin API] Lỗi get employee history:', err);
            return res.status(err.status || 500).json({ success: false, error: err.message });
        }
    });

    // 4. Cài đặt chỉ tiêu KPI riêng cho thành viên
    app.put('/api/admin/retail/employees/:employeeId/kpi', async (req, res) => {
        try {
            const { employeeId } = req.params;
            const targetGroupId = req.body.telegramGroupId || req.body.telegram_group_id;
            const targetKpi = req.body.dailyKpiTarget !== undefined ? req.body.dailyKpiTarget : req.body.daily_kpi_target;

            const allRetailGroups = await repository.findRetailGroups();
            const allowedGroupIds = req.admin?.allowedGroupIds || [];
            const isSuperAdmin = Boolean(req.admin?.isSuperAdmin);

            const matchedGroup = allRetailGroups.find(g =>
                g.telegram_group_id === targetGroupId || g.id === targetGroupId
            );

            if (!matchedGroup) {
                return res.status(404).json({ success: false, error: 'Không tìm thấy nhóm check-in thị trường.' });
            }

            if (!isSuperAdmin && !allowedGroupIds.includes(matchedGroup.telegram_group_id)) {
                return res.status(403).json({ success: false, error: 'Bạn không có quyền quản trị nhóm này.' });
            }

            const result = await updateMemberRetailKpi({
                employeeId,
                telegramGroupId: matchedGroup.telegram_group_id,
                dailyKpiTarget: targetKpi
            });

            return res.json(result);
        } catch (err) {
            console.error('[Retail Admin API] Lỗi update KPI:', err);
            return res.status(err.status || 500).json({ success: false, error: err.message });
        }
    });
}
