import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import StaffMembershipList from './StaffMembershipList.jsx';
import { groupStaffIdentities } from './utils/group-staff-identities.js';
import {
  Briefcase,
  Calendar,
  Check,
  Clock3,
  Edit3,
  Search,
  UserCheck,
  Users
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const displayStaffRole = role => String(role || '').trim().toLocaleLowerCase('vi') === 'admin' ? 'Admin' : String(role || '').trim();
// Dựa theo danh sách chức vụ nhân viên tự chọn lúc đăng ký ở register.html,
// cộng thêm Admin/Kế toán để Admin gán được ngay từ đây — tránh gõ tay ra một
// vai trò khác chữ (vd "Sale" vs "Sales") gây lệch thống kê theo vai trò.
// Lưu ý: chọn "Kế toán" ở đây chỉ là NHÃN hiển thị, không tự cấp quyền
// MANAGE_PRICING/VIEW_PRICING — vẫn phải bấm nút "Quyền kho" để cấp quyền
// thật cho nhóm cụ thể.
const ROW_GRID = 'grid-cols-[44px_minmax(260px,1.1fr)_minmax(420px,1.8fr)_minmax(210px,0.8fr)_100px]';

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
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    cyan: 'border-blue-500/25 bg-blue-500/10 text-blue-400',
    emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-400',
    rose: 'border-rose-500/25 bg-rose-500/10 text-rose-400',
    violet: 'border-violet-500/25 bg-violet-500/10 text-violet-400'
  };
  return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

function CompactSummary({ icon: Icon, label, value, tone }) {
  const tones = {
    cyan: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20'
  };
  return (
    <div className="flex min-h-[78px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${tones[tone]}`}><Icon className="h-5 w-5" /></div>
      <div><p className="text-xs text-slate-500">{label}</p><strong className="text-2xl leading-none text-slate-900">{value}</strong></div>
    </div>
  );
}

export default function StaffManagement({ selectedGroupId = 'ALL' }) {
  const navigate = useNavigate();
  const [staff, setStaff] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [registrationHistory, setRegistrationHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [groupFilter, setGroupFilter] = useState('ALL');
  const [toast, setToast] = useState(null);
  const [reviewingRequestId, setReviewingRequestId] = useState(null);
  const [registrationTargets, setRegistrationTargets] = useState({});

  const showToast = useCallback(message => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const openEmployeeProfile = user => {
    const params = new URLSearchParams();
    if (selectedGroupId && selectedGroupId !== 'ALL') params.set('nhom', selectedGroupId);
    navigate(params.toString() ? `/nhan-su/${user.id}?${params}` : `/nhan-su/${user.id}`);
  };

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const params = selectedGroupId && selectedGroupId !== 'ALL'
        ? `?group_id=${encodeURIComponent(selectedGroupId)}`
        : '';
      const response = await axios.get(`${API_URL}/admin/tk-users${params}`);
      setStaff(response.data.map(user => ({
        ...user,
        role: displayStaffRole(user.group_role ?? user.role),
        is_exempt_checkin: user.group_is_exempt_checkin ?? user.is_exempt_checkin,
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

  const groupedStaff = useMemo(() => groupStaffIdentities(staff), [staff]);

  const filteredStaff = useMemo(() => {
    const keyword = searchTerm.trim().toLocaleLowerCase('vi');
    return groupedStaff.filter(user => {
      const matchesName = !keyword || `${user.full_name} ${user.telegram_id}`.toLocaleLowerCase('vi').includes(keyword);
      const matchesRole = roleFilter === 'ALL' || user.memberships.some(item => item.role === roleFilter);
      const matchesGroup = groupFilter === 'ALL' || user.memberships.some(item => item.telegram_group_id === groupFilter);
      return matchesName && matchesRole && matchesGroup;
    });
  }, [groupFilter, groupedStaff, roleFilter, searchTerm]);

  const roles = useMemo(() => new Set(staff.map(user => user.role).filter(Boolean)).size, [staff]);
  const roleOptions = useMemo(() => [...new Set(staff.map(user => user.role).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [staff]);
  const groupOptions = useMemo(() => {
    const groupsById = new Map(staff.filter(user => user.telegram_group_id).map(user => [user.telegram_group_id, user.group_name || user.telegram_group_id]));
    return [...groupsById].sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  }, [staff]);

  return (
    <div className="space-y-5">
      <div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Quản lý nhân sự</h2>
          <p className="mt-1 text-xs text-slate-500">Nhân viên đã đăng ký qua Telegram Bot và thiết lập theo từng nhóm.</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-amber-500/20 bg-amber-500/[0.04]">
        <div className="flex items-center justify-between border-b border-amber-500/15 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Clock3 className="h-5 w-5 text-amber-400" />Yêu cầu đăng ký chờ duyệt ({pendingRequests.length})
            </h3>
            <p className="mt-1 text-xs text-slate-500">Kiểm tra người gửi và chọn đúng hồ sơ trước khi kích hoạt Telegram.</p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {pendingRequests.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              Hiện tại không có yêu cầu đăng ký nào đang chờ duyệt.
            </div>
          ) : (
            pendingRequests.map(request => {
              const selectedTarget = registrationTargets[request.id] || request.suggested_employee_id;
              const isReviewing = reviewingRequestId === request.id;
              return (
                <div key={request.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[1.1fr_1fr_1.4fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">{request.requested_full_name}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Telegram: <code className="text-amber-300">{request.telegram_id}</code>
                      {request.telegram_username ? ` · @${request.telegram_username}` : ''}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Tag tone="amber">PENDING · Chờ duyệt</Tag>
                      <Tag tone="cyan">Yêu cầu: {request.requested_role}</Tag>
                    </div>
                    <p className="truncate text-[11px] text-slate-500">{request.group_name || request.telegram_group_id}</p>
                  </div>

                  <label className="text-[11px] font-semibold text-slate-500">
                    Gắn vào hồ sơ nhân viên
                    <select
                      value={selectedTarget}
                      onChange={event => setRegistrationTargets(current => ({ ...current, [request.id]: event.target.value }))}
                      className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:border-amber-500/50"
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
            })
          )}
        </div>
      </section>

      {registrationHistory.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-sm font-bold text-slate-900">Lịch sử đăng ký gần đây</h3>
            <p className="mt-1 text-xs text-slate-500">Các yêu cầu đã duyệt hoặc từ chối được giữ lại để kiểm tra.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {registrationHistory.map(request => (
              <div key={request.id} className="grid gap-3 px-5 py-3 text-xs md:grid-cols-[1.2fr_0.8fr_1fr_1.4fr] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{request.requested_full_name}</p>
                  <p className="mt-1 text-[10px] text-slate-500">Telegram {request.telegram_id} · {request.group_name || request.telegram_group_id}</p>
                </div>
                <Tag tone={request.status === 'ACTIVE' ? 'emerald' : 'rose'}>
                  {request.status === 'ACTIVE' ? 'ACTIVE · Đã duyệt' : 'REJECTED · Từ chối'}
                </Tag>
                <div className="text-[11px] text-slate-500">
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
        <CompactSummary icon={Users} label="Tổng nhân sự" value={groupedStaff.length} tone="cyan" />
        <CompactSummary icon={Briefcase} label="Vai trò đang sử dụng" value={roles} tone="emerald" />
        <CompactSummary icon={Calendar} label="Phép mặc định / năm" value="12 ngày" tone="violet" />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex min-h-16 flex-col gap-4 border-b border-slate-100 px-4 py-4 xl:flex-row xl:items-center xl:justify-between xl:px-5">
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <UserCheck className="h-5 w-5 text-blue-400" />Danh sách nhân sự ({filteredStaff.length})
          </h3>
          <div className="grid w-full gap-2 sm:grid-cols-3 xl:w-auto xl:min-w-[760px]">
            <label className="flex items-center rounded-lg border border-slate-200 bg-white px-3 focus-within:border-blue-400"><Search className="h-4 w-4 shrink-0 text-slate-400" /><input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Lọc theo tên hoặc Telegram ID" className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-xs text-slate-800 outline-none" /></label>
            <select value={roleFilter} onChange={event => setRoleFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 outline-none focus:border-blue-400"><option value="ALL">Tất cả vai trò</option>{roleOptions.map(role => <option key={role} value={role}>{role}</option>)}</select>
            <select value={groupFilter} onChange={event => setGroupFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 outline-none focus:border-blue-400"><option value="ALL">Tất cả nhóm</option>{groupOptions.map(([groupId, groupName]) => <option key={groupId} value={groupId}>{groupName}</option>)}</select>
          </div>
        </div>

        <div className="divide-y divide-slate-100 md:hidden">
          {loading ? <div className="flex h-32 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" /></div> : filteredStaff.length === 0 ? <div className="px-5 py-10 text-center text-sm text-slate-500">{searchTerm ? 'Không tìm thấy nhân sự phù hợp.' : 'Chưa có nhân sự đăng ký.'}</div> : filteredStaff.map((user, index) => (
            <div key={user.identity_key} role="link" tabIndex={0} onClick={() => openEmployeeProfile(user)} onKeyDown={event => { if (event.key === 'Enter') openEmployeeProfile(user); }} className="block w-full px-4 py-4 text-left active:bg-blue-50">
              <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{initials(user.full_name)}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-bold text-slate-900">{user.full_name}</p><span className="text-[10px] text-slate-400">#{index + 1}</span></div><p className="mt-1 text-[10px] text-slate-500">Telegram {user.telegram_id || 'Chưa liên kết'}</p></div></div>
              <div className="mt-3 space-y-2">{user.memberships.map(membership => { const paused = membership.membership_status === 'PAUSED'; return <div key={`${membership.employee_id}:${membership.telegram_group_id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap items-center gap-2"><Tag tone="cyan">{membership.role || 'Chưa có vai trò'}</Tag><span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-600">{membership.group_name}</span></div><div className="mt-2"><Tag tone={paused ? 'amber' : 'emerald'}>{paused ? '⏸ Tạm dừng' : '▶ Hoạt động'}</Tag></div></div>; })}</div>
              <button type="button" onClick={event => { event.stopPropagation(); openEmployeeProfile(user); }} className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs font-semibold text-blue-600"><Edit3 className="h-4 w-4" />Sửa và xem thống kê</button>
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <div className="min-w-[1120px]">
            <div className={`grid ${ROW_GRID} items-center gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500`}>
              <span>#</span>
              <span>Nhân viên</span>
              <span>Vai trò & nhóm</span>
              <span>Trạng thái</span>
              <span className="text-right">Thao tác</span>
            </div>

            {loading ? (
              <div className="flex h-40 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500/25 border-t-blue-500" /></div>
            ) : filteredStaff.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-slate-500">
                {searchTerm ? 'Không tìm thấy nhân sự phù hợp.' : 'Chưa có nhân sự đăng ký.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredStaff.map((user, index) => {
                  return (
                    <div
                      key={user.identity_key}
                      role="link"
                      tabIndex={0}
                      aria-label={`Mở hồ sơ nhân viên ${user.full_name}`}
                      onClick={() => openEmployeeProfile(user)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openEmployeeProfile(user);
                        }
                      }}
                      className={`grid ${ROW_GRID} min-h-[92px] items-center gap-4 px-5 py-3 transition hover:bg-blue-50/40 cursor-pointer focus:bg-blue-50/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-300`}
                    >
                      <span className="text-xs font-semibold text-slate-500">{index + 1}</span>

                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-xs font-bold text-white">
                          {initials(user.full_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900" title={user.full_name}>{user.full_name}</p>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                            <code className="rounded bg-slate-50 px-1.5 py-0.5 text-slate-500">{user.telegram_id || 'Chưa có ID'}</code>
                            <span>Đăng ký {user.created_at ? new Date(user.created_at).toLocaleDateString('vi-VN') : '—'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0 space-y-2">
                        <StaffMembershipList memberships={user.memberships} />
                      </div>

                      <div className="space-y-1.5">
                        {user.memberships.map(membership => { const paused = membership.membership_status === 'PAUSED'; return <div key={`${membership.employee_id}:${membership.telegram_group_id}`} className="flex min-h-[42px] items-center"><Tag tone={paused ? 'amber' : 'emerald'}>{paused ? '⏸ Tạm dừng tại nhóm' : '▶ Hoạt động tại nhóm'}</Tag></div>; })}
                      </div>

                      <div className="flex justify-end" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                        <button type="button" onClick={() => openEmployeeProfile(user)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-100"><Edit3 className="h-4 w-4" />Sửa</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-blue-500/30 bg-white px-5 py-3 text-sm font-medium text-slate-900 shadow-2xl">{toast}</div>}

    </div>
  );
}
