const TONES = {
  blue: 'border-blue-100 bg-blue-50 text-blue-600',
  emerald: 'border-emerald-100 bg-emerald-50 text-emerald-600',
  amber: 'border-amber-100 bg-amber-50 text-amber-600',
  rose: 'border-rose-100 bg-rose-50 text-rose-600',
  violet: 'border-violet-100 bg-violet-50 text-violet-600'
};

export default function MonthlySummaryCards({ items }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
      {items.map(({ label, value, icon: Icon, tone = 'blue' }) => (
        <div key={label} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl border ${TONES[tone]}`}><Icon className="h-4 w-4" /></div>
          <p className="text-[11px] font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
        </div>
      ))}
    </div>
  );
}
