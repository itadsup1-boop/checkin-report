import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { UserPlus, Shield, Trash2, Edit, Check, X, Lock, Users, CheckSquare, Square, AlertCircle } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function AdminManagement({ groups = [] }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState(null);
  const [toast, setToast] = useState(null);

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'ADMIN',
    assigned_groups: []
  });

  useEffect(() => {
    fetchAdmins();
  }, []);

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/admin/accounts`);
      setAdmins(res.data);
    } catch (err) {
      console.error("Lỗi khi tải danh sách admin:", err);
    } finally {
      setLoading(false);
    }
  };

  const showToastMsg = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleOpenAdd = () => {
    setEditingAdmin(null);
    setFormData({
      username: '',
      password: '',
      full_name: '',
      role: 'ADMIN',
      assigned_groups: []
    });
    setShowModal(true);
  };

  const handleOpenEdit = (admin) => {
    setEditingAdmin(admin);
    setFormData({
      username: admin.username,
      password: '',
      full_name: admin.full_name || '',
      role: admin.role || 'ADMIN',
      assigned_groups: admin.assigned_groups || []
    });
    setShowModal(true);
  };

  const handleToggleGroup = (groupId) => {
    setFormData(prev => {
      const current = prev.assigned_groups || [];
      if (current.includes(groupId)) {
        return { ...prev, assigned_groups: current.filter(g => g !== groupId) };
      } else {
        return { ...prev, assigned_groups: [...current, groupId] };
      }
    });
  };

  const handleSelectAllGroups = () => {
    const allGroupIds = groups.map(g => g.telegram_group_id);
    if (formData.assigned_groups.length === allGroupIds.length) {
      setFormData(prev => ({ ...prev, assigned_groups: [] }));
    } else {
      setFormData(prev => ({ ...prev, assigned_groups: allGroupIds }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingAdmin) {
        await axios.put(`${API_URL}/admin/accounts/${editingAdmin.id}`, formData);
        showToastMsg('✅ Cập nhật tài khoản Admin thành công!');
      } else {
        await axios.post(`${API_URL}/admin/accounts`, formData);
        showToastMsg('✅ Tạo tài khoản Admin mới thành công!');
      }
      setShowModal(false);
      fetchAdmins();
    } catch (err) {
      alert("Lỗi: " + (err.response?.data?.message || err.message));
    }
  };

  const handleDelete = async (admin) => {
    if (admin.username === 'admin') {
      alert("Không thể xóa tài khoản Super Admin mặc định!");
      return;
    }
    if (window.confirm(`Bạn có chắc muốn xóa tài khoản "${admin.username}"?`)) {
      try {
        await axios.delete(`${API_URL}/admin/accounts/${admin.id}`);
        showToastMsg('✅ Đã xóa tài khoản Admin');
        fetchAdmins();
      } catch (err) {
        alert("Lỗi khi xóa: " + (err.response?.data?.message || err.message));
      }
    }
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-xl shadow-xl backdrop-blur-md">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#111827]/80 backdrop-blur-xl border border-white/5 p-6 rounded-3xl shadow-xl">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-cyan-500 to-blue-600 rounded-2xl shadow-lg shadow-cyan-500/20">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Quản lý Tài khoản Admin</h2>
              <p className="text-slate-400 text-sm mt-0.5">Phân quyền quản lý các nhóm Telegram cho từng tài khoản Admin</p>
            </div>
          </div>
        </div>

        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium rounded-xl shadow-lg shadow-cyan-500/25 transition-all hover:-translate-y-0.5 active:translate-y-0"
        >
          <UserPlus className="w-4 h-4" />
          Thêm Admin Mới
        </button>
      </div>

      {/* Admins List Table */}
      <div className="bg-[#111827]/80 backdrop-blur-xl border border-white/5 rounded-3xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02] text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-4 px-6">Tài khoản Admin</th>
                <th className="py-4 px-6">Họ tên</th>
                <th className="py-4 px-6">Vai trò</th>
                <th className="py-4 px-6">Nhóm quản lý</th>
                <th className="py-4 px-6">Trạng thái</th>
                <th className="py-4 px-6 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-slate-500">Đang tải danh sách tài khoản...</td>
                </tr>
              ) : admins.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-slate-500">Chưa có tài khoản admin phụ nào.</td>
                </tr>
              ) : (
                admins.map(admin => {
                  const isSuper = admin.role === 'SUPER_ADMIN';
                  const adminAssignedGroups = admin.assigned_groups || [];

                  return (
                    <tr key={admin.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-4 px-6 font-semibold text-white flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-cyan-400 font-bold border border-white/10">
                          {admin.username.substring(0, 2).toUpperCase()}
                        </div>
                        {admin.username}
                      </td>
                      <td className="py-4 px-6">{admin.full_name || '—'}</td>
                      <td className="py-4 px-6">
                        {isSuper ? (
                          <span className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 rounded-full text-xs font-semibold">
                            Super Admin
                          </span>
                        ) : (
                          <span className="px-3 py-1 bg-purple-500/10 border border-purple-500/30 text-purple-400 rounded-full text-xs font-semibold">
                            Admin
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-6">
                        {isSuper ? (
                          <span className="text-slate-400 italic text-xs">Toàn bộ nhóm (Tất cả)</span>
                        ) : adminAssignedGroups.length === 0 ? (
                          <span className="text-rose-400/80 text-xs italic">Chưa gán nhóm nào</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-w-md">
                            {adminAssignedGroups.map(gId => {
                              const groupObj = groups.find(g => g.telegram_group_id === gId);
                              return (
                                <span key={gId} className="px-2.5 py-0.5 bg-slate-800 border border-white/10 text-slate-300 rounded-lg text-xs">
                                  {groupObj ? groupObj.group_name : `Group ${gId}`}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-6">
                        {admin.is_active ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                            <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Hoạt động
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-rose-400">
                            <span className="w-2 h-2 rounded-full bg-rose-400"></span> Bị khóa
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenEdit(admin)}
                            className="p-2 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-all"
                            title="Chỉnh sửa"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          {admin.username !== 'admin' && (
                            <button
                              onClick={() => handleDelete(admin)}
                              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                              title="Xóa tài khoản"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Add/Edit Admin */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#111827] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-white/10 pb-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Shield className="w-5 h-5 text-cyan-400" />
                {editingAdmin ? `Cập nhật Admin: ${editingAdmin.username}` : 'Thêm Tài Khoản Admin Mới'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Tên đăng nhập *</label>
                <input
                  type="text"
                  required
                  disabled={!!editingAdmin}
                  value={formData.username}
                  onChange={e => setFormData({ ...formData, username: e.target.value })}
                  placeholder="Ví dụ: admin_sales1"
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Mật khẩu {editingAdmin ? '(Bỏ trống nếu không muốn đổi)' : '*'}
                </label>
                <input
                  type="password"
                  required={!editingAdmin}
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Họ và tên</label>
                <input
                  type="text"
                  value={formData.full_name}
                  onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="Ví dụ: Nguyễn Văn A"
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Vai trò</label>
                <select
                  value={formData.role}
                  onChange={e => setFormData({ ...formData, role: e.target.value })}
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="ADMIN">Admin (Quản lý nhóm được gán)</option>
                  <option value="SUPER_ADMIN">Super Admin (Toàn quyền hệ thống)</option>
                </select>
              </div>

              {formData.role === 'ADMIN' && (
                <div className="space-y-2 pt-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-slate-300">
                      Chọn các Nhóm Telegram được gán quản lý ({formData.assigned_groups.length}/{groups.length}):
                    </label>
                    <button
                      type="button"
                      onClick={handleSelectAllGroups}
                      className="text-xs text-cyan-400 hover:underline"
                    >
                      {formData.assigned_groups.length === groups.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  </div>

                  <div className="bg-[#0B0F19] border border-white/10 rounded-xl p-3 max-h-48 overflow-y-auto space-y-1.5">
                    {groups.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-2">Không tìm thấy nhóm Telegram nào</p>
                    ) : (
                      groups.map(group => {
                        const isChecked = formData.assigned_groups.includes(group.telegram_group_id);
                        return (
                          <label
                            key={group.telegram_group_id}
                            onClick={() => handleToggleGroup(group.telegram_group_id)}
                            className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors"
                          >
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-500 flex-shrink-0" />
                            )}
                            <span className="text-xs text-slate-200 font-medium">
                              {group.group_name} <span className="text-slate-500 font-normal">({group.telegram_group_id})</span>
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-cyan-500/25 transition-all"
                >
                  {editingAdmin ? 'Lưu thay đổi' : 'Tạo Admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
