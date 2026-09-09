function MembershipBadge({ membership }) {
  return (
    <div className="flex min-h-[42px] min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
      <span className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-600">
        {membership.role || 'Chưa có vai trò'}
      </span>
      <span className="min-w-0 truncate text-[11px] text-slate-600" title={membership.group_name || membership.telegram_group_id}>
        {membership.group_name || membership.telegram_group_id || 'Chưa thuộc nhóm'}
      </span>
    </div>
  );
}

export default function StaffMembershipList({ memberships }) {
  return (
    <div className="space-y-1.5">
      {memberships.map(membership => (
        <MembershipBadge
          key={`${membership.employee_id}:${membership.telegram_group_id || 'none'}`}
          membership={membership}
        />
      ))}
    </div>
  );
}
