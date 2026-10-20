import axios from 'axios';
import { ArrowLeft, BadgeCheck, Building2, Check, Pencil, UserCheck, UserX, X } from 'lucide-react';
import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(-2).map(part => part[0]).join('').toUpperCase();
}

export default function EmployeeProfileHeader({ employee, onBack, onUpdated }) {
  const [loading, setLoading] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(employee.full_name || '');
  const [savingName, setSavingName] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = msg => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveName = async e => {
    e?.preventDefault?.();
    const trimmed = nameInput.trim();
    if (!trimmed) {
      showToast('⚠️ Vui lòng nhập họ và tên');
      return;
    }
    if (trimmed === employee.full_name) {
      setIsEditingName(false);
      return;
    }

    setSavingName(true);
    try {
      await axios.put(`${API_URL}/admin/tk-users/${employee.id}`, {
        full_name: trimmed,
        telegram_group_id: employee.telegram_group_id || employee.groups?.[0]?.telegram_group_id
      });
      setIsEditingName(false);
      showToast(`✅ Đã đổi tên thành "${trimmed}"`);
      if (typeof onUpdated === 'function') onUpdated();
    } catch (err) {
      showToast(`❌ Lỗi khi đổi tên: ${err.response?.data?.error || err.message}`);
    } finally {
      setSavingName(false);
    }
  };

  const toggleActive = async () => {
    const currentActive = employee.is_active !== false;
    const nextStatus = !currentActive;
    const confirmMsg = nextStatus
      ? `Kích hoạt lại nhân sự ${employee.full_name}?`
      : `Vô hiệu hóa nhân sự ${employee.full_name}?\n\nBot sẽ ngừng nhắc nhở, tạm dừng chấm công và loại trừ nhân sự này khỏi báo cáo trên toàn hệ thống.`;
    if (!window.confirm(confirmMsg)) return;

    setLoading(true);
    try {
      await axios.put(`${API_URL}/admin/tk-users/${employee.id}`, {
        is_active: nextStatus,
        telegram_group_id: employee.telegram_group_id || employee.groups?.[0]?.telegram_group_id
      });
      showToast(nextStatus ? `✅ Đã kích hoạt lại ${employee.full_name}` : `Đã vô hiệu hóa ${employee.full_name}`);
      if (typeof onUpdated === 'function') onUpdated();
    } catch (err) {
      showToast(`❌ Lỗi khi cập nhật trạng thái: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-blue-600">
        <ArrowLeft className="h-4 w-4" />Quay lại danh sách nhân sự
      </button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-lg font-bold text-white shadow-lg shadow-blue-500/20">
            {initials(employee.full_name)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {isEditingName ? (
                <form onSubmit={handleSaveName} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    autoFocus
                    placeholder="Nhập tên mới..."
                    className="rounded-xl border border-blue-400 bg-white px-3 py-1.5 text-base font-bold text-slate-900 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/20 sm:text-xl min-w-[200px]"
                  />
                  <button
                    type="submit"
                    disabled={savingName || !nameInput.trim() || nameInput.trim() === employee.full_name}
                    className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>{savingName ? 'Đang lưu…' : 'Lưu'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={savingName}
                    onClick={() => { setIsEditingName(false); setNameInput(employee.full_name); }}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Hủy</span>
                  </button>
                </form>
              ) : (
                <>
                  <h2 className="truncate text-xl font-bold text-slate-900 sm:text-2xl">{employee.full_name}</h2>
                  <button
                    type="button"
                    onClick={() => { setNameInput(employee.full_name); setIsEditingName(true); }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                    title="Đổi tên nhân sự"
                  >
                    <Pencil className="h-3 w-3" />
                    <span>Đổi tên</span>
                  </button>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${employee.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-rose-200 bg-rose-50 text-rose-600'}`}>
                    {employee.is_active ? 'Đang hoạt động' : 'Đã vô hiệu'}
                  </span>
                </>
              )}
            </div>
            <p className="mt-1 break-words text-xs text-slate-500">Telegram ID: {employee.telegram_id || 'Chưa liên kết'} · {employee.role || 'Chưa có vai trò'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {employee.groups.map(group => (
                <span key={group.telegram_group_id} className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-600">
                  <Building2 className="h-3 w-3" />{group.group_name || group.telegram_group_id}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <BadgeCheck className="h-5 w-5 text-blue-600" />
            <div><p className="font-semibold text-slate-800">{employee.employee_code || 'Chưa có mã NV'}</p><p>{employee.position || employee.department || 'Nhân viên'}</p></div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={toggleActive}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-3 text-xs font-bold transition shadow-sm disabled:opacity-50 ${
              employee.is_active
                ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:border-rose-300'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300'
            }`}
          >
            {employee.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
            {loading ? 'Đang xử lý…' : (employee.is_active ? 'Vô hiệu hóa nhân sự' : 'Kích hoạt lại')}
          </button>
        </div>
      </div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}
    </section>
  );
}
