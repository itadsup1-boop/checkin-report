/**
 * Điều phối nghiệp vụ xử lý báo công tour và cập nhật sửa đổi công tour.
 *
 * Tầng application — không viết SQL, không phụ thuộc framework cụ thể.
 */

import {
    parseTourMessage,
    buildTourReportNotice,
    calculateTourCredit
} from '../domain/tour-report-parser.js';

export function createProcessTourReportService({
    repository,
    sendPhotoToRoleGroup,
    sendMessageToRoleGroup,
    bot,
    moment,
    fs,
    path,
    uploadDir,
    publicBaseUrl,
    tourSheetSync
}) {
    /**
     * Xử lý báo tour từ Mini App.
     * Nhận payload JSON kèm ảnh base64 hoặc đường dẫn ảnh.
     */
    async function submitFromMiniApp({
        groupId,
        telegramUserId,
        reportedBy,
        customerName,
        phone,
        customerType = 'Khách cũ',
        doctor,
        service,
        ktvNames = [],
        appointmentId,
        imageBase64,
        notes,
        reportDate
    }) {
        const todayStr = reportDate || (moment ? moment().utcOffset(7).format('YYYY-MM-DD') : new Date().toISOString().split('T')[0]);
        const cleanedKtv = (Array.isArray(ktvNames) ? ktvNames : [ktvNames])
            .map(s => String(s || '').trim())
            .filter(Boolean);

        if (!customerName || !customerName.trim()) {
            return { success: false, error: 'Bắt buộc phải điền tên khách hàng!' };
        }
        if (!phone || !phone.trim()) {
            return { success: false, error: 'Bắt buộc phải điền số điện thoại khách hàng!' };
        }
        if (!doctor || !doctor.trim()) {
            return { success: false, error: 'Bắt buộc phải chọn hoặc điền tên bác sĩ phụ trách!' };
        }
        if (!service || !service.trim()) {
            return { success: false, error: 'Bắt buộc phải điền tên dịch vụ!' };
        }
        if (cleanedKtv.length === 0) {
            return { success: false, error: 'Bắt buộc phải điền tên kỹ thuật viên (KTV)!' };
        }
        if (!imageBase64) {
            return { success: false, error: 'Bắt buộc phải chụp hoặc tải ảnh chứng thực khách có mặt tại cơ sở!' };
        }

        // Kiểm tra chống trùng khách trong ngày
        const existing = await repository.findDuplicateToday(groupId, todayStr, phone, service);
        if (existing) {
            return {
                success: false,
                error: `Khách hàng ${customerName} (${phone}) đã được báo tour trong ngày hôm nay rồi!`
            };
        }

        // Lưu ảnh từ base64
        let photoUrl = '';
        let imageBuffer = null;
        try {
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
            imageBuffer = Buffer.from(base64Data, 'base64');
            const filename = `tour_${groupId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
            const filePath = path.join(uploadDir, filename);
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            fs.writeFileSync(filePath, imageBuffer);
            photoUrl = `${publicBaseUrl}/uploads/${filename}`;
        } catch (err) {
            console.error('Lỗi lưu ảnh báo tour:', err);
            return { success: false, error: 'Không thể lưu ảnh chứng thực. Vui lòng thử lại!' };
        }

        const tourCredit = calculateTourCredit(cleanedKtv.length);

        const record = await repository.insertTourReport({
            groupId,
            telegramUserId,
            reportedBy,
            reportDate: todayStr,
            customerName: customerName.trim(),
            phone: phone.trim(),
            customerType,
            doctor: doctor ? doctor.trim() : null,
            service: service ? service.trim() : null,
            ktvNames: cleanedKtv,
            tourCredit,
            appointmentId: appointmentId ? Number(appointmentId) : null,
            photoUrl,
            notes: notes ? notes.trim() : null,
            isValid: true,
            status: 'VALID',
            rawText: `[Mini App] Khách: ${customerName} | SĐT: ${phone} | KTV: ${cleanedKtv.join(', ')}`
        });

        // Nếu có liên kết với lịch đặt trước -> hoàn tất lịch hẹn
        if (appointmentId) {
            await repository.markAppointmentCompleted(appointmentId, photoUrl);
        }

        // Soạn tin nhắn và gửi vào nhóm Telegram
        const noticeText = buildTourReportNotice({
            reportDate: todayStr,
            customerName: customerName.trim(),
            customerType,
            doctor: doctor ? doctor.trim() : '',
            phone: phone.trim(),
            service: service ? service.trim() : '',
            ktvNames: cleanedKtv,
            tourCredit,
            notes: notes ? notes.trim() : ''
        });

        if (sendPhotoToRoleGroup && imageBuffer) {
            try {
                await sendPhotoToRoleGroup(bot, groupId, 'report_tour', { source: imageBuffer }, {
                    caption: noticeText
                }, 'ktv_tour_report_notice');
            } catch (tgErr) {
                console.error('Lỗi gửi tin báo tour vào Telegram group:', tgErr);
            }
        }

        if (tourSheetSync) {
            tourSheetSync.syncTourToSheet(groupId, {
                ...record,
                reportDate: todayStr,
                customerName: customerName.trim(),
                phone: phone.trim(),
                customerType,
                doctor: doctor ? doctor.trim() : null,
                service: service ? service.trim() : null,
                ktvNames: cleanedKtv,
                tourCredit,
                notes: notes ? notes.trim() : null
            }).catch(err => {
                console.error('Lỗi sync tour Mini App lên sheet:', err);
            });
        }

        return {
            success: true,
            data: record,
            message: `Ghi nhận thành công ${tourCredit} công tour cho ${cleanedKtv.join(', ')}!`
        };
    }

    /** Cập nhật thông tin tour đã báo (Tab Sửa Tour). */
    async function updateTour({
        id,
        groupId,
        customerName,
        phone,
        customerType,
        doctor,
        service,
        ktvNames,
        notes,
        imageBase64,
        telegramUserId,
        updaterKtv
    }) {
        const existing = await repository.findById(id);
        if (!existing || String(existing.group_id) !== String(groupId)) {
            return { success: false, error: 'Không tìm thấy ca báo tour này hoặc không thuộc nhóm!' };
        }

        if (telegramUserId || updaterKtv) {
            const isAuthor = telegramUserId && existing.telegram_user_id && String(existing.telegram_user_id) === String(telegramUserId);
            const isKtv = updaterKtv && Array.isArray(existing.ktv_names) && existing.ktv_names.some(k => k.toLowerCase().trim() === String(updaterKtv).toLowerCase().trim());
            if (!isAuthor && !isKtv && (existing.telegram_user_id || (existing.ktv_names && existing.ktv_names.length > 0))) {
                return { success: false, error: 'Bạn chỉ có quyền sửa ca tour do chính mình báo hoặc thực hiện!' };
            }
        }

        let photoUrl = existing.photo_url;
        if (imageBase64 && imageBase64.startsWith('data:image')) {
            try {
                const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
                const imageBuffer = Buffer.from(base64Data, 'base64');
                const filename = `tour_${groupId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
                const filePath = path.join(uploadDir, filename);
                fs.writeFileSync(filePath, imageBuffer);
                photoUrl = `${publicBaseUrl}/uploads/${filename}`;
            } catch (err) {
                console.error('Lỗi cập nhật ảnh tour:', err);
            }
        }

        const cleanedKtv = Array.isArray(ktvNames) ? ktvNames.filter(Boolean) : existing.ktv_names;
        const finalCustomer = customerName ? customerName.trim() : existing.customer_name;
        const finalPhone = phone ? phone.trim() : existing.phone;
        const finalDoctor = doctor !== undefined ? doctor.trim() : existing.doctor;
        const finalService = service !== undefined ? service.trim() : existing.service;

        if (!finalCustomer || !finalPhone || !finalDoctor || !finalService || !cleanedKtv || cleanedKtv.length === 0) {
            return {
                success: false,
                error: 'Bắt buộc phải điền đủ tất cả thông tin: Tên khách, SĐT, Bác sĩ, Dịch vụ và KTV!'
            };
        }

        const tourCredit = calculateTourCredit(cleanedKtv.length);

        const updated = await repository.updateTourReport(id, {
            customerName: finalCustomer,
            phone: finalPhone,
            customerType: customerType || existing.customer_type,
            doctor: finalDoctor,
            service: finalService,
            ktvNames: cleanedKtv,
            tourCredit,
            photoUrl,
            notes: notes !== undefined ? (notes ? notes.trim() : null) : existing.notes,
            isValid: true,
            status: 'VALID'
        });

        if (tourSheetSync) {
            const reportDateStr = existing.report_date
                ? (moment ? moment(existing.report_date).format('YYYY-MM-DD') : String(existing.report_date).split('T')[0])
                : null;
            tourSheetSync.syncTourToSheet(groupId, {
                ...updated,
                reportDate: reportDateStr,
                customerName: finalCustomer,
                phone: finalPhone,
                customerType: customerType || existing.customer_type,
                doctor: finalDoctor,
                service: finalService,
                ktvNames: cleanedKtv,
                tourCredit,
                notes: notes !== undefined ? (notes ? notes.trim() : null) : existing.notes
            }).catch(err => {
                console.error('Lỗi sync cập nhật tour lên sheet:', err);
            });
        }

        return { success: true, data: updated, message: 'Cập nhật công tour thành công!' };
    }

    return {
        submitFromMiniApp,
        updateTour
    };
}
