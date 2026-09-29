import { Users, Link2, CheckCircle2, FileCheck, AlertTriangle, Coffee } from 'lucide-react';

export default function TelesaleStatsCards({ members = [] }) {
  const totalMembers = members.length;
  const linkedMembers = members.filter(m => Boolean(m.linked_employee_id)).length;
  const unlinkedMembers = totalMembers - linkedMembers;

  const workedToday = members.filter(m => Boolean(m.attendance?.workedToday)).length;
  const reportedToday = members.filter(m => Boolean(m.hasReportedToday)).length;
  const pendingReport = members.filter(m => Boolean(m.attendance?.workedToday) && !m.hasReportedToday).length;
  const offToday = members.filter(m => Boolean(m.attendance?.isOff || m.attendance?.isOnLeave)).length;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {/* 1. Tổng nhân sự */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs transition hover:shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Tổng nhân sự</p>
            <p className="text-xl font-bold text-slate-800">{totalMembers}</p>
          </div>
        </div>
      </div>

      {/* 2. Đã đấu nối */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs transition hover:shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Link2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Đã đấu nối</p>
            <div className="flex items-baseline gap-1.5">
              <p className="text-xl font-bold text-indigo-600">{linkedMembers}</p>
              <span className="text-xs text-slate-400">/{totalMembers}</span>
            </div>
          </div>
        </div>
        {unlinkedMembers > 0 && (
          <p className="mt-2 text-[11px] font-medium text-amber-600">
            ⚠️ Còn {unlinkedMembers} nhân sự chưa đấu nối
          </p>
        )}
      </div>

      {/* 3. Đi làm hôm nay */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs transition hover:shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Đi làm hôm nay</p>
            <p className="text-xl font-bold text-emerald-600">{workedToday}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Đã check-in điểm danh</p>
      </div>

      {/* 4. Nghỉ ca / Nghỉ phép */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs transition hover:shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
            <Coffee className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Nghỉ ca / Có phép</p>
            <p className="text-xl font-bold text-purple-600">{offToday}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Miễn nhắc &amp; miễn phạt</p>
      </div>

      {/* 5. Đã nộp báo cáo */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs transition hover:shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
            <FileCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Đã nộp báo cáo</p>
            <div className="flex items-baseline gap-1.5">
              <p className="text-xl font-bold text-teal-600">{reportedToday}</p>
              <span className="text-xs text-slate-400">/{workedToday || totalMembers}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Chưa nộp (Cần nhắc) */}
      <div className={`rounded-2xl border p-4 shadow-2xs transition hover:shadow-xs ${
        pendingReport > 0 ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200 bg-white'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            pendingReport > 0 ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-400'
          }`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Chưa nộp (Đi làm)</p>
            <p className={`text-xl font-bold ${pendingReport > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
              {pendingReport}
            </p>
          </div>
        </div>
        <p className={`mt-2 text-[11px] ${pendingReport > 0 ? 'font-medium text-rose-600' : 'text-slate-400'}`}>
          {pendingReport > 0 ? '⚡️ Sẽ nhắc lúc 18h & phạt 19h' : 'Đã nộp đủ'}
        </p>
      </div>
    </div>
  );
}
