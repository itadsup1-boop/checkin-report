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
