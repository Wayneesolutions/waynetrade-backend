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

## 5. What's genuinely new — not in either repo

### 5a. Equities execution adapter + Algo-ID compliance (highest priority gap)
MetaTrader/MetaApi does not reach NSE/BSE equities. Needed:
- A broker-API adapter interface (`placeOrder`, matching `metaApiBridge.js`'s
  shape) with concrete implementations per empanelled broker — start with
  one (e.g. Kite Connect), add more only against a real broker's docs, not
  speculatively.
- Every order tagged with the exchange-assigned **Algo-ID**
  (`orders.algoId` already exists as a column, currently unused — wire it up
  when the first equities adapter is built).
- Broker-empanelment onboarding: registering Saaf Trade's strategies with
  each partner broker as required by SEBI's principal-agent framework
  (broker is the principal, Saaf Trade is the agent).

### 5b. Layer 2 — AI research assistant for the broker
Continuous, not on-demand: ingest licensed news/filings feeds, summarize and
tag by sector/impact via an LLM layer, surface as a live feed on a
broker-facing dashboard. Best-practice shape per current research: don't run
one model straight to a confidence number — use a small multi-agent
structure (e.g. a bull-case agent, a bear-case agent, and a risk-supervisor
that reconciles them) to avoid a single model hallucinating conviction or
chasing a false trend. Feed its output *into* the existing
`forecast.py`-style honest confidence scoring, don't replace it.

### 5c. Layer 3 — real-time transparency notifications
Extend the existing WhatsApp/scheduler pattern from batch to **event-driven**:
the moment an order fills (in `webhook.js`, where `order.status` becomes
`SENT`), push immediately to two different audiences with two different
templates:
- **Investor**: past-tense, plain-language, tied to *their own* trade —
  "bought X in your account, here's the news/signal that triggered it,
  stop-loss/take-profit are Y/Z." Never forward-looking advice — that stays
  the broker's call.
- **Broker**: batched research-digest style, surfacing Layer 2's flagged
  news/sector signals, not one message per trade across every client.

Needs a small notification service both the execution pipeline and Layer 2
can publish into, fanning out to WhatsApp (Twilio, already integrated) and a
persisted dashboard feed table (new).

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
TradingView/broker  │  execution-service    │  (this repo, extended)
signal / Layer 2  ─▶│  risk engine, kill-   │─▶ broker adapters
   AI trigger        │  switch, audit trail  │   (MetaApi, equities APIs)
                    └──────────┬────────────┘
                               │ order fill event
                               ▼
                    ┌─────────────────────┐
                    │ notification-service  │─▶ WhatsApp (investor + broker)
                    │      (new, §5c)       │─▶ dashboard feed
                    └─────────────────────┘
                               ▲
                               │ flagged signals
                    ┌─────────────────────┐
                    │  forecast-service      │  (saaf-signal-backend,
                    │  + research-brain      │   extended with §5b)
                    │  (honest confidence,   │
                    │   news/sector scanning)│
                    └─────────────────────┘
```

Two frontends collapse into one: broker/admin dashboard (execution + kill-
switch + Layer 2 research feed) and investor-facing app (track record +
per-trade transparency feed + watchlist), both consuming the services above.

## 7. Suggested build order

1. **Done this session**: auto profit-booking in the risk engine (§3).
2. Run the pending migration (`npx prisma migrate dev`) against a real DB —
   schema changes for `riskRewardRatio`/`takeProfit` are written but not
   yet migrated anywhere.
3. Layer 3 event-driven notifications (smallest new surface, highest
   trust-building value, reuses existing Twilio integration).
4. One equities broker adapter + Algo-ID tagging (unlocks the actual Indian
   equities market this product is meant for).
5. Layer 2 research assistant, broker-facing only at first.
6. Unified frontend combining both dashboards.
7. Advisory-registration decision, revisited once Layer 2's output quality
   is proven internally.
