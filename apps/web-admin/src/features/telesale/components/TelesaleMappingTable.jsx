import { useState, useMemo } from 'react';
import {
  Search,
  Link2,
  Unlink,
  Check,
  CheckCircle2,
  AlertCircle,
  Clock,
  Coffee,
  Sparkles,
  HelpCircle
} from 'lucide-react';

export default function TelesaleMappingTable({
  members = [],
  availableEmployees = [],
  onUpdateMapping,
  updatingId = null
}) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL'); // 'ALL' | 'UNLINKED' | 'LINKED' | 'WORKED' | 'PENDING'
  const [selectedMapping, setSelectedMapping] = useState({}); // { [employeeId]: linkedEmployeeId }

  // Lọc dữ liệu hiển thị
  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      // Tìm kiếm theo tên hoặc tên liên kết
      const q = search.trim().toLowerCase();
      const matchSearch = !q ||
        (m.full_name && m.full_name.toLowerCase().includes(q)) ||
        (m.linked_employee_name && m.linked_employee_name.toLowerCase().includes(q)) ||
        (m.linked_group_name && m.linked_group_name.toLowerCase().includes(q));

      if (!matchSearch) return false;

      if (filterType === 'UNLINKED') return !m.linked_employee_id;
      if (filterType === 'LINKED') return Boolean(m.linked_employee_id);
      if (filterType === 'WORKED') return Boolean(m.attendance?.workedToday);
      if (filterType === 'PENDING') return Boolean(m.attendance?.workedToday) && !m.hasReportedToday;

      return true;
    });
  }, [members, search, filterType]);

  const handleSelectChange = (employeeId, newLinkedEmployeeId) => {
    setSelectedMapping(prev => ({
      ...prev,
      [employeeId]: newLinkedEmployeeId
    }));
  };

  const handleSave = async (member) => {
    const currentVal = selectedMapping[member.employee_id] !== undefined
      ? selectedMapping[member.employee_id]
      : (member.linked_employee_id || '');

    await onUpdateMapping({
      employeeId: member.employee_id,
      linkedEmployeeId: currentVal || null
    });
  };

  const handleUnlink = async (member) => {
    if (!window.confirm(`Bạn có chắc muốn hủy đấu nối tài khoản của "${member.full_name}"?`)) return;
    setSelectedMapping(prev => ({
      ...prev,
      [member.employee_id]: ''
    }));
    await onUpdateMapping({
      employeeId: member.employee_id,
      linkedEmployeeId: null
    });
  };

  const handleAutoSuggestRow = async (member) => {
    const cleanName = (member.full_name || '').trim().toLowerCase();
    const match = availableEmployees.find(e => {
      const eName = (e.full_name || '').trim().toLowerCase();
      return eName === cleanName || eName.endsWith(' ' + cleanName);
    });

    if (match) {
      setSelectedMapping(prev => ({
        ...prev,
        [member.employee_id]: match.id
      }));
      await onUpdateMapping({
        employeeId: member.employee_id,
        linkedEmployeeId: match.id,
        notes: 'Khớp nhanh tự động theo tên'
      });
    } else {
      alert(`Không tìm thấy nhân sự điểm danh có tên gần giống "${member.full_name}".`);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm kiếm nhân sự telesale..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => setFilterType('ALL')}
            className={`rounded-lg px-3 py-1.5 transition ${
              filterType === 'ALL'
                ? 'bg-slate-900 text-white font-semibold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Tất cả ({members.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('UNLINKED')}
            className={`rounded-lg px-3 py-1.5 transition ${
              filterType === 'UNLINKED'
                ? 'bg-amber-600 text-white font-semibold'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            Chưa đấu nối ({members.filter(m => !m.linked_employee_id).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('WORKED')}
            className={`rounded-lg px-3 py-1.5 transition ${
              filterType === 'WORKED'
                ? 'bg-emerald-600 text-white font-semibold'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Đi làm hôm nay ({members.filter(m => m.attendance?.workedToday).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('PENDING')}
            className={`rounded-lg px-3 py-1.5 transition ${
              filterType === 'PENDING'
                ? 'bg-rose-600 text-white font-semibold'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            Chưa nộp báo cáo ({members.filter(m => m.attendance?.workedToday && !m.hasReportedToday).length})
          </button>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-3.5 pl-4 pr-3 sm:pl-6">Nhân sự Báo Cáo Telesale</th>
              <th className="px-3 py-3.5">Tài Khoản Điểm Danh Cá Nhân (Đấu nối)</th>
              <th className="px-3 py-3.5">Hôm nay có đi làm không?</th>
              <th className="px-3 py-3.5">Báo cáo hôm nay</th>
              <th className="py-3.5 pl-3 pr-4 text-right sm:pr-6">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan="5" className="py-12 text-center text-sm text-slate-400">
                  Không tìm thấy nhân sự phù hợp với điều kiện tìm kiếm.
                </td>
              </tr>
            ) : (
              filteredMembers.map(m => {
                const currentSelected = selectedMapping[m.employee_id] !== undefined
                  ? selectedMapping[m.employee_id]
                  : (m.linked_employee_id || '');

                const hasChanged = selectedMapping[m.employee_id] !== undefined &&
                  selectedMapping[m.employee_id] !== (m.linked_employee_id || '');

                const isRowUpdating = updatingId === m.employee_id;
                const attendance = m.attendance || {};

                return (
                  <tr key={m.employee_id} className="hover:bg-slate-50/60 transition">
                    {/* Cột 1: Tên Telesale */}
                    <td className="py-4 pl-4 pr-3 sm:pl-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-xs font-bold text-white shadow-2xs">
                          {m.full_name ? m.full_name.slice(0, 2).toUpperCase() : 'TL'}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">{m.full_name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                              Telesale
                            </span>
                            {m.telegram_id && (
                              <span className="text-[11px] text-slate-400">
                                TG: {m.telegram_id}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Cột 2: Tài khoản điểm danh cá nhân (Dropdown) */}
                    <td className="px-3 py-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <select
                            value={currentSelected}
                            onChange={e => handleSelectChange(m.employee_id, e.target.value)}
                            disabled={isRowUpdating}
                            className={`w-full max-w-xs rounded-xl border px-3 py-2 text-xs font-medium outline-none transition ${
                              currentSelected
                                ? 'border-indigo-200 bg-indigo-50/30 text-indigo-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'
                                : 'border-dashed border-amber-300 bg-amber-50/30 text-amber-900 focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                            }`}
                          >
                            <option value="">-- Chưa đấu nối tài khoản điểm danh --</option>
                            {availableEmployees.map(emp => (
                              <option key={emp.id} value={emp.id}>
                                {emp.full_name} {emp.telegram_id ? `(${emp.telegram_id})` : ''} - [{emp.group_name || 'Hệ thống'}]
                              </option>
                            ))}
                          </select>

                          {m.linked_employee_id && (
                            <button
                              type="button"
                              onClick={() => handleUnlink(m)}
                              disabled={isRowUpdating}
                              title="Hủy đấu nối"
                              className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                            >
                              <Unlink className="h-4 w-4" />
                            </button>
                          )}

                          {!m.linked_employee_id && (
                            <button
                              type="button"
                              onClick={() => handleAutoSuggestRow(m)}
                              disabled={isRowUpdating}
                              title="Khớp nhanh theo tên"
                              className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-1.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-100 transition shrink-0"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              Khớp tên
                            </button>
                          )}
                        </div>

                        {m.linked_employee_id ? (
                          <p className="text-[11px] text-slate-500 flex items-center gap-1">
                            <Link2 className="h-3 w-3 text-indigo-500" />
                            <span>Đã nối: <b>{m.linked_employee_name}</b> {m.linked_group_name ? `(${m.linked_group_name})` : ''}</span>
                          </p>
                        ) : (
                          <p className="text-[11px] text-amber-600 flex items-center gap-1">
                            <HelpCircle className="h-3 w-3" />
                            <span>Chưa liên kết. Hệ thống sẽ không kiểm tra được lịch đi làm.</span>
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Cột 3: Trạng thái đi làm hôm nay */}
                    <td className="px-3 py-4">
                      {!m.linked_employee_id ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                          <HelpCircle className="h-3.5 w-3.5" />
                          Chưa đấu nối
                        </span>
                      ) : attendance.workedToday ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            Đã check-in ({attendance.checkInTime?.slice(0, 5)})
                          </span>
                          <p className="text-[11px] text-slate-400">
                            Hôm nay có đi làm 🟢
                          </p>
                        </div>
                      ) : attendance.isOff || attendance.isOnLeave ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 border border-purple-200">
                            <Coffee className="h-3.5 w-3.5 text-purple-600" />
                            {attendance.isOnLeave ? 'Nghỉ phép' : 'Lịch ca OFF'}
                          </span>
                          <p className="text-[11px] text-slate-400">
                            Miễn báo cáo &amp; miễn phạt
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                            <Clock className="h-3.5 w-3.5 text-slate-400" />
                            Chưa check-in
                          </span>
                          <p className="text-[11px] text-slate-400">
                            Hôm nay không đi làm ⚪
                          </p>
                        </div>
                      )}
                    </td>

                    {/* Cột 4: Báo cáo Telesale hôm nay */}
                    <td className="px-3 py-4">
                      {m.hasReportedToday ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 border border-teal-200">
                            <Check className="h-3.5 w-3.5 text-teal-600" />
                            Đã nộp báo cáo
                          </span>
                          {m.reportData && (
                            <p className="text-[11px] text-slate-500">
                              DS: <b>{new Intl.NumberFormat('vi-VN').format(m.reportData.tong_ds_hnay)}đ</b> | {m.reportData.tong_lich} lịch
                            </p>
                          )}
                        </div>
                      ) : attendance.workedToday ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 border border-rose-200">
                            <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
                            Chưa nộp (Cần nhắc)
                          </span>
                          <p className="text-[11px] text-rose-600 font-medium">
                            Quá 19:00 sẽ bị phạt 50k
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-400">
                            Miễn nộp
                          </span>
                          <p className="text-[11px] text-slate-400">
                            Không đi làm hôm nay
                          </p>
                        </div>
                      )}
                    </td>

                    {/* Cột 5: Thao tác */}
                    <td className="py-4 pl-3 pr-4 text-right sm:pr-6">
                      <div className="flex items-center justify-end gap-2">
                        {hasChanged ? (
                          <button
                            type="button"
                            onClick={() => handleSave(m)}
                            disabled={isRowUpdating}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-blue-700 active:scale-95 transition"
                          >
                            {isRowUpdating ? 'Đang lưu...' : 'Lưu đấu nối'}
                          </button>
                        ) : m.linked_employee_id ? (
                          <span className="text-xs text-slate-400 font-medium">
                            Đã lưu
                          </span>
                        ) : (
                          <span className="text-xs text-amber-500 font-medium">
                            Chưa lưu
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
