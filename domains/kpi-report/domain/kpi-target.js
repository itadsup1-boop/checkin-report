/**
 * Chỉ tiêu KPI thực dùng cho một nhân viên: 0 nếu được miễn báo cáo, ngược lại
 * chỉ tiêu riêng của họ trong nhóm hoặc mức mặc định.
 *
 * Thuần — không pg/express/telegraf.
 */
export function getEffectiveKpiTarget(user, fallback = 40) {
    if (!user || user.need_report === false) return 0;
    if (user.current_kpi_target === null || user.current_kpi_target === undefined || user.current_kpi_target === '') {
        return fallback;
    }
    const target = Number(user.current_kpi_target);
    return Number.isFinite(target) && target > 0 ? target : 0;
}
