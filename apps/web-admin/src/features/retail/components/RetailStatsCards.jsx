import { Users, CheckCircle2, Clock, MapPin } from 'lucide-react';

export default function RetailStatsCards({ summary = {} }) {
  const {
    totalMembers = 0,
    completedCount = 0,
    inProgressCount = 0,
    notStartedCount = 0,
    totalPoints = 0
  } = summary;

  const incompleteTotal = inProgressCount + notStartedCount;
  const completionRate = totalMembers > 0 ? Math.round((completedCount / totalMembers) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
      {/* 1. Tổng nhân sự */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 shadow-sm transition hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500">Tổng nhân sự</p>
            <h3 className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-black text-slate-900">
              {totalMembers} <span className="text-xs sm:text-sm font-medium text-slate-400">bạn</span>
            </h3>
          </div>
          <div className="flex h-9 w-9 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Users className="h-4 w-4 sm:h-6 sm:w-6" />
          </div>
        </div>
        <p className="mt-2 sm:mt-3 text-[11px] sm:text-xs text-slate-500 truncate">Nhân sự trong nhóm</p>
      </div>

      {/* 2. Đã hoàn thành KPI */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-white p-3.5 sm:p-5 shadow-sm transition hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-emerald-600">Đạt KPI</p>
            <h3 className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-black text-emerald-700">
              {completedCount} <span className="text-xs sm:text-sm font-medium text-emerald-500">/{totalMembers}</span>
            </h3>
          </div>
          <div className="flex h-9 w-9 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-4 w-4 sm:h-6 sm:w-6" />
          </div>
        </div>
        <div className="mt-2 sm:mt-3 flex items-center gap-1.5 sm:gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${completionRate}%` }} />
          </div>
          <span className="text-[10px] sm:text-xs font-bold text-emerald-600">{completionRate}%</span>
        </div>
      </div>

      {/* 3. Chưa đạt KPI */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-100 bg-white p-3.5 sm:p-5 shadow-sm transition hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-amber-600">Chưa đạt KPI</p>
            <h3 className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-black text-amber-700">
              {incompleteTotal} <span className="text-xs sm:text-sm font-medium text-amber-500">bạn</span>
            </h3>
          </div>
          <div className="flex h-9 w-9 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Clock className="h-4 w-4 sm:h-6 sm:w-6" />
          </div>
        </div>
        <p className="mt-2 sm:mt-3 text-[11px] sm:text-xs text-slate-500 truncate">
          <span className="font-semibold text-amber-600">{inProgressCount}</span> đang đi, <span className="font-semibold text-rose-500">{notStartedCount}</span> chưa
        </p>
      </div>

      {/* 4. Tổng điểm bán trong ngày */}
      <div className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-white p-3.5 sm:p-5 shadow-sm transition hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-indigo-600">Lượt check-in</p>
            <h3 className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-black text-indigo-700">
              {totalPoints} <span className="text-xs sm:text-sm font-medium text-indigo-500">điểm</span>
            </h3>
          </div>
          <div className="flex h-9 w-9 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <MapPin className="h-4 w-4 sm:h-6 sm:w-6" />
          </div>
        </div>
        <p className="mt-2 sm:mt-3 text-[11px] sm:text-xs text-slate-500 truncate">Toàn bộ lượt ghé hôm nay</p>
      </div>
    </div>
  );
}
