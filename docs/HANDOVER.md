# Saaf Trade — Handover (final, consolidated)

**Date:** 2026-08-31
**What this file is:** a single clean summary of everything done and
everything left, across the whole project so far — replacing the older
version of this file, which had become a seven-round chronological log.
That log's detail isn't lost — it's in this repo's git history and in
`DEVELOPER_GUIDE.md` — this file is the "start here" version for anyone
(including a future you) picking this project up cold.

---

## 1. The product, in one paragraph

**Saaf Trade** = **WayneTrade** (algo-trading execution + risk engine) +
**Saaf Signal** (honest, non-guaranteed stock forecast tool), combined
under one plan. The pitch is **not** "guaranteed returns" — that framing
was explicitly rejected mid-project as both false and a SEBI compliance
violation. The real differentiator: **less manual research burden on the
broker, less manual effort for the investor, and full transparency** —
every automated action gets explained to the investor in plain language,
in real time, instead of trust being asked for blind. AI plays a
broker-facing research-assistant role (scans news, flags risk) — it does
not hand retail users its own buy/sell calls, which is a deliberate design
constraint tied to staying out of SEBI's advisory-registration territory
(see §5).

Three layers:
- **Layer 1 — Execution**: one signal comes in (from TradingView/a
  strategy), the risk engine applies stop-loss, position sizing, kill-switch
  checks, and now **auto profit-booking**, then the order goes to the
  broker (MetaTrader via MetaApi, or Zerodha via Kite Connect).
- **Layer 2 — AI research assistant (broker-facing only)**: scans market
  news, produces a bull case/bear case/risk verdict per story, cross-checks
  against Saaf Signal's own technical forecast, and digests anything
  medium/high-risk to the broker.
- **Layer 3 — Transparency**: every order and every research flag gets
  explained to the investor — WhatsApp + a dashboard — in past tense
  ("here's what happened and why"), never as a forward-looking tip.

---

## 2. What's actually built and verified — by repo

### `waynetrade-backend` (this repo) — Node/Express + Prisma + Postgres

Everything below was verified for real against a local Postgres 16
instance and real HTTP calls in this session's sandbox — not just read
through as code.

| Area | What exists |
|---|---|
| **Risk engine** | Kill-switch, mandatory stop-loss, position sizing (pre-existing), plus new **auto profit-booking**: `computeTakeProfit()` — uses the signal's own `takeProfit` if sent, else computes it from the member's `riskRewardRatio` (default 2.0) and the stop-loss distance, else leaves it null. Verified: a real webhook produced `take_profit = 2575` for a real test case, exactly matching the formula. |
| **Execution — MetaTrader** | `metaApiBridge.js`, pre-existing. |
| **Execution — Zerodha equities** | `kiteConnectBridge.js`, new. Requires a `Strategy.algoId` before it will place anything (SEBI's algo-trading framework requires every order to carry an exchange-assigned Algo-ID). Also places a **protective GTT** (two-leg stop-loss + take-profit) right after entry, since Kite has no atomic "order + protection" call. |
| **Layer 3 — transparency** | `notificationService.js` — persists every notification to the DB first, then best-effort sends via Twilio WhatsApp. Investor messages are always past-tense, never a forward-looking instruction (this phrasing is load-bearing for staying execution-only, not advice — see §5). |
| **Layer 2 — AI research** | `researchAssistant.js` — pulls news, one Claude call per article producing bull/bear/risk-verdict, extracts a likely ticker, cross-checks it against Saaf Signal's `GET /signal/{ticker}` (stored as separate `technical*` fields, never blended into Layer 2's own confidence number), digests medium/high items to the broker. **Broker-API-key-gated only — never shown to a retail investor anywhere in the current frontend.** |
| **Investor view tokens** | `Member.viewTokenHash` (SHA-256, shown once), a separate `requireViewToken` middleware, `/investor/*` routes. Verified: an admin API key does NOT work as a view token, and one member's token does NOT unlock another member's data. Self-service rotation exists (`POST /investor/:memberId/view-token/regenerate`). |
| **Member removal** | Soft delete (`MemberStatus.REMOVED`), no hard deletes — matches the "permanent honest record" design. Intentionally, a removed member's view token still works (documented as intentional in `README.md`, not a bug). |
| **Kite protection reconciliation** | `POST /ops/retry-unprotected-orders` — finds Kite orders that filled but never got a protective GTT, retries. Narrows the entry/GTT non-atomicity risk window; can't fully eliminate it (Kite has no atomic call for this). |
| **Automated tests** | `npm test` — 18 passing tests (`node --test`, no extra dependency) covering the risk-engine math, view-token hashing, and both broker bridges' pre-flight validation. Scoped to pure logic only — no test-database/Prisma testing exists yet. |
| **Database** | Full schema + one migration generated and actually run against a real local Postgres. **Never run against a real production database** — that's still open. |
| **Docs** | `README.md` (routes table + honest "what's built/what's not"), `DEVELOPER_GUIDE.md` (full technical combination plan), `SAAF_TRADE_INVESTOR_OVERVIEW.md` (investor-facing PDF source), `BROKER_PARTNERSHIP_AND_COMPLIANCE_CHECKLIST.md`, `PRIVACY_POLICY_DRAFT.md`, `BROKER_OUTREACH_EMAIL.md`, `LAWYER_BRIEFING.md`, `RA_RIA_DECISION_SUPPORT.md` — see §5. |

**Status:** branch `docs/saaf-trade-planning-docs` → PR #2 → **merged to
`main`**.

### `waynetrade-frontend` — React 19 + Vite

Was already a real working dashboard before this project touched it
(connect screen, group dashboard, kill-switch UI, audit trail, onboarding
forms) — an earlier version of this handover wrongly called it "a
near-empty scaffold," corrected once that was actually checked.

Added this project: Layer 2/3 UI (Transparency feed + Research assistant
sections, both polling live), Algo-ID management per strategy,
risk:reward-ratio + WhatsApp-number fields on member/group forms, a
genuinely **separate investor view** (`#investor` hash route — own connect
screen, own `localStorage` key, own fetch function using `X-View-Token`
that can never send `X-Api-Key` by accident, no kill-switch/onboarding
controls anywhere in this half of the app), member removal + self-service
token rotation in the UI.

Verified with a real headless-browser (Playwright) run against the real
backend + Postgres, including actually submitting forms and confirming the
resulting rows via `psql` — not just a build check.

**Status:** branch `feature/layer2-3-and-algo-id-ui` → PR #2 → **merged to
`main`**.

### `saaf-signal-frontend` — static HTML/CSS/JS, no build step

Added: an optional `SAAF_TRADE_INVESTOR_URL` config field that, when set,
adds a "Your Saaf Trade account ↗" nav link on the watchlist/track-record/
chat pages. Verified as a genuine no-op when unconfigured (not just
visually hidden).

This is **cross-linking, not a merge** — two separate deployments, two
design systems, connected by plain links. A true single-product-surface
merge is still not done (see §4).

**Status:** branch `feature/link-saaf-trade-investor-view` → PR #1 →
**merged to `main`**.

### `saaf-signal-backend` — Python FastAPI + SQLite

Never modified this project — read-only, used to confirm the exact shape
of `GET /signal/{ticker}` so Layer 2 could cross-check against it
correctly. Its `/signal`, `/predict`, `/screener/scan` endpoints are public
and return a directional call with a confidence score — this is the basis
of the RA/RIA finding in §5.

---

## 3. Everything that's real vs. everything that's still simulated

Be precise about this with anyone evaluating the project — it matters:

**Real, verified in this sandbox:**
- Local Postgres 16, full schema + migration, real HTTP round-trips
- Prisma client ↔ schema agreement
- Risk-engine math (profit-booking, stop-loss)
- View-token auth isolation (cross-member 401s, admin-key rejection)
- Frontend forms → backend → DB, checked via `psql`
- Reconciliation job against a manually simulated failure state

**Never exercised against anything real:**
- MetaApi (no real token)
- Kite Connect (no real API key/secret — this closes the single biggest
  gap: whether `placeOrder`/`placeProtectiveExit` actually work against a
  live or sandbox Zerodha account has never been tested)
- Twilio (no real account — WhatsApp sending has only ever hit the
  "not configured, skipped" path)
- Anthropic (no real API key — the Layer 2 research prompt has never
  actually been sent to Claude)
- Any production Postgres/Neon instance
- Yahoo Finance (the forecast engine's data source — see §6a, blocked by
  this sandbox's own egress proxy)

None of this is fabricated as "done" anywhere in the docs — every doc that
touches these says so explicitly, on purpose.

---

## 4. What's left, technically

- **Kite protective GTT is not atomic with entry** — mitigated by the
  reconciliation job, not eliminated. Would need Kite Connect itself to
  offer a combined call, which it doesn't.
- **`riskRewardRatio` default (2.0) is per-member, not per-strategy** —
  open product decision, not decided yet.
- **View tokens have no expiry** — rotation is self-service now, but a
  token that's never rotated is valid forever.
- **No test-database setup** — the 18 tests are pure-logic only, nothing
  exercises Prisma/a live DB automatically.
- **Ticker extraction in Layer 2 is LLM-guessed** — can miss or misformat
  a ticker Saaf Signal's data source doesn't recognize.
- ~~`saaf-signal-frontend`/`-backend` are still separate deployments~~ —
  **done as of §6a**: the forecast engine is now absorbed in-process into
  `waynetrade-backend`/`-frontend`. The old `saaf-signal-*` repos are
  legacy, not the current source for this functionality.
- **No retention/deletion policy implemented** — every table grows
  forever; flagged in `PRIVACY_POLICY_DRAFT.md` as an open gap.
- **No consent-capture step** before an admin enters a member's WhatsApp
  number/data — also flagged in the privacy draft.
- **Never run against real credentials** for any of MetaApi, Kite Connect,
  Twilio, or Anthropic — see §3.
- **Unresolved thread**: both backend and frontend READMEs mention a
  claimed merge into `arpanwayne/saaf-signal-backend`/`-frontend` — that
  owner/repo was never reached or verified. Worth checking directly before
  assuming which repo set is the real source of truth.

## 5. What's left, business/legal — and what's already drafted for it

These are **not code tasks** — they need a human talking to another human.
Three documents were drafted this project to make that easier, but none
of them can be "sent" by me — no email tool is connected to this session,
so you'll need to send them yourself (or connect Gmail for a future
session to send them):

| Task | Document ready to use |
|---|---|
| Contact a broker (Zerodha, to start — Kite Connect is what's built) | `docs/BROKER_OUTREACH_EMAIL.md` — fill in the brackets, send from an actual signatory |
| Brief a securities/fintech lawyer | `docs/LAWYER_BRIEFING.md` — bundles the other docs below, plus specific questions on RA/RIA, DPDP, broker-agreement liability, guaranteed-returns language |
| Decide RA/RIA registration | `docs/RA_RIA_DECISION_SUPPORT.md` — **the one finding worth reading first**: Saaf Signal's own `/signal`, `/predict`, `/screener/scan` endpoints already look advisory-shaped (public, directional call + confidence score, logged as a track record) — independent of anything in Saaf Trade's execution side, which stays execution-only as long as Layer 2 stays broker-facing. Two paths laid out: register (Path A) or restructure Saaf Signal to be broker-facing only, reusing the pattern Layer 2 already uses (Path B, our lean as the faster path, but a lawyer's call) |
| Finalize a privacy policy | `docs/PRIVACY_POLICY_DRAFT.md` — grounded in the actual schema, flags the two gaps in §4 above |
| Full ordered checklist (broker empanelment + RA/RIA + DPDP) | `docs/BROKER_PARTNERSHIP_AND_COMPLIANCE_CHECKLIST.md` |

**Suggested order:** lawyer first (send the briefing) → get their RA/RIA
read → resolve the privacy policy in parallel → approach the broker →
sandbox integration test with real Kite credentials → only then real
capital.

---

## 6a. Update (2026-09-01): Saaf Signal is now a real in-process merge, not just a cross-link

The earlier "cross-linking, not a merge" status below is now out of date
for the forecast engine specifically. Saaf Signal's Python backend
(`data.py`, `indicators.py`, `forecast.py`, `outcomes.py`, `screener.py`,
`plain_english.py`, `news_events.py` — 999 lines) has been ported line-for-
line into `waynetrade-backend/src/services/forecastEngine/`, with its own
Prisma models (`ForecastPrediction`, `ForecastWatchlistItem`) in the same
Postgres database, exposed at public routes (`/signal`, `/predict`,
`/watchlist`, `/screener`, `/track-record`, `/check-outcomes`,
`/scan-watchlist` — see `src/routes/signal.js`). Layer 2's own cross-check
now calls this in-process instead of over HTTP.

`waynetrade-frontend` got a matching `SignalSection`
(`src/SignalApp.jsx`) — a ticker checker (plain-English + technical
views), a permanent Truth Board, and a watchlist — mounted in the broker
dashboard only (see `docs/RA_RIA_DECISION_SUPPORT.md` for why not the
investor view).

**Result: one backend repo, one frontend repo** for the whole product —
`waynetrade-backend` and `waynetrade-frontend` — matching what
`docs/SAAF_TRADE_INVESTOR_OVERVIEW.md` already described as built
("a unified client + broker dashboard"). `saaf-signal-backend` and
`saaf-signal-frontend` are now legacy — their code isn't deleted, but new
work should happen in the two repos above.

What's real about this vs. what isn't yet:

- **Real**: the whole port was unit-tested against synthetic OHLCV fixtures
  (`test/forecastEngine.*.test.js`, all passing, math checked by hand for
  RSI/EMA/backtest sample cases), and verified end-to-end against a real
  local Postgres via real HTTP calls — watchlist add/remove, track-record,
  error handling on a failed data fetch, all confirmed via `psql` and a
  real Playwright browser run against the real frontend.
- **Not yet real**: the actual forecast math has never run against a real
  ticker's real market data. This sandbox's egress proxy blocks
  `query1/query2.finance.yahoo.com` outright — same policy that blocks
  Render/Vercel API calls from here (confirmed separately, see the
  deployment-troubleshooting portion of this session's chat history if
  picking this up mid-deploy). `newsEvents.js` (the `/predict/:ticker/event`
  route) has the same untested status for its RSS feed + Anthropic call.
  **First thing to do once this is deployed somewhere with normal
  internet access: hit `GET /signal/RELIANCE.NS` and sanity-check the
  response.**

## 6. If you're picking this up next

1. Read this file, then `README.md` in `waynetrade-backend` for the exact
   routes/features table.
2. `DEVELOPER_GUIDE.md` has the full original technical combination plan
   if you need the "why" behind any architectural choice.
3. The single highest-value next technical step is closing the biggest
   "never verified" gap: get real Kite Connect sandbox credentials and run
   one real signal → order → protective-GTT cycle end to end.
4. The single highest-value next business step is sending
   `LAWYER_BRIEFING.md` — the RA/RIA answer it's asking for can change the
   product roadmap (Path A vs. Path B in §5), so it's worth getting before
   investing more in either direction.
