# Bank Transaction Import for OCME — Build Guide

**Purpose:** Add bank-transaction import to OCME, fed from the **same fintable.io Google Sheet** fin uses.
**Chosen architecture:** OCME consumes the existing **`bank-feed` microservice** (CR021) over its `/v1/*` REST contract — the same service fin consumes. OCME writes **no** Google API code and never touches the Sheet directly. (Direct-Sheet read is kept as a fallback in the Appendix, for the case where OCME can't reach the service.)
**Distilled from:** the `bank-feed` service (`~/Programs/fin/bank-feed/`), fin's `bankFeedClient.js`, and CR022 (`Documentation/CRs/CR022_BANK_FEED_PARALLEL_IMPORT.md`).

---

## 0. The shape of the system

```
                         ┌───────────────────────────┐
                         │  bank-feed service (CR021) │
   fintable Google Sheet │  host "fin" :3007          │
   ───reads once────────▶│  parses sheet, dedups,     │
                         │  serves /v1/* over Tailscale│
                         └───────────┬───────────────┘
                          /v1/*  (X-API-Key)
                ┌─────────────────┴─────────────────┐
                ▼                                     ▼
        ┌───────────────┐                     ┌───────────────┐
        │     fin       │                     │     OCME      │  ← you build this client
        │ (CR022)       │                     │ (this guide)  │
        │ stage+promote │                     │ stage+promote │
        └───────────────┘                     └───────────────┘
```

The service already solves the hard parts **once, centrally**: Google auth, Excel-serial dates, currency-from-raw-JSON, GoCardless-vs-SnapTrade dispatch, per-transaction dedup. OCME never re-implements any of that. OCME's job is: **call the contract → stage the rows → promote into OCME's transactions table.** That's the smaller half of the work.

Each consumer keeps its **own** account-mapping/opt-in policy. The service serves *all* accounts; fin decides per-account what to import; OCME decides independently. Sharing the feed does **not** mean sharing account policy.

---

## 1. Connecting to the service (Tailscale)

- **Base URL:** `http://100.94.46.62:3007` — the `bank-feed` service runs on host `fin` (Tailscale node `100.94.46.62`), port `3007`. OCME is on the same Tailnet, so this is directly reachable. *(fin itself reaches it via `host.docker.internal:3007` only because it's co-hosted; OCME uses the Tailscale IP.)*
- **Auth:** every `/v1/*` call except `/v1/health` requires the shared key, sent as **either** header:
  - `X-API-Key: <key>` (what fin uses), or
  - `Authorization: Bearer <key>`
  - The key is `BANK_FEED_API_KEY` (lives in fin's root `.env`, never committed). **Decision: OCME shares fin's existing key** (no second key added) — copy the value out-of-band into OCME's own secret config; do not commit it.
- **Config OCME needs (mirror fin's `bankFeedClient.js`):**
  - `BANK_FEED_URL=http://100.94.46.62:3007`
  - `BANK_FEED_API_KEY=<shared key>`
  - an 8s request timeout is a sane default.

**Reachability — CONFIRMED 2026-06-02** from `ocmedev`: `curl http://100.94.46.62:3007/v1/health` → `{"status":"ok","version":"0.1.0","db":"ok",...}`. Port 3007 is published to the Tailnet (not just the docker bridge), so OCME can reach it directly. (`/v1/health` is the only keyless endpoint — the authed `/v1/accounts` + `/v1/transactions` path still needs verifying once the key is in place.)

---

## 2. The `/v1/*` contract OCME will call

All responses are JSON. Money fields are returned **as strings** (`amount::text`, `balance::text`) to preserve exact decimal precision — parse them into a decimal type, **never** through a float.

### `GET /v1/health` *(public, no key)*
Liveness. `{ status, version, db, timestamp }`. 200 when DB reachable, 503 otherwise.

### `GET /v1/accounts`
```json
{ "accounts": [
  { "id": 6, "connection_id": 1, "external_id": "<UUID>", "name": "SAVINGS (PLN) (2790)",
    "currency": "PLN", "type": "savings", "created_at": "...", "updated_at": "..." }
]}
```
- `external_id` (UUID) is the **stable** account key — durable across service restarts and re-syncs.
- `id` (integer) is the service's internal serial — used only as the join key inside `/v1/transactions`. **Do not persist `id` as your account key; persist `external_id`.** (See §3.)
- `type` is one of `credit | savings | checking | brokerage | other` — your filter point for "cash only" (see §4).

### `GET /v1/transactions`
Query params: `since=YYYY-MM-DD`, `until=YYYY-MM-DD` (both on `transaction_date`), `account_id=<int>`, `limit` (default 500, **max 5000**), `offset` (default 0).
```json
{ "transactions": [
  { "id": 1234, "account_id": 6, "source": "fintable",
    "external_id": "5402597747075704143--6101279d…", "transaction_date": "2026-05-30",
    "amount": "-123.4500", "currency": "PLN", "description": "…", "merchant": null,
    "category_hint": null, "pending": false, "ingested_at": "..." }
], "limit": 500, "offset": 0 }
```
- `external_id` = the stable per-transaction dedup key (fintable composite hash). **This is your idempotency key.**
- `account_id` here is the service's internal serial `id` from `/v1/accounts` — resolve it to `external_id` via the accounts map (§3).
- `amount` is signed (outflow negative), as a string.
- `pending` rows are already filtered out by the service; you should still defensively skip any `pending:true`.

### `GET /v1/balances`
Query: `as_of=YYYY-MM-DD` (default today), `account_id`. Returns latest balance per account ≤ `as_of`:
```json
{ "balances": [ { "account_id": 6, "balance": "12345.6700", "currency": "PLN",
                  "balance_date": "2026-05-30", "source": "fintable", "fetched_at": "..." } ],
  "as_of": "2026-05-30" }
```
Use this for an independent balance check (compare OCME's computed balance to the bank's reported balance — fin made this its primary cutover gate; see CR022 §G).

### `GET /v1/health/feeds` *(key required)*
Per-connection staleness + per-account inactivity and balance-reconciliation signals. Watch `is_stale` and `most_recent_transaction_date` to know the feed is alive before trusting an empty import.

### `POST /v1/sync` *(key required)* — force a fresh Google-Sheet read
Makes bank-feed **re-read the Sheet right now** and upsert accounts/transactions/balances. Synchronous; returns a job summary:
```json
{ "jobId": "91", "status": "succeeded",
  "summary": { "accounts": {"inserted":1,"updated":13}, "transactions": {"inserted":52,"updated":582},
               "connections": {"distinct_institutions":3,"created":1} } }
```
**Guards (added for client-triggered refresh — safe for OCME to call):**
- `?max_age=<minutes>` — if the last successful sync is younger than this, **skip** the Sheet read and return immediately:
  ```json
  { "skipped": true, "reason": "fresh", "last_synced_at": "...", "age_minutes": 3, "max_age_minutes": 15 }
  ```
  Omit it (or `0`) to always sync (back-compat).
- `?force=true` — bypass the freshness cap, always re-read.
- **Coalescing:** concurrent calls (multiple OCME requests, or the hourly cron) share **one** running sync — extra callers get the same result tagged `"coalesced": true`. A held-down refresh button can't start overlapping Sheet reads.

Supporting: `GET /v1/sync/probe` (verify Sheet auth/share without pulling data), `GET /v1/sync/:jobId` (poll a past job).
**Still a *shared* operation** (re-reads the whole Sheet, ~600+ rows, for all consumers). Don't call it per page load — use `max_age` and reserve it for an explicit refresh action. See §3.4.

---

## 3. Three contract gotchas to get right

These are the things that bit fin's consumer (CR022 §3.0); handle them up front:

1. **`account_id` in `/v1/transactions` is NOT the stable key.** It's the service's internal serial. The stable key is the account **UUID** in `/v1/accounts.external_id`. So on each run: fetch `/v1/accounts` first, build an `id → external_id (UUID)` map, and key all of OCME's account mappings + staging on the **UUID**. A transaction whose `account_id` isn't in the map → stage it with a null account ref and surface it as "unresolved," never silently drop it.
2. **No `updated_since` / change-cursor param exists yet.** You can only window by `transaction_date` (`since`/`until`). So incremental sync = **re-fetch an overlapping date window** (e.g. last 14–30 days) every run; idempotency on `external_id` (§5) makes the overlap free. Don't try to track "what changed since last poll" — the contract can't tell you. (This is an open CR021 follow-up, not something to wait on.)
3. **Paginate.** `limit` caps at 5000. For a backfill (e.g. 90 days), loop `offset` until you get fewer than `limit` rows back.

### 3.4 Two-layer freshness — reading `/v1/*` does NOT read the Sheet

A common trap: editing the Google Sheet and expecting it to appear in OCME immediately. There are two independent refresh layers:

```
Layer 1:  Google Sheet ──(bank-feed hourly poll, FINTABLE_POLL_MINUTES, OR POST /v1/sync)──▶ bank-feed DB
Layer 2:  bank-feed DB ──(OCME calls GET /v1/accounts, /v1/transactions)──▶ OCME
```

OCME's reads only touch **Layer 2** (bank-feed's DB). They never trigger a Sheet read. So a just-edited Sheet stays invisible to OCME until bank-feed's next hourly poll **or** someone calls `POST /v1/sync`. Pattern:
- **Steady state:** rely on the hourly poll; OCME just reads on its own cadence.
- **On-demand ("Refresh from bank" button):** call the **guarded** sync, then re-fetch:
  ```
  POST /v1/sync?max_age=10      →  re-reads only if data is >10 min stale, else {skipped:true}
  (await response)
  GET  /v1/accounts             →  pick up any new account (then map it — see R1 below)
  GET  /v1/transactions?since=… →  fresh rows
  ```
  `max_age` means a held-down button (or several OCME users clicking at once) reads the Sheet at most once per window — and concurrent calls coalesce onto one sync regardless. Use `?force=true` only for an explicit "force refresh." Do **not** wire `POST /v1/sync` into automatic per-request fetches.

**And note R1 (§6):** even after Layer 1 + Layer 2 deliver a *new* account, OCME holds it as **pending** (unmapped) — its transactions stage but don't promote until a human maps it in OCME. New accounts never auto-import; that's the fail-closed design, not a bug.

---

## 4. What OCME builds

### 4.1 HTTP client (~100 lines)
Port fin's `server/src/v2/services/bankFeedClient.js` almost verbatim — it's `fetch` + the `X-API-Key` header + an `AbortController` timeout + status-aware error throwing. Methods: `health()`, `accounts()`, `transactions({since, until, accountId, limit, offset})`, `balances(asOf)`, `feedsHealth()`. Just point `BASE_URL` at `http://100.94.46.62:3007`.

### 4.2 Staging table
A 1:1 landing table for contract rows, so re-fetching is idempotent and you have a clean promote step. Adapt fin's `bankfeed_staging` (`server/db/migrations/023_bank_feed_import.sql`) to OCME's DB:
```sql
CREATE TABLE bankfeed_staging (
    id BIGSERIAL PRIMARY KEY,
    external_id VARCHAR(100) NOT NULL,          -- /v1/transactions.external_id (dedup key)
    source VARCHAR(20) NOT NULL,                -- 'fintable' (the contract's source field)
    feed_account_external_id VARCHAR(100),      -- the UUID from /v1/accounts (resolved per §3.1)
    transaction_date DATE NOT NULL,
    amount DECIMAL(15,4) NOT NULL,              -- parse the string amount into exact decimal
    currency CHAR(3) NOT NULL,
    description VARCHAR(500),
    merchant VARCHAR(200),
    category_hint VARCHAR(100),
    pending BOOLEAN DEFAULT FALSE,
    raw JSONB,                                  -- stash the whole contract row for audit
    promoted_transaction_id BIGINT REFERENCES transactions(id),  -- null = not promoted yet
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, external_id)                 -- idempotency: ON CONFLICT DO UPDATE
);
```
Insert with `ON CONFLICT (source, external_id) DO UPDATE`. Re-running over an overlapping window nets zero new rows.

### 4.3 Promote into OCME's transactions table
Walk `promoted_transaction_id IS NULL` rows and insert into OCME's canonical transactions table, with two conventions fin uses:
- **Generic `source` discriminator.** Stamp `source='bank-feed'` on the canonical row (survives a future fintable→Plaid swap); keep the specific upstream (`'fintable'`) only in staging + `raw`.
- **`accepted = FALSE` (review-first).** fintable/GoCardless categorization is unproven, so every imported row lands in OCME's review queue before it counts. Set OCME's equivalent "needs review" flag.
- Add a `bank_feed_external_id VARCHAR(100)` column to OCME's transactions table with a **partial-unique index `WHERE … IS NOT NULL`**, so re-promotes upsert and the canonical row `id` stays stable. After insert, set `staging.promoted_transaction_id`.

---

## 5. Idempotency & dedup

- **Within the feed:** `UNIQUE(source, external_id)` on staging + upsert. The contract's `external_id` is stable, so re-fetching the same window can't create duplicates.
- **Re-promote:** upsert on `bank_feed_external_id` in the canonical table. Re-running promote → 0 net inserts.
- That's the whole dedup story for a single-source OCME. (fin's cross-source dedup, R2 below, does **not** apply to you — see §6.)

---

## 6. Two CR022 features — what to keep, what to drop

### R1 — Per-account opt-in: **KEEP**
fintable can surface accounts OCME shouldn't import (test accounts, brokerage sub-accounts, roll-ups, Fidelity). fin's rule is **fail-closed**: an account with no mapping does **not** import — it sits pending until a human maps or ignores it. Implement an account-mapping table keyed `(source, feed_account_external_id)` with:
- `account_id` (nullable) → OCME's internal account, and
- `ignored BOOLEAN DEFAULT FALSE`.

Promote gate checks `ignored` first, then mapping presence. Four states:

| State | mapping `account_id` | `ignored` | Promotes? |
|---|---|---|---|
| **pending** (no row) | — | — | No — must decide |
| **mapped** | set | FALSE | **Yes** |
| **ignored (mapped)** | set | TRUE | No — suppressed, mapping kept |
| **ignored (unmapped)** | NULL | TRUE | No — explicit "skip this feed account" |

A tiny admin screen with a per-account toggle (read `/v1/accounts`, show OCME's mapping state, let the user map/ignore) is the whole UI. **Strongly recommended** — without it, every new fintable account silently does nothing or worse.

### R2 — Cross-source dedup: **DROP**
R2 exists only because fin imports the *same* transactions from PocketSmith **and** bank-feed at once and must not double-count. If OCME's only transaction source is this feed, there's nothing to dedupe against, and R2's `(date, amount, currency)` heuristic carries a real false-merge risk (two genuinely distinct same-day, same-amount charges). **Skip it entirely** unless OCME also ingests the same transactions from a second feed.

---

## 7. Testing (mirror fin's Phase D, minus the parsing tests)

Since the service does the parsing, OCME's tests focus on the client + promote:
- **Client tests (mocked HTTP):** `since`/`until`/pagination params built correctly; `offset` loop terminates; 5xx → retryable error envelope, 4xx (401) → non-retryable; amount strings parsed to exact decimal (no float drift on `-123.4500`).
- **DB-backed promote tests:** N staged rows → N canonical rows with `source='bank-feed'`, external id set, `accepted=false`; **re-promote idempotent (0 new inserts)**; a row manually flipped to accepted is **not** overwritten on re-promote.
- **R1 gate tests:** unmapped account → 0 promoted + listed pending; `ignored=TRUE` → 0 promoted; mapped + not-ignored → promoted.
- **Live smoke:** `GET /v1/health` 200 → `/v1/accounts` ≥ 1 → ingest a 14-day window → re-run shows 0 net new → rows queryable in OCME.

---

## 8. Build checklist

1. Get `BANK_FEED_API_KEY` out-of-band; set `BANK_FEED_URL` + key in OCME config (§1).
2. `curl http://100.94.46.62:3007/v1/health` from an OCME host — confirm Tailnet reachability (§1).
3. HTTP client for `/v1/*` (port `bankFeedClient.js`) (§4.1).
4. `bankfeed_staging` table + `ON CONFLICT(source, external_id)` upsert (§4.2).
5. Account map: fetch `/v1/accounts`, build `id→UUID`, resolve transaction `account_id` (§3.1).
6. Promote → OCME transactions: `source='bank-feed'`, `accepted=false`, `bank_feed_external_id` partial-unique upsert (§4.3).
7. R1 opt-in mapping + ignore toggle (§6). **Skip R2.**
8. A refresh trigger (cron/endpoint) re-fetching an overlapping window each run (§3.2, §5).
9. Tests (§7).

### Files to read in fin while building

| What | Where |
|---|---|
| HTTP client to copy | `psproject/server/src/v2/services/bankFeedClient.js` |
| Contract endpoints (source) | `~/Programs/fin/bank-feed/src/routes/{transactions,accounts,balances,health}.js` |
| Auth header handling | `~/Programs/fin/bank-feed/src/middleware/auth.js` |
| Staging schema + R1 columns | `psproject/server/db/migrations/023_bank_feed_import.sql` |
| Full design rationale (R1/R2, promote gates) | `psproject/Documentation/CRs/CR022_BANK_FEED_PARALLEL_IMPORT.md` |
| Live contract spec | `curl http://100.94.46.62:3007/v1/health` and the bank-feed `contracts/v1/` dir |

---

## Appendix — Fallback: OCME reads the Google Sheet directly

Use this **only** if OCME genuinely cannot reach the `bank-feed` service over Tailscale (and that can't be fixed by publishing port 3007). It duplicates the parser and stands up a second Google service-account share on the same Sheet — meaning a fintable schema change must be fixed in two places. Prefer §1–§8.

If forced down this path, OCME must additionally re-implement (from the bank-feed source):

- **Google auth + sheet read** (`bank-feed/src/adapters/googleSheets.js`): service account JSON key, share the Sheet to its email as Viewer, read with `valueRenderOption:'UNFORMATTED_VALUE'` + `dateTimeRenderOption:'SERIAL_NUMBER'`. Env: `FINTABLE_SHEETS_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `FINTABLE_ACCOUNTS_SHEET=Accounts`, `FINTABLE_TRANSACTIONS_SHEET=Transactions`.
- **Sheet schema.** Accounts tab: `⚡ Account Name | ⚡ Balance | ⚡ Currency | Notes | ⚡ Last Update | ⚡ Institution | ⚡ Account ID | ⚡ Raw Data`. Transactions tab: `⚡ Date | ⚡ Amount | ⚡ Description | ⚡ Category | ⚡ Account | Attachment | ⚡ Transaction ID | ⚡ Raw Data`.
- **Conversion gotchas** (`bank-feed/src/converters/fintableToCanonical.js`): Excel-serial dates (epoch 1899-12-30; prefer `raw.bookingDate`/`raw.trade_date` when present); **currency from Raw Data**, not its own column (GoCardless `raw.transactionAmount.currency`, SnapTrade `raw.currency.code`); account resolved two-hop (tx `⚡ Account` display name → Accounts `⚡ Account Name` → `⚡ Account ID` UUID); drop `pending=true`; `⚡ Category`=`Uncategorized` → null; exact decimal amounts; per-row GoCardless-vs-SnapTrade dispatch (`detectUpstream`) — **never hardcode one institution** (a real bug fin hit); skip + count incomplete rows.
- Then the same §4.2–§7 staging/promote/R1 work as above. Sample sheet: `psproject/Samples/Fintable/⚡️💵 Fintable Template.xlsx`.
