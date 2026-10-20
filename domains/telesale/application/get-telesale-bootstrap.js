/**
 * Use case: Cung cấp thông tin ban đầu khi mở Mini App Telesale (khởi động 10s).
 */

export function createGetTelesaleBootstrap({
    telesaleRepository,
    now = () => new Date()
}) {
    return async function getTelesaleBootstrap({
        telegramGroupId,
        telegramUserId,
        reportSlot = null,
        projectName = '',
        serviceName = ''
    }) {
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

        let effectiveGroupId = telegramGroupId || employee.telegram_group_id || null;

        // Lấy cấu hình form động của nhóm
        let formConfig = null;
        if (effectiveGroupId && telesaleRepository.getFormConfig) {
            try {
                formConfig = await telesaleRepository.getFormConfig(effectiveGroupId);
            } catch (cfgErr) {
                console.warn('[Telesale Bootstrap Warning] Không lấy được formConfig:', cfgErr.message);
            }
        }

        // Xác định slot, project, service mặc định nếu có multi-slot hoặc phân cấp dự án/dịch vụ
        const configuredSlots = formConfig?.schedule_settings?.slots || [];
        let effectiveSlot = reportSlot;
        if (!effectiveSlot && formConfig?.features?.schedule_mode === 'MULTI_SLOT' && configuredSlots.length > 0) {
            const vnHour = vnDateObj.getUTCHours();
            if (vnHour < 11) {
                effectiveSlot = configuredSlots[0]?.id || configuredSlots[0] || '09h';
            } else if (vnHour < 15) {
                effectiveSlot = configuredSlots[1]?.id || configuredSlots[1] || '12h';
            } else {
                effectiveSlot = configuredSlots[2]?.id || configuredSlots[2] || '18h';
            }
        }

        let effectiveProject = projectName;
        if (!effectiveProject && formConfig?.features?.has_projects && formConfig.projects?.length > 0) {
            effectiveProject = formConfig.projects[0];
        }

        let effectiveService = serviceName;
        if (!effectiveService && formConfig?.features?.has_services && formConfig.services?.length > 0) {
            effectiveService = formConfig.services[0];
        }

        // Lấy toàn bộ danh sách báo cáo hôm nay của nhân sự trong nhóm
        let todayReports = [];
        if (effectiveGroupId && employee.id && telesaleRepository.getDailyReportsByEmployee) {
            try {
                todayReports = await telesaleRepository.getDailyReportsByEmployee(effectiveGroupId, employee.id, dateStr);
            } catch (rErr) {
                console.warn('[Telesale Bootstrap Warning] Không lấy được todayReports:', rErr.message);
            }
        }

        // Lấy báo cáo đã nộp theo slot/project/service nếu có
        let existingReport = null;
        if (effectiveGroupId && employee.id) {
            existingReport = await telesaleRepository.getDailyReport(effectiveGroupId, employee.id, dateStr, effectiveSlot, effectiveProject, effectiveService);
        }

        // Lũy kế các mốc giờ trước trong ngày
        let hourlyCumulative = {};
        if (effectiveSlot && configuredSlots.length > 0 && employee.id && telesaleRepository.getHourlyCumulativeValues && effectiveGroupId) {
            const slotIdx = configuredSlots.findIndex(s => (s.id || s) === effectiveSlot);
            if (slotIdx > 0) {
                const priorSlots = configuredSlots.slice(0, slotIdx).map(s => s.id || s);
                try {
                    hourlyCumulative = await telesaleRepository.getHourlyCumulativeValues({
                        telegramGroupId: effectiveGroupId,
                        employeeId: employee.id,
                        reportDate: dateStr,
                        projectName: effectiveProject,
                        serviceName: effectiveService,
                        priorSlots
                    });
                } catch (hErr) {
                    console.warn('[Telesale Bootstrap Warning] Không lấy được hourlyCumulative:', hErr.message);
                }
            }
        }

        // Lấy doanh số luỹ kế của các ngày trước trong tháng
        let monthlyPrevRevenue = 0;
        if (effectiveGroupId && employee.id) {
            monthlyPrevRevenue = await telesaleRepository.getMonthlyPreviousRevenue(effectiveGroupId, employee.id, dateStr);
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

        return {
            isRegistered: true,
            groupId: effectiveGroupId,
            employee: {
                id: employee.id,
                telegram_id: employee.telegram_id,
                full_name: employee.full_name
            },
            dateStr,
            monthlyPrevRevenue,
            services,
            formConfig,
            selectedSlot: effectiveSlot,
            selectedProject: effectiveProject,
            selectedService: effectiveService,
            hourlyCumulative,
            todayReports,
            existingReport: existingReport ? {
                report_slot: existingReport.report_slot,
                project_name: existingReport.project_name,
                service_name: existingReport.service_name,
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
