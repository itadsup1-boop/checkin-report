export const WAREHOUSE_BRANCHES = Object.freeze(['US', 'UK']);

export const WAREHOUSE_PERMISSIONS = Object.freeze([
    'APPROVE_EXPORT',
    'AUTO_APPROVE_OWN_ORDER',
    'APPROVE_TRANSFER',
    'MANAGE_TEMPLATES',
    'MANAGE_PRODUCTS',
    'ADJUST_INVENTORY',
    'VIEW_REPORTS'
]);

export const WAREHOUSE_ORDER_STATUSES = Object.freeze({
    DRAFT: 'DRAFT',
    PENDING: 'PENDING_APPROVAL',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    REVERSED: 'REVERSED'
});

export class WarehouseError extends Error {
    constructor(message, { status = 400, code = 'WAREHOUSE_ERROR', details = null } = {}) {
        super(message);
        this.name = 'WarehouseError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
