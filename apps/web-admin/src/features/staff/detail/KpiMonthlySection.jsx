import { formatMoney, formatTime } from '../utils/employee-month-status.js';

export default function KpiMonthlySection({ kpi }) {
  if (!kpi.enabled) {
    return <section className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-sm">Nhân viên không nằm trong lịch báo cáo KPI của nhóm đang xem.</section>;
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-bold text-slate-900">Chi tiết báo cáo KPI</h3><p className="mt-1 text-xs text-slate-500">Mỗi ngày và mỗi nhóm chỉ tính bản cập nhật mới nhất.</p></div>
      {kpi.reports.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-500">Chưa có báo cáo KPI trong tháng này.</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-5 py-3">Ngày</th><th className="px-4 py-3">Nhóm</th><th className="px-4 py-3">KPI</th><th className="px-4 py-3">Hoàn thành</th><th className="px-4 py-3">Doanh thu</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Giờ nộp</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{kpi.reports.map(report => {
            const target = Number(report.kpi_required || 0);
            const actual = Number(report.kpi_actual || 0);
            const rate = target > 0 ? Math.round(actual / target * 100) : 0;
            const group = kpi.groups.find(item => item.telegram_group_id === report.telegram_group_id);
            return <tr key={report.id} className="hover:bg-slate-50"><td className="px-5 py-3 font-semibold text-slate-800">{report.report_date.split('-').reverse().join('/')}</td><td className="px-4 py-3 text-slate-500">{group?.group_name || report.telegram_group_id}</td><td className="px-4 py-3 font-bold text-slate-800">{actual}/{target}</td><td className={`px-4 py-3 font-semibold ${actual >= target ? 'text-emerald-600' : 'text-amber-600'}`}>{rate}%</td><td className="px-4 py-3">{formatMoney(report.metadata?.doanh_thu)}</td><td className="px-4 py-3">{report.status || 'Đã báo cáo'}</td><td className="px-4 py-3 text-slate-500">{formatTime(report.submitted_at)}</td></tr>;
          })}</tbody></table></div>
      )}
    </section>
  );
}
