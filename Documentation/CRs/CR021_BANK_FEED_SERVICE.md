**Status:** OPEN — [Plan](../FC_NEXT_STEPS.md#cr021)

# CR021 — Bank Feed Service (Direct PocketSmith Replacement)

**Created:** 2026-05-28
**Supersedes:** [CR014](CR014_POCKETSMITH_REPLACEMENT.md) (dual-provider in-app integration) and obsoletes [CR015](CR015_PS_REEXPORT.md) (PS re-export — irrelevant once PS is removed).

## 1. Background

PocketSmith's PKO Bank Polski feed has been chronically unstable — syncs go out, transactions arrive late or duplicated, balances drift. The bank-side fragility is upstream of PS itself, but PS gives us no leverage to fix or even diagnose it. We want off PocketSmith.

CR014 drafted a dual-provider plan (GoCardless + Plaid) wired directly into the main `fin` app. That plan is now superseded for two reasons:

1. **Dual-mode tech debt.** CR014 keeps PS and the new providers coexisting in the main app during transition: generalize `ps_id` → `external_id`, write two converters into one staging table, support both code paths, etc. That dual-mode period was projected at 12-17 days and would leave debris behind.
2. **Better architecture available.** The [`ocr-llm`](~/Programs/fin/ocr-llm) precedent shows that a standalone service with a pinned REST contract is a clean way to decouple unstable external dependencies from the main app. We can do the same for bank data: a separate service handles all aggregator + Excel ingestion; main app calls it via HTTP.

### Upstream investigation (2026-05-28)

We evaluated [banksync.io](https://app.banksync.io/), which the user has signed up for and verified has API + MCP access plus PKO coverage. Their Developer Settings screen revealed they connect banks **via Plaid**. So banksync.io is a regulated-entity wrap over Plaid, charging a monthly fee to resell access that would otherwise require Production-tier Plaid with regulated status (especially for PSD2 access to PKO).

**Implication:** "banksync.io" vs "Plaid direct" are not different data sources — same upstream, different access path. The choice hinges on whether you can get Plaid Development tier with PKO coverage as an individual.

The user's stated failure mode — *bank-side: missed/stale/duplicate transactions on PKO* — is a Plaid↔PKO connection issue and will recur on any path. The fix lives in the **consumer side** (reconciliation, gap detection, dedupe) regardless of upstream choice.

## 2. Goals & Non-Goals

### Goals

- Replace PocketSmith as the live transaction feed for the `fin` app.
- Run dev and validation in a **separate service** so the main app stays at v2.x on PS until cutover.
- Expose a clean versioned REST contract (`/v1/*`) that v3 of the main app consumes.
- Provide Excel/CSV ingestion for banks not covered by API (Fidelity, manual overrides).
- Build robust reconciliation in the new service so bank-side fragility no longer silently corrupts the ledger.
- Keep main-app changes for v3 thin: replace PS plumbing with an HTTP client to this service.

### Non-Goals

- Multi-user / multi-tenant. Single user (yours), no auth UX needed beyond a shared API key.
- Becoming a generic bank-aggregation platform. Just enough to serve `fin`.
- Mapping to COA / categorizing / accept-edit-split UI. That stays in the main app.
- Rewriting historical PocketSmith data. PS transactions (`source='pocketsmith'`) stay in the main app's DB with their `closing_balance` values intact.

## 3. Architecture

### 3.1 Service boundary

```
┌──────────────────────────┐         ┌──────────────────────────────────────┐
│  fin main app            │         │  bank-feed service (new repo)        │
│                          │         │                                      │
│  v2.x: uses PS as today  │         │  Input adapters:                     │
│                          │  v1 API │   - Plaid (or banksync.io)           │
│  v3: thin REST client ───┼────────►│   - Excel/CSV (Fidelity, manual)     │
│        (replaces PS)     │  HTTP   │                                      │
│                          │         │  Canonical store (own Postgres):     │
│  Historical PS data      │         │   - bank_connections                 │
│  remains in fin DB       │         │   - feed_transactions                │
└──────────────────────────┘         │   - feed_balances                    │
                                     │   - feed_accounts                    │
                                     │                                      │
                                     │  Robustness layer:                   │
                                     │   - Gap detection                    │
                                     │   - Balance reconciliation           │
                                     │   - Dedupe / re-auth handling        │
                                     │   - Stale-feed alerting              │
                                     │                                      │
                                     │  Admin UI (small, in-service)        │
                                     └──────────────────────────────────────┘
```

Mirrors the `ocr-llm` pattern: separate VM, Tailscale-routed, pinned contract version, the main app holds nothing but a base URL + API key + adapter code.

### 3.2 Canonical contract (v1)

The main app sees only this shape, regardless of source (Plaid, Excel, manual). Source-specific quirks (Plaid's positive-equals-debit sign convention, PKO's PSD2 fields, etc.) are normalized away inside the service.

```
GET  /v1/health                              → {status, version}
GET  /v1/connections                         → [{id, source, institution, status, last_synced_at, consent_expires_at}]
POST /v1/connections                         → start Plaid Link / Excel-upload flow
DELETE /v1/connections/:id
GET  /v1/accounts                            → [{id, connection_id, external_id, name, currency, type}]
GET  /v1/transactions?since=YYYY-MM-DD&account_id=...&limit=...
                                             → [Transaction]
GET  /v1/balances?as_of=YYYY-MM-DD           → [{account_id, balance, currency, balance_date, source}]
POST /v1/excel/upload                        → multipart, format auto-detect; returns staging summary
POST /v1/sync                                → trigger sync; sync runs async, returns job_id
GET  /v1/sync/:job_id                        → job status
GET  /v1/health/feeds                        → per-account staleness, last gap report
POST /v1/webhooks/plaid                      → Plaid webhook receiver (internal use)
```

Canonical `Transaction` shape:

```json
{
  "external_id": "plaid_abc123",     // stable across re-auth where source permits
  "source": "plaid",                 // "plaid" | "excel" | "manual"
  "account_id": 17,
  "transaction_date": "2026-05-15",
  "amount": "-123.45",               // signed, decimal as string; outflow negative
  "currency": "PLN",
  "description": "Carrefour Warszawa",
  "merchant": "Carrefour",           // when source provides; else null
  "category_hint": "groceries",      // Plaid auto-cat; null if not provided
  "pending": false,
  "raw": { "...": "opaque source payload" }
}
```

### 3.3 What stays in the main `fin` app

- COA / accounts / categories — unchanged
- `transactions` table — unchanged shape; new rows arrive with `source='bank-feed'` (or keep `source='plaid'` if more useful)
- Transfer analysis, FX handling, forecast, all UI — unchanged
- Historical `psdata_staging` and PS-sourced rows — frozen in place, never touched

### 3.4 Deployment

Separate KVM guest on the existing host (matches `ocr-llm` pattern). Tailscale-routed. Own Postgres container. Main app holds `BANK_FEED_URL` + `BANK_FEED_API_KEY` env vars.

## 4. Phased Plan

### Phase 0 — Upstream discovery (1 day, no code)

Resolve the open upstream question before committing to an integration. **Do not skip — this is the only thing that can change the rest of the plan.**

Checklist:

1. **Plaid Development tier feasibility for personal use.**
   - Sign up at `dashboard.plaid.com`. Declare use case truthfully ("personal finance management for own bank accounts").
   - Confirm account is approved for Development tier (not just Sandbox).
   - In the dashboard, check **whether PKO Bank Polski is listed** in the institutions you can connect at your tier. Note: Plaid Europe / PSD2 access may be gated separately from US.
   - Attempt to create a Link token and connect a real PKO account. Result: linked / blocked / requires Production.
2. **GoCardless Bank Account Data as fallback.**
   - Sign up at `bankaccountdata.gocardless.com`. Free tier (~50 connections) is explicitly individual-developer friendly in EU.
   - Confirm PKO is in their institution list for Poland.
   - Verify free tier permits personal use without commercial registration.
3. **banksync.io baseline.**
   - Already verified working with PKO + API key. Note the **monthly cost** and what the API quota / rate-limit looks like.
4. **Decision matrix.** With the three results in hand, fill in:

   | Provider | PKO works for me? | US banks works for me? | Cost/mo | Effort | Vendor risk |
   |---|---|---|---|---|---|

   Decide the upstream(s). Possible outcomes:
   - **Plaid direct, free** — if PKO works on Development tier. Best long-term.
   - **GoCardless (PKO) + Plaid (US)** — if Plaid PKO is blocked but Plaid US works.
   - **banksync.io for everything** — if both above are blocked. Pay-to-skip the regulatory access problem.
   - **banksync.io for PKO + Plaid direct for US** — if only Plaid US works and you want to minimize banksync fee scope.

Output: a one-paragraph decision recorded in this CR under §10 *Decision Log* before proceeding.

### Phase 1 — Service skeleton (1-2 days)

- New repo: `~/Programs/fin/bank-feed/` (sibling to `psproject` and `ocr-llm`).
- Node + Express + Postgres. Match `psproject`'s stack for cognitive load.
- Docker + `docker-compose.yml`. Provision a new KVM guest (separate IP, e.g. `192.168.1.84`) using the existing `provision-vm.sh` script with modified vars.
- Tailscale on the VM (same setup as `ocr-llm` at `100.66.213.40:8080`).
- Migrations:
  - `bank_connections` — id, source, institution_id, institution_name, status, access_token (encrypted), consent_expires_at, last_synced_at
  - `feed_accounts` — id, connection_id, external_id, name, currency, type
  - `feed_transactions` — id, account_id, external_id, source, transaction_date, amount, currency, description, merchant, category_hint, pending, raw (JSONB), created_at, ingested_at
  - `feed_balances` — id, account_id, balance, currency, balance_date, source, fetched_at
  - `sync_jobs` — id, started_at, finished_at, status, summary (JSONB)
- All `/v1/*` endpoints stubbed returning 501. Just shape + auth middleware (single shared API key in header).
- Health endpoint returns `{status: "ok", version: "1.0.0"}`.
- README + an `AI_IMPLEMENTATION_GUIDE.md` for future-Claude (matches `ocr-llm`'s pattern).

### Phase 2 — Primary adapter (2-3 days)

Based on Phase 0 outcome. Most-likely path is Plaid:

- `npm install plaid`. Configure CLIENT_ID + SECRET + env via docker env vars.
- `POST /v1/connections` → returns a Plaid Link token.
- New endpoint `POST /v1/connections/plaid/exchange` → public-token → access-token, persisted.
- `POST /v1/webhooks/plaid` → handle `TRANSACTIONS_DEFAULT_UPDATE`, `HISTORICAL_UPDATE`, `INITIAL_UPDATE`, `USER_PERMISSION_REVOKED`, etc.
- Plaid → canonical converter: sign convention flip, FX field handling, merchant extraction, category mapping (`personal_finance_category.primary` → `category_hint`).
- Initial historical pull (Plaid retains ~24 months).
- Incremental sync job scheduled (cron inside the container or external).
- Sandbox tests using Plaid's `sandbox_public_token_create`.

If Phase 0 lands on banksync.io instead:
- Replace plaid-node SDK with HTTP calls to banksync's REST API.
- Otherwise identical conversion / contract.

### Phase 3 — First real connection + comparison (1 day)

- Connect real PKO via the chosen path.
- Pull the last 90 days.
- Side-by-side compare with PS data for the same window:
  - Transaction count per day
  - Amount totals per day
  - Field-level deltas (descriptions, merchant, FX amounts)
  - Account balance vs PS `closing_balance`
- Record findings. Decide whether categorization/description quality is acceptable or needs an enrichment step.

### Phase 4 — Excel ingestion adapter (1-2 days)

- `POST /v1/excel/upload` accepts multipart.
- Format auto-detection: PS CSV, Fidelity CSV, generic CSV (with column-mapping UI for unknowns).
- Borrows logic from existing [`server/src/v2/services/psCsvIngestorV2.js`](../../server/src/v2/services/psCsvIngestorV2.js).
- Stages into `feed_transactions` with `source='excel'`.
- Dedup against existing entries by (account_id, transaction_date, amount, description) when external_id is absent.

### Phase 5 — Robustness layer (2-3 days)

This is the part PS never gave us. Bank-side instability *will* recur; the goal is to make sure we **know** when it does.

- **Gap detection**: for each account, store per-day expected counts (rolling 30-day median). On sync, flag days with zero received when median > 0.
- **Balance reconciliation**: each balance fetch is stored; on retrieval, compare against computed running balance (opening + sum). Flag drift > tolerance.
- **Dedupe across re-auth**: Plaid stable IDs are usually durable, but observe drift; fall back to (date, amount, currency, account) fuzzy match with 1-day window.
- **Stale-feed alerting**: `GET /v1/health/feeds` returns per-account `staleness_days`, `last_gap_at`, `consent_expires_in_days`. Main app polls this; renders banner.
- **Re-auth warning**: 7-day and 1-day-before alerts before consent_expires_at.

### Phase 6 — Admin UI (2-3 days)

Minimal in-service UI for managing the service itself. Not the main app's transaction-review UI.

- Single-page (React or vanilla). Served on the same service port at `/admin`.
- Pages:
  - **Connections** — list, status, last sync, "Sync Now", "Re-link", delete.
  - **Add Connection** — Plaid Link widget OR Excel-upload form.
  - **Feed Health** — per-account stale/gap/balance-drift indicators.
  - **Excel Upload** — drag-drop, format preview, confirm.
- Auth: single shared API key (no user system).

### Phase 7 — Main app integration spike (1-2 days)

In a feature branch on `psproject` (do not merge to main yet):

- Write a thin client: `server/src/v2/services/bankFeedClient.js`.
- Add a read-only diagnostic endpoint that fetches from the feed service and shows side-by-side with PS data on screen.
- Verify the contract serves all the data the main app needs for v3.
- Identify any contract gaps. Update v1 spec on the feed-service side; bump only patch versions until v3 is built.

### Phase 8 — v3 cutover (separate future CR)

To be opened as **CR022 — Fin v3: Bank Feed Cutover** after Phases 1-7 land. Out of scope for this CR. Will include:

- Replace `refreshPsApiV2.js` callsites with `bankFeedClient`.
- Generalize `transactions.ps_id` semantics; add `source` discrimination.
- Update balance sheet query to read from feed-service balances when available; COALESCE to PS `closing_balance` for historical dates.
- Rename `/refresh-ps` → `/sync-transactions`; repoint to feed service.
- Remove `pocketsmith.js`, `psdataConverter.js`, `refreshPsApiV2.js` after a 1-month transition window.
- Cancel PocketSmith subscription.

## 5. Effort Summary

| Phase | Effort | Description |
|---|---|---|
| 0 | 1 day | Upstream discovery (no code) |
| 1 | 1-2 days | Service skeleton + VM provisioning |
| 2 | 2-3 days | Primary adapter (Plaid or banksync.io) |
| 3 | 1 day | First real connection + PS comparison |
| 4 | 1-2 days | Excel adapter |
| 5 | 2-3 days | Robustness layer |
| 6 | 2-3 days | Admin UI |
| 7 | 1-2 days | Main-app integration spike |
| **Total** | **11-17 days** | New service ready; cutover (CR022) is separate |

Comparable to CR014's 12-17 days but lands in a separate service rather than entangling with the main app.

## 6. Open Design Decisions

To be resolved during Phase 0 / start of Phase 1:

1. **Repo location and naming.** Proposed: `~/Programs/fin/bank-feed/`. Alternative: monorepo under `psproject/services/bank-feed/`. Separate repo recommended (matches `ocr-llm`, independent versioning).
2. **VM strategy.** Separate KVM guest (recommended) vs same VM as `psproject` with separate container. Separate VM matches `ocr-llm` precedent; easier to restart independently.
3. **DB strategy.** Own Postgres container vs shared with `psproject`. Own DB recommended for isolation; the contract is the only integration surface.
4. **Auth between main app ↔ feed service.** Shared API key in `X-API-Key` header, rotated manually. No OAuth — single-user, internal Tailscale-only.
5. **Sync cadence.** Plaid recommends webhook-driven. Add a cron fallback (every 6h) for safety. Decision: yes.
6. **Historical backfill scope.** Plaid retains ~24 months. Pre-2024 PKO data: leave in PS history (already in main DB) or re-import via Excel? Decision: leave in PS history; Excel backfill optional later.

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Plaid Development tier blocks PKO connections for individuals | Medium | High | Phase 0 discovery; fallback to banksync.io |
| Bank-side issues persist on new path (Plaid↔PKO breaks too) | Medium | Medium | Robustness layer (Phase 5) makes failures visible; Excel manual override always works |
| Plaid raises Development-tier requirements | Medium | Medium | Service swap = one adapter file; main app sees no change |
| banksync.io sunsets / acquires / raises prices | Low-Medium | Medium | Plaid adapter ready as fallback; contract is provider-agnostic |
| Re-auth (90-day PSD2) friction | Certain | Medium | Alerts at 7d / 1d; admin UI has "Re-link" action |
| Categorization quality drops vs PS | High | Low | Manual category-assignment UI in main app already exists |

## 8. Files (initial)

New repo `bank-feed/`:

```
bank-feed/
├── README.md
├── AI_IMPLEMENTATION_GUIDE.md
├── HANDOFFS.md
├── docker-compose.yml
├── Dockerfile
├── package.json
├── db/
│   └── migrations/
│       └── 001_initial.sql
├── src/
│   ├── server.js
│   ├── routes/
│   │   ├── health.js
│   │   ├── connections.js
│   │   ├── transactions.js
│   │   ├── balances.js
│   │   ├── excel.js
│   │   └── webhooks.js
│   ├── adapters/
│   │   ├── plaid.js          (or banksync.js)
│   │   └── excel.js
│   ├── converters/
│   │   └── plaidToCanonical.js
│   ├── reconciliation/
│   │   ├── gaps.js
│   │   ├── balanceCheck.js
│   │   └── dedupe.js
│   └── admin/
│       └── ...
└── tests/
```

New in `psproject/` (Phase 7+ only — none in Phase 1-6):
- `server/src/v2/services/bankFeedClient.js`
- (v3 CR022) Schema generalization + routes/UI rename

## 9. Out of Scope for CR021

- v3 main-app cutover (→ CR022).
- COA / category mapping for new feed data (already exists in main app).
- Mobile UI for the admin surface (desktop-only is fine).
- PS data migration / cleanup (historical PS rows stay as-is).
- Multi-currency reconciliation beyond what Plaid provides (Frankfurter FX still used in main app).

## 10. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-28 | Reject CR014's in-app dual-provider approach | Microservice + contract pattern (ocr-llm precedent) avoids dual-mode tech debt; cleaner v3 cutover |
| 2026-05-28 | banksync.io is Plaid + regulatory-access wrap, not an independent source | Confirmed via banksync.io Developer Settings: "Securely link your bank via Plaid" |
| 2026-05-28 | Upstream choice deferred to Phase 0 | Need to verify whether Plaid Development tier permits PKO for individual use before committing |
| 2026-05-29 | **Upstream: banksync.io Standard tier ($7/mo)** | Plaid Production is "In Review" with no clean timeline. banksync.io verified working with PKO; Standard tier gives 5 banks, unlimited transactions, daily syncs, webhooks (`connection.requires.attention`, `feed.sync.failed`, `transactions.new`, etc.), 2-yr historical window, 30 API calls/min. Pre-2024 history stays in existing PS data in main DB. Plaid Production review continues in background; adapter swap remains cheap if it lands. |
| 2026-05-29 | Phase 0 closed | Discovery complete. Endpoint payload shapes (transactions, balances) deferred to Phase 2 — don't block skeleton work. |
| 2026-05-29 | banksync.io is **multi-aggregator**, not Plaid-only | Their API Reference states banks resolve via Plaid, SaltEdge, or SnapTrade. PKO likely via SaltEdge (CR014 confirmed strong PKO coverage there). Stronger value prop than originally assessed — they abstract over three aggregators behind one API + regulatory access. |
| 2026-05-29 | banksync.io upstream API facts pinned for Phase 2 | Base URL `https://api.banksync.io`; auth `X-API-Key` (NOT Bearer despite their Getting Started page); resource tree `banks → accounts → {transactions, balances, holdings, trades, loans}`; webhook sig `X-BankSync-Signature` HMAC-SHA256. Their "Feeds" = destination pipelines (Notion/Sheets) — we don't use them; we consume the API directly. |
| 2026-05-29 | Investment endpoints noted for CR020 | banksync.io exposes `/holdings` and `/trades` — could feed the future Stock Investment Module. Out of scope for CR021 but worth sequencing CR020 to consume the same `bank-feed` contract. |

---

*Living document. Update §10 Decision Log as choices are made. Close CR014 and CR015 once this CR begins Phase 1.*
