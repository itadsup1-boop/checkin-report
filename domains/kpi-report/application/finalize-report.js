/**
 * Chốt một báo cáo: tính phạt, ghi database, đưa lên hàng đợi Google Sheet, rồi
 * báo kết quả vào nhóm. Dùng ở ba nơi: báo cáo đủ ảnh ngay (không cần ảnh, hoặc
 * KPI = 0), báo cáo vừa nhận đủ ảnh (từ Telegram hoặc form), và báo cáo bị chốt
 * nợ ảnh khi hết hạn.
 *
 * Phạt chỉ tính TRỌN GÓI MỘT LẦN cho ngày đó — thiếu KPI và nợ ảnh không cộng
 * dồn, khớp đúng quy tắc cũ "tối đa 1 lần phạt/ngày" (xem README).
 */

export function createFinalizeReport({ reportRepository, groupConfigRepository, sheetSync, sendMessageToRoleGroup }) {
    const REPORT_ROLES = ['report', 'report_tour'];

    async function finalizeReport(user, parsedJSON, kpiTarget, telegramId, groupId, text, notifyTarget, debtInfo = null) {
        try {
            let penaltyAmount = 100000;
            try {
                const configured = await groupConfigRepository.findPenaltyMissingKpi(groupId);
                const parsed = parseFloat(configured);
                if (!isNaN(parsed)) penaltyAmount = parsed;
            } catch (e) {
                console.error('Lỗi lấy penalty_amount:', e);
            }

            let totalPenalty = 0;
            let missingKpi = 0;

            if (kpiTarget > 0 && parsedJSON.kpi_actual < kpiTarget) {
                missingKpi = kpiTarget - parsedJSON.kpi_actual;
                if (penaltyAmount > 0) totalPenalty = penaltyAmount;
            }
            if (debtInfo && penaltyAmount > 0) {
                totalPenalty = penaltyAmount;
            }

            if (missingKpi > 0) {
                await sheetSync.enqueuePenaltyLog(groupId, user.full_name, user.employee_code, telegramId, 'THIẾU KPI', totalPenalty, `Thiếu ${missingKpi} tin nhắn so với KPI ${kpiTarget}`);
            } else if (debtInfo && debtInfo.missing > 0) {
                await sheetSync.enqueuePenaltyLog(groupId, user.full_name, user.employee_code, telegramId, 'NỢ MINH CHỨNG', totalPenalty, `Thiếu ${debtInfo.missing} ảnh (Chỉ nộp ${debtInfo.received}/${debtInfo.required})`);
            }

            const today = new Date();
            const reportMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

            await reportRepository.insertDailyReport({
                reportDate: today.toISOString().split('T')[0],
                reportMonth,
                employeeId: user.id,
                groupId,
                rawText: text,
                kpiActual: parsedJSON.kpi_actual,
                kpiRequired: kpiTarget,
                status: text === 'XIN NGHỈ' ? 'OFF' : 'DA_BAO_CAO',
                metadata: {
                    doanh_thu: parsedJSON.doanh_thu,
                    lich_khach: parsedJSON.lich_khach,
                    debt_photos: debtInfo ? debtInfo.missing : 0,
                    penalty_amount: totalPenalty,
                    missing_kpi: missingKpi
                }
            });

            const kpiRequiredStr = kpiTarget > 0 ? kpiTarget : '';
            const percentComplete = kpiTarget > 0 ? Math.round((parsedJSON.kpi_actual / kpiTarget) * 100) + '%' : '';

            let statusText = '';
            if (text === 'XIN NGHỈ') {
                statusText = '🛌 ĐÃ XIN NGHỈ';
            } else if (kpiTarget > 0) {
                if (parsedJSON.kpi_actual >= kpiTarget) {
                    statusText = '✅ Đạt KPI';
                } else {
                    statusText = `❌ Không đạt (Thiếu ${missingKpi})`;
                    if (penaltyAmount > 0) statusText += `\n💸 Phạt vi phạm: -${penaltyAmount.toLocaleString('vi-VN')}đ`;
                }
            }

            let tinhTrangAnh = '✅ Đủ ảnh';
            if (debtInfo) {
                tinhTrangAnh = `🚨 NỢ MINH CHỨNG: Thiếu ${debtInfo.missing} ảnh (Chỉ nộp ${debtInfo.received}/${debtInfo.required})`;
                if (penaltyAmount > 0 && missingKpi === 0) {
                    tinhTrangAnh += `\n💸 Phạt vi phạm: -${penaltyAmount.toLocaleString('vi-VN')}đ`;
                } else if (penaltyAmount > 0 && missingKpi > 0) {
                    tinhTrangAnh += `\n💸 Đã tính phạt chung 1 lần/ngày.`;
                }
            }

            await sheetSync.enqueueReportRow(groupId, {
                'Ngày': new Date().toLocaleString(),
                'Nhân viên': user.full_name,
                'Mã NV': user.employee_code || '',
                'Telegram ID': telegramId,
                'Số tin nhắn (KPI)': kpiRequiredStr,
                'Tin nhắn Thực tế': parsedJSON.kpi_actual,
                'Doanh Thu': parsedJSON.doanh_thu ? parsedJSON.doanh_thu.toLocaleString('vi-VN') + 'đ' : '0',
                'Lịch Khách': parsedJSON.lich_khach || '',
                'Hoàn thành (%)': percentComplete,
                'Trạng thái': statusText,
                'Tình trạng Ảnh': tinhTrangAnh,
                'Nội dung tin nhắn': text
            });

            let penaltyKpiMsg = '';
            if (missingKpi > 0) {
                penaltyKpiMsg = `\n📉 Bạn gửi thiếu ${missingKpi} tin nhắn.`;
                if (totalPenalty > 0 && !debtInfo) {
                    penaltyKpiMsg += `\n💸 Phạt vi phạm: -${totalPenalty.toLocaleString('vi-VN')}đ`;
                }
            }

            const kpiMsg = kpiTarget > 0
                ? `\n🎯 Chỉ tiêu: ${kpiTarget} | ✅ Thực tế: ${parsedJSON.kpi_actual}`
                : `\n✅ Thực tế: ${parsedJSON.kpi_actual}`;

            if (debtInfo) {
                let debtMsg = `🚨 BÁO CÁO GHI NỢ ẢNH!\nĐã lưu báo cáo của ${user.full_name} lên hệ thống.\n⚠️ Tình trạng: Thiếu ${debtInfo.missing} ảnh minh chứng (Nộp ${debtInfo.received}/${debtInfo.required}).${penaltyKpiMsg}`;
                if (totalPenalty > 0) {
                    debtMsg += `\n🔥 Mức phạt vi phạm: -${totalPenalty.toLocaleString('vi-VN')}đ (Đã tính trọn gói 1 lần/ngày)`;
                }
                debtMsg += `\nSếp sẽ kiểm tra và trừ thưởng cuối tháng!`;
                if (notifyTarget) await sendMessageToRoleGroup(notifyTarget, groupId, REPORT_ROLES, debtMsg, {}, 'report_debt_photos');
            } else if (text === 'XIN NGHỈ') {
                if (notifyTarget) {
                    await sendMessageToRoleGroup(notifyTarget, groupId, REPORT_ROLES, `✅ Đã ghi nhận: ${user.full_name} xin nghỉ phép hôm nay!\nHệ thống sẽ miễn báo cáo cho bạn.`, {}, 'report_leave_notice');
                }
            } else if (notifyTarget) {
                await sendMessageToRoleGroup(notifyTarget, groupId, REPORT_ROLES, `✅ Đã nhận đủ ảnh minh chứng!\nĐã lưu báo cáo của ${user.full_name}.${kpiMsg}${penaltyKpiMsg}\n💾 Hệ thống đã ghi nhận thành công!`, {}, 'report_complete_notice');
            }

            console.log(`[LOG] Đã lưu báo cáo của ${user.full_name} vào DB và đưa vào hàng đợi Sheet.`);
        } catch (error) {
            console.error('Lỗi khi lưu báo cáo:', error);
            throw error;
        }
    }

    return { finalizeReport };
}
