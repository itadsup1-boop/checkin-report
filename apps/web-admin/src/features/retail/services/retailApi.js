import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function authHeader() {
  const token = localStorage.getItem('admin_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const retailApi = {
  /**
   * Lấy danh sách nhóm retail_checkin được phép quản lý
   */
  async getRetailGroups() {
    const response = await axios.get(`${API_URL}/admin/retail/groups`, {
      headers: authHeader()
    });
    return response.data?.groups || [];
  },

  /**
   * Lấy tổng quan và tiến độ hôm nay của các thành viên trong nhóm
   */
  async getOverview({ groupId, date }) {
    const params = new URLSearchParams();
    if (groupId && groupId !== 'ALL') params.set('group_id', groupId);
    if (date) params.set('date', date);

    const response = await axios.get(`${API_URL}/admin/retail/overview?${params.toString()}`, {
      headers: authHeader()
    });
    return response.data;
  },

  /**
   * Lấy tổng quan và tiến độ cả tháng của các thành viên trong nhóm
   */
  async getMonthlyOverview({ groupId, month }) {
    const params = new URLSearchParams();
    if (groupId && groupId !== 'ALL') params.set('group_id', groupId);
    if (month) params.set('month', month);

    const response = await axios.get(`${API_URL}/admin/retail/monthly-overview?${params.toString()}`, {
      headers: authHeader()
    });
    return response.data;
  },

  /**
   * Lấy lịch sử đi tuyến và chi tiết từng điểm bán của 1 nhân viên
   */
  async getMemberHistory(employeeId, { groupId, month } = {}) {
    const params = new URLSearchParams();
    if (groupId) params.set('group_id', groupId);
    if (month) params.set('month', month);

    const response = await axios.get(
      `${API_URL}/admin/retail/employees/${employeeId}/history?${params.toString()}`,
      { headers: authHeader() }
    );
    return response.data;
  },

  /**
   * Cập nhật hoặc đặt lại chỉ tiêu KPI riêng cho thành viên
   */
  async updateMemberKpi(employeeId, { telegramGroupId, dailyKpiTarget }) {
    const response = await axios.put(
      `${API_URL}/admin/retail/employees/${employeeId}/kpi`,
      {
        telegram_group_id: telegramGroupId,
        daily_kpi_target: dailyKpiTarget
      },
      { headers: authHeader() }
    );
    return response.data;
  }
};
