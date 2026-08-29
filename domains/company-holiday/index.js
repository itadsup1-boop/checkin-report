import { createCompanyHolidayRepository } from './infrastructure/company-holiday-repository.js';
import { createCompanyHolidayService } from './application/company-holiday-service.js';
import { registerCompanyHolidayAdminRoutes } from './interfaces/admin-routes.js';
import { registerHolidayAnnouncementCron } from './interfaces/holiday-announcement-cron.js';

export function createCompanyHolidayModule({ pool }) {
    const repository = createCompanyHolidayRepository({ pool });
    const service = createCompanyHolidayService({ repository });
    return { repository, service, isCompanyHoliday: date => service.isHoliday(date) };
}

export function registerCompanyHolidayAdminModule({ app, pool, requireSuperAdmin }) {
    const module = createCompanyHolidayModule({ pool });
    registerCompanyHolidayAdminRoutes({ app, service: module.service, requireSuperAdmin });
    return module;
}

export function registerCompanyHolidayBotModule({ pool, cron, bot, moment }) {
    const module = createCompanyHolidayModule({ pool });
    module.scheduledJob = registerHolidayAnnouncementCron({ cron, repository: module.repository, bot, moment });
    return module;
}

export { buildHolidayAnnouncement, validateHolidayInput } from './domain/holiday-policy.js';
