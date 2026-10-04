import { useState } from 'react';
import { Target, X, Check, RotateCcw } from 'lucide-react';

export default function KpiSettingModal({ employee, defaultKpi = 15, onSave, onClose }) {
  const [targetKpi, setTargetKpi] = useState(employee?.targetKpi || defaultKpi);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!employee) return null;

  const handleSave = async (customValue) => {
    const val = customValue !== undefined ? customValue : targetKpi;
    const num = parseInt(val, 10);

    if (num !== null && (isNaN(num) || num <= 0)) {
      setError('Chỉ tiêu KPI phải là số nguyên dương (> 0).');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(employee.employeeId, num);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Không thể lưu chỉ tiêu.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefault = () => {
    handleSave(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl transition"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shrink-0">
              <Target className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">Cài đặt KPI cá nhân</h3>
              <p className="text-xs text-slate-500 truncate max-w-[200px] sm:max-w-none">{employee.employeeName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 active:bg-slate-200"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Chỉ tiêu điểm bán / ngày:
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="100"
                value={targetKpi}
                onChange={e => setTargetKpi(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-base font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Nhập số điểm (VD: 15)"
              />
              <span className="text-xs sm:text-sm font-semibold text-slate-500 shrink-0">điểm/ngày</span>
            </div>
            <p className="mt-1.5 text-[11px] sm:text-xs text-slate-400">
              Mặc định của nhóm: <strong className="text-slate-600">{defaultKpi} điểm</strong>.
            </p>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-500 block mb-2">Chọn nhanh mốc KPI:</span>
            <div className="grid grid-cols-4 gap-2">
              {[10, 15, 20, 25].map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setTargetKpi(val)}
                  className={`rounded-xl py-2.5 text-xs font-bold transition border active:scale-95 ${
                    Number(targetKpi) === val
                      ? 'border-blue-600 bg-blue-50 text-blue-600 shadow-2xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {val} điểm
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 p-3 text-xs font-medium text-rose-600 border border-rose-100">
              ⚠️ {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 p-3.5 sm:p-4">
          {employee.hasCustomKpi ? (
            <button
              type="button"
              disabled={saving}
              onClick={handleResetDefault}
              className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Về mặc định ({defaultKpi})</span>
              <span className="sm:hidden">Mặc định</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 active:bg-slate-200"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave()}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 active:scale-[0.98] transition disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {saving ? 'Đang lưu…' : 'Lưu chỉ tiêu'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
