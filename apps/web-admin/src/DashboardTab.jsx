import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, CheckCircle, Clock, AlertTriangle, RefreshCw,
  ChevronDown, TrendingUp, TrendingDown, CircleDot,
  Wallet, UserX, Timer
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 phút

// ────────────────────────────────────────
// Utility helpers
// ────────────────────────────────────────
function formatCurrency(amount) {
  if (!amount) return '0';
  return Number(amount).toLocaleString('vi-VN');
}

function formatWeekRange(start, end) {
  if (!start || !end) return '';
  const fmt = (d) => {
    const [y, m, day] = d.split('-');
    return `${day}/${m}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

// ────────────────────────────────────────
// Status badge component
// ────────────────────────────────────────
const STATUS_MAP = {
  ON_TIME: { label: 'Đúng giờ', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-400' },
  LATE: { label: 'Đến muộn', cls: 'bg-amber-500/15  text-amber-400  border-amber-500/30', dot: 'bg-amber-400' },
  NOT_CHECKED_IN: { label: 'Chưa checkin', cls: 'bg-rose-500/15   text-rose-400   border-rose-500/30', dot: 'bg-rose-400' },
  OFF: { label: 'Nghỉ', cls: 'bg-slate-500/15  text-slate-400  border-slate-500/30', dot: 'bg-slate-400' },
  NO_SCHEDULE: { label: 'Chưa xếp ca', cls: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30', dot: 'bg-indigo-400' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_MAP[status] || STATUS_MAP.NO_SCHEDULE;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-pulse`} />
      {cfg.label}
    </span>
  );
}

// ────────────────────────────────────────
// Stat card component
// ────────────────────────────────────────
function StatCard({ icon, title, value, sub, colorClass, borderClass, iconBg }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border ${borderClass} bg-gradient-to-br ${colorClass} p-6 backdrop-blur-sm group hover:-translate-y-0.5 transition-all duration-300`}>
      {/* bg icon decoration */}
      <div className="absolute -right-3 -top-3 opacity-10 group-hover:opacity-20 transition-opacity duration-500">
        {React.cloneElement(icon, { className: 'w-24 h-24' })}
      </div>
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">{title}</p>
          <p className="text-4xl font-extrabold text-white leading-none">{value ?? '—'}</p>
          {sub && <p className="text-xs text-slate-400 mt-2">{sub}</p>}
        </div>
        <div className={`p-3 rounded-xl ${iconBg} backdrop-blur-md border border-white/10 shadow-inner`}>
          {React.cloneElement(icon, { className: 'w-5 h-5' })}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// Group selector
// ────────────────────────────────────────
function GroupSelector({ groups, selectedId, onChange }) {
  return (
    <div className="relative">
      <select
        value={selectedId || ''}
        onChange={e => onChange(e.target.value)}
        className="appearance-none bg-[#111827] border border-white/10 text-white text-sm rounded-xl px-4 py-2.5 pr-9 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 cursor-pointer hover:border-white/20 transition-colors"
      >
        {groups.map(g => (
          <option key={g.id} value={g.id}>{g.group_name || g.telegram_group_id}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
    </div>
  );
}

// ────────────────────────────────────────
// Skeleton loader
// ────────────────────────────────────────
function Skeleton({ className = '' }) {
  return <div className={`rounded-lg bg-white/5 animate-pulse ${className}`} />;
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
      {[...Array(8)].map((_, i) => (
        <Skeleton key={i} className="h-32 rounded-2xl" />
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-3 px-6 pb-6">
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

// ────────────────────────────────────────
// Main DashboardTab component
// ────────────────────────────────────────
export default function DashboardTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const timerRef = useRef(null);

  const fetchDashboard = useCallback(async (groupId, silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const params = groupId ? `?group_id=${groupId}` : '';
      const res = await fetch(`${API_URL}/admin/dashboard${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date());
      // Nếu chưa có selected group, tự động chọn nhóm đầu tiên
      if (!groupId && json.group) {
        setSelectedGroupId(json.group.id);
      }
    } catch (e) {
      console.log(e);
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchDashboard(selectedGroupId);
  }, []);

  // Auto-refresh mỗi 5 phút
  useEffect(() => {
    timerRef.current = setInterval(() => {
      fetchDashboard(selectedGroupId, true);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [selectedGroupId, fetchDashboard]);

  const handleGroupChange = (newGroupId) => {
    setSelectedGroupId(newGroupId);
    fetchDashboard(newGroupId);
  };

  const handleRefresh = () => {
    fetchDashboard(selectedGroupId, true);
  };

  const { stats, employees = [], group, groups = [], today, week } = data || {};

  const todayLabel = today
    ? new Date(today + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Dashboard Chấm công</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            📅 {todayLabel}
            {week && <span className="ml-3 text-slate-500">Tuần: {formatWeekRange(week.start, week.end)}</span>}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {data?.groups?.length > 0 && (
            <GroupSelector
              groups={data.groups}
              selectedId={selectedGroupId}
              onChange={handleGroupChange}
            />
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            title="Làm mới dữ liệu"
            className="p-2.5 bg-[#111827] border border-white/10 rounded-xl text-slate-400 hover:text-white hover:border-cyan-500/40 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Last updated */}
      {lastUpdated && !loading && (
        <p className="text-xs text-slate-500 -mt-2">
          Cập nhật lúc {lastUpdated.toLocaleTimeString('vi-VN')} · Tự làm mới mỗi 5 phút
        </p>
      )}

      {/* ── Error state ── */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6 text-rose-400 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>Lỗi tải dữ liệu: {error}</span>
          <button onClick={handleRefresh} className="ml-auto text-xs underline hover:no-underline">Thử lại</button>
        </div>
      )}

      {/* ── Stats cards ── */}
      {loading ? <StatsSkeleton /> : stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard
            icon={<Users className="text-blue-400" />}
            title="Có lịch hôm nay"
            value={stats.total_scheduled_today}
            sub={`${stats.total_checked_in_today} đã checkin`}
            colorClass="from-blue-500/10 to-blue-600/5"
            borderClass="border-blue-500/20"
            iconBg="bg-blue-500/15"
          />
          <StatCard
            icon={<UserX className="text-rose-400" />}
            title="Chưa checkin"
            value={stats.total_not_checked_yet ?? stats.total_absent_today}
            sub="đang chờ điểm danh"
            colorClass="from-rose-500/10 to-rose-600/5"
            borderClass="border-rose-500/20"
            iconBg="bg-rose-500/15"
          />
          <StatCard
            icon={<Clock className="text-amber-400" />}
            title="Muộn trong tuần"
            value={stats.weekly_late_count}
            sub={`${stats.weekly_on_time_count} lượt đúng giờ`}
            colorClass="from-amber-500/10 to-amber-600/5"
            borderClass="border-amber-500/20"
            iconBg="bg-amber-500/15"
          />
          <StatCard
            icon={<TrendingUp className="text-emerald-400" />}
            title="Đúng giờ tuần"
            value={`${stats.weekly_punctual_rate}%`}
            sub={`${stats.weekly_total_checkins} lượt checkin`}
            colorClass="from-emerald-500/10 to-emerald-600/5"
            borderClass="border-emerald-500/20"
            iconBg="bg-emerald-500/15"
          />
          <StatCard
            icon={<Wallet className="text-purple-400" />}
            title="Tiền phạt tuần"
            value={`${formatCurrency(stats.weekly_penalty_total)}₫`}
            sub="tổng tích lũy cả tuần"
            colorClass="from-purple-500/10 to-purple-600/5"
            borderClass="border-purple-500/20"
            iconBg="bg-purple-500/15"
          />
          <StatCard
            icon={<CheckCircle className="text-cyan-400" />}
            title="Đã checkin hôm nay"
            value={stats.total_checked_in_today}
            sub={`/ ${stats.total_scheduled_today} có lịch`}
            colorClass="from-cyan-500/10 to-cyan-600/5"
            borderClass="border-cyan-500/20"
            iconBg="bg-cyan-500/15"
          />
          <StatCard
            icon={<Timer className="text-orange-400" />}
            title="Đúng giờ tuần (lượt)"
            value={stats.weekly_on_time_count}
            sub={`trong ${stats.weekly_total_checkins} lượt checkin`}
            colorClass="from-orange-500/10 to-orange-600/5"
            borderClass="border-orange-500/20"
            iconBg="bg-orange-500/15"
          />
          <StatCard
            icon={<CircleDot className="text-indigo-400" />}
            title="Nhân sự trong nhóm"
            value={employees.length}
            sub={group?.group_name || ''}
            colorClass="from-indigo-500/10 to-indigo-600/5"
            borderClass="border-indigo-500/20"
            iconBg="bg-indigo-500/15"
          />
        </div>
      )}

      {/* ── Employee table ── */}
      <div className="bg-[#111827]/60 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-xl">
        <div className="p-5 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h3 className="text-lg font-bold text-white">
              Nhân sự hôm nay
              {group && <span className="ml-2 text-sm font-normal text-slate-400">— {group.group_name}</span>}
            </h3>
            {!loading && (
              <p className="text-xs text-slate-500 mt-0.5">
                {employees.length} nhân viên · {employees.filter(e => e.status === 'ON_TIME').length} đúng giờ · {employees.filter(e => e.status === 'LATE').length} muộn · {employees.filter(e => e.status === 'NOT_CHECKED_IN').length} chưa checkin
              </p>
            )}
          </div>
          {/* Legend */}
          <div className="flex items-center gap-3 flex-wrap text-xs text-slate-400">
            {Object.entries(STATUS_MAP).map(([key, cfg]) => (
              <span key={key} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </span>
            ))}
          </div>
        </div>

        {loading ? <TableSkeleton /> : (
          <div className="overflow-x-auto">
            {employees.length === 0 ? (
              <div className="py-16 text-center text-slate-500">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Không có nhân sự nào trong nhóm này.</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.02] text-slate-400 text-xs uppercase tracking-wider">
                    <th className="py-3 px-5 font-medium">Nhân viên</th>
                    <th className="py-3 px-5 font-medium">Ca làm</th>
                    <th className="py-3 px-5 font-medium text-center">Giờ checkin</th>
                    <th className="py-3 px-5 font-medium text-center">Muộn (phút)</th>
                    <th className="py-3 px-5 font-medium text-right">Tiền phạt</th>
                    <th className="py-3 px-5 font-medium">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {employees.map((emp) => (
                    <tr
                      key={emp.user_id}
                      className={`hover:bg-white/[0.025] transition-colors group ${emp.status === 'NOT_CHECKED_IN' ? 'bg-rose-500/[0.03]' : ''}`}
                    >
                      {/* Name */}
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-md">
                            {emp.full_name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="font-semibold text-white text-sm">{emp.full_name}</p>
                            <p className="text-xs text-slate-500">{emp.role}</p>
                          </div>
                        </div>
                      </td>
                      {/* Shift */}
                      <td className="py-3.5 px-5">
                        {emp.shift_type ? (
                          <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${emp.shift_type === 'CA_1' ? 'bg-blue-500/10   text-blue-400   border-blue-500/20' :
                            emp.shift_type === 'CA_2' ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' :
                              emp.shift_type === 'OFF' ? 'bg-slate-500/10  text-slate-400  border-slate-500/20' :
                                'bg-white/5       text-slate-300  border-white/10'
                            }`}>
                            {emp.shift_type === 'CA_1' ? '☀️ Ca 1' : emp.shift_type === 'CA_2' ? '🌙 Ca 2' : emp.shift_type === 'OFF' ? '🏖 Nghỉ' : emp.shift_type}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-xs italic">Chưa xếp ca</span>
                        )}
                      </td>
                      {/* Check-in time */}
                      <td className="py-3.5 px-5 text-center">
                        {emp.check_in_time ? (
                          <span className="font-mono font-semibold text-white">{emp.check_in_time}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      {/* Late minutes */}
                      <td className="py-3.5 px-5 text-center">
                        {emp.late_minutes > 0 ? (
                          <span className="text-amber-400 font-semibold">+{emp.late_minutes}'</span>
                        ) : emp.check_in_time ? (
                          <span className="text-emerald-400 text-xs">—</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      {/* Penalty */}
                      <td className="py-3.5 px-5 text-right">
                        {emp.penalty_amount > 0 ? (
                          <span className="text-rose-400 font-medium text-sm">{formatCurrency(emp.penalty_amount)}₫</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      {/* Status */}
                      <td className="py-3.5 px-5">
                        <StatusBadge status={emp.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Chưa checkin highlight */}
      {!loading && employees.filter(e => e.status === 'NOT_CHECKED_IN').length > 0 && (
        <div className="bg-rose-500/8 border border-rose-500/20 rounded-2xl p-4">
          <p className="text-rose-400 text-sm font-medium mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Chưa checkin hôm nay
          </p>
          <div className="flex flex-wrap gap-2">
            {employees
              .filter(e => e.status === 'NOT_CHECKED_IN')
              .map(e => (
                <span key={e.user_id} className="px-3 py-1 bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs rounded-full font-medium">
                  {e.full_name}
                </span>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}
