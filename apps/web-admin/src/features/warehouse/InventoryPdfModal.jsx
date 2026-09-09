import { useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  FileDown,
  Printer,
  Search,
  X
} from 'lucide-react';

export default function InventoryPdfModal({ products, onClose }) {
  const [selectedBranch, setSelectedBranch] = useState('ALL'); // 'ALL' | 'US' | 'UK'
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [search, setSearch] = useState('');

  // Lọc danh sách sản phẩm theo tìm kiếm, cơ sở và trạng thái tồn kho
  const reportProducts = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('vi');
    return products.filter(p => {
      if (p.is_active === false) return false;
      if (keyword && !`${p.product_name} ${p.barcode}`.toLocaleLowerCase('vi').includes(keyword)) {
        return false;
      }
      const us = Number(p.stock_us) || 0;
      const uk = Number(p.stock_uk) || 0;
      const total = us + uk;

      if (onlyInStock) {
        if (selectedBranch === 'US') return us > 0;
        if (selectedBranch === 'UK') return uk > 0;
        return total > 0;
      }
      return true;
    });
  }, [products, selectedBranch, onlyInStock, search]);

  // Thống kê tổng quan
  const totals = useMemo(() => {
    let totalUs = 0;
    let totalUk = 0;
    let totalQty = 0;
    for (const p of reportProducts) {
      const us = Number(p.stock_us) || 0;
      const uk = Number(p.stock_uk) || 0;
      totalUs += us;
      totalUk += uk;
      totalQty += (us + uk);
    }
    return {
      totalUs,
      totalUk,
      totalQty,
      count: reportProducts.length
    };
  }, [reportProducts]);

  // Tiêu đề báo cáo theo cơ sở
  const reportTitle = useMemo(() => {
    if (selectedBranch === 'US') return 'BÁO CÁO THỐNG KÊ TỒN KHO - CƠ SỞ US (MEDITECH)';
    if (selectedBranch === 'UK') return 'BÁO CÁO THỐNG KÊ TỒN KHO - CƠ SỞ UK';
    return 'BÁO CÁO THỐNG KÊ TỒN KHO TOÀN HỆ THỐNG';
  }, [selectedBranch]);

  const reportSubtitle = useMemo(() => {
    if (selectedBranch === 'US') return 'Cơ sở: US / MEDITECH';
    if (selectedBranch === 'UK') return 'Cơ sở: UK';
    return 'Cơ sở: Toàn bộ hệ thống (US & UK)';
  }, [selectedBranch]);

  const nowFormatted = useMemo(() => {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }, []);

  // Hàm xuất bản in / Lưu PDF
  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=1000,height=800');
    if (!printWindow) {
      alert('Trình duyệt đang chặn cửa sổ pop-up. Vui lòng cấp quyền mở pop-up để in/lưu PDF.');
      return;
    }

    const tableRowsHtml = reportProducts.map((p, idx) => {
      const us = Number(p.stock_us) || 0;
      const uk = Number(p.stock_uk) || 0;
      const total = us + uk;
      const unit = p.base_unit || 'chiếc';

      let qtyColumns;
      if (selectedBranch === 'ALL') {
        qtyColumns = `
          <td style="text-align: right; font-weight: 600; color: #047857;">${us}</td>
          <td style="text-align: right; font-weight: 600; color: #6d28d9;">${uk}</td>
          <td style="text-align: right; font-weight: 700; color: #1d4ed8;">${total}</td>
        `;
      } else if (selectedBranch === 'US') {
        qtyColumns = `
          <td style="text-align: right; font-weight: 700; color: #047857;">${us}</td>
        `;
      } else {
        qtyColumns = `
          <td style="text-align: right; font-weight: 700; color: #6d28d9;">${uk}</td>
        `;
      }

      const statusText = (selectedBranch === 'US' ? us : selectedBranch === 'UK' ? uk : total) > 0
        ? '<span style="color: #047857; font-weight: 600;">Còn hàng</span>'
        : '<span style="color: #e11d48; font-weight: 600;">Hết hàng</span>';

      return `
        <tr>
          <td style="text-align: center; color: #64748b;">${idx + 1}</td>
          <td style="font-family: monospace; font-size: 9pt; color: #475569;">${p.barcode || '—'}</td>
          <td style="font-weight: 600; color: #0f172a;">${p.product_name}</td>
          <td style="text-align: center; color: #475569;">${unit}</td>
          ${qtyColumns}
          <td style="text-align: center; font-size: 9pt;">${statusText}</td>
        </tr>
      `;
    }).join('');

    let tableHeaderQty;
    let tableFooterQty;
    if (selectedBranch === 'ALL') {
      tableHeaderQty = `
        <th style="width: 10%; text-align: right;">Tồn US</th>
        <th style="width: 10%; text-align: right;">Tồn UK</th>
        <th style="width: 12%; text-align: right;">Tổng tồn</th>
      `;
      tableFooterQty = `
        <td style="text-align: right; font-weight: 700; color: #047857;">${totals.totalUs}</td>
        <td style="text-align: right; font-weight: 700; color: #6d28d9;">${totals.totalUk}</td>
        <td style="text-align: right; font-weight: 800; color: #1d4ed8; font-size: 11pt;">${totals.totalQty}</td>
      `;
    } else if (selectedBranch === 'US') {
      tableHeaderQty = `
        <th style="width: 18%; text-align: right;">Tồn cơ sở US</th>
      `;
      tableFooterQty = `
        <td style="text-align: right; font-weight: 800; color: #047857; font-size: 11pt;">${totals.totalUs}</td>
      `;
    } else {
      tableHeaderQty = `
        <th style="width: 18%; text-align: right;">Tồn cơ sở UK</th>
      `;
      tableFooterQty = `
        <td style="text-align: right; font-weight: 800; color: #6d28d9; font-size: 11pt;">${totals.totalUk}</td>
      `;
    }

    const summaryCardsHtml = selectedBranch === 'ALL' ? `
      <div style="display: flex; gap: 12px; margin-bottom: 16px;">
        <div style="flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; background: #f8fafc;">
          <div style="font-size: 8pt; text-transform: uppercase; color: #64748b; font-weight: 700;">Tổng số mặt hàng</div>
          <div style="font-size: 14pt; font-weight: 800; color: #0f172a; margin-top: 4px;">${totals.count} <span style="font-size: 9pt; font-weight: 400; color: #64748b;">sản phẩm</span></div>
        </div>
        <div style="flex: 1; border: 1px solid #a7f3d0; border-radius: 6px; padding: 10px; background: #ecfdf5;">
          <div style="font-size: 8pt; text-transform: uppercase; color: #047857; font-weight: 700;">Tổng tồn cơ sở US</div>
          <div style="font-size: 14pt; font-weight: 800; color: #065f46; margin-top: 4px;">${totals.totalUs}</div>
        </div>
        <div style="flex: 1; border: 1px solid #ddd6fe; border-radius: 6px; padding: 10px; background: #f5f3ff;">
          <div style="font-size: 8pt; text-transform: uppercase; color: #6d28d9; font-weight: 700;">Tổng tồn cơ sở UK</div>
          <div style="font-size: 14pt; font-weight: 800; color: #5b21b6; margin-top: 4px;">${totals.totalUk}</div>
        </div>
        <div style="flex: 1; border: 1px solid #bfdbfe; border-radius: 6px; padding: 10px; background: #eff6ff;">
          <div style="font-size: 8pt; text-transform: uppercase; color: #1d4ed8; font-weight: 700;">Tổng tồn toàn hệ thống</div>
          <div style="font-size: 14pt; font-weight: 800; color: #1e40af; margin-top: 4px;">${totals.totalQty}</div>
        </div>
      </div>
    ` : `
      <div style="display: flex; gap: 12px; margin-bottom: 16px;">
        <div style="flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; background: #f8fafc;">
          <div style="font-size: 8pt; text-transform: uppercase; color: #64748b; font-weight: 700;">Số mặt hàng trong danh sách</div>
          <div style="font-size: 14pt; font-weight: 800; color: #0f172a; margin-top: 4px;">${totals.count} <span style="font-size: 9pt; font-weight: 400; color: #64748b;">sản phẩm</span></div>
        </div>
        <div style="flex: 1; border: 1px solid ${selectedBranch === 'US' ? '#a7f3d0' : '#ddd6fe'}; border-radius: 6px; padding: 10px; background: ${selectedBranch === 'US' ? '#ecfdf5' : '#f5f3ff'};">
          <div style="font-size: 8pt; text-transform: uppercase; color: ${selectedBranch === 'US' ? '#047857' : '#6d28d9'}; font-weight: 700;">Tổng tồn cơ sở ${selectedBranch}</div>
          <div style="font-size: 14pt; font-weight: 800; color: ${selectedBranch === 'US' ? '#065f46' : '#5b21b6'}; margin-top: 4px;">${selectedBranch === 'US' ? totals.totalUs : totals.totalUk}</div>
        </div>
      </div>
    `;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="utf-8">
        <title>${reportTitle} - ${nowFormatted}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm 10mm 15mm 10mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
            margin: 0;
            padding: 10px;
            font-size: 10pt;
            line-height: 1.4;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .header-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
          }
          .header-table td {
            vertical-align: top;
            padding: 0;
          }
          .title-area {
            text-align: center;
            margin-bottom: 16px;
          }
          .title-main {
            font-size: 15pt;
            font-weight: 800;
            text-transform: uppercase;
            color: #0f172a;
            margin: 0;
            letter-spacing: 0.5px;
          }
          .title-sub {
            font-size: 10pt;
            font-weight: 600;
            color: #334155;
            margin-top: 4px;
          }
          .title-date {
            font-size: 8.5pt;
            color: #64748b;
            font-style: italic;
            margin-top: 2px;
          }
          .data-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 8px;
            font-size: 9pt;
          }
          .data-table th, .data-table td {
            border: 1px solid #cbd5e1;
            padding: 6px 8px;
          }
          .data-table th {
            background-color: #f1f5f9 !important;
            font-weight: 700;
            color: #1e293b;
            text-transform: uppercase;
            font-size: 8pt;
            letter-spacing: 0.3px;
          }
          .data-table tbody tr:nth-child(even) {
            background-color: #f8fafc !important;
          }
          .data-table tfoot td {
            background-color: #f1f5f9 !important;
            border-top: 2px solid #94a3b8;
          }
          .signature-section {
            margin-top: 30px;
            display: flex;
            justify-content: space-between;
            page-break-inside: avoid;
          }
          .signature-box {
            text-align: center;
            width: 30%;
          }
          .sig-title {
            font-weight: 700;
            font-size: 9.5pt;
            text-transform: uppercase;
            color: #0f172a;
          }
          .sig-sub {
            font-size: 8pt;
            color: #64748b;
            font-style: italic;
            margin-top: 2px;
          }
          .sig-space {
            height: 65px;
          }
        </style>
      </head>
      <body>
        <table class="header-table">
          <tr>
            <td style="width: 60%;">
              <div style="font-weight: 800; font-size: 10.5pt; text-transform: uppercase; color: #1e40af;">HỆ THỐNG QUẢN LÝ KHO DƯỢC VẬT TƯ</div>
              <div style="font-size: 8.5pt; color: #475569; margin-top: 2px;">Cơ sở: US (Meditech) & UK</div>
            </td>
            <td style="width: 40%; text-align: right;">
              <div style="font-size: 8.5pt; color: #475569;">Thời gian in: <b>${nowFormatted}</b></div>
              <div style="font-size: 8.5pt; color: #64748b; margin-top: 2px;">Mẫu biểu: <b>BC-TK-01</b></div>
            </td>
          </tr>
        </table>

        <div class="title-area">
          <h1 class="title-main">${reportTitle}</h1>
          <div class="title-sub">${reportSubtitle}</div>
          <div class="title-date">Thời điểm chốt số liệu: ${nowFormatted}</div>
        </div>

        ${summaryCardsHtml}

        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 5%; text-align: center;">STT</th>
              <th style="width: 16%; text-align: left;">Mã vạch</th>
              <th style="text-align: left;">Tên sản phẩm</th>
              <th style="width: 10%; text-align: center;">ĐVT</th>
              ${tableHeaderQty}
              <th style="width: 12%; text-align: center;">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml || '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #64748b;">Không có sản phẩm nào phù hợp với bộ lọc</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="font-weight: 800; text-align: right; text-transform: uppercase; font-size: 8.5pt;">Tổng cộng:</td>
              ${tableFooterQty}
              <td></td>
            </tr>
          </tfoot>
        </table>

        <div class="signature-section">
          <div class="signature-box">
            <div class="sig-title">Người lập báo cáo</div>
            <div class="sig-sub">(Ký, ghi rõ họ tên)</div>
            <div class="sig-space"></div>
          </div>
          <div class="signature-box">
            <div class="sig-title">Thủ kho cơ sở</div>
            <div class="sig-sub">(Ký, ghi rõ họ tên)</div>
            <div class="sig-space"></div>
          </div>
          <div class="signature-box">
            <div class="sig-title">Quản lý duyệt</div>
            <div class="sig-sub">(Ký, đóng dấu nếu có)</div>
            <div class="sig-space"></div>
          </div>
        </div>
      </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl text-slate-900">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <FileDown className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-950">Xuất bản PDF Báo Cáo Tồn Kho</h2>
              <p className="text-xs text-slate-500">Tùy chọn cơ sở và xem trước báo cáo thống kê tồn kho thực tế trước khi xuất PDF/In.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Configuration Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white p-4">
          {/* Branch Selection Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mr-1">
              <Building2 className="h-4 w-4 text-blue-600" /> Cơ sở xuất:
            </span>
            <button
              type="button"
              onClick={() => setSelectedBranch('ALL')}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5 ${
                selectedBranch === 'ALL'
                  ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-300'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {selectedBranch === 'ALL' && <CheckCircle2 className="h-3.5 w-3.5" />}
              Cả 2 cơ sở (US & UK)
            </button>
            <button
              type="button"
              onClick={() => setSelectedBranch('US')}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5 ${
                selectedBranch === 'US'
                  ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-300'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {selectedBranch === 'US' && <CheckCircle2 className="h-3.5 w-3.5" />}
              Cơ sở US (Meditech)
            </button>
            <button
              type="button"
              onClick={() => setSelectedBranch('UK')}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5 ${
                selectedBranch === 'UK'
                  ? 'bg-violet-600 text-white shadow-sm ring-2 ring-violet-300'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {selectedBranch === 'UK' && <CheckCircle2 className="h-3.5 w-3.5" />}
              Cơ sở UK
            </button>
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyInStock}
                onChange={e => setOnlyInStock(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Chỉ hàng còn tồn (&gt; 0)
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm sản phẩm..."
                className="h-9 w-48 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-xs outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Live Preview Area */}
        <div className="flex-1 overflow-y-auto bg-slate-100 p-6">
          <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            
            {/* Header Document */}
            <div className="mb-6 flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wider text-blue-700">HỆ THỐNG QUẢN LÝ KHO DƯỢC VẬT TƯ</div>
                <div className="mt-0.5 text-xs text-slate-500">{reportSubtitle}</div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>Thời gian xuất: <b className="text-slate-800">{nowFormatted}</b></div>
                <div>Mẫu biểu: <b className="text-slate-700">BC-TK-01</b></div>
              </div>
            </div>

            {/* Title */}
            <div className="mb-6 text-center">
              <h1 className="text-xl font-extrabold uppercase tracking-tight text-slate-950">{reportTitle}</h1>
              <div className="mt-1 text-xs text-slate-500">Thời điểm chốt số liệu tồn thực tế: {nowFormatted}</div>
            </div>

            {/* KPI Summary Cards */}
            <div className="mb-6 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Số mặt hàng</div>
                <div className="mt-1 text-xl font-extrabold text-slate-900">{totals.count} <span className="text-xs font-normal text-slate-500">SP</span></div>
              </div>

              {(selectedBranch === 'ALL' || selectedBranch === 'US') && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Tồn cơ sở US</div>
                  <div className="mt-1 text-xl font-extrabold text-emerald-800">{totals.totalUs}</div>
                </div>
              )}

              {(selectedBranch === 'ALL' || selectedBranch === 'UK') && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-violet-700">Tồn cơ sở UK</div>
                  <div className="mt-1 text-xl font-extrabold text-violet-800">{totals.totalUk}</div>
                </div>
              )}

              {selectedBranch === 'ALL' && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Tổng toàn hệ thống</div>
                  <div className="mt-1 text-xl font-extrabold text-blue-900">{totals.totalQty}</div>
                </div>
              )}
            </div>

            {/* Preview Table */}
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2.5 text-center w-12">STT</th>
                    <th className="px-3 py-2.5">Mã vạch</th>
                    <th className="px-3 py-2.5">Tên sản phẩm</th>
                    <th className="px-3 py-2.5 text-center">ĐVT</th>
                    {(selectedBranch === 'ALL' || selectedBranch === 'US') && (
                      <th className="px-3 py-2.5 text-right text-emerald-700">Tồn US</th>
                    )}
                    {(selectedBranch === 'ALL' || selectedBranch === 'UK') && (
                      <th className="px-3 py-2.5 text-right text-violet-700">Tồn UK</th>
                    )}
                    {selectedBranch === 'ALL' && (
                      <th className="px-3 py-2.5 text-right text-blue-700">Tổng tồn</th>
                    )}
                    <th className="px-3 py-2.5 text-center">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportProducts.length ? (
                    reportProducts.map((p, idx) => {
                      const us = Number(p.stock_us) || 0;
                      const uk = Number(p.stock_uk) || 0;
                      const total = us + uk;
                      const activeQty = selectedBranch === 'US' ? us : selectedBranch === 'UK' ? uk : total;
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/80">
                          <td className="px-3 py-2 text-center text-slate-400">{idx + 1}</td>
                          <td className="px-3 py-2 font-mono text-slate-500">{p.barcode || '—'}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">{p.product_name}</td>
                          <td className="px-3 py-2 text-center text-slate-500">{p.base_unit || 'chiếc'}</td>
                          {(selectedBranch === 'ALL' || selectedBranch === 'US') && (
                            <td className="px-3 py-2 text-right font-bold text-emerald-700">{us}</td>
                          )}
                          {(selectedBranch === 'ALL' || selectedBranch === 'UK') && (
                            <td className="px-3 py-2 text-right font-bold text-violet-700">{uk}</td>
                          )}
                          {selectedBranch === 'ALL' && (
                            <td className="px-3 py-2 text-right font-extrabold text-blue-700">{total}</td>
                          )}
                          <td className="px-3 py-2 text-center">
                            {activeQty > 0 ? (
                              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Còn hàng</span>
                            ) : (
                              <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">Hết hàng</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400 font-medium">Không tìm thấy sản phẩm nào theo bộ lọc.</td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                  <tr>
                    <td colSpan={4} className="px-3 py-2.5 text-right uppercase text-slate-700">Tổng cộng:</td>
                    {(selectedBranch === 'ALL' || selectedBranch === 'US') && (
                      <td className="px-3 py-2.5 text-right text-emerald-700">{totals.totalUs}</td>
                    )}
                    {(selectedBranch === 'ALL' || selectedBranch === 'UK') && (
                      <td className="px-3 py-2.5 text-right text-violet-700">{totals.totalUk}</td>
                    )}
                    {selectedBranch === 'ALL' && (
                      <td className="px-3 py-2.5 text-right text-blue-800 text-sm">{totals.totalQty}</td>
                    )}
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Signatures Preview */}
            <div className="mt-8 flex justify-between px-4 text-center text-xs">
              <div>
                <div className="font-bold text-slate-900">Người lập báo cáo</div>
                <div className="text-slate-400 italic text-[11px]">(Ký, ghi rõ họ tên)</div>
              </div>
              <div>
                <div className="font-bold text-slate-900">Thủ kho cơ sở</div>
                <div className="text-slate-400 italic text-[11px]">(Ký, ghi rõ họ tên)</div>
              </div>
              <div>
                <div className="font-bold text-slate-900">Quản lý duyệt</div>
                <div className="text-slate-400 italic text-[11px]">(Ký, đóng dấu nếu có)</div>
              </div>
            </div>

          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          <div className="text-xs text-slate-500">
            Đang hiển thị <b>{reportProducts.length}</b> / {products.length} sản phẩm (Cơ sở: <b>{selectedBranch === 'ALL' ? 'US & UK' : selectedBranch}</b>).
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100 transition"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={reportProducts.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition"
            >
              <Printer className="h-4 w-4" />
              Lưu PDF / In báo cáo
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
