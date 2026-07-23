import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { CalendarDays, Users, ChevronLeft, ChevronRight, Clock, Coffee, Plus, PenLine, Trash2, Save, X, UserPlus } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const SHIFT_LABELS = {
  'CA_SANG': { label: 'Ca sáng', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  'CA_CHIEU': { label: 'Ca chiều', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  'FULL_DAY': { label: 'Cả ngày', color: 'text-warning', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  'OFF': { label: 'Nghỉ', color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
};

const SHIFT_OPTIONS = [
  { value: 'CA_SANG', label: 'Ca sáng' },
  { value: 'CA_CHIEU', label: 'Ca chiều ' },
  { value: 'FULL_DAY', label: 'Cả ngày' },
  { value: 'OFF', label: 'Nghỉ' },
];

const toLocalDateStr = (dt) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

function getWeekDates(refDate) {
  const d = new Date(refDate);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + i);
    dates.push(toLocalDateStr(dt));
  }
  return dates;
}

const DAY_NAMES = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];

export default function ScheduleManagement({ selectedGroupId = 'ALL' }) {
  const [schedules, setSchedules] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refDate, setRefDate] = useState(new Date());
  const [expandedCell, setExpandedCell] = useState(null);
  const [toast, setToast] = useState(null);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editShift, setEditShift] = useState('');

  // Add schedule modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ user_id: '', date: '', shift_type: 'CA_SANG' });

  const weekDates = getWeekDates(refDate);
  const fromDate = weekDates[0];
  const toDate = weekDates[6];

  useEffect(() => {
    fetchSchedules();
    fetchUsers();
  }, [fromDate, selectedGroupId]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchUsers = async () => {
    try {
      const params = selectedGroupId && selectedGroupId !== 'ALL' ? `?group_id=${selectedGroupId}` : '';
      const res = await axios.get(`${API_URL}/admin/tk-users${params}`);
      setAllUsers(res.data);
    } catch (err) { console.error('Lỗi tải users:', err); }
  };

  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const params = { from_date: fromDate, to_date: toDate };
      if (selectedGroupId && selectedGroupId !== 'ALL') {
        params.group_id = selectedGroupId;
      }
      const res = await axios.get(`${API_URL}/admin/schedules`, { params });
      setSchedules(res.data);
    } catch (err) {
      console.error('Lỗi tải lịch:', err);
    } finally {
      setLoading(false);
    }
  };

  const changeWeek = (delta) => {
    const d = new Date(refDate);
    d.setDate(d.getDate() + delta * 7);
    setRefDate(d);
  };

  const goToThisWeek = () => setRefDate(new Date());
  const todayStr = toLocalDateStr(new Date());
  const isThisWeek = weekDates.includes(todayStr);

  // Build matrix grouped by user
  const buildUserMatrix = () => {
    const userMap = {};
    schedules.forEach(s => {
      if (!userMap[s.user_id]) {
        userMap[s.user_id] = { full_name: s.full_name, group_name: s.group_name, dates: {} };
      }
      userMap[s.user_id].dates[s.date?.split('T')[0] || s.date] = s;
    });
    return userMap;
  };

  const userMatrix = buildUserMatrix();

  // Stats
  const totalRegistered = schedules.filter(s => s.shift_type !== 'OFF').length;
  const totalOff = schedules.filter(s => s.shift_type === 'OFF').length;
  const uniqueUsers = [...new Set(schedules.map(s => s.user_id))].length;

  const toggleExpand = (key) => {
    setExpandedCell(expandedCell === key ? null : key);
  };

  // Edit handlers
  const startEdit = (schedule) => {
    setEditingId(schedule.id);
    setEditShift(schedule.shift_type);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditShift('');
  };

  const saveEdit = async (scheduleId) => {
    try {
      await axios.put(`${API_URL}/admin/schedules/${scheduleId}`, { shift_type: editShift });
      showToast('✅ Đã cập nhật ca trực!');
      cancelEdit();
      fetchSchedules();
    } catch (err) {
      showToast('❌ Lỗi: ' + (err.response?.data?.message || err.message));
    }
  };

  const deleteSchedule = async (scheduleId, userName) => {
    if (!window.confirm(`Xóa lịch trực của ${userName}?`)) return;
    try {
      await axios.delete(`${API_URL}/admin/schedules/${scheduleId}`);
      showToast('✅ Đã xóa lịch trực!');
      fetchSchedules();
    } catch (err) {
      showToast('❌ Lỗi: ' + err.message);
    }
  };

  const handleAddSchedule = async () => {
    if (!addForm.user_id || !addForm.date) {
      showToast('❌ Vui lòng chọn nhân viên và ngày!');
      return;
    }
    try {
      await axios.post(`${API_URL}/admin/schedules`, addForm);
      showToast('✅ Đã thêm lịch trực!');
      setShowAddModal(false);
      setAddForm({ user_id: '', date: '', shift_type: 'CA_SANG' });
      fetchSchedules();
    } catch (err) {
      showToast('❌ Lỗi: ' + (err.response?.data?.message || err.message));
    }
  };

  const openAddForDate = (date) => {
    setAddForm({ user_id: '', date, shift_type: 'CA_SANG' });
    setShowAddModal(true);
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight mb-2">Lịch Làm Việc</h2>
          <p className="text-slate-400 text-sm">Tổng quan lịch trực theo tuần — Admin có thể chỉnh sửa thủ công</p>
        </div>
        <button
          onClick={() => { setAddForm({ user_id: '', date: weekDates[0], shift_type: 'CA_SANG' }); setShowAddModal(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:-translate-y-0.5 active:translate-y-0"
        >
          <Plus className="w-4 h-4" /> Thêm lịch trực
        </button>
      </div>

      {/* Week Navigation */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => changeWeek(-1)} className="p-2.5 bg-[#111827] border border-white/10 rounded-xl hover:bg-white/10 text-white transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 bg-[#111827] border border-white/10 rounded-xl px-5 py-2.5">
          <CalendarDays className="w-5 h-5 text-cyan-400" />
          <span className="text-white text-sm font-medium">
            {new Date(fromDate + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} — {new Date(toDate + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </span>
          {isThisWeek && (
            <span className="ml-2 px-2 py-0.5 bg-cyan-500/15 text-cyan-400 rounded text-xs font-semibold border border-cyan-500/20">Tuần này</span>
          )}
        </div>
        <button onClick={() => changeWeek(1)} className="p-2.5 bg-[#111827] border border-white/10 rounded-xl hover:bg-white/10 text-white transition-colors">
          <ChevronRight className="w-5 h-5" />
        </button>
        {!isThisWeek && (
          <button onClick={goToThisWeek} className="px-4 py-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400 text-sm font-medium hover:bg-cyan-500/20 transition-colors">
            Về tuần này
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 rounded-2xl p-5 border border-cyan-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#0B0F19]/50 rounded-lg border border-white/5"><Clock className="w-5 h-5 text-cyan-400" /></div>
            <span className="text-sm text-slate-300">Lượt đăng ký trực</span>
          </div>
          <p className="text-3xl font-bold text-white">{totalRegistered}</p>
        </div>
        <div className="bg-gradient-to-br from-rose-500/10 to-rose-600/5 rounded-2xl p-5 border border-rose-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#0B0F19]/50 rounded-lg border border-white/5"><Coffee className="w-5 h-5 text-rose-400" /></div>
            <span className="text-sm text-slate-300">Lượt đăng ký nghỉ</span>
          </div>
          <p className="text-3xl font-bold text-white">{totalOff}</p>
        </div>
        <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 rounded-2xl p-5 border border-purple-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#0B0F19]/50 rounded-lg border border-white/5"><Users className="w-5 h-5 text-purple-400" /></div>
            <span className="text-sm text-slate-300">Nhân viên có lịch</span>
          </div>
          <p className="text-3xl font-bold text-white">{uniqueUsers}</p>
        </div>
      </div>

      {/* Schedule Table — User rows × Date columns */}
      <div className="bg-[#111827]/60 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-xl">
        <div className="p-6 border-b border-white/5 flex justify-between items-center">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-cyan-400" />
            Bảng lịch tuần (theo nhân viên)
          </h3>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <div className="inline-block w-8 h-8 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
          </div>
        ) : Object.keys(userMatrix).length === 0 ? (
          <div className="py-16 text-center text-slate-500">
            Chưa có dữ liệu lịch trong tuần này.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/[0.02] text-slate-400 text-xs uppercase tracking-wider">
                  <th className="py-4 px-4 font-medium w-44">Nhân viên</th>
                  {weekDates.map((date, i) => {
                    const isToday = date === todayStr;
                    return (
                      <th key={date} className={`py-4 px-3 font-medium text-center ${isToday ? 'bg-cyan-500/5' : ''}`}>
                        <div className={`${isToday ? 'text-cyan-400' : ''}`}>{DAY_NAMES[i]}</div>
                        <div className={`text-[10px] mt-0.5 ${isToday ? 'text-cyan-400/70' : 'text-slate-500'}`}>
                          {new Date(date + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                        </div>
                        <button
                          onClick={() => openAddForDate(date)}
                          className="mt-1 p-0.5 text-slate-600 hover:text-cyan-400 transition-colors"
                          title="Thêm lịch cho ngày này"
                        >
                          <Plus className="w-3.5 h-3.5 mx-auto" />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-sm">
                {Object.entries(userMatrix).map(([userId, userData]) => (
                  <tr key={userId} className="hover:bg-white/[0.01] transition-colors group">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-500 flex items-center justify-center text-white font-bold text-[10px] shrink-0">
                          {userData.full_name?.charAt(0)}
                        </div>
                        <div>
                          <p className="text-white text-xs font-semibold truncate max-w-[120px]">{userData.full_name}</p>
                          {userData.group_name && <p className="text-slate-500 text-[10px] truncate max-w-[120px]">{userData.group_name}</p>}
                        </div>
                      </div>
                    </td>
                    {weekDates.map(date => {
                      const schedule = userData.dates[date];
                      const isToday = date === todayStr;
                      const isEditing = schedule && editingId === schedule.id;

                      return (
                        <td key={date} className={`py-2 px-2 text-center align-middle ${isToday ? 'bg-cyan-500/5' : ''}`}>
                          {schedule ? (
                            isEditing ? (
                              /* Edit mode */
                              <div className="flex flex-col items-center gap-1">
                                <select
                                  value={editShift}
                                  onChange={(e) => setEditShift(e.target.value)}
                                  className="w-full bg-[#0B0F19] border border-cyan-500/50 rounded-lg px-1.5 py-1 text-white text-[11px] focus:outline-none"
                                >
                                  {SHIFT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                                <div className="flex gap-1">
                                  <button onClick={() => saveEdit(schedule.id)} className="p-1 bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30 transition-colors" title="Lưu">
                                    <Save className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={cancelEdit} className="p-1 bg-slate-500/20 text-slate-400 rounded hover:bg-slate-500/30 transition-colors" title="Hủy">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              /* Display mode */
                              <div className="group/cell relative">
                                {(() => {
                                  const cfg = SHIFT_LABELS[schedule.shift_type] || { label: schedule.shift_type, color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' };
                                  return (
                                    <span className={`inline-block px-2 py-1 ${cfg.bg} ${cfg.color} rounded-lg text-[11px] ${cfg.border} border font-semibold whitespace-nowrap`}>
                                      {cfg.label}
                                    </span>
                                  );
                                })()}
                                {schedule.updated_by === 'admin' && (
                                  <span className="block text-[9px] text-amber-400/60 mt-0.5">✏️ Admin</span>
                                )}
                                <div className="absolute -top-1 -right-1 flex gap-0.5 opacity-0 group-hover/cell:opacity-100 transition-opacity z-10">
                                  <button onClick={() => startEdit(schedule)} className="p-0.5 bg-cyan-500/30 text-cyan-400 rounded hover:bg-cyan-500/50 transition-colors" title="Sửa ca">
                                    <PenLine className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => deleteSchedule(schedule.id, userData.full_name)} className="p-0.5 bg-rose-500/30 text-rose-400 rounded hover:bg-rose-500/50 transition-colors" title="Xóa">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            )
                          ) : (
                            <button
                              onClick={() => openAddForDate(date)}
                              className="text-slate-700 hover:text-cyan-400 transition-colors p-1"
                              title={`Thêm lịch cho ${userData.full_name}`}
                            >
                              <Plus className="w-4 h-4 mx-auto" />
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Schedule Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-[#0B0F19]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-400" /> Thêm lịch trực thủ công
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Chọn nhân viên</label>
                <select
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50"
                  value={addForm.user_id}
                  onChange={e => setAddForm({ ...addForm, user_id: e.target.value })}
                >
                  <option value="">— Chọn nhân viên —</option>
                  {allUsers.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Ngày</label>
                <input
                  type="date"
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50"
                  value={addForm.date}
                  onChange={e => setAddForm({ ...addForm, date: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Ca trực</label>
                <select
                  className="w-full bg-[#0B0F19] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50"
                  value={addForm.shift_type}
                  onChange={e => setAddForm({ ...addForm, shift_type: e.target.value })}
                >
                  {SHIFT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowAddModal(false)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-medium transition-colors">
                  Hủy
                </button>
                <button
                  onClick={handleAddSchedule}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-[#0B0F19] rounded-lg text-sm font-bold transition-colors shadow-lg shadow-emerald-500/25 flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Thêm lịch
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
