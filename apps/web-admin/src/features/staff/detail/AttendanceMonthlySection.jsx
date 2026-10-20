import { SHIFT_LABELS, formatMoney, formatTime } from '../utils/employee-month-status.js';

export default function AttendanceMonthlySection({ attendance }) {
  const rowMap = new Map();
  const ensureRow = item => {
    const key = `${item.date}:${item.telegram_group_id}`;
    if (!rowMap.has(key)) rowMap.set(key, { key, date: item.date, telegram_group_id: item.telegram_group_id, group_name: item.group_name, shift_type: null, checkins: [], penalties: [] });
    return rowMap.get(key);
  };
  for (const schedule of attendance.schedules) Object.assign(ensureRow(schedule), schedule);
  for (const checkin of attendance.checkins) ensureRow(checkin).checkins.push(checkin);
  for (const penalty of attendance.penalties) ensureRow(penalty).penalties.push(penalty);
  const rows = [...rowMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-bold text-slate-900">Chi tiết chấm công</h3></div>
      {!attendance.enabled ? <p className="px-5 py-8 text-center text-sm text-slate-500">Nhân viên này đang được miễn check-in.</p> : rows.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-500">Không có lịch làm việc trong tháng.</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-5 py-3">Ngày</th><th className="px-4 py-3">Nhóm</th><th className="px-4 py-3">Ca</th><th className="px-4 py-3">Check-in</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3 text-right">Tiền phạt</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(row => {
            const late = row.penalties.find(item => item.violation_type === 'LATE');
            const absent = row.penalties.find(item => item.violation_type === 'UNAUTHORIZED_ABSENT');
            return <tr key={row.key} className="hover:bg-slate-50"><td className="px-5 py-3 font-semibold text-slate-800">{row.date.split('-').reverse().join('/')}</td><td className="px-4 py-3 text-slate-500">{row.group_name}</td><td className="px-4 py-3">{SHIFT_LABELS[row.shift_type] || row.shift_type || 'Không có lịch'}</td><td className="px-4 py-3">{row.checkins.map(item => formatTime(item.check_in_time)).join(', ') || '—'}</td><td className={`px-4 py-3 font-semibold ${absent ? 'text-rose-600' : late ? 'text-amber-600' : row.checkins.length ? 'text-emerald-600' : 'text-slate-400'}`}>{absent ? 'Vắng' : late ? `Muộn ${late.late_minutes || 0} phút` : row.checkins.length ? 'Đã check-in' : row.shift_type === 'OFF' ? 'Nghỉ' : 'Chưa check-in'}</td><td className="px-4 py-3 text-right font-semibold text-rose-600">{formatMoney(row.penalties.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</td></tr>;
          })}</tbody></table></div>
      )}
    </section>
  );
}
