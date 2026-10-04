function displayDate(value) {
    const [year, month, day] = String(value).slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
}

export function validateHolidayInput(input) {
    const name = String(input.name || '').trim();
    const startDate = String(input.start_date || '').slice(0, 10);
    const endDate = String(input.end_date || input.start_date || '').slice(0, 10);
    if (!name) throw new Error('Vui lòng nhập tên kỳ nghỉ.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        throw new Error('Ngày bắt đầu hoặc ngày kết thúc không hợp lệ.');
    }
    if (endDate < startDate) throw new Error('Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.');
    return { name, startDate, endDate, note: String(input.note || '').trim() };
}

export function buildHolidayAnnouncement(holiday) {
    const start = String(holiday.start_date).slice(0, 10);
    const end = String(holiday.end_date).slice(0, 10);
    const range = start === end
        ? `Hôm nay, ngày <b>${displayDate(start)}</b>, là ngày nghỉ toàn công ty.`
        : `Thời gian nghỉ: từ ngày <b>${displayDate(start)}</b> đến hết ngày <b>${displayDate(end)}</b>.`;
    const title = start === end ? '🏖 <b>THÔNG BÁO NGÀY NGHỈ TOÀN CÔNG TY</b>' : '🏖 <b>THÔNG BÁO KỲ NGHỈ TOÀN CÔNG TY</b>';
    const note = holiday.note ? `\n📝 ${holiday.note}` : '';
    return `${title}\n${range}\nToàn bộ nhân viên không cần check-in và không phải gửi báo cáo KPI.\nHệ thống không tính vắng mặt, đi muộn hoặc thiếu báo cáo trong thời gian này.${note}`;
}
