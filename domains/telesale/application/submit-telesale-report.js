/**
 * Use case: Xử lý nộp báo cáo Telesale từ Mini App hoặc Telegram.
 */

import { calculateTelesaleStats } from '../domain/telesale-rules.js';
import { buildTelesaleReportMessage } from '../domain/telesale-messages.js';
import { calculateDynamicForm } from '../domain/safe-formula-engine.js';

export function createSubmitTelesaleReport({
    telesaleRepository,
    telesaleSheetSync,
    bot,
    now = () => new Date()
}) {
    return async function submitTelesaleReport({
        telegramGroupId,
        telegramUserId,
        employeeId = null,
        reportSlot: reportSlotArg = null,
        payload = {},
        replyToMessageId = null
    }) {
        if (!telegramGroupId) {
            throw new Error('Thiếu telegramGroupId');
        }

        // Tìm nhân viên: ƯU TIÊN SỐ 1 theo Họ Tên trên form để phân biệt độc lập khi dùng chung nick Telegram
        let emp = null;
        if (payload.employee_name) {
            if (telesaleRepository.findOrCreateEmployee) {
                emp = await telesaleRepository.findOrCreateEmployee({
                    fullName: payload.employee_name,
                    telegramId: telegramUserId,
                    telegramGroupId
                });
            } else if (telesaleRepository.findEmployeeByName) {
                emp = await telesaleRepository.findEmployeeByName(payload.employee_name, telegramGroupId);
            }
        }
        if (!emp && employeeId) {
            emp = { id: employeeId };
        }
        if (!emp && telegramUserId) {
            emp = await telesaleRepository.findEmployeeByTelegramId(telegramUserId);
        }

        if (!emp) {
            emp = {
                id: null,
                telegram_id: telegramUserId,
                full_name: payload.employee_name || 'Nhân sự Telesale',
                role: 'Telesale'
            };
        }

        const employeeName = emp.full_name || payload.employee_name || 'Nhân sự Telesale';

        // Xác định ngày và giờ nộp (Giờ VN - UTC+7)
        const currentDate = now();
        const vnDateObj = new Date(currentDate.getTime() + 7 * 3600 * 1000);
        const dateStr = vnDateObj.toISOString().split('T')[0];
        const timeStr = `${String(vnDateObj.getUTCHours()).padStart(2, '0')}:${String(vnDateObj.getUTCMinutes()).padStart(2, '0')}`;
        const dParts = dateStr.split('-');
        const displayDate = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}/${dParts[0]}` : dateStr;

        const reportSlot = payload.report_slot || reportSlotArg || null;
        const projectName = payload.project_name || '';
        const serviceName = payload.service_name || '';

        // Lấy doanh số luỹ kế của các ngày trước trong tháng
        const monthlyPrevRevenue = await telesaleRepository.getMonthlyPreviousRevenue(telegramGroupId, emp.id, dateStr);

        // Tính toán toàn bộ chỉ số theo quy tắc chuẩn
        const stats = calculateTelesaleStats(payload, monthlyPrevRevenue);

        // Tính toán theo form động (nếu nhóm có cấu hình)
        let formConfig = null;
        let dynamicResult = null;
        if (telesaleRepository.getFormConfig) {
            try {
                formConfig = await telesaleRepository.getFormConfig(telegramGroupId);
                // Tự động bổ sung Dự án mới vào cấu hình nhóm nếu chưa có ("lần sau chỉ việc chọn")
                if (formConfig && formConfig.features?.has_projects && projectName) {
                    const cleanProject = String(projectName).trim();
                    const currentProjects = Array.isArray(formConfig.projects) ? formConfig.projects : [];
                    if (cleanProject && !currentProjects.includes(cleanProject)) {
                        const updatedProjects = [...currentProjects, cleanProject];
                        formConfig.projects = updatedProjects;
                        try {
                            await telesaleRepository.saveFormConfig({
                                telegramGroupId,
                                projects: updatedProjects
                            });
                        } catch (prjErr) {
                            console.warn('[Submit Telesale] Tự động bổ sung dự án mới thất bại:', prjErr.message);
                        }
                    }
                }

                // Tự động bổ sung Dịch vụ mới vào cấu hình nhóm nếu chưa có
                const servicesToAdd = [];
                if (payload.services && Array.isArray(payload.services) && payload.services.length > 0) {
                    payload.services.forEach(s => {
                        const sName = (s.service_name || '').trim();
                        if (sName) servicesToAdd.push(sName);
                    });
                } else if (serviceName) {
                    servicesToAdd.push(String(serviceName).trim());
                }

                if (formConfig && formConfig.features?.has_services && servicesToAdd.length > 0) {
                    const currentServices = Array.isArray(formConfig.services) ? [...formConfig.services] : [];
                    let hasNewSvc = false;
                    servicesToAdd.forEach(sName => {
                        if (sName && !currentServices.includes(sName)) {
                            currentServices.push(sName);
                            hasNewSvc = true;
                        }
                    });
                    if (hasNewSvc) {
                        formConfig.services = currentServices;
                        try {
                            await telesaleRepository.saveFormConfig({
                                telegramGroupId,
                                services: currentServices
                            });
                        } catch (svcErr) {
                            console.warn('[Submit Telesale] Tự động bổ sung dịch vụ mới thất bại:', svcErr.message);
                        }
                    }
                }

                if (formConfig && formConfig.fields && Array.isArray(formConfig.fields) && formConfig.fields.length > 0) {
                    const monthlyPrevObj = {
                        tong_ds_thang: monthlyPrevRevenue
                    };

                    const isMultiServices = Boolean(payload.services && Array.isArray(payload.services) && payload.services.length > 0);

                    // Lũy kế các mốc giờ trước trong ngày
                    let hourlyCumulative = {};
                    const configuredSlots = formConfig.schedule_settings?.slots || [];
                    if (reportSlot && configuredSlots.length > 0 && emp.id && telesaleRepository.getHourlyCumulativeValues) {
                        const slotIdx = configuredSlots.findIndex(s => (s.id || s) === reportSlot);
                        if (slotIdx > 0) {
                            const priorSlots = configuredSlots.slice(0, slotIdx).map(s => s.id || s);
                            try {
                                hourlyCumulative = await telesaleRepository.getHourlyCumulativeValues({
                                    telegramGroupId,
                                    employeeId: emp.id,
                                    reportDate: dateStr,
                                    projectName,
                                    serviceName: isMultiServices ? null : serviceName,
                                    priorSlots
                                });
                            } catch (hErr) {
                                console.warn('[Submit Telesale Warning] Lỗi tính hourlyCumulative:', hErr.message);
                            }
                        }
                    }

                    if (isMultiServices) {
                        // Tính tổng tất cả dịch vụ người dùng nhập
                        const combinedReportValues = {};
                        for (const s of payload.services) {
                            const sVals = s.report_values || s;
                            for (const f of formConfig.fields) {
                                if (f.category === 'INPUT') {
                                    if (f.type === 'currency' || f.type === 'number' || f.data_type === 'currency' || f.data_type === 'number') {
                                        combinedReportValues[f.key] = (combinedReportValues[f.key] || 0) + Number(sVals[f.key] || 0);
                                    }
                                }
                            }
                        }
                        if (payload.ghi_chu) {
                            combinedReportValues.ghi_chu = payload.ghi_chu;
                        }
                        dynamicResult = calculateDynamicForm(formConfig.fields, combinedReportValues, monthlyPrevObj, hourlyCumulative);
                    } else {
                        dynamicResult = calculateDynamicForm(formConfig.fields, payload.report_values || payload, monthlyPrevObj, hourlyCumulative);
                    }
                }
            } catch (cfgErr) {
                console.warn('[Submit Telesale Warning] Không lấy được formConfig:', cfgErr.message);
            }
        }

        // Lưu vào cơ sở dữ liệu
        let savedReport = null;
        const isMultiServices = Boolean(payload.services && Array.isArray(payload.services) && payload.services.length > 0);

        if (isMultiServices) {
            const keepServices = payload.services.map(s => (s.service_name || '').trim()).filter(Boolean);
            if (telesaleRepository.deleteDailyReportsNotInServices && keepServices.length > 0) {
                try {
                    await telesaleRepository.deleteDailyReportsNotInServices({
                        telegramGroupId,
                        employeeId: emp.id,
                        reportDate: dateStr,
                        reportSlot,
                        projectName,
                        keepServices
                    });
                } catch (delErr) {
                    console.warn('[Submit Telesale Warning] Lỗi dọn dẹp dịch vụ cũ:', delErr.message);
                }
            }

            for (const s of payload.services) {
                const sName = (s.service_name || '').trim();
                const sVals = s.report_values || s;
                const sStats = calculateTelesaleStats(sVals, monthlyPrevRevenue);
                savedReport = await telesaleRepository.upsertDailyReport({
                    telegramGroupId,
                    employeeId: emp.id,
                    telegramUserId: telegramUserId || emp.telegram_id,
                    employeeName,
                    reportDate: dateStr,
                    reportSlot,
                    projectName,
                    serviceName: sName,
                    soNhan: sStats.so_nhan,
                    soTrungKncVang: sStats.so_trung_knc_vang,
                    lichPvMoi: sStats.lich_pv_moi,
                    lichPvCu: sStats.lich_pv_cu,
                    lichNgayMai: sStats.lich_ngay_mai,
                    tongToiHnay: sStats.tong_toi_hnay,
                    tongBongHnay: sStats.tong_bong_hnay,
                    tongDsHnay: sStats.tong_ds_hnay,
                    tongLich: sStats.tong_lich,
                    tongDsThang: sStats.tong_ds_thang,
                    tyLeKhachToiDs: sStats.ty_le_khach_toi_ds,
                    tyLeLich: sStats.ty_le_lich,
                    tyLeToi: sStats.ty_le_toi,
                    rawPayload: s,
                    reportValues: sVals
                });
            }
        } else {
            savedReport = await telesaleRepository.upsertDailyReport({
                telegramGroupId,
                employeeId: emp.id,
                telegramUserId: telegramUserId || emp.telegram_id,
                employeeName,
                reportDate: dateStr,
                reportSlot,
                projectName,
                serviceName,
                soNhan: stats.so_nhan,
                soTrungKncVang: stats.so_trung_knc_vang,
                lichPvMoi: stats.lich_pv_moi,
                lichPvCu: stats.lich_pv_cu,
                lichNgayMai: stats.lich_ngay_mai,
                tongToiHnay: stats.tong_toi_hnay,
                tongBongHnay: stats.tong_bong_hnay,
                tongDsHnay: stats.tong_ds_hnay,
                tongLich: stats.tong_lich,
                tongDsThang: stats.tong_ds_thang,
                tyLeKhachToiDs: stats.ty_le_khach_toi_ds,
                tyLeLich: stats.ty_le_lich,
                tyLeToi: stats.ty_le_toi,
                rawPayload: payload,
                reportValues: dynamicResult ? dynamicResult.values : (payload.report_values || null)
            });
        }

        // Đồng bộ sang Google Sheet
        let sheetUrl = null;
        if (telesaleSheetSync) {
            sheetUrl = await telesaleSheetSync.syncDailyReport({
                spreadsheetId: payload.spreadsheetId,
                dateStr: displayDate,
                timeStr,
                employeeName,
                stats,
                fields: formConfig?.fields || null
            });
        }

        // Gửi tin nhắn thông báo lên nhóm Telegram
        if (bot) {
            const message = buildTelesaleReportMessage({
                employeeName,
                dateStr: displayDate,
                stats,
                sheetUrl,
                fields: formConfig?.fields || null,
                dynamicResult,
                reportSlot,
                projectName,
                serviceName: isMultiServices ? '' : serviceName,
                services: isMultiServices ? payload.services : (payload.services || [])
            });


            try {
                const sendOptions = {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                };
                if (replyToMessageId) {
                    sendOptions.reply_parameters = { message_id: replyToMessageId };
                }
                await bot.telegram.sendMessage(telegramGroupId, message, sendOptions);
            } catch (tgErr) {
                // Fallback nếu reply_parameters không được hỗ trợ ở phiên bản Telegraf cũ
                try {
                    const fallbackOptions = {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    };
                    if (replyToMessageId) {
                        fallbackOptions.reply_to_message_id = replyToMessageId;
                    }
                    await bot.telegram.sendMessage(telegramGroupId, message, fallbackOptions);
                } catch (fallbackErr) {
                    // Fallback gửi plain-text nếu parse_mode HTML bị lỗi entities
                    try {
                        const plainText = message
                            .replace(/<[^>]*>/g, '')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/&amp;/g, '&');
                        const plainOptions = {
                            disable_web_page_preview: true
                        };
                        if (replyToMessageId) {
                            plainOptions.reply_to_message_id = replyToMessageId;
                        }
                        await bot.telegram.sendMessage(telegramGroupId, plainText, plainOptions);
                    } catch (finalErr) {
                        console.error('[Telesale] Lỗi khi gửi tin Telegram lên nhóm:', finalErr.message || finalErr);
                    }
                }
            }
        }

        return {
            success: true,
            report: savedReport,
            stats,
            sheetUrl,
            employeeId: emp.id,
            employeeName
        };
    };
}
