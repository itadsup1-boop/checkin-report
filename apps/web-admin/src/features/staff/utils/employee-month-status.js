export const SHIFT_LABELS = {
  CA_1: 'Ca sáng',
  CA_SANG: 'Ca sáng',
  CA_2: 'Ca chiều',
  CA_CHIEU: 'Ca chiều',
  FULL_DAY: 'Cả ngày',
  HALF_DAY_PM_WORK: 'Làm buổi chiều',
  OFF: 'Nghỉ'
};

export function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
}

export function dayBadges(day) {
  const badges = [];
  const late = day.penalties.some(item => item.violation_type === 'LATE');
  const absent = day.penalties.some(item => item.violation_type === 'UNAUTHORIZED_ABSENT');
  const approvedLeave = day.leaves.some(item => item.status === 'APPROVED');
  if (day.checkins.length) badges.push({ tone: late ? 'amber' : 'emerald', label: `${formatTime(day.checkins[0].check_in_time)} Check-in` });
  if (late) badges.push({ tone: 'amber', label: `Muộn ${day.penalties.find(item => item.violation_type === 'LATE')?.late_minutes || 0} phút` });
  if (absent) badges.push({ tone: 'rose', label: 'Vắng' });
  if (approvedLeave) badges.push({ tone: 'violet', label: 'Nghỉ phép' });
  if (day.reports.length) {
    const report = day.reports[0];
    const achieved = Number(report.kpi_actual || 0) >= Number(report.kpi_required || 0);
    badges.push({ tone: achieved ? 'blue' : 'amber', label: `KPI ${report.kpi_actual || 0}/${report.kpi_required || 0}` });
  }
  return badges;
}
