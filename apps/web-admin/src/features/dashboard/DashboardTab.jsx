import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  RefreshCw,
  UserX,
  Users
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const STATUS = {
  ON_TIME: {
    label: 'Đúng giờ',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500'
  },
  LATE: {
    label: 'Đến muộn',
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    dot: 'bg-amber-500'
  },
  NOT_CHECKED_IN: {
    label: 'Chưa check-in',
    badge: 'border-rose-200 bg-rose-50 text-rose-700',
    dot: 'bg-rose-500'
  }
};

function adminHeaders() {
  const token = localStorage.getItem('admin_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase();
}

function formatLeaveDuration(request) {
  if (request.request_type === 'HALF_DAY_AM' || request.request_type === 'HALF_DAY_PM') return 'Nửa ngày';
  if (request.request_type === 'LATE') return request.late_minutes ? `${request.late_minutes} phút` : 'Đi muộn';
  return '1 ngày';
}

function leaveDateKey(value) {
  if (!value) return '';
  const text = String(value);
  const isoDate = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function todayInVietnam() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function formatLeaveDate(value) {
  const [year, month, day] = leaveDateKey(value).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

function CompactStatCard({ icon: Icon, title, value, note, tone }) {
  const tones = {
    cyan: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600'
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{value ?? '—'}</p>
          <p className="mt-2 text-xs text-slate-500">{note}</p>
        </div>
        <div className={`rounded-xl p-3 ${tones[tone]}`}>
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}

function Panel({ title, action, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex h-14 items-center justify-between border-b border-slate-100 px-5">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(item => <div key={item} className="h-[110px] rounded-2xl bg-slate-200" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="h-64 rounded-2xl bg-slate-200" />
        <div className="h-64 rounded-2xl bg-slate-200" />
      </div>
    </div>
  );
}

export default function DashboardTab({ selectedGroupId = 'ALL', onNavigate }) {
  const [data, setData] = useState(null);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [approvingId, setApprovingId] = useState(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const timerRef = useRef(null);

  const loadDashboard = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');

    const query = selectedGroupId && selectedGroupId !== 'ALL'
      ? `?group_id=${encodeURIComponent(selectedGroupId)}`
      : '';

    try {
      const [dashboardResponse, leaveResponse] = await Promise.all([
        fetch(`${API_URL}/admin/dashboard${query}`, { headers: adminHeaders() }),
        fetch(`${API_URL}/admin/leave-requests${query}`, { headers: adminHeaders() })
      ]);
      if (!dashboardResponse.ok) throw new Error(`Không tải được tổng quan (${dashboardResponse.status})`);
      if (!leaveResponse.ok) throw new Error(`Không tải được đơn nghỉ (${leaveResponse.status})`);

      const [dashboard, requests] = await Promise.all([
        dashboardResponse.json(),
        leaveResponse.json()
      ]);
      setData(dashboard);
      setLeaveRequests(Array.isArray(requests) ? requests : []);
      setLastUpdated(new Date());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    const requestId = window.setTimeout(loadDashboard, 0);
    return () => window.clearTimeout(requestId);
  }, [loadDashboard]);

  useEffect(() => {
    timerRef.current = setInterval(() => loadDashboard(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [loadDashboard]);

  const employees = useMemo(() => data?.employees || [], [data?.employees]);
  const stats = data?.stats || {};
  const onTimeToday = employees.filter(employee => employee.status === 'ON_TIME').length;
  const lateToday = employees.filter(employee => employee.status === 'LATE').length;
  const absentToday = employees.filter(employee => employee.status === 'NOT_CHECKED_IN').length;
  const punctualRate = stats.total_checked_in_today
    ? Math.round((onTimeToday / stats.total_checked_in_today) * 100)
    : 0;

  const recentAttendance = useMemo(() => employees
    .filter(employee => employee.check_in_time)
    .sort((left, right) => String(right.check_in_time).localeCompare(String(left.check_in_time)))
    .slice(0, 4), [employees]);

  const futurePendingLeaves = useMemo(() => {
    const today = todayInVietnam();
    return leaveRequests
      .filter(request => request.status === 'PENDING' && leaveDateKey(request.date) > today)
      .sort((left, right) => leaveDateKey(left.date).localeCompare(leaveDateKey(right.date)));
  }, [leaveRequests]);
  const pendingLeaves = futurePendingLeaves.slice(0, 4);

  const approveLeave = async requestId => {
    setApprovingId(requestId);
    try {
      const response = await fetch(`${API_URL}/admin/leave-requests/${requestId}`, {
        method: 'PUT',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'APPROVED', approved_by: 'Admin (Dashboard)' })
      });
      if (!response.ok) throw new Error('Không thể duyệt đơn nghỉ');
      setLeaveRequests(current => current.map(request =>
        request.id === requestId ? { ...request, status: 'APPROVED' } : request
      ));
    } catch (approveError) {
      setError(approveError.message);
    } finally {
      setApprovingId(null);
    }
  };

  if (loading) return <Skeleton />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">Tổng quan hôm nay</h1>
          <p className="mt-1 truncate text-sm text-slate-500">
            {data?.group?.group_name || 'Tất cả nhóm'}
            {lastUpdated && ` · Cập nhật ${lastUpdated.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadDashboard(true)}
          disabled={refreshing}
          title="Làm mới dữ liệu"
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Làm mới
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CompactStatCard
          icon={Users}
          title="Tổng nhân sự"
          value={employees.length}
          note={`${stats.total_scheduled_today || 0} có lịch`}
          tone="cyan"
        />
        <CompactStatCard
          icon={CheckCircle2}
          title="Đúng giờ hôm nay"
          value={onTimeToday}
          note={`${punctualRate}% check-in`}
          tone="emerald"
        />
        <CompactStatCard
          icon={Clock3}
          title="Đến muộn"
          value={lateToday}
          note={`${stats.weekly_late_count || 0} lượt tuần này`}
          tone="amber"
        />
        <CompactStatCard
          icon={UserX}
          title="Vắng chưa phép"
          value={absentToday}
          note="chưa check-in"
          tone="rose"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Panel
          title="Chấm công gần đây"
          action={(
            <button type="button" onClick={() => onNavigate?.('checkins')} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700">
              Xem tất cả <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        >
          {recentAttendance.length ? (
            <div className="divide-y divide-slate-100">
              {recentAttendance.map(employee => {
                const status = STATUS[employee.status] || STATUS.ON_TIME;
                return (
                  <div key={employee.user_id} className="flex min-h-[62px] items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                      {initials(employee.full_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{employee.full_name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">Check-in: {employee.check_in_time}</p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${status.badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-[188px] flex-col items-center justify-center px-5 text-center">
              <Clock3 className="h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-500">Chưa có lượt check-in hôm nay</p>
            </div>
          )}
        </Panel>

        <Panel
          title={`Nghỉ phép chờ duyệt${futurePendingLeaves.length ? ` (${futurePendingLeaves.length})` : ''}`}
          action={(
            <button type="button" onClick={() => onNavigate?.('leave')} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700">
              Xem tất cả <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        >
          {pendingLeaves.length ? (
            <div className="overflow-x-auto p-3">
              <div className="min-w-[520px]">
                <div className="grid grid-cols-[minmax(130px,1fr)_90px_minmax(150px,1.2fr)_34px] gap-3 px-3 pb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <span>Nhân viên</span>
                  <span>Ngày muốn nghỉ</span>
                  <span>Lý do</span>
                  <span />
                </div>
                <div className="space-y-2">
                  {pendingLeaves.map(request => (
                    <div key={request.id} className="grid min-h-[58px] grid-cols-[minmax(130px,1fr)_90px_minmax(150px,1.2fr)_34px] items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-600 shadow-sm">
                          {initials(request.full_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-800">{request.full_name || 'Nhân viên'}</p>
                          <p className="mt-0.5 text-[10px] text-slate-500">{formatLeaveDuration(request)}</p>
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-blue-600">{formatLeaveDate(request.date)}</span>
                      <p className="line-clamp-2 text-[11px] leading-4 text-slate-500" title={request.reason || 'Không ghi lý do'}>
                        {request.reason || 'Không ghi lý do'}
                      </p>
                      <button
                        type="button"
                        onClick={() => approveLeave(request.id)}
                        disabled={approvingId === request.id}
                        title="Duyệt đơn"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white transition hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {approvingId === request.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[188px] flex-col items-center justify-center px-5 text-center">
              <CalendarDays className="h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-500">Không có đơn tương lai chờ duyệt</p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
