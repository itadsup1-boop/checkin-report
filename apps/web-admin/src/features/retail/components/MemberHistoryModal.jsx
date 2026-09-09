import { useState, useEffect, useCallback } from 'react';
import { X, Calendar, CheckCircle, AlertCircle, ChevronDown, ChevronUp, MapPin, Clock, Target, FolderOpen, ExternalLink } from 'lucide-react';
import { retailApi } from '../services/retailApi.js';

export default function MemberHistoryModal({
  employee,
  groupId,
  defaultKpi = 15,
  initialMonth,
  onClose,
  onOpenKpiSetting
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(() => {
    if (initialMonth) return initialMonth;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [expandedDates, setExpandedDates] = useState({});

  const fetchHistory = useCallback(async () => {
    if (!employee?.employeeId) return;
    setLoading(true);
    try {
      const res = await retailApi.getMemberHistory(employee.employeeId, {
        groupId,
        month
      });
      setData(res);
      // Auto expand the most recent work date
      if (res?.days?.length > 0) {
        setExpandedDates({ [res.days[0].date]: true });
      }
    } catch (err) {
      console.error('Lỗi khi tải lịch sử nhân viên:', err);
    } finally {
      setLoading(false);
    }
  }, [employee, groupId, month]);

  useEffect(() => {
    if (!employee) return;
    const timer = window.setTimeout(fetchHistory, 0);
    return () => window.clearTimeout(timer);
  }, [employee, fetchHistory]);

  const toggleExpand = (dateStr) => {
    setExpandedDates(prev => ({
      ...prev,
      [dateStr]: !prev[dateStr]
    }));
  };

  const stats = data?.stats || {
    totalWorkDays: 0,
    completedDays: 0,
    incompleteDays: 0,
    totalPoints: 0
  };

  if (!employee) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-0 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full sm:h-auto sm:max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-none sm:rounded-3xl bg-white shadow-2xl transition"
        onClick={e => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="flex items-center justify-between border-b border-slate-100 p-4 sm:p-5">
          <div className="flex items-center gap-3 min-w-0 pr-2">
            <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 font-black text-white text-sm sm:text-base shadow-md">
              {employee.employeeName?.slice(0, 1) || 'N'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight truncate">
                  {employee.employeeName}
                </h3>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] sm:text-[11px] font-bold text-slate-600 shrink-0">
                  {employee.employeeRole || 'Nhân sự thị trường'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] sm:text-xs text-slate-500">
                <span>Chỉ tiêu: <strong className="text-slate-800">{employee.targetKpi || defaultKpi} điểm</strong></span>
                {employee.hasCustomKpi && (
                  <span className="rounded bg-indigo-50 px-1.5 py-0.2 text-[10px] font-extrabold text-indigo-600">
                    Riêng
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onOpenKpiSetting(employee)}
                  className="text-blue-600 hover:underline font-bold text-[11px] inline-flex items-center gap-0.5 ml-0.5"
                >
                  <Target className="h-3 w-3" /> Đổi KPI
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 active:bg-slate-300"
            aria-label="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Thanh điều khiển tháng & Thống kê */}
        <div className="border-b border-slate-100 bg-slate-50/70 p-3 sm:p-4">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-slate-500 shrink-0" />
              <span className="text-xs font-bold text-slate-700 shrink-0">Tháng:</span>
              <input
                type="month"
                value={month}
                onChange={e => setMonth(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:flex sm:items-center sm:gap-2 text-xs">
              <div className="rounded-xl bg-white border border-slate-200/80 px-2.5 py-1 sm:px-3 sm:py-1.5 shadow-2xs">
                <span className="text-slate-400 font-medium text-[11px] sm:text-xs">Buổi đi: </span>
                <strong className="text-slate-800">{stats.totalWorkDays}</strong>
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-2.5 py-1 sm:px-3 sm:py-1.5 text-emerald-700 shadow-2xs">
                <span className="font-medium text-[11px] sm:text-xs">ĐỦ: </span>
                <strong className="font-black">{stats.completedDays}</strong>
              </div>
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-2.5 py-1 sm:px-3 sm:py-1.5 text-rose-700 shadow-2xs">
                <span className="font-medium text-[11px] sm:text-xs">THIẾU: </span>
                <strong className="font-black">{stats.incompleteDays}</strong>
              </div>
              <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-2.5 py-1 sm:px-3 sm:py-1.5 text-indigo-700 shadow-2xs">
                <span className="font-medium text-[11px] sm:text-xs">Tổng điểm: </span>
                <strong className="font-black">{stats.totalPoints}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Danh sách các ngày đi làm */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {loading ? (
            <div className="py-16 text-center text-sm text-slate-400">
              Đang tải lịch sử các buổi check-in…
            </div>
          ) : !data?.days || data.days.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-bold text-slate-700">Chưa có lượt check-in nào trong tháng {month}</p>
              <p className="text-xs text-slate-400 mt-1">Khi nhân viên đi tuyến và gửi báo cáo, dữ liệu sẽ hiển thị chi tiết tại đây.</p>
            </div>
          ) : (
            data.days.map((day) => {
              const isExpanded = Boolean(expandedDates[day.date]);

              return (
                <div
                  key={day.date}
                  className={`overflow-hidden rounded-2xl border transition ${
                    day.isCompleted
                      ? 'border-slate-200 bg-white shadow-2xs'
                      : 'border-rose-200/80 bg-rose-50/20'
                  }`}
                >
                  {/* Thanh tóm tắt ngày */}
                  <div
                    onClick={() => toggleExpand(day.date)}
                    className="flex items-center justify-between p-3.5 sm:p-4 cursor-pointer hover:bg-slate-50/60 transition select-none"
                  >
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 pr-2">
                      <div
                        className={`flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl font-black text-xs sm:text-sm ${
                          day.isCompleted
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {day.isCompleted ? <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5" /> : <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs sm:text-sm font-black text-slate-900">{day.date}</span>
                        </div>
                        <div className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                          {day.checkins?.length || 0} điểm bán đã ghé
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] sm:text-xs font-black ${
                          day.isCompleted
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        <span className="hidden sm:inline">{day.isCompleted ? 'ĐỦ' : 'THIẾU'} ({day.validPoints}/{day.targetPoints} điểm)</span>
                        <span className="sm:hidden">{day.isCompleted ? 'ĐỦ' : 'THIẾU'} {day.validPoints}/{day.targetPoints}đ</span>
                      </span>
                      <button type="button" className="text-slate-400 p-1">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Chi tiết các điểm bán trong ngày */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-3 sm:p-4">
                      {/* Thư mục Drive ảnh cả ngày */}
                      {day.driveFolderUrl && (
                        <div className="mb-3 flex items-center justify-between rounded-xl border border-blue-200/80 bg-blue-50/80 p-2.5 sm:px-3.5 sm:py-2">
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            <FolderOpen className="h-4 w-4 text-blue-600 shrink-0" />
                            <span className="text-xs text-blue-950 font-semibold truncate">
                              Thư mục ảnh ngày <strong>{day.date}</strong>
                            </span>
                          </div>
                          <a
                            href={day.driveFolderUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 active:scale-95 transition shadow-2xs shrink-0"
                          >
                            <span>Mở Drive</span>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      )}

                      {day.checkins?.length === 0 ? (
                        <p className="text-xs italic text-slate-400 py-2">
                          Không có chi tiết điểm bán hợp lệ nào được lưu cho ngày này.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {day.checkins.map((c, cIdx) => (
                            <div
                              key={c.id || cIdx}
                              className="rounded-xl border border-slate-200 bg-white p-3 sm:p-3.5 shadow-2xs"
                            >
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-black text-blue-700">
                                    {cIdx + 1}
                                  </span>
                                  <h5 className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                                    {c.storeName}
                                  </h5>
                                </div>
                                <span className="flex items-center gap-1 text-[10px] sm:text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md shrink-0">
                                  <Clock className="h-3 w-3" /> {c.time}
                                </span>
                              </div>

                              <p className="flex items-start gap-1 text-xs text-slate-600 mb-2">
                                <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                                <span>{c.storeAddress || 'Không có địa chỉ chi tiết'}</span>
                              </p>

                              {/* Link mở thư mục ảnh trên Drive */}
                              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                                {c.driveFolderUrl || day.driveFolderUrl ? (
                                  <a
                                    href={c.driveFolderUrl || day.driveFolderUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 hover:border-blue-300 active:scale-95 transition"
                                  >
                                    <FolderOpen className="h-3.5 w-3.5 text-blue-600" />
                                    <span>Mở thư mục ảnh trên Drive</span>
                                    <ExternalLink className="h-3 w-3 text-blue-400 ml-0.5" />
                                  </a>
                                ) : (
                                  <span className="text-[11px] text-slate-400 italic">
                                    Không có thư mục ảnh
                                  </span>
                                )}

                                {Array.isArray(c.mediaUrls) && c.mediaUrls.length > 0 && (
                                  <span className="text-[11px] text-slate-400 font-medium">
                                    {c.mediaUrls.length} ảnh minh chứng
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 bg-slate-50 p-3 sm:p-4 flex items-center justify-between">
          <span className="text-[11px] sm:text-xs text-slate-500">
            Bấm "Mở Drive" để xem thư mục ảnh gốc
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-800 active:scale-[0.98] transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
