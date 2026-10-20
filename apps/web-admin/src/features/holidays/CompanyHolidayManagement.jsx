import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { CalendarPlus, Edit3, X, Ban, BellRing } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const emptyForm = { name: '', start_date: '', end_date: '', note: '' };

function formatDate(value) {
  if (!value) return '—';
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('vi-VN');
}

function formatShortDate(value) {
  if (!value) return '';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return `${day}/${month}/${year.slice(-2)}`;
}

function parseShortDate(value) {
  const match = String(value).trim().match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!match) return '';
  const [, day, month, rawYear] = match;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  return date.getFullYear() === Number(year) && date.getMonth() + 1 === Number(month) && date.getDate() === Number(day) ? iso : '';
}

function ShortDateInput({ value, onChange, min }) {
  const [draft, setDraft] = useState(() => formatShortDate(value));

  return <input
    required
    inputMode="numeric"
    placeholder="dd/mm/yy"
    value={draft}
    onChange={event => {
      const next = event.target.value.replace(/[^0-9/]/g, '').slice(0, 10);
      setDraft(next);
      const parsed = parseShortDate(next);
      onChange(parsed && (!min || parsed >= min) ? parsed : '');
    }}
    pattern="\d{2}/\d{2}/(?:\d{2}|\d{4})"
    title="Nhập ngày theo định dạng dd/mm/yy, ví dụ 02/09/26"
    className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3"
  />;
}

function displayStatus(holiday) {
  if (holiday.status === 'CANCELLED') return { label: 'Đã hủy', tone: 'border-slate-200 bg-slate-100 text-slate-500' };
  const today = new Date().toLocaleDateString('en-CA');
  const start = String(holiday.start_date).slice(0, 10);
  const end = String(holiday.end_date).slice(0, 10);
  if (today < start) return { label: 'Sắp diễn ra', tone: 'border-blue-200 bg-blue-50 text-blue-600' };
  if (today <= end) return { label: 'Đang nghỉ', tone: 'border-emerald-200 bg-emerald-50 text-emerald-600' };
  return { label: 'Đã kết thúc', tone: 'border-slate-200 bg-slate-50 text-slate-500' };
}

export default function CompanyHolidayManagement({ isSuperAdmin }) {
  const [holidays, setHolidays] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const notify = useCallback(message => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/admin/company-holidays`, { params: { year } });
      setHolidays(response.data || []);
    } catch (error) {
      notify(error.response?.data?.error || 'Không tải được danh sách ngày nghỉ.');
    } finally {
      setLoading(false);
    }
  }, [notify, year]);

  useEffect(() => {
    const requestId = window.setTimeout(load, 0);
    return () => window.clearTimeout(requestId);
  }, [load]);

  const upcoming = useMemo(() => holidays.find(item => item.status !== 'CANCELLED' && String(item.end_date).slice(0, 10) >= new Date().toLocaleDateString('en-CA')), [holidays]);

  const openCreate = () => { setEditing({}); setForm(emptyForm); };
  const openEdit = holiday => {
    setEditing(holiday);
    setForm({ name: holiday.name, start_date: String(holiday.start_date).slice(0, 10), end_date: String(holiday.end_date).slice(0, 10), note: holiday.note || '' });
  };

  const save = async event => {
    event.preventDefault();
    if (!form.start_date || !form.end_date) {
      notify('Vui lòng nhập ngày hợp lệ theo định dạng dd/mm/yy.');
      return;
    }
    if (form.end_date < form.start_date) {
      notify('Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.');
      return;
    }
    setSaving(true);
    try {
      if (editing?.id) await axios.put(`${API_URL}/admin/company-holidays/${editing.id}`, form);
      else await axios.post(`${API_URL}/admin/company-holidays`, form);
      setEditing(null);
      notify('Đã lưu kỳ nghỉ công ty.');
      await load();
    } catch (error) {
      notify(error.response?.data?.error || 'Không lưu được kỳ nghỉ.');
    } finally { setSaving(false); }
  };

  const cancelHoliday = async holiday => {
    if (!window.confirm(`Hủy kỳ nghỉ “${holiday.name}”?`)) return;
    try {
      await axios.post(`${API_URL}/admin/company-holidays/${holiday.id}/cancel`);
      notify('Đã hủy kỳ nghỉ.');
      await load();
    } catch (error) { notify(error.response?.data?.error || 'Không hủy được kỳ nghỉ.'); }
  };

  return <div className="space-y-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Ngày nghỉ công ty</h2><p className="mt-1 text-sm text-slate-500">Miễn check-in và báo cáo KPI cho toàn bộ nhân viên.</p></div>
      {isSuperAdmin && <button onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200"><CalendarPlus className="h-4 w-4" />Thêm kỳ nghỉ</button>}
    </header>

    <section className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm">
      <div className="flex items-start gap-3"><div className="rounded-xl bg-blue-600 p-2.5 text-white"><BellRing className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Kỳ nghỉ sắp tới</p>{upcoming ? <><h3 className="mt-1 text-lg font-bold text-slate-900">{upcoming.name}</h3><p className="text-sm text-slate-600">{formatDate(upcoming.start_date)} – {formatDate(upcoming.end_date)} · Thông báo 08:00 ngày bắt đầu</p></> : <p className="mt-1 text-sm text-slate-500">Chưa có kỳ nghỉ nào được lên lịch.</p>}</div></div>
    </section>

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5"><h3 className="font-bold text-slate-900">Danh sách kỳ nghỉ</h3><select value={year} onChange={event => setYear(Number(event.target.value))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">{[year - 1, year, year + 1].filter((value, index, values) => values.indexOf(value) === index).map(value => <option key={value}>{value}</option>)}</select></div>
      {loading ? <div className="p-12 text-center text-sm text-slate-500">Đang tải…</div> : holidays.length === 0 ? <div className="p-12 text-center text-sm text-slate-500">Chưa có kỳ nghỉ trong năm này.</div> : <>
        <div className="divide-y divide-slate-100 md:hidden">{holidays.map(holiday => { const status = displayStatus(holiday); return <article key={holiday.id} className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="font-bold text-slate-900">{holiday.name}</h4><p className="mt-1 text-xs text-slate-500">{formatDate(holiday.start_date)} – {formatDate(holiday.end_date)}</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${status.tone}`}>{status.label}</span></div>{holiday.note && <p className="text-sm text-slate-600">{holiday.note}</p>}<p className="text-xs text-slate-500">Thông báo: {holiday.announcement_sent_at ? `Đã gửi ${holiday.sent_count}/${holiday.notification_count} nhóm` : '08:00 ngày bắt đầu'}</p>{isSuperAdmin && holiday.status !== 'CANCELLED' && <div className="flex gap-2"><button onClick={() => openEdit(holiday)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-600"><Edit3 className="h-4 w-4" />Sửa</button><button onClick={() => cancelHoliday(holiday)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600"><Ban className="h-4 w-4" />Hủy</button></div>}</article>; })}</div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-4">Kỳ nghỉ</th><th className="px-5 py-4">Thời gian</th><th className="px-5 py-4">Thông báo</th><th className="px-5 py-4">Trạng thái</th><th className="px-5 py-4 text-right">Thao tác</th></tr></thead><tbody className="divide-y divide-slate-100">{holidays.map(holiday => { const status = displayStatus(holiday); return <tr key={holiday.id}><td className="px-5 py-4"><strong>{holiday.name}</strong>{holiday.note && <p className="mt-1 max-w-sm text-xs text-slate-500">{holiday.note}</p>}</td><td className="px-5 py-4">{formatDate(holiday.start_date)} – {formatDate(holiday.end_date)}</td><td className="px-5 py-4 text-xs text-slate-500">{holiday.announcement_sent_at ? `Đã gửi ${holiday.sent_count}/${holiday.notification_count} nhóm` : '08:00 ngày bắt đầu'}</td><td className="px-5 py-4"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span></td><td className="px-5 py-4"><div className="flex justify-end gap-2">{isSuperAdmin && holiday.status !== 'CANCELLED' && <><button onClick={() => openEdit(holiday)} className="rounded-lg border border-blue-200 p-2 text-blue-600" title="Sửa"><Edit3 className="h-4 w-4" /></button><button onClick={() => cancelHoliday(holiday)} className="rounded-lg border border-rose-200 p-2 text-rose-600" title="Hủy"><Ban className="h-4 w-4" /></button></>}</div></td></tr>; })}</tbody></table></div>
      </>}
    </section>

    {editing && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"><form onSubmit={save} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"><div className="flex items-center justify-between"><h3 className="text-lg font-bold">{editing.id ? 'Sửa kỳ nghỉ' : 'Thêm kỳ nghỉ'}</h3><button type="button" onClick={() => setEditing(null)} className="p-2 text-slate-500"><X className="h-5 w-5" /></button></div><div className="mt-5 space-y-4"><label className="block text-sm font-medium">Tên kỳ nghỉ<input required maxLength={200} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="Ví dụ: Nghỉ Quốc khánh" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Từ ngày<ShortDateInput value={form.start_date} onChange={startDate => setForm(current => ({ ...current, start_date: startDate }))} /></label><label className="block text-sm font-medium">Đến ngày<ShortDateInput value={form.end_date} min={form.start_date} onChange={endDate => setForm(current => ({ ...current, end_date: endDate }))} /></label></div><p className="-mt-2 text-[11px] text-slate-500">Định dạng ngày: dd/mm/yy, ví dụ 02/09/26.</p><label className="block text-sm font-medium">Ghi chú<textarea rows="3" value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3" /></label><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">Thông báo chỉ gửi một lần lúc 08:00 ngày bắt đầu tới các nhóm Check-in và Báo cáo KPI. Trong toàn bộ khoảng ngày, hệ thống không nhắc hoặc tính phạt.</div></div><button disabled={saving} className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50">{saving ? 'Đang lưu…' : 'Lưu kỳ nghỉ'}</button></form></div>}
    {toast && <div className="fixed bottom-5 right-5 z-[60] max-w-sm rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">{toast}</div>}
  </div>;
}
