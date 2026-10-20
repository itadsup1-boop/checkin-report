import { useState, useMemo } from 'react';
import { Search, Edit2, ClipboardList, CheckCircle, Clock, AlertCircle, MapPin, Target } from 'lucide-react';

export default function RetailMembersTable({
  members = [],
  defaultKpi = 15,
  onOpenHistory,
  onOpenKpiSetting
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      const matchSearch = (m.employeeName || '').toLowerCase().includes(searchTerm.toLowerCase())
        || (m.employeeRole || '').toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchSearch) return false;

      if (statusFilter === 'COMPLETED') return m.isCompleted;
      if (statusFilter === 'IN_PROGRESS') return !m.isCompleted && m.validPoints > 0;
      if (statusFilter === 'NOT_STARTED') return m.validPoints === 0;
      return true;
    });
  }, [members, searchTerm, statusFilter]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Thanh công cụ tìm kiếm và lọc */}
      <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:p-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Bộ lọc trạng thái dạng swipeable trên mobile */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 sm:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              statusFilter === 'ALL'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Tất cả ({members.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('COMPLETED')}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              statusFilter === 'COMPLETED'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Đã đạt ({members.filter(m => m.isCompleted).length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('IN_PROGRESS')}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              statusFilter === 'IN_PROGRESS'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            Đang đi ({members.filter(m => !m.isCompleted && m.validPoints > 0).length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('NOT_STARTED')}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              statusFilter === 'NOT_STARTED'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            Chưa gửi ({members.filter(m => m.validPoints === 0).length})
          </button>
        </div>

        {/* Ô tìm kiếm */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Tìm theo tên nhân viên..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-xs font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      {/* 1. GIAO DIỆN MOBILE (< 768px): Hiển thị dạng danh sách thẻ Card chạm vuốt dễ dàng */}
      <div className="block md:hidden divide-y divide-slate-100">
        {filteredMembers.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 font-medium">
            Không tìm thấy nhân viên nào phù hợp.
          </div>
        ) : (
          filteredMembers.map((m) => {
            const target = m.targetKpi || defaultKpi;
            const percent = Math.min(100, Math.round((m.validPoints / target) * 100));

            return (
              <div key={m.employeeId} className="p-3.5 space-y-3 bg-white hover:bg-slate-50/50 transition">
                {/* Header card: Tên, avatar và huy hiệu trạng thái */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700 text-sm">
                      {m.employeeName?.slice(0, 1) || 'N'}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-sm leading-tight truncate">
                        {m.employeeName}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {m.employeeRole || 'Nhân viên'} {m.department ? `• ${m.department}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Huy hiệu trạng thái */}
                  <div className="shrink-0">
                    {m.isCompleted ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-extrabold text-emerald-700 border border-emerald-200">
                        <CheckCircle className="h-3 w-3" /> Đạt KPI
                      </span>
                    ) : m.validPoints > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-extrabold text-amber-700 border border-amber-200">
                        <Clock className="h-3 w-3" /> Thiếu {target - m.validPoints}đ
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 border border-slate-200">
                        Chưa đi
                      </span>
                    )}
                  </div>
                </div>

                {/* Thanh tiến độ KPI */}
                <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                  <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                    <span className={m.isCompleted ? 'text-emerald-700' : (m.validPoints > 0 ? 'text-amber-700' : 'text-slate-500')}>
                      Tiến độ: {m.validPoints} / {target} điểm
                    </span>
                    <span className="text-slate-500 text-[11px]">{percent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        m.isCompleted
                          ? 'bg-emerald-500'
                          : m.validPoints > 0
                          ? 'bg-amber-500'
                          : 'bg-slate-300'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>

                {/* Cửa hàng check-in gần nhất */}
                <div className="flex items-center justify-between text-xs text-slate-500 bg-white">
                  <div className="flex items-center gap-1.5 min-w-0 pr-2">
                    <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    {m.lastCheckin ? (
                      <span className="truncate font-semibold text-slate-800">
                        {m.lastCheckin.storeName}
                      </span>
                    ) : (
                      <span className="italic text-slate-400 text-[11px]">Chưa có lượt gửi</span>
                    )}
                  </div>
                  {m.lastCheckin && (
                    <span className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                      <Clock className="h-3 w-3 text-slate-400" /> {m.lastCheckin.time}
                    </span>
                  )}
                </div>

                {/* Hàng nút bấm thao tác trên Mobile (Dễ bấm bằng ngón tay) */}
                <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => onOpenKpiSetting(m)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-bold text-xs hover:bg-slate-100 active:scale-[0.98] transition"
                  >
                    <Target className="h-3.5 w-3.5 text-blue-600" />
                    <span>KPI: {target}đ {m.hasCustomKpi ? '(Riêng)' : ''}</span>
                    <Edit2 className="h-3 w-3 text-slate-400 ml-0.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenHistory(m)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-blue-600 text-white font-bold text-xs shadow-xs hover:bg-blue-700 active:scale-[0.98] transition"
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    <span>Xem lịch sử</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 2. GIAO DIỆN DESKTOP (>= 768px): Bảng Table đầy đủ cột */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/80 uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200/80">
            <tr>
              <th className="py-3.5 pl-4 pr-2 text-center w-12">STT</th>
              <th className="py-3.5 px-3">Nhân sự</th>
              <th className="py-3.5 px-3 text-center">Chỉ tiêu KPI</th>
              <th className="py-3.5 px-3">Tiến độ gửi điểm</th>
              <th className="py-3.5 px-3 text-center">Trạng thái</th>
              <th className="py-3.5 px-3">Gửi gần nhất</th>
              <th className="py-3.5 pl-3 pr-4 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan="7" className="py-10 text-center text-slate-400 font-medium">
                  Không tìm thấy nhân viên nào phù hợp.
                </td>
              </tr>
            ) : (
              filteredMembers.map((m, idx) => {
                const target = m.targetKpi || defaultKpi;
                const percent = Math.min(100, Math.round((m.validPoints / target) * 100));

                return (
                  <tr key={m.employeeId} className="hover:bg-slate-50/60 transition">
                    <td className="py-3.5 pl-4 pr-2 text-center font-bold text-slate-400">
                      {idx + 1}
                    </td>

                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
                          {m.employeeName?.slice(0, 1) || 'N'}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 leading-snug">{m.employeeName}</p>
                          <p className="text-[11px] text-slate-400">
                            {m.employeeRole || 'Nhân viên'} {m.department ? `• ${m.department}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-3 text-center">
                      <div className="inline-flex items-center gap-1.5">
                        <span className="font-extrabold text-slate-800 text-sm">
                          {target}
                        </span>
                        <span className="text-[11px] text-slate-400">điểm</span>
                        {m.hasCustomKpi && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600">
                            Riêng
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenKpiSetting(m)}
                          className="ml-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600 transition"
                          title="Sửa KPI cá nhân"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>

                    <td className="py-3.5 px-3">
                      <div className="w-36">
                        <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                          <span className={m.isCompleted ? 'text-emerald-700' : (m.validPoints > 0 ? 'text-amber-700' : 'text-slate-500')}>
                            {m.validPoints} / {target} điểm
                          </span>
                          <span className="text-slate-400">{percent}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              m.isCompleted
                                ? 'bg-emerald-500'
                                : m.validPoints > 0
                                ? 'bg-amber-500'
                                : 'bg-slate-300'
                            }`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-3 text-center">
                      {m.isCompleted ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 border border-emerald-200/60">
                          <CheckCircle className="h-3 w-3" /> Đạt KPI
                        </span>
                      ) : m.validPoints > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-extrabold text-amber-700 border border-amber-200/60">
                          <Clock className="h-3 w-3" /> Thiếu {target - m.validPoints} điểm
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500 border border-slate-200">
                          <AlertCircle className="h-3 w-3" /> Chưa check-in
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-3">
                      {m.lastCheckin ? (
                        <div className="max-w-[180px]">
                          <p className="truncate font-bold text-slate-800" title={m.lastCheckin.storeName}>
                            {m.lastCheckin.storeName}
                          </p>
                          <p className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Clock className="h-3 w-3" /> {m.lastCheckin.time}
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Chưa có lượt gửi</span>
                      )}
                    </td>

                    <td className="py-3.5 pl-3 pr-4 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenHistory(m)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition shadow-sm"
                      >
                        <ClipboardList className="h-3.5 w-3.5" /> Lịch sử
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
