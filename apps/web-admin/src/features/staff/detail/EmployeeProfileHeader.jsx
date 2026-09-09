import { ArrowLeft, BadgeCheck, Building2 } from 'lucide-react';

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(-2).map(part => part[0]).join('').toUpperCase();
}

export default function EmployeeProfileHeader({ employee, onBack }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-blue-600">
        <ArrowLeft className="h-4 w-4" />Quay lại danh sách nhân sự
      </button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-lg font-bold text-white shadow-lg shadow-blue-500/20">
            {initials(employee.full_name)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-bold text-slate-900 sm:text-2xl">{employee.full_name}</h2>
              <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${employee.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-rose-200 bg-rose-50 text-rose-600'}`}>
                {employee.is_active ? 'Đang hoạt động' : 'Đã vô hiệu'}
              </span>
            </div>
            <p className="mt-1 break-words text-xs text-slate-500">Telegram ID: {employee.telegram_id || 'Chưa liên kết'} · {employee.role || 'Chưa có vai trò'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {employee.groups.map(group => (
                <span key={group.telegram_group_id} className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-600">
                  <Building2 className="h-3 w-3" />{group.group_name || group.telegram_group_id}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <BadgeCheck className="h-5 w-5 text-blue-600" />
          <div><p className="font-semibold text-slate-800">{employee.employee_code || 'Chưa có mã NV'}</p><p>{employee.position || employee.department || 'Nhân viên'}</p></div>
        </div>
      </div>
    </section>
  );
}
