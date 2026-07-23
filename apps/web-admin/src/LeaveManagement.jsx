import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { CalendarX, Search, Check, X, FileText, Image, Calendar, User, Clock, AlertCircle } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function LeaveManagement({ selectedGroupId = 'ALL' }) {
  const [activeSubTab, setActiveSubTab] = useState('requests'); // 'requests' or 'balance'
  const [requests, setRequests] = useState([]);
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [toast, setToast] = useState(null);
  const [selectedProof, setSelectedProof] = useState(null); // Lightbox modal state

  useEffect(() => {
    if (activeSubTab === 'requests') {
      fetchRequests();
    } else {
      fetchBalances();
    }
  }, [activeSubTab, selectedYear, selectedGroupId]);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedGroupId && selectedGroupId !== 'ALL') {
        params.group_id = selectedGroupId;
      }
      const res = await axios.get(`${API_URL}/admin/leave-requests`, { params });
      setRequests(res.data);
    } catch (err) {
      console.error('Lỗi tải danh sách đơn xin nghỉ:', err);
      showToast('❌ Không thể tải danh sách đơn xin nghỉ');
    } finally {
      setLoading(false);
    }
  };

  const fetchBalances = async () => {
    setLoading(true);
    try {
      const params = { year: selectedYear };
      if (selectedGroupId && selectedGroupId !== 'ALL') {
        params.group_id = selectedGroupId;
      }
      const res = await axios.get(`${API_URL}/admin/leave-balances`, { params });
      setBalances(res.data);
    } catch (err) {
      console.error('Lỗi tải quỹ phép:', err);
      showToast('❌ Không thể tải thông tin quỹ phép');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id, status) => {
    try {
      let statusText = 'cập nhật';
      if (status === 'APPROVED') statusText = 'duyệt';
      if (status === 'REJECTED') statusText = 'từ chối';
      if (status === 'PENDING') statusText = 'đặt lại trạng thái chờ duyệt cho';

      await axios.put(`${API_URL}/admin/leave-requests/${id}`, {
        status,
        approved_by: 'Admin (Dashboard)'
      });
      showToast(`✅ Đã ${statusText} đơn xin nghỉ thành công!`);
      fetchRequests();
    } catch (err) {
      console.error('Lỗi cập nhật trạng thái đơn nghỉ:', err);
      showToast('❌ Lỗi xử lý yêu cầu: ' + err.message);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const getRequestTypeLabel = (type) => {
    switch (type) {
      case 'FULL_DAY':
        return <span className="px-2.5 py-1 bg-rose-500/10 text-rose-400 rounded-md text-xs border border-rose-500/20 font-semibold">Cả ngày</span>;
      case 'HALF_DAY_AM':
        return <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-md text-xs border border-amber-500/20 font-semibold">Nửa ngày (Sáng)</span>;
      case 'HALF_DAY_PM':
        return <span className="px-2.5 py-1 bg-orange-500/10 text-orange-400 rounded-md text-xs border border-orange-500/20 font-semibold">Nửa ngày (Chiều)</span>;
      case 'LATE':
        return <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-md text-xs border border-emerald-500/20 font-semibold">Xin đi muộn</span>;
      default:
        return <span className="px-2.5 py-1 bg-slate-500/10 text-slate-400 rounded-md text-xs border border-slate-500/20">{type}</span>;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'APPROVED':
        return <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-md text-xs border border-emerald-500/20 font-semibold">Đã duyệt</span>;
      case 'REJECTED':
        return <span className="px-2.5 py-1 bg-rose-500/10 text-rose-400 rounded-md text-xs border border-rose-500/20 font-semibold">Bị từ chối</span>;
      default:
        return <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-md text-xs border border-amber-500/20 font-semibold">Chờ duyệt</span>;
    }
  };

  // Filter lists based on search term
  const filteredRequests = requests.filter(r =>
    r.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.role?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.reason?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredBalances = balances.filter(b =>
    b.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.role?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight mb-2">Xin Nghỉ & Quỹ Phép</h2>
          <p className="text-slate-400 text-sm">Quản lý và duyệt đơn xin nghỉ phép, theo dõi quỹ phép năm của nhân viên</p>
        </div>
        <div className="flex items-center bg-[#111827] rounded-full px-4 py-2 border border-white/5 w-full md:w-80 transition-all focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/50">
          <Search className="w-5 h-5 text-slate-500" />
          <input
            type="text"
            placeholder="Tìm theo tên, vai trò, lý do..."
            className="bg-transparent border-none outline-none text-sm ml-3 w-full text-white placeholder-slate-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-white/5 mb-8">
        <button
          onClick={() => { setActiveSubTab('requests'); setSearchTerm(''); }}
          className={`px-6 py-3 font-semibold text-sm transition-all border-b-2 ${
            activeSubTab === 'requests'
              ? 'text-cyan-400 border-cyan-400'
              : 'text-slate-400 hover:text-white border-transparent'
          }`}
        >
          Danh sách Đơn Xin Nghỉ
        </button>
        <button
          onClick={() => { setActiveSubTab('balance'); setSearchTerm(''); }}
          className={`px-6 py-3 font-semibold text-sm transition-all border-b-2 ${
            activeSubTab === 'balance'
              ? 'text-cyan-400 border-cyan-400'
              : 'text-slate-400 hover:text-white border-transparent'
          }`}
        >
          Thống kê Quỹ Phép Năm
        </button>
      </div>

      {activeSubTab === 'requests' ? (
        /* ==================== TAB 1: REQUESTS LIST ==================== */
        <div className="bg-[#111827]/60 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-xl">
          <div className="p-6 border-b border-white/5">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <CalendarX className="w-5 h-5 text-cyan-400" />
              Lịch sử Đơn Xin Nghỉ Phép & Đi Muộn ({filteredRequests.length})
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/[0.02] text-slate-400 text-xs uppercase tracking-wider">
                  <th className="py-4 px-6 font-medium">#</th>
                  <th className="py-4 px-6 font-medium">Nhân viên</th>
                  <th className="py-4 px-6 font-medium">Ngày xin nghỉ</th>
                  <th className="py-4 px-6 font-medium">Loại yêu cầu</th>
                  <th className="py-4 px-6 font-medium">Lý do</th>
                  <th className="py-4 px-6 font-medium text-center">Minh chứng</th>
                  <th className="py-4 px-6 font-medium text-center">Trạng thái</th>
                  <th className="py-4 px-6 font-medium text-center">Người duyệt</th>
                  <th className="py-4 px-6 font-medium text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-sm">
                {loading ? (
                  <tr>
                    <td colSpan="9" className="py-12 text-center">
                      <div className="inline-block w-8 h-8 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
                    </td>
                  </tr>
                ) : filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="py-12 text-center text-slate-500">
                      Chưa có đơn xin nghỉ phép nào được gửi.
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((req, idx) => {
                    const colors = ['from-cyan-500 to-blue-500', 'from-emerald-500 to-green-500', 'from-purple-500 to-pink-500', 'from-amber-500 to-orange-500'];
                    const gradientClass = colors[idx % colors.length];
                    const isPending = req.status === 'PENDING';

                    return (
                      <tr key={req.id} className="hover:bg-white/[0.02] transition-colors group">
                        <td className="py-4 px-6 text-slate-500 font-medium">{idx + 1}</td>
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full bg-gradient-to-tr ${gradientClass} flex items-center justify-center text-white font-bold text-xs shrink-0`}>
                              {req.full_name?.charAt(0) || '?'}
                            </div>
                            <div>
                              <p className="font-semibold text-white">{req.full_name || 'N/A'}</p>
                              <p className="text-xs text-slate-500">{req.role || 'N/A'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-6 text-white font-medium">
                          {req.date ? new Date(req.date).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex flex-col gap-1 items-start">
                            {getRequestTypeLabel(req.request_type)}
                            {req.request_type === 'LATE' && req.late_minutes && (
                              <span className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-0.5">
                                <Clock className="w-3.5 h-3.5" /> Muộn {req.late_minutes} phút
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-6 text-slate-300 max-w-[200px] truncate" title={req.reason}>
                          {req.reason || '—'}
                        </td>
                        <td className="py-4 px-6 text-center">
                          {req.proof_url ? (
                            <button
                              onClick={() => setSelectedProof(req.proof_url)}
                              className="px-2.5 py-1.5 bg-cyan-500/10 text-cyan-400 rounded-md text-xs border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors inline-flex items-center gap-1"
                            >
                              <Image className="w-3.5 h-3.5" /> Xem ảnh
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500 italic">Không có</span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center">
                          {getStatusBadge(req.status)}
                        </td>
                        <td className="py-4 px-6 text-center text-slate-400 text-xs">
                          {req.approved_by || '—'}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center gap-1.5 justify-end">
                            {req.status !== 'APPROVED' && (
                              <button
                                onClick={() => handleAction(req.id, 'APPROVED')}
                                className="px-2.5 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-semibold transition-all border border-emerald-500/20 flex items-center gap-1"
                                title="Phê duyệt đơn này"
                              >
                                <Check className="w-3.5 h-3.5" /> {isPending ? 'Duyệt' : 'Duyệt lại'}
                              </button>
                            )}
                            {req.status !== 'REJECTED' && (
                              <button
                                onClick={() => handleAction(req.id, 'REJECTED')}
                                className="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-semibold transition-all border border-rose-500/20 flex items-center gap-1"
                                title="Từ chối đơn này"
                              >
                                <X className="w-3.5 h-3.5" /> {isPending ? 'Từ chối' : 'Từ chối lại'}
                              </button>
                            )}
                            {!isPending && (
                              <button
                                onClick={() => handleAction(req.id, 'PENDING')}
                                className="px-2.5 py-1.5 bg-slate-500/10 hover:bg-slate-500/20 text-slate-400 rounded-lg text-xs font-semibold transition-all border border-slate-500/20 flex items-center gap-1"
                                title="Đặt lại trạng thái Chờ duyệt"
                              >
                                <Clock className="w-3.5 h-3.5" /> Reset
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
      ) : (
        /* ==================== TAB 2: LEAVE BALANCE ==================== */
        <div>
          {/* Year Picker */}
          <div className="flex items-center gap-3 mb-6">
            <span className="text-sm font-medium text-slate-400">Chọn năm làm việc:</span>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(parseInt(e.target.value))}
              className="bg-[#111827] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-medium focus:outline-none focus:border-cyan-500/50"
            >
              {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(y => (
                <option key={y} value={y}>Năm {y}</option>
              ))}
            </select>
          </div>

          <div className="bg-[#111827]/60 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-xl">
            <div className="p-6 border-b border-white/5">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-cyan-400" />
                Thống kê Quỹ Phép Năm {selectedYear} ({filteredBalances.length})
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.02] text-slate-400 text-xs uppercase tracking-wider">
                    <th className="py-4 px-6 font-medium">#</th>
                    <th className="py-4 px-6 font-medium">Nhân viên</th>
                    <th className="py-4 px-6 font-medium">Vai trò</th>
                    <th className="py-4 px-6 font-medium">Nhóm</th>
                    <th className="py-4 px-6 font-medium text-center">Tổng phép năm</th>
                    <th className="py-4 px-6 font-medium text-center">Phép đã dùng</th>
                    <th className="py-4 px-6 font-medium text-center">Phép còn lại</th>
                    <th className="py-4 px-6 font-medium text-right">Trạng thái quỹ phép</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm">
                  {loading ? (
                    <tr>
                      <td colSpan="8" className="py-12 text-center">
                        <div className="inline-block w-8 h-8 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
                      </td>
                    </tr>
                  ) : filteredBalances.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="py-12 text-center text-slate-500">
                        Chưa có nhân viên nào trong danh sách.
                      </td>
                    </tr>
                  ) : (
                    filteredBalances.map((bal, idx) => {
                      const quota = bal.leave_quota ?? 12;
                      const used = parseFloat(bal.used_days) || 0;
                      const remaining = quota - used;

                      // Color and state logic
                      let stateLabel = 'Bình thường';
                      let stateBadgeClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';

                      if (remaining < 0) {
                        stateLabel = 'Vượt hạn mức';
                        stateBadgeClass = 'bg-rose-500/10 text-rose-400 border-rose-500/20 font-bold animate-pulse';
                      } else if (remaining <= 2) {
                        stateLabel = 'Sắp hết phép';
                        stateBadgeClass = 'bg-amber-500/10 text-amber-400 border-amber-500/20 font-semibold';
                      }

                      const colors = ['from-cyan-500 to-blue-500', 'from-emerald-500 to-green-500', 'from-purple-500 to-pink-500', 'from-amber-500 to-orange-500'];
                      const gradientClass = colors[idx % colors.length];

                      return (
                        <tr key={bal.user_id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-4 px-6 text-slate-500 font-medium">{idx + 1}</td>
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-full bg-gradient-to-tr ${gradientClass} flex items-center justify-center text-white font-bold text-xs shrink-0`}>
                                {bal.full_name?.charAt(0) || '?'}
                              </div>
                              <div>
                                <p className="font-semibold text-white">{bal.full_name || 'N/A'}</p>
                                <p className="text-xs text-slate-500">{bal.telegram_id}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-6 text-slate-300">
                            <span className="px-2.5 py-1 bg-white/5 rounded-md text-xs border border-white/5">{bal.role || 'N/A'}</span>
                          </td>
                          <td className="py-4 px-6 text-slate-300 text-xs">
                            {bal.group_name || <span className="text-slate-500 italic">Chưa vào nhóm</span>}
                          </td>
                          <td className="py-4 px-6 text-center text-white font-semibold">
                            {quota} ngày
                          </td>
                          <td className="py-4 px-6 text-center text-amber-400 font-semibold">
                            {used} ngày
                          </td>
                          <td className="py-4 px-6 text-center">
                            <span className={`px-2 py-0.5 rounded font-bold ${remaining < 0 ? 'text-rose-400' : 'text-cyan-400'}`}>
                              {remaining} ngày
                            </span>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <span className={`px-2.5 py-1 rounded-md text-xs border ${stateBadgeClass}`}>
                              {stateLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== PROOF LIGHTBOX MODAL ===== */}
      {selectedProof && (
        <div className="fixed inset-0 bg-[#0B0F19]/90 backdrop-blur-md z-50 flex flex-col items-center justify-center p-4">
          <div className="absolute top-4 right-4 flex gap-4">
            <button
              onClick={() => setSelectedProof(null)}
              className="p-3 bg-white/5 hover:bg-white/10 text-white rounded-full border border-white/10 hover:scale-105 transition-all"
              title="Đóng"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="max-w-4xl max-h-[80vh] overflow-hidden rounded-2xl border border-white/10 shadow-2xl relative bg-[#111827]">
            <img
              src={selectedProof}
              alt="Minh chứng xin nghỉ"
              className="max-w-full max-h-[80vh] object-contain"
            />
          </div>
          <p className="text-slate-400 text-sm mt-4 italic">Minh chứng đính kèm đơn xin nghỉ</p>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-[#111827] border border-cyan-500/30 shadow-2xl shadow-cyan-500/20 text-white px-6 py-4 rounded-xl flex items-center gap-3 z-50 animate-[fadeIn_0.3s_ease-out]">
          <AlertCircle className="w-5 h-5 text-cyan-400 animate-bounce" />
          <p className="font-medium text-sm">{toast}</p>
        </div>
      )}
    </>
  );
}
