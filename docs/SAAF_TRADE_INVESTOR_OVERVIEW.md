# Saaf Trade — How the Software Works

*Feature overview drafted for an investor-facing PDF. "Saaf" means "clean/
honest" in Hindi/Urdu — the name is the pitch: a trading platform built
around transparency rather than hype.*

## The problem

Two separate gaps, today:

1. **Retail investors** who want to trade systematically either have to
   watch the market constantly themselves, or hand money to schemes that
   promise returns no market can actually guarantee — with no visibility
   into what's actually happening to their money in between.
2. **Brokers** who want to offer disciplined, automated trading to clients
   spend enormous manual hours on research (scanning news, filings, and
   global events for what might move a sector) and on monitoring open
   positions around the clock — work that doesn't require a human doing it
   by hand.

## The solution, in one line

Saaf Trade sits between a SEBI-registered broker and their clients: it
automates disciplined trade execution and research, and gives the client
full, honest visibility into every decision made with their money — without
Saaf Trade ever holding client funds itself.

**What we do not promise: guaranteed returns.** No trading system can
promise that, and any platform that implies it is exactly the pattern
regulators shut down. What we promise instead: **every trade follows
pre-agreed risk rules without exception, and every outcome — win or loss —
is shown with equal weight, permanently.**

## Who holds the money and executes the trade

The client's own SEBI-registered broker — always. Saaf Trade never takes
custody of client funds or securities. This is a deliberate design choice,
not just a compliance requirement: it's structurally safer for the investor
(their money never leaves a regulated broker's custody), and it means Saaf
Trade operates as the broker's technology partner under SEBI's retail
algo-trading framework, rather than as an unregulated fund manager.

## Core features

### 1. Automated, rule-based execution ("the robot")
- A trading strategy or signal (from a broker's system, a AI-flagged
  research signal, or a client's own configured rules) is executed
  automatically — no one has to sit and place the trade by hand.
- **Every single trade carries a mandatory stop-loss.** A signal with no
  stop-loss is rejected outright, no exceptions, no manual override.
- **Automatic profit-booking**, sized to each client's own risk tolerance —
  the system locks in gains at a pre-agreed target without anyone needing
  to remember to do it. (Previously, in early testing, this step was
  routinely skipped because it depended on someone remembering to set it
  manually — it's now fully automatic.)
- **Position sizing matched to each individual's own risk profile** — never
  a one-size-fits-all number guessed on their behalf.

### 2. Kill-switch — a manual safety net, always logged
- Any client, or the broker, can pause trading for one person or an entire
  group instantly.
- Every kill-switch action requires a stated reason and is permanently
  recorded — no silent pauses, and no silent resumes either.

### 3. Full transparency, in real time
- Every trade, the moment it happens, generates a plain-language
  explanation delivered to the client — on WhatsApp and in the dashboard —
  of what happened and why (what news or signal triggered it).
- A permanent, honest track record: every prediction and every trade
  outcome is logged the moment it's made, and stays visible whether it was
  right or wrong. Nothing is hidden or deleted after the fact.
- Clients can see their full history at any time, not just what's convenient
  to show.

### 4. An AI research assistant — for the broker, not a black box for the client
- Continuously scans global news, company filings, and market events,
  flagging what's actually likely to move a specific sector or stock.
- Cuts the hours a broker's research team spends manually scanning the
  news every day.
- Every AI-flagged signal is explainable — grounded in real historical
  pattern-matching and cited sources, not an unexplained "the AI says so."
  Confidence scores are calculated from how often similar setups have
  actually played out in the past, and are deliberately capped low when
  there isn't enough historical data to trust a number.

### 5. Built for the regulatory environment we're actually in
- Aligned with SEBI's retail algorithmic trading framework (fully in force
  since April 2026): every algorithmic order can carry the exchange-assigned
  Algo-ID required for full traceability, and the broker remains the
  accountable, principal party for every trade, exactly as the framework
  requires.
- Non-custodial by design (see above) — this keeps the platform out of
  fund-management/portfolio-management licensing territory entirely.
- AI usage is disclosed, not hidden, in line with SEBI's expectations for
  any AI-assisted research or advisory activity.

## Who it's for

- **Brokers** who want to offer modern, automated, transparent trading to
  their clients without building all of this in-house, and who want their
  research team's time spent on judgment calls instead of manual news
  scanning.
- **A new generation of investors** (Gen Z and other first-time investors)
  who want to participate in the market without needing to become
  full-time chart-watchers — while still genuinely understanding what's
  happening to their money, not just clicking a button and hoping.

## What's built today vs. what's on the roadmap

We believe in showing this honestly, including to investors in the company:

**Built:**
- Full risk engine — kill-switch, mandatory stop-loss, per-person position
  sizing, automatic profit-booking, complete audit trail of every decision.
- Forex/commodity execution via MetaTrader-connected brokers.
- Honest forecast engine with a real, verifiable track record (predictions
  logged permanently, checked against real outcomes, confidence scores
  grounded in historical data, never invented).
- WhatsApp + dashboard delivery infrastructure (currently scheduled;
  becoming real-time next).

**In progress / next:**
- Indian equities execution (NSE/BSE), including exchange Algo-ID tagging,
  through empanelled broker partnerships.
- The continuous AI research-assistant layer described above (today it can
  look up news for a single stock on request; the always-on, sector-wide
  version is the next build).
- Real-time (rather than scheduled) trade notifications.
- A unified client + broker dashboard.

## The honest bottom line

Saaf Trade's differentiator isn't a promise of better returns — it's that
we make the mechanics of trading discipline (stop-loss, profit-booking,
risk sizing, and full disclosure of every outcome) automatic and impossible
to skip, for both the broker and the client, in a market where that
discipline is usually the first thing people abandon.
