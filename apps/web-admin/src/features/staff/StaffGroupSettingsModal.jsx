import { Save, X } from 'lucide-react';
import { useState } from 'react';

export default function StaffGroupSettingsModal({ employee, membership, saving, onClose, onSave }) {
  const [form, setForm] = useState({
    role: membership.role || '',
    is_exempt_checkin: Boolean(membership.is_exempt_checkin),
    need_report: membership.need_report !== false,
    current_kpi_target: Number(membership.current_kpi_target || 0)
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <form onSubmit={event => { event.preventDefault(); onSave(form); }} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:rounded-2xl sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div><h3 className="font-bold text-slate-900">Thiết lập nhân sự theo nhóm</h3><p className="mt-1 text-xs text-slate-500">{employee.full_name} · {membership.group_name}</p></div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-semibold text-slate-600">Vai trò tại nhóm
            <input value={form.role} onChange={event => setForm(current => ({ ...current, role: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-400" />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm text-slate-700"><span><strong className="block">Miễn check-in</strong><small className="text-slate-500">Chỉ áp dụng tại nhóm này</small></span><input type="checkbox" checked={form.is_exempt_checkin} onChange={event => setForm(current => ({ ...current, is_exempt_checkin: event.target.checked }))} className="h-4 w-4 accent-blue-600" /></label>
          <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm text-slate-700"><span><strong className="block">Cần báo cáo KPI</strong><small className="text-slate-500">Tắt để miễn báo cáo tại nhóm này</small></span><input type="checkbox" checked={form.need_report} onChange={event => setForm(current => ({ ...current, need_report: event.target.checked }))} className="h-4 w-4 accent-blue-600" /></label>
          <label className="block text-xs font-semibold text-slate-600">Chỉ tiêu KPI tại nhóm
            <input type="number" min="0" value={form.current_kpi_target} onChange={event => setForm(current => ({ ...current, current_kpi_target: Number(event.target.value) || 0 }))} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-400" />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">Hủy</button><button disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Đang lưu…' : 'Lưu thiết lập'}</button></div>
      </form>
    </div>
  );
}
