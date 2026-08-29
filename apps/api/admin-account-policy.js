export const ADMIN_ROLES = Object.freeze({
    ADMIN: 'ADMIN',
    SUPER_ADMIN: 'SUPER_ADMIN',
    WAREHOUSE_ACCOUNTANT: 'WAREHOUSE_ACCOUNTANT'
});

export const WAREHOUSE_ACCOUNTANT_ROLE = ADMIN_ROLES.WAREHOUSE_ACCOUNTANT;

export function isValidAdminRole(role) {
    return Object.values(ADMIN_ROLES).includes(role);
}

export async function validateAssignedGroupsForRole({ pool, role, assignedGroups }) {
    const groupIds = [...new Set(
        (Array.isArray(assignedGroups) ? assignedGroups : [])
            .map(String)
            .map(value => value.trim())
            .filter(Boolean)
    )];

    if (role === ADMIN_ROLES.SUPER_ADMIN) return [];
    if (role !== ADMIN_ROLES.WAREHOUSE_ACCOUNTANT) return groupIds;
    if (!groupIds.length) {
        throw Object.assign(new Error('Tài khoản Kế toán kho phải được gán ít nhất một nhóm quản lý kho.'), {
            status: 400
        });
    }

    const result = await pool.query(
        `SELECT telegram_group_id
         FROM telegram_groups
         WHERE telegram_group_id = ANY($1::varchar[])
           AND bot_role = 'warehouse'
           AND is_active = TRUE
           AND COALESCE(is_deleted, FALSE) = FALSE`,
        [groupIds]
    );
    const validIds = new Set(result.rows.map(row => String(row.telegram_group_id)));
    if (groupIds.some(groupId => !validIds.has(groupId))) {
        throw Object.assign(new Error('Kế toán kho chỉ được gán vào các nhóm Telegram có vai trò Quản lý kho.'), {
            status: 400
        });
    }
    return groupIds;
}

