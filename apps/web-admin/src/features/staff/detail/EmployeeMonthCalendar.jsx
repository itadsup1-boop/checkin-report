import { dayBadges } from '../utils/employee-month-status.js';

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const TONES = {
  blue: 'bg-blue-50 text-blue-600', emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600', rose: 'bg-rose-50 text-rose-600', violet: 'bg-violet-50 text-violet-600'
};

export default function EmployeeMonthCalendar({ month, days, selectedDate, onSelectDate }) {
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const mondayOffset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const byDate = new Map(days.map(day => [day.date, day]));
  const cells = [...Array(mondayOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-bold text-slate-900">Lịch hoạt động trong tháng</h3><p className="mt-1 text-xs text-slate-500">Nhấn vào một ngày để xem toàn bộ check-in và báo cáo.</p></div>
      <div className="overflow-x-auto"><div className="min-w-[700px]"><div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
        {WEEKDAYS.map(day => <div key={day} className="px-2 py-3 text-center text-[10px] font-bold text-slate-500">{day}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((dayNumber, index) => {
          if (!dayNumber) return <div key={`empty-${index}`} className="min-h-28 border-b border-r border-slate-100 bg-slate-50/50" />;
          const date = `${month}-${String(dayNumber).padStart(2, '0')}`;
          const data = byDate.get(date) || { date, schedules: [], checkins: [], leaves: [], penalties: [], reports: [] };
          const badges = dayBadges(data);
          return (
            <button key={date} type="button" onClick={() => onSelectDate(date)} className={`min-h-28 border-b border-r border-slate-100 p-2 text-left transition hover:bg-blue-50/40 ${selectedDate === date ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : 'bg-white'}`}>
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${selectedDate === date ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>{dayNumber}</span>
              <div className="mt-1.5 space-y-1">
                {badges.slice(0, 3).map((badge, badgeIndex) => <div key={`${badge.label}-${badgeIndex}`} className={`truncate rounded px-1.5 py-1 text-[9px] font-semibold ${TONES[badge.tone]}`}>{badge.label}</div>)}
                {badges.length > 3 && <p className="text-[9px] font-semibold text-slate-400">+{badges.length - 3} hoạt động</p>}
              </div>
            </button>
          );
        })}
      </div></div></div>
    </section>
  );
}
