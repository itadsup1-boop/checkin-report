import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Users, Search, Edit3, Save, X, UserCheck, Briefcase, Calendar, FileDown } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function StaffManagement({ selectedGroupId = 'ALL' }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [toast, setToast] = useState(null);

  useEffect(() => { fetchStaff(); }, [selectedGroupId]);

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const params = selectedGroupId && selectedGroupId !== 'ALL' ? `?group_id=${selectedGroupId}` : '';
      const res = await axios.get(`${API_URL}/admin/tk-users${params}`);
      setStaff(res.data);
    } catch (err) {
      console.error('Lỗi tải danh sách nhân viên:', err);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setEditForm({
      full_name: user.full_name,
      role: user.role,
      leave_quota: user.leave_quota ?? 12,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async (id) => {
    try {
      await axios.put(`${API_URL}/admin/tk-users/${id}`, editForm);
      showToast('✅ Cập nhật thông tin nhân viên thành công!');
      setEditingId(null);
      fetchStaff();
    } catch (err) {
      showToast('❌ Lỗi khi cập nhật: ' + err.message);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleExport = async () => {
    try {
      const res = await axios.get(`${API_URL}/export/today`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `daily_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast('✅ Xuất dữ liệu thành công!');
    } catch (err) {
      console.error('[Export Error]', err);
      showToast('❌ Xuất dữ liệu thất bại');
    }
  };

  const filteredStaff = staff.filter(u =>
    u.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.telegram_id?.includes(searchTerm)
  );

  const totalStaff = staff.length;
  const roles = [...new Set(staff.map(s => s.role))];

  return (
    <>
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight mb-2">Quản lý Nhân sự</h2>
          <p className="text-slate-400 text-sm">Danh sách nhân viên đã đăng ký qua Telegram Bot</p>
        </div>
        <div className="flex items-center bg-[#111827] rounded-full px-4 py-2 border border-white/5 w-full md:w-80 transition-all focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/50">
          <Search className="w-5 h-5 text-slate-500" />
          <input
            type="text"
            placeholder="Tìm theo tên, vai trò, Telegram ID..."
            className="bg-transparent border-none outline-none text-sm ml-3 w-full text-white placeholder-slate-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 rounded-2xl p-5 border border-blue-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#0B0F19]/50 rounded-lg border border-white/5">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <span className="text-sm text-slate-300">Tổng nhân viên</span>
          </div>
          <p className="text-3xl font-bold text-white">{totalStaff}</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-2xl p-5 border border-emerald-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#0B0F19]/50 rounded-lg border border-white/5">
              <Briefcase className="w-5 h-5 text-emerald-400" />
            </div>
            <span className="text-sm text-slate-300">Số vai trò</span>
          </div>
          <p className="text-3xl font-bold text-white">{roles.length}</p>
        </div>
        <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 rounded-2xl p-5 border border-purple-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#0B0F19]/50 rounded-lg border border-white/5">
              <Calendar className="w-5 h-5 text-purple-400" />
            </div>
            <span className="text-sm text-slate-300">Phép mặc định / năm</span>
          </div>
          <p className="text-3xl font-bold text-white">12 <span className="text-base font-normal text-slate-400">ngày</span></p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#111827]/60 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-xl">
        <div className="p-6 border-b border-white/5 flex justify-between items-center">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-cyan-400" />
            Danh sách Nhân sự ({filteredStaff.length})
          </h3>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-emerald-500/15 text-slate-300 hover:text-emerald-400 rounded-lg text-sm font-medium transition-all border border-white/5 hover:border-emerald-500/30"
          >
            <FileDown className="w-4 h-4" />
            Xuất Excel
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02] text-slate-400 text-xs uppercase tracking-wider">
                <th className="py-4 px-6 font-medium">#</th>
                <th className="py-4 px-6 font-medium">Nhân viên</th>
                <th className="py-4 px-6 font-medium">Telegram ID</th>
                <th className="py-4 px-6 font-medium">Vai trò</th>
                <th className="py-4 px-6 font-medium">Nhóm</th>
                <th className="py-4 px-6 font-medium text-center">Số phép / năm</th>
                <th className="py-4 px-6 font-medium">Ngày đăng ký</th>
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
              ) : filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan="8" className="py-12 text-center text-slate-500">
                    {searchTerm ? 'Không tìm thấy nhân viên phù hợp.' : 'Chưa có nhân viên nào đăng ký qua Telegram.'}
                  </td>
                </tr>
              ) : (
                filteredStaff.map((user, idx) => {
                  const isEditing = editingId === user.id;
                  const colors = ['from-cyan-500 to-blue-500', 'from-emerald-500 to-green-500', 'from-purple-500 to-pink-500', 'from-amber-500 to-orange-500'];
                  const gradientClass = colors[idx % colors.length];

                  return (
                    <tr key={user.id} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="py-4 px-6 text-slate-500 font-medium">{idx + 1}</td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full bg-gradient-to-tr ${gradientClass} flex items-center justify-center text-white font-bold text-xs shrink-0`}>
                            {user.full_name?.charAt(0) || '?'}
                          </div>
                          {isEditing ? (
                            <input
                              type="text"
                              className="bg-[#0B0F19] border border-cyan-500/50 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none w-40"
                              value={editForm.full_name}
                              onChange={e => setEditForm({ ...editForm, full_name: e.target.value })}
                            />
                          ) : (
                            <span className="font-semibold text-white">{user.full_name}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <span className="px-2.5 py-1 bg-white/5 rounded-md text-xs border border-white/5 text-slate-300 font-mono">{user.telegram_id}</span>
                      </td>
                      <td className="py-4 px-6">
                        {isEditing ? (
                          <input
                            type="text"
                            className="bg-[#0B0F19] border border-cyan-500/50 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none w-32"
                            value={editForm.role}
                            onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                          />
                        ) : (
                          <span className="px-2.5 py-1 bg-cyan-500/10 text-cyan-400 rounded-md text-xs border border-cyan-500/20">{user.role}</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-slate-300 text-xs">
                        {user.group_name || <span className="text-slate-500 italic">N/A</span>}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            className="bg-[#0B0F19] border border-cyan-500/50 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none w-20 text-center"
                            value={editForm.leave_quota}
                            onChange={e => setEditForm({ ...editForm, leave_quota: parseInt(e.target.value) || 0 })}
                          />
                        ) : (
                          <span className="px-2.5 py-1 bg-purple-500/10 text-purple-400 rounded-md text-xs border border-purple-500/20 font-semibold">
                            {user.leave_quota ?? 12} ngày
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-slate-400 text-xs">
                        {user.created_at ? new Date(user.created_at).toLocaleDateString('vi-VN') : '—'}
                      </td>
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
                            <Edit3 className="w-3.5 h-3.5" /> Sửa
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-[#111827] border border-cyan-500/30 shadow-2xl shadow-cyan-500/20 text-white px-6 py-4 rounded-xl flex items-center gap-3 z-50 animate-[fadeIn_0.3s_ease-out]">
          <p className="font-medium text-sm">{toast}</p>
        </div>
      )}
    </>
  );
}
