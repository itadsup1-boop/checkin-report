import { useCallback, useEffect, useState } from 'react';
import { fetchEmployeeMonthlyOverview } from '../api/employee-profile-api.js';

export function useEmployeeMonthlyOverview({ employeeId, month, groupId }) {
  const [revision, setRevision] = useState(0);
  const requestKey = `${employeeId}:${month}:${groupId}:${revision}`;
  const [state, setState] = useState({ key: null, data: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    fetchEmployeeMonthlyOverview({ employeeId, month, groupId, signal: controller.signal })
      .then(data => setState({ key: requestKey, data, error: null }))
      .catch(error => {
        if (error.code === 'ERR_CANCELED') return;
        setState({
          key: requestKey,
          data: null,
          error: error.response?.data?.message || 'Không thể tải hồ sơ nhân viên.'
        });
      });
    return () => controller.abort();
  }, [employeeId, groupId, month, requestKey]);

  const refresh = useCallback(() => setRevision(value => value + 1), []);
  return { data: state.data, error: state.error, loading: state.key !== requestKey, refresh };
}
