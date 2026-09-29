/**
 * REST API phục vụ Mini App Báo Cáo Telesale (trên Express port 3009).
 */

export function registerTelesaleMiniappRoutes({
    botApp,
    getTelesaleBootstrap,
    submitTelesaleReport
}) {
    if (!botApp) return;

    // 1. Bootstrap lấy dữ liệu ban đầu
    botApp.get('/api/telesale/bootstrap', async (req, res) => {
        try {
            const telegramUserId = req.query.user_id || req.headers['x-telegram-user-id'];
            const telegramGroupId = req.query.group_id;

            if (!telegramUserId) {
                return res.status(400).json({ isRegistered: false, message: 'Thiếu user_id' });
            }

            const data = await getTelesaleBootstrap({
                telegramGroupId,
                telegramUserId
            });

            res.json(data);
        } catch (err) {
            console.error('[Telesale API Error] Bootstrap:', err.message || err);
            res.status(500).json({ isRegistered: false, message: 'Lỗi máy chủ: ' + (err.message || err) });
        }
    });

    // 2. Submit báo cáo ngày
    botApp.post('/api/telesale/submit', async (req, res) => {
        try {
            const { telegramGroupId, telegramUserId, payload } = req.body;

            if (!telegramGroupId || !telegramUserId) {
                return res.status(400).json({ success: false, message: 'Thiếu telegramGroupId hoặc telegramUserId' });
            }

            const result = await submitTelesaleReport({
                telegramGroupId,
                telegramUserId,
                payload
            });

            res.json(result);
        } catch (err) {
            console.error('[Telesale API Error] Submit:', err.message || err);
            res.status(500).json({ success: false, message: err.message || 'Lỗi khi lưu báo cáo' });
        }
    });
}
