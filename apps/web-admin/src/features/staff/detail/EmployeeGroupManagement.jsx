import axios from 'axios';
import { Edit3, PauseCircle, PlayCircle, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import StaffGroupSettingsModal from '../StaffGroupSettingsModal.jsx';
import WarehousePermissionModal from '../WarehousePermissionModal.jsx';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const PAUSABLE_ROLES = ['report', 'report_tour', 'timekeep'];

function Badge({ children, tone = 'slate' }) {
  const tones = { slate: 'border-slate-200 bg-slate-50 text-slate-600', blue: 'border-blue-200 bg-blue-50 text-blue-600', green: 'border-emerald-200 bg-emerald-50 text-emerald-600', amber: 'border-amber-200 bg-amber-50 text-amber-600' };
  return <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export default function EmployeeGroupManagement({ employee, onUpdated }) {
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [permission, setPermission] = useState(null);
  const [toast, setToast] = useState(null);
  const notify = message => { setToast(message); window.setTimeout(() => setToast(null), 3000); };

  const saveSettings = async form => {
    setSaving(true);
    try {
      await axios.put(`${API_URL}/admin/tk-users/${editing.employee_id}/group-settings`, { ...form, telegram_group_id: editing.telegram_group_id });
      setEditing(null); notify('✅ Đã lưu thiết lập theo nhóm.'); onUpdated();
    } catch (error) { notify(`❌ ${error.response?.data?.error || error.message}`); } finally { setSaving(false); }
  };
  const changeStatus = async group => {
    const paused = group.membership_status === 'PAUSED';
    const reason = paused ? '' : window.prompt('Lý do tạm dừng tại nhóm:', 'Tạm chuyển cơ sở');
    if (!paused && reason === null) return;
    try {
      await axios.put(`${API_URL}/admin/tk-users/${group.employee_id}/group-membership`, { telegram_group_id: group.telegram_group_id, status: paused ? 'ACTIVE' : 'PAUSED', pause_reason: reason });
      notify(paused ? '✅ Đã kích hoạt lại.' : '⏸ Đã tạm dừng tại nhóm.'); onUpdated();
    } catch (error) { notify(`❌ ${error.response?.data?.error || error.message}`); }
  };
  const openPermissions = async group => {
    try {
      const response = await axios.get(`${API_URL}/admin/warehouse/groups/${encodeURIComponent(group.telegram_group_id)}/permissions`);
      const row = (response.data.employees || []).find(item => item.id === group.employee_id);
      setPermission({ group, codes: response.data.permission_codes || [], granted: new Set(row?.permissions || []) });
    } catch (error) { notify(`❌ ${error.response?.data?.message || error.message}`); }
  };
  const savePermissions = async () => {
    setSaving(true);
    try {
      await axios.put(`${API_URL}/admin/warehouse/groups/${encodeURIComponent(permission.group.telegram_group_id)}/permissions/${permission.group.employee_id}`, { permissions: [...permission.granted] });
      setPermission(null); notify('✅ Đã lưu quyền kho.');
    } catch (error) { notify(`❌ ${error.response?.data?.message || error.message}`); } finally { setSaving(false); }
  };

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h3 className="font-bold text-slate-900">Thiết lập theo nhóm</h3><p className="mt-1 text-xs text-slate-500">Mỗi nhóm có vai trò, chính sách chấm công, báo cáo và quyền riêng.</p></div><div className="divide-y divide-slate-100">{employee.groups.map(group => { const paused = group.membership_status === 'PAUSED'; return <div key={`${group.employee_id}:${group.telegram_group_id}`} className="grid gap-3 px-5 py-4 lg:grid-cols-[1.4fr_1.2fr_0.8fr_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><Badge tone="blue">{group.role || 'Chưa có vai trò'}</Badge><strong className="text-sm text-slate-800">{group.group_name}</strong></div></div><div className="flex flex-wrap gap-2"><Badge>{group.is_exempt_checkin ? 'Miễn check-in' : 'Check-in thường'}</Badge><Badge tone={group.need_report ? 'blue' : 'amber'}>{group.need_report ? 'Cần báo cáo' : 'Miễn báo cáo'}</Badge>{group.need_report && <Badge>KPI {Number(group.current_kpi_target || 0)}</Badge>}</div><Badge tone={paused ? 'amber' : 'green'}>{paused ? 'Tạm dừng' : 'Đang hoạt động'}</Badge><div className="flex flex-wrap justify-end gap-2"><button onClick={() => setEditing(group)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-600"><Edit3 className="h-4 w-4" />Sửa</button>{PAUSABLE_ROLES.includes(group.bot_role) && <button onClick={() => changeStatus(group)} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-600">{paused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}{paused ? 'Kích hoạt' : 'Tạm dừng'}</button>}{group.bot_role === 'warehouse' && <button onClick={() => openPermissions(group)} className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-600"><ShieldCheck className="h-4 w-4" />Quyền kho</button>}</div></div>; })}</div>{editing && <StaffGroupSettingsModal employee={employee} membership={editing} saving={saving} onClose={() => setEditing(null)} onSave={saveSettings} />}{permission && <WarehousePermissionModal groupName={permission.group.group_name} codes={permission.codes} granted={permission.granted} saving={saving} onToggle={code => setPermission(current => { const granted = new Set(current.granted); granted.has(code) ? granted.delete(code) : granted.add(code); return { ...current, granted }; })} onClose={() => setPermission(null)} onSave={savePermissions} />}{toast && <div className="fixed bottom-6 right-6 z-[60] rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">{toast}</div>}</section>;
}
