/**
 * Use case: Tổng kết toàn đội Telesale cuối ngày (lúc 19:00).
 */

import { buildTelesaleDailyTeamSummary, buildTelesaleWarningSummaryMessage } from '../domain/telesale-messages.js';
import { TELESALE_THRESHOLDS } from '../domain/telesale-rules.js';

export function createSummarizeDailyTelesale({
    telesaleRepository,
    bot,
    now = () => new Date()
}) {
    return async function summarizeDailyTelesale(targetGroupId = null, customSummaryFields = null) {
        try {
            const currentDate = now();
            const vnDateObj = new Date(currentDate.getTime() + 7 * 3600 * 1000);
            const dateStr = vnDateObj.toISOString().split('T')[0];
            const dParts = dateStr.split('-');
            const displayDate = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}/${dParts[0]}` : dateStr;

            const groups = await telesaleRepository.findActiveTelesaleGroups();
            if (!groups || groups.length === 0) return;

            const targetGroups = targetGroupId
                ? groups.filter(g => String(g.telegram_group_id) === String(targetGroupId))
                : groups;

            if (targetGroups.length === 0) return;

            for (const g of targetGroups) {
                const groupId = g.telegram_group_id;

                let config = null;
                if (typeof telesaleRepository.getFormConfig === 'function') {
                    try {
                        config = await telesaleRepository.getFormConfig(groupId);
                        if (config?.schedule_settings?.summary_enabled === false) {
                            continue;
                        }
                    } catch (e) {
                        // ignore config error
                    }
                }

                const summaryRes = await telesaleRepository.getDailyGroupSummary(groupId, dateStr);
                const reports = summaryRes?.reports || [];
                const totals = summaryRes?.totals || {};
                const dynamicTotals = summaryRes?.dynamicTotals || {};

                if (!reports || reports.length === 0) continue;

                const memberSummaries = reports.map(r => ({
                    name: r.full_name || r.employee_name || 'Nhân sự',
                    so_nhan: r.so_nhan,
                    tong_vang: r.so_trung_knc_vang ?? 0,
                    tong_lich: r.tong_lich,
                    tong_toi: r.tong_toi_hnay,
                    lich_ngay_mai: r.lich_ngay_mai,
                    tong_ds_hnay: r.tong_ds_hnay
                }));

                const sheetId = g.customer_sheet_id || '1gQYXoylEysKKqUpYMxAzLw1nA7KC89eC-FO4kSzhlYU';
                const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

                const summaryFields = customSummaryFields || config?.schedule_settings?.summary_fields || null;

                const summaryMsg = buildTelesaleDailyTeamSummary({
                    dateStr: displayDate,
                    teamTotals: totals,
                    memberSummaries,
                    sheetUrl,
                    dynamicFields: config?.fields || null,
                    summaryFields,
                    dynamicTotals
                });

                const summaryDedupKey = `summary:${groupId}:${dateStr}`;
                let canSendSummary = true;
                if (typeof telesaleRepository.acquireNotificationLock === 'function') {
                    const acquired = await telesaleRepository.acquireNotificationLock(summaryDedupKey);
                    if (!acquired) {
                        canSendSummary = false;
                        console.log(`[Telesale] Tổng kết ngày nhóm ${groupId} ngày ${dateStr} đã được gửi bởi tiến trình khác, bỏ qua.`);
                    }
                }

                if (canSendSummary) {
                    await bot.telegram.sendMessage(groupId, summaryMsg, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    }).catch(err => {
                        console.error(`[Telesale] Lỗi gửi tổng kết ngày nhóm ${groupId}:`, err.message);
                    });
                }

                // Thống kê hiệu suất: Khen thưởng Tới (> 19%), Cảnh báo Lịch (< 25%), Cảnh báo Tới (< 15%)
                const toiRewards = [];
                const lichWarnings = [];
                const toiWarnings = [];

                for (const r of reports) {
                    const name = r.full_name || r.employee_name || 'Nhân sự';
                    const soNhan = Number(r.so_nhan || 0);
                    const tongLich = Number(r.tong_lich || 0);
                    const tongToi = Number(r.tong_toi_hnay || 0);
                    const tyLeLich = soNhan > 0 ? Number(((tongLich / soNhan) * 100).toFixed(1)) : 0;
                    const tyLeToi = soNhan > 0 ? Number(((tongToi / soNhan) * 100).toFixed(1)) : 0;

                    if (soNhan > 0 && tyLeToi > TELESALE_THRESHOLDS.TOI_REWARD_PERCENT) {
                        toiRewards.push({
                            name,
                            so_nhan: soNhan,
                            tong_toi: tongToi,
                            ty_le_toi: tyLeToi
                        });
                    }

                    if (soNhan > 0 && tyLeLich < TELESALE_THRESHOLDS.LICH_WARNING_PERCENT) {
                        lichWarnings.push({
                            name,
                            so_nhan: soNhan,
                            tong_lich: tongLich,
                            ty_le_lich: tyLeLich
                        });
                    }

                    if (soNhan > 0 && tyLeToi < TELESALE_THRESHOLDS.TOI_WARNING_PERCENT) {
                        toiWarnings.push({
                            name,
                            so_nhan: soNhan,
                            tong_toi: tongToi,
                            ty_le_toi: tyLeToi
                        });
                    }
                }

                const warningMsg = buildTelesaleWarningSummaryMessage({
                    dateStr: displayDate,
                    lichWarnings,
                    toiWarnings,
                    toiRewards
                });

                if (warningMsg) {
                    const warningDedupKey = `warning:${groupId}:${dateStr}`;
                    let canSendWarning = true;
                    if (typeof telesaleRepository.acquireNotificationLock === 'function') {
                        const acquired = await telesaleRepository.acquireNotificationLock(warningDedupKey);
                        if (!acquired) {
                            canSendWarning = false;
                            console.log(`[Telesale] Cảnh báo hiệu suất nhóm ${groupId} ngày ${dateStr} đã được gửi bởi tiến trình khác, bỏ qua.`);
                        }
                    }

                    if (canSendWarning) {
                        await bot.telegram.sendMessage(groupId, warningMsg, {
                            parse_mode: 'HTML',
                            disable_web_page_preview: true
                        }).catch(err => {
                            console.error(`[Telesale] Lỗi gửi cảnh báo hiệu suất nhóm ${groupId}:`, err.message);
                        });
                    }
                }
            }
        } catch (err) {
            console.error('[Telesale] Lỗi tiến trình tổng kết ngày 19:00:', err.message || err);
        }
    };
}
