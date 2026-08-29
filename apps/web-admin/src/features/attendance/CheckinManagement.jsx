import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { ClipboardCheck, Download, Edit3, Save, X, Plus, Clock, Video, CalendarDays, UserPlus } from 'lucide-react';

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

  const showToast = useCallback(message => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchCheckins = useCallback(async () => {
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
  }, [selectedDate, selectedGroupId]);

  const fetchStaff = useCallback(async () => {
    try {
      const params = selectedGroupId && selectedGroupId !== 'ALL' ? `?group_id=${encodeURIComponent(selectedGroupId)}` : '';
      const res = await axios.get(`${API_URL}/admin/tk-users${params}`);
      setStaffList(res.data);
    } catch (err) {
      console.error('Lỗi tải nhân viên:', err);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    const requestId = window.setTimeout(() => {
      fetchCheckins();
      fetchStaff();
    }, 0);
    return () => window.clearTimeout(requestId);
  }, [fetchCheckins, fetchStaff]);

  const exportAttendance = async () => {
    try {
      const response = await axios.get(`${API_URL}/export/today`, {
        params: {
          date: selectedDate,
          group_id: selectedGroupId !== 'ALL' ? selectedGroupId : undefined
        },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `bao_cao_diem_danh_${selectedDate}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showToast('✅ Đã xuất báo cáo điểm danh.');
    } catch (error) {
      showToast(`❌ Không thể xuất Excel: ${error.message}`);
    }
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
        return <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Hợp lệ</span>;
      case 'LATE':
        return <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Đi muộn</span>;
      case 'REJECTED':
        return <span className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">Không hợp lệ</span>;
      default:
        return <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">{status || 'PENDING'}</span>;
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
      <div className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="mb-2 text-2xl font-bold text-slate-900">Báo cáo Điểm danh</h1>
          <p className="text-sm text-slate-500">Theo dõi và quản lý check-in video theo ngày</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportAttendance} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">
            <Download className="h-4 w-4" />Xuất Excel
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-700"
          >
            <UserPlus className="h-4 w-4" /> Thêm Check-in thủ công
          </button>
        </div>
      </div>

      {/* Date Navigation */}
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => changeDate(-1)} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition-colors hover:bg-slate-50">
          ←
        </button>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
          <CalendarDays className="h-5 w-5 text-blue-600" />
          <input
            type="date"
            className="border-none bg-transparent text-sm text-slate-800 outline-none"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
          />
          {isToday && (
            <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Hôm nay</span>
          )}
        </div>
        <button onClick={() => changeDate(1)} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition-colors hover:bg-slate-50">
          →
        </button>
        {!isToday && (
          <button onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100">
            Về hôm nay
          </button>
        )}
      </div>

      {/* Stats summary */}
      <div className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <span className="text-sm text-slate-500">Đã check-in</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">{checkins.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
            <span className="text-sm text-slate-500">Đi muộn</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">{checkins.filter(c => c.status === 'LATE').length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
              <Video className="h-5 w-5" />
            </div>
            <span className="text-sm text-slate-500">Có video</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">{checkins.filter(c => c.video_file_id && c.video_file_id !== 'manual').length}</p>
        </div>
      </div>

      {/* Table */}
      <div className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:min-h-[720px]">
        <div className="border-b border-slate-100 p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <ClipboardCheck className="h-5 w-5 text-blue-600" />
            Chi tiết Check-in ngày {new Date(selectedDate + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
          </h2>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold">#</th>
                <th className="px-5 py-3 font-semibold">Nhân viên</th>
                <th className="px-5 py-3 font-semibold">Vai trò</th>
                <th className="px-5 py-3 text-center font-semibold">Giờ Check-in</th>
                <th className="px-5 py-3 text-center font-semibold">Trạng thái</th>
                <th className="px-5 py-3 font-semibold">Video</th>
                <th className="px-5 py-3 font-semibold">Ghi chú</th>
                <th className="px-5 py-3 text-right font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan="8" className="py-12 text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
                  </td>
                </tr>
              ) : checkins.length === 0 ? (
                <tr>
                  <td colSpan="8" className="py-12 text-center text-slate-400">
                    Chưa có lượt check-in nào trong ngày {new Date(selectedDate + 'T00:00:00').toLocaleDateString('vi-VN')}.
                  </td>
                </tr>
              ) : (
                checkins.map((ci, idx) => (
                  <tr key={ci.id} className="group hover:bg-slate-50">
                    <td className="px-5 py-4 font-medium text-slate-400">{idx + 1}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                          {ci.full_name?.charAt(0) || '?'}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">{ci.full_name || 'N/A'}</p>
                          <p className="text-xs text-slate-400">{ci.telegram_id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700">{ci.role || 'N/A'}</span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="font-mono text-sm font-semibold text-slate-800">{formatTime(ci.check_in_time)}</span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      {getStatusBadge(ci.status)}
                    </td>
                    <td className="px-5 py-4">
                      {ci.video_file_id && ci.video_file_id !== 'manual' ? (
                        <a
                          href={ci.video_file_id}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 transition-colors hover:bg-blue-100"
                        >
                          <Video className="h-3 w-3" /> Xem
                        </a>
                      ) : (
                        <span className="text-xs italic text-slate-400">{ci.video_file_id === 'manual' ? '📝 Nhập tay' : 'Không có'}</span>
                      )}
                    </td>
                    <td className="max-w-[150px] truncate px-5 py-4 text-xs text-slate-500">
                      {ci.admin_note || '—'}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => openEdit(ci)}
                        className="ml-auto flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 opacity-0 transition-all hover:bg-blue-100 group-hover:opacity-100"
                      >
                        <Edit3 className="h-3.5 w-3.5" /> Sửa
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== EDIT MODAL ===== */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <Edit3 className="h-5 w-5 text-blue-600" /> Chỉnh sửa Check-in
              </h3>
              <button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-sm text-slate-500">Nhân viên: <span className="font-semibold text-slate-800">{editModal.full_name}</span></p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Giờ Check-in</label>
                <input
                  type="datetime-local"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  value={editForm.check_in_time}
                  onChange={e => setEditForm({ ...editForm, check_in_time: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Trạng thái</label>
                <select
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-800 outline-none focus:border-blue-500"
                  value={editForm.status}
                  onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                >
                  <option value="APPROVED">✅ Hợp lệ</option>
                  <option value="LATE">⏰ Đi muộn</option>
                  <option value="REJECTED">❌ Không hợp lệ</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Ghi chú Admin</label>
                <input
                  type="text"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500"
                  placeholder="VD: Admin sửa giờ do hệ thống lỗi..."
                  value={editForm.admin_note}
                  onChange={e => setEditForm({ ...editForm, admin_note: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditModal(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
                  Hủy
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-colors hover:bg-blue-700"
                >
                  <Save className="h-4 w-4" /> Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== ADD MANUAL MODAL ===== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <UserPlus className="h-5 w-5 text-emerald-600" /> Thêm Check-in thủ công
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-slate-600">
                📅 Ngày: <span className="font-semibold text-slate-800">{new Date(selectedDate + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Chọn nhân viên</label>
                <select
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-800 outline-none focus:border-blue-500"
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
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Giờ Check-in</label>
                <input
                  type="datetime-local"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-800 outline-none focus:border-blue-500"
                  value={addForm.check_in_time}
                  onChange={e => setAddForm({ ...addForm, check_in_time: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Ghi chú</label>
                <input
                  type="text"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500"
                  placeholder="VD: Telegram bị lỗi, check-in bổ sung"
                  value={addForm.admin_note}
                  onChange={e => setAddForm({ ...addForm, admin_note: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowAddModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
                  Hủy
                </button>
                <button
                  onClick={handleAddManual}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:bg-emerald-700"
                >
                  <Plus className="h-4 w-4" /> Thêm Check-in
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-4 text-slate-800 shadow-xl">
          <p className="text-sm font-medium">{toast}</p>
        </div>
      )}
    </>
  );
}
