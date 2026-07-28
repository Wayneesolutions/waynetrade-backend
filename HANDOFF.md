# WayneTrade — Developer Handoff (July 29, 2026)

Status of the implementation against `WayneTrade_Developer_Guide.docx`.
For: Sant, Mandeep, Noor, Ritvik. A formatted copy exists as
`WayneTrade_Dev_Handoff.docx` (shared separately).

## 1. Where the code is

**Pushed to GitHub, NOT yet merged into `main`.** Branch
`feat/complete-phase2-gaps` on both repos, PRs open:

- Backend: https://github.com/Wayneesolutions/waynetrade-backend/pull/1
- Frontend: https://github.com/Wayneesolutions/waynetrade-frontend/pull/1

Merge the backend first, run the migration (Section 4), then the frontend.

## 2. What is DONE

| Area | What it does | Status |
|---|---|---|
| Webhook ingestion | HMAC-signed TradingView/custom webhook; raw signal logged immutably; secrets AES-256-GCM at rest | Earlier |
| Risk engine | Kill-switch check → hard stop-loss → per-member sizing; every decision recorded | Earlier |
| Kill-switch | Member pause/resume, group pause; reason required, logged, notified | Upgraded |
| Per-user auth (RBAC) | `users` table, bcrypt, JWT login (12h), ADMIN/MEMBER roles; members act only on themselves; legacy `X-Api-Key` still accepted as ADMIN | **NEW** |
| Live P&L / positions | MetaApi balance/equity/positions reads; live dashboard routes; equity snapshots feed the chart | **NEW** |
| Notifications | Telegram: signal results, order errors, kill-switch events; optional; never blocks trading | **NEW** |
| Backtesting | `backtest/` stdlib-only Python backtester mirroring live risk rules; sample-data generator; verified | **NEW** |
| Kite Connect scaffold | Kite v3 order placement with SEBI Algo-ID tagging; hard-gated behind `KITE_ENABLED=true`; refuses untagged orders | **NEW (gated off)** |
| Member/strategy lifecycle | Edit/remove member (soft, audit-logged), rename/archive strategy | **NEW** |
| Dashboard UI | Live accounts panel, equity charts, edit/remove modals, rename/archive + everything from before | Upgraded |

Verified: `node --check` on all files; Prisma schema validates; server boots
and 401s bad credentials; Vite build + oxlint clean; backtester runs
end-to-end on sample data.

## 3. What is PENDING

### Requires a human / real accounts (cannot be coded)

1. **First real MetaApi test** — zero real API calls so far. Create a
   MetaApi.cloud account, provision a demo MT5 account, set
   `METAAPI_TOKEN` + `METAAPI_BASE_URL` (region!), run one signal
   end-to-end. This is the Phase 1 exit criterion.
2. **SEBI Algo-ID registration** — confirm the broker's actual process;
   the `tag`-field approach must be validated with them.
3. **Legal/compliance review** (guide Section 6) — before any real money;
   Kite stays disabled until this is done.
4. **Broker choice for the pilot** — confirm MetaApi support and costs.

### Code (next build tasks)

- Frontend login view for the per-user auth (dashboard still connects via
  the shared admin key).
- Scheduled equity polling worker (snapshots currently accrue only while
  the dashboard is used).
- Per-position detail table in the UI (backend already returns positions).
- Kite production hardening (daily token login handoff, instrument/lot-size
  master, paired stop-loss order) — only after the human items above.
- Backtester realism: slippage/spread/commissions, or vectorbt for sweeps.

## 4. Deploy steps after merging the backend PR

1. `npx prisma migrate dev --name add_users_equity_snapshots_strategy_archived`
2. Set `JWT_SECRET` (required); optional `TELEGRAM_BOT_TOKEN` +
   `TELEGRAM_CHAT_ID`. Leave `KITE_ENABLED` unset/false.
3. Bootstrap the first admin: `POST /auth/bootstrap-admin` (works only
   while the users table is empty), then `POST /auth/users` per member.
4. Existing dashboard connections keep working — `ADMIN_API_KEY` is still
   accepted as ADMIN.
5. Merge/deploy the frontend (Vercel static build).

## 5. Key files

| File | Purpose |
|---|---|
| `src/middleware/requireAuth.js` | JWT + legacy key auth, role helpers |
| `src/routes/auth.js` | bootstrap-admin, login, user creation |
| `src/services/notifications.js` | Telegram alerts |
| `src/services/metaApiBridge.js` | Orders + live account/position reads |
| `src/services/kiteBridge.js` | Kite scaffold — read its header first |
| `src/routes/dashboard.js` | Views + live data + equity history, scoped |
| `src/routes/onboarding.js` | Full member/strategy lifecycle |
| `backtest/backtest.py` | Backtester (`generate_sample_data.py` for demo data) |
| `prisma/schema.prisma` | All tables incl. users, equity_snapshots |

## 6. Conventions to keep

- READMEs keep the honest "what's built / what is NOT built" split.
- No silent kill-switches: every pause/resume/removal has a logged reason.
- Broker credentials never in the DB, logs, or notifications.
