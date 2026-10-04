import { Users, TrendingUp, MapPin, CalendarDays } from 'lucide-react';

export default function RetailMonthlyStatsCards({ summary = {} }) {
  const {
    totalMembers = 0,
    totalPoints = 0,
    totalWorkDays = 0,
    totalCompletedDays = 0,
    overallCompletionRate = 0,
    activeMembersCount = 0
  } = summary;

  const incompleteDays = Math.max(0, totalWorkDays - totalCompletedDays);

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
      {/* 1. Tổng điểm cả tháng */}
      <div className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-white p-3.5 sm:p-5 shadow-sm transition hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-indigo-600">Tổng điểm cả tháng</p>
            <h3 className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-black text-indigo-700">
              {totalPoints} <span className="text-xs sm:text-sm font-medium text-indigo-500">điểm</span>
            </h3>
          </div>
          <div className="flex h-9 w-9 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <MapPin className="h-4 w-4 sm:h-6 sm:w-6" />
          </div>
        </div>
        <p className="mt-2 sm:mt-3 text-[11px] sm:text-xs text-slate-500 truncate">Tổng lượt ghé toàn nhóm</p>
      </div>

      {/* 2. Tỷ lệ hoàn thành KPI */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-white p-3.5 sm:p-5 shadow-sm transition hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-emerald-600">Tỷ lệ đạt KPI tháng</p>
            <h3 className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-black text-emerald-700">
              {overallCompletionRate}%
            </h3>
          </div>
          <div className="flex h-9 w-9 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <TrendingUp className="h-4 w-4 sm:h-6 sm:w-6" />
          </div>
        </div>
        <div className="mt-2 sm:mt-3 flex items-center gap-1.5 sm:gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${overallCompletionRate}%` }} />
          </div>
          <span className="text-[10px] sm:text-xs font-bold text-emerald-600">{totalCompletedDays}/{totalWorkDays} buổi</span>
        </div>
      </div>

      {/* 3. Tổng buổi ĐỦ vs THIẾU */}
      <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-white p-3.5 sm:p-5 shadow-sm transition hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-blue-600">Tổng buổi đi tuyến</p>
            <h3 className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-black text-blue-700">
              {totalWorkDays} <span className="text-xs sm:text-sm font-medium text-blue-500">buổi</span>
            </h3>
          </div>
          <div className="flex h-9 w-9 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <CalendarDays className="h-4 w-4 sm:h-6 sm:w-6" />
          </div>
        </div>
        <p className="mt-2 sm:mt-3 text-[11px] sm:text-xs text-slate-500 truncate">
          <span className="font-semibold text-emerald-600">{totalCompletedDays} ĐỦ</span> • <span className="font-semibold text-rose-500">{incompleteDays} THIẾU</span>
        </p>
      </div>

      {/* 4. Nhân sự hoạt động */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 shadow-sm transition hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500">Nhân sự có tuyến</p>
            <h3 className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-black text-slate-900">
              {activeMembersCount} <span className="text-xs sm:text-sm font-medium text-slate-400">/{totalMembers}</span>
            </h3>
          </div>
          <div className="flex h-9 w-9 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <Users className="h-4 w-4 sm:h-6 sm:w-6" />
          </div>
        </div>
        <p className="mt-2 sm:mt-3 text-[11px] sm:text-xs text-slate-500 truncate">Có phát sinh check-in trong tháng</p>
      </div>
    </div>
  );
}
