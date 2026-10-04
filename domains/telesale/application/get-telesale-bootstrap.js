/**
 * Use case: Cung cấp thông tin ban đầu khi mở Mini App Telesale (khởi động 10s).
 */

export function createGetTelesaleBootstrap({
    telesaleRepository,
    now = () => new Date()
}) {
    return async function getTelesaleBootstrap({ telegramGroupId, telegramUserId }) {
        if (!telegramUserId) {
            throw new Error('Thiếu telegramUserId');
        }

        let employee = await telesaleRepository.findEmployeeByTelegramId(telegramUserId);
        if (!employee && telesaleRepository.findOrCreateEmployee) {
            employee = await telesaleRepository.findOrCreateEmployee({
                telegramId: telegramUserId,
                fullName: null,
                telegramGroupId
            });
        }
        if (!employee) {
            employee = {
                id: null,
                telegram_id: telegramUserId,
                full_name: 'Nhân sự Telesale',
                role: 'Telesale'
            };
        }

        const currentDate = now();
        const vnDateObj = new Date(currentDate.getTime() + 7 * 3600 * 1000);
        const dateStr = vnDateObj.toISOString().split('T')[0];

        // Lấy báo cáo đã nộp hôm nay nếu có (để nhân viên cập nhật/sửa nhanh)
        let existingReport = null;
        if (telegramGroupId && employee.id) {
            existingReport = await telesaleRepository.getDailyReport(telegramGroupId, employee.id, dateStr);
        }

        // Lấy doanh số luỹ kế của các ngày trước trong tháng
        let monthlyPrevRevenue = 0;
        if (telegramGroupId && employee.id) {
            monthlyPrevRevenue = await telesaleRepository.getMonthlyPreviousRevenue(telegramGroupId, employee.id, dateStr);
        }

        // Lấy danh mục dịch vụ đang hoạt động
        let services = [];
        if (telesaleRepository.getActiveServices) {
            try {
                services = await telesaleRepository.getActiveServices();
            } catch {
                services = [];
            }
        }

        let existingServices = [];
        let existingReportValues = {};
        if (existingReport) {
            let raw = existingReport.raw_payload;
            if (typeof raw === 'string') {
                try { raw = JSON.parse(raw); } catch {}
            }
            if (raw && Array.isArray(raw.services)) {
                existingServices = raw.services;
            }
            existingReportValues = existingReport.report_values || {};
        }

        let formConfig = null;
        if (telegramGroupId && telesaleRepository.getFormConfig) {
            try {
                formConfig = await telesaleRepository.getFormConfig(telegramGroupId);
            } catch (cfgErr) {
                console.warn('[Telesale Bootstrap Warning] Không lấy được formConfig:', cfgErr.message);
            }
        }

        return {
            isRegistered: true,
            employee: {
                id: employee.id,
                telegram_id: employee.telegram_id,
                full_name: employee.full_name
            },
            dateStr,
            monthlyPrevRevenue,
            services,
            formConfig,
            existingReport: existingReport ? {
                so_nhan: existingReport.so_nhan,
                so_trung_knc_vang: existingReport.so_trung_knc_vang,
                lich_pv_moi: existingReport.lich_pv_moi,
                lich_pv_cu: existingReport.lich_pv_cu,
                lich_ngay_mai: existingReport.lich_ngay_mai,
                tong_toi_hnay: existingReport.tong_toi_hnay,
                tong_bong_hnay: existingReport.tong_bong_hnay,
                tong_ds_hnay: existingReport.tong_ds_hnay,
                services: existingServices,
                reportValues: existingReportValues
            } : null
        };
    };
}
