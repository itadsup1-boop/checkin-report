import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

export default function MonthNavigator({ month, onChange }) {
  const shift = delta => {
    const [year, monthNumber] = month.split('-').map(Number);
    const date = new Date(year, monthNumber - 1 + delta, 1);
    onChange(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><CalendarDays className="h-5 w-5 text-blue-600" />Dữ liệu theo tháng</div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <button type="button" onClick={() => shift(-1)} aria-label="Tháng trước" className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
        <input type="month" value={month} onChange={event => onChange(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-blue-400 sm:flex-none sm:px-3" />
        <button type="button" onClick={() => shift(1)} aria-label="Tháng sau" className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
