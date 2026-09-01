# WayneTrade — Backend (Phase 1 MVP)

> **⚠️ MERGED — see [arpanwayne/saaf-signal-backend](https://github.com/arpanwayne/saaf-signal-backend).**
> This repo's risk engine, kill-switch, and MetaApi execution code has been
> combined with the Saaf Signal forecast engine into one backend. This repo
> is no longer actively developed — go to the link above for current work.

Group algo-trading command center. Backend for signal ingestion, risk engine,
kill-switch, and audit logging, per `WayneTrade_Developer_Guide.docx`.

Scope, updated 2026-09-01: Forex/Crypto via MetaTrader **and** Indian
equities via Kite Connect, per-member fixed position sizing, hard
stop-loss, auto profit-booking, SEBI Algo-ID tagging on equities orders,
manual kill-switch, admin API-key auth, real-time WhatsApp/dashboard trade
notifications (Layer 3), a broker-facing AI research assistant (Layer 2),
and — new this update — **Saaf Signal's forecast engine, absorbed
in-process** rather than a separate deployment (`src/services/forecastEngine/`,
`src/routes/signal.js`). This is now the single backend for the whole
product branded **Saaf Trade**; `waynetrade-frontend` is the single
frontend. See `docs/DEVELOPER_GUIDE.md` for the original combination plan
and `docs/HANDOVER.md` for what's changed since. Backtesting, billing, and
multi-group scale are still not built — see "What is NOT built" below.

## What's actually built

- Prisma schema for all 7 core tables plus a new `risk_profiles` table
  (groups, members, strategies, signals, risk_decisions, orders,
  kill_switch_events, risk_profiles).
- Express webhook receiver with HMAC signature verification, secret is now
  decrypted from an encrypted DB column (see "Fixed since last version" below).
- Risk engine: kill-switch check → stop-loss check → **per-member** position
  sizing (from `risk_profiles`, not hardcoded) → **auto profit-booking**
  (take-profit = member's `riskRewardRatio` × the stop-loss distance from the
  signal's reference price, unless the signal already sets its own
  `takeProfit`) → writes a `risk_decisions` row for every signal/member pair,
  always. Both stop-loss and the computed take-profit are attached to the
  order itself, so the broker enforces both automatically — no manual
  profit-booking step, which is exactly the gap this closes (previously
  `takeProfit` only ever reached the broker if the incoming signal happened
  to include one; in practice it almost never did, so kill-switch/stop-loss
  were the only exits that actually fired).
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
- **New: Kite Connect execution bridge** (`src/services/kiteConnectBridge.js`)
  — Indian equities orders, dispatched from the same webhook alongside
  MetaTrader (`src/routes/webhook.js`'s `brokerExecutors` table). Every
  equities order carries the strategy's SEBI Algo-ID
  (`PUT /onboarding/strategy/:id/algo-id`) — a strategy with no Algo-ID has
  its equities orders rejected outright, never sent untagged.
- **New: Kite stop-loss/take-profit via a protective GTT order.** Right
  after an equities entry is placed, a two-leg GTT (Good Till Triggered —
  Kite's OCO mechanism: whichever of stop-loss/take-profit fires first
  cancels the other) covers the exit, since Kite Connect has no single
  "order + SL/TP" call the way MetaApi does. `orders.protective_trigger_ref`
  records the resulting GTT id. **If this GTT placement fails, the entry
  has already gone through and the position is unprotected** — the
  investor's WhatsApp/dashboard notification leads with an explicit
  warning in that case (see `notificationService.js`), it is never
  silent. This is a two-request sequence, not one atomic broker call — see
  gaps below.
- **New: Layer 3, real-time transparency notifications**
  (`src/services/notificationService.js`) — the moment an order's outcome
  is known (filled or not), the investor gets a plain-language, past-tense
  WhatsApp message plus a permanent `notifications` row for the dashboard.
  WhatsApp delivery is best-effort (Twilio) — unconfigured or missing phone
  number just means the dashboard row is written without a push, never a
  blocker to the trade itself. `GET /dashboard/group/:groupId/notifications`
  is the read side — this feed is what `waynetrade-frontend`'s
  "Transparency feed" section renders.
- **New: Layer 2, AI research assistant** (`src/services/researchAssistant.js`,
  `src/routes/research.js`) — `POST /research/scan` pulls recent market
  news and runs each article through a bull-case/bear-case/risk-supervisor
  analysis (Claude), persisting every result and sending the broker a single
  batched WhatsApp digest of only the MEDIUM/HIGH-confidence findings.
  `GET /research/feed` is the broker-facing dashboard feed. No in-process
  scheduler — an external cron must hit `/research/scan` periodically, same
  pattern as `saaf-signal-backend`'s `scheduler.py`.
- **New: the Saaf Signal forecast engine is absorbed in-process** —
  formerly a separate `saaf-signal-backend` service, now
  `src/services/forecastEngine/` in this repo (ported line-for-line from
  its Python original: `data.js`, `indicators.js`, `forecast.js`,
  `outcomes.js`, `screener.js`, `plainEnglish.js`, `newsEvents.js`), with
  its own Prisma models (`ForecastPrediction`, `ForecastWatchlistItem`) in
  this same database. Public, unauthenticated routes at `GET
  /signal/:ticker`, `POST /predict/:ticker`, `GET /track-record`, `GET
  /watchlist` + `POST`/`DELETE`, `GET /screener/scan`, `POST
  /scan-watchlist`, `GET /predict/:ticker/event` — see `src/routes/signal.js`.
  Pulls OHLCV history from Yahoo Finance via `yahoo-finance2` (no API key).
  Layer 2's own cross-check (`researchAssistant.js`'s `fetchForecastSignal`)
  now calls this in-process instead of over HTTP — same "two separate
  readings, never blended" behavior as before, just no network hop.
  **Deliberately still public, not behind `requireApiKey`** — matches the
  original standalone service's design, and is the exact finding flagged
  in `docs/RA_RIA_DECISION_SUPPORT.md`; moving the code in-process doesn't
  change that finding.
- **New: investor-only view tokens** (`src/services/viewToken.js`,
  `src/middleware/requireViewToken.js`, `src/routes/investor.js`) — every
  member gets a per-member view token at creation (SHA-256-hashed at rest,
  plaintext shown once), completely separate from the shared
  `ADMIN_API_KEY`. `GET /investor/:memberId/*` grants read-only access to
  exactly that one member's own overview/audit-trail/notifications —
  never another member's data, never kill-switch or onboarding actions.
  This is the backend for `waynetrade-frontend`'s new investor view.
  **Honest scope:** this is a shared-secret bearer token per member, not a
  real login system (no password, no session expiry) — a deliberate,
  small, real step toward "no login/user accounts" being a listed gap, not
  a full auth system. **New:** investors can now self-service rotate their
  own token (`POST /investor/:memberId/view-token/regenerate`, using their
  current token to authorize the new one) — no admin needed unless the
  token is actually lost, not just suspected leaked.
- **New: member removal** — `DELETE /onboarding/member/:memberId`
  soft-deletes (status → `REMOVED`, logged to `kill_switch_events` same as
  a pause). More permanent than the kill-switch's pause on purpose: there
  is no "un-remove" route. `webhook.js` already skipped `REMOVED` members
  before this session — this closes the gap of never being able to set
  that status through the API/UI at all.
- **New: unprotected-order reconciliation** (`src/services/reconciliation.js`,
  `POST /ops/retry-unprotected-orders`) — finds every Kite Connect order
  that's `SENT` but still has no protective GTT (`protectiveTriggerRef`
  null) and retries placing it. Meant for an external cron, same pattern as
  `/research/scan`; also safe to call manually after a specific
  `protectionWarning` notification. Narrows, but does not eliminate, the
  entry-vs-protection non-atomicity gap below.

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

- **Auto profit-booking needs the signal to send a reference `price`.**
  Without it (and without the signal setting its own `takeProfit`), no
  take-profit is computed — the trade still goes out, just exit-only via
  stop-loss/kill-switch as before. TradingView alerts can send this as
  `{{close}}`; make sure the Pine Script alert JSON includes it.
- **No trailing stop.** Take-profit and stop-loss are both fixed at order
  placement time; neither moves as price moves in the member's favor.

- **Auth is a single shared admin key, not per-user RBAC.** Anyone with the
  key can pause any member or any group, and see any dashboard. Real
  per-person permissions (e.g. "member X can only pause themselves") need a
  proper user/auth system — bigger scope, not done here. Investor view
  tokens (above) are a narrower step in that direction for read-only
  access, not a substitute for real RBAC on the admin side.
- **View tokens have no expiry.** Self-service rotation now exists
  (`POST /investor/:memberId/view-token/regenerate`, authenticated with the
  investor's own current token) — a leaked token doesn't require an admin
  to fix, an investor can just get a new one. But there's still no
  automatic expiry; a token is valid forever until someone (admin or
  investor) explicitly rotates it.
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
- **No backtesting module.** Not started.
- **Kite Connect bridge has never touched a real Kite Connect account**,
  same honest status as the MetaApi bridge — see `kiteConnectBridge.js`'s
  own header comment for the specific untested pieces: access-token
  provisioning is not implemented, and the protective GTT's `last_price`
  comes from the signal's own reference price, not a live quote fetched at
  GTT-creation time — Kite validates trigger levels against the real LTP
  and can reject ones too far from it, which this repo has no way to detect
  before sending. Entry and protection are also two separate broker
  requests, not one atomic call — if the GTT request fails after a
  successful entry, the position is briefly (or not-so-briefly) open and
  unprotected; the investor notification says so explicitly. `POST
  /ops/retry-unprotected-orders` (new) can now be hit periodically by an
  external cron to retry these automatically — but nothing hits that route
  on its own yet, and it's still a retry loop, not a fix for the
  underlying non-atomicity (a fast-moving stock could still leave a window
  before the first successful retry).
- **Layer 2 news source is a placeholder shape.** `NEWS_API_BASE_URL`
  defaults to a generic NewsAPI.org-style endpoint — no licensed
  India-specific market news source is wired up yet.
- **The forecast engine's data fetch (`forecastEngine/data.js`, Yahoo
  Finance via `yahoo-finance2`) has never made a real network call in this
  codebase's own development sandbox** — that sandbox's egress proxy
  blocks `query1/query2.finance.yahoo.com` outright (same organization
  policy that also blocks Render/Vercel API calls from there). The math in
  `indicators.js`/`forecast.js` is unit-tested against synthetic OHLCV
  fixtures (`test/forecastEngine.*.test.js`) and the routes were verified
  end-to-end against a real Postgres for everything that doesn't need
  market data (watchlist CRUD, track-record, error handling on a failed
  fetch) — but nobody has yet confirmed a real ticker returns a sane
  forecast from a normal internet connection. Do that once this is
  deployed somewhere without the block. The `newsEvents.js` (event/news
  layer, `GET /predict/:ticker/event`) is in the same boat — RSS feed
  fetches and the Anthropic call are both untested here for the same
  reason.
- **A real test suite now exists** (`test/`, `npm test`, Node's built-in
  test runner — no new dependency) covering the risk engine's
  take-profit math, the view-token hash/generate helpers, and both broker
  bridges' pre-flight validation (18 tests, all passing). **Still not
  covered**: anything touching Prisma/a real database (would need a test
  database, not set up here), and Layer 2/3 have still never run against
  real Twilio/Anthropic/news-API credentials — those fail loudly (not
  silently) when unconfigured, but "fails loudly" isn't the same as
  "verified working."
- **Legal/compliance review not done, but a starting point now exists.**
  See `docs/SAAF_TRADE_INVESTOR_OVERVIEW.md` for the compliance posture
  this is aiming for (broker-empanelled, non-custodial, SEBI Algo-ID
  aligned), `docs/BROKER_PARTNERSHIP_AND_COMPLIANCE_CHECKLIST.md` for the
  ordered action items (explicitly not legal advice), and
  `docs/PRIVACY_POLICY_DRAFT.md` for a first-pass DPDP Act privacy policy
  draft — all three still need an actual lawyer before any of this is
  final, and the privacy draft specifically flags two unresolved product
  gaps (no consent-capture step, no data retention/deletion policy).

## Setup

```bash
npm install
cp .env.example .env
# Fill in: DATABASE_URL, ENCRYPTION_KEY, ADMIN_API_KEY (see .env.example for
# how to generate each), METAAPI_TOKEN once you have a MetaApi account.
# Optional, only needed for the features they gate: KITE_API_KEY/SECRET
# (equities), TWILIO_* (real-time WhatsApp notifications), NEWS_API_KEY +
# ANTHROPIC_API_KEY (Layer 2 research assistant). Every one of these fails
# loudly and skips its own feature, not the rest of the app, if left unset.
npx prisma migrate deploy   # applies the committed migrations, first-time setup
npm test                     # runs the test/ suite (no DB needed — see below)
npm run dev
```

`prisma/migrations/` is committed — three migrations, all generated and
applied against a real local Postgres 16 instance this repo's various
sessions used for verification: the initial schema (this repo never had an
earlier migration checked in, so the first one creates everything, not
just an increment), the Layer 2/forecast-engine unification, and the
investor view-token fields. Each round's onboarding routes and a signed
webhook signal (or the relevant new routes) were run end-to-end against
the resulting database to confirm schema and app actually agree — not just
schema-validated in isolation. `migrate deploy` (not `migrate dev`) is the
right command for a fresh environment: it applies existing migrations
non-interactively and never tries to generate a new one. Use `migrate dev`
again only when you change `schema.prisma` further and need a new
migration generated.

`npm test` runs `test/` via Node's built-in test runner (`node --test`, no
new dependency) — pure-logic coverage only (take-profit math, view-token
hashing, both broker bridges' pre-flight validation), nothing that touches
Prisma or a real database, so it needs no setup beyond `npm install`.

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
| GET | `/dashboard/group/:groupId/notifications` | `X-Api-Key` | Layer 3's transparency feed for a group — investor trade notifications + broker research digests (`?limit=`) |
| GET | `/onboarding/groups` | `X-Api-Key` | List all groups with members + strategies |
| POST | `/onboarding/group` | `X-Api-Key` | Create a group |
| POST | `/onboarding/group/:groupId/member` | `X-Api-Key` | Add a member to a group, optionally with a risk profile — returns the plaintext investor view token **once** |
| PUT | `/onboarding/member/:memberId/risk-profile` | `X-Api-Key` | Set/replace a member's risk profile |
| POST | `/onboarding/member/:memberId/view-token/regenerate` | `X-Api-Key` | Issues a fresh investor view token for a member (e.g. one created before this feature existed, or a suspected-leaked token) — invalidates the old one, returns the new plaintext **once** |
| POST | `/onboarding/group/:groupId/strategy` | `X-Api-Key` | Create a strategy — returns the plaintext webhook secret **once** |
| PUT | `/onboarding/strategy/:strategyId/algo-id` | `X-Api-Key` | Set a strategy's SEBI Algo-ID once the broker registers it with the exchange — required before any Kite Connect member can trade it |
| GET | `/research/feed` | `X-Api-Key` | Layer 2's broker-facing feed of analyzed news signals (`?groupId=`, `?limit=`) |
| POST | `/research/scan` | `X-Api-Key` | Triggers one Layer 2 scan pass — meant to be called by an external cron, not a user |
| GET | `/investor/:memberId/overview` | `X-View-Token` | Investor's own member info, risk profile, and recent orders — **not** the admin key, scoped to exactly this one member |
| GET | `/investor/:memberId/audit` | `X-View-Token` | Investor's own audit trail (their risk decisions + resulting orders) |
| GET | `/investor/:memberId/notifications` | `X-View-Token` | Investor's own transparency-feed notifications only (never the group's broker digest) |
| POST | `/investor/:memberId/view-token/regenerate` | `X-View-Token` (current) | Self-service token rotation — an investor who still has a working token can replace it themselves, no admin needed |
| DELETE | `/onboarding/member/:memberId` | `X-Api-Key` | Removes a member (status → `REMOVED`, soft delete) — more permanent than kill-switch pause, no "un-remove" route |
| POST | `/ops/retry-unprotected-orders` | `X-Api-Key` | Retries the protective GTT for any Kite Connect order that's `SENT` but still has no `protectiveTriggerRef` — meant for an external cron, same pattern as `/research/scan` |
| GET | `/signal/:ticker` | none (public) | Saaf Signal forecast engine — read-only current signal, never logs a tracked call |
| GET | `/signal/:ticker/explain` | none (public) | Same as above, plain-English answer |
| POST | `/predict/:ticker` | none (public) | Runs the forecast and logs it as a permanent, trackable prediction row |
| POST | `/predict/:ticker/explain` | none (public) | Same as above, plain-English answer |
| GET | `/predict/:ticker/event` | none (public) | News/event layer for one ticker — requires `ANTHROPIC_API_KEY` |
| GET | `/track-record` | none (public) | Aggregate hit/miss accuracy stats (`?ticker=` to scope to one) |
| GET | `/predictions` | none (public) | Recent logged predictions (`?ticker=`, `?limit=`) |
| POST | `/check-outcomes` | none (public) | Verifies matured predictions against real outcomes — meant for an external cron |
| GET | `/watchlist` | none (public) | List watched tickers |
| POST | `/watchlist/:ticker` | none (public) | Add a ticker to the watchlist |
| DELETE | `/watchlist/:ticker` | none (public) | Remove a ticker |
| GET | `/screener/scan` | none (public) | Scans the default universe for notable signals (`?minConfidence=`) |
| GET | `/screener/universe` | none (public) | The default ticker universe the screener scans |
| POST | `/scan-watchlist` | none (public) | Runs predictions across the whole watchlist in one call, returns which crossed each item's alert threshold |

The `/signal`, `/predict`, `/watchlist`, `/screener`, `/track-record`,
`/predictions`, `/check-outcomes`, and `/scan-watchlist` routes are Saaf
Signal's forecast engine, absorbed in-process — see
`src/routes/signal.js` and `src/services/forecastEngine/`. They're
intentionally public/unauthenticated, matching the original standalone
service; see `docs/RA_RIA_DECISION_SUPPORT.md` before changing that.

## Security notes

- Broker credentials are never stored in this DB — `members.broker_account_ref`
  is a tokenized reference only (the MetaApi `accountId`, not a password).
- Webhook secrets are encrypted at rest (AES-256-GCM), decrypted only at
  signature-verification time.
- Every risk decision and every kill-switch event is logged, no exceptions.
- Kill-switch and dashboard routes require the admin API key — this is a
  minimum bar, not a substitute for real per-user auth before this handles
  real money.
- **A `REMOVED` member's view token still works, on purpose.** Removal
  stops future trading, not the ability to see past history — verified
  this session (a removed test member's token still returned `200` from
  `/investor/:memberId/overview`). Matches this platform's transparency
  design elsewhere (wins and losses shown identically, permanently): being
  removed from a group shouldn't also mean losing access to your own
  historical record. If a future change makes removal also revoke view
  access, that's a deliberate policy change, not a bug fix.
