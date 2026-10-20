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
  Award,
  Trash2,
  RotateCcw,
  X,
  ChevronDown,
  FolderTree,
  Tag,
  Layers
} from 'lucide-react';
import {
  ORIGINAL_DEFAULT_FIELDS,
  DEFAULT_ADS_FIELDS,
  DEFAULT_FEATURES
} from '../constants/telesaleDefaults.js';

export default function TelesaleFormBuilderTab({
  config,
  onSaveConfig,
  loading = false,
  showToast,
  groupName,
  groupId,
  groups,
  onSelectGroup
}) {
  const [fields, setFields] = useState(() => {
    if (config?.fields && Array.isArray(config.fields) && config.fields.length > 0) {
      return config.fields;
    }
    return ORIGINAL_DEFAULT_FIELDS;
  });

  const [features, setFeatures] = useState(() => ({
    ...DEFAULT_FEATURES,
    ...(config?.features || {})
  }));

  const [projects, setProjects] = useState(() => {
    return Array.isArray(config?.projects) ? config.projects : [];
  });

  const [services, setServices] = useState(() => {
    return Array.isArray(config?.services) ? config.services : [];
  });

  const [newProjectInput, setNewProjectInput] = useState('');
  const [newServiceInput, setNewServiceInput] = useState('');

  const [editingField, setEditingField] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Thao tác tính năng phân cấp (Dự án, Dịch vụ, Template, Lũy kế)
  const handleFeatureToggle = (key) => {
    setFeatures(prev => ({ ...prev, [key]: !prev[key] }));
    setHasChanges(true);
  };

  const handleFeatureChange = (key, val) => {
    setFeatures(prev => ({ ...prev, [key]: val }));
    setHasChanges(true);
  };

  const handleAddProject = () => {
    const val = newProjectInput.trim();
    if (!val) return;
    if (projects.includes(val)) {
      showToast?.('⚠️ Tên dự án này đã tồn tại');
      return;
    }
    setProjects(prev => [...prev, val]);
    setNewProjectInput('');
    setHasChanges(true);
  };

  const handleRemoveProject = (index) => {
    setProjects(prev => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleAddService = () => {
    const val = newServiceInput.trim();
    if (!val) return;
    if (services.includes(val)) {
      showToast?.('⚠️ Tên dịch vụ này đã tồn tại');
      return;
    }
    setServices(prev => [...prev, val]);
    setNewServiceInput('');
    setHasChanges(true);
  };

  const handleRemoveService = (index) => {
    setServices(prev => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  // Nạp mẫu Báo cáo Ads theo giờ
  const handleLoadAdsTemplate = () => {
    if (window.confirm('Hệ thống sẽ nạp mẫu "Báo Cáo Ads Theo Giờ" (9 trường chỉ số, bật phân loại Dự án & Dịch vụ, tổng hợp theo Dịch vụ, cộng dồn mốc giờ). Tiếp tục?')) {
      setFields(JSON.parse(JSON.stringify(DEFAULT_ADS_FIELDS)));
      setFeatures({
        has_projects: true,
        has_services: true,
        schedule_mode: 'MULTI_SLOT',
        summary_template: 'BY_SERVICE',
        cumulative_mode: 'HOURLY'
      });
      // Không gán cứng dự án mẫu, để trống để người dùng / admin tự do nhập hoặc tự động bổ sung
      if (!projects || projects.length === 0) {
        setProjects([]);
      }
      if (services.length === 0) {
        setServices(['Nâng ngực', 'Hút mỡ', 'Nâng mũi']);
      }
      setHasChanges(true);
      showToast?.('⚡ Đã nạp mẫu Báo Cáo Ads Theo Giờ! (Nhấn "Lưu cấu hình Form" để áp dụng)');
    }
  };

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
      is_hourly_cumulative: false,
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
      showToast?.('❌ Vui lòng nhập tên trường');
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
    showToast?.(`✅ Đã cập nhật trường "${savedField.label}"`);
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
      showToast?.('✅ Đã nạp mẫu form cũ chuẩn (nhấn "Lưu cấu hình Form" để áp dụng)');
    }
  };

  // Lưu toàn bộ cấu hình lên máy chủ
  const handleSaveAll = async () => {
    await onSaveConfig({
      fields,
      features,
      projects,
      services
    });
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
      {/* Group Context Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50/90 via-sky-50/50 to-white p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-2xs font-bold text-sm">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-700">Đang cấu hình Form riêng cho nhóm:</span>
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
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-blue-100 shadow-2xs">
            <span className="text-slate-600 text-xs font-semibold whitespace-nowrap">Chuyển sang nhóm khác:</span>
            <div className="relative">
              <select
                value={groupId || ''}
                onChange={(e) => onSelectGroup(e.target.value)}
                className="appearance-none rounded-lg border border-slate-300 bg-slate-50 py-1.5 pl-2.5 pr-7 text-xs font-bold text-blue-950 outline-none hover:border-blue-500 cursor-pointer"
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

      {/* Top Header Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Calculator className="h-5 w-5 text-blue-600" />
            Cấu hình Danh sách Trường Báo Cáo {groupName ? `— ${groupName}` : ''}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tùy biến các ô nhân viên điền, các ô bot tự tính, mốc khen thưởng % và tích chọn lũy kế tháng cho nhóm <b>{groupName || groupId || 'hiện tại'}</b>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleResetToDefault}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:scale-95 transition"
            title="Nạp lại toàn bộ 14 trường và công thức chuẩn của form cũ"
          >
            <RotateCcw className="h-4 w-4 text-slate-500" />
            <span>Nạp form cũ chuẩn</span>
          </button>

          <button
            type="button"
            onClick={handleLoadAdsTemplate}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3.5 py-2 text-xs font-semibold text-indigo-700 shadow-2xs hover:bg-indigo-100 active:scale-95 transition"
            title="Nạp mẫu Báo cáo Ads theo giờ (gồm 9 chỉ số, phân loại theo Dự án & Dịch vụ, tổng hợp theo dịch vụ)"
          >
            <Sparkles className="h-4 w-4 text-indigo-600" />
            <span>Nạp mẫu Báo cáo Ads</span>
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

      {/* KHỐI CÀI ĐẶT DỰ ÁN & DỊCH VỤ (PHÂN LOẠI NÂNG CAO) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <FolderTree className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Phân Loại Theo Dự Án &amp; Dịch Vụ (Dynamic Dimensions)
              </h3>
              <p className="text-[11px] text-slate-500">
                Cho phép nhân sự nộp báo cáo chi tiết theo từng Dự án / Dịch vụ và bot tự động tổng hợp số liệu theo mẫu.
              </p>
            </div>
          </div>
        </div>

        {/* 2 Cột bật/tắt Dự án & Dịch vụ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Cột 1: Phân loại theo Dự án */}
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-blue-600" />
                  Phân loại theo Dự án
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Bật nếu nhóm này cần theo dõi số liệu riêng theo từng dự án.
                </p>
              </div>
              <input
                type="checkbox"
                checked={Boolean(features.has_projects)}
                onChange={() => handleFeatureToggle('has_projects')}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
            </div>

            {features.has_projects && (
              <div className="pt-2 border-t border-slate-200/60 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newProjectInput}
                    onChange={(e) => setNewProjectInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddProject())}
                    placeholder="Nhập tên dự án mới..."
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddProject}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 active:scale-95 transition"
                  >
                    Thêm
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 min-h-7">
                  {projects.length > 0 ? (
                    projects.map((p, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50/70 px-2.5 py-1 text-xs font-medium text-blue-800"
                      >
                        <span>{p}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveProject(idx)}
                          className="text-blue-400 hover:text-rose-600 ml-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-slate-400 italic">Chưa có danh sách dự án. Người dùng có thể tự thêm khi nộp báo cáo hoặc bạn có thể nhập tên và nhấn "Thêm" tại đây.</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Cột 2: Phân loại theo Dịch vụ */}
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-purple-600" />
                  Phân loại theo Dịch vụ
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Bật nếu nhóm cần bóc tách các dịch vụ (VD: Nâng ngực, Hút mỡ,...).
                </p>
              </div>
              <input
                type="checkbox"
                checked={Boolean(features.has_services)}
                onChange={() => handleFeatureToggle('has_services')}
                className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
              />
            </div>

            {features.has_services && (
              <div className="pt-2 border-t border-slate-200/60 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newServiceInput}
                    onChange={(e) => setNewServiceInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddService())}
                    placeholder="Nhập tên dịch vụ (VD: Nâng ngực)..."
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-purple-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddService}
                    className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 active:scale-95 transition"
                  >
                    Thêm
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 min-h-7">
                  {services.length > 0 ? (
                    services.map((s, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50/70 px-2.5 py-1 text-xs font-medium text-purple-800"
                      >
                        <span>{s}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveService(idx)}
                          className="text-purple-400 hover:text-rose-600 ml-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-slate-400 italic">Chưa có danh sách dịch vụ. Hãy nhập tên và nhấn "Thêm".</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 2 Lựa chọn nâng cao: Mẫu Bot tổng hợp & Cơ chế lũy kế */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-indigo-600" />
              Mẫu Báo Cáo Tổng Hợp của Bot Telegram:
            </label>
            <select
              value={features.summary_template || 'BY_EMPLOYEE'}
              onChange={(e) => handleFeatureChange('summary_template', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-indigo-500"
            >
              <option value="BY_EMPLOYEE">Tổng hợp theo từng Nhân Sự (Mặc định cho Telesale)</option>
              <option value="BY_SERVICE">Tổng hợp cộng dồn tất cả dự án THEO DỊCH VỤ (Báo Cáo Ads)</option>
            </select>
            <p className="text-[10px] text-slate-500">
              {features.summary_template === 'BY_SERVICE'
                ? 'Bot sẽ tự động gom nhóm tổng kết cộng dồn các chỉ số chi tiêu, mess, số, doanh số theo từng dịch vụ.'
                : 'Bot sẽ liệt kê báo cáo và thành tích theo danh sách từng nhân viên trong nhóm.'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Calculator className="h-3.5 w-3.5 text-emerald-600" />
              Cơ chế Tính Lũy Kế (Cumulative Mode):
            </label>
            <select
              value={features.cumulative_mode || 'MONTHLY'}
              onChange={(e) => handleFeatureChange('cumulative_mode', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-emerald-500"
            >
              <option value="MONTHLY">Lũy kế theo Tháng (Mặc định Telesale: DS tháng, Khách tới tháng)</option>
              <option value="HOURLY">Lũy kế theo Mốc Giờ trong ngày (09h -&gt; 12h -&gt; 18h cho Báo Cáo Ads)</option>
              <option value="BOTH">Hỗ trợ cả hai (Cả theo Tháng và theo Mốc Giờ)</option>
            </select>
            <p className="text-[10px] text-slate-500">
              Xác định cách các trường tính toán lũy kế cộng dồn số liệu từ các báo cáo trước đó.
            </p>
          </div>
        </div>
      </div>

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
                <th className="py-3.5 px-3 text-center">Lũy kế</th>
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

                    {/* Lũy kế */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        {field.is_monthly_cumulative && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold border border-emerald-200">
                            Tháng
                          </span>
                        )}
                        {field.is_hourly_cumulative && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5 text-[10px] font-semibold border border-indigo-200">
                            Mốc giờ
                          </span>
                        )}
                        {!field.is_monthly_cumulative && !field.is_hourly_cumulative && (
                          <span className="text-slate-300">—</span>
                        )}
                      </div>
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
                checked={Boolean(formData.is_hourly_cumulative)}
                onChange={(e) => setFormData({ ...formData, is_hourly_cumulative: e.target.checked })}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="font-medium text-slate-700">
                Tính lũy kế cộng dồn qua các mốc giờ trong ngày (09h -&gt; 12h -&gt; 18h)
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
