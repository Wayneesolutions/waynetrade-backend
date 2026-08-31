# Broker Outreach — Email Template

**How to use this:** fill in the brackets, pick the right recipient (see
"Who to send this to" below), and send from whoever is the actual
signatory/founder — not from an unnamed company address. Keep it to this
length; a broker's partnerships team gets a lot of these and a short,
concrete email gets read faster than a long pitch deck attached cold.

This is deliberately not oversold — it says what's built and tested, and
says plainly what isn't, matching the same honesty standard the product
itself is built around (see `SAAF_TRADE_INVESTOR_OVERVIEW.md`). A broker's
compliance team will check claims against reality; overselling here costs
more than it gains.

---

## Who to send this to

- **Zerodha (Kite Connect)**: their developer/partnerships channel — check
  [kite.trade](https://kite.trade) for current partner-onboarding contact
  details; this codebase is already built against their published API.
- **Angel One (SmartAPI)**, **Upstox**, **ICICI Direct (Breeze)**: each has
  its own developer/partner program — check their respective developer
  portals for a partnerships or API-partner contact form/email, since
  direct contact emails change over time.
- For a **MetaTrader/forex broker**: contact their institutional/partner
  desk directly, and separately confirm their regulatory status per
  `BROKER_PARTNERSHIP_AND_COMPLIANCE_CHECKLIST.md`'s Step 0 note before
  investing time here — this track has a real open regulatory question
  attached to it that the equities track doesn't.

---

## The email

**Subject:** Algo-trading platform seeking empanelment — [Saaf Trade / your company name]

Hi [Name / Team],

I'm [your name], [your role] at [company name], building **Saaf Trade** — a
non-custodial algo-trading execution and risk-management layer for Indian
retail investors. We'd like to explore becoming an empanelled algo
provider on [Broker name], under SEBI's retail algo-trading framework.

**What we've built, concretely:**
- A risk engine that enforces mandatory stop-loss and automatic
  profit-booking on every trade — no signal without a stop-loss is ever
  executed.
- A kill-switch (pause any client or an entire group instantly, every
  action logged with a reason) and a complete, permanent audit trail of
  every risk decision.
- SEBI Algo-ID tagging built into our order-placement path — every
  equities order carries the exchange-assigned Algo-ID once a strategy is
  registered; we will not send an order without one.
- Real-time transparency: every trade generates a plain-language
  explanation delivered to the client, logged permanently regardless of
  outcome.
- Fully non-custodial by design — we never hold client funds or
  securities; every order routes to the client's own account at [Broker
  name].

**What we haven't done yet, said plainly:** our integration is built
against your published API but has not yet been run against a live or
sandbox account — that's exactly the next step we're hoping to take with
you. We'd rather say this upfront than have it surface later.

**What we're asking for:**
1. Information on your empanelment process for a retail algo-trading
   partner under SEBI's framework.
2. Sandbox/UAT access to validate our integration end-to-end before
   anything touches a live account.
3. A call to walk through our technical architecture and answer any
   compliance questions your team has.

Happy to share a full technical writeup or get on a call at your
convenience.

Best,
[Your name]
[Title, company]
[Phone / email]

---

## Before you send this

- Confirm the specific broker's current empanelment/partner process hasn't
  changed from what's assumed above — check their developer portal directly.
- Have `SAAF_TRADE_INVESTOR_OVERVIEW.md` ready to attach or link if asked
  for more detail.
- Don't send this to multiple brokers' teams from the same thread —
  personalize the broker name and send separately; a broker's compliance
  team can tell when an email was mass-sent.
