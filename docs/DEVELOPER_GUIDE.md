# Saaf Trade — Developer Guide

**Purpose of this doc:** we currently have two half-built products —
`waynetrade-backend`/`waynetrade-frontend` (execution + risk engine) and
`saaf-signal-backend`/`saaf-signal-frontend` (forecast engine + honesty
ledger) — plus a product vision that needs pieces neither repo has yet. This
is the plan for combining them into one product: **Saaf Trade**.

> Note on naming/history: both WayneTrade repos carry an old banner pointing
> to `arpanwayne/saaf-signal-backend`/`-frontend` as an already-merged combo
> repo. That owner/repo was not reachable from this session, so this guide
> treats the merge as **not yet done** and plans it from the four repos we
> do have, under the `Wayneesolutions` org. If `arpanwayne/saaf-signal-*`
> turns out to be real and ahead of this, diff against it before building
> from scratch.

## 1. The product, in one paragraph

Saaf Trade is a **non-custodial, broker-empanelled algo-trading platform**
for the Indian market. A SEBI-registered broker stays the principal who
actually executes every trade (per SEBI's April 2026 retail algo-trading
framework); Saaf Trade is the technology agent underneath them, doing three
jobs: (1) automated, risk-controlled execution so nobody has to watch
charts all day, (2) an AI research assistant that scans news/data so the
broker spends less time on manual research, and (3) a real-time
transparency feed so the investor whose money is moving always knows what
happened and why. We do not promise returns — we promise discipline,
enforcement, and honesty about outcomes, wins and losses shown identically.

## 2. Source repos — what exists today

| Repo | Stack | Role |
|---|---|---|
| `waynetrade-backend` | Node/Express + Prisma/Postgres | Execution + risk engine (this repo) |
| `waynetrade-frontend` | React 19 + Vite | Group/admin dashboard (early — currently a single `App.jsx`) |
| `saaf-signal-backend` | Python FastAPI + SQLite | Forecast engine + honesty ledger |
| `saaf-signal-frontend` | Static HTML/CSS/JS, no build step | Public-facing signal/watchlist/track-record site |

## 3. What to bring from WayneTrade (this repo)

Already built and working, per `README.md`:

- **Data model** — `groups`, `members`, `strategies`, `signals`,
  `risk_decisions`, `orders`, `kill_switch_events`, `risk_profiles`
  (`prisma/schema.prisma`).
- **Risk engine** (`src/services/riskEngine.js`) — kill-switch check → hard
  stop-loss requirement → per-member position sizing → **auto
  profit-booking** (added this session — take-profit = member's
  `riskRewardRatio` × stop-loss distance, attached to the order so the
  broker enforces it automatically) → every decision written to
  `risk_decisions`, no exceptions.
- **Webhook ingestion** (`src/routes/webhook.js`) — HMAC-signed, per-strategy
  secret, decrypted via AES-256-GCM at request time
  (`src/services/encryption.js`).
- **MetaApi execution bridge** (`src/services/metaApiBridge.js`) — the
  forex/CFD (MT4/5) execution path. Keep this for forex/crypto/commodity
  strategies; it is **not** the path for Indian equities (see §5).
- **Admin routes** — kill-switch (pause/resume member or group, always
  logged with a reason), dashboard reads, onboarding (create
  group/member/strategy).
- **Dashboard UI concepts** from `waynetrade-frontend`'s README (connect
  screen, member status, kill-switch controls with required reason,
  per-member audit trail, 15s auto-refresh) — the actual React code is
  minimal today, so these are requirements to re-implement against the
  combined backend, not code to lift as-is.

## 4. What to bring from Saaf Signal

- **Forecast engine** (`app/forecast.py`, `app/indicators.py`) — confidence
  scores computed by counting real historical setups, capped low under
  `MIN_SAMPLES`. This is the credibility engine — never let it be replaced
  by an invented/LLM-guessed number.
- **Honesty ledger pattern** (`app/main.py`, `app/outcomes.py`) — the
  `GET /signal/*` (read-only, safe to poll) vs. `POST /predict/*`
  (permanently logged, counts toward track record) split, plus
  `check-outcomes` verifying matured predictions against reality. This is
  the mechanism that makes "full transparency" a real, checkable claim
  instead of a slogan.
- **Watchlist + screener** (`app/data.py`, `app/screener.py`) — per-user
  watchlists and a broader market scan; useful as-is for equities.
- **`scheduler.py` + `app/whatsapp.py`** — nightly batch job + Twilio
  WhatsApp delivery. This is the seed of the Layer 3 notification service
  (§5) — today it's schedule-driven only; Layer 3 needs it event-driven too.
- **`app/news_events.py`** (optional Claude-powered `/predict/{ticker}/event`
  layer) — the seed of the Layer 2 AI research assistant (§5); today it
  looks up news for one ticker on request, Layer 2 needs it running
  continuously across the whole market.
- **Frontend design system** (`saaf-signal-frontend/README.md`) — the
  `--hit`/`--miss`/`--neutral`/`--watch` color system, Space Grotesk +
  JetBrains Mono type pairing, and the "plain, a little wry, never hypey"
  voice guideline. Reuse this as Saaf Trade's brand system — wrong calls get
  the same visual weight as right ones, everywhere.

## 5. What's new — status per item

### 5a. Equities execution adapter + Algo-ID compliance — BUILT (this session)
`src/services/kiteConnectBridge.js` implements `placeOrder`, matching
`metaApiBridge.js`'s shape, dispatched from `webhook.js`'s `brokerExecutors`
table alongside MetaTrader. Every order carries the strategy's Algo-ID
(`Strategy.algoId`, set via `PUT /onboarding/strategy/:id/algo-id`); a
strategy with none has its equities orders rejected, not sent untagged.
Stop-loss/take-profit are now enforced too, via `placeProtectiveExit`'s
two-leg GTT order placed right after entry (Kite has no single "order +
SL/TP" call the way MetaApi does). **Still open:** entry and protection are
two separate broker requests — a GTT failure after a successful entry
leaves the position briefly unprotected (surfaced to the investor
immediately, not silently); the GTT's trigger-price validation uses the
signal's own reference price, not a live Kite quote. Broker-empanelment *onboarding paperwork*
(actually registering with a real broker) is a business step, not code —
nothing here substitutes for that.

### 5b. Layer 2 — AI research assistant for the broker — BUILT (this session)
`src/services/researchAssistant.js` + `src/routes/research.js`. Per scan
pass: pulls recent news (`NEWS_API_KEY`), runs each article through one
Claude call with three roles in the prompt — bull case, bear case, and a
risk-supervisor verdict that assigns LOW/MEDIUM/HIGH (never a raw invented
number, never higher than LOW without concrete facts in the article) —
persists every result, and sends the broker one batched WhatsApp digest of
just the MEDIUM/HIGH items. `GET /research/feed` is the dashboard read.
**Simplification from the original plan:** one prompt with three roles
inside it, not three separate model calls debating each other — cheaper and
simpler, and the fallback if this proves too blunt in practice is to split
it into real separate calls, not to abandon the pattern. **Still open:** no
in-process scheduler (needs an external cron hitting `/research/scan`, same
as `saaf-signal-backend`'s `scheduler.py` pattern); `NEWS_API_BASE_URL`
defaults to a generic NewsAPI.org shape, no licensed India market news
source wired up yet; this pulls in an LLM layer independent from
`saaf-signal-backend`'s `forecast.py` rather than feeding into it — the two
honest-confidence engines (this one's LOW/MEDIUM/HIGH tag,
`forecast.py`'s sample-count-based score) are parallel, not yet unified.

### 5c. Layer 3 — real-time transparency notifications — BUILT (this session)
`src/services/notificationService.js`, event-driven (not the old
batch/scheduled pattern): the moment an order's outcome is known in
`webhook.js`, the investor gets a past-tense, plain-language message —
persisted to a `notifications` row always, WhatsApp best-effort (Twilio) on
top. `notifyBrokerDigest` is the same primitive, used by Layer 2 for the
batched broker digest — one notification service, two callers, per the
original plan. **Still open:** built and wired into the trade-execution
path in Node (`waynetrade-backend`), not into `saaf-signal-backend`'s
Python side — a forecast-engine-triggered notification (e.g. "your watchlist
stock just hit a signal") would need its own integration into that repo,
not automatically covered by this.

### 5d. Advisory-registration decision (business/legal track, not code)
If Saaf Trade ever issues its own forward-looking buy/sell calls (rather
than only executing/automating a broker's or user's own strategy and
explaining completed trades), that requires SEBI Research Analyst or
Investment Adviser registration — separate from the broker-empanelment
relationship in §5a. Decide this before Layer 2's output is exposed to
retail users directly rather than to the broker.

## 6. Target architecture (proposed)

Keep it as modular services under one product rather than one monolith —
matches what already exists and lets Node/Python stacks coexist:

```
                    ┌─────────────────────┐
TradingView/broker  │  execution-service    │  (this repo — risk engine,
signal / Layer 2  ─▶│  risk engine, kill-   │   kill-switch, both broker
   AI trigger        │  switch, audit trail  │─▶ adapters ALL BUILT)
                    └──────────┬────────────┘
                               │ order fill event
                               ▼
                    ┌─────────────────────┐
                    │ notification-service  │─▶ WhatsApp (investor + broker)
                    │   (this repo, BUILT)  │─▶ dashboard feed
                    └─────────────────────┘
                               ▲
                               │ flagged signals
                    ┌─────────────────────┐
                    │  research-assistant    │  (this repo, BUILT —
                    │   (this repo, BUILT)   │   independent of Python
                    │  (news scan + Claude)  │   forecast-service below)
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │  forecast-service      │  (saaf-signal-backend,
                    │  (honest confidence,   │   NOT yet combined with
                    │   sample-count based)  │   the above — still a
                    └─────────────────────┘   separate repo/stack)
```

All of execution-service, notification-service, and research-assistant now
live in **this repo** (`waynetrade-backend`), as Node modules — a pragmatic
simplification from the original two-stack (Node execution + Python
forecast) split, made because build access this session was to this repo,
not `saaf-signal-backend`. The forecast-service (honest sample-count-based
confidence scoring) still lives separately in `saaf-signal-backend` and is
NOT yet unified with the LOW/MEDIUM/HIGH tagging Layer 2 produces here —
that unification is real remaining work, not done.

Two frontends still need to collapse into one: broker/admin dashboard
(execution + kill-switch + Layer 2 research feed) and investor-facing app
(track record + per-trade transparency feed + watchlist), both consuming
the services above. Neither frontend was touched this session.

## 7. Suggested build order

1. **Done**: auto profit-booking in the risk engine (§3).
2. **Done**: Layer 3 event-driven notifications.
3. **Done**: Kite Connect equities adapter + Algo-ID tagging.
4. **Done**: Layer 2 research assistant, broker-facing.
5. **Done**: Kite stop-loss/take-profit via a protective GTT order (§5a) —
   closes the gap item 3 originally left open. Still open within this:
   entry + protection are two separate broker requests, not atomic (see
   §5a's "Still open" note).
6. **Still open — run the pending migration**
   (`npx prisma migrate dev --name add_take_profit_notifications_research_and_kite_protection`)
   against a real DB — every schema change above is written but not yet
   migrated anywhere; there is still no `prisma/migrations` directory in
   this repo.
7. **Still open — unify the two confidence engines.** Layer 2's
   LOW/MEDIUM/HIGH tagging (this repo) and `forecast.py`'s sample-count
   score (`saaf-signal-backend`) are parallel today; decide whether Layer 2
   feeds into the Python forecast engine, or the two stay separate and the
   frontend just shows both.
8. **Still open — unified frontend combining both dashboards.**
9. **Still open — advisory-registration decision**, revisited once Layer
   2's output quality is proven internally.
