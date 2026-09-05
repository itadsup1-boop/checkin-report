/**
 * Soạn thảo nội dung tin nhắn Telegram gửi vào nhóm cho module Retail Check-in.
 */

export function buildCheckinSuccessMessage({
    employeeName,
    storeName,
    storeAddress,
    timeStr,
    currentPoints,
    targetPoints = 15,
    remainingPoints,
    completed
}) {
    let statusText = '';
    if (completed) {
        if (currentPoints === targetPoints) {
            statusText = `🎉 <b>CHÚC MỪNG! BẠN ĐÃ HOÀN THÀNH 100% KPI HÔM NAY (${currentPoints}/${targetPoints})!</b>`;
        } else {
            statusText = `🔥 <b>XUẤT SẮC! BẠN ĐÃ VƯỢT CHỈ TIÊU (${currentPoints}/${targetPoints})!</b>`;
        }
    } else {
        statusText = `🎯 <b>Tiến độ hôm nay:</b> <code>${currentPoints}/${targetPoints}</code> điểm\n⏳ Còn thiếu: <b>${remainingPoints} điểm</b> nữa để hoàn thành KPI.`;
    }

    return (
        `📍 <b>XÁC NHẬN CHECK-IN ĐIỂM BÁN HỢP LỆ</b>\n\n` +
        `👤 <b>Nhân viên:</b> ${employeeName}\n` +
        `🏪 <b>Điểm bán:</b> ${storeName}\n` +
        `📫 <b>Địa chỉ:</b> ${storeAddress}\n` +
        `⏰ <b>Thời gian:</b> ${timeStr}\n\n` +
        `${statusText}\n\n` +
        `<i>Hệ thống đã tự động ghi nhận và đồng bộ dữ liệu vào bảng theo dõi.</i>`
    );
}

export function buildCheckinErrorMessage({ employeeName, reason, formatHelp = true }) {
    let msg = `⚠️ <b>CHECK-IN CHƯA ĐƯỢC GHI NHẬN</b>\n\n` +
              `👤 <b>Nhân sự:</b> ${employeeName || 'Bạn'}\n` +
              `❌ <b>Lý do:</b> ${reason}\n\n`;

    if (formatHelp) {
        msg += `💡 <b>Cú pháp chuẩn yêu cầu:</b>\n` +
               `<code>[Tên điểm bán] - [Địa chỉ chi tiết]</code>\n` +
               `<i>(Ví dụ: Tạp hóa Minh Phát - 123 Nguyễn Trãi)</i>\n` +
               `Kèm tối thiểu <b>02 ảnh</b>: 1 ảnh selfie cổng + 1 ảnh sản phẩm bên trong.`;
    }

    return msg;
}

export function buildSpamIntervalWarningMessage({ employeeName, waitSeconds }) {
    return (
        `⚠️ <b>CẢNH BÁO GỬI CHECK-IN QUÁ NHANH</b>\n\n` +
        `👤 <b>Nhân sự:</b> ${employeeName}\n` +
        `Khoảng cách giữa 2 điểm bán quá ngắn. Quy định yêu cầu check-in thời gian thực (real-time) tại từng điểm bán khi di chuyển trên tuyến.\n` +
        `Vui lòng đợi ít nhất <b>${waitSeconds} giây</b> nữa trước khi gửi điểm tiếp theo.`
    );
}

export function buildDuplicatePhotoWarningMessage({ employeeName }) {
    return (
        `🚨 <b>PHÁT HIỆN ẢNH TRÙNG LẶP</b>\n\n` +
        `👤 <b>Nhân sự:</b> ${employeeName}\n` +
        `Ảnh chụp bạn vừa gửi trùng với ảnh đã được sử dụng trong các ngày trước.\n` +
        `Quy định bắt buộc chụp ảnh thực tế mới 100% tại điểm bán trong ca làm việc hôm nay.`
    );
}

export function buildDailySummaryMessage({ dateStr, results }) {
    let text = `📊 <b>TỔNG KẾT KPI ĐI TUYẾN NGÀY ${dateStr} (CHỐT 18:00)</b>\n\n`;

    const completedList = results.filter(r => r.isCompleted);
    const incompleteList = results.filter(r => !r.isCompleted);

    text += `🏆 <b>HOÀN THÀNH CHỈ TIÊU (${completedList.length} nhân sự):</b>\n`;
    if (completedList.length > 0) {
        completedList.forEach((item, index) => {
            text += `${index + 1}. ${item.employeeName}: <b>${item.validPoints}/15 điểm</b> ✅\n`;
        });
    } else {
        text += `<i>(Chưa có nhân sự nào hoàn thành)</i>\n`;
    }

    text += `\n⚠️ <b>CHƯA ĐỦ CHỈ TIÊU (${incompleteList.length} nhân sự):</b>\n`;
    if (incompleteList.length > 0) {
        incompleteList.forEach((item, index) => {
            const missing = Math.max(0, 15 - item.validPoints);
            text += `${index + 1}. ${item.employeeName}: ${item.validPoints}/15 điểm (Thiếu ${missing}) ❌\n`;
        });
    } else {
        text += `<i>(Tất cả nhân sự đều đã hoàn thành xuất sắc!)</i>\n`;
    }

    text += `\n<i>Báo cáo đã được lưu trữ tự động vào cơ sở dữ liệu và bảng tính quản lý.</i>`;
    return text;
}

export function buildAfternoonProgressReminderMessage({ dateStr, reminders }) {
    let text = `⏰ <b>NHẮC NHỞ TIẾN ĐỘ ĐIỂM BÁN (16:00 - ${dateStr})</b>\n\n` +
               `Thời gian làm việc còn <b>02 tiếng</b> nữa (kết thúc lúc 18:00).\n` +
               `Danh sách các bạn cần đẩy nhanh tiến độ hoàn thành 15 điểm:\n\n`;

    reminders.forEach((r, idx) => {
        text += `${idx + 1}. ${r.employeeName}: Đã đạt <b>${r.validPoints}/15</b> (Còn thiếu ${15 - r.validPoints} điểm)\n`;
    });

    text += `\n💪 <i>Các bạn cố gắng hoàn thành chỉ tiêu để tính đủ công ngày nhé!</i>`;
    return text;
}
