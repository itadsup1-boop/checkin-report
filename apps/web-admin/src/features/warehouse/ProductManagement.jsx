import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Boxes,
  PackagePlus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  X
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';


const UNIT_PRESETS = ['Chiếc', 'Cái', 'Lọ', 'Can', 'Chai', 'Hộp', 'Gói', 'Tuýp', 'Thùng', 'Vỉ', 'Cuộn', 'Đôi', 'Bộ', 'ml', 'Viên'];
const OTHER_UNIT = 'Khác (tự nhập)';

function quantityLabel(product) {
  return product.import_unit && Number(product.conversion_rate) > 1
    ? product.import_unit
    : (product.base_unit || 'chiếc');
}

function quantityStep(product) {
  if (product.import_unit && Number(product.conversion_rate) > 1) return '1';
  return product.quantity_mode === 'DECIMAL' ? '0.1' : '1';
}

function ReceiptModal({ groups, products, saving, error, onClose, onSubmit }) {
  const [groupId, setGroupId] = useState(groups.length === 1 ? groups[0].telegram_group_id : '');
  const [branch, setBranch] = useState('US');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [quantities, setQuantities] = useState({});

  const visibleProducts = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('vi');
    return products
      .filter(product => product.is_active !== false)
      .filter(product => !keyword || `${product.product_name} ${product.barcode}`
        .toLocaleLowerCase('vi').includes(keyword));
  }, [products, search]);

  const items = Object.entries(quantities)
    .filter(([, quantity]) => Number(quantity) > 0)
    .map(([productId, quantity]) => ({ product_id: productId, quantity: Number(quantity) }));

  const submit = event => {
    event.preventDefault();
    onSubmit({ group_id: groupId, branch, note, items });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-slate-950">Tạo phiếu nhập kho</h2>
            <p className="mt-1 text-sm text-slate-500">Số lượng được cộng qua phiếu và ghi vào sổ kho; không sửa trực tiếp tồn hiện tại.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 border-b border-slate-200 bg-slate-50 p-5 md:grid-cols-3">
          <label className="text-xs font-bold text-slate-700">
            Nhóm kho
            <select required value={groupId} onChange={event => setGroupId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-500">
              {!groups.length && <option value="">Chưa có nhóm kho</option>}
              {groups.length > 1 && <option value="">Chọn nhóm kho…</option>}
              {groups.map(group => (
                <option key={group.telegram_group_id} value={group.telegram_group_id}>
                  {group.group_name || group.telegram_group_id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            Cơ sở nhận hàng
            <select value={branch} onChange={event => setBranch(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-500">
              <option value="US">US / MEDITECH</option>
              <option value="UK">UK</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            Ghi chú
            <input value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Ví dụ: Nhập từ nhà cung cấp…" className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500" />
          </label>
        </div>

        {error && <div className="mx-5 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm tên hoặc mã sản phẩm…" className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {visibleProducts.map(product => (
              <label key={product.id} className={`rounded-xl border p-4 transition ${Number(quantities[product.id]) > 0 ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-words text-sm font-bold text-slate-900">{product.product_name}</div>
                    <div className="mt-1 font-mono text-xs text-slate-400">{product.barcode || 'Chưa có mã'}</div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] font-semibold text-slate-500">
                    <div>US: {Number(product.stock_us) || 0}</div>
                    <div>UK: {Number(product.stock_uk) || 0}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                  <span className="text-xs font-bold text-slate-600">Số lượng nhập</span>
                  <input
                    type="number"
                    min={quantityStep(product)}
                    step={quantityStep(product)}
                    value={quantities[product.id] || ''}
                    onChange={event => setQuantities(current => ({ ...current, [product.id]: event.target.value }))}
                    className="ml-auto w-28 rounded-lg border border-slate-300 px-3 py-2 text-right text-sm font-bold text-slate-950 outline-none focus:border-blue-500"
                  />
                  <span className="w-16 truncate text-xs font-bold text-blue-700" title={quantityLabel(product)}>{quantityLabel(product)}</span>
                </div>
                {product.import_unit && Number(product.conversion_rate) > 1 && (
                  <div className="mt-2 text-[11px] text-amber-700">
                    1 {product.import_unit} = {product.conversion_rate} {product.base_unit || 'chiếc'} tồn kho
                  </div>
                )}
              </label>
            ))}
          </div>
          {!visibleProducts.length && <div className="py-12 text-center text-sm text-slate-500">Không tìm thấy sản phẩm phù hợp.</div>}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-slate-600">Đã chọn {items.length} sản phẩm</div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Hủy</button>
            <button disabled={saving || !groupId || !items.length} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
              <PackagePlus className="h-4 w-4" />{saving ? 'Đang nhập…' : 'Xác nhận nhập kho'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function ProductManagement({ groups = [] }) {
  const [products, setProducts] = useState([]);
  const [nameDrafts, setNameDrafts] = useState({});
  const [unitDrafts, setUnitDrafts] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const request = useCallback(async (path, options = {}) => {
    try {
      return await axios({ url: `${API_URL}${path}`, ...options });
    } catch (requestError) {
      throw new Error(requestError.response?.data?.message || requestError.message, { cause: requestError });
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await request('/admin/warehouse/products');
      const nextProducts = result.data.products || [];
      setProducts(nextProducts);
      setNameDrafts(Object.fromEntries(nextProducts.map(product => [product.id, product.product_name])));
      setUnitDrafts(Object.fromEntries(nextProducts.map(product => [product.id, product.base_unit || 'Chiếc'])));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const requestId = window.setTimeout(loadProducts, 0);
    return () => window.clearTimeout(requestId);
  }, [loadProducts]);

  const filteredProducts = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('vi');
    return products.filter(product => !keyword || `${product.product_name} ${product.barcode}`
      .toLocaleLowerCase('vi').includes(keyword));
  }, [products, search]);

  const renameProduct = async product => {
    const productName = String(nameDrafts[product.id] || '').trim().replace(/\s+/g, ' ');
    if (productName.length < 2 || productName.length > 200) {
      setError('Tên sản phẩm phải có từ 2 đến 200 ký tự.');
      return;
    }
    const baseUnit = String(unitDrafts[product.id] || '').trim();
    if (!baseUnit) {
      setError('Vui lòng chọn đơn vị tính cho sản phẩm.');
      return;
    }
    setSavingId(product.id);
    setError('');
    try {
      const result = await request(`/admin/warehouse/products/${product.id}`, {
        method: 'PUT',
        data: { product_name: productName, base_unit: baseUnit }
      });
      const updated = result.data.product;
      setProducts(current => current.map(item => item.id === product.id ? { ...item, ...updated } : item));
      setNameDrafts(current => ({ ...current, [product.id]: updated.product_name }));
      setUnitDrafts(current => ({ ...current, [product.id]: updated.base_unit }));
      setNotice(`Đã cập nhật sản phẩm “${updated.product_name}” (đơn vị: ${updated.base_unit}).`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingId(null);
    }
  };

  const createReceipt = async form => {
    setSavingId('receipt');
    setError('');
    try {
      const result = await request('/admin/warehouse/imports', { method: 'POST', data: form });
      setShowReceipt(false);
      setNotice(`Đã nhập kho ${result.data.receipt.items.length} sản phẩm tại cơ sở ${result.data.receipt.branch}.`);
      await loadProducts();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Quản lý kho</div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Quản lý sản phẩm</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Đổi tên sản phẩm và tạo phiếu nhập kho. Tồn US/UK chỉ để xem, không thể sửa trực tiếp.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={loadProducts} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Làm mới
          </button>
          <button onClick={() => { setError(''); setShowReceipt(true); }} disabled={!products.some(product => product.is_active !== false)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300">
            <PackagePlus className="h-4 w-4" />Tạo phiếu nhập kho
          </button>
        </div>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div><b>Kiểm soát tồn kho:</b> đổi tên không làm thay đổi tồn; mọi lần cộng hàng bắt buộc đi qua phiếu nhập và được ghi vào lịch sử kho.</div>
      </div>

      {notice && <div className="flex justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"><span>{notice}</span><button onClick={() => setNotice('')}><X className="h-4 w-4" /></button></div>}
      {error && <div className="flex justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800"><span>{error}</span><button onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}

      <section className="flex flex-col flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="font-bold text-slate-950">Danh mục sản phẩm</div><div className="mt-1 text-xs text-slate-500">{products.length} sản phẩm · tồn kho là dữ liệu chỉ đọc</div></div>
          <div className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm tên hoặc mã sản phẩm…" className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></div>
        </div>

        {loading && !products.length ? (
          <div className="p-16 text-center text-sm text-slate-500"><RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-blue-600" />Đang tải sản phẩm…</div>
        ) : filteredProducts.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[850px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Mã sản phẩm</th><th className="px-5 py-3">Tên sản phẩm</th><th className="px-5 py-3">Đơn vị</th><th className="px-5 py-3 text-right">Tồn US</th><th className="px-5 py-3 text-right">Tồn UK</th><th className="px-5 py-3 text-right">Thao tác</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map(product => {
                  const draft = nameDrafts[product.id] ?? product.product_name;
                  const unitDraft = unitDrafts[product.id] ?? (product.base_unit || 'Chiếc');
                  // So khớp không phân biệt hoa/thường: dữ liệu cũ lưu "chiếc" (thường)
                  // vẫn phải khớp đúng lựa chọn "Chiếc" trong danh sách, không rơi vào "Khác".
                  const matchedPreset = UNIT_PRESETS.find(unit => unit.toLowerCase() === unitDraft.trim().toLowerCase());
                  const isPresetUnit = Boolean(matchedPreset);
                  const nameUnchanged = draft.trim().replace(/\s+/g, ' ') === product.product_name;
                  const unitUnchanged = unitDraft.trim() === (product.base_unit || 'Chiếc');
                  const unchanged = nameUnchanged && unitUnchanged;
                  return (
                    <tr key={product.id} className={product.is_active === false ? 'bg-slate-50 opacity-65' : 'hover:bg-blue-50/30'}>
                      <td className="px-5 py-4 font-mono text-xs text-slate-500">{product.barcode || '—'}</td>
                      <td className="px-5 py-4"><input value={draft} maxLength={200} onChange={event => setNameDrafts(current => ({ ...current, [product.id]: event.target.value }))} className="w-full min-w-56 rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></td>
                      <td className="px-5 py-4 text-slate-600">
                        <select
                          value={matchedPreset || OTHER_UNIT}
                          onChange={event => setUnitDrafts(current => ({ ...current, [product.id]: event.target.value === OTHER_UNIT ? '' : event.target.value }))}
                          className="w-full min-w-28 rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        >
                          {UNIT_PRESETS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                          <option value={OTHER_UNIT}>{OTHER_UNIT}</option>
                        </select>
                        {!isPresetUnit && (
                          <input
                            value={unitDraft}
                            maxLength={50}
                            placeholder="Nhập đơn vị..."
                            onChange={event => setUnitDrafts(current => ({ ...current, [product.id]: event.target.value }))}
                            className="mt-1.5 w-full min-w-28 rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                          />
                        )}
                        {product.import_unit && Number(product.conversion_rate) > 1 && <div className="mt-1 text-xs text-amber-700">1 {product.import_unit} = {product.conversion_rate} {product.base_unit}</div>}
                      </td>
                      <td className="px-5 py-4 text-right"><span className="rounded-lg bg-emerald-50 px-3 py-1.5 font-bold text-emerald-700">{Number(product.stock_us) || 0}</span></td>
                      <td className="px-5 py-4 text-right"><span className="rounded-lg bg-violet-50 px-3 py-1.5 font-bold text-violet-700">{Number(product.stock_uk) || 0}</span></td>
                      <td className="px-5 py-4 text-right"><button onClick={() => renameProduct(product)} disabled={savingId === product.id || unchanged || draft.trim().length < 2 || !unitDraft.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"><Save className="h-3.5 w-3.5" />{savingId === product.id ? 'Đang lưu…' : 'Lưu'}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-16 text-center"><Boxes className="mx-auto h-8 w-8 text-slate-300" /><div className="mt-3 text-sm font-bold text-slate-700">Chưa có sản phẩm phù hợp</div></div>
        )}
      </section>

      {showReceipt && <ReceiptModal groups={groups} products={products} saving={savingId === 'receipt'} error={error} onClose={() => setShowReceipt(false)} onSubmit={createReceipt} />}
    </div>
  );
}
