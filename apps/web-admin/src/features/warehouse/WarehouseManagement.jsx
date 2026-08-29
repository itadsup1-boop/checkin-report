import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  ArchiveRestore,
  Boxes,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Package,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Trash2,
  X
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function suggestServiceCode(name) {
  return String(name || '')
    .replace(/[Đđ]/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <div>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
          <Icon className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-950">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

function ProductUnitsModal({ product, saving, onClose, onSave }) {
  const [baseUnit, setBaseUnit] = useState(product?.base_unit || 'chiếc');
  const [hasConversion, setHasConversion] = useState(Boolean(product?.import_unit && Number(product?.conversion_rate) > 1));
  const [importUnit, setImportUnit] = useState(product?.import_unit || 'Lọ');
  const [conversionRate, setConversionRate] = useState(product?.conversion_rate ? String(product.conversion_rate) : '2.5');
  const [quantityMode, setQuantityMode] = useState(product?.quantity_mode || 'INTEGER');
  const [syncInventory, setSyncInventory] = useState(false);

  const hasCurrentStock = (Number(product?.stock_us) || 0) > 0 || (Number(product?.stock_uk) || 0) > 0;
  const isAlreadyConfigured = product?.import_unit && Number(product?.conversion_rate) > 1;

  const handleBaseUnitChange = value => {
    setBaseUnit(value);
    if (['ml', 'cc', 'unit', 'u', 'liều', 'gam', 'g'].includes(value.toLowerCase().trim())) {
      setQuantityMode('DECIMAL');
    }
  };

  const submit = event => {
    event.preventDefault();
    onSave(product.id, {
      base_unit: baseUnit.trim() || 'chiếc',
      import_unit: hasConversion ? (importUnit.trim() || 'Lọ') : null,
      conversion_rate: hasConversion ? Number(conversionRate) || 1.0 : 1.0,
      quantity_mode: quantityMode,
      sync_inventory: syncInventory && hasConversion
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-lg overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">Cấu hình Đơn vị & Quy đổi</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-slate-800">{product?.product_name}</span>
              <span className="font-mono text-slate-500">({product?.barcode || 'Chưa có mã'})</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {/* Banner trạng thái hiện tại */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Cấu hình hiện tại trong hệ thống:</span>
            <div className="mt-1 flex flex-wrap items-center gap-2 font-medium text-slate-800">
              <span className="rounded bg-blue-100 px-2 py-0.5 font-bold text-blue-900">
                Đơn vị cơ sở: {product?.base_unit || 'chiếc'}
              </span>
              {isAlreadyConfigured ? (
                <span className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-900 border border-amber-300">
                  📦 Đang quy đổi: 1 {product.import_unit} = {product.conversion_rate} {product.base_unit || 'chiếc'}
                </span>
              ) : (
                <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-700">
                  Chưa bật quy đổi đóng gói
                </span>
              )}
              <span className="text-slate-500">· Tồn: US ({Number(product?.stock_us) || 0}) / UK ({Number(product?.stock_uk) || 0})</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-800">
              Đơn vị cơ sở (khi xuất làm dịch vụ) <span className="text-rose-500">*</span>
            </label>
            <input
              required
              value={baseUnit}
              onChange={e => handleBaseUnitChange(e.target.value)}
              placeholder="Ví dụ: chiếc, ml, unit, tuýp, cái..."
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-slate-500">
              <span className="font-medium">Gợi ý:</span>
              {['chiếc', 'ml', 'unit', 'cái', 'tuýp', 'hộp', 'bộ', 'ống', 'gói'].map(u => (
                <button
                  type="button"
                  key={u}
                  onClick={() => handleBaseUnitChange(u)}
                  className={`rounded-md px-2 py-0.5 font-medium transition ${baseUnit === u ? 'bg-blue-600 text-white font-bold' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-800">
              Kiểu số lượng khi xuất
            </label>
            <select
              value={quantityMode}
              onChange={e => setQuantityMode(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-950 outline-none focus:border-blue-500"
            >
              <option value="INTEGER">Chỉ nhập số nguyên (1, 2, 3…)</option>
              <option value="DECIMAL">Cho nhập số thập phân (1.2, 2.5…)</option>
            </select>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={hasConversion}
                onChange={e => setHasConversion(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-bold text-slate-950">Bật quy đổi đóng gói khi nhập hàng</span>
            </label>
            <p className="mt-1 text-xs text-slate-600 ml-6">
              Áp dụng cho mặt hàng nhập theo Lọ/Hộp/Chai nhưng xuất dùng theo ml/cc/unit/chiếc.
            </p>

            {hasConversion && (
              <div className="mt-4 pt-3 border-t border-blue-200 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-bold text-slate-800">
                  Đơn vị khi nhập hàng
                  <input
                    required={hasConversion}
                    value={importUnit}
                    onChange={e => setImportUnit(e.target.value)}
                    placeholder="Ví dụ: Lọ, Hộp, Chai"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block text-xs font-bold text-slate-800">
                  Quy cách (1 {importUnit || 'Lọ'} = ... {baseUnit})
                  <input
                    required={hasConversion}
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={conversionRate}
                    onChange={e => setConversionRate(e.target.value)}
                    placeholder="Ví dụ: 2.5"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-blue-500"
                  />
                </label>
                <div className="sm:col-span-2 text-xs font-medium text-blue-900 bg-white rounded-lg p-2.5 border border-blue-200 shadow-sm">
                  💡 <b>Quy đổi:</b> 1 {importUnit || 'Lọ'} = <b>{conversionRate || '2.5'}</b> {baseUnit}
                  <br />
                  <span className="text-slate-600 text-[11px]">Khi nhân viên nhập 2 {importUnit || 'Lọ'}, tồn kho sẽ tự động cộng {(2 * (Number(conversionRate) || 0)).toFixed(1)} {baseUnit}.</span>
                </div>
              </div>
            )}
          </div>

          {hasConversion && hasCurrentStock && (
            <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-slate-900 shadow-sm">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncInventory}
                  onChange={e => setSyncInventory(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-amber-500 text-amber-600 focus:ring-amber-500"
                />
                <div>
                  <span className="text-sm font-bold text-slate-950">Quy đổi lại số lượng tồn kho cũ hiện có</span>
                  <p className="mt-1 text-xs text-slate-700">
                    Tích chọn nếu số lượng cũ trong kho trước đây được nhập theo số Lọ và bạn muốn nhân hệ số để thành tổng dung tích {baseUnit}:
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded bg-white px-2.5 py-1 text-amber-950 border border-amber-300 shadow-xs">
                      US: {Number(product?.stock_us) || 0} Lọ → <b className="text-emerald-700">{((Number(product?.stock_us) || 0) * (Number(conversionRate) || 1)).toFixed(1)} {baseUnit}</b>
                    </span>
                    <span className="rounded bg-white px-2.5 py-1 text-amber-950 border border-amber-300 shadow-xs">
                      UK: {Number(product?.stock_uk) || 0} Lọ → <b className="text-violet-700">{((Number(product?.stock_uk) || 0) * (Number(conversionRate) || 1)).toFixed(1)} {baseUnit}</b>
                    </span>
                  </div>
                </div>
              </label>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100">Hủy</button>
          <button disabled={saving} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm">
            {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
          </button>
        </div>
      </form>
    </div>
  );
}

function CreateServiceModal({ saving, onClose, onSubmit }) {
  const [form, setForm] = useState({ service_name: '', service_code: '', description: '' });

  const submit = event => {
    event.preventDefault();
    onSubmit({
      ...form,
      service_code: form.service_code.trim() || suggestServiceCode(form.service_name)
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">Thêm dịch vụ</h2>
            <p className="mt-1 text-xs text-slate-500">Sau khi tạo, bạn sẽ chọn các mặt hàng cho dịch vụ này.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <label className="block text-sm font-bold text-slate-700">
            Tên dịch vụ <span className="text-rose-500">*</span>
            <input
              autoFocus
              required
              value={form.service_name}
              onChange={event => setForm({ ...form, service_name: event.target.value })}
              placeholder="Ví dụ: Căng da"
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal text-slate-950 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label className="block text-sm font-bold text-slate-700">
            Mô tả <span className="font-normal text-slate-400">(không bắt buộc)</span>
            <textarea
              value={form.description}
              onChange={event => setForm({ ...form, description: event.target.value })}
              placeholder="Ghi chú để Admin dễ nhận biết"
              rows="3"
              className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal text-slate-950 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer text-xs font-bold text-slate-600">Mã nội bộ (hệ thống có thể tự tạo)</summary>
            <input
              value={form.service_code}
              onChange={event => setForm({ ...form, service_code: event.target.value.toUpperCase() })}
              placeholder={suggestServiceCode(form.service_name) || 'Ví dụ: CANG_DA'}
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-950 outline-none focus:border-blue-500"
            />
          </details>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Hủy</button>
          <button disabled={saving} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Đang tạo…' : 'Tạo dịch vụ'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function WarehouseManagement() {
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState(null);
  const [templateItems, setTemplateItems] = useState([]);
  const [editingProductUnits, setEditingProductUnits] = useState(null);
  const [serviceDraft, setServiceDraft] = useState({ service_name: '', description: '', display_order: 0 });
  const [serviceSearch, setServiceSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const request = useCallback(async (path, options = {}) => {
    try {
      return await axios({ url: `${API_URL}${path}`, ...options });
    } catch (requestError) {
      throw new Error(requestError.response?.data?.message || requestError.message, { cause: requestError });
    }
  }, []);

  const selectedService = services.find(service => service.id === selectedServiceId) || null;

  const loadTemplate = useCallback(async (service, knownProducts = products) => {
    if (!service) return;
    setSelectedServiceId(service.id);
    setServiceDraft({
      service_name: service.service_name || '',
      description: service.description || '',
      display_order: Number(service.display_order) || 0
    });
    setProductSearch('');
    setLoadingTemplate(true);
    setError('');
    try {
      const result = await request(`/admin/warehouse/services/${service.id}/products`);
      const byId = new Map(knownProducts.map(product => [product.id, product]));
      setTemplateItems((result.data.items || [])
        .filter(item => item.is_active !== false)
        .map((item, index) => ({
          ...item,
          product_name: item.product_name || byId.get(item.product_id)?.product_name,
          barcode: item.barcode || byId.get(item.product_id)?.barcode,
          quantity_mode: item.quantity_mode || byId.get(item.product_id)?.quantity_mode || 'INTEGER',
          default_quantity: Number(item.default_quantity) || 1,
          display_order: index
        })));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoadingTemplate(false);
    }
  }, [products, request]);

  const loadCatalog = useCallback(async ({ keepSelection = true } = {}) => {
    setLoading(true);
    setError('');
    try {
      const [serviceResult, productResult] = await Promise.all([
        request('/admin/warehouse/services'),
        request('/admin/warehouse/products')
      ]);
      const nextServices = serviceResult.data.services || [];
      const nextProducts = (productResult.data.products || []).filter(product => product.is_active !== false);
      setServices(nextServices);
      setProducts(nextProducts);

      const currentId = keepSelection ? selectedServiceId : null;
      const nextSelected = nextServices.find(service => service.id === currentId)
        || nextServices.find(service => service.is_active !== false)
        || null;
      if (nextSelected) await loadTemplate(nextSelected, nextProducts);
      else {
        setSelectedServiceId(null);
        setTemplateItems([]);
      }
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [loadTemplate, request, selectedServiceId]);

  const initialCatalogLoader = useRef(loadCatalog);
  useEffect(() => {
    const requestId = window.setTimeout(() => initialCatalogLoader.current({ keepSelection: false }), 0);
    return () => window.clearTimeout(requestId);
  }, []);

  const visibleServices = useMemo(() => {
    const keyword = serviceSearch.trim().toLocaleLowerCase('vi');
    return services.filter(service => {
      if (!showArchived && service.is_active === false) return false;
      return !keyword || `${service.service_name} ${service.service_code}`.toLocaleLowerCase('vi').includes(keyword);
    });
  }, [serviceSearch, services, showArchived]);

  const selectableProducts = useMemo(() => {
    const selectedIds = new Set(templateItems.map(item => item.product_id));
    const keyword = productSearch.trim().toLocaleLowerCase('vi');
    return products.filter(product => {
      if (selectedIds.has(product.id)) return false;
      return !keyword || `${product.product_name} ${product.barcode}`.toLocaleLowerCase('vi').includes(keyword);
    });
  }, [productSearch, products, templateItems]);

  const createService = async form => {
    setSaving(true);
    setError('');
    try {
      const result = await request('/admin/warehouse/services', {
        method: 'POST',
        data: { ...form, display_order: services.length }
      });
      let created = result.data?.service || result.data?.data?.service;
      // Compatibility with an older API bundle that returned the row directly.
      if (!created?.id && result.data?.id && result.data?.service_name) created = result.data;
      if (!created?.id) {
        // A reverse proxy can return a successful response without forwarding
        // the new row. Reload once and select it by the unique name/code.
        const catalog = await request('/admin/warehouse/services');
        const candidates = catalog.data?.services || [];
        created = candidates.find(item => item.service_name === form.service_name.trim())
          || candidates.find(item => item.service_code === form.service_code);
      }
      if (!created?.id) {
        throw new Error('API đã nhận yêu cầu nhưng không trả về dịch vụ. Hãy khởi động lại API rồi thử lại.');
      }
      const createdService = { ...created, active_product_count: 0 };
      setServices(current => [createdService, ...current]);
      setSelectedServiceId(createdService.id);
      setServiceDraft({
        service_name: createdService.service_name || '',
        description: createdService.description || '',
        display_order: Number(createdService.display_order) || 0
      });
      setTemplateItems([]);
      setShowCreateModal(false);
      setNotice('Đã tạo dịch vụ. Hãy thêm các mặt hàng và bấm “Lưu mẫu dịch vụ”.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const updateService = async changes => {
    if (!selectedService) return;
    setSaving(true);
    setError('');
    try {
      const result = await request(`/admin/warehouse/services/${selectedService.id}`, {
        method: 'PUT',
        data: { ...selectedService, ...changes }
      });
      setServices(current => current.map(service => service.id === selectedService.id
        ? { ...service, ...result.data.service, active_product_count: service.active_product_count }
        : service));
      setNotice('Đã cập nhật thông tin dịch vụ.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const archiveService = async () => {
    if (!selectedService) return;
    const isRestoring = selectedService.is_active === false;
    if (!isRestoring && !window.confirm(
      `Xóa “${selectedService.service_name}” khỏi danh mục nhân viên? Các đơn cũ vẫn được giữ nguyên.`
    )) return;
    setSaving(true);
    setError('');
    try {
      await request(`/admin/warehouse/services/${selectedService.id}`, {
        method: 'PUT',
        data: { ...selectedService, is_active: isRestoring }
      });
      setNotice(isRestoring ? 'Đã khôi phục dịch vụ.' : 'Đã xóa dịch vụ khỏi danh mục nhân viên.');
      setSelectedServiceId(null);
      await loadCatalog({ keepSelection: false });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const addProduct = productId => {
    const product = products.find(item => item.id === productId);
    if (!product || templateItems.some(item => item.product_id === product.id)) return;
    setTemplateItems(current => [...current, {
      product_id: product.id,
      product_name: product.product_name,
      barcode: product.barcode,
      quantity_mode: product.quantity_mode || 'INTEGER',
      default_quantity: 1,
      display_order: current.length
    }]);
    setProductSearch('');
  };

  const updateItem = (productId, changes) => {
    setTemplateItems(current => current.map(item => item.product_id === productId ? { ...item, ...changes } : item));
  };

  const updateProductQuantityMode = async (productId, quantityMode) => {
    setSaving(true);
    setError('');
    try {
      const result = await request(`/admin/warehouse/products/${productId}`, {
        method: 'PUT',
        data: { quantity_mode: quantityMode }
      });
      const updated = result.data.product;
      setProducts(current => current.map(product => product.id === productId ? { ...product, ...updated } : product));
      setTemplateItems(current => current.map(item => item.product_id === productId
        ? { ...item, quantity_mode: updated.quantity_mode }
        : item));
      setNotice(updated.quantity_mode === 'DECIMAL'
        ? 'Đã cho phép sản phẩm xuất theo số thập phân.'
        : 'Đã đặt sản phẩm chỉ xuất theo số nguyên.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const saveProductUnits = async (productId, unitConfig) => {
    setSaving(true);
    setError('');
    try {
      const result = await request(`/admin/warehouse/products/${productId}`, {
        method: 'PUT',
        data: unitConfig
      });
      const updated = result.data.product;
      if (unitConfig.sync_inventory) {
        await loadCatalog({ keepSelection: true });
      } else {
        setProducts(current => current.map(product => product.id === productId ? { ...product, ...updated } : product));
        setTemplateItems(current => current.map(item => item.product_id === productId
          ? {
              ...item,
              quantity_mode: updated.quantity_mode,
              base_unit: updated.base_unit,
              import_unit: updated.import_unit,
              conversion_rate: updated.conversion_rate
            }
          : item));
      }
      setEditingProductUnits(null);
      setNotice(`Đã cập nhật cấu hình đơn vị tính cho “${updated.product_name}”.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const removeItem = productId => {
    setTemplateItems(current => current
      .filter(item => item.product_id !== productId)
      .map((item, index) => ({ ...item, display_order: index })));
  };

  const moveItem = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= templateItems.length) return;
    setTemplateItems(current => {
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy.map((item, itemIndex) => ({ ...item, display_order: itemIndex }));
    });
  };

  const saveTemplate = async () => {
    if (!selectedService) return;
    const invalidItem = templateItems.find(item => {
      const quantity = Number(item.default_quantity);
      const scaled = quantity * 10;
      const hasValidPrecision = Math.abs(scaled - Math.round(scaled)) <= 1e-7;
      return !Number.isFinite(quantity) || quantity <= 0 || !hasValidPrecision
        || (item.quantity_mode !== 'DECIMAL' && !Number.isInteger(quantity));
    });
    if (invalidItem) {
      setError(`Số lượng của “${invalidItem.product_name}” phải là ${invalidItem.quantity_mode === 'DECIMAL' ? 'số dương, tối đa 1 chữ số thập phân' : 'số nguyên lớn hơn 0'}.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await request(`/admin/warehouse/services/${selectedService.id}/products`, {
        method: 'PUT',
        data: {
          items: templateItems.map((item, index) => ({
            product_id: item.product_id,
            default_quantity: Number(item.default_quantity),
            is_active: true,
            display_order: index
          }))
        }
      });
      setNotice('Đã lưu mẫu. Lần tới khi nhân viên chọn dịch vụ này, hệ thống sẽ điền đúng danh sách và số lượng vừa đặt.');
      await loadCatalog();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="warehouse-catalog -m-4 min-h-[calc(100vh-5rem)] bg-slate-100 p-4 text-slate-900 sm:-m-6 sm:p-6 lg:-m-8 lg:p-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Quản lý kho</div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Mẫu sản phẩm theo dịch vụ</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Thiết lập một lần để nhân viên chọn nhanh: dịch vụ nào cần mặt hàng gì và số lượng mặc định bao nhiêu.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => loadCatalog()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Làm mới
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />Thêm dịch vụ
            </button>
          </div>
        </header>

        <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-slate-700">
          <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
          <div><span className="font-bold text-slate-900">Cách hoạt động:</span> nhân viên chọn một hoặc nhiều dịch vụ trên điện thoại → hệ thống tự đưa các mặt hàng và số lượng bên dưới vào đơn → nhân viên vẫn có thể chỉnh riêng cho khách đó mà không làm thay đổi mẫu này.</div>
        </div>

        {notice && (
          <div className="flex items-start justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            <span>{notice}</span><button onClick={() => setNotice('')} className="ml-3 p-1"><X className="h-4 w-4" /></button>
          </div>
        )}
        {error && (
          <div className="flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            <span>{error}</span><button onClick={() => setError('')} className="ml-3 p-1"><X className="h-4 w-4" /></button>
          </div>
        )}

        {loading && !services.length ? (
          <div className="flex min-h-[460px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
            <div className="text-center text-sm text-slate-500"><RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-blue-600" />Đang tải danh mục…</div>
          </div>
        ) : services.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="Chưa có dịch vụ nào"
            description="Bấm “Thêm dịch vụ”, nhập tên dịch vụ rồi chọn các mặt hàng và số lượng mặc định."
            action={<button onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white"><Plus className="h-4 w-4" />Thêm dịch vụ đầu tiên</button>}
          />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div><div className="font-bold text-slate-950">Dịch vụ</div><div className="mt-0.5 text-xs text-slate-500">{services.filter(item => item.is_active !== false).length} đang hiển thị cho nhân viên</div></div>
                </div>
                <div className="relative mt-3">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    value={serviceSearch}
                    onChange={event => setServiceSearch(event.target.value)}
                    placeholder="Tìm dịch vụ…"
                    className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-blue-500"
                  />
                </div>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-500">
                  <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} className="accent-blue-600" />Hiện cả dịch vụ đã xóa
                </label>
              </div>

              <div className="max-h-[650px] overflow-y-auto p-2">
                {visibleServices.map(service => (
                  <button
                    key={service.id}
                    onClick={() => loadTemplate(service)}
                    className={`mb-1 w-full rounded-xl px-3 py-3 text-left transition last:mb-0 ${
                      selectedServiceId === service.id ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-slate-100'
                    } ${service.is_active === false ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm font-bold ${selectedServiceId === service.id ? 'text-white' : 'text-slate-800'}`}>{service.service_name}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${selectedServiceId === service.id ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-500'}`}>{service.active_product_count || 0} hàng</span>
                    </div>
                    <div className={`mt-1 truncate text-xs ${selectedServiceId === service.id ? 'text-slate-400' : 'text-slate-500'}`}>{service.is_active === false ? 'Đã xóa khỏi danh mục' : service.description || service.service_code}</div>
                  </button>
                ))}
                {!visibleServices.length && <div className="p-8 text-center text-sm text-slate-500">Không tìm thấy dịch vụ.</div>}
              </div>
            </aside>

            {!selectedService ? (
              <EmptyState icon={Boxes} title="Chọn một dịch vụ" description="Chọn dịch vụ ở cột bên trái để sửa tên, thêm mặt hàng và đặt số lượng mặc định." />
            ) : (
              <main className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-blue-700">Đang chỉnh sửa</div>
                    <h2 className="mt-1 text-2xl font-bold text-slate-950">{selectedService.service_name}</h2>
                    <p className="mt-1 text-xs text-slate-500">Đơn đã tạo trước đây không bị thay đổi.</p>
                  </div>
                  <button
                    onClick={archiveService}
                    disabled={saving}
                    className={`inline-flex items-center gap-2 self-start rounded-xl px-3 py-2 text-xs font-bold ${selectedService.is_active === false ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
                  >
                    {selectedService.is_active === false ? <ArchiveRestore className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                    {selectedService.is_active === false ? 'Khôi phục dịch vụ' : 'Xóa dịch vụ'}
                  </button>
                </div>

                <div className="space-y-6 p-5">
                  <section>
                    <h3 className="text-sm font-bold text-slate-900">Thông tin dịch vụ</h3>
                    <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_100px_auto] lg:items-end">
                      <label className="text-xs font-bold text-slate-600">Tên dịch vụ
                        <input
                          value={serviceDraft.service_name}
                          onChange={event => setServiceDraft({ ...serviceDraft, service_name: event.target.value })}
                          className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-950 outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="text-xs font-bold text-slate-600">Mô tả
                        <input
                          value={serviceDraft.description}
                          onChange={event => setServiceDraft({ ...serviceDraft, description: event.target.value })}
                          placeholder="Không bắt buộc"
                          className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-950 outline-none placeholder:text-slate-400 focus:border-blue-500"
                        />
                      </label>
                      <label className="text-xs font-bold text-slate-600">Thứ tự
                        <input
                          type="number"
                          step="1"
                          value={serviceDraft.display_order}
                          onChange={event => setServiceDraft({ ...serviceDraft, display_order: Number(event.target.value) })}
                          className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-950 outline-none focus:border-blue-500"
                        />
                      </label>
                      <button
                        onClick={() => updateService(serviceDraft)}
                        disabled={saving || !serviceDraft.service_name.trim()}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
                      >Lưu tên</button>
                    </div>
                  </section>

                  <section className="border-t border-slate-100 pt-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-slate-950">Mặt hàng khi nhân viên chọn dịch vụ</h3>
                        <p className="mt-1 text-xs text-slate-500">Đặt số lượng mặc định cho một khách hàng. Có thể thay đổi thứ tự hoặc bỏ mặt hàng khỏi mẫu.</p>
                      </div>
                      <span className="text-xs font-bold text-blue-700">{templateItems.length} mặt hàng</span>
                    </div>

                    {products.length ? (
                      <div className="mt-4 overflow-hidden rounded-xl border border-blue-200 bg-blue-50">
                        <div className="flex flex-col gap-3 border-b border-blue-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-bold text-slate-900">Danh mục sản phẩm có thể thêm</div>
                            <div className="mt-1 text-xs text-slate-500">
                              Có {products.length} sản phẩm trong hệ thống · còn {selectableProducts.length} sản phẩm chưa gắn vào dịch vụ này
                            </div>
                          </div>
                          <div className="relative w-full sm:max-w-sm">
                            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <input
                              value={productSearch}
                              onChange={event => setProductSearch(event.target.value)}
                              placeholder="Tìm tên hoặc mã vạch…"
                              className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-blue-500"
                            />
                          </div>
                        </div>

                        <div className="max-h-[28rem] overflow-y-auto bg-white p-3">
                          {selectableProducts.length ? (
                            <div className="grid gap-3 xl:grid-cols-2">
                              {selectableProducts.map(product => (
                                <div
                                  key={product.id}
                                  className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm transition hover:border-blue-300 hover:bg-white"
                                >
                                  <div className="flex min-w-0 items-start gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                                      <Package className="h-5 w-5" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="break-words text-sm font-bold leading-5 text-slate-900" title={product.product_name}>{product.product_name}</div>
                                      </div>
                                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                                        <span className="rounded-md bg-slate-200 px-2 py-0.5 font-mono text-slate-600">Mã: {product.barcode || 'Chưa có'}</span>
                                        <span className="rounded-md bg-blue-100 px-2 py-0.5 font-bold text-blue-800">Đơn vị: {product.base_unit || 'chiếc'}</span>
                                        {product.import_unit && Number(product.conversion_rate) > 1 && (
                                          <span className="rounded-md bg-amber-100 px-2 py-0.5 font-bold text-amber-900 border border-amber-300">
                                            📦 1 {product.import_unit} = {product.conversion_rate} {product.base_unit || 'chiếc'}
                                          </span>
                                        )}
                                        <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">US: {Number(product.stock_us) || 0}</span>
                                        <span className="rounded-md bg-violet-50 px-2 py-0.5 font-bold text-violet-700">UK: {Number(product.stock_uk) || 0}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
                                    <button
                                      type="button"
                                      onClick={() => setEditingProductUnits(product)}
                                      title="Cài đặt đơn vị tính cơ sở và hệ số quy đổi đóng gói"
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 shadow-sm hover:bg-blue-100 transition"
                                    >
                                      <Settings className="h-3.5 w-3.5 text-blue-600" />
                                      <span>Đơn vị & Quy đổi</span>
                                    </button>

                                    <div className="flex items-center gap-2">
                                      <label className="sr-only">Kiểu số lượng</label>
                                      <select
                                        value={product.quantity_mode || 'INTEGER'}
                                        disabled={saving}
                                        onChange={event => updateProductQuantityMode(product.id, event.target.value)}
                                        title="Kiểu số lượng khi xuất kho"
                                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                                      >
                                        <option value="INTEGER">Chỉ nhập số nguyên (1, 2, 3…)</option>
                                        <option value="DECIMAL">Cho nhập thập phân (1.2, 2.3…)</option>
                                      </select>
                                      <button
                                        type="button"
                                        onClick={() => addProduct(product.id)}
                                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
                                      >
                                        <Plus className="h-3.5 w-3.5" />Thêm
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="p-8 text-center">
                              <Package className="mx-auto h-7 w-7 text-slate-300" />
                              <div className="mt-3 text-sm font-bold text-slate-700">
                                {productSearch.trim() ? 'Không tìm thấy sản phẩm phù hợp' : 'Tất cả sản phẩm đã được thêm'}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {productSearch.trim() ? 'Hãy thử tìm bằng tên hoặc mã vạch khác.' : 'Bạn có thể chỉnh số lượng hoặc bỏ sản phẩm ở danh sách phía dưới.'}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><span className="font-bold">Chưa có mặt hàng.</span> Mặt hàng được tạo khi nhân viên nhập kho lần đầu trên Telegram.</div>
                    )}

                    <div className="mt-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <div className="text-sm font-bold text-slate-900">Sản phẩm đã chọn cho dịch vụ “{selectedService.service_name}”</div>
                        <div className="mt-1 text-xs text-slate-500">Nhập số lượng mặc định dùng cho một khách hàng, sau đó bấm “Lưu mẫu dịch vụ”.</div>
                      </div>
                      <div className="text-xs font-bold text-blue-700">Đã chọn {templateItems.length}/{products.length}</div>
                    </div>

                    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                      <div className="sm:min-w-[760px]">
                        <div className="hidden grid-cols-[minmax(220px,1fr)_210px_170px_110px] gap-3 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 sm:grid">
                        <div>Mặt hàng</div><div>Kiểu số lượng</div><div>Số lượng mặc định</div><div className="text-right">Thao tác</div>
                        </div>
                      {loadingTemplate ? (
                        <div className="p-10 text-center text-sm text-slate-500"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin text-blue-600" />Đang tải mặt hàng…</div>
                      ) : templateItems.length ? templateItems.map((item, index) => (
                        <div key={item.product_id} className="grid gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(220px,1fr)_210px_170px_110px] sm:items-center">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="truncate text-sm font-bold text-slate-800">{item.product_name}</div>
                              <button
                                type="button"
                                onClick={() => {
                                  const prod = products.find(p => p.id === item.product_id) || item;
                                  setEditingProductUnits(prod);
                                }}
                                title="Cài đặt đơn vị tính và quy đổi đóng gói"
                                className="rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-700 transition"
                              >
                                <Settings className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                              <span className="font-mono text-slate-400">{item.barcode}</span>
                              <span className="rounded bg-blue-50 px-1.5 py-0.2 text-[11px] font-bold text-blue-800">ĐVT: {item.base_unit || 'chiếc'}</span>
                              {item.import_unit && Number(item.conversion_rate) > 1 && (
                                <span className="rounded bg-amber-50 px-1.5 py-0.2 text-[11px] font-bold text-amber-800 border border-amber-200">
                                  1 {item.import_unit} = {item.conversion_rate} {item.base_unit || 'chiếc'}
                                </span>
                              )}
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-500 sm:block">
                            <span className="sm:hidden">Kiểu số lượng:</span>
                            <select
                              value={item.quantity_mode || 'INTEGER'}
                              disabled={saving}
                              onChange={event => updateProductQuantityMode(item.product_id, event.target.value)}
                              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
                            >
                              <option value="INTEGER">Số nguyên (1, 2, 3…)</option>
                              <option value="DECIMAL">Thập phân (1.2, 2.3…)</option>
                            </select>
                          </label>
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-500 sm:block">
                            <span className="sm:hidden">Số lượng:</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={item.quantity_mode === 'DECIMAL' ? '0.1' : '1'}
                                step={item.quantity_mode === 'DECIMAL' ? '0.1' : '1'}
                                inputMode={item.quantity_mode === 'DECIMAL' ? 'decimal' : 'numeric'}
                                value={item.default_quantity}
                                onChange={event => updateItem(item.product_id, { default_quantity: Number(event.target.value) })}
                                className="w-20 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm font-bold text-slate-950 outline-none focus:border-blue-500"
                              />
                              <span className="text-xs font-bold text-slate-500 shrink-0">{item.base_unit || 'chiếc'}</span>
                            </div>
                          </label>
                          <div className="flex justify-end gap-1">
                            <button onClick={() => moveItem(index, -1)} disabled={index === 0} title="Đưa lên" className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                            <button onClick={() => moveItem(index, 1)} disabled={index === templateItems.length - 1} title="Đưa xuống" className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                            <button onClick={() => removeItem(item.product_id)} title="Bỏ khỏi dịch vụ" className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </div>
                      )) : (
                        <div className="p-10 text-center"><Package className="mx-auto h-7 w-7 text-slate-300" /><div className="mt-3 text-sm font-bold text-slate-700">Dịch vụ chưa có mặt hàng</div><div className="mt-1 text-xs text-slate-500">Chọn mặt hàng ở ô phía trên để thêm vào mẫu.</div></div>
                      )}
                      </div>
                    </div>
                  </section>
                </div>

                <div className="sticky bottom-0 flex flex-col gap-3 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs leading-5 text-slate-500">Bấm lưu sau khi thêm, xóa hoặc đổi số lượng mặt hàng.</div>
                  <button
                    onClick={saveTemplate}
                    disabled={saving || selectedService.is_active === false}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <Save className="h-4 w-4" />{saving ? 'Đang lưu…' : 'Lưu mẫu dịch vụ'}
                  </button>
                </div>
              </main>
            )}
          </div>
        )}
      </div>

      {showCreateModal && <CreateServiceModal saving={saving} onClose={() => setShowCreateModal(false)} onSubmit={createService} />}
      {editingProductUnits && (
        <ProductUnitsModal
          key={editingProductUnits.id}
          product={products.find(p => p.id === editingProductUnits.id) || editingProductUnits}
          saving={saving}
          onClose={() => setEditingProductUnits(null)}
          onSave={saveProductUnits}
        />
      )}
    </div>
  );
}
