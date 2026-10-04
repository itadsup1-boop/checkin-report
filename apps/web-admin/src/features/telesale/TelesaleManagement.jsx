import { useState, useEffect, useCallback } from 'react';
import {
  PhoneCall,
  RefreshCw,
  Sparkles,
  BellRing,
  Info,
  Users,
  Clock,
  FileText
} from 'lucide-react';
import { telesaleApi } from './services/telesaleApi.js';
import TelesaleStatsCards from './components/TelesaleStatsCards.jsx';
import TelesaleMappingTable from './components/TelesaleMappingTable.jsx';
import TelesaleFormBuilderTab from './components/TelesaleFormBuilderTab.jsx';
import TelesaleScheduleTab from './components/TelesaleScheduleTab.jsx';
import { ORIGINAL_DEFAULT_FIELDS } from './constants/telesaleDefaults.js';

export default function TelesaleManagement({
  selectedGroupId
}) {
  const [activeTab, setActiveTab] = useState('mapping'); // 'mapping' | 'form-builder' | 'schedule'
  const [loading, setLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(false);
  const [data, setData] = useState({
    groupId: null,
    groupName: '',
    groups: [],
    members: [],
    availableEmployees: []
  });
  const [formConfig, setFormConfig] = useState(null);
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

  const fetchFormConfig = useCallback(async (gId) => {
    if (!gId) return;
    setConfigLoading(true);
    try {
      const res = await telesaleApi.getFormConfig({ groupId: gId });
      if (res.success) {
        setFormConfig(res.config);
      }
    } catch (err) {
      console.error('Lỗi khi tải cấu hình form:', err);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(fetchData, 0);
    return () => window.clearTimeout(timer);
  }, [fetchData]);

  useEffect(() => {
    const targetGroupId = selectedGroupId || data.groupId;
    if (targetGroupId && targetGroupId !== 'ALL') {
      const timer = window.setTimeout(() => fetchFormConfig(targetGroupId), 0);
      return () => window.clearTimeout(timer);
    }
  }, [selectedGroupId, data.groupId, fetchFormConfig]);

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

  // Lưu cấu hình form hoặc lịch trình
  const handleSaveConfig = async (updateData) => {
    if (!data.groupId) return;
    setActionLoading(true);
    try {
      const payload = {
        telegramGroupId: data.groupId,
        groupName: data.groupName,
        fields: updateData.fields !== undefined ? updateData.fields : formConfig?.fields,
        scheduleSettings: updateData.scheduleSettings !== undefined ? updateData.scheduleSettings : formConfig?.schedule_settings,
        sheetSettings: updateData.sheetSettings !== undefined ? updateData.sheetSettings : formConfig?.sheet_settings
      };
      const res = await telesaleApi.updateFormConfig(payload);
      if (res.success) {
        setFormConfig(res.config);
        showToast(`✅ ${res.message || 'Lưu cấu hình thành công!'}`);
      } else {
        showToast(`❌ ${res.error || 'Lỗi khi lưu cấu hình'}`);
      }
    } catch (err) {
      showToast(`❌ Lỗi: ${err.response?.data?.error || err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Đồng bộ tiêu đề Sheet
  const handleSyncSheetHeaders = async () => {
    if (!data.groupId) return;
    setActionLoading(true);
    try {
      const res = await telesaleApi.syncSheetHeaders({ telegramGroupId: data.groupId });
      if (res.success) {
        showToast(`✅ ${res.message || 'Đồng bộ tiêu đề Google Sheet thành công!'}`);
      } else {
        showToast(`❌ ${res.error || 'Lỗi khi đồng bộ Google Sheet'}`);
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
                Đấu nối nhân sự, tùy biến các trường dữ liệu, công thức tính toán và lịch trình quét phạt tự động.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {activeTab === 'mapping' && (
            <>
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
            </>
          )}

          <button
            type="button"
            onClick={() => {
              fetchData();
              if (data.groupId) fetchFormConfig(data.groupId);
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:scale-95 transition"
          >
            <RefreshCw className={`h-4 w-4 ${loading || configLoading ? 'animate-spin text-blue-600' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('mapping')}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition ${
            activeTab === 'mapping'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Nhân sự &amp; Đấu nối</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('form-builder')}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition ${
            activeTab === 'form-builder'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Cấu hình Form &amp; Chỉ số</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('schedule')}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition ${
            activeTab === 'schedule'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Clock className="h-4 w-4" />
          <span>Thời gian &amp; Quét phạt</span>
        </button>
      </div>

      {/* Group Info Indicator */}
      {data.groupName && (
        <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
          <div>
            Đang quản lý nhóm: <b className="text-slate-800">{data.groupName}</b> ({data.groupId})
          </div>
          <span>Hôm nay: {new Date().toLocaleDateString('vi-VN')}</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-700">
          ❌ {error}
        </div>
      )}

      {/* TAB 1: NHÂN SỰ & ĐẤU NỐI */}
      {activeTab === 'mapping' && (
        <div className="space-y-6">
          {/* Info Notice Banner */}
          <div className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/70 to-indigo-50/50 p-4 text-xs text-blue-900 shadow-2xs">
            <Info className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-blue-950">Quy tắc đối soát điểm danh tự động khi Nhắc nhở &amp; Phạt báo cáo Telesale:</p>
              <ul className="list-disc pl-4 space-y-0.5 text-blue-800">
                <li>Hệ thống đối soát với tài khoản điểm danh cá nhân được đấu nối bên dưới.</li>
                <li>Nếu nhân sự <b>có check-in hôm nay</b>: Hệ thống sẽ nhắc nộp báo cáo và áp phạt theo giờ cấu hình nếu chưa nộp.</li>
                <li>Nếu nhân sự <b>không check-in hôm nay</b> hoặc có <b>lịch nghỉ ca OFF / đơn nghỉ phép</b>: Hệ thống <b>tự động bỏ qua, không nhắc nhở và không áp phạt</b>.</li>
              </ul>
            </div>
          </div>

          {/* Stats Cards */}
          <TelesaleStatsCards members={data.members} />

          {/* Table Section */}
          <div className="space-y-3">
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
        </div>
      )}

      {/* TAB 2: CẤU HÌNH FORM & CHỈ SỐ */}
      {activeTab === 'form-builder' && (
        <TelesaleFormBuilderTab
          key={`${formConfig?.telegram_group_id || data.groupId || selectedGroupId || 'builder'}-${formConfig?.updated_at || formConfig?.id || 'initial'}`}
          config={formConfig || { telegram_group_id: data.groupId || selectedGroupId, fields: ORIGINAL_DEFAULT_FIELDS }}
          onSaveConfig={handleSaveConfig}
          loading={actionLoading}
          showToast={showToast}
        />
      )}

      {/* TAB 3: THỜI GIAN & QUÉT PHẠT */}
      {activeTab === 'schedule' && (
        <TelesaleScheduleTab
          key={`${formConfig?.telegram_group_id || data.groupId || selectedGroupId || 'schedule'}-${formConfig?.updated_at || formConfig?.id || 'initial'}`}
          config={formConfig || { telegram_group_id: data.groupId || selectedGroupId, fields: ORIGINAL_DEFAULT_FIELDS }}
          onSaveConfig={handleSaveConfig}
          onSyncSheetHeaders={handleSyncSheetHeaders}
          loading={actionLoading}
          showToast={showToast}
        />
      )}

      {/* Toast popup */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-800 shadow-xl transition-all">
          {toast}
        </div>
      )}
    </div>
  );
}
