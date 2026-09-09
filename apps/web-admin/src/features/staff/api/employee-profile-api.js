import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export async function fetchEmployeeMonthlyOverview({ employeeId, month, groupId, signal }) {
  const params = { month };
  if (groupId && groupId !== 'ALL') params.group_id = groupId;
  const token = localStorage.getItem('admin_token');
  const response = await axios.get(`${API_URL}/admin/employees/${encodeURIComponent(employeeId)}/monthly-overview`, {
    params,
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return response.data;
}
