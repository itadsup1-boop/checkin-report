import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Zap
} from 'lucide-react';
import LoginScreen from './LoginScreen.jsx';
import StaffManagement from './StaffManagement.jsx';
import CheckinManagement from './CheckinManagement.jsx';
import ScheduleManagement from './ScheduleManagement.jsx';
import LeaveManagement from './LeaveManagement.jsx';
import DashboardTab from './DashboardTab.jsx';
import AdminManagement from './AdminManagement.jsx';
import WarehouseManagement from './WarehouseManagement.jsx';
import SettingsManagement from './SettingsManagement.jsx';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const TAB_TITLES = {
  dashboard: 'Tổng quan',
  staff: 'Nhân sự',
  checkins: 'Điểm danh',
  schedules: 'Lịch làm việc',
  leave: 'Nghỉ phép & Quỹ phép',
  warehouse: 'Quản lý kho',
  settings: 'Cấu hình nhóm',
  admins: 'Tài khoản quản trị'
};

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

  const logout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    setUser(null);
    setIsLoggedIn(false);
  };

  if (!isLoggedIn) {
    return <LoginScreen onLogin={authenticatedUser => {
      setUser(authenticatedUser || savedAdmin());
      setIsLoggedIn(true);
    }} />;
  }

  return <AdminShell user={user} onLogout={logout} />;
}

function AdminShell({ user, onLogout }) {
  const [groups, setGroups] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedGroupId, setSelectedGroupId] = useState('ALL');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback(message => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    const interceptor = axios.interceptors.request.use(config => {
      const admin = savedAdmin();
      if (admin?.id) config.headers['x-admin-id'] = admin.id;
      if (admin?.role) config.headers['x-admin-role'] = admin.role;
      return config;
    });
    return () => axios.interceptors.request.eject(interceptor);
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/groups`);
      setGroups(response.data);
    } catch (error) {
      console.error('Không tải được danh sách nhóm:', error);
      showToast('❌ Không tải được danh sách nhóm.');
    }
  }, [showToast]);

  useEffect(() => {
    const requestId = window.setTimeout(fetchGroups, 0);
    return () => window.clearTimeout(requestId);
  }, [fetchGroups]);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const displayGroups = useMemo(() => {
    const assignedGroupIds = user?.assigned_groups || [];
    return isSuperAdmin
      ? groups
      : groups.filter(group => assignedGroupIds.includes(group.telegram_group_id));
  }, [groups, isSuperAdmin, user?.assigned_groups]);
  const showWarehouse = isSuperAdmin || displayGroups.some(group => group.bot_role === 'warehouse');

  const navigateTo = tab => {
    setActiveTab(tab);
    setMobileSidebarOpen(false);
  };

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

  const navItems = [
    { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'staff', label: 'Nhân sự', icon: UserCheck },
    { id: 'checkins', label: 'Điểm danh', icon: ClipboardCheck },
    { id: 'schedules', label: 'Lịch làm việc', icon: CalendarDays },
    { id: 'leave', label: 'Nghỉ phép & Quỹ phép', icon: CalendarX },
    ...(showWarehouse ? [{ id: 'warehouse', label: 'Quản lý kho', icon: Package }] : []),
    { id: 'settings', label: 'Cấu hình nhóm', icon: Settings },
    ...(isSuperAdmin ? [{ id: 'admins', label: 'Tài khoản quản trị', icon: Shield }] : [])
  ];

  return (
    <div className="flex min-h-screen bg-[#0B0F19] font-sans text-slate-200 selection:bg-cyan-500/30">
      {mobileSidebarOpen && <button type="button" aria-label="Đóng menu" onClick={() => setMobileSidebarOpen(false)} className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden" />}

      <aside className={`fixed inset-y-0 left-0 z-40 flex h-screen w-72 flex-col border-r border-white/5 bg-[#111827]/95 backdrop-blur-xl transition-transform duration-200 md:sticky md:top-0 md:translate-x-0 ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between border-b border-white/5 p-6 md:p-8">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 p-2 shadow-lg shadow-cyan-500/20"><Zap className="h-6 w-6 text-white" /></div>
            <h1 className="bg-gradient-to-r from-white to-slate-400 bg-clip-text text-2xl font-bold text-transparent">KPI Master</h1>
          </div>
          <button type="button" onClick={() => setMobileSidebarOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white md:hidden" aria-label="Đóng menu"><X className="h-5 w-5" /></button>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto px-4 py-6">
          {navItems.map(item => <NavItem key={item.id} {...item} active={activeTab === item.id} onClick={() => navigateTo(item.id)} />)}
        </nav>

        <div className="m-4 p-4">
          <button type="button" onClick={onLogout} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 py-2.5 text-sm font-medium text-rose-400 hover:bg-rose-500/20">
            <LogOut className="h-4 w-4" />Đăng xuất
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-20 items-center justify-between gap-3 border-b border-white/5 bg-[#0B0F19]/90 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setMobileSidebarOpen(true)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white md:hidden" aria-label="Mở menu"><Menu className="h-6 w-6" /></button>
            {activeTab !== 'warehouse' && <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-[#111827] px-3 py-2 sm:px-4">
              <Users className="h-4 w-4 shrink-0 text-cyan-400" />
              <select value={selectedGroupId} onChange={event => setSelectedGroupId(event.target.value)} className="max-w-[145px] cursor-pointer truncate border-none bg-transparent text-xs font-medium text-white outline-none sm:max-w-[280px] sm:text-sm">
                <option value="ALL" className="bg-[#111827]">Tất cả nhóm ({displayGroups.length})</option>
                {displayGroups.map(group => <option key={group.telegram_group_id} value={group.telegram_group_id} className="bg-[#111827]">{group.group_name || `Nhóm ${group.telegram_group_id}`}</option>)}
              </select>
            </div>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-white">{user?.full_name || user?.username || 'Admin'}</p>
              <p className="text-xs font-medium text-cyan-400">{isSuperAdmin ? 'Super Admin' : 'Admin'}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-cyan-500 to-blue-500 text-xs font-bold text-white">{user?.username?.slice(0, 2)?.toUpperCase() || 'AD'}</div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <h1 className="sr-only">{TAB_TITLES[activeTab]}</h1>
          {activeTab === 'dashboard' && <DashboardTab selectedGroupId={selectedGroupId} onNavigate={navigateTo} />}
          {activeTab === 'staff' && <StaffManagement selectedGroupId={selectedGroupId} />}
          {activeTab === 'checkins' && <CheckinManagement selectedGroupId={selectedGroupId} />}
          {activeTab === 'schedules' && <ScheduleManagement selectedGroupId={selectedGroupId} />}
          {activeTab === 'leave' && <LeaveManagement selectedGroupId={selectedGroupId} />}
          {activeTab === 'warehouse' && showWarehouse && <WarehouseManagement />}
          {activeTab === 'settings' && <SettingsManagement groups={displayGroups} selectedGroupId={selectedGroupId} onUpdate={updateGroupSettings} onDelete={deleteGroup} />}
          {activeTab === 'admins' && isSuperAdmin && <AdminManagement groups={groups} />}
        </div>
      </main>

      {toast && <div className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-cyan-500/30 bg-[#111827] px-5 py-3 text-sm font-medium text-white shadow-2xl shadow-cyan-500/20">{toast}</div>}
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left font-medium transition ${active ? 'border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 to-blue-500/5 text-cyan-400' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white'}`}>
      <Icon className={`h-5 w-5 ${active ? 'text-cyan-400' : 'text-slate-500'}`} />{label}
    </button>
  );
}
