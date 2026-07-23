import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ClipboardCheck, Search, Edit3, Save, X, Plus, Clock, Video, CalendarDays, UserPlus } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function CheckinManagement({ selectedGroupId = 'ALL' }) {
  const [checkins, setCheckins] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [toast, setToast] = useState(null);

  // Edit modal state
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({ check_in_time: '', status: 'APPROVED', admin_note: '' });

  // Add manual check-in modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ user_id: '', check_in_time: '', admin_note: 'Admin nhập tay' });

  useEffect(() => {
    fetchCheckins();
    fetchStaff();
  }, [selectedDate, selectedGroupId]);

  const fetchCheckins = async () => {
    setLoading(true);
    try {
      const params = { date: selectedDate };
      if (selectedGroupId && selectedGroupId !== 'ALL') {
        params.group_id = selectedGroupId;
      }
      const res = await axios.get(`${API_URL}/admin/checkins`, { params });
      setCheckins(res.data);
    } catch (err) {
      console.error('Lỗi tải check-in:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStaff = async () => {
    try {
      const res = await axios.get(`${API_URL}/admin/tk-users`);
      setStaffList(res.data);
    } catch (err) {
      console.error('Lỗi tải nhân viên:', err);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const openEdit = (checkin) => {
    setEditModal(checkin);
    // Format time for datetime-local input
    const dt = new Date(checkin.check_in_time);
    const localISO = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setEditForm({
      check_in_time: localISO,
      status: checkin.status || 'APPROVED',
      admin_note: checkin.admin_note || ''
    });
  };

  const handleSaveEdit = async () => {
    try {
      await axios.put(`${API_URL}/admin/checkins/${editModal.id}`, {
        check_in_time: new Date(editForm.check_in_time).toISOString(),
        status: editForm.status,
        admin_note: editForm.admin_note || 'Admin chỉnh sửa'
      });
      showToast('✅ Đã cập nhật thông tin check-in!');
      setEditModal(null);
      fetchCheckins();
    } catch (err) {
      showToast('❌ Lỗi: ' + err.message);
    }
  };

  const handleAddManual = async () => {
    if (!addForm.user_id) {
      showToast('❌ Vui lòng chọn nhân viên!');
      return;
    }
    try {
      const selectedUser = staffList.find(u => u.id === addForm.user_id);
      await axios.post(`${API_URL}/admin/checkins`, {
        user_id: addForm.user_id,
        group_id: selectedUser?.group_id || null,
        date: selectedDate,
        check_in_time: addForm.check_in_time ? new Date(addForm.check_in_time).toISOString() : new Date().toISOString(),
        admin_note: addForm.admin_note || 'Admin nhập tay'
      });
      showToast('✅ Đã thêm check-in thủ công!');
      setShowAddModal(false);
      setAddForm({ user_id: '', check_in_time: '', admin_note: 'Admin nhập tay' });
      fetchCheckins();
    } catch (err) {
      showToast('❌ Lỗi: ' + err.message);
    }
  };

  const formatTime = (isoStr) => {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'APPROVED':
        return <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-md text-xs border border-emerald-500/20 font-semibold">Hợp lệ</span>;
      case 'LATE':
        return <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-md text-xs border border-amber-500/20 font-semibold">Đi muộn</span>;
      case 'REJECTED':
        return <span className="px-2.5 py-1 bg-rose-500/10 text-rose-400 rounded-md text-xs border border-rose-500/20 font-semibold">Không hợp lệ</span>;
      default:
        return <span className="px-2.5 py-1 bg-slate-500/10 text-slate-400 rounded-md text-xs border border-slate-500/20 font-semibold">{status || 'PENDING'}</span>;
    }
  };

  // Navigate date
  const changeDate = (days) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const isToday = selectedDate === new Date().toISOString().split('T')[0];

  return (
    <>
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight mb-2">Báo cáo Điểm danh</h2>
          <p className="text-slate-400 text-sm">Theo dõi và quản lý check-in video theo ngày</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:-translate-y-0.5 active:translate-y-0"
        >
          <UserPlus className="w-4 h-4" /> Thêm Check-in thủ công
        </button>
      </div>

      {/* Date Navigation */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => changeDate(-1)} className="p-2.5 bg-[#111827] border border-white/10 rounded-xl hover:bg-white/10 text-white transition-colors">
          ←
        </button>
        <div className="flex items-center gap-2 bg-[#111827] border border-white/10 rounded-xl px-4 py-2.5">
          <CalendarDays className="w-5 h-5 text-cyan-400" />
          <input
            type="date"
            className="bg-transparent border-none outline-none text-white text-sm"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
          />
          {isToday && (
            <span className="ml-2 px-2 py-0.5 bg-cyan-500/15 text-cyan-400 rounded text-xs font-semibold border border-cyan-500/20">Hôm nay</span>
          )}
        </div>
        <button onClick={() => changeDate(1)} className="p-2.5 bg-[#111827] border border-white/10 rounded-xl hover:bg-white/10 text-white transition-colors">
          →
        </button>
        {!isToday && (
          <button onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])} className="px-4 py-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400 text-sm font-medium hover:bg-cyan-500/20 transition-colors">
            Về hôm nay
          </button>
        )}
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-2xl p-5 border border-emerald-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#0B0F19]/50 rounded-lg border border-white/5">
              <ClipboardCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <span className="text-sm text-slate-300">Đã check-in</span>
          </div>
          <p className="text-3xl font-bold text-white">{checkins.length}</p>
        </div>
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-2xl p-5 border border-amber-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#0B0F19]/50 rounded-lg border border-white/5">
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
            <span className="text-sm text-slate-300">Đi muộn</span>
          </div>
          <p className="text-3xl font-bold text-white">{checkins.filter(c => c.status === 'LATE').length}</p>
        </div>
        <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 rounded-2xl p-5 border border-blue-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#0B0F19]/50 rounded-lg border border-white/5">
              <Video className="w-5 h-5 text-blue-400" />
            </div>
            <span className="text-sm text-slate-300">Có video</span>
          </div>
          <p className="text-3xl font-bold text-white">{checkins.filter(c => c.video_file_id && c.video_file_id !== 'manual').length}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#111827]/60 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-xl">
        <div className="p-6 border-b border-white/5">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-cyan-400" />
            Chi tiết Check-in ngày {new Date(selectedDate + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02] text-slate-400 text-xs uppercase tracking-wider">
                <th className="py-4 px-6 font-medium">#</th>
                <th className="py-4 px-6 font-medium">Nhân viên</th>
                <th className="py-4 px-6 font-medium">Vai trò</th>
                <th className="py-4 px-6 font-medium text-center">Giờ Check-in</th>
                <th className="py-4 px-6 font-medium text-center">Trạng thái</th>
                <th className="py-4 px-6 font-medium">Video</th>
                <th className="py-4 px-6 font-medium">Ghi chú</th>
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
              ) : checkins.length === 0 ? (
                <tr>
                  <td colSpan="8" className="py-12 text-center text-slate-500">
                    Chưa có lượt check-in nào trong ngày {new Date(selectedDate + 'T00:00:00').toLocaleDateString('vi-VN')}.
                  </td>
                </tr>
              ) : (
                checkins.map((ci, idx) => {
                  const colors = ['from-cyan-500 to-blue-500', 'from-emerald-500 to-green-500', 'from-purple-500 to-pink-500', 'from-amber-500 to-orange-500'];
                  const gradientClass = colors[idx % colors.length];

                  return (
                    <tr key={ci.id} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="py-4 px-6 text-slate-500 font-medium">{idx + 1}</td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full bg-gradient-to-tr ${gradientClass} flex items-center justify-center text-white font-bold text-xs shrink-0`}>
                            {ci.full_name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="font-semibold text-white">{ci.full_name || 'N/A'}</p>
                            <p className="text-xs text-slate-500">{ci.telegram_id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <span className="px-2.5 py-1 bg-cyan-500/10 text-cyan-400 rounded-md text-xs border border-cyan-500/20">{ci.role || 'N/A'}</span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className="text-white font-mono text-sm font-semibold">{formatTime(ci.check_in_time)}</span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        {getStatusBadge(ci.status)}
                      </td>
                      <td className="py-4 px-6">
                        {ci.video_file_id && ci.video_file_id !== 'manual' ? (
                          <a
                            href={ci.video_file_id}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-md text-xs border border-blue-500/20 hover:bg-blue-500/20 transition-colors inline-flex items-center gap-1"
                          >
                            <Video className="w-3 h-3" /> Xem
                          </a>
                        ) : (
                          <span className="text-xs text-slate-500 italic">{ci.video_file_id === 'manual' ? '📝 Nhập tay' : 'Không có'}</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-slate-400 text-xs max-w-[150px] truncate">
                        {ci.admin_note || '—'}
                      </td>
                      <td className="py-4 px-6 text-right">
                        <button
                          onClick={() => openEdit(ci)}
                          className="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 rounded-lg text-xs font-medium transition-all border border-cyan-500/20 flex items-center gap-1 ml-auto opacity-0 group-hover:opacity-100"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Sửa
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

      {/* ===== EDIT MODAL ===== */}
      {editModal && (
        <div className="fixed inset-0 bg-[#0B0F19]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-cyan-400" /> Chỉnh sửa Check-in
              </h3>
              <button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-sm text-slate-400">Nhân viên: <span className="text-white font-semibold">{editModal.full_name}</span></p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Giờ Check-in</label>
                <input
                  type="datetime-local"
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                  value={editForm.check_in_time}
                  onChange={e => setEditForm({ ...editForm, check_in_time: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Trạng thái</label>
                <select
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50"
                  value={editForm.status}
                  onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                >
                  <option value="APPROVED">✅ Hợp lệ</option>
                  <option value="LATE">⏰ Đi muộn</option>
                  <option value="REJECTED">❌ Không hợp lệ</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Ghi chú Admin</label>
                <input
                  type="text"
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 placeholder-slate-600"
                  placeholder="VD: Admin sửa giờ do hệ thống lỗi..."
                  value={editForm.admin_note}
                  onChange={e => setEditForm({ ...editForm, admin_note: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditModal(null)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-medium transition-colors">
                  Hủy
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-[#0B0F19] rounded-lg text-sm font-bold transition-colors shadow-lg shadow-cyan-500/25 flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" /> Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== ADD MANUAL MODAL ===== */}
      {showAddModal && (
        <div className="fixed inset-0 bg-[#0B0F19]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-400" /> Thêm Check-in thủ công
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-cyan-500/5 rounded-xl border border-cyan-500/10 text-xs text-slate-400">
                📅 Ngày: <span className="text-white font-semibold">{new Date(selectedDate + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Chọn nhân viên</label>
                <select
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50"
                  value={addForm.user_id}
                  onChange={e => setAddForm({ ...addForm, user_id: e.target.value })}
                >
                  <option value="">— Chọn nhân viên —</option>
                  {staffList.map(u => (
                    <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Giờ Check-in</label>
                <input
                  type="datetime-local"
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50"
                  value={addForm.check_in_time}
                  onChange={e => setAddForm({ ...addForm, check_in_time: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Ghi chú</label>
                <input
                  type="text"
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 placeholder-slate-600"
                  placeholder="VD: Telegram bị lỗi, check-in bổ sung"
                  value={addForm.admin_note}
                  onChange={e => setAddForm({ ...addForm, admin_note: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowAddModal(false)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-medium transition-colors">
                  Hủy
                </button>
                <button
                  onClick={handleAddManual}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-[#0B0F19] rounded-lg text-sm font-bold transition-colors shadow-lg shadow-emerald-500/25 flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Thêm Check-in
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-[#111827] border border-cyan-500/30 shadow-2xl shadow-cyan-500/20 text-white px-6 py-4 rounded-xl flex items-center gap-3 z-50 animate-[fadeIn_0.3s_ease-out]">
          <p className="font-medium text-sm">{toast}</p>
        </div>
      )}
    </>
  );
}
