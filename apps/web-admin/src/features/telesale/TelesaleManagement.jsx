import { useState, useEffect, useCallback } from 'react';
import {
  PhoneCall,
  RefreshCw,
  Sparkles,
  BellRing,
  Info,
  Users,
  ShieldCheck,
  Calendar
} from 'lucide-react';
import { telesaleApi } from './services/telesaleApi.js';
import TelesaleStatsCards from './components/TelesaleStatsCards.jsx';
import TelesaleMappingTable from './components/TelesaleMappingTable.jsx';

export default function TelesaleManagement({
  selectedGroupId
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    groupId: null,
    groupName: '',
    groups: [],
    members: [],
    availableEmployees: []
  });
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3500);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await telesaleApi.getMappings({
        groupId: selectedGroupId
      });
      if (res.success) {
        setData(res);
      } else {
        setError(res.error || 'Không thể tải dữ liệu Telesale');
      }
    } catch (err) {
      console.error('Lỗi khi tải dữ liệu đấu nối Telesale:', err);
      setError(err.response?.data?.error || err.message || 'Lỗi kết nối máy chủ');
    } finally {
      setLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    const timer = window.setTimeout(fetchData, 0);
    return () => window.clearTimeout(timer);
  }, [fetchData]);

  // Cập nhật đấu nối tài khoản thủ công
  const handleUpdateMapping = async ({ employeeId, linkedEmployeeId, notes }) => {
    if (!data.groupId) return;
    setUpdatingId(employeeId);
    try {
      const res = await telesaleApi.updateMapping({
        telegramGroupId: data.groupId,
        employeeId,
        linkedEmployeeId,
        notes
      });
      if (res.success) {
        setData(prev => ({
          ...prev,
          members: res.members
        }));
        showToast(`✅ ${res.message}`);
      } else {
        showToast(`❌ ${res.error || 'Cập nhật thất bại'}`);
      }
    } catch (err) {
      showToast(`❌ Lỗi: ${err.response?.data?.error || err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  // Tự động khớp theo tên
  const handleAutoMatch = async () => {
    if (!data.groupId) return;
    if (!window.confirm('Hệ thống sẽ quét và tự động đấu nối các nhân sự Telesale có họ tên khớp với hồ sơ điểm danh. Tiếp tục?')) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await telesaleApi.autoMatch({
        telegramGroupId: data.groupId
      });
      if (res.success) {
        setData(prev => ({
          ...prev,
          members: res.members
        }));
        showToast(`✨ ${res.message}`);
      } else {
        showToast(`❌ ${res.error || 'Không thể tự động khớp'}`);
      }
    } catch (err) {
      showToast(`❌ Lỗi: ${err.response?.data?.error || err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Gửi tin nhắc nhở thủ công ngay
  const handleSendReminder = async () => {
    if (!data.groupId) return;
    if (!window.confirm(`Gửi tin nhắn nhắc nộp báo cáo tới nhóm "${data.groupName || data.groupId}" ngay bây giờ?`)) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await telesaleApi.sendReminder({
        telegramGroupId: data.groupId
      });
      if (res.success) {
        showToast('📣 Đã gửi tin nhắc nộp báo cáo tới nhóm Telesale thành công!');
        fetchData();
      } else {
        showToast(`❌ ${res.error || 'Không thể gửi nhắc nhở'}`);
      }
    } catch (err) {
      showToast(`❌ Lỗi: ${err.response?.data?.error || err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
              <PhoneCall className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
                Báo cáo &amp; Đấu nối Telesale
              </h1>
              <p className="text-xs text-slate-500 sm:text-sm">
                Đấu nối tên nhân sự báo cáo Telesale với tài khoản điểm danh cá nhân để kiểm tra đi làm / nghỉ trước khi nhắc nhở và phạt vi phạm.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleAutoMatch}
            disabled={loading || actionLoading || !data.groupId}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 shadow-2xs hover:bg-indigo-100 active:scale-95 transition disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            <span>Tự động khớp tên</span>
          </button>

          <button
            type="button"
            onClick={handleSendReminder}
            disabled={loading || actionLoading || !data.groupId}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-700 shadow-2xs hover:bg-amber-100 active:scale-95 transition disabled:opacity-50"
          >
            <BellRing className="h-4 w-4" />
            <span>Gửi nhắc nhở ngay</span>
          </button>

          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:scale-95 transition"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Info Notice Banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/70 to-indigo-50/50 p-4 text-xs text-blue-900 shadow-2xs">
        <Info className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-blue-950">Quy tắc đối soát điểm danh tự động khi Nhắc nhở &amp; Phạt báo cáo Telesale:</p>
          <ul className="list-disc pl-4 space-y-0.5 text-blue-800">
            <li>Hệ thống đối soát với tài khoản điểm danh cá nhân được đấu nối bên dưới.</li>
            <li>Nếu nhân sự <b>có check-in hôm nay</b>: Hệ thống sẽ nhắc nộp báo cáo lúc <b>18:00</b> và áp phạt <b>50.000đ</b> nếu chưa nộp sau <b>19:00</b>.</li>
            <li>Nếu nhân sự <b>không check-in hôm nay</b> hoặc có <b>lịch nghỉ ca OFF / đơn nghỉ phép</b>: Hệ thống <b>tự động bỏ qua, không nhắc nhở và không áp phạt</b>.</li>
          </ul>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-700">
          ❌ {error}
        </div>
      )}

      {/* Stats Cards */}
      <TelesaleStatsCards members={data.members} />

      {/* Table Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Danh sách nhân sự nhóm {data.groupName || data.groupId || ''}
            </h2>
          </div>
          <span className="text-xs text-slate-500">
            Hôm nay: {new Date().toLocaleDateString('vi-VN')}
          </span>
        </div>

        {loading ? (
          <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
              <span>Đang tải dữ liệu nhân sự Telesale...</span>
            </div>
          </div>
        ) : (
          <TelesaleMappingTable
            members={data.members}
            availableEmployees={data.availableEmployees}
            onUpdateMapping={handleUpdateMapping}
            updatingId={updatingId}
          />
        )}
      </div>

      {/* Toast popup */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-800 shadow-xl transition-all">
          {toast}
        </div>
      )}
    </div>
  );
}
