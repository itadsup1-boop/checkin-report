/**
 * Các endpoint phục vụ 3 màn hình Báo Tour, Sửa Tour và Check Tour trên Mini App.
 *
 * Tầng interfaces — kiểm tra tham số, gọi application service, trả JSON.
 */

export function registerTourRoutes({
    botApp,
    tourRepository,
    processTourReport,
    moment
}) {
    // 1. Gợi ý khách đã đặt lịch trong ngày hôm nay
    botApp.get('/api/schedules/tour/suggestions', async (req, res) => {
        try {
            const { groupId, date } = req.query;
            if (!groupId) return res.status(400).json({ success: false, error: 'Thiếu groupId' });
            const todayStr = date || (moment ? moment().utcOffset(7).format('YYYY-MM-DD') : new Date().toISOString().split('T')[0]);
            const list = await tourRepository.getTodayAppointmentSuggestions(groupId, todayStr);
            res.json({ success: true, data: list });
        } catch (err) {
            console.error('Lỗi GET /api/schedules/tour/suggestions:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 2. Danh sách bác sĩ trong hệ thống / nhóm
    botApp.get('/api/schedules/tour/doctors', async (req, res) => {
        try {
            const { groupId } = req.query;
            const doctors = await tourRepository.getDoctorList(groupId || '');
            res.json({ success: true, data: doctors });
        } catch (err) {
            console.error('Lỗi GET /api/schedules/tour/doctors:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 2.1. Danh sách nhân viên có role là Kỹ thuật viên
    botApp.get('/api/schedules/tour/ktvs', async (req, res) => {
        try {
            const { groupId, telegram_id } = req.query;
            const result = await tourRepository.getKtvList(groupId || '', telegram_id || '');
            const ktvs = Array.isArray(result) ? result : (result.ktvs || []);
            res.json({
                success: true,
                data: ktvs,
                userLastKtv: result.userLastKtv || '',
                userEmpName: result.userEmpName || ''
            });
        } catch (err) {
            console.error('Lỗi GET /api/schedules/tour/ktvs:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 3. Thống kê công tour của KTV (hôm nay, tháng này, tổng tích lũy)
    botApp.get('/api/schedules/tour/stats', async (req, res) => {
        try {
            const { groupId, date, telegram_id, ktv_name } = req.query;
            if (!groupId) return res.status(400).json({ success: false, error: 'Thiếu groupId' });
            const dateStr = date || (moment ? moment().utcOffset(7).format('YYYY-MM-DD') : new Date().toISOString().split('T')[0]);
            const stats = await tourRepository.getKtvStats(telegram_id, ktv_name, groupId, dateStr);
            res.json({ success: true, data: stats });
        } catch (err) {
            console.error('Lỗi GET /api/schedules/tour/stats:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 4. Danh sách các tour đã báo gần đây (cho tab Sửa Tour - của ai người đó sửa)
    botApp.get('/api/schedules/tour/recent', async (req, res) => {
        try {
            const { groupId, limit, telegram_id, ktv_name } = req.query;
            if (!groupId) return res.status(400).json({ success: false, error: 'Thiếu groupId' });
            const tours = await tourRepository.findRecentTours(groupId, {
                limit: limit ? Number(limit) : 30,
                telegramUserId: telegram_id,
                ktvName: ktv_name
            });
            res.json({ success: true, data: tours });
        } catch (err) {
            console.error('Lỗi GET /api/schedules/tour/recent:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 5. Gửi báo tour mới từ Mini App
    botApp.post('/api/schedules/tour/submit', async (req, res) => {
        try {
            const outcome = await processTourReport.submitFromMiniApp(req.body);
            res.json(outcome);
        } catch (err) {
            console.error('Lỗi POST /api/schedules/tour/submit:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 6. Cập nhật thông tin tour đã báo (Sửa Tour)
    botApp.put('/api/schedules/tour/:id', async (req, res) => {
        try {
            const outcome = await processTourReport.updateTour({
                id: req.params.id,
                ...req.body
            });
            res.json(outcome);
        } catch (err) {
            console.error('Lỗi PUT /api/schedules/tour/:id:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });
}
