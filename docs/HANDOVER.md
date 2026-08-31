# Handover — Saaf Trade planning + full roadmap build (this session)

**Date:** 2026-08-31 (updated; original session was 2026-08-30)
**Scope of this session:** research/strategy discussion (market landscape,
SEBI compliance posture, product positioning), then a full pass through the
developer guide's build order (§7) — auto profit-booking, Layer 3 real-time
notifications, the Kite Connect equities adapter + Algo-ID tagging, and the
Layer 2 AI research assistant — all built in this repo. Everything below is
what a next developer/session needs to pick this up cold.

## 1. What was actually changed in code (this repo)

Branch: `docs/saaf-trade-planning-docs` (this doc's branch — see PR #2,
updated with each piece below rather than opening new PRs).

| File | Change |
|---|---|
| `prisma/schema.prisma` | `RiskProfile.riskRewardRatio`, `RiskDecision.takeProfit` (auto profit-booking); `Member.whatsappNumber`, `Group.brokerWhatsappNumber`, new `Notification` model (Layer 3); `Strategy.algoId`, new `ResearchSignal` model (Layer 2). |
| `src/services/riskEngine.js` | New `computeTakeProfit()` — signal's own `takeProfit` wins if present, else auto-computed from `payload.price` + member's `riskRewardRatio`, else `null`. |
| `src/services/kiteConnectBridge.js` | **New.** Kite Connect `placeOrder`, mirrors `metaApiBridge.js`'s shape and honest-gaps-comment convention. Requires `strategy.algoId` — throws rather than placing an untagged equities order. |
| `src/services/notificationService.js` | **New.** `notifyInvestorOfOrder` (per-trade, past-tense) and `notifyBrokerDigest` (batched) — both persist to `notifications` first, WhatsApp (Twilio) is best-effort on top. |
| `src/services/researchAssistant.js` | **New.** `runScan()` — fetches news (`NEWS_API_KEY`), analyzes each article with one Claude call producing a bull case/bear case/risk-supervisor LOW-MEDIUM-HIGH verdict, persists every result, sends the broker a batched digest of MEDIUM/HIGH items via `notifyBrokerDigest`. |
| `src/routes/webhook.js` | Execution dispatch refactored into a `brokerExecutors` table (`METATRADER`, `KITE_CONNECT`) instead of a single `if`; calls `notifyInvestorOfOrder` after every order outcome (filled or not). |
| `src/routes/research.js` | **New.** `GET /research/feed`, `POST /research/scan`. |
| `src/routes/onboarding.js` | Accepts `riskRewardRatio`, `whatsappNumber`, `brokerWhatsappNumber`; new `PUT /onboarding/strategy/:id/algo-id`. |
| `src/server.js` | Mounts `/research` behind `requireApiKey`. |
| `package.json` | Added `twilio`, `@anthropic-ai/sdk`. |
| `.env.example` | Documents `TWILIO_*`, `NEWS_API_KEY`, `NEWS_API_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_RESEARCH_MODEL`. |
| `README.md` | Full rewrite of "what's built"/"what's not" to match the above. |

All of the above passed `node -c` syntax checks, `npx prisma validate`, `npx
prisma generate`, and a live `node src/server.js` boot smoke test (against a
dummy `DATABASE_URL` — no real Postgres, MetaApi, Kite, Twilio, or Anthropic
credentials exist in this environment, so nothing was tested end-to-end
against a real broker/API).

## 2. Not yet done — pick these up next

- **Migration not run.** Still no `prisma/migrations` directory in this
  repo (schema-only, migrated locally per-deployment per the existing
  README convention). Whoever deploys this needs to run
  `npx prisma migrate dev --name add_take_profit_notifications_and_research`
  against a real Postgres instance.
- **Kite Connect orders have no stop-loss/take-profit enforcement yet** —
  the biggest correctness gap of this session's work. Kite Connect doesn't
  accept SL/TP on the same order call the way MetaApi does; a follow-up
  SL-M or GTT order after entry is needed and isn't built. Do not treat an
  equities order placed through this bridge as protected.
- **`riskRewardRatio` defaults to `2.0` for every new profile.** Still an
  open product question from the original session: per-member (current) or
  per-strategy default? Not decided.
- **The two "confidence" engines are unreconciled.** Layer 2's
  LOW/MEDIUM/HIGH tagging (this repo, Claude-based) and `forecast.py`'s
  sample-count-based score (`saaf-signal-backend`, Python) are parallel
  systems today, not unified. Deciding whether/how to combine them is real
  remaining work — see `docs/DEVELOPER_GUIDE.md` §7.
- **No automated tests for any of this session's code.** Verified via
  syntax checks, schema validation, and a boot smoke test only — no unit or
  integration tests were written, and none of the four external
  integrations (Postgres, MetaApi, Kite Connect, Twilio, Anthropic, a news
  API) were exercised against real credentials.
- **Unified frontend** — still not started. Both frontends remain
  untouched this session.

## 3. Repos in play

All under the `Wayneesolutions` GitHub org:

- `waynetrade-backend` — this repo, push access, changes above live here.
- `waynetrade-frontend` — push access, not modified this session. Currently
  a near-empty React scaffold (`src/App.jsx` + Vite boilerplate) — the
  README describes a fuller feature set (connect screen, kill-switch UI,
  audit trail) than what's actually implemented; treat the README as a spec
  to build against, not a description of working code.
- `saaf-signal-backend` / `saaf-signal-frontend` — public, read-only access
  this session (not attached with push credentials). If build work moves
  into these repos, `add_repo` with `access: "push"` first.

**Unresolved thread:** both `waynetrade-backend`'s and
`waynetrade-frontend`'s READMEs claim they're merged into
`arpanwayne/saaf-signal-backend` / `arpanwayne/saaf-signal-frontend` and no
longer developed. That owner/repo was not reachable or verified in this
session — unclear if it's real, stale, or a different person's fork. Worth
checking directly with whoever wrote that banner before assuming either
repo set is the current source of truth.

## 4. Context a next session won't have

- The product's actual differentiator, per the product owner's own framing
  this session: **not** "guaranteed returns" (explicitly corrected during
  this session — that framing is both false and a SEBI compliance
  violation) but **less manual effort + full transparency to the investor +
  less research burden on the broker**. Keep this framing in any investor-
  or user-facing copy.
- Target audience is explicitly Gen Z / new investors — but the SEBI
  research surfaced this session flags a real tension: regulators are wary
  of "gamified," oversimplified trading apps that reduce *understanding*
  along with effort. The safe version discussed: automate the *doing*, not
  the *knowing* — pair every automated action with a plain-language
  explanation (this is what Layer 3 is for).
- See `docs/SAAF_TRADE_INVESTOR_OVERVIEW.md` for the feature list drafted
  for an investor-facing PDF, and `docs/DEVELOPER_GUIDE.md` for the full
  technical combination plan.
