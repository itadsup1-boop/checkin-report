import { createTelegramAutomationService } from './application/service.js';
import { createMtprotoGateway } from './infrastructure/mtproto-client.js';
import { createTelegramAutomationRepository } from './infrastructure/repository.js';
import { registerTelegramAutomationRoutes } from './interfaces/admin-routes.js';

export function registerTelegramGroupAutomation({ app, pool, requireSuperAdmin }) {
    const service = createTelegramAutomationService({ repository: createTelegramAutomationRepository(pool), gateway: createMtprotoGateway() });
    registerTelegramAutomationRoutes({ app, service, requireSuperAdmin });
    const timer = setInterval(() => service.runNext().catch(error => console.error('[Telegram Automation Worker]', error)), 3000);
    timer.unref();
    return service;
}
