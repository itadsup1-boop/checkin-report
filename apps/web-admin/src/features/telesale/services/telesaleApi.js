import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function authHeader() {
  const token = localStorage.getItem('admin_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const telesaleApi = {
  /**
   * Lấy danh sách nhóm Telesale
   */
  async getGroups() {
    const response = await axios.get(`${API_URL}/admin/telesale/groups`, {
      headers: authHeader()
    });
    return response.data?.groups || [];
  },

  /**
   * Lấy danh sách thành viên Telesale & trạng thái đấu nối điểm danh
   */
  async getMappings({ groupId, date } = {}) {
    const params = new URLSearchParams();
    if (groupId && groupId !== 'ALL') params.set('groupId', groupId);
    if (date) params.set('date', date);

    const response = await axios.get(`${API_URL}/admin/telesale/mappings?${params.toString()}`, {
      headers: authHeader()
    });
    return response.data;
  },

  /**
   * Cập nhật đấu nối tài khoản thủ công cho 1 nhân sự
   */
  async updateMapping({ telegramGroupId, employeeId, linkedEmployeeId, notes = '' }) {
    const response = await axios.put(`${API_URL}/admin/telesale/mappings`, {
      telegramGroupId,
      employeeId,
      linkedEmployeeId,
      notes
    }, {
      headers: authHeader()
    });
    return response.data;
  },

  /**
   * Tự động khớp đấu nối theo tên trùng hoặc gần giống
   */
  async autoMatch({ telegramGroupId }) {
    const response = await axios.post(`${API_URL}/admin/telesale/auto-match`, {
      telegramGroupId
    }, {
      headers: authHeader()
    });
    return response.data;
  },

  /**
   * Gửi tin nhắn nhắc nhở nộp báo cáo thủ công lên nhóm Telesale
   */
  async sendReminder({ telegramGroupId }) {
    const response = await axios.post(`${API_URL}/admin/telesale/send-reminder`, {
      telegramGroupId
    }, {
      headers: authHeader()
    });
    return response.data;
  }
};
