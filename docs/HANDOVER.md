# Handover — Saaf Trade planning + profit-booking (this session)

**Date:** 2026-08-30
**Scope of this session:** research/strategy discussion (market landscape,
SEBI compliance posture, product positioning) + one concrete backend feature
+ these three planning docs. Everything below is what a next
developer/session needs to pick this up cold.

## 1. What was actually changed in code (this repo)

Branch: `docs/saaf-trade-planning-docs` (this doc's branch — see PR).

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `RiskProfile.riskRewardRatio` (default `2.0`) and `RiskDecision.takeProfit`. |
| `src/services/riskEngine.js` | New `computeTakeProfit()`: signal's own `takeProfit` wins if present; else auto-computed from `payload.price` + member's `riskRewardRatio`; else `null` (unchanged behavior). Wired into `evaluateSignalForMember`. |
| `src/routes/webhook.js` | Order placement now uses `decision.takeProfit` (engine-resolved) instead of raw `req.body.takeProfit`; also now forwards `riskRewardRatio` into the engine call (it wasn't being passed before — without this fix the feature would silently never fire). |
| `src/routes/onboarding.js` | Both member-creation and risk-profile-update endpoints accept `riskRewardRatio`. |
| `README.md` | Documents the new behavior and its two honest gaps (needs a reference `price` on the signal; no trailing stop). |

**Why:** the product owner's complaint was that profit-booking almost never
fired in practice — stop-loss and kill-switch were the only exits that
actually happened, because `takeProfit` was only ever set if the incoming
TradingView signal happened to include one manually. This makes it
automatic, computed from each member's own risk tolerance, and enforced at
the broker level exactly like stop-loss already is (no new polling/
monitoring service needed — MetaApi accepts both on the same order).

## 2. Not yet done — pick these up next

- **Migration not run.** No `prisma/migrations` directory exists in this
  repo at all (schema-only, migrated locally per-deployment per the
  existing README convention). Whoever deploys this needs to run
  `npx prisma migrate dev --name add_take_profit_and_risk_reward_ratio`
  against a real Postgres instance.
- **`riskRewardRatio` defaults to `2.0` for every new profile.** Open
  product question: should this be a per-member setting (current
  implementation) or a per-strategy default an admin sets once? Not decided
  in this session — flagged to the product owner, no answer yet.
- Everything in `docs/DEVELOPER_GUIDE.md` §5 (equities adapter/Algo-ID,
  Layer 2 research assistant, Layer 3 event-driven notifications) — none of
  it is built. This session was planning + one execution-layer fix.

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
