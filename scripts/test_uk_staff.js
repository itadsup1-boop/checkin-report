import 'dotenv/config';
import pool from '../packages/database/index.js';
import { createSundayReminderRepository } from '../domains/timekeep/infrastructure/postgres/sunday-reminder-repository.js';

async function main() {
    const tgid = '-4233999474';
    const repo = createSundayReminderRepository({ pool });

    const staff = await repo.findUnregisteredStaff(tgid, '2026-09-28', '2026-10-04');
    console.log('Unregistered staff for UK:');
    console.table(staff);

    process.exit(0);
}

main().catch(console.error);
