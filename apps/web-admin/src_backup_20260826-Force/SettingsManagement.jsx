import { useMemo, useState } from 'react';
import { Activity, ClipboardCheck, Save, Settings, Trash2 } from 'lucide-react';

const SERVICE_ACCOUNT_EMAIL = 'bot-ghi-sheet@hybrid-flame-499905-r2.iam.gserviceaccount.com';

function normalizeTime(value, fallback) {
  return String(value || fallback).slice(0, 5);
}

function GroupSettingsCard({ group, onUpdate, onDelete }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    bot_role: group.bot_role || '',
    customer_sheet_id: group.customer_sheet_id || '',
    kpi_sheet_id: group.kpi_sheet_id || '',
    pricing_sheet_id: group.pricing_sheet_id || '',
    customer_drive_folder_id: group.customer_drive_folder_id || '',
    shift_1_time: normalizeTime(group.shift_1_time, '08:00'),
    shift_2_time: normalizeTime(group.shift_2_time, '13:30'),
    penalty_under_15: group.penalty_under_15 ?? 20000,
    penalty_under_90: group.penalty_under_90 ?? 2000,
    penalty_over_90: group.penalty_over_90 ?? 200000,
    schedule_registration_open: group.schedule_registration_open !== false
  }));

  const role = form.bot_role;
  const showCustomerSheet = !role || ['customer', 'report', 'report_tour', 'warehouse'].includes(role);
  const showKpiSheet = !role || ['timekeep', 'report'].includes(role);
  const showDriveFolder = !role || ['customer', 'warehouse'].includes(role);
  const showPricingSheet = role === 'warehouse';
  const showTimekeep = !role || role === 'timekeep';

  const update = (field, value) => setForm(current => ({ ...current, [field]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await onUpdate(group.telegram_group_id, {
        ...form,
        bot_role: form.bot_role || null,
        customer_sheet_id: form.customer_sheet_id || null,
        kpi_sheet_id: form.kpi_sheet_id || null,
        pricing_sheet_id: form.pricing_sheet_id || null,
        customer_drive_folder_id: form.customer_drive_folder_id || null,
        shift_1_time: `${form.shift_1_time}:00`,
        shift_2_time: `${form.shift_2_time}:00`,
        penalty_under_15: Number(form.penalty_under_15) || 0,
        penalty_under_90: Number(form.penalty_under_90) || 0,
        penalty_over_90: Number(form.penalty_over_90) || 0,
        auto_reminder_enabled: true
      });
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0F19] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500/50';
  const labelClass = 'text-xs font-semibold text-slate-400';

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <div className="flex flex-col gap-4 border-b border-white/[0.07] pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-white">{group.group_name}</h3>
          <p className="mt-1 font-mono text-xs text-slate-500">ID: {group.telegram_group_id}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">
            <Save className="h-4 w-4" />{saving ? 'Đang lưu…' : 'Lưu cài đặt'}
          </button>
          <button type="button" onClick={() => onDelete(group.telegram_group_id)} className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-400 hover:bg-rose-500/20" title="Xóa nhóm">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <label className={labelClass}>Vai trò của Bot
          <select value={form.bot_role} onChange={event => update('bot_role', event.target.value)} className={inputClass}>
            <option value="">Chưa xác định</option>
            <option value="timekeep">Bot chấm công</option>
            <option value="report">Bot báo cáo</option>
            <option value="report_tour">Bot lịch khách (Tour)</option>
            <option value="customer">Hồ sơ khách hàng</option>
            <option value="warehouse">Quản lý kho</option>
          </select>
        </label>

        {showCustomerSheet && <label className={`${labelClass} xl:col-span-2`}>
          {role === 'warehouse' ? 'ID Google Sheet báo cáo kho' : 'ID Google Sheet lịch khách'}
          <input value={form.customer_sheet_id} onChange={event => update('customer_sheet_id', event.target.value)} className={`${inputClass} font-mono`} placeholder="Nhập ID Google Sheet" />
        </label>}

        {showKpiSheet && <label className={`${labelClass} xl:col-span-2`}>ID Google Sheet chấm công
          <input value={form.kpi_sheet_id} onChange={event => update('kpi_sheet_id', event.target.value)} className={`${inputClass} font-mono`} placeholder="Nhập ID Google Sheet" />
        </label>}

        {showDriveFolder && <label className={`${labelClass} lg:col-span-2 xl:col-span-4`}>
          {role === 'warehouse' ? 'ID thư mục Drive lưu minh chứng nhập kho' : 'ID thư mục Drive lưu ảnh/video khách hàng'}
          <input value={form.customer_drive_folder_id} onChange={event => update('customer_drive_folder_id', event.target.value)} className={`${inputClass} font-mono`} placeholder="Để trống để sử dụng thư mục mặc định" />
        </label>}

        {showPricingSheet && <label className={`${labelClass} xl:col-span-2`}>
          ID Google Sheet đơn giá (riêng cho kế toán)
          <input value={form.pricing_sheet_id} onChange={event => update('pricing_sheet_id', event.target.value)} className={`${inputClass} font-mono`} placeholder="Dán link hoặc ID Google Sheet đơn giá" />
          <span className="mt-1 block text-[11px] font-normal text-amber-400/80">
            Sheet riêng, tách biệt hoàn toàn với "ID Google Sheet báo cáo kho" ở trên — chỉ chia sẻ file này trên Google Drive cho đúng người được xem giá.
          </span>
        </label>}

        {showTimekeep && <>
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
  const displayedGroups = useMemo(() => selectedGroupId === 'ALL'
    ? groups
    : groups.filter(group => String(group.telegram_group_id) === String(selectedGroupId)), [groups, selectedGroupId]);

  const copyEmail = async () => {
    await navigator.clipboard.writeText(SERVICE_ACCOUNT_EMAIL);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      <header>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-white"><Settings className="h-6 w-6 text-cyan-400" />Cấu hình nhóm</h2>
        <p className="mt-1 text-sm text-slate-400">Cấu hình riêng theo vai trò hoạt động của từng nhóm Telegram.</p>
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400"><Activity className="h-4 w-4" />Google Sheets và Drive</p>
          <p className="mt-1 text-sm text-slate-300">Chia sẻ quyền Editor cho Service Account:</p>
          <code className="mt-2 block break-all text-xs text-cyan-300">{SERVICE_ACCOUNT_EMAIL}</code>
        </div>
        <button type="button" onClick={copyEmail} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-bold text-cyan-400 hover:bg-cyan-500/20">
          <ClipboardCheck className="h-4 w-4" />{copied ? 'Đã sao chép' : 'Sao chép email'}
        </button>
      </div>

      {displayedGroups.length === 0
        ? <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-slate-500">Chưa có nhóm phù hợp.</div>
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
