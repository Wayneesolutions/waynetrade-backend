# Briefing Document for Legal Counsel

**Purpose:** send this to a securities/fintech lawyer before your first
meeting, so the meeting starts at "here's our read, tell us if we're
wrong" instead of explaining the business from zero. Attach the three
documents listed under "What to send alongside this."

## What to send alongside this

1. `SAAF_TRADE_INVESTOR_OVERVIEW.md` — what the product does, in plain
   language.
2. `BROKER_PARTNERSHIP_AND_COMPLIANCE_CHECKLIST.md` — our own reading of
   the compliance landscape (broker empanelment + RA/RIA + DPDP), written
   by a technical team, explicitly not a legal document — treat as a
   starting point to correct, not a conclusion to rubber-stamp.
3. `PRIVACY_POLICY_DRAFT.md` — a first-pass privacy policy draft, grounded
   in the actual data the platform collects.
4. `RA_RIA_DECISION_SUPPORT.md` — a feature-by-feature breakdown of what
   in the product looks like advice vs. execution, and the one finding we
   think is significant enough to lead with (see below).

## The one thing to lead with

**Our own read is that the forecast/signal engine (a separate but related
product, "Saaf Signal") already looks like it's publishing investment
research to retail users** — it returns a directional call
("technical_direction": bullish/bearish) with a numeric confidence score,
to anyone who calls the endpoint, logged as a permanent track record. We
think this needs a Research Analyst (RA) registration read *before* it
goes further, not after. See `RA_RIA_DECISION_SUPPORT.md` for the specific
endpoints and why we read it this way — we'd like your view on whether
that read is right, and if so, what the fastest compliant path is
(register, restrict the audience, or restructure the output).

## Questions we specifically want answered

1. **RA/RIA applicability** — does the "Saaf Signal" forecast engine (see
   above) require Research Analyst registration as currently designed?
   Does the "Saaf Trade" execution layer, on its own (automating a
   broker's or user's own already-decided strategy, never generating its
   own buy/sell call), require anything beyond broker empanelment?
2. **Broker empanelment liability** — under SEBI's retail algo-trading
   framework (broker as principal, us as agent), what liability exposure
   should we expect in a typical broker vendor agreement, and what should
   we push back on?
3. **DPDP Act compliance** — review `PRIVACY_POLICY_DRAFT.md` specifically
   for its two flagged open gaps: (a) we currently have no consent-capture
   step before an admin enters a member's WhatsApp number and other data —
   is that a problem as-is, or does a specific DPDP "legitimate use" ground
   cover it? (b) we have no data retention/deletion policy — what
   retention period should we actually implement, given tension between
   data-minimization and financial-recordkeeping obligations?
4. **Guaranteed-returns language** — confirm our Terms of Service (not yet
   drafted — see "what we still need from you" below) explicitly rules out
   any return-guarantee language, and get your read on how far
   "transparency" marketing claims can go without crossing into misleading
   advertising territory.
5. **Cross-border data transfer** — we use Twilio (US-based) for WhatsApp
   delivery, which receives member phone numbers and message content. Does
   this need a specific DPDP-compliant data processing agreement, and does
   Twilio's own terms satisfy it?
6. **Entity structure** — should broker-empanelled execution and (if
   applicable) RA-registered research sit in the same legal entity, or
   does separating them reduce risk/complexity? (Flagging this because we
   genuinely don't know and it affects how the rest of this list gets
   answered.)

## What we still need from you (not just answers — deliverables)

- Terms of Service (we have none yet).
- A finalized, publishable privacy policy (built from the draft, once §3
  above is resolved).
- A written opinion on the RA/RIA question specifically — this is the one
  item most likely to change the product roadmap, so we'd like it in
  writing, not just verbal guidance.
- Review of the broker vendor agreement once we have a candidate broker
  and their draft contract in hand (separate, later engagement).

## Context on where things stand technically (for your reference, not a question)

The execution/risk-engine side (kill-switch, mandatory stop-loss, audit
trail, Algo-ID tagging) is built and has passed our own end-to-end
verification against a real database — see `README.md` in
`waynetrade-backend` for the honest "what's built vs. not" list. No real
broker account, Twilio account, or Anthropic account has been used yet —
everything has been verified against local test infrastructure only. We
are not asking you to review code; flagging this only so the compliance
picture you're advising on matches where the product actually is, not
where a pitch deck might imply it is.
