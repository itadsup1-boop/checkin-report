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
  ShieldAlert,
  ChevronDown,
  Layers,
  Plus,
  Trash2
} from 'lucide-react';
import {
  ORIGINAL_DEFAULT_FIELDS,
  DEFAULT_SUMMARY_FIELDS,
  DEFAULT_MULTI_SLOTS,
  calculateLateRemindTime
} from '../constants/telesaleDefaults.js';

export default function TelesaleScheduleTab({
  config,
  onSaveConfig,
  onSyncSheetHeaders,
  loading = false,
  groupName,
  groupId,
  groups,
  onSelectGroup
}) {
  const [schedule, setSchedule] = useState(() => ({
    schedule_mode: config?.schedule_settings?.schedule_mode || config?.features?.schedule_mode || 'SINGLE_SLOT',
    slots: (config?.schedule_settings?.slots && config.schedule_settings.slots.length > 0)
      ? config.schedule_settings.slots
      : DEFAULT_MULTI_SLOTS,
    remind_enabled: true,
    remind_time: '18:00',
    deadline_time: '19:00',
    penalty_enabled: true,
    penalty_amount: 50000,
    summary_enabled: true,
    summary_time: '19:01',
    daily_final_summary_enabled: true,
    daily_final_summary_time: '19:00',
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

  const handleModeChange = (mode) => {
    handleChangeSchedule('schedule_mode', mode);
  };

  const handleUpdateSlot = (index, key, val) => {
    const currentSlots = [...(schedule.slots || DEFAULT_MULTI_SLOTS)];
    const updatedSlot = { ...currentSlots[index], [key]: val };
    if (key === 'deadline_time' && val) {
      updatedSlot.late_remind_time = calculateLateRemindTime(val, 1);
    }
    currentSlots[index] = updatedSlot;
    handleChangeSchedule('slots', currentSlots);
  };

  const handleAddSlot = () => {
    const currentSlots = [...(schedule.slots || DEFAULT_MULTI_SLOTS)];
    const num = currentSlots.length + 1;
    const deadlineTime = '15:00';
    const newSlot = {
      id: `${String(num * 3).padStart(2, '0')}h`,
      label: `${String(num * 3).padStart(2, '0')}h`,
      remind_time: '14:45',
      deadline_time: deadlineTime,
      late_remind_time: calculateLateRemindTime(deadlineTime, 1),
      summary_time: '15:01',
      penalty_amount: 50000
    };
    handleChangeSchedule('slots', [...currentSlots, newSlot]);
  };

  const handleDeleteSlot = (index) => {
    const currentSlots = schedule.slots || [];
    if (currentSlots.length <= 1) {
      alert('Cần có ít nhất 1 mốc giờ trong chế độ nhiều mốc!');
      return;
    }
    const updated = currentSlots.filter((_, i) => i !== index);
    handleChangeSchedule('slots', updated);
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
      sheetSettings,
      features: {
        ...(config?.features || {}),
        schedule_mode: schedule.schedule_mode
      }
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

  const isMultiSlot = schedule.schedule_mode === 'MULTI_SLOT';

  return (
    <div className="space-y-6">
      {/* Group Context Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/90 via-purple-50/50 to-white p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-2xs font-bold text-sm">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Đang cài đặt Quét phạt cho nhóm:</span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                Áp dụng riêng
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              <span className="text-base font-bold text-slate-900">{groupName || 'Chưa chọn nhóm'}</span>
              {groupId && (
                <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-600">
                  ID: {groupId}
                </span>
              )}
            </div>
          </div>
        </div>

        {groups && groups.length > 1 && onSelectGroup && (
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-indigo-100 shadow-2xs">
            <span className="text-slate-600 text-xs font-semibold whitespace-nowrap">Chuyển sang nhóm khác:</span>
            <div className="relative">
              <select
                value={groupId || ''}
                onChange={(e) => onSelectGroup(e.target.value)}
                className="appearance-none rounded-lg border border-slate-300 bg-slate-50 py-1.5 pl-2.5 pr-7 text-xs font-bold text-indigo-950 outline-none hover:border-indigo-500 cursor-pointer"
              >
                {groups.map((g) => (
                  <option key={g.telegram_group_id} value={g.telegram_group_id}>
                    {g.group_name} ({g.telegram_group_id})
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        )}
      </div>

      {/* Header card */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Clock className="h-5 w-5 text-indigo-600" />
            Cài đặt Thời Gian, Quét Phạt &amp; Báo Cáo Tổng {groupName ? `— ${groupName}` : ''}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tùy biến giờ nhắc nhở, giờ hạn chót &amp; mức phạt, giờ gửi báo cáo tổng kết ngày riêng cho nhóm <b>{groupName || groupId || 'hiện tại'}</b>.
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

      {/* NGÀY BẮT ĐẦU ÁP DỤNG LUẬT BÁO CÁO */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-white p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white font-bold text-xs shadow-2xs">
              <CalendarCheck2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                Ngày Bắt Đầu Áp Dụng Luật Báo Cáo
                {schedule.rules_effective_date && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    new Date().toISOString().split('T')[0] < schedule.rules_effective_date
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  }`}>
                    {new Date().toISOString().split('T')[0] < schedule.rules_effective_date
                      ? `⏳ Chưa áp dụng hôm nay (Bắt đầu từ ${schedule.rules_effective_date.split('-').reverse().join('/')})`
                      : '✅ Đang có hiệu lực'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Các quy định giờ nhắc nhở, phạt quá hạn và báo cáo mốc giờ sẽ chính thức có hiệu lực từ ngày này trở đi.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">Hiệu lực từ ngày:</label>
            <input
              type="date"
              value={schedule.rules_effective_date || ''}
              onChange={(e) => handleChangeSchedule('rules_effective_date', e.target.value)}
              className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-bold text-indigo-950 focus:border-indigo-500 shadow-2xs cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* CHỌN CHẾ ĐỘ: 1 MỐC GIỜ VS NHIỀU MỐC GIỜ */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="h-4 w-4 text-indigo-600" />
              Chế độ Lịch Báo Cáo &amp; Quét Phạt
            </h3>
            <p className="text-xs text-slate-500">
              Lựa chọn báo cáo 1 mốc giờ cố định trong ngày (Telesale) hoặc nhiều mốc giờ (Báo cáo Ads 09h, 12h, 18h).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={() => handleModeChange('SINGLE_SLOT')}
            className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition ${
              !isMultiSlot
                ? 'border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-600/30'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-bold text-xs ${
              !isMultiSlot ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              1
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                1 Mốc Giờ Trong Ngày (SINGLE_SLOT)
                {!isMultiSlot && (
                  <span className="rounded-full bg-indigo-100 text-indigo-700 px-1.5 py-0.2 text-[10px] font-bold">Đang chọn</span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Báo cáo 1 lần cố định mỗi ngày (Mặc định cho các nhóm Telesale, Xây Dựng 24h,...).
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange('MULTI_SLOT')}
            className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition ${
              isMultiSlot
                ? 'border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-600/30'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-bold text-xs ${
              isMultiSlot ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              N
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                Nhiều Mốc Giờ Trong Ngày (MULTI_SLOT)
                {isMultiSlot && (
                  <span className="rounded-full bg-indigo-100 text-indigo-700 px-1.5 py-0.2 text-[10px] font-bold">Đang chọn</span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Báo cáo theo nhiều mốc giờ trong ngày (Ví dụ: 09h, 12h, 18h) với giờ nhắc, hạn chót và mức phạt riêng từng mốc.
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* NẾU CHỌN NHIỀU MỐC GIỜ (MULTI_SLOT) */}
      {isMultiSlot ? (
        <div className="space-y-6">
          {/* Danh sách các mốc giờ */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-indigo-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Danh Sách Các Mốc Giờ Báo Cáo Trong Ngày
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Cấu hình giờ gửi tin nhắc, hạn chót phạt và giờ bot tổng kết cho từng mốc giờ (Ví dụ: 09h, 12h, 18h).
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleAddSlot}
                className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-indigo-700 active:scale-95 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Thêm mốc giờ</span>
              </button>
            </div>

            {/* Bảng mốc giờ */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Mốc giờ / Nhãn</th>
                    <th className="py-2.5 px-3">Giờ nhắc trước</th>
                    <th className="py-2.5 px-3">Hạn chót (Deadline)</th>
                    <th className="py-2.5 px-3 text-amber-800">Nhắc sau 1h (nếu chưa nộp)</th>
                    <th className="py-2.5 px-3">Giờ bot tổng kết</th>
                    <th className="py-2.5 px-3">Mức phạt (VNĐ)</th>
                    <th className="py-2.5 px-3 text-center">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(schedule.slots || []).map((slot, idx) => (
                    <tr key={slot.id || idx} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={slot.label || slot.id || ''}
                          onChange={(e) => handleUpdateSlot(idx, 'label', e.target.value)}
                          className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold bg-white text-indigo-950 focus:border-indigo-500"
                          placeholder="09h"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="time"
                          value={slot.remind_time || '08:45'}
                          onChange={(e) => handleUpdateSlot(idx, 'remind_time', e.target.value)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold bg-white"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="time"
                          value={slot.deadline_time || '09:00'}
                          onChange={(e) => handleUpdateSlot(idx, 'deadline_time', e.target.value)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold bg-white text-rose-700"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="time"
                          value={slot.late_remind_time || calculateLateRemindTime(slot.deadline_time || '09:00', 1)}
                          onChange={(e) => handleUpdateSlot(idx, 'late_remind_time', e.target.value)}
                          className="rounded-lg border border-amber-300 bg-amber-50/60 px-2.5 py-1 text-xs font-bold text-amber-900 focus:border-amber-500"
                          title="Giờ tự động nhắc nhở sau 1h nếu nhân sự chưa nộp báo cáo mốc này"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="time"
                          value={slot.summary_time || '09:01'}
                          onChange={(e) => handleUpdateSlot(idx, 'summary_time', e.target.value)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold bg-white text-emerald-700"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="number"
                          step="10000"
                          value={slot.penalty_amount || 50000}
                          onChange={(e) => handleUpdateSlot(idx, 'penalty_amount', Number(e.target.value))}
                          className="w-28 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold bg-white text-right"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteSlot(idx)}
                          disabled={(schedule.slots || []).length <= 1}
                          className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 transition"
                          title="Xóa mốc này"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={schedule.overdue_remind_enabled ?? true}
                  onChange={(e) => handleChangeSchedule('overdue_remind_enabled', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>🔔 Bật nhắc nhở sau 1h đối với các nhân sự chưa nộp báo cáo mốc giờ</span>
              </label>
              <span className="text-[11px] text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200 font-medium">
                ⚡ Tự động tính sau 1h của mốc giờ (VD: 09:00 ➔ 10:00, 12:00 ➔ 13:00, 18:00 ➔ 19:00)
              </span>
            </div>

            <div className="text-[11px] text-slate-500 italic pt-1">
              ℹ️ Mỗi mốc giờ sẽ có thông báo nhắc nhở và thông báo phạt riêng. Nhân sự nghỉ ca OFF hoặc có đơn phép đã duyệt sẽ được tự động miễn phạt cho tất cả mốc giờ.
            </div>
          </div>

          {/* Khối 2: Tổng kết cuối ngày toàn đội & Google Sheets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Tổng kết cuối ngày */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <CalendarCheck2 className="h-5 w-5 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-800">
                  Báo Cáo Tổng Hợp Cuối Ngày (Daily Summary)
                </h3>
              </div>

              <div className="space-y-4 text-xs">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Gửi tin tổng kết cộng dồn cuối ngày vào nhóm
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
                      <span className="text-slate-600">Giờ gửi tin tổng kết cuối ngày:</span>
                      <input
                        type="time"
                        value={schedule.summary_time || '19:00'}
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
              </div>
            </div>

            {/* Đồng bộ Google Sheets */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-800">
                  Google Sheets Tích Hợp
                </h3>
              </div>

              <div className="space-y-4 text-xs">
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
      ) : (
        /* NẾU CHỌN 1 MỐC GIỜ (SINGLE_SLOT) - GIỮ NGUYÊN GIAO DIỆN CHUẨN CỦA TELESALE */
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
      )}
    </div>
  );
}
