import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Activity, ClipboardCheck, Save, Search, Settings, Trash2,
  Building2, Stethoscope, Sparkles, ShieldCheck, Zap, Clock,
  CalendarX, ArrowRightLeft, UserPlus, Package, MapPin
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const SERVICE_ACCOUNT_EMAIL = 'bot-ghi-sheet@hybrid-flame-499905-r2.iam.gserviceaccount.com';

function normalizeTime(value, fallback) {
  return String(value || fallback).slice(0, 5);
}

function extractDriveFolderId(value) {
  if (!value) return '';
  const match = String(value).match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : String(value).trim();
}

function extractSheetId(value) {
  if (!value) return '';
  const match = String(value).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : String(value).trim();
}

function GroupSettingsCard({ group, onUpdate, onDelete }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    bot_role: group.bot_role || '',
    customer_sheet_id: extractSheetId(group.customer_sheet_id) || '',
    kpi_sheet_id: extractSheetId(group.kpi_sheet_id) || '',
    pricing_sheet_id: extractSheetId(group.pricing_sheet_id) || '',
    customer_drive_folder_id: extractDriveFolderId(group.customer_drive_folder_id) || '',
    shift_1_time: normalizeTime(group.shift_1_time, '08:00'),
    shift_2_time: normalizeTime(group.shift_2_time, '13:30'),
    penalty_under_15: group.penalty_under_15 ?? 20000,
    penalty_under_90: group.penalty_under_90 ?? 2000,
    penalty_over_90: group.penalty_over_90 ?? 200000,
    schedule_registration_open: group.schedule_registration_open !== false,
    retail_shift_start: normalizeTime(group.retail_shift_start, '08:00'),
    retail_shift_end: normalizeTime(group.retail_shift_end, '18:00'),
    retail_kpi_target: group.retail_kpi_target ?? 15,
    attendance_policy: group.attendance_policy || 'CLINIC',
    marketing_checkin_deadline: normalizeTime(group.marketing_checkin_deadline, '08:30'),
    marketing_late_cutoff: normalizeTime(group.marketing_late_cutoff, '09:30'),
    marketing_sunday_checkin_deadline: normalizeTime(group.marketing_sunday_checkin_deadline, '09:00'),
    marketing_sunday_late_cutoff: normalizeTime(group.marketing_sunday_late_cutoff, '10:00'),
    marketing_checkin_penalty: Number(group.marketing_checkin_penalty) || 50000,
    checkout_min_time: normalizeTime(group.checkout_min_time, '18:30'),
    checkout_deadline: normalizeTime(group.checkout_deadline, '23:59'),
    marketing_checkout_penalty: Number(group.marketing_checkout_penalty) || 20000
  }));

  // Đồng bộ lại form state khi prop group thay đổi từ API
  useEffect(() => {
    setForm({
      bot_role: group.bot_role || '',
      customer_sheet_id: extractSheetId(group.customer_sheet_id) || '',
      kpi_sheet_id: extractSheetId(group.kpi_sheet_id) || '',
      pricing_sheet_id: extractSheetId(group.pricing_sheet_id) || '',
      customer_drive_folder_id: extractDriveFolderId(group.customer_drive_folder_id) || '',
      shift_1_time: normalizeTime(group.shift_1_time, '08:00'),
      shift_2_time: normalizeTime(group.shift_2_time, '13:30'),
      penalty_under_15: group.penalty_under_15 ?? 20000,
      penalty_under_90: group.penalty_under_90 ?? 2000,
      penalty_over_90: group.penalty_over_90 ?? 200000,
      schedule_registration_open: group.schedule_registration_open !== false,
      retail_shift_start: normalizeTime(group.retail_shift_start, '08:00'),
      retail_shift_end: normalizeTime(group.retail_shift_end, '18:00'),
      retail_kpi_target: group.retail_kpi_target ?? 15,
      attendance_policy: group.attendance_policy || 'CLINIC',
      marketing_checkin_deadline: normalizeTime(group.marketing_checkin_deadline, '08:30'),
      marketing_late_cutoff: normalizeTime(group.marketing_late_cutoff, '09:30'),
      marketing_checkin_penalty: Number(group.marketing_checkin_penalty) || 50000,
      checkout_min_time: normalizeTime(group.checkout_min_time, '18:30'),
      checkout_deadline: normalizeTime(group.checkout_deadline, '23:59'),
      marketing_checkout_penalty: Number(group.marketing_checkout_penalty) || 20000
    });
  }, [group]);

  const role = form.bot_role;
  const showCustomerSheet = !role || ['customer', 'report', 'report_tour', 'warehouse', 'retail_checkin', 'telesale'].includes(role);
  const showKpiSheet = !role || ['timekeep', 'report'].includes(role);
  const showDriveFolder = !role || ['customer', 'warehouse', 'retail_checkin'].includes(role);
  const showPricingSheet = role === 'warehouse';
  const showTimekeep = !role || role === 'timekeep';
  const showRetailConfig = role === 'retail_checkin';

  const applyMarketingDefaultPreset = () => {
    setForm(current => ({
      ...current,
      attendance_policy: 'MARKETING',
      marketing_checkin_deadline: '08:30',
      marketing_late_cutoff: '09:30',
      marketing_sunday_checkin_deadline: '09:00',
      marketing_sunday_late_cutoff: '10:00',
      marketing_checkin_penalty: 50000,
      checkout_min_time: '18:30',
      checkout_deadline: '23:59',
      marketing_checkout_penalty: 20000
    }));
  };

  const update = (field, value) => {
    let cleanValue = value;
    if (field === 'customer_drive_folder_id') {
      cleanValue = extractDriveFolderId(value);
    } else if (field === 'customer_sheet_id' || field === 'kpi_sheet_id' || field === 'pricing_sheet_id') {
      cleanValue = extractSheetId(value);
    }
    setForm(current => ({ ...current, [field]: cleanValue }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await onUpdate(group.telegram_group_id, {
        ...form,
        bot_role: form.bot_role || null,
        customer_sheet_id: extractSheetId(form.customer_sheet_id) || null,
        kpi_sheet_id: extractSheetId(form.kpi_sheet_id) || null,
        pricing_sheet_id: extractSheetId(form.pricing_sheet_id) || null,
        customer_drive_folder_id: extractDriveFolderId(form.customer_drive_folder_id) || null,
        shift_1_time: `${form.shift_1_time}:00`,
        shift_2_time: `${form.shift_2_time}:00`,
        penalty_under_15: Number(form.penalty_under_15) || 0,
        penalty_under_90: Number(form.penalty_under_90) || 0,
        penalty_over_90: Number(form.penalty_over_90) || 0,
        auto_reminder_enabled: true,
        attendance_policy: form.attendance_policy,
        marketing_checkin_deadline: `${form.marketing_checkin_deadline}:00`,
        marketing_late_cutoff: `${form.marketing_late_cutoff}:00`,
        marketing_sunday_checkin_deadline: form.marketing_sunday_checkin_deadline ? `${form.marketing_sunday_checkin_deadline}:00` : null,
        marketing_sunday_late_cutoff: form.marketing_sunday_late_cutoff ? `${form.marketing_sunday_late_cutoff}:00` : null,
        marketing_checkin_penalty: Number(form.marketing_checkin_penalty) || 50000,
        checkout_min_time: `${form.checkout_min_time}:00`,
        checkout_deadline: `${form.checkout_deadline}:00`,
        marketing_checkout_penalty: Number(form.marketing_checkout_penalty) || 20000,
        retail_shift_start: `${form.retail_shift_start}:00`,
        retail_shift_end: `${form.retail_shift_end}:00`,
        retail_kpi_target: Number(form.retail_kpi_target) || 15,
        approval_settings: approvalSettings
      });
    } finally {
      setSaving(false);
    }
  };

  const [approvalSettings, setApprovalSettings] = useState(() => group.approval_settings || {
    leave_late: 'AUTO',
    leave_absence: 'AUTO',
    staff_registration: 'AUTO',
    warehouse_order: 'AUTO',
    tour_report: 'AUTO',
    schedule_change: 'AUTO'
  });
  const [updatingApprovalKey, setUpdatingApprovalKey] = useState(null);

  useEffect(() => {
    if (group.approval_settings) {
      setApprovalSettings(group.approval_settings);
    }
  }, [group.approval_settings]);

  const toggleApproval = async (key) => {
    const currentMode = approvalSettings[key] || 'AUTO';
    const nextMode = currentMode === 'AUTO' ? 'MANUAL' : 'AUTO';
    const nextSettings = { ...approvalSettings, [key]: nextMode };
    setApprovalSettings(nextSettings);
    setUpdatingApprovalKey(key);
    try {
      await axios.put(`${API_URL}/groups/${group.telegram_group_id}/approval-settings`, {
        approval_settings: { [key]: nextMode }
      });
    } catch (err) {
      setApprovalSettings(approvalSettings);
      alert(`Lỗi khi đổi chế độ duyệt: ${err.response?.data?.error || err.message}`);
    } finally {
      setUpdatingApprovalKey(null);
    }
  };

  const approvalItems = useMemo(() => {
    const items = [
      {
        key: 'staff_registration',
        label: 'Duyệt nhân sự mới',
        desc: 'Tự động kích hoạt khi nhân viên mới vào nhóm',
        icon: UserPlus
      }
    ];

    if (!role || role === 'timekeep') {
      items.push(
        {
          key: 'leave_late',
          label: 'Đơn xin đi muộn',
          desc: 'Tự miễn/giảm phạt khi nhân viên báo đi muộn',
          icon: Clock
        },
        {
          key: 'leave_absence',
          label: 'Đơn xin nghỉ phép / nghỉ ca',
          desc: 'Nghỉ cả ngày, nửa ngày sáng/chiều',
          icon: CalendarX
        },
        {
          key: 'schedule_change',
          label: 'Đổi ca / sửa lịch',
          desc: 'Thay đổi ca làm việc trong tuần',
          icon: ArrowRightLeft
        }
      );
    }

    if (role === 'warehouse') {
      items.push({
        key: 'warehouse_order',
        label: 'Đơn xuất kho vật tư',
        desc: 'Tự duyệt và trừ tồn kho khi tạo đơn',
        icon: Package
      });
    }

    if (role === 'report_tour') {
      items.push({
        key: 'tour_report',
        label: 'Báo cáo Tour KTV',
        desc: 'Tự động ghi nhận và đồng bộ báo cáo tour',
        icon: MapPin
      });
    }

    return items;
  }, [role]);

  const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500/50';
  const labelClass = 'text-xs font-semibold text-slate-500';

  const isMarketing = form.bot_role === 'timekeep' && form.attendance_policy === 'MARKETING';
  const isClinic = form.bot_role === 'timekeep' && form.attendance_policy === 'CLINIC';

  return (
    <section className={`rounded-2xl border transition-all p-5 shadow-sm ${
      isMarketing 
        ? 'border-sky-300 bg-white ring-1 ring-sky-200' 
        : isClinic 
          ? 'border-indigo-200 bg-white' 
          : 'border-slate-200 bg-white'
    }`}>
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="truncate text-lg font-bold text-slate-900">{group.group_name}</h3>
            {form.bot_role === 'timekeep' && (
              form.attendance_policy === 'MARKETING' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-800 border border-sky-300 shadow-2xs">
                  <Building2 className="h-3.5 w-3.5 text-sky-600" />
                  Marketing (Check-in 08:30 / Check-out 18:30)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800 border border-indigo-300 shadow-2xs">
                  <Stethoscope className="h-3.5 w-3.5 text-indigo-600" />
                  Phòng khám / Kỹ thuật viên (Ca 1 & Ca 2)
                </span>
              )
            )}
            {form.bot_role === 'warehouse' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-300">
                📦 Quản lý kho
              </span>
            )}
            {form.bot_role === 'telesale' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-300">
                📞 Báo cáo Telesale
              </span>
            )}
            {form.bot_role === 'customer' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800 border border-purple-300">
                📋 Hồ sơ khách hàng
              </span>
            )}
            {form.bot_role === 'retail_checkin' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-800 border border-orange-300">
                🏪 Check-in thị trường
              </span>
            )}
            {form.bot_role === 'report_tour' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-800 border border-teal-300">
                🚗 KTV Báo Tour
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-slate-500">ID: {group.telegram_group_id}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition shadow-2xs">
            <Save className="h-4 w-4" />{saving ? 'Đang lưu…' : 'Lưu cài đặt'}
          </button>
          <button type="button" onClick={() => onDelete(group.telegram_group_id)} className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-400 hover:bg-rose-500/20" title="Xóa nhóm">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* KHỐI CHÍNH SÁCH PHÊ DUYỆT (TỰ ĐỘNG DUYỆT / YÊU CẦU DUYỆT) */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-3">
          <div>
            <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              Chính sách phê duyệt của nhóm
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Cấu hình Tự động duyệt ngay khi nộp hoặc Yêu cầu Quản lý/Admin duyệt trên Web Admin cho từng chức năng.
            </p>
          </div>
          <span className="text-[11px] font-medium text-slate-500 bg-white border border-slate-200 rounded-lg px-2.5 py-1 self-start sm:self-auto shadow-2xs">
            Bấm nút để đổi chế độ ngay
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {approvalItems.map(item => {
            const isAuto = (approvalSettings[item.key] || 'AUTO') === 'AUTO';
            const isBusy = updatingApprovalKey === item.key;
            return (
              <div
                key={item.key}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-2xs hover:border-blue-200 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <item.icon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                    <span className="truncate text-xs font-bold text-slate-800" title={item.label}>{item.label}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5 truncate" title={item.desc}>{item.desc}</p>
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => toggleApproval(item.key)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold shadow-2xs transition disabled:opacity-50 ${
                    isAuto
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400'
                      : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-400'
                  }`}
                  title={isAuto ? 'Đang Tự động duyệt. Bấm để chuyển sang Yêu cầu duyệt' : 'Đang Yêu cầu duyệt. Bấm để chuyển sang Tự động duyệt'}
                >
                  {isAuto ? <Zap className="h-3.5 w-3.5 text-emerald-600" /> : <Clock className="h-3.5 w-3.5 text-amber-600" />}
                  <span>{isBusy ? 'Đang lưu…' : (isAuto ? 'Tự động duyệt' : 'Yêu cầu duyệt')}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <label className={labelClass}>Vai trò của Bot trong nhóm
          <select value={form.bot_role} onChange={event => update('bot_role', event.target.value)} className={inputClass}>
            <option value="">Chưa chọn vai trò</option>
            <option value="timekeep">Chấm công (Marketing hoặc Clinic)</option>
            <option value="retail_checkin">Check-in thị trường (PG / Giám sát)</option>
            <option value="customer">Hồ sơ khách hàng</option>
            <option value="report">Báo cáo hẹn khách cũ</option>
            <option value="report_tour">Lịch khách Tour (KTV)</option>
            <option value="warehouse">Quản lý kho (vật tư & sản phẩm)</option>
            <option value="telesale">Báo cáo Telesale</option>
          </select>
        </label>

        {showCustomerSheet && <label className={`${labelClass} xl:col-span-2`}>
          {role === 'warehouse' ? 'ID Google Sheet báo cáo kho' : role === 'retail_checkin' ? 'ID Google Sheet check-in thị trường' : 'ID Google Sheet khách hàng / Báo cáo'}
          <input value={form.customer_sheet_id} onChange={event => update('customer_sheet_id', event.target.value)} className={`${inputClass} font-mono`} placeholder="Nhập ID Google Sheet" />
        </label>}

        {showKpiSheet && <label className={`${labelClass} xl:col-span-2`}>ID Google Sheet chấm công
          <input value={form.kpi_sheet_id} onChange={event => update('kpi_sheet_id', event.target.value)} className={`${inputClass} font-mono`} placeholder="Nhập ID Google Sheet" />
        </label>}

        {showDriveFolder && <label className={`${labelClass} lg:col-span-2 xl:col-span-4`}>
          {role === 'warehouse' ? 'ID thư mục Drive lưu minh chứng nhập kho' : role === 'retail_checkin' ? 'ID thư mục Drive lưu ảnh điểm bán' : 'ID thư mục Drive lưu ảnh/video khách hàng'}
          <input value={form.customer_drive_folder_id} onChange={event => update('customer_drive_folder_id', event.target.value)} className={`${inputClass} font-mono`} placeholder="Để trống để sử dụng thư mục mặc định" />
        </label>}

        {showPricingSheet && <label className={`${labelClass} xl:col-span-2`}>
          ID Google Sheet đơn giá (riêng cho kế toán)
          <input value={form.pricing_sheet_id} onChange={event => update('pricing_sheet_id', event.target.value)} className={`${inputClass} font-mono`} placeholder="Dán link hoặc ID Google Sheet đơn giá" />
          <span className="mt-1 block text-[11px] font-normal text-amber-400/80">
            Sheet riêng, tách biệt hoàn toàn với "ID Google Sheet báo cáo kho" ở trên để chỉ chia sẻ file này trên Google Drive cho đúng người được xem giá.
          </span>
        </label>}

        {showRetailConfig && <>
          <label className={labelClass}>Giờ bắt đầu ca
            <input type="time" value={form.retail_shift_start} onChange={e => update('retail_shift_start', e.target.value)} className={inputClass} />
          </label>
          <label className={labelClass}>Giờ kết thúc ca
            <input type="time" value={form.retail_shift_end} onChange={e => update('retail_shift_end', e.target.value)} className={inputClass} />
            <span className="mt-1 block text-[11px] font-normal text-slate-400">Lịch nhắc tự động tính từ giờ này (-2h, -1h, -30p, -10p, +1p).</span>
          </label>
          <label className={labelClass}>KPI tối đa / ngày (số điểm)
            <input type="number" min="1" step="1" value={form.retail_kpi_target} onChange={e => update('retail_kpi_target', e.target.value)} className={inputClass} />
            <span className="mt-1 block text-[11px] font-normal text-slate-400">Nhân viên cần đạt đủ số này trong ngày.</span>
          </label>
        </>}

        {showTimekeep && <>
          <div className="xl:col-span-2">
            <p className={labelClass}>Chế độ Chấm công của nhóm (Chọn để cấu hình quy định)</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => update('attendance_policy', 'CLINIC')}
                className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 px-3 text-sm font-semibold transition-all ${
                  form.attendance_policy === 'CLINIC'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm ring-2 ring-indigo-500/20'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Stethoscope className="h-4 w-4 text-indigo-600" />
                <span>Phòng khám / Kỹ thuật viên</span>
              </button>
              <button
                type="button"
                onClick={() => update('attendance_policy', 'MARKETING')}
                className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 px-3 text-sm font-semibold transition-all ${
                  form.attendance_policy === 'MARKETING'
                    ? 'border-sky-600 bg-sky-50 text-sky-700 shadow-sm ring-2 ring-sky-500/20'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Building2 className="h-4 w-4 text-sky-600" />
                <span>Marketing / Văn phòng</span>
              </button>
            </div>
          </div>

          {form.attendance_policy === 'MARKETING' ? (
            <div className="xl:col-span-2 space-y-4 rounded-xl border border-sky-200 bg-sky-50/50 p-4">
              <div className="flex items-center justify-between border-b border-sky-100 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">🏢</span>
                  <h4 className="text-sm font-bold text-sky-900">Cấu hình Check-in & Check-out Marketing</h4>
                </div>
                <button
                  type="button"
                  onClick={applyMarketingDefaultPreset}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50 transition-colors shadow-2xs"
                >
                  <Sparkles className="h-3 w-3 text-sky-600" />
                  Đặt lại thông số chuẩn (50k / 20k)
                </button>
              </div>

              {/* KHỐI 1: CHECK-IN */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">1. Quy định Check-in (Đầu ca)</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className={labelClass}>Hạn chót check-in đúng giờ
                    <input
                      type="time"
                      value={form.marketing_checkin_deadline}
                      onChange={e => update('marketing_checkin_deadline', e.target.value)}
                      className={inputClass}
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">Mặc định: 08:30 (Video quay trực tiếp)</span>
                  </label>
                  <label className={labelClass}>Mốc muộn &gt; 60p (Trừ 1/2 công)
                    <input
                      type="time"
                      value={form.marketing_late_cutoff}
                      onChange={e => update('marketing_late_cutoff', e.target.value)}
                      className={inputClass}
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">Sau mốc này trừ 1/2 ngày công</span>
                  </label>
                  <label className={labelClass}>Tiền phạt đi muộn (đ)
                    <input
                      type="number"
                      min="0"
                      step="5000"
                      value={form.marketing_checkin_penalty}
                      onChange={e => update('marketing_checkin_penalty', e.target.value)}
                      className={inputClass}
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">Mặc định: 50.000đ/lần</span>
                  </label>
                  <label className={labelClass}>Hạn check-in Chủ Nhật
                    <input
                      type="time"
                      value={form.marketing_sunday_checkin_deadline}
                      onChange={e => update('marketing_sunday_checkin_deadline', e.target.value)}
                      className={inputClass}
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">Riêng Chủ Nhật (mặc định 09:00)</span>
                  </label>
                  <label className={labelClass}>Mốc muộn &gt; 60p Chủ Nhật
                    <input
                      type="time"
                      value={form.marketing_sunday_late_cutoff}
                      onChange={e => update('marketing_sunday_late_cutoff', e.target.value)}
                      className={inputClass}
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">Chủ Nhật sau mốc này trừ 1/2 công (10:00)</span>
                  </label>
                </div>
              </div>

              {/* KHỐI 2: CHECK-OUT */}
              <div className="space-y-2 pt-2 border-t border-sky-100">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">2. Quy định Check-out (Cuối ca)</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className={labelClass}>Giờ bắt đầu được check-out
                    <input
                      type="time"
                      value={form.checkout_min_time}
                      onChange={e => update('checkout_min_time', e.target.value)}
                      className={inputClass}
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">Mặc định: 18:30 (Trước giờ này sẽ chặn)</span>
                  </label>
                  <label className={labelClass}>Giờ quét phạt quên check-out
                    <input
                      type="time"
                      value={form.checkout_deadline}
                      onChange={e => update('checkout_deadline', e.target.value)}
                      className={inputClass}
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">Mặc định: 23:59 (12h đêm chốt cuối ngày)</span>
                  </label>
                  <label className={labelClass}>Tiền phạt quên check-out (đ)
                    <input
                      type="number"
                      min="0"
                      step="5000"
                      value={form.marketing_checkout_penalty}
                      onChange={e => update('marketing_checkout_penalty', e.target.value)}
                      className={inputClass}
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">Mặc định: 20.000đ/lần</span>
                  </label>
                </div>
              </div>
            </div>
          ) : (
            <>
              <label className={labelClass}>Giờ bắt đầu ca sớm
                <input type="time" value={form.shift_1_time} onChange={event => update('shift_1_time', event.target.value)} className={inputClass} />
              </label>
              <label className={labelClass}>Giờ bắt đầu ca muộn
                <input type="time" value={form.shift_2_time} onChange={event => update('shift_2_time', event.target.value)} className={inputClass} />
              </label>
              <label className={labelClass}>Phạt muộn dưới 15 phút
                <input type="number" min="0" step="1000" value={form.penalty_under_15} onChange={event => update('penalty_under_15', event.target.value)} className={inputClass} />
              </label>
              <label className={labelClass}>Phạt từ 15 đến dưới 90 phút
                <input type="number" min="0" step="1000" value={form.penalty_under_90} onChange={event => update('penalty_under_90', event.target.value)} className={inputClass} />
              </label>
              <label className={labelClass}>Phạt từ 90 phút trở lên
                <input type="number" min="0" step="1000" value={form.penalty_over_90} onChange={event => update('penalty_over_90', event.target.value)} className={inputClass} />
              </label>
            </>
          )}
          <div>
            <p className={labelClass}>Đăng ký lịch làm việc</p>
            <button type="button" onClick={() => update('schedule_registration_open', !form.schedule_registration_open)} className={`mt-1.5 w-full rounded-lg border px-3 py-2.5 text-sm font-bold ${form.schedule_registration_open ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-rose-500/30 bg-rose-500/10 text-rose-400'}`}>
              {form.schedule_registration_open ? 'Đang mở đăng ký' : 'Đang đóng'}
            </button>
          </div>
        </>}
      </div>
    </section>
  );
}

export default function SettingsManagement({ groups, selectedGroupId = 'ALL', onUpdate, onDelete }) {
  const [copied, setCopied] = useState(false);
  const [filterType, setFilterType] = useState('ALL'); // 'ALL' | 'MARKETING' | 'CLINIC' | 'WAREHOUSE' | 'OTHER'
  const [searchQuery, setSearchQuery] = useState('');

  const mktCount = useMemo(() => groups.filter(g => g.bot_role === 'timekeep' && g.attendance_policy === 'MARKETING').length, [groups]);
  const clinicCount = useMemo(() => groups.filter(g => g.bot_role === 'timekeep' && g.attendance_policy !== 'MARKETING').length, [groups]);
  const warehouseCount = useMemo(() => groups.filter(g => g.bot_role === 'warehouse').length, [groups]);

  const displayedGroups = useMemo(() => {
    let list = selectedGroupId === 'ALL'
      ? groups
      : groups.filter(group => String(group.telegram_group_id) === String(selectedGroupId));

    if (filterType === 'MARKETING') {
      list = list.filter(g => g.bot_role === 'timekeep' && g.attendance_policy === 'MARKETING');
    } else if (filterType === 'CLINIC') {
      list = list.filter(g => g.bot_role === 'timekeep' && g.attendance_policy !== 'MARKETING');
    } else if (filterType === 'WAREHOUSE') {
      list = list.filter(g => g.bot_role === 'warehouse');
    } else if (filterType === 'OTHER') {
      list = list.filter(g => g.bot_role !== 'timekeep' && g.bot_role !== 'warehouse');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(g => (g.group_name || '').toLowerCase().includes(q) || String(g.telegram_group_id).includes(q));
    }

    return list;
  }, [groups, selectedGroupId, filterType, searchQuery]);

  const copyEmail = async () => {
    await navigator.clipboard.writeText(SERVICE_ACCOUNT_EMAIL);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      <header>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Settings className="h-6 w-6 text-blue-400" />Cấu hình nhóm</h2>
        <p className="mt-1 text-sm text-slate-500">Cấu hình riêng theo vai trò hoạt động của từng nhóm Telegram.</p>
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-400"><Activity className="h-4 w-4" />Google Sheets và Drive</p>
          <p className="mt-1 text-sm text-slate-600">Chia sẻ quyền Editor cho Service Account:</p>
          <code className="mt-2 block break-all text-xs text-blue-300">{SERVICE_ACCOUNT_EMAIL}</code>
        </div>
        <button type="button" onClick={copyEmail} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm font-bold text-blue-400 hover:bg-blue-500/20">
          <ClipboardCheck className="h-4 w-4" />{copied ? 'Đã sao chép' : 'Sao chép email'}
        </button>
      </div>

      {/* THANH BỘ LỌC VÀ TÌM KIẾM NHANH */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterType('ALL')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filterType === 'ALL'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Tất cả ({groups.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('MARKETING')}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filterType === 'MARKETING'
                ? 'bg-sky-600 text-white shadow-2xs'
                : 'bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            Chấm công Marketing ({mktCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('CLINIC')}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filterType === 'CLINIC'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
            }`}
          >
            <Stethoscope className="h-3.5 w-3.5" />
            Chấm công Phòng khám ({clinicCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('WAREHOUSE')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filterType === 'WAREHOUSE'
                ? 'bg-amber-600 text-white shadow-2xs'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            Kho ({warehouseCount})
          </button>
        </div>

        <div className="relative min-w-[200px] sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên nhóm / ID..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
          />
        </div>
      </div>

      {displayedGroups.length === 0
        ? <div className="rounded-2xl border border-dashed border-slate-200 p-12 text-center text-slate-500">
            Không tìm thấy nhóm phù hợp với bộ lọc hiện tại.
          </div>
        : displayedGroups.map(group => (
          <GroupSettingsCard
            key={`${group.telegram_group_id}-${group.updated_at || ''}`}
            group={group}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}
