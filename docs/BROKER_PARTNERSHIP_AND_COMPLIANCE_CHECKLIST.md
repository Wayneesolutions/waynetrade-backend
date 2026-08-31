# Saaf Trade — Broker Partnership & Compliance Checklist

**What this document is not:** legal advice. Nothing below substitutes for
a securities lawyer and a company secretary actually reviewing this
business before it touches real money. What this document *is*: a
practical, ordered checklist of the business/legal steps that sit outside
what code can do, written so the team knows what to go do and in what
order — connecting each step to what's already built (see
`DEVELOPER_GUIDE.md`, `README.md`) so nothing gets re-explained from
scratch to a lawyer or a broker's onboarding team.

## Two separate tracks — don't conflate them

1. **Broker empanelment** — getting a SEBI-registered broker to execute
   trades through this platform. Needed for *any* version of Saaf Trade
   that executes real orders.
2. **Advisory registration (RA/RIA)** — needed *only if* Saaf Trade itself
   issues forward-looking buy/sell calls to retail users, rather than only
   automating a broker's or user's own already-decided strategy. See
   "Which track applies" below before assuming both are needed.

---

## Track 1: Broker empanelment

### Step 0 — decide which broker(s), for which asset class

- **Equities (NSE/BSE)**: candidates are brokers with a public API —
  Zerodha (Kite Connect, already the one this codebase targets), Angel One
  (SmartAPI), Upstox, ICICI Direct (Breeze), Fyers. Pick one to pilot with
  before building more adapters (`kiteConnectBridge.js` already exists for
  Zerodha; anything else needs a new adapter against that broker's actual
  docs, not built speculatively — see `DEVELOPER_GUIDE.md` §5a).
- **Forex/crypto (MetaTrader)**: candidates are MT4/5 brokers reachable via
  MetaApi.cloud. Note the earlier research in this project's history: retail
  forex/CFD brokers serving Indian residents are typically **not**
  SEBI-registered the way equities brokers are, and FEMA/RBI rules
  constrain trading with non-Authorised-Dealer overseas brokers. Confirm
  the specific broker's regulatory status before treating this track the
  same way as the equities track.

### Step 1 — confirm what SEBI's framework actually requires of them

SEBI's retail algo-trading framework (fully in force since April 1, 2026)
makes the **broker the principal**, legally responsible for every order —
Saaf Trade is their **agent**. Concretely, before a broker will move
forward:

- They must register at least one Saaf Trade algo/strategy with the
  exchange in their own name, and get back an **Algo-ID** that every order
  must carry (`Strategy.algoId` in this codebase already exists to hold
  it, and `kiteConnectBridge.js` already refuses to place an equities order
  without one — this is not a future step, it's already enforced).
- They'll want to see the technical controls before empanelling anyone:
  kill-switch, audit trail, risk limits. All of this already exists and is
  documented in `README.md`'s "What's actually built" section — point them
  there directly rather than re-describing it in a pitch deck.

### Step 2 — prepare the package a broker's onboarding/compliance team will ask for

- A written description of the system (use `SAAF_TRADE_INVESTOR_OVERVIEW.md`
  as the base, broker-facing version may need less "why trust us" framing
  and more technical specificity from `README.md`).
- Confirmation of **non-custodial** design — Saaf Trade never holds client
  funds or securities, only sends orders on the client's own broker
  account. This is core to the pitch, not a footnote.
- A sample of the audit trail / risk-decision logging (the `risk_decisions`
  and `orders` tables, or the dashboard views of them).
- Answers to questions they *will* ask, honestly, from the existing gap
  lists rather than glossing over them:
  - Has this been run against a live/demo account with this broker
    specifically? (Currently: no — see the honest gaps in
    `kiteConnectBridge.js`/`metaApiBridge.js`.)
  - What happens if the platform goes down mid-trade? (Currently: no
    answer beyond "the entry order that already fired stands" — this is a
    real question to have an answer ready for.)
  - What's the incident/kill-switch escalation path? (The kill-switch
    exists; an actual *operational* runbook — who gets paged, how fast —
    does not yet.)

### Step 3 — commercial terms to negotiate (get a lawyer for the actual contract)

- Revenue share / fee structure.
- Liability allocation — especially for a bug in Saaf Trade's risk engine
  that causes a bad trade. Standard vendor agreements will try to push
  this fully onto the vendor (us); know that going in.
- SLA on uptime/latency for the webhook → risk-engine → order pipeline.
- Data-sharing terms — what member data the broker needs vs. what Saaf
  Trade should never share (see the DPDP note under Track 3 below).

### Step 4 — technical integration

- Sandbox/UAT credentials from the broker — this is the first point where
  `metaApiBridge.js`/`kiteConnectBridge.js` can actually be exercised
  against something real, closing the single biggest honest gap repeated
  throughout this codebase's comments ("has NOT been run against a real
  account").
- Run one full signal → risk engine → order → notification cycle in the
  sandbox before any real capital, and specifically verify the Kite
  protective-GTT step (`placeProtectiveExit`) actually places a working
  stop-loss on their sandbox — this is the piece flagged as never verified
  end-to-end.

---

## Track 2: Advisory registration (RA/RIA) — only if applicable

**Which track applies:** if Saaf Trade only ever executes a strategy the
broker registered or a user configured themselves (current design), this
track likely does not apply — that's execution, not advice. It **does**
apply the moment Layer 2's research output (or anything else) is shown to
a retail user as "here's what to buy," rather than "here's what already
happened and why," or the moment any marketing implies Saaf Trade is
telling people what to trade. Get a lawyer's read on where the current
product actually sits before assuming either answer.

If it does apply:

- **Research Analyst (RA) registration** — needed to publish research/calls.
- **Investment Adviser (RIA) registration** — needed to advise on a
  personalized basis.
- Both require NISM certification, meeting SEBI's deposit requirements
  (graduation is now the minimum qualification, prior-experience
  requirement removed per SEBI's 2024-2025 easing — confirm current rules
  with a lawyer, this space has moved fast), and registering through
  SEBI's online intermediary system.
- SEBI's AI Accountability Framework requires disclosing the extent of AI
  use in any research service — relevant the moment Layer 2's output
  reaches a retail user directly rather than staying broker-facing (as it
  currently is, per `README.md`).

---

## Track 3: General legal/compliance review — do this regardless

- **No guaranteed-return language, anywhere** — not in the app, not in
  marketing, not in a sales conversation. This was corrected once already
  in this project's own history (see `HANDOVER.md`) precisely because it's
  the single most common feature of the schemes SEBI prosecutes. Get this
  into the actual Terms of Service as an explicit statement, not just app
  copy.
- **Non-custodial statement in the Terms of Service** — explicit, not
  implied, that Saaf Trade never holds client funds/securities.
- **DPDP Act 2023 (India's data protection law) — a real, concrete gap not
  yet addressed anywhere in this codebase.** This platform now stores
  members' WhatsApp numbers (`Member.whatsappNumber`) and generates
  detailed personal-financial messages sent to them
  (`notificationService.js`). That's personal data under the DPDP Act.
  Needed: a privacy policy, a lawful basis for processing, and a data
  retention/deletion policy — none of which exist yet. This should not
  wait for the broker-partnership track; it applies to the code as it
  exists today, with or without a broker.
- **Terms of Service / liability disclaimers** for the platform itself,
  separate from any single broker's contract.
- **A named compliance owner** — someone whose job it is to keep this list
  current as SEBI's rules keep changing (this document's own SEBI-framework
  citations are already time-sensitive; verify against SEBI's current
  circulars before acting on any specific number/date above).

## Suggested order of operations

1. Engage a securities lawyer — before, not after, any broker conversation.
   Bring them `SAAF_TRADE_INVESTOR_OVERVIEW.md` and this document.
2. Get their read on Track 2 (RA/RIA) applicability now, while the product
   is still small — cheaper to adjust the design than to retrofit registration.
3. Draft the DPDP-compliant privacy policy (Track 3) — this doesn't block
   on the lawyer conversation above and can start in parallel.
4. Approach one broker (Step 0-1 above) for equities, using the technical
   package that already exists.
5. Sandbox integration test (Step 4) — this is also where the single
   biggest technical honest-gap (never run against a real account) finally
   gets closed.
6. Only then: real capital, and only after Track 3's items are actually
   done, not just planned.
