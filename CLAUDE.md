# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A Telegram-based KPI/timekeeping/warehouse management system for a clinic ("Clinic"), written in Vietnamese (code comments, bot messages, and business docs are in Vietnamese). Three long-running processes, managed by PM2 (`ecosystem.config.cjs`):

- **kpi-api** — Express API (`apps/api/index.js`), serves the Web Admin dashboard and warehouse-admin REST endpoints.
- **timekeep-bot** — Telegraf bot (`apps/bot/timekeep_bot.js`), handles check-ins, daily KPI reports, penalties, scheduling, and the warehouse Telegram/Mini App flows.
- **cloudflare-tunnel** — exposes the bot's local port publicly so Telegram Mini Apps (served from `apps/bot/public/`) can be opened from the Telegram client.

`apps/bot/timekeep_bot.js` is the only bot entry point; the former legacy `apps/bot/index.js` has been removed. `khoi_dong_he_thong_kpi.ps1` and `start.bat` are deprecated startup scripts, superseded by `scripts/windows/start.ps1`.

## Commands

Install once: `npm install` (root) and `npm install` inside `apps/web-admin`.

```powershell
# Start everything (Windows, uses PM2 + ecosystem.config.cjs + cloudflared)
.\scripts\windows\start.ps1
.\scripts\windows\start.ps1 -Restart   # restart PM2 only, keep tunnel
.\scripts\windows\start.ps1 -Stop      # stop PM2 + cloudflared

# Run a single process directly (no PM2)
npm run dev:api     # node apps/api/index.js
npm run dev:bot      # node apps/bot/timekeep_bot.js
npm run dev:web      # build the web-admin (Vite) bundle into apps/web-admin/dist
npm run dev          # concurrently runs dev:api + dev:bot (no web build)
```

Docker (Linux deployment target — see `docker-compose.yml`, `docker/Dockerfile.api`, `docker/Dockerfile.bot`): `postgres`, `api` (port 3000), `bot` (port 3002), optional `cloudflared`.

### Tests

There is no single `npm test`; each area has its own script (all use Node's built-in test runner, `--experimental-test-isolation=none`, and hit a **real** Postgres via `DATABASE_URL` for `-db`/`-integration` suites — no mocked DB):

```powershell
npm run test:warehouse-module        # bot-side route/callback registration (no DB/bot needed)
npm run test:warehouse-admin         # api-side warehouse-admin registration
npm run test:warehouse-admin-ui      # web-admin WarehouseManagement.jsx test
npm run test:warehouse-domain        # packages/warehouse pure domain rules
npm run test:warehouse-db            # packages/warehouse integration (needs DB)
npm run test:warehouse-import-db     # bot warehouse import integration (needs DB)
npm run test:warehouse-admin-db      # api warehouse-admin integration (needs DB)
npm run test:warehouse-sheet         # Google Sheet sync test
npm run test:warehouse-miniapp       # Mini App test
npm run check:warehouse              # node --check on both entry files + all non-DB warehouse tests
npm run test:warehouse-all           # full warehouse suite, including migration verification
npm run test:kpi-memberships
npm run test:kpi-membership-api
```

To run a single test file directly: `node --experimental-test-isolation=none --test path/to/file.test.js`.

### Database migrations

Two separate migration trails exist — know which one you're touching:

- `packages/database/run_migrations_v*.js` (v2–v19) — the active, numbered migration history for the whole app. Run with `node packages/database/run_migrations_v19.js` (latest); `npm run migrate:warehouse-v19` / `npm run verify:warehouse-v19` wrap the warehouse-specific one.
- `db/migrations/*.sql` and `scripts/db_init.sql` — one-off/ad-hoc SQL, mounted into the Docker Postgres container's `docker-entrypoint-initdb.d` for fresh-container bootstrap only.

`packages/database/schema.sql` and `schema_timekeep.sql` are reference dumps of the full schema, not something you run.

## Architecture

### Modular monolith (see `docs/adr/0001-warehouse-modular-monolith.md`)

The codebase is mid-migration from one giant file (`apps/bot/timekeep_bot.js` handled check-in, KPI reports, customers, *and* warehouse) toward per-domain modules. **Warehouse** is the first domain extracted and is the reference pattern for any future extraction:

```
Express/Telegram  →  Application use case  →  Domain rule  →  Repository port  →  Postgres/Drive/Sheet/Telegram
```

- `packages/warehouse/src/domain/` — pure business rules (`constants.js`, `order-validation.js`). **Must never** import Express, Telegraf, `pg`, or any Google API.
- `packages/warehouse/src/application/` — use cases (`warehouse-order-service.js`) orchestrating domain + repository.
- `packages/warehouse/src/infrastructure/postgres/` — the repository implementation (`warehouse-query-repository.js`).
- `apps/bot/src/modules/warehouse/` — the bot-side adapter: `http/` (Express routes for the Mini App), `telegram/` (Telegraf action/callback handlers), `integrations/` (Google Sheets sync, Drive, an outbox worker for eventually-consistent side effects). Public entry point is **only** `registerWarehouseModule()` from `index.js` — other code must never import files inside `http/`, `telegram/`, or `integrations/` directly.
- `apps/api/src/modules/warehouse-admin/` — the Web Admin's warehouse REST API, registered via `registerWarehouseAdminRoutes()`.

Rules enforced by the ADR (violating these breaks the intended module boundary):
- No warehouse SQL may be added to `timekeep_bot.js`; all warehouse persistence goes through `packages/warehouse`.
- Warehouse module must not register KPI/check-in/customer cron jobs or handlers.
- Postgres is the source of truth for inventory; Google Sheets/Drive are downstream integrations, never the primary store.
- Changing an existing HTTP endpoint or Telegram callback requires a compatibility shim + test — see the "Hợp đồng tương thích" (compatibility contract) section in `apps/bot/src/modules/warehouse/README.md` for the exact endpoint/callback list that must keep working.
- All warehouse Mini App APIs must keep the Mini App auth middleware.
- New-design approval flows must be permission-based (per-group `warehouse permission`, granted via Web Admin), never based on a user's self-selected role/title.

Four domains are extracted so far: `domains/warehouse`, `domains/customer`, `domains/scheduling`, `domains/kpi-report` (daily KPI reports — see below). `domains/timekeep` (check-in/leave/penalties) is partially extracted; see its README's "Còn nợ" section for what's intentionally still in `timekeep_bot.js`. Everything not yet covered by a domain still lives directly in `apps/bot/timekeep_bot.js` and its sibling files (`reportWizard.js`, `setupWizard.js`, `role_guard.js`, `sheetManager.js`, `syncTimekeepSheets.js`, `googleDrive.js`, `image_hasher.js`).

### Data flow for a daily KPI report (see `domains/kpi-report/README.md`)

1. Employee posts a report (trigger phrase configurable per group, default `#baocao`, or heuristically detected natural language) in a Telegram group → parsed by `parseReport()`/`parseCurrency()` in `domains/kpi-report/domain/report-parsing.js`.
2. If photo proof is required, the report is staged in `pending_reports` (Postgres) with a deadline; incoming photos/videos increment `received_photos` via an atomic `UPDATE ... RETURNING` (avoids race conditions from rapid multi-photo sends). Direct photo submissions are also perceptual-hashed (`image_hasher.js`) and cross-checked against `saveHashesToDB`/`findDuplicateImages` to catch employees reusing old proof photos.
3. Once photo count meets the requirement, the report is finalized into `daily_reports`, and penalty logic runs against `group_settings` (`penalty_missing_kpi`, `penalty_missing_report`) — penalties are capped at one charge per employee per day regardless of how many rules were broken that day.
4. A `node-cron` job (minute-granularity) separately checks all `report`-role groups against their configured `remind_time_1`/deadline and pings/penalizes anyone with no `daily_reports` row for the day.
5. Every DB write to reports/penalties is mirrored into Google Sheets (`google-spreadsheet`) through a serialized `Promise`-chain queue (`domains/kpi-report/infrastructure/google-sheet/kpi-report-sheet-sync.js`), so concurrent writes don't race on `doc.loadInfo()`/row lookups.

Business rules for check-in/lateness/leave penalties are documented in Vietnamese in `rule.md` — consult it before changing penalty amounts or thresholds in code.

### Auth model

- Telegram side: admin-only bot commands are gated by `checkAdmin()`, which re-reads `ADMIN_IDS` straight from `.env` on every call (not cached) so admin changes take effect without a bot restart.
- Web Admin side: `x-admin-id` / `x-admin-role` request headers select `SUPER_ADMIN` (sees all groups) vs. scoped admins (`admin_group_mappings` table restricts visible `telegram_group_id`s). There's a hardcoded fallback super-admin login (`admin`/`admin123`) used only when `admin_accounts` is empty (first-run bootstrap).

### Environment

Config is `.env` (see `.env.example` for the full list) — `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `GOOGLE_SPREADSHEET_ID`/`CUSTOMER_SPREADSHEET_ID`/`WAREHOUSE_SPREADSHEET_ID`, `ADMIN_IDS`, `MINI_APP_URL`, Cloudflare tunnel token. Google service account credentials come from a JSON key file (path in `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`, default `hybrid-flame-499905-r2-3034c23f309c.json` at repo root). `NODE_OPTIONS=--dns-result-order=ipv4first` is required everywhere Node talks to Telegram's API (IPv6 connectivity issue).

## Knowledge graph

This repo has a graphify knowledge graph at `graphify-out/`. For codebase/architecture questions, prefer `graphify query "<question>"` / `graphify path` / `graphify explain` over grepping raw files, and run `graphify update .` after making code changes in a session (see `.agents/rules/graphify.md`).
