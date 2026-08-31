# RA/RIA Registration — Decision Support

**What this is:** a feature-by-feature classification of the actual
product (both `waynetrade-backend`/`-frontend`, "Saaf Trade", and
`saaf-signal-backend`/`-frontend`, "Saaf Signal") against the line between
execution and investment advice, so the RA/RIA decision can be made
quickly and specifically rather than as one vague yes/no. **This is our
own technical read, not a legal conclusion** — send this to
`LAWYER_BRIEFING.md`'s recipient for confirmation before acting on it.

## The legal test, recap

Research Analyst (RA) registration is needed to publish
research/recommendations. Investment Adviser (RIA) registration is needed
to advise on a personalized basis. Neither is needed for pure
**execution** — automating a strategy the client or broker already decided
on, and explaining what already happened. The line: does the platform
ever generate and surface its *own* forward-looking buy/sell call to a
retail user, or does it only execute/report on calls someone else made?

## Feature-by-feature classification

### Execution only — no registration needed on this basis

| Feature | Where | Why it's execution, not advice |
|---|---|---|
| Risk engine (kill-switch, mandatory stop-loss, position sizing) | `riskEngine.js` | Enforces limits on a trade someone else's strategy already decided on. Never originates a buy/sell call. |
| Auto profit-booking | `riskEngine.js`'s `computeTakeProfit` | A mechanical ratio applied to the member's own configured risk tolerance — not a judgment about the market. |
| Webhook-triggered order execution | `webhook.js` | The strategy is the group admin's own TradingView Pine Script or custom model (`Strategy.sourceType`) — Saaf Trade executes it, never generates it. |
| Kite/MetaTrader order placement, Algo-ID tagging | `kiteConnectBridge.js`, `metaApiBridge.js` | Pure execution plumbing. |
| Layer 3 transparency notifications | `notificationService.js` | Explains what **already happened**, past tense ("bought X, here's why") — never a forward-looking instruction. This phrasing choice is deliberate and load-bearing; changing it to anything forward-looking ("you should now...") would move this into advice territory. |
| Investor view (`#investor`) | `waynetrade-frontend` | Shows the investor their own historical data. No recommendation surface anywhere in it. |

### Currently broker-facing only — must STAY that way, or this changes

| Feature | Where | Current design | The constraint |
|---|---|---|---|
| Layer 2 AI research assistant | `researchAssistant.js`, `/research/feed`, `/research/scan` | Admin-API-key protected — only the broker/admin sees it, never surfaced to a retail investor anywhere in the current frontend. | **This is what currently keeps Layer 2 out of advisory territory.** If Layer 2's output is ever shown directly to a retail investor (e.g. added to the `#investor` view, or a future public app), it becomes a forward-looking call surfaced to retail — that's the RA-registration trigger. Treat "keep this broker-facing" as a hard product constraint, not a preference, until/unless registration is in place. |

### Already advisory-shaped as built — the finding to lead with

| Feature | Where | Why this reads as advice, not execution |
|---|---|---|
| `GET /signal/{ticker}`, `/signal/{ticker}/explain` | `saaf-signal-backend/app/main.py` | Returns a directional call (`technical_direction`: bullish/bearish/neutral) with a numeric confidence score, to **anyone who calls the endpoint** — and `saaf-signal-frontend` is a public website, not broker-gated. |
| `POST /predict/{ticker}`, `/predict/{ticker}/explain` | same | Same directional call, additionally logged permanently as an official tracked call — this is systematic, published, repeatable output, which is closer to the RA definition than a one-off opinion. |
| `GET /screener/scan` | same | Proactively surfaces "notable technical signals right now" across a universe of stocks — broader than a single user's query, closer to published research. |

**Our read: this is the piece most likely to need RA registration as
currently built**, independent of anything in `waynetrade-backend`. The
existing disclaimer text ("Educational forecast... Not financial advice")
does not appear to exempt this — SEBI's stated position (per the research
that informed this project, see `HANDOVER.md`'s early sessions) is that
educational framing does not exempt a directional call from being treated
as advice.

## Two paths forward

**Path A — Register.** Pursue RA registration for the entity operating
Saaf Signal. Needed regardless if the product intends to keep publishing
`technical_direction` + confidence directly to the public. Timeline and
requirements: see `BROKER_PARTNERSHIP_AND_COMPLIANCE_CHECKLIST.md` Track
2 — get current specifics from the lawyer, this space has moved fast.

**Path B — Restructure to stay execution-only, faster to ship.** Apply
the same pattern already working for Layer 2: make Saaf Signal's
forecast output **broker-facing only** (e.g. a broker's own registered
research team consumes it as a tool, or it feeds into a broker-approved
strategy that a user then explicitly opts into) rather than publishing
`technical_direction`/confidence directly to an anonymous public endpoint.
Concretely: gate `saaf-signal-frontend` and the `/signal`, `/predict`,
`/screener` endpoints behind the same kind of broker/admin auth Layer 2
already uses, or repurpose the forecast engine as an internal signal
source for a Saaf Trade strategy (still executed as "the broker's/user's
own strategy," not "Saaf Trade telling you what to buy").

**Our lean, for what it's worth**: Path B is very likely the faster path
to market, since it reuses an access-control pattern that's already built
and tested (Layer 2's broker-only gating) rather than waiting on a
registration process. But this is a product/business tradeoff — Path A
keeps Saaf Signal's current public-facing value proposition ("check any
stock's honest forecast") intact, which Path B would remove or narrow.
Get the lawyer's read on whether Path B's restructuring is sufficient to
avoid registration, or whether it's still needed regardless — don't build
Path B assuming it's a clean exemption without that confirmation.
