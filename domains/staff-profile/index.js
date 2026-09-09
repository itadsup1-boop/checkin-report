import { createGetEmployeeMonthlyOverview } from './application/get-employee-monthly-overview.js';
import { createEmployeeProfileRepository } from './infrastructure/postgres/employee-profile-repository.js';
import { registerEmployeeProfileRoutes } from './interfaces/admin-api/employee-profile-routes.js';

export function registerStaffProfileModule({ app, pool, getAdminAuthContext }) {
    const repository = createEmployeeProfileRepository({ pool });
    const getOverview = createGetEmployeeMonthlyOverview({ repository });
    registerEmployeeProfileRoutes({ app, getOverview, getAdminAuthContext });
    return Object.freeze({ getOverview });
}
