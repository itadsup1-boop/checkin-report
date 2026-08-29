import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  CalendarDays,
  CalendarX,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  Shield,
  UserCheck,
  Users,
  X,
  ShieldCheck
} from 'lucide-react';
import LoginScreen from '../features/auth/LoginScreen.jsx';
import StaffManagement from '../features/staff/StaffManagement.jsx';
import EmployeeDetailPage from '../features/staff/detail/EmployeeDetailPage.jsx';
import CheckinManagement from '../features/attendance/CheckinManagement.jsx';
import ScheduleManagement from '../features/schedule/ScheduleManagement.jsx';
import LeaveManagement from '../features/leave/LeaveManagement.jsx';
import DashboardTab from '../features/dashboard/DashboardTab.jsx';
import AdminManagement from '../features/admin/AdminManagement.jsx';
import WarehouseManagement from '../features/warehouse/WarehouseManagement.jsx';
import SettingsManagement from '../features/settings/SettingsManagement.jsx';

const API_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * Mỗi mục menu là một đường dẫn thật, để tải lại trang không mất chỗ đang đứng.
 *
 * `id` giữ nguyên tên cũ vì DashboardTab gọi onNavigate('checkins'), và
 * AdminShell.test.js đối chiếu theo nhãn. Đổi `path` thì đổi luôn link cũ của
 * người dùng đã lưu, nên coi như hợp đồng.
 */
const TABS = [
  { id: 'dashboard', path: '/dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'staff', path: '/nhan-su', label: 'Nhân sự', icon: UserCheck },
  { id: 'checkins', path: '/diem-danh', label: 'Check in', icon: ClipboardCheck },
  { id: 'schedules', path: '/lich-lam-viec', label: 'Lịch làm việc', icon: CalendarDays },
  { id: 'leave', path: '/nghi-phep', label: 'Nghỉ phép & Quỹ phép', icon: CalendarX },
  { id: 'warehouse', path: '/kho', label: 'Quản lý kho', icon: Package },
  { id: 'settings', path: '/cau-hinh', label: 'Cấu hình nhóm', icon: Settings },
  { id: 'admins', path: '/tai-khoan', label: 'Tài khoản quản trị', icon: Shield, needsSuperAdmin: true }
];

const PATH_BY_ID = Object.fromEntries(TABS.map(tab => [tab.id, tab.path]));

/** Nhóm đang lọc nằm trên URL (?nhom=…) nên tải lại trang vẫn giữ đúng nhóm. */
const GROUP_PARAM = 'nhom';

function savedAdmin() {
  try {
    const value = localStorage.getItem('admin_user');
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(localStorage.getItem('admin_token')));
  const [user, setUser] = useState(savedAdmin);
  const [checkingSession, setCheckingSession] = useState(() => Boolean(localStorage.getItem('admin_token')));

  const clearSession = useCallback(() => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_token_expires_at');
    localStorage.removeItem('admin_user');
    setUser(null);
    setIsLoggedIn(false);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    axios.get(`${API_URL}/admin/session`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => {
        localStorage.setItem('admin_user', JSON.stringify(response.data.user));
        setUser(response.data.user);
        setIsLoggedIn(true);
      })
      .catch(clearSession)
      .finally(() => setCheckingSession(false));
  }, [clearSession]);

  const logout = async () => {
    const token = localStorage.getItem('admin_token');
    try {
      if (token) {
        await axios.post(`${API_URL}/admin/logout`, {}, { headers: { Authorization: `Bearer ${token}` } });
      }
    } catch {
      // Phiên đã hết hạn cũng được coi là đăng xuất thành công ở trình duyệt.
    } finally {
      clearSession();
    }
  };

  if (checkingSession) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">Đang xác thực phiên quản trị…</div>;
  }

  if (!isLoggedIn) {
    return <LoginScreen onLogin={authenticatedUser => {
      setUser(authenticatedUser || savedAdmin());
      setIsLoggedIn(true);
    }} />;
  }

  return <AdminShell user={user} onLogout={logout} onSessionExpired={clearSession} />;
}

function AdminShell({ user, onLogout, onSessionExpired }) {
  const [groups, setGroups] = useState([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedGroupId = searchParams.get(GROUP_PARAM) || 'ALL';

  /** Đổi nhóm là đổi URL. `replace` để nút Quay lại không kẹt ở từng lần đổi nhóm. */
  const setSelectedGroupId = useCallback(value => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      if (!value || value === 'ALL') next.delete(GROUP_PARAM);
      else next.set(GROUP_PARAM, value);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const showToast = useCallback(message => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use(config => {
      const token = localStorage.getItem('admin_token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    const responseInterceptor = axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status === 401) onSessionExpired();
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, [onSessionExpired]);

  const fetchGroups = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/groups`);
      setGroups(response.data);
    } catch (error) {
      console.error('Không tải được danh sách nhóm:', error);
      showToast('❌ Không tải được danh sách nhóm.');
    } finally {
      setGroupsLoaded(true);
    }
  }, [showToast]);

  useEffect(() => {
    const requestId = window.setTimeout(fetchGroups, 0);
    return () => window.clearTimeout(requestId);
  }, [fetchGroups]);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isWarehouseAccountant = user?.role === 'WAREHOUSE_ACCOUNTANT';
  const homePath = isWarehouseAccountant ? '/kho/san-pham' : PATH_BY_ID.dashboard;
  const displayGroups = useMemo(() => {
    const assignedGroupIds = user?.assigned_groups || [];
    return isSuperAdmin
      ? groups
      : groups.filter(group => assignedGroupIds.includes(group.telegram_group_id));
  }, [groups, isSuperAdmin, user?.assigned_groups]);
  const showWarehouse = isSuperAdmin || displayGroups.some(group => group.bot_role === 'warehouse');

  /** Giữ nguyên chữ ký cũ: DashboardTab vẫn gọi onNavigate('checkins'). */
  const navigateTo = useCallback(tab => {
    if (isWarehouseAccountant) {
      navigate('/kho/san-pham');
      setMobileSidebarOpen(false);
      return;
    }
    const path = PATH_BY_ID[tab] || PATH_BY_ID.dashboard;
    // Mang theo nhóm đang lọc để đổi màn hình không mất bộ lọc.
    const query = searchParams.toString();
    navigate(query ? `${path}?${query}` : path);
    setMobileSidebarOpen(false);
  }, [isWarehouseAccountant, navigate, searchParams]);

  const updateGroupSettings = async (telegramGroupId, settings) => {
    try {
      await axios.put(`${API_URL}/tk_group_settings/${telegramGroupId}`, settings);
      showToast('✅ Đã cập nhật cài đặt nhóm.');
      await fetchGroups();
    } catch (error) {
      showToast(`❌ Không thể cập nhật nhóm: ${error.response?.data?.error || error.message}`);
      throw error;
    }
  };

  const deleteGroup = async telegramGroupId => {
    if (!window.confirm('Bạn có chắc muốn xóa nhóm này khỏi hệ thống?')) return;
    try {
      await axios.delete(`${API_URL}/groups/${telegramGroupId}`);
      if (String(selectedGroupId) === String(telegramGroupId)) setSelectedGroupId('ALL');
      showToast('✅ Đã xóa nhóm.');
      await fetchGroups();
    } catch (error) {
      showToast(`❌ Không thể xóa nhóm: ${error.response?.data?.error || error.message}`);
    }
  };

  // Luôn hiển thị mục Kho để người dùng không hiểu nhầm rằng chức năng bị thiếu.
  // Quyền truy cập thật vẫn được kiểm tra ở route và phía API.
  const navItems = isWarehouseAccountant
    ? TABS.filter(tab => tab.id === 'warehouse')
    : TABS.filter(tab => !tab.needsSuperAdmin || isSuperAdmin);
  const canAccessGeneralAdmin = !isWarehouseAccountant;

  /**
   * Chặn vào màn hình không đủ quyền bằng đường dẫn trực tiếp.
   *
   * Phải chờ danh sách nhóm tải xong mới xét: lúc đầu `groups` còn rỗng nên
   * `showWarehouse` là false, xét sớm sẽ đá nhầm người có quyền ra khỏi /kho.
   */
  const guard = allowed => {
    if (!groupsLoaded) return null;
    return allowed ? null : <Navigate to={homePath} replace />;
  };

  const shell = (
    <AdminLayout
      user={user}
      isSuperAdmin={isSuperAdmin}
      isWarehouseAccountant={isWarehouseAccountant}
      navItems={navItems}
      displayGroups={displayGroups}
      selectedGroupId={selectedGroupId}
      onSelectGroup={setSelectedGroupId}
      onNavigate={navigateTo}
      onLogout={onLogout}
      mobileSidebarOpen={mobileSidebarOpen}
      setMobileSidebarOpen={setMobileSidebarOpen}
      toast={toast}
    />
  );

  return (
    <Routes>
      <Route element={shell}>
        <Route index element={<Navigate to={homePath} replace />} />
        <Route path="/dashboard" element={guard(canAccessGeneralAdmin) ?? <DashboardTab selectedGroupId={selectedGroupId} onNavigate={navigateTo} />} />
        <Route path="/nhan-su" element={guard(canAccessGeneralAdmin) ?? <StaffManagement selectedGroupId={selectedGroupId} />} />
        <Route path="/nhan-su/:employeeId" element={guard(canAccessGeneralAdmin) ?? <EmployeeDetailPage selectedGroupId={selectedGroupId} />} />
        <Route path="/diem-danh" element={guard(canAccessGeneralAdmin) ?? <CheckinManagement selectedGroupId={selectedGroupId} />} />
        <Route path="/lich-lam-viec" element={guard(canAccessGeneralAdmin) ?? <ScheduleManagement selectedGroupId={selectedGroupId} />} />
        <Route path="/nghi-phep" element={guard(canAccessGeneralAdmin) ?? <LeaveManagement selectedGroupId={selectedGroupId} />} />
        <Route
          path="/kho/*"
          element={!groupsLoaded
            ? <PageLoading label="Đang kiểm tra quyền quản lý kho…" />
            : showWarehouse
              ? <WarehouseManagement groups={displayGroups.filter(group => group.bot_role === 'warehouse')} />
              : <WarehouseAccessNotice />}
        />
        <Route path="/cau-hinh" element={guard(canAccessGeneralAdmin) ?? <SettingsManagement groups={displayGroups} selectedGroupId={selectedGroupId} onUpdate={updateGroupSettings} onDelete={deleteGroup} />} />
        <Route path="/tai-khoan" element={guard(isSuperAdmin) ?? <AdminManagement groups={groups} />} />
        {/* Đường dẫn lạ hoặc link cũ đều về Tổng quan thay vì trang trắng. */}
        <Route path="*" element={<Navigate to={homePath} replace />} />
      </Route>
    </Routes>
  );
}

function AdminLayout({
  user, isSuperAdmin, isWarehouseAccountant, navItems, displayGroups, selectedGroupId, onSelectGroup,
  onNavigate, onLogout, mobileSidebarOpen, setMobileSidebarOpen, toast
}) {
  const activeTab = useActiveTabId();

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-900">
      {mobileSidebarOpen && <button type="button" aria-label="Đóng menu" onClick={() => setMobileSidebarOpen(false)} className="fixed inset-0 z-30 bg-slate-900/50 md:hidden" />}

      <aside className={`fixed inset-y-0 left-0 z-40 flex h-screen w-72 flex-col bg-slate-950 text-white transition-transform duration-200 md:sticky md:top-0 md:translate-x-0 ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-20 items-center justify-between gap-3 border-b border-slate-800 px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-2.5"><ShieldCheck className="h-6 w-6" /></div>
            <div>
              <p className="font-bold leading-tight">KPI Master</p>
              <p className="text-xs text-slate-400">Business Management</p>
            </div>
          </div>
          <button type="button" onClick={() => setMobileSidebarOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white md:hidden" aria-label="Đóng menu"><X className="h-5 w-5" /></button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Quản trị hệ thống</p>
          {navItems.map(item => <NavItem key={item.id} {...item} active={activeTab === item.id} onClick={() => onNavigate(item.id)} />)}
        </nav>

        <div className="border-t border-slate-800 p-4">
          <button type="button" onClick={onLogout} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 py-2.5 text-sm font-medium text-rose-400 hover:bg-rose-500/20">
            <LogOut className="h-4 w-4" />Đăng xuất
          </button>
        </div>
      </aside>

      <div className="ml-0 flex h-screen flex-1 flex-col md:ml-0">
        <header className="sticky top-0 z-20 flex min-h-20 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setMobileSidebarOpen(true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Mở menu"><Menu className="h-6 w-6" /></button>
            {activeTab !== 'warehouse' && <div className="flex min-w-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 sm:px-4">
              <Users className="h-4 w-4 shrink-0 text-blue-600" />
              <select value={selectedGroupId} onChange={event => onSelectGroup(event.target.value)} className="max-w-[145px] cursor-pointer truncate border-none bg-transparent text-xs font-medium text-slate-700 outline-none sm:max-w-[280px] sm:text-sm">
                <option value="ALL">Tất cả nhóm ({displayGroups.length})</option>
                {displayGroups.map(group => <option key={group.telegram_group_id} value={group.telegram_group_id}>{group.group_name || `Nhóm ${group.telegram_group_id}`}</option>)}
              </select>
            </div>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-slate-800">{user?.full_name || user?.username || 'Admin'}</p>
              <p className="text-xs font-medium text-blue-600">{isSuperAdmin ? 'Super Admin' : (isWarehouseAccountant ? 'Kế toán kho' : 'Admin')}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{user?.username?.slice(0, 2)?.toUpperCase() || 'AD'}</div>
          </div>
        </header>

        <main className="flex flex-1 flex-col overflow-y-auto p-4 sm:p-6 lg:p-8">
          <h1 className="sr-only">{TABS.find(tab => tab.id === activeTab)?.label || 'Tổng quan'}</h1>
          <Outlet />
        </main>
      </div>

      {toast && <div className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-800 shadow-xl">{toast}</div>}
    </div>
  );
}

/**
 * Mục menu nào đang sáng, suy từ đường dẫn hiện tại.
 *
 * Phải dùng useLocation chứ không phải window.location: đọc thẳng window thì
 * React không biết đường dẫn đã đổi, ô menu sẽ đứng yên ở mục cũ.
 */
function useActiveTabId() {
  const { pathname } = useLocation();
  const match = TABS.find(tab => pathname === tab.path || pathname.startsWith(`${tab.path}/`));
  return match?.id || 'dashboard';
}

function NavItem({ icon: Icon, label, active, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${active ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}>
      <Icon className="h-[19px] w-[19px]" /><span>{label}</span>
    </button>
  );
}

function PageLoading({ label }) {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500 shadow-sm">
      {label}
    </div>
  );
}

function WarehouseAccessNotice() {
  return (
    <div className="flex min-h-[420px] items-center justify-center">
      <section className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <Package className="h-7 w-7" />
        </div>
        <h2 className="mt-5 text-xl font-bold text-slate-900">Chưa được cấp quyền quản lý kho</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Chức năng Kho vẫn có trong hệ thống. Tài khoản này cần được Super Admin gán vào ít nhất một nhóm Telegram có vai trò Quản lý kho trước khi sử dụng.
        </p>
      </section>
    </div>
  );
}
