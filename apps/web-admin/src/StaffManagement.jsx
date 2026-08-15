import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Briefcase,
  Calendar,
  Edit3,
  PauseCircle,
  PlayCircle,
  Save,
  Search,
  UserCheck,
  Users,
  X
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const PAUSABLE_GROUP_ROLES = ['report', 'report_tour', 'timekeep'];
const ROW_GRID = 'grid-cols-[44px_minmax(230px,1.35fr)_minmax(180px,1fr)_minmax(310px,1.7fr)_minmax(190px,1fr)_150px]';

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase();
}

function Tag({ children, tone = 'slate' }) {
  const tones = {
    slate: 'border-white/10 bg-white/[0.04] text-slate-300',
    cyan: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-400',
    emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-400',
    rose: 'border-rose-500/25 bg-rose-500/10 text-rose-400',
    violet: 'border-violet-500/25 bg-violet-500/10 text-violet-400'
  };
  return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

function CompactSummary({ icon: Icon, label, value, tone }) {
  const tones = {
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20'
  };
  return (
    <div className="flex min-h-[78px] items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#111827]/70 px-4 py-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${tones[tone]}`}><Icon className="h-5 w-5" /></div>
      <div><p className="text-xs text-slate-400">{label}</p><strong className="text-2xl leading-none text-white">{value}</strong></div>
    </div>
  );
}

export default function StaffManagement({ selectedGroupId = 'ALL' }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [toast, setToast] = useState(null);

  const showToast = useCallback(message => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const params = selectedGroupId && selectedGroupId !== 'ALL'
        ? `?group_id=${encodeURIComponent(selectedGroupId)}`
        : '';
      const response = await axios.get(`${API_URL}/admin/tk-users${params}`);
      setStaff(response.data.map(user => ({
        ...user,
        need_report: user.group_need_report ?? user.need_report,
        current_kpi_target: user.group_kpi_target ?? user.current_kpi_target
      })));
    } catch (error) {
      showToast(`❌ Không tải được danh sách nhân sự: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedGroupId, showToast]);

  useEffect(() => {
    const requestId = window.setTimeout(fetchStaff, 0);
    return () => window.clearTimeout(requestId);
  }, [fetchStaff]);

  const startEdit = user => {
    setEditingId(user.id);
    setEditForm({
      full_name: user.full_name || '',
      role: user.role || '',
      leave_quota: user.leave_quota ?? 12,
      is_exempt_checkin: Boolean(user.is_exempt_checkin),
      need_report: user.need_report !== false,
      is_active: user.is_active !== false
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async id => {
    try {
      await axios.put(`${API_URL}/admin/tk-users/${id}`, {
        ...editForm,
        telegram_group_id: selectedGroupId !== 'ALL' ? selectedGroupId : undefined
      });
      showToast('✅ Đã cập nhật thông tin nhân sự.');
      setEditingId(null);
      await fetchStaff();
    } catch (error) {
      showToast(`❌ Không thể cập nhật: ${error.response?.data?.error || error.message}`);
    }
  };

  const updateMembershipStatus = async user => {
    if (!selectedGroupId || selectedGroupId === 'ALL') {
      showToast('⚠️ Hãy chọn một nhóm cụ thể trước.');
      return;
    }

    const currentStatus = user.membership_status || 'ACTIVE';
    const nextStatus = currentStatus === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
    let pauseReason = '';
    if (nextStatus === 'PAUSED') {
      pauseReason = window.prompt(`Lý do tạm dừng ${user.full_name} tại nhóm này:`, 'Tạm chuyển cơ sở');
      if (pauseReason === null) return;
      if (!window.confirm(`Tạm dừng ${user.full_name} tại nhóm đang chọn?`)) return;
    } else if (!window.confirm(`Kích hoạt lại ${user.full_name} tại nhóm đang chọn?`)) return;

    try {
      await axios.put(`${API_URL}/admin/tk-users/${user.id}/group-membership`, {
        telegram_group_id: selectedGroupId,
        status: nextStatus,
        pause_reason: pauseReason
      });
      showToast(nextStatus === 'PAUSED' ? '⏸ Đã tạm dừng tại nhóm này.' : '▶ Đã kích hoạt lại tại nhóm này.');
      await fetchStaff();
    } catch (error) {
      showToast(`❌ ${error.response?.data?.error || error.message}`);
    }
  };

  const filteredStaff = useMemo(() => {
    const keyword = searchTerm.trim().toLocaleLowerCase('vi');
    return staff.filter(user => !keyword || `${user.full_name} ${user.role} ${user.telegram_id} ${user.group_name}`
      .toLocaleLowerCase('vi')
      .includes(keyword));
  }, [searchTerm, staff]);

  const roles = useMemo(() => new Set(staff.map(user => user.role).filter(Boolean)).size, [staff]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Quản lý nhân sự</h2>
          <p className="mt-1 text-xs text-slate-400">Nhân viên đã đăng ký qua Telegram Bot và thiết lập theo từng nhóm.</p>
        </div>
        <div className="flex w-full items-center rounded-xl border border-white/10 bg-[#111827] px-3 py-2.5 lg:w-96 focus-within:border-cyan-500/50">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Tìm tên, vai trò, Telegram ID hoặc nhóm…"
            className="ml-2 w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <CompactSummary icon={Users} label="Tổng nhân sự" value={staff.length} tone="cyan" />
        <CompactSummary icon={Briefcase} label="Vai trò đang sử dụng" value={roles} tone="emerald" />
        <CompactSummary icon={Calendar} label="Phép mặc định / năm" value="12 ngày" tone="violet" />
      </div>

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111827]/70 shadow-xl">
        <div className="flex min-h-16 flex-col gap-3 border-b border-white/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-white">
            <UserCheck className="h-5 w-5 text-cyan-400" />Danh sách nhân sự ({filteredStaff.length})
          </h3>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[1120px]">
            <div className={`grid ${ROW_GRID} items-center gap-4 border-b border-white/[0.06] bg-white/[0.02] px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500`}>
              <span>#</span>
              <span>Nhân viên</span>
              <span>Vai trò & nhóm</span>
              <span>Thiết lập nhân sự</span>
              <span>Trạng thái</span>
              <span className="text-right">Thao tác</span>
            </div>

            {loading ? (
              <div className="flex h-40 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-cyan-500/25 border-t-cyan-500" /></div>
            ) : filteredStaff.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-slate-500">
                {searchTerm ? 'Không tìm thấy nhân sự phù hợp.' : 'Chưa có nhân sự đăng ký.'}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {filteredStaff.map((user, index) => {
                  const isEditing = editingId === user.id;
                  const canPause = selectedGroupId !== 'ALL' && PAUSABLE_GROUP_ROLES.includes(user.selected_group_role);
                  const isPaused = (user.membership_status || 'ACTIVE') === 'PAUSED';

                  return (
                    <div key={user.id} className={`grid ${ROW_GRID} min-h-[92px] items-center gap-4 px-5 py-3 transition hover:bg-white/[0.02]`}>
                      <span className="text-xs font-semibold text-slate-500">{index + 1}</span>

                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-bold text-white">
                          {initials(user.full_name)}
                        </div>
                        <div className="min-w-0">
                          {isEditing ? (
                            <input value={editForm.full_name} onChange={event => setEditForm({ ...editForm, full_name: event.target.value })} className="w-full rounded-lg border border-cyan-500/40 bg-[#0B0F19] px-2.5 py-1.5 text-sm text-white outline-none" />
                          ) : (
                            <p className="truncate text-sm font-bold text-white" title={user.full_name}>{user.full_name}</p>
                          )}
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                            <code className="rounded bg-white/[0.04] px-1.5 py-0.5 text-slate-400">{user.telegram_id || 'Chưa có ID'}</code>
                            <span>Đăng ký {user.created_at ? new Date(user.created_at).toLocaleDateString('vi-VN') : '—'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0 space-y-2">
                        {isEditing ? (
                          <input value={editForm.role} onChange={event => setEditForm({ ...editForm, role: event.target.value })} className="w-full rounded-lg border border-cyan-500/40 bg-[#0B0F19] px-2.5 py-1.5 text-xs text-white outline-none" />
                        ) : <Tag tone="cyan">{user.role || 'Chưa có vai trò'}</Tag>}
                        <p className="line-clamp-2 text-[11px] leading-4 text-slate-400" title={user.group_name || 'Chưa thuộc nhóm'}>{user.group_name || 'Chưa thuộc nhóm'}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {isEditing ? (
                          <>
                            <label className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0F19] px-2 py-1.5 text-[11px] text-slate-300">
                              Phép <input type="number" min="0" value={editForm.leave_quota} onChange={event => setEditForm({ ...editForm, leave_quota: Number(event.target.value) || 0 })} className="w-10 bg-transparent text-center font-bold text-white outline-none" /> ngày
                            </label>
                            <label className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-slate-300">
                              <input type="checkbox" checked={editForm.is_exempt_checkin} onChange={event => setEditForm({ ...editForm, is_exempt_checkin: event.target.checked })} className="accent-cyan-500" />Miễn check-in
                            </label>
                            <label className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-slate-300">
                              <input type="checkbox" checked={editForm.need_report} onChange={event => setEditForm({ ...editForm, need_report: event.target.checked })} className="accent-cyan-500" />Cần báo cáo
                            </label>
                          </>
                        ) : (
                          <>
                            <Tag tone="violet">{user.leave_quota ?? 12} ngày phép</Tag>
                            <Tag tone={user.is_exempt_checkin ? 'emerald' : 'slate'}>{user.is_exempt_checkin ? 'Miễn check-in' : 'Check-in thường'}</Tag>
                            <Tag tone={user.need_report !== false ? 'cyan' : 'amber'}>{user.need_report !== false ? 'Cần báo cáo' : 'Miễn báo cáo'}</Tag>
                          </>
                        )}
                      </div>

                      <div className="flex flex-col items-start gap-2">
                        {isEditing ? (
                          <select value={editForm.is_active ? 'active' : 'disabled'} onChange={event => setEditForm({ ...editForm, is_active: event.target.value === 'active' })} className="rounded-lg border border-cyan-500/40 bg-[#0B0F19] px-2.5 py-1.5 text-xs text-white outline-none">
                            <option value="active">Tài khoản hoạt động</option>
                            <option value="disabled">Tài khoản vô hiệu</option>
                          </select>
                        ) : (
                          <Tag tone={user.is_active !== false ? 'emerald' : 'rose'}>{user.is_active !== false ? '● Tài khoản hoạt động' : '● Tài khoản vô hiệu'}</Tag>
                        )}
                        {canPause && <Tag tone={isPaused ? 'amber' : 'emerald'}>{isPaused ? '⏸ Tạm dừng tại nhóm' : '▶ Đang hoạt động tại nhóm'}</Tag>}
                        {isPaused && user.membership_pause_reason && <p className="max-w-[180px] truncate text-[10px] text-slate-500" title={user.membership_pause_reason}>{user.membership_pause_reason}</p>}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveEdit(user.id)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20"><Save className="h-3.5 w-3.5" />Lưu</button>
                            <button onClick={cancelEdit} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white"><X className="h-3.5 w-3.5" />Hủy</button>
                          </>
                        ) : (
                          <>
                            {canPause && (
                              <button onClick={() => updateMembershipStatus(user)} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold ${isPaused ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/25 bg-amber-500/10 text-amber-400'}`}>
                                {isPaused ? <><PlayCircle className="h-3.5 w-3.5" />Kích hoạt</> : <><PauseCircle className="h-3.5 w-3.5" />Tạm dừng</>}
                              </button>
                            )}
                            <button onClick={() => startEdit(user)} className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-400 hover:bg-cyan-500/20"><Edit3 className="h-3.5 w-3.5" />Sửa</button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-cyan-500/30 bg-[#111827] px-5 py-3 text-sm font-medium text-white shadow-2xl">{toast}</div>}
    </div>
  );
}
