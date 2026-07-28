# WayneTrade — Backend (Phase 1 MVP)

Group algo-trading command center. Backend for signal ingestion, risk engine,
kill-switch, and audit logging, per `WayneTrade_Developer_Guide.docx`.

Scope of this scaffold: **Phase 1, gaps closed as of July 28, 2026** —
Forex/Crypto via MetaTrader, per-member fixed position sizing, hard
stop-loss, manual kill-switch, admin API-key auth. Phases 2–4 (dashboard
frontend UI, backtesting, Kite Connect/equities, billing, multi-group scale)
are still not built — see "What is NOT built" below.

## What's actually built

- Prisma schema for all 7 core tables plus a new `risk_profiles` table
  (groups, members, strategies, signals, risk_decisions, orders,
  kill_switch_events, risk_profiles).
- Express webhook receiver with HMAC signature verification, secret is now
  decrypted from an encrypted DB column (see "Fixed since last version" below).
- Risk engine: kill-switch check → stop-loss check → **per-member** position
  sizing (from `risk_profiles`, not hardcoded) → writes a `risk_decisions`
  row for every signal/member pair, always.
- Kill-switch routes: pause/resume a member, pause a whole group. Every
  trigger is logged to `kill_switch_events` — no silent pauses.
- MetaApi execution bridge — request/response shape now matches MetaApi's
  published REST docs (previously a guess). **Still untested against a real
  MetaApi account** — see gaps below.
- Dashboard read routes for group overview + per-member audit trail.
- **New:** admin API-key auth (`X-Api-Key` header) on all kill-switch and
  dashboard routes — these were fully open before.
- **New:** `scripts/generate-strategy-secret.js` — generates a webhook
  secret and its encrypted form to store against a new strategy row.
- **New:** onboarding routes — create groups, add members with risk profiles,
  and create strategies (auto-generates + encrypts the webhook secret,
  returned once in plaintext for pasting into TradingView). Closes the
  "no onboarding UI" gap on the backend side — see waynetrade-frontend for
  the form that uses these.

## Fixed since last version (previously listed as open gaps)

- ~~MetaApi integration is unverified (guessed request shape)~~ → now built
  against MetaApi's documented `POST /users/current/accounts/:id/trade`
  endpoint and `MetatraderTrade` schema. Still not run against a live/demo
  account — that's a different kind of gap (see below).
- ~~Webhook secret storage was inconsistent (hash vs. plaintext mismatch)~~ →
  `strategies.webhookSecretEncrypted` now stores an AES-256-GCM ciphertext,
  decrypted at request time via `ENCRYPTION_KEY`. See
  `src/services/encryption.js` and `scripts/generate-strategy-secret.js`.
- ~~No per-member risk profile table~~ → `risk_profiles` table added,
  `members.risk_profile_id` links to it, risk engine reads real
  `fixedLots` per member instead of a hardcoded `0.01`. A member with no
  risk profile assigned is correctly **rejected**, not silently defaulted.
- ~~No auth/RBAC layer~~ → shared admin API key now required on
  `/kill-switch/*` and `/dashboard/*`. **This is not full RBAC** — see the
  honest limit below.

## What is NOT built / honest gaps that remain

- **Auth is a single shared admin key, not per-user RBAC.** Anyone with the
  key can pause any member or any group, and see any dashboard. Real
  per-person permissions (e.g. "member X can only pause themselves") need a
  proper user/auth system — bigger scope, not done here.
- **MetaApi bridge has never touched a real MetaApi account.** The request
  shape is now correct per MetaApi's docs, but this repo has no MetaApi
  account, no connected demo MT5 login, and has made zero real API calls.
  Before this goes near even a demo account: (1) create a MetaApi.cloud
  account, (2) provision a demo MT5 account through MetaApi and get its
  `accountId`, (3) confirm which region your account's client API lives on
  and set `METAAPI_BASE_URL` accordingly, (4) run one signal through
  end-to-end and inspect the real response.
- **No P&L / live position sync.** Dashboard reads only our own DB (orders,
  decisions), not live equity/open-position data from MetaApi — that's a
  separate polling or webhook integration.
- **Dashboard frontend exists but has more to build.** See
  `waynetrade-frontend` repo — group overview, kill-switch controls, audit
  trail, and (as of this update) an onboarding form are built; live P&L and
  charts are not.
- **No backtesting module.** Phase 2 item, not started.
- **Kite Connect / equities / Algo-ID tagging.** Phase 3, not started.
  Confirm SEBI Algo-ID registration process with the broker directly.
- **Legal/compliance review not done.** Get this reviewed before any real
  money moves through this system.

## Setup

```bash
npm install
cp .env.example .env
# Fill in: DATABASE_URL, ENCRYPTION_KEY, ADMIN_API_KEY (see .env.example for
# how to generate each), METAAPI_TOKEN once you have a MetaApi account.
npx prisma migrate dev --name add_risk_profiles_and_encrypted_secrets
npm run dev
```

To register a new strategy's webhook secret:
```bash
npm run generate-secret
# prints a plaintext secret (put in TradingView's alert config) and the
# encrypted value (save into strategies.webhook_secret_encrypted)
```

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness check |
| POST | `/webhook/:strategyId` | HMAC signature (`X-Signature`) | TradingView/custom strategy webhook receiver |
| POST | `/kill-switch/member/:memberId` | `X-Api-Key` | Pause a member |
| POST | `/kill-switch/member/:memberId/resume` | `X-Api-Key` | Resume a member |
| POST | `/kill-switch/group/:groupId` | `X-Api-Key` | Pause an entire group |
| GET | `/dashboard/group/:groupId` | `X-Api-Key` | Group + members + recent orders |
| GET | `/dashboard/member/:memberId/audit` | `X-Api-Key` | Full risk-decision/order audit trail for a member |
| GET | `/onboarding/groups` | `X-Api-Key` | List all groups with members + strategies |
| POST | `/onboarding/group` | `X-Api-Key` | Create a group |
| POST | `/onboarding/group/:groupId/member` | `X-Api-Key` | Add a member to a group, optionally with a risk profile |
| PUT | `/onboarding/member/:memberId/risk-profile` | `X-Api-Key` | Set/replace a member's risk profile |
| POST | `/onboarding/group/:groupId/strategy` | `X-Api-Key` | Create a strategy — returns the plaintext webhook secret **once** |

## Security notes

- Broker credentials are never stored in this DB — `members.broker_account_ref`
  is a tokenized reference only (the MetaApi `accountId`, not a password).
- Webhook secrets are encrypted at rest (AES-256-GCM), decrypted only at
  signature-verification time.
- Every risk decision and every kill-switch event is logged, no exceptions.
- Kill-switch and dashboard routes require the admin API key — this is a
  minimum bar, not a substitute for real per-user auth before this handles
  real money.
