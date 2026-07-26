# AGENTS.md — telegramReport

## What this is

Telegram bot system for KPI reporting and employee timekeeping (cham cong). Vietnamese-language codebase. Three services share one PostgreSQL database (`telegram_kpi`).

## Architecture

```
apps/api/index.js       Express API + serves web-admin SPA (port 3000/3001)
apps/bot/timekeep_bot.js  Telegraf bot + Mini App HTTP server (port 3002)
apps/bot/index.js        Legacy KPI report bot (separate from timekeep_bot)
apps/web-admin/          React/Vite frontend, built into dist/ then served by API
packages/database/       pg Pool singleton + raw SQL schemas
packages/shared/         Logger with file rotation
```

The API server **proxies** many routes (`/api/bot/*`, `/api/schedules`, `/api/photo-debts`, `/api/upload-proof`, `/api/timekeep`, `/api/admin/schedules`, `/api/admin/dashboard`, `/api/export`) to the bot server on port 3002. When adding new endpoints, decide whether they belong on the API or the bot — the bot handles Telegram-specific logic (auth via initData, video uploads, Telegraf context).

## Dev commands

```bash
# Run both API + Bot together (requires PORT 3002 free for bot)
npm run dev

# Individual
npm run dev:api          # node apps/api/index.js
npm run dev:bot          # node apps/bot/timekeep_bot.js

# Web admin (separate Vite dev server)
cd apps/web-admin && npm run dev     # Vite on :5173
cd apps/web-admin && npm run build   # output → dist/
```

## Production (PM2 + Cloudflare)

```bash
# Windows (recommended entry point)
.\scripts\windows\start.ps1            # Full start
.\scripts\windows\start.ps1 -Restart   # PM2 restart only
.\scripts\windows\start.ps1 -Stop      # Stop everything

# Linux
bash scripts/install.sh    # First-time setup
bash scripts/start.sh      # Start services
bash scripts/update.sh     # Pull + rebuild + restart

# PM2 direct
pm2 start ecosystem.config.cjs
pm2 logs kpi-api
pm2 logs timekeep-bot
```

`ecosystem.config.cjs` defines three PM2 processes: `kpi-api`, `timekeep-bot`, `cloudflare-tunnel`. It reads `.env` manually and injects `NODE_OPTIONS` with the IPv4 fix.

## Critical gotchas

- **IPv6/Telegram API fix is mandatory.** Every entry point must set `NODE_OPTIONS=--dns-result-order=ipv4first --no-network-family-autoselection`. The ecosystem.config.cjs and start scripts handle this, but if you run files directly you must set it yourself.
- **`start.bat` is deprecated.** Use `scripts\windows\start.ps1`.
- **Cloudflare quick tunnel URL changes every restart.** The start scripts auto-update `MINI_APP_URL` in `.env` from the tunnel log. The bot reads this URL for Mini App inline buttons.
- **No test suite exists.** `npm test` prints an error and exits 1. There is no test framework configured anywhere.
- **ESM throughout.** All source files use `import`/`export`. Root `package.json` has `"type": "module"`. `ecosystem.config.cjs` uses CommonJS (that is intentional — PM2 needs CJS).
- **`pending_reports` uses `telegram_id` as PK.** Only one pending report per user at a time; a new `#baocao` overwrites any existing pending entry via `ON CONFLICT`.
- **`checkAdmin()` re-reads `.env` on every call** (in `apps/bot/index.js`) to hot-reload `ADMIN_IDS` without PM2 restart.
- **Passwords are plaintext.** The `admin_accounts.password_hash` column stores raw text, not a hash. Do not "fix" this without migration coordination.

## Database

PostgreSQL 16. Connection via `DATABASE_URL` env var. Schema defined across:
- `scripts/db_init.sql` — production snapshot (the source of truth for new deploys)
- `packages/database/schema.sql` and `schema_timekeep.sql` — reference schemas

Key tables: `employees`, `telegram_groups`, `group_settings`, `daily_reports`, `tk_schedules`, `tk_check_ins`, `tk_leave_requests`, `pending_reports`, `admin_accounts`, `admin_group_mappings`.

Migrations: run manually via `node packages/database/run_migrations*.js` or direct SQL. No migration framework (no Knex, no Prisma).

## Environment

Copy `.env.example` to `.env`. Required vars:
- `DATABASE_URL` — PostgreSQL connection string
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `GOOGLE_SPREADSHEET_ID` — for KPI sheet sync
- `ADMIN_IDS` — comma-separated Telegram user IDs

Optional but important:
- `MINI_APP_URL` — auto-set by start scripts from Cloudflare tunnel
- `NODE_OPTIONS` — IPv4 fix, set by ecosystem.config.cjs
- `DISABLE_IMAGE_DUPLICATE_CHECK` — skip photo fingerprinting

`.env` and `*.json` service account keys are gitignored. Never commit secrets.

## Style conventions

- Vietnamese variable names and comments throughout (e.g. `tinhTrangAnh`, `lich_khach`)
- No TypeScript — pure JS with ESM imports
- No linter or formatter configured for the backend. Web-admin has ESLint (`npm run lint` in `apps/web-admin/`)
- Direct SQL queries via `pg` pool — no ORM
- Telegraf scenes pattern for multi-step bot flows (`reportWizard`, `setupWizard`)
