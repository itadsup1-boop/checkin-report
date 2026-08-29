import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Briefcase,
  Calendar,
  Check,
  Clock3,
  Edit3,
  PauseCircle,
  PlayCircle,
  Save,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  X
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const PAUSABLE_GROUP_ROLES = ['report', 'report_tour', 'timekeep'];
// Dựa theo danh sách chức vụ nhân viên tự chọn lúc đăng ký ở register.html,
// cộng thêm Admin/Kế toán để Admin gán được ngay từ đây — tránh gõ tay ra một
// vai trò khác chữ (vd "Sale" vs "Sales") gây lệch thống kê theo vai trò.
// Lưu ý: chọn "Kế toán" ở đây chỉ là NHÃN hiển thị, không tự cấp quyền
// MANAGE_PRICING/VIEW_PRICING — vẫn phải bấm nút "Quyền kho" để cấp quyền
// thật cho nhóm cụ thể.
const STAFF_ROLES = [
  'Admin',
  'Kế toán',
  'Telesale',
  'Sales',
  'Kỹ thuật viên',
  'Chăm sóc khách hàng',
  'Marketing',
  'Quản lý',
  'Quản lý kho',
  'Bộ phận khác'
];
const OTHER_ROLE = 'Khác (tự nhập)';
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

// Nhãn tiếng Việt cho từng MÃ QUYỀN kho thật (WAREHOUSE_PERMISSIONS ở
// domains/warehouse/domain/constants.js). "Admin" và "Kế toán" KHÔNG phải mã
// quyền để tick chọn ở đây — Admin do ADMIN_IDS quyết định, còn "kế toán" chỉ
// là cách gọi khi ai đó được cấp MANAGE_PRICING/VIEW_PRICING, nên chỉ xuất
// hiện dưới dạng chú thích trong ngoặc, không phải một lựa chọn riêng.
const WAREHOUSE_PERMISSION_LABELS = {
  APPROVE_EXPORT: 'Duyệt đơn xuất kho',
  AUTO_APPROVE_OWN_ORDER: 'Tự động duyệt đơn do chính mình tạo',
  APPROVE_TRANSFER: 'Duyệt điều chuyển hàng giữa 2 cơ sở',
  MANAGE_TEMPLATES: 'Quản lý mẫu dịch vụ',
  MANAGE_PRODUCTS: 'Quản lý danh mục sản phẩm',
  ADJUST_INVENTORY: 'Điều chỉnh tồn kho thủ công',
  VIEW_REPORTS: 'Xem báo cáo kho',
  MANAGE_PRICING: 'Nhập đơn giá sản phẩm (kế toán)',
  VIEW_PRICING: 'Xem đơn giá & tổng giá đơn xuất (kế toán)'
};

function WarehousePermissionModal({ employee, allCodes, granted, saving, onToggle, onClose, onSave }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111827] p-5 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Quyền kho — {employee.full_name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-xs text-slate-400">Chỉ áp dụng trong nhóm kho đang chọn. Tick quyền nào thì nhân sự này được thao tác đúng quyền đó.</p>
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {allCodes.map(code => (
            <label key={code} className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-slate-200 hover:bg-white/[0.06]">
              <input type="checkbox" checked={granted.has(code)} onChange={() => onToggle(code)} className="accent-cyan-500" />
              {WAREHOUSE_PERMISSION_LABELS[code] || code}
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white">Hủy</button>
          <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">
            <Save className="h-3.5 w-3.5" />{saving ? 'Đang lưu…' : 'Lưu quyền'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StaffManagement({ selectedGroupId = 'ALL' }) {
  const [staff, setStaff] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [registrationHistory, setRegistrationHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [toast, setToast] = useState(null);
  const [permissionEmployee, setPermissionEmployee] = useState(null);
  const [permissionCodes, setPermissionCodes] = useState([]);
  const [grantedCodes, setGrantedCodes] = useState(new Set());
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [reviewingRequestId, setReviewingRequestId] = useState(null);
  const [registrationTargets, setRegistrationTargets] = useState({});

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

  const fetchPendingRequests = useCallback(async () => {
    try {
      const params = selectedGroupId && selectedGroupId !== 'ALL'
        ? `?group_id=${encodeURIComponent(selectedGroupId)}`
        : '';
      const separator = params ? '&' : '?';
      const response = await axios.get(`${API_URL}/admin/registration-requests${params}${separator}status=ALL`);
      const requests = response.data || [];
      setPendingRequests(requests.filter(request => request.status === 'PENDING'));
      setRegistrationHistory(requests.filter(request => request.status !== 'PENDING'));
    } catch (error) {
      showToast(`❌ Không tải được yêu cầu đăng ký: ${error.response?.data?.message || error.message}`);
    }
  }, [selectedGroupId, showToast]);

  useEffect(() => {
    const requestId = window.setTimeout(fetchStaff, 0);
    return () => window.clearTimeout(requestId);
  }, [fetchStaff]);

  useEffect(() => {
    const requestId = window.setTimeout(fetchPendingRequests, 0);
    return () => window.clearTimeout(requestId);
  }, [fetchPendingRequests]);

  const approveRegistration = async request => {
    const targetEmployeeId = registrationTargets[request.id] || request.suggested_employee_id;
    setReviewingRequestId(request.id);
    try {
      await axios.post(`${API_URL}/admin/registration-requests/${request.id}/approve`, {
        target_employee_id: targetEmployeeId
      });
      showToast('✅ Đã xác nhận và kích hoạt đúng hồ sơ nhân viên.');
      await Promise.all([fetchPendingRequests(), fetchStaff()]);
    } catch (error) {
      showToast(`❌ ${error.response?.data?.message || error.message}`);
    } finally {
      setReviewingRequestId(null);
    }
  };

  const rejectRegistration = async request => {
    const reason = window.prompt(`Lý do từ chối yêu cầu của ${request.requested_full_name}:`, 'Không xác minh được đúng nhân viên');
    if (reason === null) return;
    if (!reason.trim()) {
      showToast('⚠️ Vui lòng nhập lý do từ chối.');
      return;
    }
    setReviewingRequestId(request.id);
    try {
      await axios.post(`${API_URL}/admin/registration-requests/${request.id}/reject`, { reason: reason.trim() });
      showToast('Đã từ chối yêu cầu đăng ký.');
      await Promise.all([fetchPendingRequests(), fetchStaff()]);
    } catch (error) {
      showToast(`❌ ${error.response?.data?.message || error.message}`);
    } finally {
      setReviewingRequestId(null);
    }
  };

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

  const openPermissions = async user => {
    if (!selectedGroupId || selectedGroupId === 'ALL') {
      showToast('⚠️ Hãy chọn một nhóm kho cụ thể trước.');
      return;
    }
    try {
      const response = await axios.get(`${API_URL}/admin/warehouse/groups/${encodeURIComponent(selectedGroupId)}/permissions`);
      const codes = response.data.permission_codes || [];
      const employeeRow = (response.data.employees || []).find(e => e.id === user.id);
      setPermissionCodes(codes);
      setGrantedCodes(new Set(employeeRow?.permissions || []));
      setPermissionEmployee(user);
    } catch (error) {
      showToast(`❌ Không tải được danh sách quyền: ${error.response?.data?.message || error.message}`);
    }
  };

  const togglePermissionCode = code => {
    setGrantedCodes(current => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const savePermissions = async () => {
    if (!permissionEmployee) return;
    setSavingPermissions(true);
    try {
      await axios.put(
        `${API_URL}/admin/warehouse/groups/${encodeURIComponent(selectedGroupId)}/permissions/${permissionEmployee.id}`,
        { permissions: [...grantedCodes] }
      );
      showToast(`✅ Đã lưu quyền kho cho ${permissionEmployee.full_name}.`);
      setPermissionEmployee(null);
    } catch (error) {
      showToast(`❌ Không thể lưu quyền: ${error.response?.data?.message || error.message}`);
    } finally {
      setSavingPermissions(false);
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

      {pendingRequests.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-amber-500/20 bg-amber-500/[0.04]">
          <div className="flex items-center justify-between border-b border-amber-500/15 px-5 py-4">
            <div>
              <h3 className="flex items-center gap-2 text-base font-bold text-white">
                <Clock3 className="h-5 w-5 text-amber-400" />Yêu cầu đăng ký chờ duyệt ({pendingRequests.length})
              </h3>
              <p className="mt-1 text-xs text-slate-400">Kiểm tra người gửi và chọn đúng hồ sơ trước khi kích hoạt Telegram.</p>
            </div>
          </div>

          <div className="divide-y divide-white/[0.06]">
            {pendingRequests.map(request => {
              const selectedTarget = registrationTargets[request.id] || request.suggested_employee_id;
              const isReviewing = reviewingRequestId === request.id;
              return (
                <div key={request.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[1.1fr_1fr_1.4fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">{request.requested_full_name}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Telegram: <code className="text-amber-300">{request.telegram_id}</code>
                      {request.telegram_username ? ` · @${request.telegram_username}` : ''}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Tag tone="amber">PENDING · Chờ duyệt</Tag>
                      <Tag tone="cyan">Yêu cầu: {request.requested_role}</Tag>
                    </div>
                    <p className="truncate text-[11px] text-slate-400">{request.group_name || request.telegram_group_id}</p>
                  </div>

                  <label className="text-[11px] font-semibold text-slate-400">
                    Gắn vào hồ sơ nhân viên
                    <select
                      value={selectedTarget}
                      onChange={event => setRegistrationTargets(current => ({ ...current, [request.id]: event.target.value }))}
                      className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0F19] px-3 py-2 text-xs text-white outline-none focus:border-amber-500/50"
                    >
                      {(request.candidates || []).map(candidate => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.id === request.suggested_employee_id && request.is_new_profile
                            ? `Tạo hồ sơ mới: ${candidate.full_name}`
                            : `${candidate.full_name}${candidate.role ? ` — ${candidate.role}` : ''}`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => rejectRegistration(request)}
                      disabled={isReviewing}
                      className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-400 disabled:opacity-50"
                    >
                      Từ chối
                    </button>
                    <button
                      onClick={() => approveRegistration(request)}
                      disabled={isReviewing || !(request.candidates || []).length}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />{isReviewing ? 'Đang xử lý…' : 'Duyệt'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {registrationHistory.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111827]/70">
          <div className="border-b border-white/[0.06] px-5 py-4">
            <h3 className="text-sm font-bold text-white">Lịch sử đăng ký gần đây</h3>
            <p className="mt-1 text-xs text-slate-400">Các yêu cầu đã duyệt hoặc từ chối được giữ lại để kiểm tra.</p>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {registrationHistory.map(request => (
              <div key={request.id} className="grid gap-3 px-5 py-3 text-xs md:grid-cols-[1.2fr_0.8fr_1fr_1.4fr] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{request.requested_full_name}</p>
                  <p className="mt-1 text-[10px] text-slate-500">Telegram {request.telegram_id} · {request.group_name || request.telegram_group_id}</p>
                </div>
                <Tag tone={request.status === 'ACTIVE' ? 'emerald' : 'rose'}>
                  {request.status === 'ACTIVE' ? 'ACTIVE · Đã duyệt' : 'REJECTED · Từ chối'}
                </Tag>
                <div className="text-[11px] text-slate-400">
                  {request.status === 'ACTIVE'
                    ? `Hồ sơ: ${request.target_full_name || 'Đã kích hoạt'}`
                    : `Lý do: ${request.rejection_reason}`}
                </div>
                <div className="text-[10px] text-slate-500 md:text-right">
                  {request.reviewed_by || 'Admin'} · {request.reviewed_at ? new Date(request.reviewed_at).toLocaleString('vi-VN') : '—'}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
                          <>
                            <select
                              value={STAFF_ROLES.includes(editForm.role) ? editForm.role : OTHER_ROLE}
                              onChange={event => setEditForm({ ...editForm, role: event.target.value === OTHER_ROLE ? '' : event.target.value })}
                              className="w-full rounded-lg border border-cyan-500/40 bg-[#0B0F19] px-2.5 py-1.5 text-xs text-white outline-none"
                            >
                              {STAFF_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                              <option value={OTHER_ROLE}>{OTHER_ROLE}</option>
                            </select>
                            {!STAFF_ROLES.includes(editForm.role) && (
                              <input
                                value={editForm.role}
                                onChange={event => setEditForm({ ...editForm, role: event.target.value })}
                                placeholder="Nhập vai trò khác..."
                                className="mt-1.5 w-full rounded-lg border border-cyan-500/40 bg-[#0B0F19] px-2.5 py-1.5 text-xs text-white outline-none"
                              />
                            )}
                          </>
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
                            {/* <Tag tone="violet">{user.leave_quota ?? 12} ngày phép</Tag> */}
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
                            {user.selected_group_role === 'warehouse' && (
                              <button onClick={() => openPermissions(user)} className="inline-flex items-center gap-1 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-400 hover:bg-violet-500/20"><ShieldCheck className="h-3.5 w-3.5" />Quyền kho</button>
                            )}
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

      {permissionEmployee && (
        <WarehousePermissionModal
          employee={permissionEmployee}
          allCodes={permissionCodes}
          granted={grantedCodes}
          saving={savingPermissions}
          onToggle={togglePermissionCode}
          onClose={() => setPermissionEmployee(null)}
          onSave={savePermissions}
        />
      )}
    </div>
  );
}
