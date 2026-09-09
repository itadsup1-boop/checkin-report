import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlarmClock, BadgeCheck, CalendarCheck, CircleDollarSign, ClipboardCheck, Target } from 'lucide-react';
import { useEmployeeMonthlyOverview } from '../hooks/useEmployeeMonthlyOverview.js';
import { formatMoney } from '../utils/employee-month-status.js';
import AttendanceMonthlySection from './AttendanceMonthlySection.jsx';
import DayDetailPanel from './DayDetailPanel.jsx';
import EmployeeMonthCalendar from './EmployeeMonthCalendar.jsx';
import EmployeeGroupManagement from './EmployeeGroupManagement.jsx';
import EmployeeProfileHeader from './EmployeeProfileHeader.jsx';
import KpiMonthlySection from './KpiMonthlySection.jsx';
import MonthNavigator from './MonthNavigator.jsx';
import MonthlySummaryCards from './MonthlySummaryCards.jsx';

function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

export default function EmployeeDetailPage({ selectedGroupId = 'ALL' }) {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get('thang') || currentMonth();
  const [selectedDate, setSelectedDate] = useState(null);
  const { data, loading, error, refresh } = useEmployeeMonthlyOverview({ employeeId, month, groupId: selectedGroupId });

  const selectedDay = useMemo(() => data?.days.find(day => day.date === selectedDate) || null, [data?.days, selectedDate]);
  const changeMonth = value => {
    if (!value) return;
    setSelectedDate(null);
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('thang', value);
      return next;
    }, { replace: true });
  };
  const backToStaff = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('thang');
    navigate(next.toString() ? `/nhan-su?${next}` : '/nhan-su');
  };

  if (loading) return <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-white"><div className="h-9 w-9 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" /></div>;
  if (error || !data) return <section className="rounded-2xl border border-rose-200 bg-white p-10 text-center shadow-sm"><h2 className="font-bold text-slate-900">Không thể mở hồ sơ nhân viên</h2><p className="mt-2 text-sm text-rose-600">{error}</p><button type="button" onClick={backToStaff} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white">Quay lại danh sách</button></section>;

  if (!data.employee || !data.attendance?.summary || !data.kpi || !Array.isArray(data.days)) {
    return <section className="rounded-2xl border border-rose-200 bg-white p-10 text-center shadow-sm"><h2 className="font-bold text-slate-900">Dữ liệu hồ sơ không hợp lệ</h2><p className="mt-2 text-sm text-rose-600">Mối quan hệ dữ liệu của nhân viên chưa đầy đủ. Vui lòng thử tải lại trang.</p><button type="button" onClick={backToStaff} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white">Quay lại danh sách</button></section>;
  }

  const attendanceItems = [
    { label: 'Ngày có lịch', value: data.attendance.summary.scheduledDays, icon: CalendarCheck, tone: 'blue' },
    { label: 'Ngày check-in', value: data.attendance.summary.checkedInDays, icon: ClipboardCheck, tone: 'emerald' },
    { label: 'Đúng giờ', value: data.attendance.summary.onTimeDays, icon: BadgeCheck, tone: 'emerald' },
    { label: 'Đi muộn', value: data.attendance.summary.lateDays, icon: AlarmClock, tone: 'amber' },
    { label: 'Vắng', value: data.attendance.summary.absentDays, icon: Target, tone: 'rose' },
    { label: 'Tổng tiền phạt', value: formatMoney(data.attendance.summary.penaltyTotal), icon: CircleDollarSign, tone: 'rose' }
  ];
  const kpiItems = data.kpi.enabled ? [
    { label: 'Ngày báo cáo', value: data.kpi.summary.reportedDays, icon: ClipboardCheck, tone: 'blue' },
    { label: 'Ngày đạt KPI', value: data.kpi.summary.achievedDays, icon: BadgeCheck, tone: 'emerald' },
    { label: 'Chưa đạt KPI', value: data.kpi.summary.missedTargetDays, icon: Target, tone: 'amber' },
    { label: 'Báo cáo muộn', value: data.kpi.summary.lateDays, icon: AlarmClock, tone: 'rose' },
    { label: 'KPI thực tế', value: `${data.kpi.summary.actualTotal}/${data.kpi.summary.requiredTotal}`, icon: Target, tone: 'violet' },
    { label: 'Hoàn thành', value: `${data.kpi.summary.completionRate}%`, icon: BadgeCheck, tone: 'emerald' }
  ] : [];

  return <div className="space-y-5">
    <EmployeeProfileHeader employee={data.employee} onBack={backToStaff} />
    <EmployeeGroupManagement employee={data.employee} onUpdated={refresh} />
    <MonthNavigator month={month} onChange={changeMonth} />
    <MonthlySummaryCards items={attendanceItems} />
    {data.kpi.enabled && <MonthlySummaryCards items={kpiItems} />}
    <EmployeeMonthCalendar month={month} days={data.days} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
    <DayDetailPanel day={selectedDay} onClose={() => setSelectedDate(null)} />
    <div className="grid gap-5 2xl:grid-cols-2"><AttendanceMonthlySection attendance={data.attendance} /><KpiMonthlySection kpi={data.kpi} /></div>
  </div>;
}
