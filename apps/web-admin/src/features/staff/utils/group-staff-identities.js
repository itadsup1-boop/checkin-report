function identityKey(user) {
  const telegramId = String(user.telegram_id || '').trim();
  return telegramId ? `telegram:${telegramId}` : `employee:${user.id}`;
}

export function groupStaffIdentities(staff) {
  const identities = new Map();

  for (const user of staff) {
    const key = identityKey(user);
    if (!identities.has(key)) {
      identities.set(key, { ...user, identity_key: key, memberships: [] });
    }

    const identity = identities.get(key);
    const membership = {
      employee_id: user.id,
      role: user.role,
      group_name: user.group_name,
      telegram_group_id: user.telegram_group_id,
      selected_group_role: user.selected_group_role,
      membership_status: user.membership_status,
      membership_pause_reason: user.membership_pause_reason,
      need_report: user.need_report,
      current_kpi_target: user.current_kpi_target,
      is_exempt_checkin: user.is_exempt_checkin
    };
    const existingIndex = identity.memberships.findIndex(item => item.telegram_group_id === membership.telegram_group_id);
    if (existingIndex === -1) identity.memberships.push(membership);

    if (new Date(user.created_at || 0) < new Date(identity.created_at || 0)) {
      identity.created_at = user.created_at;
    }
  }

  return [...identities.values()].map(identity => ({
    ...identity,
    employee_ids: identity.memberships.map(item => item.employee_id),
    roles: [...new Set(identity.memberships.map(item => item.role).filter(Boolean))]
  }));
}
