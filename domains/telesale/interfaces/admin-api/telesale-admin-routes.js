/**
 * Router Admin API cho Báo Cáo Telesale.
 * Phục vụ màn hình Quản lý & Đấu nối tài khoản trên Web Admin.
 */

export function registerTelesaleAdminRoutes({
    app,
    telesaleRepository,
    sendTelesaleReminder,
    adminAuth
}) {
    if (!app || !telesaleRepository) return;

    const authMiddleware = adminAuth?.authenticateAdmin || ((req, res, next) => next());
    const requireGeneral = adminAuth?.requireGeneralAdmin || ((req, res, next) => next());

    // 1. Lấy danh sách nhóm Telesale
    app.get('/api/admin/telesale/groups', authMiddleware, requireGeneral, async (req, res) => {
        try {
            const groups = await telesaleRepository.findActiveTelesaleGroups();
            res.json({ success: true, groups });
        } catch (err) {
            console.error('[Telesale Admin API] Lỗi lấy danh sách nhóm:', err.message || err);
            res.status(500).json({ success: false, error: err.message || 'Lỗi lấy danh sách nhóm Telesale' });
        }
    });

    // 2. Lấy dữ liệu danh sách nhân sự Telesale & trạng thái đấu nối + điểm danh hôm nay
    app.get('/api/admin/telesale/mappings', authMiddleware, requireGeneral, async (req, res) => {
        try {
            const groups = await telesaleRepository.findActiveTelesaleGroups();
            if (!groups || groups.length === 0) {
                return res.json({
                    success: true,
                    groupId: null,
                    groups: [],
                    members: [],
                    availableEmployees: []
                });
            }

            const requestedGroupId = req.query.groupId || groups[0].telegram_group_id;
            const currentGroup = groups.find(g => String(g.telegram_group_id) === String(requestedGroupId)) || groups[0];
            const dateStr = req.query.date || null;

            const [members, availableEmployees] = await Promise.all([
                telesaleRepository.getTelesaleMappings(currentGroup.telegram_group_id, dateStr),
                telesaleRepository.getAvailableCheckinEmployees()
            ]);

            res.json({
                success: true,
                groupId: currentGroup.telegram_group_id,
                groupName: currentGroup.group_name,
                groups,
                date: dateStr,
                members,
                availableEmployees
            });
        } catch (err) {
            console.error('[Telesale Admin API] Lỗi lấy danh sách đấu nối:', err.message || err);
            res.status(500).json({ success: false, error: err.message || 'Lỗi máy chủ khi lấy dữ liệu đấu nối' });
        }
    });

    // 3. Cập nhật đấu nối tài khoản thủ công
    app.put('/api/admin/telesale/mappings', authMiddleware, requireGeneral, async (req, res) => {
        try {
            const { telegramGroupId, employeeId, linkedEmployeeId, notes } = req.body;

            if (!telegramGroupId || !employeeId) {
                return res.status(400).json({ success: false, error: 'Thiếu telegramGroupId hoặc employeeId' });
            }

            const updated = await telesaleRepository.updateTelesaleMapping({
                telegramGroupId,
                employeeId,
                linkedEmployeeId: linkedEmployeeId || null,
                notes: notes || null
            });

            // Lấy lại danh sách mới nhất để UI cập nhật ngay
            const members = await telesaleRepository.getTelesaleMappings(telegramGroupId);

            res.json({
                success: true,
                message: linkedEmployeeId ? 'Đấu nối tài khoản thành công' : 'Đã hủy đấu nối tài khoản',
                updated,
                members
            });
        } catch (err) {
            console.error('[Telesale Admin API] Lỗi cập nhật đấu nối:', err.message || err);
            res.status(500).json({ success: false, error: err.message || 'Lỗi cập nhật đấu nối' });
        }
    });

    // 4. Tự động gợi ý & khớp đấu nối theo tên trùng hoặc gần giống
    app.post('/api/admin/telesale/auto-match', authMiddleware, requireGeneral, async (req, res) => {
        try {
            const { telegramGroupId } = req.body;
            if (!telegramGroupId) {
                return res.status(400).json({ success: false, error: 'Thiếu telegramGroupId' });
            }

            const matchedCount = await telesaleRepository.autoMatchTelesaleMappings(telegramGroupId);
            const members = await telesaleRepository.getTelesaleMappings(telegramGroupId);

            res.json({
                success: true,
                matchedCount,
                message: `Đã tự động đấu nối thành công ${matchedCount} nhân sự theo tên.`,
                members
            });
        } catch (err) {
            console.error('[Telesale Admin API] Lỗi tự động đấu nối:', err.message || err);
            res.status(500).json({ success: false, error: err.message || 'Lỗi tự động đấu nối' });
        }
    });

    // 5. Gửi nhắc nhở thủ công ngay từ Web Admin
    app.post('/api/admin/telesale/send-reminder', authMiddleware, requireGeneral, async (req, res) => {
        try {
            const { telegramGroupId } = req.body;
            if (!sendTelesaleReminder) {
                return res.status(501).json({ success: false, error: 'Chức năng gửi nhắc nhở chưa được đăng ký trên API server' });
            }

            const result = await sendTelesaleReminder(telegramGroupId || null);
            res.json({
                success: true,
                message: 'Đã gửi nhắc nhở nộp báo cáo tới nhóm Telesale thành công',
                result
            });
        } catch (err) {
            console.error('[Telesale Admin API] Lỗi gửi nhắc nhở:', err.message || err);
            res.status(500).json({ success: false, error: err.message || 'Lỗi gửi nhắc nhở' });
        }
    });
}
