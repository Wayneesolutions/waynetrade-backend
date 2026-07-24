# WayneTrade — Backend (Phase 1 MVP)

Group algo-trading command center. Backend for signal ingestion, risk engine,
kill-switch, and audit logging, per `WayneTrade_Developer_Guide.docx`.

Scope of this scaffold: **Phase 1 only** — Forex/Crypto via MetaTrader, fixed
position sizing, hard stop-loss, manual kill-switch. Phases 2–4 (dashboard,
backtesting, Kite Connect/equities, billing, multi-group scale) are **not**
built yet.

## What's actually built

- Prisma schema for all 7 core tables (groups, members, strategies, signals,
  risk_decisions, orders, kill_switch_events).
- Express webhook receiver with HMAC signature verification scaffold.
- Risk engine: kill-switch check → stop-loss check → fixed position sizing →
  writes a `risk_decisions` row for every signal/member pair, always.
- Kill-switch routes: pause/resume a member, pause a whole group. Every
  trigger is logged to `kill_switch_events` — no silent pauses.
- MetaApi execution bridge — **stub only, untested against a real account.**
- Dashboard read routes for group overview + per-member audit trail.

## What is NOT built / honest gaps

- **MetaApi integration is unverified.** The request shape in
  `src/services/metaApiBridge.js` is a best-guess based on typical MetaApi
  REST patterns — confirm against current MetaApi docs before running
  against even a demo account.
- **Webhook secret storage is inconsistent as written.** `strategies.webhookSecretHash`
  is meant to store a hash, but HMAC verification needs the original secret,
  not a hash of it. Current code reads the real secret from
  `STRATEGY_SECRET_<strategyId>` env vars and ignores the DB hash column.
  Decide on one approach (env var vs. secrets manager) before going live —
  see the `TODO` comment in `src/routes/webhook.js`.
- **No P&L/live position sync.** Dashboard reads what's in our own DB
  (orders, decisions) — it does NOT poll MetaApi/Kite for live equity or
  open-position data. That's a separate integration.
- **No per-member risk profile table.** Risk engine currently hardcodes
  `fixedLots: 0.01` for every member (see `src/routes/webhook.js`). Needs a
  real `risk_profiles` table before Phase 2.
- **No auth/RBAC layer yet.** All routes are open. Add auth before deploying
  anywhere reachable from the internet — this handles real trading
  instructions, so this is not optional.
- **No backtesting module.** Phase 2 item, not started.
- **Kite Connect / equities / Algo-ID tagging.** Phase 3, not started.
  Confirm SEBI Algo-ID registration process with the broker directly —
  do not assume anything from the dev guide is still current.
- **No frontend.** Dashboard UI is a Phase 2 item; prototype in Lovable
  first, per the team's usual pattern.
- **Legal/compliance review not done.** Per the dev guide's open questions —
  get this reviewed before any real money moves through this system.

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL at minimum
npx prisma migrate dev --name init
npm run dev
```

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/webhook/:strategyId` | TradingView/custom strategy webhook receiver (HMAC-signed) |
| POST | `/kill-switch/member/:memberId` | Pause a member |
| POST | `/kill-switch/member/:memberId/resume` | Resume a member |
| POST | `/kill-switch/group/:groupId` | Pause an entire group |
| GET | `/dashboard/group/:groupId` | Group + members + recent orders |
| GET | `/dashboard/member/:memberId/audit` | Full risk-decision/order audit trail for a member |

## Security notes

- Broker credentials are never stored in this DB — `members.broker_account_ref`
  is a tokenized reference only. Store actual tokens in a secrets manager or
  encrypted env vars.
- Every risk decision and every kill-switch event is logged, no exceptions —
  that's the whole point of this system as a compliance/transparency layer.
