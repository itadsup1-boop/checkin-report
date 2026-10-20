import { useState } from 'react';
import axios from 'axios';
const API = `${import.meta.env.VITE_API_URL || '/api'}/admin/telegram-automation`;
export default function ConnectAccountModal({ onClose, onConnected }) {
  const [step, setStep] = useState('PHONE'); const [account, setAccount] = useState(null);
  const [form, setForm] = useState({ displayName: '', phone: '', code: '', password: '' }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const change = e => setForm(value => ({ ...value, [e.target.name]: e.target.value }));
  const submit = async e => { e.preventDefault(); setBusy(true); setError(''); try {
    if (step === 'PHONE') { const r = await axios.post(`${API}/accounts/connect`, form); setAccount(r.data); setStep('CODE'); }
    else if (step === 'CODE') { const r = await axios.post(`${API}/accounts/${account.id}/code`, { code: form.code }); if (r.data.status === 'PENDING_PASSWORD') setStep('PASSWORD'); else onConnected(); }
    else { await axios.post(`${API}/accounts/${account.id}/password`, { password: form.password }); onConnected(); }
  } catch (x) { setError(x.response?.data?.message || x.message); } finally { setBusy(false); } };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 sm:items-center sm:p-4"><form onSubmit={submit} className="w-full max-w-lg rounded-t-3xl bg-white p-5 sm:rounded-3xl sm:p-7"><div className="flex justify-between"><div><h2 className="text-xl font-bold">Kết nối Telegram</h2><p className="text-sm text-slate-500">OTP và mật khẩu Telegram không được lưu.</p></div><button type="button" onClick={onClose} className="text-2xl">×</button></div>
    {step === 'PHONE' && <div className="mt-6 space-y-4"><label className="block text-sm font-medium">Tên hiển thị<input required name="displayName" value={form.displayName} onChange={change} className="mt-1 w-full rounded-xl border p-3" /></label><label className="block text-sm font-medium">Số điện thoại có mã quốc gia<input required name="phone" value={form.phone} onChange={change} placeholder="+84901234567" className="mt-1 w-full rounded-xl border p-3" /></label></div>}
    {step === 'CODE' && <label className="mt-6 block text-sm font-medium">Mã Telegram gửi về<input required autoFocus name="code" value={form.code} onChange={change} className="mt-1 w-full rounded-xl border p-3" /></label>}
    {step === 'PASSWORD' && <label className="mt-6 block text-sm font-medium">Mật khẩu 2FA Telegram<input required autoFocus type="password" name="password" value={form.password} onChange={change} className="mt-1 w-full rounded-xl border p-3" /></label>}
    {error && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<button disabled={busy} className="mt-6 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Đang xử lý…' : step === 'PHONE' ? 'Gửi mã xác minh' : 'Xác nhận'}</button></form></div>;
}
