import { useState, useMemo } from 'react';
import { Search, ClipboardList, Target, ChevronRight, Edit2 } from 'lucide-react';

export default function RetailMonthlyTable({
  members = [],
  defaultKpi = 15,
  onOpenHistory,
  onOpenKpiSetting
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      const matchSearch = (m.employeeName || '').toLowerCase().includes(searchTerm.toLowerCase())
        || (m.employeeRole || '').toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchSearch) return false;

      if (filterType === 'ACTIVE') return m.totalWorkDays > 0;
      if (filterType === 'GOOD') return m.totalWorkDays > 0 && m.completionRate >= 80;
      if (filterType === 'ATTENTION') return m.incompleteDays > 0;
      if (filterType === 'INACTIVE') return m.totalWorkDays === 0;
      return true;
    });
  }, [members, searchTerm, filterType]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Thanh công cụ tìm kiếm và bộ lọc */}
      <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:p-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Bộ lọc trạng thái swipeable */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 sm:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setFilterType('ALL')}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              filterType === 'ALL'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Tất cả ({members.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('ACTIVE')}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              filterType === 'ACTIVE'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            Có đi tuyến ({members.filter(m => m.totalWorkDays > 0).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('GOOD')}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              filterType === 'GOOD'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Đạt tốt ≥80% ({members.filter(m => m.totalWorkDays > 0 && m.completionRate >= 80).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('ATTENTION')}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              filterType === 'ATTENTION'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            Có buổi thiếu ({members.filter(m => m.incompleteDays > 0).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('INACTIVE')}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              filterType === 'INACTIVE'
                ? 'bg-slate-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            Chưa đi ({members.filter(m => m.totalWorkDays === 0).length})
          </button>
        </div>

        {/* Ô tìm kiếm */}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo tên, vai trò…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:bg-white"
          />
        </div>
      </div>

      {/* 1. GIAO DIỆN DESKTOP (Bảng đầy đủ) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3 px-4">Thành viên</th>
              <th className="py-3 px-3">KPI ngày</th>
              <th className="py-3 px-3 text-center">Buổi đi</th>
              <th className="py-3 px-3 text-center">ĐỦ</th>
              <th className="py-3 px-3 text-center">THIẾU</th>
              <th className="py-3 px-3 text-center">Tổng điểm tháng</th>
              <th className="py-3 px-3">Tỷ lệ đạt</th>
              <th className="py-3 px-4 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400">
                  Không tìm thấy nhân sự phù hợp với điều kiện tìm kiếm.
                </td>
              </tr>
            ) : (
              filteredMembers.map((m) => (
                <tr key={m.employeeId} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 font-bold text-white shadow-2xs">
                        {m.employeeName?.slice(0, 1) || 'N'}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">{m.employeeName}</div>
                        <div className="text-[11px] text-slate-400">
                          {m.employeeRole || 'Nhân sự thị trường'}
                          {m.department ? ` • ${m.department}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-700">{m.targetKpi || defaultKpi}đ</span>
                      {m.hasCustomKpi && (
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-extrabold text-indigo-600">
                          Riêng
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="py-3 px-3 text-center">
                    <span className="font-bold text-slate-800">{m.totalWorkDays}</span>
                  </td>

                  <td className="py-3 px-3 text-center">
                    <span className="inline-flex items-center justify-center rounded-lg bg-emerald-50 px-2 py-0.5 font-black text-emerald-700">
                      {m.completedDays}
                    </span>
                  </td>

                  <td className="py-3 px-3 text-center">
                    <span className={`inline-flex items-center justify-center rounded-lg px-2 py-0.5 font-black ${
                      m.incompleteDays > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {m.incompleteDays}
                    </span>
                  </td>

                  <td className="py-3 px-3 text-center">
                    <span className="font-black text-indigo-700 text-sm">{m.totalPoints}</span>
                  </td>

                  <td className="py-3 px-3">
                    <div className="w-28">
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="font-bold text-slate-700">{m.completionRate}%</span>
                        <span className="text-[10px] text-slate-400">{m.completedDays}/{m.totalWorkDays || 0}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            m.completionRate >= 80 ? 'bg-emerald-500' : m.completionRate >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                          style={{ width: `${m.completionRate}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenKpiSetting(m)}
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                        title="Đổi chỉ tiêu KPI"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenHistory(m)}
                        className="inline-flex items-center gap-1 rounded-xl bg-blue-50 px-2.5 py-1.5 font-bold text-blue-700 hover:bg-blue-100 active:bg-blue-200 transition"
                      >
                        <ClipboardList className="h-3.5 w-3.5" />
                        <span>Xem chi tiết</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 2. GIAO DIỆN MOBILE (Dạng thẻ Touch-Friendly) */}
      <div className="md:hidden divide-y divide-slate-100 p-2.5 space-y-2.5">
        {filteredMembers.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">
            Không tìm thấy nhân sự phù hợp.
          </div>
        ) : (
          filteredMembers.map((m) => (
            <div
              key={m.employeeId}
              className="rounded-2xl border border-slate-100 bg-white p-3.5 shadow-2xs space-y-3"
            >
              {/* Header thẻ: Avatar, Tên, Role & KPI */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 font-black text-white text-sm shadow-sm">
                    {m.employeeName?.slice(0, 1) || 'N'}
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-black text-slate-900 text-sm truncate leading-tight">
                      {m.employeeName}
                    </h4>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500">
                      <span>{m.employeeRole || 'Nhân sự'}</span>
                      <span>•</span>
                      <span className="font-bold text-slate-700">KPI: {m.targetKpi || defaultKpi}đ/ngày</span>
                      {m.hasCustomKpi && (
                        <span className="rounded bg-indigo-50 px-1 text-[9px] font-extrabold text-indigo-600">
                          Riêng
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenKpiSetting(m)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 active:bg-slate-100"
                  title="Sửa KPI"
                >
                  <Target className="h-4 w-4" />
                </button>
              </div>

              {/* Grid 4 chỉ số tháng */}
              <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
                <div className="rounded-xl bg-slate-50 p-2 border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-medium">Buổi đi</div>
                  <div className="font-bold text-slate-800 text-sm mt-0.5">{m.totalWorkDays}</div>
                </div>
                <div className="rounded-xl bg-emerald-50 p-2 border border-emerald-100 text-emerald-700">
                  <div className="text-[10px] text-emerald-600 font-medium">ĐỦ</div>
                  <div className="font-black text-sm mt-0.5">{m.completedDays}</div>
                </div>
                <div className={`rounded-xl p-2 border ${
                  m.incompleteDays > 0 
                    ? 'bg-rose-50 border-rose-100 text-rose-700' 
                    : 'bg-slate-50 border-slate-100 text-slate-500'
                }`}>
                  <div className="text-[10px] font-medium">THIẾU</div>
                  <div className="font-black text-sm mt-0.5">{m.incompleteDays}</div>
                </div>
                <div className="rounded-xl bg-indigo-50 p-2 border border-indigo-100 text-indigo-700">
                  <div className="text-[10px] text-indigo-600 font-medium">Tổng điểm</div>
                  <div className="font-black text-sm mt-0.5">{m.totalPoints}</div>
                </div>
              </div>

              {/* Thanh tiến độ đạt KPI */}
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-500 font-medium">Tỷ lệ đạt KPI:</span>
                  <span className="font-black text-slate-800">{m.completionRate}% ({m.completedDays}/{m.totalWorkDays || 0} buổi)</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      m.completionRate >= 80 ? 'bg-emerald-500' : m.completionRate >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${m.completionRate}%` }}
                  />
                </div>
              </div>

              {/* Nút xem chi tiết lịch sử cả tháng */}
              <button
                type="button"
                onClick={() => onOpenHistory(m)}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-blue-50 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 active:bg-blue-200 transition"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                <span>Xem chi tiết lịch sử tháng</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
