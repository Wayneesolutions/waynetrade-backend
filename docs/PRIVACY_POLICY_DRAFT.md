# Saaf Trade — Privacy Policy (DRAFT)

**This is a draft, not a published policy.** It is grounded in exactly what
this codebase actually collects and does today (traced from
`prisma/schema.prisma` and the services that write to it) — not a generic
template. It still needs a lawyer's sign-off before publishing: DPDP Act
compliance involves judgment calls (retention periods weighed against
other recordkeeping obligations, whether a Consent Manager is needed,
cross-border transfer specifics) that this document flags but does not
resolve. See `docs/BROKER_PARTNERSHIP_AND_COMPLIANCE_CHECKLIST.md` for
where this fits in the broader compliance work.

---

## 1. Who this covers

This policy applies to personal data processed by the Saaf Trade platform
(`waynetrade-backend`, `waynetrade-frontend`, and the investor-facing
`#investor` view) about:

- **Members** — individuals whose trades are executed through the platform.
- **Group admins/brokers** — the people who create and manage a group.

It does not yet cover `saaf-signal-backend`/`saaf-signal-frontend` (a
separate product with its own data flows — watchlists, predictions — that
would need its own review).

## 2. What personal data is actually collected, and why

Traced directly from the schema — nothing here is hypothetical:

| Data | Where it lives | Why it's collected |
|---|---|---|
| A user identifier (`Member.userId`) | `members` table | Identify whose trades are whose. Whatever string an admin enters — could be a name, email, or internal ID; this platform doesn't itself validate or require a specific format. |
| WhatsApp phone number (`Member.whatsappNumber`, `Group.brokerWhatsappNumber`) | `members`, `groups` tables | Deliver real-time trade notifications (Layer 3) and research digests. Optional — a member/group without one just doesn't get WhatsApp pushes. |
| Risk profile (`fixedLots`, `riskRewardRatio`, `maxDailyLossPercent`, `maxOpenPositions`) | `risk_profiles` table | Size and protect that person's own trades. Financial preference data, not identity data, but personal in the sense that it's tied to one individual. |
| Trading activity (signals, risk decisions, orders) | `signals`, `risk_decisions`, `orders` tables | The actual record of what was traded, when, why, and the outcome — this is the audit trail and transparency feed's entire purpose. |
| Notification message content (`Notification.message`) | `notifications` table | The plain-language trade explanations sent to the member — by definition, these contain personal financial detail ("BUY RELIANCE placed in your account..."). |
| A broker account reference (`Member.brokerAccountRef`) | `members` table | Points to the member's own broker account (MetaApi account ID or Kite access token) so orders go to the right place. **Not** a raw password/credential — see Security section. |
| A hashed view token (`Member.viewTokenHash`) | `members` table | Grants the member read-only access to their own data. One-way hashed — see Security section. |

**Not collected by this platform**: broker login passwords (only a
tokenized reference), payment/bank details (this platform never touches
money directly — see the non-custodial design in
`docs/SAAF_TRADE_INVESTOR_OVERVIEW.md`), government ID numbers.

## 3. Who this data is shared with, and why

- **Twilio** (WhatsApp delivery) — receives the phone number and message
  text for every notification actually sent (`notificationService.js`).
  Twilio is a US-headquartered processor; confirm their DPDP-relevant data
  handling terms before relying on this in production. This is the one
  clear cross-border transfer point in the current design — flag it to the
  lawyer specifically.
- **The member's own broker** (MetaApi.cloud / Kite Connect) — receives
  order instructions (symbol, side, quantity, stop-loss/take-profit) tied
  to the broker account reference. This is inherent to the platform's
  function — orders can't execute without reaching the broker.
- **Anthropic (Claude API)** — receives news article text for Layer 2's
  analysis (`researchAssistant.js`). This is market news content, not
  member personal data — no member-identifying information is sent to
  Anthropic anywhere in the current code.
- **`saaf-signal-backend`** (optional, if `SAAF_SIGNAL_API_BASE` is
  configured) — receives only a ticker symbol for the forecast cross-check
  (`GET /signal/{ticker}`), never any member data.

Nothing here is sold to third parties or used for advertising — there is
no ad-tech or marketing-data-broker integration anywhere in this codebase.

## 4. Consent and lawful basis

**Not yet implemented in the product.** Today, an admin enters a member's
`whatsappNumber` and other data via the onboarding form
(`waynetrade-frontend`'s Add Member form) — there is no consent-capture
step in that flow asking the member themselves to agree to data
processing before their number is stored and used. Under the DPDP Act,
consent should generally come from the Data Principal (the member)
directly, not be entered on their behalf by a third party (the admin),
except where another lawful basis applies (e.g. "certain legitimate
uses"). **This is a real gap to close, not just a documentation
exercise** — likely needs either (a) a consent-capture step before a
member's data is processed, or (b) a lawyer's confirmation that a specific
DPDP-recognized legitimate-use ground applies here without separate consent.

## 5. Retention

**Not yet implemented — no automatic deletion exists anywhere in this
codebase.** Every table above grows indefinitely; there is no job that
purges old signals, orders, or notifications. Two things are in tension
here, and reconciling them needs legal input, not just an engineering
decision:

- DPDP's data-minimization principle points toward deleting personal data
  once its purpose is served (e.g. a member's data after they're
  `REMOVED` and enough time has passed).
- Financial audit-trail obligations (SEBI recordkeeping requirements, and
  simply "an investor should be able to see their own multi-year history")
  point toward *not* deleting trade records — the whole "honesty ledger"
  design principle behind this platform depends on records not
  disappearing.

Recommendation to bring to the lawyer: define a retention period tied to
applicable financial-recordkeeping rules (commonly multi-year for broker/
advisory records), and only purge personal *contact* data (WhatsApp
numbers) faster/separately from the *trade* records if legally sound to
do so.

## 6. Data Principal rights (what a member can currently do)

- **Access their own data**: yes, today — the `#investor` view (see
  `waynetrade-frontend`) shows a member their own orders, notifications,
  and audit trail.
- **Correct their data**: partial — an admin can update a risk profile
  (`PUT /onboarding/member/:id/risk-profile`); there's no member-initiated
  correction flow, and no way for a member to update their own
  `whatsappNumber` without going through an admin.
- **Withdraw/erasure**: partial — `DELETE /onboarding/member/:memberId`
  soft-deletes (status `REMOVED`, stops trading, per this session's work)
  but does **not** erase the underlying personal data, for the retention
  reasons in §5. A true "erase my data" request would need a real deletion
  path this codebase doesn't have yet — flag to the lawyer whether
  anonymization (keep the trade record, strip the identifying fields)
  satisfies this instead of hard deletion.
- **Grievance redressal**: not implemented — there is no designated
  contact/Grievance Officer named anywhere in the product yet. DPDP
  requires one to be published. Placeholder needed: `[Grievance Officer
  name/contact — TBD]`.

## 7. Security measures already in place (factual, not aspirational)

- Broker credentials are never stored raw — `brokerAccountRef` is a
  tokenized reference (see `README.md`'s Security notes).
- Webhook secrets are AES-256-GCM encrypted at rest, decrypted only at
  verification time.
- View tokens are SHA-256 hashed at rest, shown in plaintext exactly once,
  and scoped per-member (verified this session: one member's token cannot
  access another's data — see `docs/HANDOVER.md`).
- Admin routes require a shared API key; investor routes require a
  separate, narrower per-member token — two distinct auth boundaries, not
  one shared secret for everyone.

## 8. Breach notification

**Not implemented.** DPDP requires notifying the Data Protection Board and
affected Data Principals of a personal data breach. There is currently no
incident-response process, no logging/alerting for unauthorized access
patterns, and no designated owner for this. This needs a real operational
runbook, not just a policy sentence — flag as a priority alongside the
broker-empanelment operational-readiness gaps already noted in
`docs/BROKER_PARTNERSHIP_AND_COMPLIANCE_CHECKLIST.md`.

## 9. What to do with this document

1. Send it to a lawyer alongside the compliance checklist.
2. Resolve §4 (consent capture) and §5 (retention) — these need actual
   product/legal decisions, not just wording.
3. Fill in the Grievance Officer placeholder in §6.
4. Only then publish a real, binding privacy policy — this draft is not it.
