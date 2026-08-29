import { Save, X } from 'lucide-react';

const LABELS = {
  APPROVE_EXPORT: 'Duyệt đơn xuất kho',
  AUTO_APPROVE_OWN_ORDER: 'Tự động duyệt đơn do chính mình tạo',
  APPROVE_TRANSFER: 'Duyệt điều chuyển hàng',
  MANAGE_TEMPLATES: 'Quản lý mẫu dịch vụ',
  MANAGE_PRODUCTS: 'Quản lý danh mục sản phẩm',
  ADJUST_INVENTORY: 'Điều chỉnh tồn kho',
  VIEW_REPORTS: 'Xem báo cáo kho',
  MANAGE_PRICING: 'Nhập đơn giá sản phẩm',
  VIEW_PRICING: 'Xem đơn giá và tổng giá'
};

export default function WarehousePermissionModal({ groupName, codes, granted, saving, onToggle, onClose, onSave }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl sm:p-5">
        <div className="flex justify-between gap-3">
          <div><h3 className="font-bold text-slate-900">Quyền kho theo nhóm</h3><p className="mt-1 text-xs text-slate-500">{groupName}</p></div>
          <button onClick={onClose}><X className="h-5 w-5 text-slate-400" /></button>
        </div>
        <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
          {codes.map(code => <label key={code} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"><input type="checkbox" checked={granted.has(code)} onChange={() => onToggle(code)} className="accent-blue-600" />{LABELS[code] || code}</label>)}
        </div>
        <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold">Hủy</button><button onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Đang lưu…' : 'Lưu quyền'}</button></div>
      </div>
    </div>
  );
}
