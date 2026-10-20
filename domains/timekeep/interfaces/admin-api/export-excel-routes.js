/**
 * Xuất Excel điểm danh một ngày cho Web Admin.
 *
 * Hợp đồng tương thích — giữ nguyên đường dẫn `GET /api/export/today`.
 */
export function registerExportExcelRoutes({ botApp, exportAttendanceExcel, cors, corsOptions }) {
    // CORS toàn cục đã áp cho mọi route, nhưng route này từng bị lỗi preflight
    // riêng nên khai báo OPTIONS tường minh — giữ nguyên phòng khi trình duyệt
    // nào đó vẫn cần.
    botApp.options('/api/export/today', cors(corsOptions));

    botApp.get('/api/export/today', async (req, res) => {
        try {
            const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
            const adminId = req.admin.id;
            const adminRole = req.admin.role;
            const requestedGroupId = req.query.group_id ? String(req.query.group_id) : null;

            const result = await exportAttendanceExcel({ dateStr, adminId, adminRole, requestedGroupId });
            if (!result.ok) {
                return res.status(result.status).json({ success: false, message: result.message });
            }

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="daily_export_${dateStr}.xlsx"`);
            res.send(result.buffer);
        } catch (err) {
            console.error('[Export API Error]', err);
            res.status(500).json({ success: false, message: 'Export failed', error: err.message });
        }
    });
}
