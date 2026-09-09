import { Clock3, FileText, X } from 'lucide-react';
import { SHIFT_LABELS, formatMoney, formatTime } from '../utils/employee-month-status.js';

export default function DayDetailPanel({ day, onClose }) {
  if (!day) return null;
  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5">
      <div className="flex items-center justify-between">
        <div><h3 className="font-bold text-slate-900">Chi tiết ngày {day.date.split('-').reverse().join('/')}</h3><p className="mt-1 text-xs text-slate-500">Tất cả dữ liệu thuộc phạm vi nhóm đang xem.</p></div>
        <button type="button" onClick={onClose} aria-label="Đóng chi tiết ngày" className="rounded-lg p-2 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800"><Clock3 className="h-4 w-4 text-blue-600" />Chấm công</h4>
          <div className="mt-3 space-y-2 text-xs text-slate-600">
            {day.schedules.map(item => <p key={item.id}><b>{item.group_name}:</b> {SHIFT_LABELS[item.shift_type] || item.shift_type}</p>)}
            {day.checkins.map(item => <p key={item.id}><b>Check-in:</b> {formatTime(item.check_in_time)} · {item.status}</p>)}
            {day.leaves.map(item => <p key={item.id}><b>Nghỉ phép:</b> {item.request_type} · {item.status}</p>)}
            {day.penalties.map(item => <p key={item.id} className="text-rose-600"><b>{item.violation_type}:</b> {item.late_minutes || 0} phút · {formatMoney(item.amount)}</p>)}
            {!day.schedules.length && !day.checkins.length && !day.leaves.length && !day.penalties.length && <p className="text-slate-400">Không có dữ liệu chấm công.</p>}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800"><FileText className="h-4 w-4 text-violet-600" />Báo cáo KPI</h4>
          <div className="mt-3 space-y-3 text-xs text-slate-600">
            {day.reports.map(item => (
              <div key={item.id}><p><b>KPI:</b> {item.kpi_actual || 0}/{item.kpi_required || 0} · {item.status || 'Đã báo cáo'}</p><p className="mt-1 text-slate-400">Nộp lúc {formatTime(item.submitted_at)}</p></div>
            ))}
            {!day.reports.length && <p className="text-slate-400">Không có báo cáo KPI trong ngày.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
