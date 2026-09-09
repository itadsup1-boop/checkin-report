/**
 * Đồng bộ Google Sheet của báo cáo KPI hàng ngày và sổ phạt.
 *
 * Mọi lần ghi đều xếp vào MỘT hàng đợi Promise nối tiếp (`sheetQueue`) — ghi
 * Sheet là API mạng chậm và có giới hạn quota; xếp hàng để hai báo cáo nộp gần
 * nhau không giẫm lên nhau (đọc rows, sửa, save của người này chèn vào giữa
 * thao tác của người kia là hỏng dữ liệu Sheet).
 */

const REPORT_HEADERS = [
    'Ngày', 'Nhân viên', 'Mã NV', 'Telegram ID', 'Số tin nhắn (KPI)', 'Tin nhắn Thực tế',
    'Doanh Thu', 'Lịch Khách', 'Hoàn thành (%)', 'Trạng thái', 'Tình trạng Ảnh', 'Nội dung tin nhắn'
];

export function createKpiReportSheetSync({ getKpiDocForGroup }) {
    let sheetQueue = Promise.resolve();

    function enqueue(work) {
        sheetQueue = sheetQueue.then(work).catch(err => console.error('[KPI Sheet] Lỗi hàng đợi:', err));
        return sheetQueue;
    }

    function individualSheetTitle(fullName, telegramId) {
        const idSuffix = String(telegramId).slice(-3);
        return `${fullName} - ${idSuffix}`.substring(0, 100);
    }

    /** Luôn thêm dòng mới — báo cáo là nhật ký theo thời gian, không tìm/sửa dòng cũ. */
    async function enqueueReportRow(groupId, rowData) {
        return enqueue(async () => {
            const kpiDoc = await getKpiDocForGroup(groupId);
            if (!kpiDoc) {
                console.warn(`[KPI Sheet] group_id=${groupId} status=skipped reason=spreadsheet_not_configured`);
                return;
            }
            await kpiDoc.loadInfo();

            const mainSheet = kpiDoc.sheetsByIndex[0];
            if (mainSheet) {
                await mainSheet.setHeaderRow(REPORT_HEADERS);
                await mainSheet.addRow(rowData);
            }

            const sheetTitle = individualSheetTitle(rowData['Nhân viên'], rowData['Telegram ID']);
            let individualSheet = kpiDoc.sheetsByTitle[sheetTitle];
            if (!individualSheet) {
                individualSheet = await kpiDoc.addSheet({ headerValues: REPORT_HEADERS, title: sheetTitle });
            } else {
                await individualSheet.setHeaderRow(REPORT_HEADERS);
            }
            await individualSheet.addRow(rowData);
            console.log(`[LOG] Đã ghi Sheet xong cho ${rowData['Nhân viên']}.`);
        });
    }

    /** Ghi danh sách nhân viên KHÔNG nộp báo cáo khi hết giờ ân hạn — mỗi người một dòng, ở cả sheet tổng và sheet cá nhân. */
    async function enqueueMissingReportRows(groupId, employees, penaltyAmount) {
        return enqueue(async () => {
            const kpiDoc = await getKpiDocForGroup(groupId);
            if (!kpiDoc) {
                console.warn(`[KPI Sheet] group_id=${groupId} status=skipped reason=spreadsheet_not_configured`);
                return;
            }
            await kpiDoc.loadInfo();
            const mainSheet = kpiDoc.sheetsByIndex[0];

            for (const employee of employees) {
                const tinhTrangAnh = penaltyAmount > 0
                    ? `🚨 BỎ BÁO CÁO (Phạt: -${penaltyAmount.toLocaleString('vi-VN')}đ)`
                    : '🚨 BỎ BÁO CÁO';
                const rowData = {
                    'Ngày': new Date().toLocaleString(),
                    'Nhân viên': employee.full_name,
                    'Mã NV': employee.employee_code || '',
                    'Telegram ID': employee.telegram_id,
                    'Số tin nhắn (KPI)': Number(employee.current_kpi_target),
                    'Tin nhắn Thực tế': 0,
                    'Doanh Thu': '0',
                    'Lịch Khách': '',
                    'Hoàn thành (%)': '0%',
                    'Trạng thái': '❌ KHÔNG BÁO CÁO',
                    'Tình trạng Ảnh': tinhTrangAnh,
                    'Nội dung tin nhắn': ''
                };

                if (mainSheet) {
                    await mainSheet.setHeaderRow(REPORT_HEADERS);
                    await mainSheet.addRow(rowData);
                }

                const sheetTitle = individualSheetTitle(employee.full_name, employee.telegram_id);
                let individualSheet = kpiDoc.sheetsByTitle[sheetTitle];
                if (!individualSheet) {
                    individualSheet = await kpiDoc.addSheet({ headerValues: REPORT_HEADERS, title: sheetTitle });
                } else {
                    await individualSheet.setHeaderRow(REPORT_HEADERS);
                }
                await individualSheet.addRow(rowData);
            }
        });
    }

    /**
     * Sổ tổng hợp phạt theo tháng — MỘT dòng mỗi nhân viên, cộng dồn tiền phạt.
     * Nếu hôm nay đã bị phạt rồi thì không cộng dồn tiền nữa (chỉ ghi thêm lịch
     * sử lỗi) — khớp đúng quy tắc "tối đa 1 lần phạt/ngày" ở tầng nghiệp vụ.
     */
    async function enqueuePenaltyLog(groupId, fullName, employeeCode, telegramId, penaltyType, amount, details) {
        if (amount <= 0) return;

        return enqueue(async () => {
            const kpiDoc = await getKpiDocForGroup(groupId);
            if (!kpiDoc) {
                console.warn(`[KPI Sheet] group_id=${groupId} status=skipped reason=spreadsheet_not_configured`);
                return;
            }
            await kpiDoc.loadInfo();
            const today = new Date();
            const monthStr = `${today.getMonth() + 1}-${today.getFullYear()}`;
            const sheetTitle = `TỔNG PHẠT T${monthStr}`;

            let penaltySheet = kpiDoc.sheetsByTitle[sheetTitle];
            const headers = ['Nhân viên', 'Mã NV', 'Telegram ID', 'Tổng Tiền Phạt', 'Lịch Sử Vi Phạm'];
            if (!penaltySheet) {
                penaltySheet = await kpiDoc.addSheet({ headerValues: headers, title: sheetTitle });
            }

            const rows = await penaltySheet.getRows();
            const existingRow = rows.find(row => row.get('Telegram ID') === telegramId.toString());

            const dateStr = `${today.getDate()}/${today.getMonth() + 1}`;
            const newLogLine = `[${dateStr}] ${penaltyType}: -${amount.toLocaleString('vi-VN')}đ (${details})`;

            if (existingRow) {
                const currentHistory = existingRow.get('Lịch Sử Vi Phạm') || '';
                const isAlreadyPenalizedToday = currentHistory.includes(`[${dateStr}]`);

                if (isAlreadyPenalizedToday) {
                    const noStackingLog = `[${dateStr}] THÊM LỖI: ${penaltyType} (Đã phạt, không cộng dồn tiền)`;
                    existingRow.set('Lịch Sử Vi Phạm', currentHistory + '\n' + noStackingLog);
                    await existingRow.save();
                    console.log(`[LOG] Bỏ qua cộng tiền phạt ${penaltyType} cho ${fullName} vì đã vi phạm trong ngày hôm nay.`);
                } else {
                    const currentTotalStr = existingRow.get('Tổng Tiền Phạt') || '0';
                    const currentTotal = (parseFloat(currentTotalStr.toString().replace(/\./g, '').replace(/,/g, '')) || 0) + amount;

                    existingRow.set('Tổng Tiền Phạt', currentTotal);
                    existingRow.set('Lịch Sử Vi Phạm', currentHistory + '\n' + newLogLine);
                    await existingRow.save();
                    console.log(`[LOG] Đã CỘNG DỒN phạt ${penaltyType} cho ${fullName}.`);
                }
            } else {
                await penaltySheet.addRow({
                    'Nhân viên': fullName,
                    'Mã NV': employeeCode || '',
                    'Telegram ID': telegramId || '',
                    'Tổng Tiền Phạt': amount,
                    'Lịch Sử Vi Phạm': newLogLine
                });
                console.log(`[LOG] Đã TẠO MỚI phạt ${penaltyType} cho ${fullName}.`);
            }
        });
    }

    return { enqueueReportRow, enqueueMissingReportRows, enqueuePenaltyLog };
}
