import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, ShieldCheck, User, Check, X, Edit3, Search, Users, Save, CheckCircle2, AlertTriangle, Key } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function PermissionManagement({ selectedGroupId = 'ALL' }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchStaff();
  }, [selectedGroupId]);

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const params = selectedGroupId && selectedGroupId !== 'ALL' ? `?group_id=${selectedGroupId}` : '';
      const res = await axios.get(`${API_URL}/admin/tk-users${params}`);
      setStaff(res.data);
    } catch (err) {
      console.error('Lỗi tải danh sách nhân sự:', err);
      showToast('❌ Không thể tải danh sách nhân sự');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setEditForm({
      full_name: user.full_name,
      role: user.role || 'Nhân viên',
      leave_quota: user.leave_quota ?? 12,
      is_exempt_checkin: !!user.is_exempt_checkin,
      need_report: user.need_report !== undefined ? !!user.need_report : true,
      is_active: user.is_active !== undefined ? !!user.is_active : true,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async (id) => {
    try {
      await axios.put(`${API_URL}/admin/tk-users/${id}`, editForm);
      showToast('✅ Cập nhật phân quyền nhân viên thành công!');
      setEditingId(null);
      fetchStaff();
    } catch (err) {
      showToast('❌ Lỗi khi cập nhật: ' + err.message);
    }
  };

  const toggleExemptCheckin = async (user) => {
    const nextVal = !user.is_exempt_checkin;
    try {
      await axios.put(`${API_URL}/admin/tk-users/${user.id}`, {
        ...user,
        is_exempt_checkin: nextVal
      });
      showToast(`✅ Đã ${nextVal ? 'miễn' : 'áp dụng'} điểm danh cho ${user.full_name}`);
      fetchStaff();
    } catch (err) {
      showToast('❌ Lỗi cập nhật: ' + err.message);
    }
  };

  const toggleNeedReport = async (user) => {
    const nextVal = !(user.need_report !== false);
    try {
      await axios.put(`${API_URL}/admin/tk-users/${user.id}`, {
        ...user,
        need_report: nextVal
      });
      showToast(`✅ Đã ${nextVal ? 'yêu cầu' : 'miễn'} nộp báo cáo cho ${user.full_name}`);
      fetchStaff();
    } catch (err) {
      showToast('❌ Lỗi cập nhật: ' + err.message);
    }
  };

  const toggleActive = async (user) => {
    const nextVal = !(user.is_active !== false);
    try {
      await axios.put(`${API_URL}/admin/tk-users/${user.id}`, {
        ...user,
        is_active: nextVal
      });
      showToast(`✅ Đã ${nextVal ? 'kích hoạt' : 'vô hiệu hóa'} tài khoản ${user.full_name}`);
      fetchStaff();
    } catch (err) {
      showToast('❌ Lỗi cập nhật: ' + err.message);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const filteredStaff = staff.filter(u =>
    u.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.telegram_id?.includes(searchTerm)
  );

  // Statistics helper
  const stats = {
    total: staff.length,
    admins: staff.filter(s => s.role === 'admin').length,
    managers: staff.filter(s => s.role === 'Quản lý').length,
    exemptCheckin: staff.filter(s => s.is_exempt_checkin).length,
    exemptReport: staff.filter(s => s.need_report === false).length,
  };

  const getRoleBadge = (role) => {
    if (role === 'admin') {
      return (
        <span className="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-xs font-semibold border border-red-500/20 flex items-center gap-1 w-fit">
          <Shield className="w-3.5 h-3.5" /> Admin
        </span>
      );
    }
    if (role === 'Quản lý') {
      return (
        <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-lg text-xs font-semibold border border-amber-500/20 flex items-center gap-1 w-fit">
          <ShieldCheck className="w-3.5 h-3.5" /> Quản lý
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-semibold border border-blue-500/20 flex items-center gap-1 w-fit">
        <User className="w-3.5 h-3.5" /> Nhân viên
      </span>
    );
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight mb-2 flex items-center gap-2">
            <Key className="w-8 h-8 text-cyan-400" />
            Phân quyền Thành viên
          </h2>
          <p className="text-slate-400 text-sm">Quản lý chức vụ, quyền báo cáo và miễn trừ chấm công</p>
        </div>
        <div className="flex items-center bg-[#111827] rounded-full px-4 py-2 border border-white/5 w-full md:w-80 transition-all focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/50">
          <Search className="w-5 h-5 text-slate-500" />
          <input
            type="text"
            placeholder="Tìm nhân sự, chức vụ..."
            className="bg-transparent border-none outline-none text-sm ml-3 w-full text-white placeholder-slate-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 rounded-2xl p-4 border border-blue-500/20">
          <span className="text-xs text-slate-400 block mb-1">Tổng nhân sự</span>
          <p className="text-2xl font-bold text-white">{stats.total}</p>
        </div>
        <div className="bg-gradient-to-br from-red-500/10 to-red-600/5 rounded-2xl p-4 border border-red-500/20">
          <span className="text-xs text-slate-400 block mb-1">Quyền Admin</span>
          <p className="text-2xl font-bold text-red-400">{stats.admins}</p>
        </div>
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-2xl p-4 border border-amber-500/20">
          <span className="text-xs text-slate-400 block mb-1">Quyền Quản lý</span>
          <p className="text-2xl font-bold text-amber-400">{stats.managers}</p>
        </div>
        <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 rounded-2xl p-4 border border-purple-500/20">
          <span className="text-xs text-slate-400 block mb-1 font-medium">Miễn điểm danh</span>
          <p className="text-2xl font-bold text-purple-400">{stats.exemptCheckin}</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-2xl p-4 border border-emerald-500/20">
          <span className="text-xs text-slate-400 block mb-1">Miễn báo cáo KPI</span>
          <p className="text-2xl font-bold text-emerald-400">{stats.exemptReport}</p>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-[#111827]/60 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-xl">
        <div className="p-6 border-b border-white/5">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
            Danh sách Phân quyền ({filteredStaff.length})
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02] text-slate-400 text-xs uppercase tracking-wider">
                <th className="py-4 px-6 font-medium">Nhân viên</th>
                <th className="py-4 px-6 font-medium">Telegram ID</th>
                <th className="py-4 px-6 font-medium">Vai trò (Role)</th>
                <th className="py-4 px-6 font-medium text-center">Bắt buộc điểm danh</th>
                <th className="py-4 px-6 font-medium text-center">Báo cáo KPI</th>
                <th className="py-4 px-6 font-medium text-center">Trạng thái hoạt động</th>
                <th className="py-4 px-6 font-medium text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm">
              {loading ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center">
                    <div className="inline-block w-8 h-8 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
                  </td>
                </tr>
              ) : filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-slate-500">
                    Không tìm thấy thành viên nào.
                  </td>
                </tr>
              ) : (
                filteredStaff.map((user) => {
                  const isEditing = editingId === user.id;

                  return (
                    <tr key={user.id} className="hover:bg-white/[0.02] transition-colors group">
                      {/* Name & Code */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold text-xs shrink-0">
                            {user.full_name?.charAt(0) || 'U'}
                          </div>
                          <div>
                            <span className="font-semibold text-white block">{user.full_name}</span>
                            <span className="text-xs text-slate-500">{user.employee_code || 'Chưa có mã'}</span>
                          </div>
                        </div>
                      </td>

                      {/* Telegram ID */}
                      <td className="py-4 px-6">
                        <span className="px-2.5 py-1 bg-white/5 rounded-md text-xs border border-white/5 text-slate-300 font-mono">
                          {user.telegram_id || 'N/A'}
                        </span>
                      </td>

                      {/* Role selection */}
                      <td className="py-4 px-6">
                        {isEditing ? (
                          <select
                            className="bg-[#0B0F19] border border-cyan-500/50 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none cursor-pointer"
                            value={editForm.role}
                            onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                          >
                            <option value="Nhân viên">Nhân viên</option>
                            <option value="Quản lý">Quản lý</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : (
                          getRoleBadge(user.role)
                        )}
                      </td>

                      {/* Check-in Switch */}
                      <td className="py-4 px-6 text-center">
                        {isEditing ? (
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={!editForm.is_exempt_checkin}
                              onChange={e => setEditForm({ ...editForm, is_exempt_checkin: !e.target.checked })}
                            />
                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                          </label>
                        ) : (
                          <button
                            onClick={() => toggleExemptCheckin(user)}
                            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                              !user.is_exempt_checkin
                                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20'
                                : 'bg-purple-500/10 text-purple-400 border-purple-500/20 hover:bg-purple-500/20'
                            }`}
                          >
                            {!user.is_exempt_checkin ? 'Bắt buộc' : 'Miễn điểm danh'}
                          </button>
                        )}
                      </td>

                      {/* Report Switch */}
                      <td className="py-4 px-6 text-center">
                        {isEditing ? (
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={editForm.need_report}
                              onChange={e => setEditForm({ ...editForm, need_report: e.target.checked })}
                            />
                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                          </label>
                        ) : (
                          <button
                            onClick={() => toggleNeedReport(user)}
                            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                              user.need_report !== false
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                                : 'bg-slate-700/30 text-slate-400 border-white/5 hover:bg-slate-700/50'
                            }`}
                          >
                            {user.need_report !== false ? 'Bắt buộc' : 'Miễn báo cáo'}
                          </button>
                        )}
                      </td>

                      {/* Active Status */}
                      <td className="py-4 px-6 text-center">
                        {isEditing ? (
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={editForm.is_active}
                              onChange={e => setEditForm({ ...editForm, is_active: e.target.checked })}
                            />
                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                          </label>
                        ) : (
                          <button
                            onClick={() => toggleActive(user)}
                            className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
                              user.is_active !== false
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                                : 'bg-rose-500/15 text-rose-400 border-rose-500/30 hover:bg-rose-500/25'
                            }`}
                          >
                            {user.is_active !== false ? '🟢 Hoạt động' : '🔴 Khóa'}
                          </button>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-6 text-right">
                        {isEditing ? (
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => saveEdit(user.id)}
                              className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 rounded-lg text-xs font-medium transition-all border border-emerald-500/20 flex items-center gap-1"
                            >
                              <Save className="w-3.5 h-3.5" /> Lưu
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1.5 bg-slate-500/15 hover:bg-slate-500/25 text-slate-400 rounded-lg text-xs font-medium transition-all border border-slate-500/20 flex items-center gap-1"
                            >
                              <X className="w-3.5 h-3.5" /> Hủy
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(user)}
                            className="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 rounded-lg text-xs font-medium transition-all border border-cyan-500/20 flex items-center gap-1 ml-auto opacity-0 group-hover:opacity-100"
                          >
                            <Edit3 className="w-3.5 h-3.5" /> Phân quyền
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast Alert */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-[#111827]/90 border border-cyan-500/30 shadow-2xl shadow-cyan-500/20 text-white px-6 py-4 rounded-xl flex items-center gap-3 z-50 animate-[fadeIn_0.3s_ease-out] backdrop-blur-md">
          <p className="font-medium text-sm">{toast}</p>
        </div>
      )}
    </div>
  );
}
