/**
 * Ai chưa nộp báo cáo hôm nay — dùng chung cho cả 2 mốc của cron nhắc/phạt
 * (nhắc giờ đến hạn, và chốt sổ phạt 2 tiếng sau).
 *
 * Một nhân viên được coi là "đã xử lý" nếu đã nộp báo cáo, đang nghỉ theo lịch
 * (OFF), hoặc đã xin nghỉ phép — bất kể nguồn nào trong ba nguồn đó.
 *
 * Thuần — không pg/express/telegraf.
 */
export function findMissingReporters(employees, { reportedIds, offDutyIds, onLeaveIds }) {
    const exempted = new Set([...reportedIds, ...offDutyIds, ...onLeaveIds].filter(Boolean));
    return employees.filter(employee => !exempted.has(employee.telegram_id));
}
