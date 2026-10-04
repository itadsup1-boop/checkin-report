import { useState, useEffect, useCallback } from 'react';
import { Store, Calendar, RefreshCw, AlertCircle, Users, BarChart3, CalendarDays } from 'lucide-react';
import { retailApi } from './services/retailApi.js';
import RetailStatsCards from './components/RetailStatsCards.jsx';
import RetailMonthlyStatsCards from './components/RetailMonthlyStatsCards.jsx';
import RetailMembersTable from './components/RetailMembersTable.jsx';
import RetailMonthlyTable from './components/RetailMonthlyTable.jsx';
import MemberHistoryModal from './components/MemberHistoryModal.jsx';
import KpiSettingModal from './components/KpiSettingModal.jsx';

export default function RetailManagement({
  selectedGroupId,
  groups = []
}) {
  const [viewMode, setViewMode] = useState('DAILY'); // 'DAILY' | 'MONTHLY'
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Modals state
  const [historyEmployee, setHistoryEmployee] = useState(null);
  const [kpiEmployee, setKpiEmployee] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Lấy nhóm hiện tại
  const currentGroup = groups.find(g => 
    g.telegram_group_id === selectedGroupId || g.id === selectedGroupId
  ) || groups[0];

  const fetchData = useCallback(async () => {
    if (!currentGroup) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (viewMode === 'DAILY') {
        const res = await retailApi.getOverview({
          groupId: currentGroup.telegram_group_id,
          date
        });
        setData(res);
      } else {
        const res = await retailApi.getMonthlyOverview({
          groupId: currentGroup.telegram_group_id,
          month
        });
        setData(res);
      }
    } catch (err) {
      console.error('Lỗi tải dữ liệu check-in thị trường:', err);
      setError(err.response?.data?.error || err.message || 'Không thể tải dữ liệu.');
    } finally {
      setLoading(false);
    }
  }, [currentGroup, viewMode, date, month]);

  useEffect(() => {
    const timer = window.setTimeout(fetchData, 0);
    return () => window.clearTimeout(timer);
  }, [fetchData]);

  const handleSaveKpi = async (employeeId, dailyKpiTarget) => {
    if (!currentGroup) return;
    await retailApi.updateMemberKpi(employeeId, {
      telegramGroupId: currentGroup.telegram_group_id,
      dailyKpiTarget
    });
    showToast('✅ Đã cập nhật chỉ tiêu KPI thành công!');
    await fetchData();
  };

  if (!groups || groups.length === 0) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <Store className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-lg font-bold text-slate-900">Chưa có nhóm Check-in Thị trường</h3>
          <p className="mt-2 text-xs text-slate-500 leading-relaxed">
            Hệ thống chưa tìm thấy nhóm Telegram nào có vai trò <strong>Check-in thị trường (retail_checkin)</strong> được gán cho tài khoản này.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Thanh tiêu đề & Chế độ xem & Bộ lọc thời gian */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-tight">Check-in Tuyến Thị Trường</h2>
              <p className="text-xs text-slate-500 line-clamp-1 sm:line-clamp-none">
                Theo dõi tiến độ, kiểm tra các điểm bán và thiết lập chỉ tiêu KPI cho nhân viên
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Chuyển đổi chế độ xem: Theo ngày vs Tổng quát cả tháng */}
          <div className="flex items-center rounded-xl bg-slate-100 p-1 border border-slate-200/80">
            <button
              type="button"
              onClick={() => setViewMode('DAILY')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs font-bold transition ${
                viewMode === 'DAILY'
                  ? 'bg-white text-blue-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Theo Ngày</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('MONTHLY')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs font-bold transition ${
                viewMode === 'MONTHLY'
                  ? 'bg-white text-blue-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Cả Tháng</span>
            </button>
          </div>

          {/* Chọn ngày hoặc chọn tháng */}
          {viewMode === 'DAILY' ? (
            <div className="flex flex-1 sm:flex-initial items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-2xs">
              <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full border-none bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
              />
            </div>
          ) : (
            <div className="flex flex-1 sm:flex-initial items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-2xs">
              <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                type="month"
                value={month}
                onChange={e => setMonth(e.target.value)}
                className="w-full border-none bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
              />
            </div>
          )}

          {/* Nút làm mới */}
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 sm:px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition shadow-2xs disabled:opacity-50 shrink-0"
            title="Làm mới dữ liệu"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
            <span className="hidden sm:inline">Làm mới</span>
          </button>
        </div>
      </div>

      {/* Thông tin nhóm đang xem */}
      {currentGroup && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100/80 p-3 sm:px-4 sm:py-2.5 text-xs">
          <div className="flex items-center gap-2 text-slate-700 min-w-0">
            <Users className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="truncate">Đang xem: <strong className="text-slate-900 font-bold">{currentGroup.group_name}</strong></span>
          </div>
          <div className="text-slate-500 font-medium text-[11px] sm:text-xs">
            Giờ làm: <strong className="text-slate-800 font-bold">08:30 – 18:00</strong> • KPI mặc định: <strong className="text-blue-700 font-bold">{data?.group?.defaultKpi || 15}đ/ngày</strong>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 sm:p-4 text-xs font-medium text-rose-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Thẻ thống kê: Hằng ngày hoặc Cả tháng */}
      {viewMode === 'DAILY' ? (
        <RetailStatsCards summary={data?.summary} />
      ) : (
        <RetailMonthlyStatsCards summary={data?.summary} />
      )}

      {/* Bảng tiến độ nhân viên */}
      <div>
        <div className="mb-2.5 sm:mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <h3 className="text-xs sm:text-sm font-bold text-slate-900 uppercase tracking-wide">
            {viewMode === 'DAILY' ? `Tiến độ đi tuyến ngày ${date}` : `Tổng quan kết quả tháng ${month}`}
          </h3>
          <span className="text-[11px] sm:text-xs text-slate-400">
            {viewMode === 'DAILY' ? 'Cập nhật theo thời gian thực' : 'Tổng hợp toàn bộ buổi đi trong tháng'}
          </span>
        </div>

        {viewMode === 'DAILY' ? (
          <RetailMembersTable
            members={data?.members || []}
            defaultKpi={data?.group?.defaultKpi || 15}
            onOpenHistory={(m) => setHistoryEmployee(m)}
            onOpenKpiSetting={(m) => setKpiEmployee(m)}
          />
        ) : (
          <RetailMonthlyTable
            members={data?.members || []}
            defaultKpi={data?.group?.defaultKpi || 15}
            onOpenHistory={(m) => setHistoryEmployee(m)}
            onOpenKpiSetting={(m) => setKpiEmployee(m)}
          />
        )}
      </div>

      {/* Modal Lịch sử chi tiết thành viên */}
      {historyEmployee && (
        <MemberHistoryModal
          employee={historyEmployee}
          groupId={currentGroup?.id}
          defaultKpi={data?.group?.defaultKpi || 15}
          initialMonth={viewMode === 'MONTHLY' ? month : undefined}
          onClose={() => setHistoryEmployee(null)}
          onOpenKpiSetting={(m) => {
            setKpiEmployee(m);
          }}
        />
      )}

      {/* Modal Sửa KPI thành viên */}
      {kpiEmployee && (
        <KpiSettingModal
          employee={kpiEmployee}
          defaultKpi={data?.group?.defaultKpi || 15}
          onSave={handleSaveKpi}
          onClose={() => setKpiEmployee(null)}
        />
      )}

      {/* Toast thông báo */}
      {toast && (
        <div className="fixed bottom-5 left-4 right-4 sm:left-auto sm:right-5 sm:w-auto text-center sm:text-left z-50 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-2xl animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
