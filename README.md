# WayneTrade — Backend

Group algo-trading command center. Backend for signal ingestion, risk engine,
kill-switch, audit logging, live P&L, notifications, and per-user auth, per
`WayneTrade_Developer_Guide.docx`.

Scope: **Phase 1 complete + most of Phase 2, as of July 28, 2026** —
Forex/Crypto via MetaTrader, per-member risk profiles, kill-switch, live
account data, backtesting, Telegram notifications, per-user RBAC. The Kite
Connect equities path (Phase 3) is scaffolded but hard-gated off. See
"What is NOT done" below — it's shorter now, but the items on it matter more.

## What's actually built

- Prisma schema: the guide's 7 core tables plus `risk_profiles`, `users`
  (per-user auth), and `equity_snapshots` (P&L history).
- Express webhook receiver with HMAC signature verification; secrets
  AES-256-GCM encrypted at rest, decrypted only at verification time.
- Risk engine: kill-switch check → hard stop-loss requirement → per-member
  position sizing — every decision written to `risk_decisions`, always.
- Kill-switch routes: pause/resume a member, pause a whole group. Every
  trigger logged and notified — no silent kill-switches.
- MetaApi execution bridge (order placement) **plus live reads**: account
  information (balance/equity) and open positions. Still untested against
  a real MetaApi account — see gaps.
- **New: live P&L routes.** `/dashboard/member/:id/live` and
  `/dashboard/group/:id/live` pull balance/equity/positions straight from
  MetaApi; every successful poll stores an `equity_snapshots` row, which
  feeds `/dashboard/member/:id/equity-history` (the dashboard's chart).
- **New: per-user auth (RBAC).** `users` table, bcrypt password hashes,
  JWT login (`/auth/login`, 12h tokens). Roles: ADMIN (everything) and
  MEMBER (linked to one members row — may pause/resume only themselves,
  see only their own group/audit/live data). The legacy shared
  `ADMIN_API_KEY` still works and is treated as ADMIN, so nothing breaks.
- **New: Telegram notifications** (guide's Notifications layer): signal
  results, order errors, kill-switch events. Optional — unset env = no-op.
  Telegram first because WhatsApp Business API needs Meta approval; the
  service is one file and swappable.
- **New: backtesting module** (`backtest/`): dependency-free Python
  backtester that mirrors the live risk rules (fixed lots, hard stop-loss),
  SMA-crossover example strategy, win rate / P&L / profit factor / max
  drawdown. Run `python backtest/generate_sample_data.py` then
  `python backtest/backtest.py backtest/sample_data/EURUSD_H1_sample.csv`.
- **New: Kite Connect scaffold** (Phase 3 path): order placement against
  Kite's documented v3 REST API with SEBI Algo-ID tagging (`tag` field),
  wired into the webhook flow for KITE_CONNECT members — but hard-gated
  behind `KITE_ENABLED=true` and refuses untagged orders. Read the header
  comment in `src/services/kiteBridge.js` before even thinking about
  enabling it.
- Onboarding routes now cover the full lifecycle: create groups/members/
  strategies, **edit members, remove members (soft delete, audit-logged),
  rename strategies, archive strategies** (webhook stops accepting
  signals; history kept).

## What is NOT done / honest gaps that remain

- **Nothing has touched a real broker API.** MetaApi order placement and
  the new live reads are built against MetaApi's published docs but have
  made zero real API calls (this repo has no MetaApi account). Before even
  a demo run: create a MetaApi.cloud account, provision a demo MT5 account,
  set `METAAPI_BASE_URL` to your region, run one signal end-to-end.
- **Kite Connect path is scaffolding, not a product.** Daily manual access
  token refresh, naive quantity mapping (no lot-size/instrument master),
  no paired stop-loss order, and the SEBI Algo-ID registration process
  must be confirmed with the broker — none of that is assumable from docs.
  It stays gated off (`KITE_ENABLED=false`) until broker confirmation AND
  legal review.
- **Legal/compliance review not done** (guide Section 6). Required before
  real money on any path, and before the equities path goes live at all.
- **Equity history depends on dashboard use.** Snapshots are captured when
  live data is polled; if nobody opens the dashboard for a week, that week
  has no chart data. A scheduled polling worker is the next step if that
  matters.
- **Member accounts need an admin to create them** (`POST /auth/users`) —
  no self-signup, by design for a friends-group tool, but it means
  onboarding still has a manual step.
- **Backtester models no slippage/spread/commissions.** It validates logic,
  not profitability. Demo-account validation (Phase 1 goal) is still the
  real test.

## Setup

```bash
npm install
cp .env.example .env
# Fill in: DATABASE_URL, ENCRYPTION_KEY, ADMIN_API_KEY, JWT_SECRET
# (see .env.example for how to generate each), METAAPI_TOKEN once you have
# a MetaApi account, TELEGRAM_* if you want notifications.
npx prisma migrate dev --name add_users_equity_snapshots_strategy_archived
npm run dev
```

First-time auth bootstrap (creates the first admin; only works while the
users table is empty):

```bash
curl -X POST localhost:4000/auth/bootstrap-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"min8chars"}'
# → returns a token; log in later with POST /auth/login
```

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness check |
| POST | `/webhook/:strategyId` | HMAC (`X-Signature`) | Strategy webhook receiver |
| POST | `/auth/bootstrap-admin` | none (first run only) | Create the first admin |
| POST | `/auth/login` | email+password | Get a JWT (12h) |
| POST | `/auth/users` | admin | Create a user, optionally linked to a member |
| GET | `/auth/me` | any | Who am I / role / member link |
| POST | `/kill-switch/member/:id` | self or admin | Pause a member |
| POST | `/kill-switch/member/:id/resume` | self or admin | Resume a member |
| POST | `/kill-switch/group/:id` | admin | Pause an entire group |
| GET | `/dashboard/group/:id` | own group | Group + members + recent orders |
| GET | `/dashboard/group/:id/live` | own group | Live balance/equity per member (MetaApi) |
| GET | `/dashboard/member/:id/audit` | self or admin | Full decision/order audit trail |
| GET | `/dashboard/member/:id/live` | self or admin | Live account info + open positions |
| GET | `/dashboard/member/:id/equity-history` | self or admin | Equity snapshots for the chart |
| GET | `/onboarding/groups` | admin | List groups with members + strategies |
| POST | `/onboarding/group` | admin | Create a group |
| POST | `/onboarding/group/:id/member` | admin | Add a member (+ risk profile) |
| PUT | `/onboarding/member/:id` | admin | Edit a member's details |
| DELETE | `/onboarding/member/:id` | admin | Remove a member (soft, audit-logged, reason required) |
| PUT | `/onboarding/member/:id/risk-profile` | admin | Set/replace a risk profile |
| POST | `/onboarding/group/:id/strategy` | admin | Create a strategy (secret shown once) |
| PUT | `/onboarding/strategy/:id` | admin | Rename a strategy |
| DELETE | `/onboarding/strategy/:id` | admin | Archive a strategy (webhook off, history kept) |

"self or admin" = a MEMBER-role JWT linked to that members row, or any ADMIN
(JWT or legacy `X-Api-Key`).

## Security notes

- Broker credentials are never stored in this DB — `members.broker_account_ref`
  is a tokenized reference only (the MetaApi `accountId`, not a password).
- Webhook secrets are encrypted at rest (AES-256-GCM), decrypted only at
  signature-verification time; strategy archive kills the webhook instantly.
- Every risk decision, kill-switch event, and member removal is logged.
- Notifications never include keys, credentials, or secrets.
- Login is rate-limited; passwords are bcrypt-hashed; JWTs expire in 12h.
- The Kite path refuses to place any order without an Algo-ID tag, and the
  whole path is disabled unless `KITE_ENABLED=true` is set deliberately.
