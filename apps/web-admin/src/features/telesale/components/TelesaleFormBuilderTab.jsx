import { useState } from 'react';
import {
  Plus,
  Pencil,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  Calculator,
  Percent,
  Coins,
  Hash,
  FileText,
  Sparkles,
  Save,
  Check,
  Award,
  Trash2,
  RotateCcw,
  X
} from 'lucide-react';
import { ORIGINAL_DEFAULT_FIELDS } from '../constants/telesaleDefaults.js';

export default function TelesaleFormBuilderTab({
  config,
  onSaveConfig,
  loading = false,
  showToast
}) {
  const [fields, setFields] = useState(() => {
    if (config?.fields && Array.isArray(config.fields) && config.fields.length > 0) {
      return config.fields;
    }
    return ORIGINAL_DEFAULT_FIELDS;
  });
  const [editingField, setEditingField] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Mở modal tạo mới
  const handleAddNew = () => {
    setEditingField({
      key: '',
      label: '',
      type: 'number',
      category: 'INPUT',
      formula: '',
      default: 0,
      required: false,
      is_monthly_cumulative: false,
      is_hidden: false,
      order_index: fields.length + 1,
      thresholds: []
    });
    setIsModalOpen(true);
  };

  // Mở modal chỉnh sửa
  const handleEdit = (field) => {
    setEditingField(JSON.parse(JSON.stringify(field)));
    setIsModalOpen(true);
  };

  // Lưu trường từ Modal
  const handleSaveModalField = (savedField) => {
    if (!savedField.label.trim()) {
      showToast('❌ Vui lòng nhập tên trường');
      return;
    }

    // Tự sinh key nếu chưa có
    let key = savedField.key.trim();
    if (!key) {
      key = savedField.label
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    }
    savedField.key = key;

    const existingIndex = fields.findIndex(f => f.key === key);
    let newFields = [...fields];

    if (existingIndex >= 0 && (!editingField?.originalKey || editingField.originalKey === key)) {
      newFields[existingIndex] = savedField;
    } else {
      // Thêm mới
      newFields.push(savedField);
    }

    // Đánh lại order_index
    newFields = newFields.map((f, idx) => ({ ...f, order_index: idx + 1 }));
    setFields(newFields);
    setHasChanges(true);
    setIsModalOpen(false);
    setEditingField(null);
    showToast(`✅ Đã cập nhật trường "${savedField.label}"`);
  };

  // Ẩn / Hiện trường
  const handleToggleHide = (key) => {
    const newFields = fields.map(f => {
      if (f.key === key) {
        return { ...f, is_hidden: !f.is_hidden };
      }
      return f;
    });
    setFields(newFields);
    setHasChanges(true);
  };

  // Di chuyển thứ tự
  const handleMove = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= fields.length) return;

    const newFields = [...fields];
    const temp = newFields[index];
    newFields[index] = newFields[targetIndex];
    newFields[targetIndex] = temp;

    const reordered = newFields.map((f, idx) => ({ ...f, order_index: idx + 1 }));
    setFields(reordered);
    setHasChanges(true);
  };

  // Nạp lại toàn bộ 14 trường và công thức form cũ chuẩn
  const handleResetToDefault = () => {
    if (window.confirm('Bạn có chắc muốn nạp toàn bộ danh sách 14 trường và công thức của form mẫu cũ chuẩn vào nhóm này?')) {
      setFields(JSON.parse(JSON.stringify(ORIGINAL_DEFAULT_FIELDS)));
      setHasChanges(true);
      showToast('✅ Đã nạp mẫu form cũ chuẩn (nhấn "Lưu cấu hình Form" để áp dụng)');
    }
  };

  // Lưu toàn bộ cấu hình lên máy chủ
  const handleSaveAll = async () => {
    await onSaveConfig({ fields });
    setHasChanges(false);
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'currency': return <Coins className="h-4 w-4 text-emerald-600" />;
      case 'percentage': return <Percent className="h-4 w-4 text-purple-600" />;
      case 'number': return <Hash className="h-4 w-4 text-blue-600" />;
      default: return <FileText className="h-4 w-4 text-slate-600" />;
    }
  };

  const getTypeName = (type) => {
    switch (type) {
      case 'currency': return 'Tiền tệ (VNĐ)';
      case 'percentage': return 'Tỷ lệ (%)';
      case 'number': return 'Số nguyên';
      default: return 'Văn bản';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Calculator className="h-5 w-5 text-blue-600" />
            Cấu hình Danh sách Trường Báo Cáo
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tùy biến các ô nhân viên điền, các ô bot tự tính, mốc khen thưởng % và tích chọn lũy kế tháng.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleResetToDefault}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:scale-95 transition"
            title="Nạp lại toàn bộ 14 trường và công thức chuẩn của form cũ"
          >
            <RotateCcw className="h-4 w-4 text-slate-500" />
            <span>Nạp form cũ chuẩn</span>
          </button>

          <button
            type="button"
            onClick={handleAddNew}
            className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-700 shadow-2xs hover:bg-blue-100 active:scale-95 transition"
          >
            <Plus className="h-4 w-4" />
            <span>Thêm trường mới</span>
          </button>

          <button
            type="button"
            onClick={handleSaveAll}
            disabled={loading || !hasChanges}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 active:scale-95 transition disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            <span>{loading ? 'Đang lưu...' : 'Lưu cấu hình Form'}</span>
          </button>
        </div>
      </div>

      {hasChanges && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-center justify-between">
          <span>⚠️ Bạn có thay đổi chưa lưu. Hãy nhấn <b>"Lưu cấu hình Form"</b> để lưu vào hệ thống.</span>
          <button
            type="button"
            onClick={handleSaveAll}
            className="px-2.5 py-1 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 text-xs"
          >
            Lưu ngay
          </button>
        </div>
      )}

      {/* Fields List Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="py-3.5 pl-4 pr-2 text-center w-12">STT</th>
                <th className="py-3.5 px-3">Tên hiển thị &amp; Mã</th>
                <th className="py-3.5 px-3">Kiểu &amp; Phân loại</th>
                <th className="py-3.5 px-3">Công thức / Giá trị</th>
                <th className="py-3.5 px-3 text-center">Lũy kế tháng</th>
                <th className="py-3.5 px-3 text-center">Trạng thái</th>
                <th className="py-3.5 pr-4 pl-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {fields.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-slate-500">
                    <p className="mb-3 text-sm">Chưa có trường nào được cấu hình cho nhóm này.</p>
                    <button
                      type="button"
                      onClick={handleResetToDefault}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-50 border border-blue-200 px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 transition shadow-2xs"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span>Nạp ngay 14 trường &amp; công thức của Form cũ chuẩn</span>
                    </button>
                  </td>
                </tr>
              ) : (
                fields.map((field, idx) => (
                  <tr
                    key={field.key || idx}
                    className={`hover:bg-slate-50/80 transition ${field.is_hidden ? 'opacity-50 bg-slate-50/50' : ''}`}
                  >
                    {/* STT */}
                    <td className="py-3 pl-4 pr-2 text-center font-bold text-slate-500">
                      {idx + 1}
                    </td>

                    {/* Tên & Mã */}
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{field.label}</div>
                      <div className="text-[11px] font-mono text-slate-400">{field.key}</div>
                    </td>

                    {/* Kiểu & Phân loại */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5 font-medium text-slate-700">
                        {getTypeIcon(field.type)}
                        <span>{getTypeName(field.type)}</span>
                      </div>
                      <div className="mt-0.5">
                        {field.category === 'CALCULATED' ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 border border-purple-200">
                            <Sparkles className="h-3 w-3" /> Bot tự tính
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                            ✍️ Điền tay
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Công thức & Khen thưởng */}
                    <td className="py-3 px-3 max-w-xs">
                      {field.category === 'CALCULATED' ? (
                        <div>
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-mono text-blue-700 border border-slate-200">
                            = {field.formula || '(Chưa đặt)'}
                          </code>
                          {field.thresholds && field.thresholds.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {field.thresholds.map((th, tIdx) => (
                                <span
                                  key={tIdx}
                                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border ${
                                    th.type === 'reward'
                                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                                      : 'bg-rose-50 text-rose-800 border-rose-200'
                                  }`}
                                >
                                  {th.badge || `${th.operator} ${th.value}`}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">Mặc định: {field.default ?? 0}</span>
                      )}
                    </td>

                    {/* Lũy kế tháng */}
                    <td className="py-3 px-3 text-center">
                      {field.is_monthly_cumulative ? (
                        <span className="inline-flex items-center gap-0.5 text-emerald-600 font-semibold text-xs">
                          <Check className="h-3.5 w-3.5" /> Có
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* Trạng thái */}
                    <td className="py-3 px-3 text-center">
                      {field.is_hidden ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                          <EyeOff className="h-3 w-3" /> Đang ẩn
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <Eye className="h-3 w-3" /> Hiển thị
                        </span>
                      )}
                    </td>

                    {/* Thao tác */}
                    <td className="py-3 pr-4 pl-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          title="Di chuyển lên"
                          disabled={idx === 0}
                          onClick={() => handleMove(idx, -1)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          title="Di chuyển xuống"
                          disabled={idx === fields.length - 1}
                          onClick={() => handleMove(idx, 1)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          title={field.is_hidden ? 'Hiện trường' : 'Ẩn trường'}
                          onClick={() => handleToggleHide(field.key)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          {field.is_hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>

                        <button
                          type="button"
                          title="Chỉnh sửa chi tiết"
                          onClick={() => handleEdit(field)}
                          className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Thêm / Chỉnh Sửa Trường */}
      {isModalOpen && editingField && (
        <FieldEditorModal
          field={editingField}
          availableFields={fields.filter(f => f.key !== editingField.key)}
          onClose={() => {
            setIsModalOpen(false);
            setEditingField(null);
          }}
          onSave={handleSaveModalField}
        />
      )}
    </div>
  );
}

/**
 * Modal soạn thảo chi tiết trường (Tên, Loại, Công thức, Ngưỡng khen thưởng)
 */
function FieldEditorModal({ field, availableFields, onClose, onSave }) {
  const [formData, setFormData] = useState({ ...field });
  const [newThreshold, setNewThreshold] = useState({
    operator: '>=',
    value: 19,
    badge: '🌟 Khen thưởng (>= 19%)',
    type: 'reward'
  });

  const handleAddThreshold = () => {
    const list = formData.thresholds ? [...formData.thresholds] : [];
    list.push({ ...newThreshold });
    setFormData({ ...formData, thresholds: list });
  };

  const handleRemoveThreshold = (tIdx) => {
    const list = formData.thresholds.filter((_, idx) => idx !== tIdx);
    setFormData({ ...formData, thresholds: list });
  };

  const insertVariable = (varKey) => {
    const current = formData.formula || '';
    setFormData({ ...formData, formula: `${current}{${varKey}}` });
  };

  const insertOperator = (op) => {
    const current = formData.formula || '';
    setFormData({ ...formData, formula: `${current} ${op} ` });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900">
            {field.key ? `Sửa trường: ${field.label}` : 'Thêm trường mới'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          {/* Tên trường & Mã key */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Tên trường <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                placeholder="VD: Doanh số hôm nay"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Mã định danh (Key)
              </label>
              <input
                type="text"
                value={formData.key}
                onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                placeholder="Tự sinh nếu để trống"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono text-slate-600 focus:border-blue-500 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Kiểu dữ liệu & Phân loại */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Kiểu dữ liệu</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-hidden bg-white"
              >
                <option value="number">Số nguyên (VD: 10)</option>
                <option value="currency">Tiền tệ VNĐ (VD: 15.000.000 đ)</option>
                <option value="percentage">Phần trăm (VD: 25.5%)</option>
                <option value="text">Văn bản / Ghi chú</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Phân loại nhập liệu</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-hidden bg-white"
              >
                <option value="INPUT">✍️ Nhân viên tự điền</option>
                <option value="CALCULATED">🤖 Bot/Hệ thống tự tính</option>
              </select>
            </div>
          </div>

          {/* Cấu hình công thức (nếu là CALCULATED) */}
          {formData.category === 'CALCULATED' && (
            <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-3 space-y-2">
              <label className="block font-semibold text-purple-950">
                Công thức tính toán (=)
              </label>
              <input
                type="text"
                value={formData.formula || ''}
                onChange={(e) => setFormData({ ...formData, formula: e.target.value })}
                placeholder="VD: ({tong_lich} / {so_nhan}) * 100"
                className="w-full rounded-lg border border-purple-300 bg-white px-3 py-2 text-xs font-mono text-purple-900 focus:border-purple-600 focus:outline-hidden"
              />
              <p className="text-[11px] text-purple-700">
                💡 Lưu ý an toàn: Nếu mẫu số &lt;= 0 thì kết quả tự động trả về 0%.
              </p>

              {/* Chèn biến nhanh */}
              <div>
                <span className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Nhấn để chèn biến vào công thức:
                </span>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {availableFields.map(af => (
                    <button
                      key={af.key}
                      type="button"
                      onClick={() => insertVariable(af.key)}
                      className="rounded bg-white border border-slate-200 px-2 py-0.5 text-[10px] text-slate-700 hover:bg-slate-100"
                    >
                      +{af.label}
                    </button>
                  ))}
                  {['+', '-', '*', '/', '(', ')'].map(op => (
                    <button
                      key={op}
                      type="button"
                      onClick={() => insertOperator(op)}
                      className="rounded bg-purple-100 font-bold text-purple-800 px-2 py-0.5 text-[10px] hover:bg-purple-200"
                    >
                      {op}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Ngưỡng khen thưởng / Cảnh báo */}
          {formData.category === 'CALCULATED' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Award className="h-4 w-4 text-amber-600" />
                  Mốc Khen thưởng / Cảnh báo (Thresholds)
                </span>
              </div>

              {/* Danh sách mốc hiện tại */}
              {formData.thresholds && formData.thresholds.length > 0 ? (
                <div className="space-y-1.5">
                  {formData.thresholds.map((th, tIdx) => (
                    <div
                      key={tIdx}
                      className="flex items-center justify-between rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-[11px]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-700">
                          {th.operator} {th.value}
                        </span>
                        <span className="text-slate-500">➔</span>
                        <span className="font-semibold text-slate-800">{th.badge}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveThreshold(tIdx)}
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 italic">Chưa đặt mốc nào.</p>
              )}

              {/* Thêm mốc mới */}
              <div className="pt-2 border-t border-slate-200 grid grid-cols-12 gap-1.5 items-end">
                <div className="col-span-3">
                  <label className="text-[10px] text-slate-500 block mb-0.5">Toán tử</label>
                  <select
                    value={newThreshold.operator}
                    onChange={(e) => setNewThreshold({ ...newThreshold, operator: e.target.value })}
                    className="w-full rounded border border-slate-200 p-1 text-[11px] bg-white"
                  >
                    <option value=">=">&gt;=</option>
                    <option value=">">&gt;</option>
                    <option value="<=">&lt;=</option>
                    <option value="<">&lt;</option>
                  </select>
                </div>

                <div className="col-span-3">
                  <label className="text-[10px] text-slate-500 block mb-0.5">Giá trị</label>
                  <input
                    type="number"
                    value={newThreshold.value}
                    onChange={(e) => setNewThreshold({ ...newThreshold, value: Number(e.target.value) })}
                    className="w-full rounded border border-slate-200 p-1 text-[11px]"
                  />
                </div>

                <div className="col-span-4">
                  <label className="text-[10px] text-slate-500 block mb-0.5">Nhãn hiển thị</label>
                  <input
                    type="text"
                    value={newThreshold.badge}
                    onChange={(e) => setNewThreshold({ ...newThreshold, badge: e.target.value })}
                    placeholder="🌟 Khen thưởng..."
                    className="w-full rounded border border-slate-200 p-1 text-[11px]"
                  />
                </div>

                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={handleAddThreshold}
                    className="w-full rounded bg-blue-600 text-white p-1 text-[11px] font-semibold hover:bg-blue-700"
                  >
                    + Thêm
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Checkboxes */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(formData.is_monthly_cumulative)}
                onChange={(e) => setFormData({ ...formData, is_monthly_cumulative: e.target.checked })}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="font-medium text-slate-700">
                Tính lũy kế cộng dồn cả tháng (tự động cộng dồn từ ngày 1 đầu tháng)
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(formData.is_hidden)}
                onChange={(e) => setFormData({ ...formData, is_hidden: e.target.checked })}
                className="rounded border-slate-300 text-slate-600 focus:ring-slate-500"
              />
              <span className="font-medium text-slate-700">
                Ẩn trường này (không hiển thị trên Mini App, bảo toàn dữ liệu cũ)
              </span>
            </label>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={() => onSave(formData)}
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            Cập nhật trường
          </button>
        </div>
      </div>
    </div>
  );
}
