export const ORIGINAL_DEFAULT_FIELDS = [
  { key: 'so_nhan', label: 'Số data nhận', type: 'number', category: 'INPUT', default: 0, required: true, is_monthly_cumulative: false, is_hidden: false, order_index: 1 },
  { key: 'so_trung_knc_vang', label: 'Số trùng / KNC / Văng', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 2 },
  { key: 'lich_pv_moi', label: 'Số lịch PV mới', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 3 },
  { key: 'lich_pv_cu', label: 'Số lịch PV cũ', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 4 },
  { key: 'lich_ngay_mai', label: 'Lịch hẹn ngày mai', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 5 },
  { key: 'tong_toi_hnay', label: 'Tổng tới hôm nay', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 6 },
  { key: 'tong_bong_hnay', label: 'Tổng bong hôm nay', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 7 },
  { key: 'tong_ds_hnay', label: 'TỔNG DS hôm nay', type: 'currency', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 8 },
  { key: 'tong_lich', label: 'Tổng lịch cộng dồn', type: 'number', category: 'CALCULATED', formula: '{lich_pv_moi} + {lich_pv_cu}', is_monthly_cumulative: false, is_hidden: false, order_index: 9 },
  { key: 'tong_ds_thang', label: 'Tổng DS cộng dồn tháng', type: 'currency', category: 'CALCULATED', formula: '{tong_ds_hnay}', is_monthly_cumulative: true, is_hidden: false, order_index: 10 },
  { key: 'tong_toi', label: 'Tổng khách tới cộng dồn', type: 'number', category: 'CALCULATED', formula: '{tong_toi_hnay}', is_monthly_cumulative: false, is_hidden: false, order_index: 11 },
  { key: 'ty_le_khach_toi_ds', label: 'Tỷ lệ khách tới / Doanh số', type: 'currency', category: 'CALCULATED', formula: '{tong_ds_hnay} / {tong_toi_hnay}', is_monthly_cumulative: false, is_hidden: false, order_index: 12 },
  { key: 'ty_le_lich', label: 'Tỷ lệ lịch cộng dồn', type: 'percentage', category: 'CALCULATED', formula: '({tong_lich} / {so_nhan}) * 100', is_monthly_cumulative: false, is_hidden: false, order_index: 13, thresholds: [
    { operator: '<', value: 25, badge: '⚠️ (Cảnh báo < 25%)', type: 'warning' }
  ]},
  { key: 'ty_le_toi', label: 'Tỉ lệ tới cộng dồn', type: 'percentage', category: 'CALCULATED', formula: '({tong_toi} / {so_nhan}) * 100', is_monthly_cumulative: false, is_hidden: false, order_index: 14, thresholds: [
    { operator: '>=', value: 19, badge: '🌟 (Khen thưởng > 19%)', type: 'reward' },
    { operator: '<', value: 15, badge: '⚠️ (Cảnh báo < 15%)', type: 'warning' }
  ]}
];

export const DEFAULT_SUMMARY_FIELDS = [
  'so_nhan',
  'so_trung_knc_vang',
  'tong_lich',
  'tong_toi',
  'tong_ds_hnay',
  'tong_ds_thang',
  'ty_le_lich',
  'ty_le_toi'
];

export const DEFAULT_ADS_FIELDS = [
  { key: 'noi_dung', label: 'Nội dung', type: 'text', category: 'INPUT', default: '', required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 1 },
  { key: 'tong_chi_tieu', label: 'Tổng chi tiêu', type: 'currency', category: 'INPUT', default: 0, required: true, is_monthly_cumulative: false, is_hidden: false, order_index: 2 },
  { key: 'tong_mess', label: 'Tổng Mess', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 3 },
  { key: 'tong_so', label: 'Tổng số (SĐT)', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 4 },
  { key: 'tong_ds', label: 'Tổng Doanh số', type: 'currency', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 5 },
  { key: 'tong_ds_cong_don', label: 'Tổng DS cộng dồn', type: 'currency', category: 'CALCULATED', formula: '{tong_ds}', is_hourly_cumulative: true, is_hidden: false, order_index: 6 },
  { key: 'tong_chi_tieu_cong_don', label: 'Tổng chi tiêu cộng dồn', type: 'currency', category: 'CALCULATED', formula: '{tong_chi_tieu}', is_hourly_cumulative: true, is_hidden: false, order_index: 7 },
  { key: 'ty_le_ads_cong_don', label: '% Ads cộng dồn', type: 'percentage', category: 'CALCULATED', formula: '({tong_chi_tieu_cong_don} / {tong_ds_cong_don}) * 100', is_hidden: false, order_index: 8, thresholds: [
    { operator: '>=', value: 30, badge: '⚠️ (Chi phí cao >= 30%)', type: 'warning' },
    { operator: '<=', value: 15, badge: '🌟 (Hiệu quả <= 15%)', type: 'reward' }
  ]},
  { key: 'ghi_chu', label: 'Ghi chú / Vấn đề cần xử lý', type: 'text', category: 'INPUT', default: '', required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 9 }
];

export const DEFAULT_FEATURES = {
  has_projects: false,
  has_services: false,
  schedule_mode: 'SINGLE_SLOT', // 'SINGLE_SLOT' | 'MULTI_SLOT'
  summary_template: 'BY_EMPLOYEE', // 'BY_EMPLOYEE' | 'BY_SERVICE'
  cumulative_mode: 'MONTHLY' // 'MONTHLY' | 'HOURLY' | 'BOTH'
};

export const DEFAULT_MULTI_SLOTS = [
  { id: '09h', label: '09h', remind_time: '08:45', deadline_time: '09:00', late_remind_time: '10:00', summary_time: '09:01', penalty_amount: 50000 },
  { id: '12h', label: '12h', remind_time: '11:45', deadline_time: '12:00', late_remind_time: '13:00', summary_time: '12:01', penalty_amount: 50000 },
  { id: '18h', label: '18h', remind_time: '17:45', deadline_time: '18:00', late_remind_time: '19:00', summary_time: '18:01', penalty_amount: 50000 }
];

export function calculateLateRemindTime(timeStr, hoursToAdd = 1) {
  if (!timeStr) return '10:00';
  const clean = String(timeStr).trim();
  let [h, m] = clean.includes(':')
    ? clean.split(':').map(Number)
    : [parseInt(clean.replace(/\D/g, ''), 10), 0];
  if (isNaN(h)) return '10:00';
  if (isNaN(m)) m = 0;
  const newH = (h + hoursToAdd) % 24;
  return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

