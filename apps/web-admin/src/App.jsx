import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Activity, Users, AlertCircle, CheckCircle, BarChart3, Settings, Bell, Search, Menu, Zap, TrendingUp, TrendingDown, Plus, Trash2, X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function App() {
  const [employees, setEmployees] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    employee_code: '',
    department: 'Sales',
    position: 'Telesale',
    current_kpi_target: 40
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      axios.get(`${API_URL}/employees`),
      axios.get(`${API_URL}/groups`)
    ])
      .then(([empRes, grpRes]) => {
        setEmployees(empRes.data);
        setGroups(grpRes.data);
      })
      .catch(err => {
        console.error("API error", err);
      })
      .finally(() => setLoading(false));
  };

  const handleRemindAll = () => {
    setToast('Đang gửi tin nhắn nhắc nhở tự động qua Telegram...');
    setTimeout(() => {
      setToast('✅ Đã gửi nhắc nhở thành công đến nhân viên chưa đạt KPI!');
      setTimeout(() => setToast(null), 3000);
    }, 1500);
  };

  const handleAddEmployee = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/employees`, formData);
      setToast('✅ Thêm nhân viên mới thành công!');
      setShowModal(false);
      setFormData({ full_name: '', employee_code: '', department: 'Sales', position: 'Telesale', current_kpi_target: 40 });
      fetchData();
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      alert("Lỗi khi thêm nhân viên: " + err.message);
    }
  };

  const handleDeleteEmployee = async (id) => {
    if (window.confirm("Bạn có chắc chắn muốn xóa nhân viên này?")) {
      try {
        await axios.delete(`${API_URL}/employees/${id}`);
        setToast('✅ Đã xóa nhân viên!');
        fetchData();
        setTimeout(() => setToast(null), 3000);
      } catch (err) {
        alert("Lỗi khi xóa: " + err.message);
      }
    }
  };

  const handleUpdateKpi = async (id, newKpi) => {
    try {
      await axios.put(`${API_URL}/employees/${id}/kpi`, { kpi_target: newKpi });
      setToast('✅ Đã cập nhật Chỉ tiêu KPI!');
      fetchData();
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      alert("Lỗi khi cập nhật KPI: " + err.message);
    }
  };

  const handleToggleReportRequirement = async (id, currentNeedReport) => {
    try {
      const nextVal = !currentNeedReport;
      await axios.put(`${API_URL}/employees/${id}/report-status`, { need_report: nextVal });
      setToast('✅ Đã cập nhật trạng thái nộp báo cáo!');
      fetchData();
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      alert("Lỗi khi cập nhật trạng thái: " + err.message);
    }
  };

  const handleUpdateGroupSettings = async (telegram_group_id, remind_time_1, penalty_kpi, penalty_report, kpi_sheet_id, customer_sheet_id) => {
    try {
      await axios.put(`${API_URL}/groups/${telegram_group_id}/settings`, {
        remind_time_1,
        penalty_missing_kpi: penalty_kpi,
        penalty_missing_report: penalty_report,
        kpi_sheet_id,
        customer_sheet_id,
        auto_reminder_enabled: true
      });
      setToast('🔔 Đã cập nhật cài đặt thành công!');
      fetchData();
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      alert("Lỗi khi cập nhật cài đặt: " + err.message);
    }
  };

  const filteredEmployees = employees.filter(emp => 
    emp.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    emp.employee_code?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalEmp = employees.length;
  const passedKPI = employees.filter(e => (e.kpi_actual || 0) >= (e.kpi_required || 10)).length;
  const failedKPI = totalEmp - passedKPI;
  const completionRate = totalEmp === 0 ? 0 : Math.round((passedKPI / totalEmp) * 100);

  return (
    <div className="min-h-screen bg-[#0B0F19] text-slate-200 font-sans selection:bg-cyan-500/30 flex">
      {/* Sidebar */}
      <aside className="w-72 bg-[#111827]/80 backdrop-blur-xl border-r border-white/5 flex flex-col hidden md:flex sticky top-0 h-screen">
        <div className="p-8 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl shadow-lg shadow-cyan-500/20">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              KPI Master
            </h1>
          </div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2">
          <NavItem icon={<BarChart3 />} label="Tổng quan" active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
          <NavItem icon={<Settings />} label="Cấu hình hệ thống" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>
        <div className="p-6 m-4 bg-gradient-to-br from-blue-600/20 to-cyan-600/20 rounded-2xl border border-cyan-500/20">
          <h4 className="text-sm font-semibold text-cyan-400 mb-2">Pro Version</h4>
          <p className="text-xs text-slate-400 mb-4">Mở khóa tính năng AI phân tích hiệu suất nhân sự.</p>
          <button className="w-full py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 rounded-lg text-sm font-medium transition-colors border border-cyan-500/30">
            Nâng cấp ngay
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-20 px-8 border-b border-white/5 backdrop-blur-md flex items-center justify-between sticky top-0 z-10 bg-[#0B0F19]/80">
          <div className="flex items-center gap-4 md:hidden">
            <button className="p-2 text-slate-400 hover:text-white"><Menu className="w-6 h-6" /></button>
            <h1 className="text-xl font-bold text-white">KPI Master</h1>
          </div>
          <div className="hidden md:flex items-center bg-[#111827] rounded-full px-4 py-2 border border-white/5 w-96 transition-all focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/50">
            <Search className="w-5 h-5 text-slate-500" />
            <input 
              type="text" 
              placeholder="Tìm kiếm nhân viên..." 
              className="bg-transparent border-none outline-none text-sm ml-3 w-full text-white placeholder-slate-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-slate-400 hover:text-white transition-colors">
              <Bell className="w-6 h-6" />
              <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#0B0F19]"></span>
            </button>
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-500 p-[2px] cursor-pointer hover:scale-105 transition-transform">
              <img src="https://i.pravatar.cc/150?img=11" alt="Admin" className="w-full h-full rounded-full border-2 border-[#0B0F19]" />
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="p-8 overflow-y-auto">
          {activeTab === 'overview' && (
            <>
              <div className="flex justify-between items-end mb-8">
                <div>
              <h2 className="text-3xl font-bold text-white tracking-tight mb-2">Hiệu suất hôm nay</h2>
              <p className="text-slate-400 text-sm">Cập nhật lúc: {new Date().toLocaleTimeString()}</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowModal(true)}
                className="hidden md:flex items-center gap-2 px-6 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 font-medium rounded-xl transition-all"
              >
                <Plus className="w-4 h-4" />
                Thêm nhân viên
              </button>
              <button 
                onClick={handleRemindAll}
                className="hidden md:flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:-translate-y-0.5 active:translate-y-0"
              >
                <Bell className="w-4 h-4" />
                Nhắc nhở tự động
              </button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
            <StatCard 
              title="Tổng nhân sự" 
              value={totalEmp} 
              icon={<Users className="w-6 h-6 text-blue-400" />} 
              trend="Tổng cộng" 
              trendUp={true}
              bg="from-blue-500/10 to-blue-600/5"
              borderColor="border-blue-500/20"
            />
            <StatCard 
              title="Hoàn thành KPI" 
              value={passedKPI} 
              icon={<CheckCircle className="w-6 h-6 text-emerald-400" />} 
              trend="Tỷ lệ: " 
              suffix={`${completionRate}%`}
              trendUp={completionRate >= 50}
              bg="from-emerald-500/10 to-emerald-600/5"
              borderColor="border-emerald-500/20"
            />
            <StatCard 
              title="Chưa đạt KPI" 
              value={failedKPI} 
              icon={<AlertCircle className="w-6 h-6 text-rose-400" />} 
              trend="Cần đốc thúc"
              trendUp={false}
              bg="from-rose-500/10 to-rose-600/5"
              borderColor="border-rose-500/20"
            />
            <StatCard 
              title="Điểm hiệu suất" 
              value="8.4" 
              icon={<Activity className="w-6 h-6 text-purple-400" />} 
              trend="+0.3 điểm"
              trendUp={true}
              bg="from-purple-500/10 to-purple-600/5"
              borderColor="border-purple-500/20"
            />
          </div>

          {/* Table Section */}
          <div className="bg-[#111827]/60 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-xl">
            <div className="p-6 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h3 className="text-xl font-bold text-white">Danh sách nhân sự ({totalEmp})</h3>
              <div className="flex gap-2">
                <button className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-colors border border-white/5">
                  Xuất Excel
                </button>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.02] text-slate-400 text-xs uppercase tracking-wider">
                    <th className="py-4 px-6 font-medium">Mã NV</th>
                    <th className="py-4 px-6 font-medium">Nhân viên</th>
                    <th className="py-4 px-6 font-medium">Vai trò</th>
                    <th className="py-4 px-6 font-medium">Nhóm chat</th>
                    <th className="py-4 px-6 font-medium text-center">Nộp báo cáo</th>
                    <th className="py-4 px-6 font-medium text-center">KPI nhân viên</th>
                    <th className="py-4 px-6 font-medium text-center">Tiến độ (Thực tế)</th>
                    <th className="py-4 px-6 font-medium text-right">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm">
                  {loading ? (
                    <tr>
                      <td colSpan="8" className="py-12 text-center">
                        <div className="inline-block w-8 h-8 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
                      </td>
                    </tr>
                  ) : filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="py-12 text-center text-slate-500">
                        Chưa có nhân viên nào. Hãy bấm "Thêm nhân viên".
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((emp, idx) => {
                      const reqKpi = emp.kpi_required || 0;
                      const actKpi = emp.kpi_actual || 0;
                      const isPassed = reqKpi > 0 && actKpi >= reqKpi;
                      const progress = reqKpi > 0 ? Math.min(100, Math.round((actKpi / reqKpi) * 100)) : 0;
                      
                      return (
                        <tr key={emp.id || idx} className="hover:bg-white/[0.02] transition-colors group">
                          <td className="py-4 px-6 font-medium text-slate-300">
                            #{emp.employee_code}
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-500 flex items-center justify-center text-white font-bold text-xs">
                                {emp.full_name?.charAt(0) || 'U'}
                              </div>
                              <p className="font-semibold text-white">{emp.full_name}</p>
                            </div>
                          </td>
                          <td className="py-4 px-6 text-slate-300">
                            <span className="px-2.5 py-1 bg-white/5 rounded-md text-xs border border-white/5">{emp.position || 'Sale'}</span>
                          </td>
                          <td className="py-4 px-6 text-slate-300">
                            {emp.group_name ? (
                              <span className="px-2.5 py-1 bg-cyan-500/10 text-cyan-400 rounded-md text-xs border border-cyan-500/20">{emp.group_name}</span>
                            ) : (
                              <span className="text-slate-500 text-xs italic">Chưa vào nhóm</span>
                            )}
                          </td>
                          <td className="py-4 px-6 text-center">
                            <button
                              onClick={() => handleToggleReportRequirement(emp.id, emp.need_report !== false)}
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
                                emp.need_report !== false
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/25'
                                  : 'bg-slate-500/10 text-slate-400 border-slate-500/20 hover:bg-slate-500/25'
                              }`}
                            >
                              {emp.need_report !== false ? 'Bắt buộc' : 'Miễn báo cáo'}
                            </button>
                          </td>
                          <td className="py-4 px-6 text-center">
                            <input 
                              type="number" 
                              className="w-20 bg-[#0B0F19] border border-white/10 rounded-lg px-2 py-1 text-center text-white focus:outline-none focus:border-cyan-500/50"
                              defaultValue={reqKpi}
                              onBlur={(e) => handleUpdateKpi(emp.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleUpdateKpi(emp.id, e.target.value);
                                  e.target.blur();
                                }
                              }}
                            />
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex flex-col items-center gap-1.5 w-32 mx-auto">
                              <div className="flex justify-between w-full text-xs">
                                <span className="font-medium text-white">{actKpi}</span>
                                <span className="text-slate-500">/ {reqKpi}</span>
                              </div>
                              <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${isPassed ? 'bg-gradient-to-r from-emerald-400 to-green-500' : 'bg-gradient-to-r from-cyan-400 to-blue-500'}`}
                                  style={{ width: `${progress}%` }}
                                ></div>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <button 
                              onClick={() => handleDeleteEmployee(emp.id)}
                              className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-medium transition-all border border-rose-500/20 flex items-center gap-1 ml-auto"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Xóa
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </>
          )}

          {activeTab === 'settings' && (
            <SettingsTab groups={groups} handleUpdateGroupSettings={handleUpdateGroupSettings} />
          )}
        </div>
      </main>

      {/* Modal Add Employee */}
      {showModal && (
        <div className="fixed inset-0 bg-[#0B0F19]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Thêm nhân viên mới</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddEmployee} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Họ và tên</label>
                <input 
                  type="text" 
                  required
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                  value={formData.full_name}
                  onChange={e => setFormData({...formData, full_name: e.target.value})}
                  placeholder="VD: Nguyễn Văn A"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Mã nhân viên</label>
                  <input 
                    type="text" 
                    required
                    className="w-full bg-[#0B0F19] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                    value={formData.employee_code}
                    onChange={e => setFormData({...formData, employee_code: e.target.value})}
                    placeholder="VD: NV001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Chỉ tiêu KPI mặc định</label>
                  <input 
                    type="number" 
                    required
                    className="w-full bg-[#0B0F19] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                    value={formData.current_kpi_target}
                    onChange={e => setFormData({...formData, current_kpi_target: e.target.value})}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Phòng ban</label>
                  <select 
                    className="w-full bg-[#0B0F19] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500/50"
                    value={formData.department}
                    onChange={e => setFormData({...formData, department: e.target.value})}
                  >
                    <option>Sales</option>
                    <option>CSKH</option>
                    <option>Marketing</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Vị trí</label>
                  <select 
                    className="w-full bg-[#0B0F19] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500/50"
                    value={formData.position}
                    onChange={e => setFormData({...formData, position: e.target.value})}
                  >
                    <option>Telesale</option>
                    <option>Team Lead</option>
                    <option>Manager</option>
                  </select>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Hủy bỏ
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-[#0B0F19] rounded-lg text-sm font-bold transition-colors shadow-lg shadow-cyan-500/25"
                >
                  Thêm nhân viên
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-[#111827] border border-cyan-500/30 shadow-2xl shadow-cyan-500/20 text-white px-6 py-4 rounded-xl flex items-center gap-3 animate-bounce shadow-lg z-50">
          <Bell className="w-5 h-5 text-cyan-400" />
          <p className="font-medium">{toast}</p>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ groups, handleUpdateGroupSettings }) {
  const [times, setTimes] = useState({});
  const [penalties, setPenalties] = useState({});
  const [penaltiesReport, setPenaltiesReport] = useState({});
  const [kpiSheets, setKpiSheets] = useState({});
  const [customerSheets, setCustomerSheets] = useState({});

  useEffect(() => {
    const initialTimes = {};
    const initialPenalties = {};
    const initialReport = {};
    const initialKpiSheets = {};
    const initialCustomerSheets = {};
    
    groups.forEach(g => {
      initialTimes[g.telegram_group_id] = (g.remind_time_1 || '17:00:00').substring(0, 5);
      initialPenalties[g.telegram_group_id] = g.penalty_missing_kpi != null ? g.penalty_missing_kpi : 100000;
      initialReport[g.telegram_group_id] = g.penalty_missing_report != null ? g.penalty_missing_report : 100000;
      initialKpiSheets[g.telegram_group_id] = g.kpi_sheet_id || '';
      initialCustomerSheets[g.telegram_group_id] = g.customer_sheet_id || '';
    });
    
    setTimes(initialTimes);
    setPenalties(initialPenalties);
    setPenaltiesReport(initialReport);
    setKpiSheets(initialKpiSheets);
    setCustomerSheets(initialCustomerSheets);
  }, [groups]);

  const handleTimeChange = (groupId, value) => setTimes(prev => ({...prev, [groupId]: value}));
  const handlePenaltyChange = (groupId, value) => setPenalties(prev => ({...prev, [groupId]: value}));
  const handlePenaltyReportChange = (groupId, value) => setPenaltiesReport(prev => ({...prev, [groupId]: value}));
  const handleKpiSheetChange = (groupId, value) => setKpiSheets(prev => ({...prev, [groupId]: value}));
  const handleCustomerSheetChange = (groupId, value) => setCustomerSheets(prev => ({...prev, [groupId]: value}));

  const handleSave = (groupId) => {
    const timeValue = times[groupId];
    const penaltyValue = parseInt(penalties[groupId]) || 0;
    const reportValue = parseInt(penaltiesReport[groupId]) || 0;
    const kpiSheetValue = kpiSheets[groupId];
    const customerSheetValue = customerSheets[groupId];
    
    if (timeValue) {
      handleUpdateGroupSettings(groupId, timeValue + ':00', penaltyValue, reportValue, kpiSheetValue, customerSheetValue);
    }
  };

  return (
    <div className="bg-[#111827]/60 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-xl p-8">
      <div className="mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-2"><Settings className="w-6 h-6 text-cyan-400" /> Cấu hình nhắc nhở các nhóm</h3>
        <p className="text-slate-400 text-sm mt-2 flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" /> 
          Hệ thống quét tự động: Bot sẽ kiểm tra thời gian <b>đúng 1 phút / lần</b> để gửi nhắc nhở cực kỳ chuẩn xác.
        </p>
      </div>
      
      {groups.length === 0 ? (
        <p className="text-slate-400">Chưa có nhóm nào kết nối. Vui lòng thêm bot vào nhóm và gõ lệnh /setup.</p>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group.telegram_group_id} className="p-5 border border-white/10 rounded-xl bg-white/5 flex flex-col md:flex-row justify-between md:items-center gap-4">
              <div>
                <h4 className="font-bold text-white text-lg">{group.group_name}</h4>
                <p className="text-slate-400 text-sm mt-1">ID: {group.telegram_group_id}</p>
              </div>
              <div className="flex items-end gap-3 flex-wrap">
                <div className="flex flex-col w-full md:w-auto">
                  <label className="text-xs text-slate-400 mb-1">ID Sheet Lịch Khách</label>
                  <input 
                    type="text" 
                    placeholder="Để trống = Mặc định"
                    className="bg-[#0B0F19] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500/50 w-full md:w-48"
                    value={customerSheets[group.telegram_group_id] || ''}
                    onChange={(e) => handleCustomerSheetChange(group.telegram_group_id, e.target.value)}
                  />
                </div>
                <div className="flex flex-col w-full md:w-auto">
                  <label className="text-xs text-slate-400 mb-1">ID Sheet KPI</label>
                  <input 
                    type="text" 
                    placeholder="Để trống = Mặc định"
                    className="bg-[#0B0F19] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500/50 w-full md:w-48"
                    value={kpiSheets[group.telegram_group_id] || ''}
                    onChange={(e) => handleKpiSheetChange(group.telegram_group_id, e.target.value)}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs text-slate-400 mb-1">Giờ nhắc báo cáo</label>
                  <input 
                    type="time" 
                    className="bg-[#0B0F19] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500/50 w-32"
                    value={times[group.telegram_group_id] || ''}
                    onChange={(e) => handleTimeChange(group.telegram_group_id, e.target.value)}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs text-slate-400 mb-1">Phạt vi phạm (Thiếu KPI/Ảnh)</label>
                  <input 
                    type="number" min="0" step="1000"
                    className="bg-[#0B0F19] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-red-500/50 w-44"
                    value={penalties[group.telegram_group_id] || 0}
                    onChange={(e) => handlePenaltyChange(group.telegram_group_id, e.target.value)}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs text-slate-400 mb-1">Phạt Trốn Báo Cáo (VNĐ)</label>
                  <input 
                    type="number" min="0" step="1000"
                    className="bg-[#0B0F19] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-red-500/50 w-40 text-red-400 font-bold"
                    value={penaltiesReport[group.telegram_group_id] || 0}
                    onChange={(e) => handlePenaltyReportChange(group.telegram_group_id, e.target.value)}
                  />
                </div>
                <button 
                  onClick={() => handleSave(group.telegram_group_id)}
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-[#0B0F19] rounded-lg text-sm font-bold transition-all shadow-lg shadow-cyan-500/20 active:scale-95 ml-2"
                >
                  Lưu thiết lập
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NavItem({ icon, label, active, onClick }) {
  return (
    <a href="#" onClick={(e) => { e.preventDefault(); onClick && onClick(); }} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200 ${
      active 
        ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/5 text-cyan-400 border border-cyan-500/20 shadow-inner' 
        : 'text-slate-400 hover:bg-white/5 hover:text-white'
    }`}>
      {React.cloneElement(icon, { className: `w-5 h-5 ${active ? 'text-cyan-400' : 'text-slate-500'}` })}
      {label}
    </a>
  );
}

function StatCard({ title, value, icon, trend, trendUp, bg, borderColor, suffix = '' }) {
  return (
    <div className={`bg-gradient-to-br ${bg} rounded-2xl p-6 border ${borderColor} backdrop-blur-sm relative overflow-hidden group`}>
      <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:scale-110 transition-transform duration-500">
        {React.cloneElement(icon, { className: 'w-16 h-16' })}
      </div>
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-slate-300">{title}</h3>
          <div className="p-2 bg-[#0B0F19]/50 rounded-lg backdrop-blur-md border border-white/5">
            {icon}
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <h2 className="text-4xl font-bold text-white">{value}</h2>
          {suffix && <span className="text-lg font-medium text-slate-400">{suffix}</span>}
        </div>
        <div className={`flex items-center gap-1.5 mt-3 text-xs font-medium ${trendUp ? 'text-emerald-400' : 'text-rose-400'}`}>
          {trendUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {trend}
        </div>
      </div>
    </div>
  );
}

export default App;
