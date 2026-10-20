/**
 * REST API phục vụ Mini App Báo Cáo Telesale (trên Express port 3009).
 */

export function registerTelesaleMiniappRoutes({
    botApp,
    getTelesaleBootstrap,
    submitTelesaleReport,
    telesaleRepository
}) {
    if (!botApp) return;

    // 1. Bootstrap lấy dữ liệu ban đầu
    botApp.get('/api/telesale/bootstrap', async (req, res) => {
        try {
            const telegramUserId = req.query.user_id || req.headers['x-telegram-user-id'];
            const telegramGroupId = req.query.group_id;
            const reportSlot = req.query.report_slot || null;
            const projectName = req.query.project_name || '';
            const serviceName = req.query.service_name || '';

            if (!telegramUserId) {
                return res.status(400).json({ isRegistered: false, message: 'Thiếu user_id' });
            }

            const data = await getTelesaleBootstrap({
                telegramGroupId,
                telegramUserId,
                reportSlot,
                projectName,
                serviceName
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

    // 3. Tự động thêm / bổ sung Dự án mới vào danh sách của nhóm
    botApp.post('/api/telesale/add-project', async (req, res) => {
        try {
            const { telegramGroupId, projectName } = req.body;
            const cleanName = (projectName || '').trim();

            if (!telegramGroupId || !cleanName) {
                return res.status(400).json({ success: false, message: 'Thiếu telegramGroupId hoặc projectName' });
            }

            if (!telesaleRepository) {
                return res.status(500).json({ success: false, message: 'Repository không sẵn sàng' });
            }

            const formConfig = await telesaleRepository.getFormConfig(telegramGroupId);
            const currentProjects = Array.isArray(formConfig?.projects) ? formConfig.projects : [];
            let updatedProjects = currentProjects;
            if (!currentProjects.includes(cleanName)) {
                updatedProjects = [...currentProjects, cleanName];
                await telesaleRepository.saveFormConfig({
                    telegramGroupId,
                    projects: updatedProjects
                });
            }

            res.json({ success: true, projects: updatedProjects, added: cleanName });
        } catch (err) {
            console.error('[Telesale API Error] Add Project:', err.message || err);
            res.status(500).json({ success: false, message: err.message || 'Lỗi khi thêm dự án' });
        }
    });

    // 4. Tự động thêm / bổ sung Dịch vụ mới vào danh sách của nhóm
    botApp.post('/api/telesale/add-service', async (req, res) => {
        try {
            const { telegramGroupId, serviceName } = req.body;
            const cleanName = (serviceName || '').trim();

            if (!telegramGroupId || !cleanName) {
                return res.status(400).json({ success: false, message: 'Thiếu telegramGroupId hoặc serviceName' });
            }

            if (!telesaleRepository) {
                return res.status(500).json({ success: false, message: 'Repository không sẵn sàng' });
            }

            const formConfig = await telesaleRepository.getFormConfig(telegramGroupId);
            const currentServices = Array.isArray(formConfig?.services) ? formConfig.services : [];
            let updatedServices = currentServices;
            if (!currentServices.includes(cleanName)) {
                updatedServices = [...currentServices, cleanName];
                await telesaleRepository.saveFormConfig({
                    telegramGroupId,
                    services: updatedServices
                });
            }

            res.json({ success: true, services: updatedServices, added: cleanName });
        } catch (err) {
            console.error('[Telesale API Error] Add Service:', err.message || err);
            res.status(500).json({ success: false, message: err.message || 'Lỗi khi thêm dịch vụ' });
        }
    });

}