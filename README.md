# WayneTrade — Backend (Phase 1 MVP)

> **⚠️ MERGED — see [arpanwayne/saaf-signal-backend](https://github.com/arpanwayne/saaf-signal-backend).**
> This repo's risk engine, kill-switch, and MetaApi execution code has been
> combined with the Saaf Signal forecast engine into one backend. This repo
> is no longer actively developed — go to the link above for current work.

Group algo-trading command center. Backend for signal ingestion, risk engine,
kill-switch, and audit logging, per `WayneTrade_Developer_Guide.docx`.

Scope, updated 2026-08-31: Forex/Crypto via MetaTrader **and** Indian
equities via Kite Connect, per-member fixed position sizing, hard
stop-loss, auto profit-booking, SEBI Algo-ID tagging on equities orders,
manual kill-switch, admin API-key auth, real-time WhatsApp/dashboard trade
notifications (Layer 3), and a broker-facing AI research assistant
(Layer 2). See `docs/DEVELOPER_GUIDE.md` for the full combined-product plan
this backend is one piece of (branded **Saaf Trade**). Backtesting,
billing, and multi-group scale are still not built — see "What is NOT
built" below.

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
  blocker to the trade itself.
- **New: Layer 2, AI research assistant** (`src/services/researchAssistant.js`,
  `src/routes/research.js`) — `POST /research/scan` pulls recent market
  news and runs each article through a bull-case/bear-case/risk-supervisor
  analysis (Claude), persisting every result and sending the broker a single
  batched WhatsApp digest of only the MEDIUM/HIGH-confidence findings.
  `GET /research/feed` is the broker-facing dashboard feed. No in-process
  scheduler — an external cron must hit `/research/scan` periodically, same
  pattern as `saaf-signal-backend`'s `scheduler.py`.
- **New: Layer 2 cross-checks the Saaf Signal forecast engine.** When an
  article names a resolvable ticker, `researchAssistant.js` calls
  `saaf-signal-backend`'s read-only `GET /signal/{ticker}` (set
  `SAAF_SIGNAL_API_BASE`) and stores its `technical_direction`/
  `technical_confidence`/`n_samples`/`reliability_tier` alongside — never
  blended into — Layer 2's own `confidenceTag`. Two different questions
  ("does this news matter" vs. "does history favor this direction"), shown
  as two separate readings, on purpose. Optional: unset, or a failed
  lookup, just skips those columns, never blocks the news-only analysis.

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
  unprotected; the investor notification says so explicitly, but nothing
  auto-retries it.
- **Layer 2 news source is a placeholder shape.** `NEWS_API_BASE_URL`
  defaults to a generic NewsAPI.org-style endpoint — no licensed
  India-specific market news source is wired up yet.
- **Layer 2/3 have no automated tests and have never run against real
  Twilio/Anthropic/news-API credentials** — all three fail loudly (not
  silently) when unconfigured, but "fails loudly" isn't the same as
  "verified working."
- **Legal/compliance review not done.** Get this reviewed before any real
  money moves through this system — see `docs/SAAF_TRADE_INVESTOR_OVERVIEW.md`
  for the compliance posture this is aiming for (broker-empanelled,
  non-custodial, SEBI Algo-ID aligned) and `docs/DEVELOPER_GUIDE.md` §5d for
  the still-open advisory-registration decision.

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
npm run dev
```

`prisma/migrations/` is committed — the single
`20260831070121_add_take_profit_notifications_research_and_kite_protection`
migration creates the entire schema (this repo never had an earlier
migration checked in, so it's also the initial-schema migration, not just
an incremental one). It was generated and applied against a real local
Postgres 16 instance, and the onboarding routes + a signed webhook signal
were run end-to-end against the resulting database to confirm the schema
and the app actually agree with each other — not just schema-validated in
isolation. `migrate deploy` (not `migrate dev`) is the right command for a
fresh environment: it applies existing migrations non-interactively and
never tries to generate a new one. Use `migrate dev` again only when you
change `schema.prisma` further and need a new migration generated.

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
| PUT | `/onboarding/strategy/:strategyId/algo-id` | `X-Api-Key` | Set a strategy's SEBI Algo-ID once the broker registers it with the exchange — required before any Kite Connect member can trade it |
| GET | `/research/feed` | `X-Api-Key` | Layer 2's broker-facing feed of analyzed news signals (`?groupId=`, `?limit=`) |
| POST | `/research/scan` | `X-Api-Key` | Triggers one Layer 2 scan pass — meant to be called by an external cron, not a user |

## Security notes

- Broker credentials are never stored in this DB — `members.broker_account_ref`
  is a tokenized reference only (the MetaApi `accountId`, not a password).
- Webhook secrets are encrypted at rest (AES-256-GCM), decrypted only at
  signature-verification time.
- Every risk decision and every kill-switch event is logged, no exceptions.
- Kill-switch and dashboard routes require the admin API key — this is a
  minimum bar, not a substitute for real per-user auth before this handles
  real money.
