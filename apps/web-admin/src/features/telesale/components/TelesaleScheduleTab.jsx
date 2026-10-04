import { useState } from 'react';
import {
  Clock,
  BellRing,
  AlertCircle,
  FileSpreadsheet,
  Save,
  RefreshCw,
  CheckCircle2,
  CalendarCheck2,
  ShieldAlert
} from 'lucide-react';
import { ORIGINAL_DEFAULT_FIELDS, DEFAULT_SUMMARY_FIELDS } from '../constants/telesaleDefaults.js';

export default function TelesaleScheduleTab({
  config,
  onSaveConfig,
  onSyncSheetHeaders,
  loading = false
}) {
  const [schedule, setSchedule] = useState(() => ({
    remind_enabled: true,
    remind_time: '18:00',
    deadline_time: '19:00',
    penalty_enabled: true,
    penalty_amount: 50000,
    summary_enabled: true,
    summary_time: '19:01',
    summary_fields: (config?.schedule_settings?.summary_fields && config.schedule_settings.summary_fields.length > 0)
      ? config.schedule_settings.summary_fields
      : DEFAULT_SUMMARY_FIELDS,
    ...(config?.schedule_settings || {})
  }));

  const [sheetSettings, setSheetSettings] = useState(() => ({
    auto_sync_headers: true,
    ...(config?.sheet_settings || {})
  }));

  const [syncingSheet, setSyncingSheet] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const allFields = (config?.fields && config.fields.length > 0) ? config.fields : ORIGINAL_DEFAULT_FIELDS;
  const activeFields = allFields.filter(f => !f.is_hidden);

  const handleChangeSchedule = (key, value) => {
    setSchedule(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleToggleSummaryField = (fieldKey) => {
    const current = schedule.summary_fields || [];
    const updated = current.includes(fieldKey)
      ? current.filter(k => k !== fieldKey)
      : [...current, fieldKey];
    handleChangeSchedule('summary_fields', updated);
  };

  const handleSelectAllFields = () => {
    handleChangeSchedule('summary_fields', activeFields.map(f => f.key));
  };

  const handleClearAllFields = () => {
    handleChangeSchedule('summary_fields', []);
  };

  const handleSave = async () => {
    await onSaveConfig({
      scheduleSettings: schedule,
      sheetSettings
    });
    setHasChanges(false);
  };

  const handleManualSyncSheet = async () => {
    setSyncingSheet(true);
    try {
      await onSyncSheetHeaders();
    } finally {
      setSyncingSheet(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Clock className="h-5 w-5 text-indigo-600" />
            Cài đặt Thời Gian, Quét Phạt &amp; Báo Cáo Tổng
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tùy biến giờ nhắc nhở, giờ hạn chót &amp; mức phạt, giờ gửi báo cáo tổng kết ngày theo từng nhóm Telesale.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={loading || !hasChanges}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 active:scale-95 transition disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          <span>{loading ? 'Đang lưu...' : 'Lưu cấu hình thời gian'}</span>
        </button>
      </div>

      {hasChanges && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-center justify-between">
          <span>⚠️ Bạn có thay đổi chưa lưu. Hãy nhấn <b>"Lưu cấu hình thời gian"</b>.</span>
          <button
            type="button"
            onClick={handleSave}
            className="px-2.5 py-1 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 text-xs"
          >
            Lưu ngay
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Khối 1: Nhắc nhở & Quét phạt */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            <h3 className="text-sm font-bold text-slate-800">
              Nhắc Nhở &amp; Quét Phạt Tự Động
            </h3>
          </div>

          <div className="space-y-4 text-xs">
            {/* Nhắc nhở */}
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <BellRing className="h-4 w-4 text-amber-500" />
                  Bật tin nhắn nhắc nhở nộp báo cáo
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(schedule.remind_enabled)}
                  onChange={(e) => handleChangeSchedule('remind_enabled', e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </label>
              {schedule.remind_enabled && (
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-slate-600">Thời điểm gửi tin nhắc:</span>
                  <input
                    type="time"
                    value={schedule.remind_time || '18:00'}
                    onChange={(e) => handleChangeSchedule('remind_time', e.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold bg-white"
                  />
                </div>
              )}
            </div>

            {/* Quét phạt */}
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-3">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 text-rose-500" />
                  Bật quét phạt nộp muộn tự động
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(schedule.penalty_enabled)}
                  onChange={(e) => handleChangeSchedule('penalty_enabled', e.target.checked)}
                  className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
              </label>

              {schedule.penalty_enabled && (
                <>
                  <div className="flex items-center justify-between border-t border-slate-200/60 pt-2">
                    <span className="text-slate-600">Giờ hạn chót (Deadline):</span>
                    <input
                      type="time"
                      value={schedule.deadline_time || '19:00'}
                      onChange={(e) => handleChangeSchedule('deadline_time', e.target.value)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold bg-white"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Số tiền phạt mỗi lần:</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="10000"
                        value={schedule.penalty_amount || 50000}
                        onChange={(e) => handleChangeSchedule('penalty_amount', Number(e.target.value))}
                        className="w-28 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold bg-white text-right"
                      />
                      <span className="text-slate-500">VNĐ</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="text-[11px] text-slate-500 italic">
              ℹ️ Nhân sự có lịch ca OFF hoặc đơn nghỉ phép đã duyệt sẽ tự động được miễn phạt.
            </div>
          </div>
        </div>

        {/* Khối 2: Báo cáo tổng kết ngày & Google Sheets */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <CalendarCheck2 className="h-5 w-5 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">
              Báo Cáo Tổng Kết Ngày &amp; Google Sheets
            </h3>
          </div>

          <div className="space-y-4 text-xs">
            {/* Báo cáo tổng ngày */}
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-3">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Bật gửi Báo cáo tổng kết ngày toàn đội
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(schedule.summary_enabled)}
                  onChange={(e) => handleChangeSchedule('summary_enabled', e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </label>

              {schedule.summary_enabled && (
                <div className="flex items-center justify-between border-t border-slate-200/60 pt-2">
                  <span className="text-slate-600">Giờ gửi tin tổng kết vào nhóm:</span>
                  <input
                    type="time"
                    value={schedule.summary_time || '19:01'}
                    onChange={(e) => handleChangeSchedule('summary_time', e.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold bg-white"
                  />
                </div>
              )}
            </div>

            {/* Chọn trường hiển thị trên báo cáo tổng */}
            {schedule.summary_enabled && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">
                    Các trường xuất hiện trên Báo cáo tổng:
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAllFields}
                      className="text-[11px] text-blue-600 hover:underline"
                    >
                      Chọn tất cả
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={handleClearAllFields}
                      className="text-[11px] text-slate-500 hover:underline"
                    >
                      Bỏ chọn
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto p-1 border border-slate-100 rounded-xl bg-slate-50/50">
                  {activeFields.map(f => {
                    const isChecked = (schedule.summary_fields || []).includes(f.key);
                    return (
                      <label
                        key={f.key}
                        className="flex items-center gap-2 rounded-lg bg-white p-2 border border-slate-200/70 cursor-pointer hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSummaryField(f.key)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="truncate text-[11px] font-medium text-slate-700">
                          {f.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Đồng bộ Google Sheet */}
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-emerald-950 flex items-center gap-1.5">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  Đồng bộ Header Google Sheets
                </span>
                <button
                  type="button"
                  onClick={handleManualSyncSheet}
                  disabled={syncingSheet}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 active:scale-95 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingSheet ? 'animate-spin' : ''}`} />
                  <span>{syncingSheet ? 'Đang đồng bộ...' : 'Đồng bộ Header ngay'}</span>
                </button>
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={Boolean(sheetSettings.auto_sync_headers)}
                  onChange={(e) => {
                    setSheetSettings({ ...sheetSettings, auto_sync_headers: e.target.checked });
                    setHasChanges(true);
                  }}
                  className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-[11px] text-emerald-900">
                  Tự động cập nhật lại dòng tiêu đề (Header row) trên Google Sheet mỗi khi lưu cấu hình form.
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
