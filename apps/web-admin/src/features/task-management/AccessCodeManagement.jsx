import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { KeyRound, X, Ban, Copy, RefreshCw } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const ROLES = ['MANAGER', 'OWNER', 'TEAM_LEAD'];
const ROLE_LABELS = { MANAGER: 'Quản lý (MANAGER)', OWNER: 'Chủ hệ thống (OWNER)', TEAM_LEAD: 'Trưởng nhóm (TEAM_LEAD)' };

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function displayScope(scope) {
  if (!Array.isArray(scope) || scope.length === 0) return 'Tất cả các nhóm';
  return scope.map(item => (item.type === 'TELEGRAM_GROUP' ? `Nhóm ${item.value}` : `NV ${item.value}`)).join(', ');
}

function codeStatus(code) {
  if (code.status === 'REDEEMED') return { label: 'Đã kích hoạt', tone: 'border-emerald-200 bg-emerald-50 text-emerald-600' };
  if (code.status === 'CANCELLED') return { label: 'Đã thu hồi', tone: 'border-slate-200 bg-slate-100 text-slate-500' };
  if (new Date(code.expires_at).getTime() <= Date.now()) return { label: 'Hết hạn', tone: 'border-slate-200 bg-slate-50 text-slate-500' };
  return { label: 'Chờ kích hoạt', tone: 'border-blue-200 bg-blue-50 text-blue-600' };
}

export default function AccessCodeManagement() {
  const [codes, setCodes] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ role: 'MANAGER', bindTelegramUserId: '', expiresInHours: '' });
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState('');

  const notify = useCallback(message => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/admin/task-management/access-codes`);
      setCodes(response.data?.codes || []);
      setManagers(response.data?.managers || []);
    } catch (error) {
      notify(error.response?.data?.error || 'Không tải được danh sách mã kích hoạt.');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm({ role: 'MANAGER', bindTelegramUserId: '', expiresInHours: '' });
    setCreating(true);
  };

  const submitCreate = async event => {
    event.preventDefault();
    try {
      const response = await axios.post(`${API_URL}/admin/task-management/access-codes`, {
        role: form.role,
        bindTelegramUserId: form.bindTelegramUserId.trim() || null,
        expiresInHours: form.expiresInHours === '' ? null : Number(form.expiresInHours)
      });
      setCreating(false);
      setCopied(false);
      setCreated(response.data);
      await load();
    } catch (error) {
      notify(error.response?.data?.error || 'Không tạo được mã kích hoạt.');
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(created.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notify('Không copy được — hãy chọn và sao chép thủ công.');
    }
  };

  const cancelCode = async code => {
    if (!window.confirm(`Thu hồi mã ${ROLE_LABELS[code.role] || code.role} chưa dùng này?`)) return;
    try {
      await axios.post(`${API_URL}/admin/task-management/access-codes/${code.id}/cancel`);
      notify('Đã thu hồi mã.');
      await load();
    } catch (error) {
      notify(error.response?.data?.error || 'Không thu hồi được mã.');
    }
  };

  const revokeManager = async manager => {
    const name = manager.full_name || manager.telegram_user_id;
    if (!window.confirm(`Thu hồi quyền quản lý của "${name}"? Người này sẽ không dùng được các lệnh quản lý.`)) return;
    try {
      await axios.post(`${API_URL}/admin/task-management/managers/revoke`, { telegramUserId: manager.telegram_user_id });
      notify('Đã thu hồi quyền quản lý.');
      await load();
    } catch (error) {
      notify(error.response?.data?.error || 'Không thu hồi được quyền quản lý.');
    }
  };

  return <div className="space-y-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Mã kích hoạt giao việc</h2>
        <p className="mt-1 text-sm text-slate-500">Cấp mã để quản lý kích hoạt quyền trên bot. Mã dùng một lần, phạm vi tất cả các nhóm.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" />Làm mới</button>
        <button onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200"><KeyRound className="h-4 w-4" />Tạo mã mới</button>
      </div>
    </header>

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5"><h3 className="font-bold text-slate-900">Danh sách mã</h3></div>
      {loading ? <div className="p-12 text-center text-sm text-slate-500">Đang tải…</div> : codes.length === 0 ? <div className="p-12 text-center text-sm text-slate-500">Chưa có mã nào. Bấm "Tạo mã mới" để cấp cho quản lý.</div> : (
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-5 py-4">Vai trò</th><th className="px-5 py-4">Phạm vi</th><th className="px-5 py-4">Trạng thái</th><th className="px-5 py-4">Hết hạn</th><th className="px-5 py-4">Ràng buộc ID</th><th className="px-5 py-4">Người tạo</th><th className="px-5 py-4">Kích hoạt</th><th className="px-5 py-4 text-right">Thao tác</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {codes.map(code => { const status = codeStatus(code); return <tr key={code.id}>
              <td className="px-5 py-4 font-semibold text-slate-900">{ROLE_LABELS[code.role] || code.role}</td>
              <td className="px-5 py-4 text-slate-600">{displayScope(code.scope)}</td>
              <td className="px-5 py-4"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span></td>
              <td className="px-5 py-4 text-slate-600">{formatDateTime(code.expires_at)}</td>
              <td className="px-5 py-4 text-slate-600">{code.bound_telegram_user_id || '—'}</td>
              <td className="px-5 py-4 text-xs text-slate-500">{code.created_by}<br />{formatDateTime(code.created_at)}</td>
              <td className="px-5 py-4 text-xs text-slate-500">{code.redeemed_by_telegram_user_id ? `${code.redeemed_by_telegram_user_id}${code.redeemed_at ? ` · ${formatDateTime(code.redeemed_at)}` : ''}` : '—'}</td>
              <td className="px-5 py-4"><div className="flex justify-end">
                {code.status === 'ACTIVE' && new Date(code.expires_at).getTime() > Date.now() && (
                  <button onClick={() => cancelCode(code)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600"><Ban className="h-4 w-4" />Thu hồi</button>
                )}
              </div></td>
            </tr>; })}
          </tbody>
        </table></div>
      )}
    </section>

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5"><h3 className="font-bold text-slate-900">Quản lý đã kích hoạt</h3></div>
      {loading ? <div className="p-12 text-center text-sm text-slate-500">Đang tải…</div> : managers.length === 0 ? <div className="p-12 text-center text-sm text-slate-500">Chưa có ai kích hoạt quyền quản lý.</div> : (
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-5 py-4">Người</th><th className="px-5 py-4">Telegram ID</th><th className="px-5 py-4">Vai trò</th><th className="px-5 py-4">Trạng thái</th><th className="px-5 py-4">Kích hoạt lúc</th><th className="px-5 py-4 text-right">Thao tác</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {managers.map(manager => <tr key={manager.id}>
              <td className="px-5 py-4 font-semibold text-slate-900">{manager.full_name || '—'}{manager.employee_code && <span className="ml-2 text-xs font-normal text-slate-500">{manager.employee_code}</span>}</td>
              <td className="px-5 py-4 text-slate-600">{manager.telegram_user_id}</td>
              <td className="px-5 py-4 text-slate-600">{ROLE_LABELS[manager.role] || manager.role}</td>
              <td className="px-5 py-4"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${manager.status === 'ACTIVE' ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>{manager.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã thu hồi'}</span></td>
              <td className="px-5 py-4 text-slate-600">{formatDateTime(manager.activated_at)}</td>
              <td className="px-5 py-4"><div className="flex justify-end">
                {manager.status === 'ACTIVE' && (
                  <button onClick={() => revokeManager(manager)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600"><Ban className="h-4 w-4" />Thu hồi quyền</button>
                )}
              </div></td>
            </tr>)}
          </tbody>
        </table></div>
      )}
    </section>

    {creating && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <form onSubmit={submitCreate} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Tạo mã kích hoạt</h3><button type="button" onClick={() => setCreating(false)} className="p-2 text-slate-500"><X className="h-5 w-5" /></button></div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium">Vai trò
            <select value={form.role} onChange={event => setForm({ ...form, role: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3">
              {ROLES.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Telegram ID nhận mã (tùy chọn)
            <input inputMode="numeric" value={form.bindTelegramUserId} onChange={event => setForm({ ...form, bindTelegramUserId: event.target.value.replace(/[^0-9]/g, '') })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="Chỉ người này kích hoạt được mã" />
          </label>
          <label className="block text-sm font-medium">Thời hạn (giờ, để trống = 24 giờ)
            <input inputMode="numeric" value={form.expiresInHours} onChange={event => setForm({ ...form, expiresInHours: event.target.value.replace(/[^0-9]/g, '') })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="24" />
          </label>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            Mã cho phép quản lý <strong>tất cả các nhóm hiện có và nhóm thêm sau</strong>. Mã dùng một lần, hết hạn sau thời hạn, nhập sai quá 5 lần bị khóa. Mã gốc chỉ hiển thị đúng một lần ngay sau khi tạo.
          </div>
        </div>
        <button className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white">Tạo mã</button>
      </form>
    </div>}

    {created && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Mã đã tạo</h3><button type="button" onClick={() => setCreated(null)} className="p-2 text-slate-500"><X className="h-5 w-5" /></button></div>
        <p className="mt-3 text-sm text-slate-600">Gửi mã này cho quản lý qua kênh an toàn. Quản lý nhắn riêng cho bot: <code className="rounded bg-slate-100 px-1.5 py-0.5">/kichhoat &lt;mã&gt;</code></p>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <code className="flex-1 text-lg font-bold tracking-wide text-slate-900">{created.code}</code>
          <button onClick={copyCode} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-600"><Copy className="h-4 w-4" />{copied ? 'Đã copy' : 'Copy'}</button>
        </div>
        <p className="mt-3 text-xs text-slate-500">Vai trò: {ROLE_LABELS[created.role] || created.role} · Hết hạn: {formatDateTime(created.expiresAt)}</p>
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700">Mã gốc không lưu trên hệ thống (chỉ lưu bản mã hóa) — đóng khung này là không xem lại được.</div>
        <button onClick={() => setCreated(null)} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white">Tôi đã lưu mã</button>
      </div>
    </div>}

    {toast && <div className="fixed bottom-5 right-5 z-[60] max-w-sm rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">{toast}</div>}
  </div>;
}
