# CR059 — Fintable API ingestion (retire the Google Sheets adapter) — IN-PROGRESS (rev 4 — P0/P1 built, P2 running, P3a/P4 to build)

Replace bank-feed's Google-Sheets-scraping upstream with **Fintable's own REST API (V2)**, which now
serves the same accounts, balances and transactions as structured JSON — plus a stable per-transaction
`account_id`, exact decimal amounts, real dates, `updated_since` incremental sync, and investment
**holdings** that the Sheet never exposed.

Roadmap anchor: [project-roadmap.md#cr059](../current/project-roadmap.md#cr059). **Track: v3** — no
flags, no tenant context; the code lives in the **separate `bank-feed/` repo**, the migration touches
**both** stores.
**Depends on / touches:** [CR021](cr-021-bank-feed-service.md) (the service and its `/v1/*` contract) ·
[CR023](cr-023-pocketsmith-removal.md) (28 fed accounts, feed signs, recon page) ·
[CR024](cr-024-fidelity-feeds.md) (Fidelity/SnapTrade accounts) ·
[CR035](cr-035-feed-sync-freshness.md) (`source_synced_at` — this CR makes it *true*) ·
[CR036](cr-036-manual-statement-upload.md) (manual CSV path — untouched fallback).

**Reviews:** pass 1 (`cr-technical-reviewer`) **revise — 5 blocking**, and it was worth running: three
claims this CR made are contradicted by its own data. The id inventory omitted
`transactions.bank_feed_external_id` (1,392 rows), which is fin's **only** ledger-level duplicate guard
(§4); the P3 match key matches **58.6%**, not ~100%, because API descriptions carry trailing tags far
wider than documented — and the equivalence gate's own normalizer had the same defect (§13.2); and the
date-basis table **reversed** under unbiased pairing, with the divergence spanning three providers, not
Akoya alone (§13.2). Rev 3 restates all three. Pass 2 (`cr-signoff-pm`) to follow.

**Phase 0 is DONE (2026-07-28) — see [§11](#11-phase-0-findings-measured-2026-07-28).** The ids
**differ**, so the crosswalk is required — but it is **exact, not heuristic**: the Sheet's composite
transaction id is `{api_account_id}--{hash}`, so our own stored data already contains the API's account
ids. Verified 15/15 where our ids are composite; the other 14 accounts resolve on name+currency with
balances agreeing.

Migration **044** in fin for P3a's account crosswalk (`043` was taken by the promote-cutoff pinning fix, 2026-07-30).

---

## 1. Problem — what the Sheets path costs us

Fintable syncs the banks; its *destination* is a Google Sheet in the owner's Drive; bank-feed reads
that Sheet with a Google service account
(`bank-feed/src/adapters/googleSheets.js`) on an
hourly poll and converts it
(`bank-feed/src/converters/fintableToCanonical.js`, 364 lines). Concretely, today:

1. **The transaction→account link is a display name.** The Sheet's `⚡ Account` column is a string like
   `SAVINGS (PLN) (2790)`; the converter joins it to `⚡ Account Name`, **last-wins**. This is not
   theoretical: on 2026-07-14 two sheet rows were both named `Black Card (9915)` and the stale one
   captured the whole feed — **31 duplicate transactions in prod, $8.4K gross, net only +$267**, so a
   balance check could not see it. The id-based guard added for exactly this case (`cc23929`) read
   `raw.accountId` while Plaid sends `account_id`, so it was **dead code** until `c49b459`.
   *In the API there is no name join at all: every transaction carries `account_id`.*
2. **Everything arrives pre-mangled by the spreadsheet.** Dates are Excel serials (1899-12-30 epoch,
   with the 1900 leap-year bug); amounts are JS floats; the transaction's **currency is not in the row**
   and has to be dug out of a JSON string in the `⚡ Raw Data` column — with a different path per
   upstream (`transactionAmount.currency` for GoCardless, `currency.code` for SnapTrade, **absent** for
   MX/Chase, which needed a separate account-currency-inheritance fix, `0823df6`). *The API returns
   `"date": "2026-07-24"`, `"amount": "-4.50"`, `"currency": "USD"` on every row.*
3. **Institution identity is guessed.** `detectUpstream` / `extractInstitution` / `inferType` sniff raw
   JSON shapes and keyword-match product names to decide who the bank is and what kind of account it is.
   The result is visible in the store: **17 `bank_connections` rows for ~11 real institutions**, six of
   them orphans with zero accounts (`CaixaBank`, `PKO Bank Polski`, `Revolut`, `Wise` ×2,
   `Erste Bank Polska` each appear twice — once with an `institution_id`, once without).
   *The API returns `provider`, `institution_name` and a stable `connection_id` as first-class fields.*
4. **Every poll is a full re-read.** Both tabs, all rows, converted and upserted, hourly, forever.
   There is no "what changed". *The API has `?order=updated&updated_since=…` with cursor pagination.*
5. **A second credential system and a third party in the path.** A Google Cloud project, a service
   account, a JSON keyfile on disk mounted into the container, and a Sheet share — all to read data
   Fintable itself will now hand us with one bearer token.
6. **The Sheet is a lagging *export*, not the source.** It is written *after* Fintable syncs; an export
   failure is invisible to us except as staleness, and `⚡ Last Update` is the best sync-time proxy we
   have. *The API exposes `connection.last_successful_update` and a live `sync_status`.*
7. **Holdings do not exist in our world.** The Sheet template has no holdings tab configured; the
   securities tables from [CR019](cr-019-quicken-import.md)/[CR022](cr-022-bank-feed-parallel-import.md) are
   **0 rows**, which is why [CR056](cr-056-investment-returns.md) had to derive investment returns from
   ledger postings and why [CR058](cr-058-quicken-valuation-anchors.md) has to reconstruct brokerage
   history from Quicken. *The API has `GET /accounts/{id}/holdings` — daily snapshots with quantity,
   price, value and cost basis.* Out of scope here (§8 P5), but it is the reason this CR matters beyond
   plumbing.

## 2. What the API gives us

Base `https://fintable.io/api/v2`, bearer PAT, OpenAPI 3.1 at `/api/v2/openapi.json`. Everything is
`{"data": …}`, money is an **exact decimal string**, timestamps are ISO-8601 UTC, ids are opaque ≤64
chars. Reads are **300/min per token** — far above anything we need.

| What we need | Sheet today | API |
|---|---|---|
| Account list | `Accounts` tab, 8 columns | `GET /accounts` (incl. disabled), `GET /accounts/{id}` |
| Balance | `⚡ Balance` (float) | `balance` + `balance_available` (decimal strings) |
| Account currency / type | `⚡ Currency`, keyword-guessed type | `currency`, `type` — **but see §11: `type` is mostly the raw bank product name, so the keyword inference stays** |
| Institution / connection | inferred from raw JSON | `GET /connections` → `id`, `provider`, `institution_name`, `healthy`, `needs_reconnect`, `accounts_count` |
| Upstream sync time | `⚡ Last Update` column | `connection.last_successful_update` + live `sync_status{state,stage,started_at,finished_at}` |
| Transactions | `Transactions` tab, whole-tab read | `GET /transactions` / `GET /accounts/{id}/transactions`, cursor-paged (`limit` ≤ 500) |
| tx → account | **display-name join** | `account_id` on every row |
| tx date / amount / currency | Excel serial / float / dug out of raw JSON | `date`, `amount`, `currency` |
| tx description / merchant | `⚡ Description`, merchant always `null` | `description` + `merchant` (cleaned — populated on 57% of sampled rows, §11g) |
| tx category hint | `⚡ Category` | `category{id,name,header}` + `category_manual_override` |
| Provider raw payload | `⚡ Raw Data` JSON string | `?include=raw` |
| Incremental | none | `?order=updated&updated_since=<ISO>` + cursor |
| Pending | in the Sheet, filtered downstream | `?pending=0` (docs say `false`; that 422s — §11i) |
| Holdings | none | `GET /accounts/{id}/holdings` (daily snapshots) |
| FX / prices | fin has its own | public `GET /rates` (ECB), `GET /prices` — no auth |

Errors are one shape (`{"error":{"type","message"}}`) with a documented type per status; 429 carries
`Retry-After`.

**Not in the API, by their own admission:** *deletions are invisible* — there is no tombstone. Their
advice is to not mirror pending rows and to re-fetch a trailing window periodically. We already never
delete, so this is not a regression, but it shapes §5.4.

## 3. Non-goals

- **No contract change.** `/v1/*` shapes stay exactly as `bank-feed/contracts/v1/README.md` pins them; fin's `bankFeedClient`, converter, staging and recon are untouched (§6).
- **No categorizer adoption.** We do not read Fintable's rules, and we never write categories back. COA mapping stays fin's job (bank-feed hard rule).
- **No auto-delete.** Fintable's docs say to drop cached transactions when an account disappears or flips `enabled:false`. We must **not** — 1,362 of our staged rows are already promoted into the ledger. We flag; a human decides.
- **No forced upstream refresh by default** (§5.6).
- **Holdings, FX and price endpoints are out of scope** — separate CRs (§8 P5).

## 4. The dominant risk: identifier continuity

The Sheet's ids are load-bearing in **four** places across **two** databases:

```
Fintable Sheet ⚡ Account ID (UUID)          →  bank-feed feed_accounts.external_id        (31 rows)
                                            →  fin account_source_mappings.external_name   (31 rows, 26 with a promote cutoff)
                                            →  fin bankfeed_staging.feed_account_external_id
Fintable Sheet ⚡ Transaction ID (hash)      →  bank-feed feed_transactions.external_id     (2,477 rows)
                                            →  fin bankfeed_staging (source, external_id) UNIQUE (2,130 rows)
                                            →  …of which 1,407 carry promoted_transaction_id → the ledger
                                            →  fin transactions.bank_feed_external_id      (1,392 rows)   ← FOURTH SITE
```
*(counts as of 2026-07-29; requery before P3 — they move with every feed pull.)*

**The fourth site is the one that bites, and rev 1 of this CR missed it** (pass-1 review B1).
`refreshBankFeedV2.js` promotes with `ON CONFLICT (bank_feed_external_id) WHERE bank_feed_external_id
IS NOT NULL DO NOTHING`, and its live-feed dedup candidate query only considers
`source = 'pocketsmith' AND bank_feed_external_id IS NULL`. So an already-promoted bank-feed row is
reachable **by no route except an exact `bank_feed_external_id` hit** — that column is fin's *only*
ledger-level duplicate guard. Rewrite the staging ids and leave the ledger's, and the guard matches
nothing: every promoted row re-delivers under its API id and inserts a second time. That is the Black
Card mechanism with no upper bound. **Migration 044 must rewrite `transactions.bank_feed_external_id`
in the same transaction**, joined through `bankfeed_staging.promoted_transaction_id`, and assert the
rewritten count equals the crosswalked promoted-staging count or roll back.

What we store today is a **UUID** (`d0bbc717-0e20-4b46-9e50-eb5d323849cc`) for accounts and a composite
hash (`3062089709092272539--cfd7113556c4611493343e2e7e709fff`) for transactions. The API's ids are
`acc_01J9V5…` / `tx_01JB2M…` (with "legacy numeric strings" on long-standing accounts). **They are
probably not the same strings.** If they differ and we simply swap adapters:

- every transaction re-enters `bankfeed_staging` as a *new* `external_id` → the unique key does not
  fire → **2,080 rows re-stage and up to 1,362 re-promote as duplicate ledger entries**. That is the
  Black Card incident again, three orders of magnitude larger, and again **net-of-payments invisible to
  a balance check**;
- all 31 `account_source_mappings` rows orphan at once — every fed account silently unmapped, taking
  their `feed_sign` / `feed_negate_tx` / `promote_from_date` settings with them.

**A second, independent version of the same risk:** the API can serve **more history than the Sheet
tab held**. Our earliest feed transaction is **2026-04-30**; Fintable holds whatever its
`sync_start_date` allows. A first API pull with no floor would back-fill months of pre-feed history
into staging — and **5 of the 31 mappings have `promote_from_date = NULL`**, i.e. "promote
everything", which is exactly how the Black Card duplicates got in. This risk exists *even if the ids
match*.

Both are addressed in §5.5 and §8 P0/P3.

## 5. Design

### 5.1 Shape of the change (bank-feed repo)

New files, nothing deleted until P4:

| File | Role |
|---|---|
| `src/adapters/fintableApi.js` | `fetchAccounts()`, `fetchConnections()`, `fetchTransactions({updatedSince, dateFrom, cursor})`, `probe()` — bearer auth, cursor paging, 429/`Retry-After` honoring, typed errors |
| `src/converters/fintableApiToCanonical.js` | API JSON → the same canonical shapes the Sheet converter emits. Much smaller: no Excel epoch, no JSON-string parsing, no name join, no upstream sniffing |
| `src/services/fintableSync.js` | **unchanged shell** — `runSync`/`requestSync` keep the freshness cap, in-flight coalescing and `sync_jobs` accounting; only fetch+convert are swapped behind the source switch |
| `src/config.js` | `fintable.source` (`sheets` \| `api`, default `sheets`), `fintable.apiToken`, `fintable.apiBaseUrl`, `fintable.minDate`, `fintable.fullSweepHours` |

`FINTABLE_SOURCE` is the rollback: one env var and a restart puts the Sheet path back, for as long as
the Sheet destination still exists.

### 5.2 Canonical mapping

```
connection  → bank_connections(source='fintable',
                institution_name = connection.institution_name,
                institution_id   = <unchanged where we already have one; see below>,
                raw = { connection_id, provider, healthy, needs_reconnect, sync_status })
account     → feed_accounts(external_id, name = display_name ?? name, currency, type, raw)
              + feed_balances(balance, currency, balance_date = sync date,
                              source_synced_at = connection.last_successful_update)
transaction → feed_transactions(external_id = tx.id, account_id via tx.account_id,
                transaction_date = tx.date, amount, currency, description,
                merchant = tx.merchant, category_hint = tx.category?.name,
                pending = false, raw = { row: <api row>, parsed: <?include=raw payload> })
```

Three deliberate details:

- **`raw.parsed` keeps its meaning.** bank-feed's `/v1/health/feeds` balance-drift check reads
  `raw->'parsed'->'balanceAfterTransaction'->…` in SQL. Requesting `?include=raw` and storing the
  provider payload at the same path keeps that query working **unchanged** — no health regression, no
  SQL edit. (205 of our rows currently carry that field.)
- **`institution_name` must not churn.** fin's recon page has a per-feed institution filter and the
  admin routing page has institution chips. The API's `institution_name` may read `Chase` where the
  Sheet gave us something longer. P0 captures both lists; any rename is applied deliberately in the
  crosswalk, not as a side effect. The six orphan `bank_connections` rows are cleaned up in the same
  step.
- **`type` does *not* replace the keyword heuristic** — corrected by P0. The docs describe
  `depository / checking`-style strings, but what the API actually returns for most accounts is the
  **raw bank product name**: `RACHUNEK OSZCZĘDNOŚCIOWY PLUS`, `Karta kredytowa PKO VISA Infinit`,
  `KONTO Z ŻUBREM`, `CREDITCARD`, `Brokerage`, and one empty string. Only 2 of 29 came back in the
  documented taxonomy. So `inferType` **stays**, fed `type` + `name` instead of the Sheet's product
  JSON, and P0's account dump is its acceptance test: **the accounts must keep the type they have
  today**. (`Brokerage` alone maps to three different current values — brokerage, checking and other —
  because today's inference reads SnapTrade's `raw_type` and names like `Options`, which the product
  string does not carry.)

### 5.3 Incremental sync

Per run:

1. `GET /connections` (1 call) — if no connection's `last_successful_update` has advanced since our
   last run and no full sweep is due, **stop**. This is the cheap tick; Fintable syncs banks every
   6–23h, so most hourly polls do nothing but this one call.
2. `GET /accounts` (1 call, 31 accounts) — balances and account metadata always refresh; that is what
   the recon page reads.
3. `GET /transactions?order=updated&updated_since=<high-water mark>&pending=false&include=raw&limit=500`,
   paged by `next_cursor` until `null`. The high-water mark is the highest `updated_at` processed,
   persisted (new `sync_state` table, or `sync_jobs.summary` — P1 decides) and advanced **only on a
   committed run**.
4. Weekly (`FINTABLE_FULL_SWEEP_HOURS`, default 168) a **full sweep** — same call with
   `date_from = <earliest we hold>` and no `updated_since` — to catch anything `updated_at` did not
   move for, and to report (not act on) rows we hold that Fintable no longer serves.

`pending=false` is Fintable's own recommendation for mirroring, and costs us nothing: fin's
`normalizeFeedTransaction` already drops `pending === true` before staging. `/v1/transactions` keeps
its `pending` field; it will simply always be `false`.

### 5.4 Deletions and disappearances

Never delete. A full sweep produces a **report** in `sync_jobs.summary`: rows we hold that the API no
longer returns, and accounts that vanished or went `enabled:false`. Surfaced on `/v1/health/feeds` and
the admin routing page. Acting on it is a human decision, because the ledger downstream is not ours to
rewrite.

### 5.5 Safety rails on the first API sync

Three, all cheap, all required:

1. **A date floor.** `FINTABLE_API_MIN_DATE` (and a per-account floor = the earliest date we already
   hold) so the first pull cannot back-fill pre-feed history behind fin's five NULL cutoffs.
2. **An insert-count guard.** If a single run would insert more than `FINTABLE_MAX_INSERTS_PER_SYNC`
   new transactions (default ~500 — a normal daily delta is a few dozen), the run **aborts and rolls
   back**, recording the count in `sync_jobs`. A silent 2,000-row insert is the failure mode we are
   guarding against, so it must be loud and reversible.
3. **A pre-cutover fin-side check:** every bank-feed mapping gets an explicit `promote_from_date`
   (the 5 NULLs filled in), so "promote everything" is nobody's default at the moment of the swap.

### 5.6 `POST /v1/sync` semantics stay put

fin's "Refresh from bank" button calls bank-feed `POST /v1/sync`, which today means *re-read the
Sheet*. Under the API it means *re-read Fintable* — same meaning, same cost class (a read), same
freshness-cap and coalescing guards. It does **not** map to Fintable's `POST /sync` (which asks the
provider to refresh and is limited to **2/day** on Personal/Trial, 403 on free). If we want that, it
goes behind an explicit `?upstream=true` and surfaces the 429/403 verbatim — a separate, deliberate
button, not a rename of this one.

## 6. What changes for fin (main app)

Ideally nothing, and that is the point of having a contract:

- `bankFeedClient.js`, `bankFeedToCanonical.js`, `bankfeed_staging`, the recon page, the promote path
  and the manual-CSV fallback are all **unchanged**.
- `source_synced_at` gets *more correct* — CR035's "synced N days ago" becomes the bank's real sync
  time instead of a spreadsheet's export time.
- `merchant` starts arriving populated (it is `null` today). fin stores it; nothing branches on it.
- `category_hint` will carry Fintable's category names, as it does now.
- **If §4's crosswalk is needed**, fin gets migration **044** rewriting `bankfeed_staging.external_id`,
  `bankfeed_staging.feed_account_external_id` and `account_source_mappings.external_name` — the only
  fin-side change in this CR, and the one that needs a prod backup and a window.

## 7. Verification

The load-bearing test is not a unit test — it is the **shadow diff** (P2): the same period, ingested
both ways, compared per account. It can fail, which is why it is worth running:

| Check | Passes when |
|---|---|
| Shadow diff, per account | transaction **count**, `SUM(amount)`, `MIN`/`MAX(transaction_date)` and latest balance identical between the Sheet-fed store and the API-fed shadow store, for all 31 accounts |
| Id continuity | P0's dump either matches every stored id, or the crosswalk maps **31/31 accounts and ≥99.9% of transactions**, with every unmatched row listed by hand |
| Converter fixtures | recorded P0 payloads → expected canonical rows, per upstream shape (GoCardless / SnapTrade / Plaid / MX). A fixture must exist for the **shared-name** case that caused the Black Card incident, and it must be **structurally unable** to mis-route (no name join in the code path) |
| Health parity | `/v1/health/feeds` returns the same `balance_reconciliation` verdicts before and after — proves `raw.parsed` survived |
| Insert guard | a deliberately over-sized run aborts and rolls back, and `sync_jobs` records why |
| Post-cutover, in fin | zero new `bankfeed_staging` rows dated before the cutover; ledger balances byte-identical for a week |

## 8. Phases

| | | |
|---|---|---|
| **P0** | **Spike — needs a read-only PAT** (½ day) | `GET /me`, `/connections`, `/accounts`, `/transactions?limit=5&include=raw` per account; dump to JSON fixtures. Answers: (a) do account ids equal our stored UUIDs? (b) do tx ids equal our composite hashes? (c) does `include=raw` carry `balanceAfterTransaction` / `ext_nordigen_acc_id` / SnapTrade `trade_date`+`symbol`? (d) do all **31** accounts appear, including the 6 Fidelity/SnapTrade ones? (e) how far back does history go, and what does `institution_name`/`type` read per account? **P0 decides whether P3 exists.** |
| **P1** | Adapter + converter + tests | Behind `FINTABLE_SOURCE` (default `sheets`). Unit tests on P0 fixtures. Nothing in prod changes. |
| **P2** | Shadow run | A scratch bank-feed DB fed by the API in parallel with the live Sheet-fed one; run the §7 diff for ≥3 days. Nothing in fin changes. |
| **P3a** | Account crosswalk — **31 rows, the only crosswalk being built** | Dry-run first. Accounts: the `{api_account_id}--{hash}` prefix, falling back to name+currency — **not balance**, which §11h shows trails by up to 302.32 on two accounts and would fail on Black Card specifically; abort on any candidate set ≠ 1, and abort on any disagreement between the two signals (they agree on every account today, so make that a precondition rather than a coincidence). Rewrites `feed_accounts.external_id`, `account_source_mappings.external_name` and `bankfeed_staging.feed_account_external_id`. Applied to bank-feed and fin **in one window**, after backups of both — fin via `Scripts/deploy-to-production.sh`, bank-feed via its **new** `scripts/backup-db.sh` (§17 M2). Rollback = restore, now rehearsed. |
| **P3b** | Transaction crosswalk — **CUT** (§17 M1) | The cutover-date floor removes the need: rows before the floor are never fetched, so they cannot be re-staged under an API id and cannot collide. What was a 2,480-row, four-site, 58.6%-match rewrite over 1,392 promoted ledger rows becomes a boundary window of a few dozen rows in the last week, hand-checkable. |
| **P4** | Cutover | **Apply bank-feed migration 005 to the live store first** — `sync_state` does not exist there, and the API path reads it on its first statement, so a bare flip fails at the first tick (migration-before-code, this repo's own rule). Set `FINTABLE_API_MIN_DATE` explicitly: it defaults to empty, which means **no floor**, so §5.5 rail 1 is opt-in. Fill the five NULL `promote_from_date` mappings. Then flip `FINTABLE_SOURCE=api`; keep the Sheet path callable for a week; watch `/v1/health/feeds` drift and fin's recon. Then remove the service account + keyfile + `googleapis` dependency, revoke the Sheet share, retire `FINTABLE_SHEETS_ID`, update [`secrets-inventory.md`](../current/secrets-inventory.md). |
| **P5** | *(separate CR)* Holdings | `GET /accounts/{id}/holdings` → the securities tables that are **0 rows** today. This is what makes [CR056](cr-056-investment-returns.md) a real returns report and gives [CR058](cr-058-quicken-valuation-anchors.md) a forward-looking counterpart. Deliberately not bundled here. |

## 9. Costs, risks, open questions

- **A new secret.** `FINTABLE_API_TOKEN` — a PAT, **valid 1 year**, revocable instantly. Needs a row in
  [`secrets-inventory.md`](../current/secrets-inventory.md) **and a calendar reminder**: silent expiry
  = a silently dead feed, which is the failure mode this project keeps re-learning. Read-only scope
  (`read`) is sufficient for everything in §5. Rotation is one env var + restart.
- **Vendor coupling is unchanged** — we already depend on Fintable; this removes Google from the path
  rather than adding anyone.
- **Their API is V2 and young.** Breaking changes are plausible; the adapter is the blast wall, and the
  Sheet path stays available until P4 completes.
- **Deletions stay invisible** (§5.4) — mitigated, not solved, and honestly the same as today.
- **Rate limits** are not a constraint at our size (300/min reads vs ~3 calls/hour), *except*
  Fintable's own `POST /sync` at 2/day — which §5.6 deliberately does not wire up.
- **Open question for the owner:** the plan tier. `GET /me` reports `can_sync` and the connection
  limits; free accounts get API reads but 403 on sync. P0 answers it in one call.

## 10. The MCP connector — use it, but not for ingestion

Fintable also ships an MCP server (`https://fintable.io/mcp`, add as a custom connector in Claude), and
it is worth setting up. It is **not** the right ingestion path for bank-feed:

- it authenticates by **OAuth 2.0 + PKCE** with 1-hour access tokens and 30-day refresh tokens, and
  requires the `mcp:use` scope (which is **full read *and* write** — plain `read` tokens are rejected).
  An unattended microservice would gain a token-refresh lifecycle and a write-capable credential in
  exchange for nothing;
- MCP tool calls consume **the same rate-limit buckets** as the REST endpoints they wrap — there is no
  capability or quota advantage;
- it is a tool-call surface designed for a conversational client, not a paging, cursor-resuming,
  high-water-mark ingestion loop.

Where it *is* useful: as an ops and triage surface for the owner (and for me, in an interactive
session) — "when did Fintable last sync Black Card", "does it think this connection is healthy", and
as a fast way to sanity-check P0's findings against the dashboard's own view. Recommendation:
**PAT for the service, MCP connector for the humans.** One caveat worth recording: interactively
authorized connectors are unavailable in headless/cron agent runs, so nothing automated may depend on
it.

---

## 11. Phase 0 findings (measured 2026-07-28)

Run with `bank-feed/scripts/fintable-api-probe.js` — read-only both ends, 58 API calls, fixtures in
the gitignored `bank-feed/tmp/fintable-probe/` (real financial data, never committed).

**(a) Account ids differ — but the crosswalk is exact, not heuristic.** API account ids are bare
numeric strings (`3062089709092272539`), ours are the Sheet's UUIDs; **0 of 31 overlap**. What the
probe found instead: our transaction ids are `{api_account_id}--{hash}` — the prefix of every
composite id **is** the API's account id, confirmed for **15/15** accounts whose ids are composite
(the 11 Plaid/SnapTrade accounts have opaque ids with no prefix to read). Those 11 plus the rest
resolve on name+currency, with balances agreeing on all but two (below). **29 API accounts → 29 of our
31, and the API returns nothing we don't already have.** So the account crosswalk is derived from our
own data, not from string similarity — that is a materially safer P3 than §4 assumed.

**(b) Transaction ids differ, and there is no embedded clue.** The API mixes ULIDs
(`tx_01KYM4KR481HV86R7CHJCMGKPB`) and bare numerics (`5766006175898839480`); **0 of 1,387** sampled
ids exist locally. Content matching on `(account, date, amount)` hits **1,324/1,387 (95.5%)**, and all
63 misses are on the four Chase/Akoya accounts — fully explained by (f) below, which lifts the match to
effectively 100%. The transaction crosswalk therefore has to be content-based, and needs the date basis
settled before it can be trusted.

**(c) `?include=raw` works and carries exactly what we depend on** — 26/29 accounts (the other 3 have
zero transactions). GoCardless rows carry `balanceAfterTransaction`, `ext_nordigen_acc_id`,
`transactionAmount`, `bookingDate`, `pending`; SnapTrade carry `trade_date`, `symbol`; Plaid carry
`account_id`; Akoya carry `accountId`. Storing that payload at `raw.parsed` keeps `/v1/health/feeds`'
balance-drift SQL working **unedited** (§5.2).

**(d) Two mapped accounts have vanished upstream.** `Christopher Biedermann (PLN) (8325)` and
`(EUR) (8325)` — both Revolut — are absent from `GET /accounts`, which *includes* disabled accounts, so
Fintable has deleted them. Both are **mapped in fin** (Revolut-PLN #214, Revolut-EUR #16) and hold
balances of 72.14 PLN and 58.13 EUR; the PLN one is also one of the five mappings with
`promote_from_date = NULL`. Under the Sheet path they would simply freeze forever; the API makes the
disappearance visible. **Owner decision** — closed wallets to unmap, or an upstream re-link to chase.

**(e) Plan and back-fill.** Tier **office**, `can_sync: true`, 13/50 connections — so Fintable's own
`POST /sync` is **1/hour**, not the Personal tier's 2/day (§5.6 unaffected: we still don't wire it up).
Back-fill risk is real but small: **3 of 29** accounts (Infinity CB, TOTAL CHECKING, Prime Visa) have
rows 1–2 days older than our earliest, because `sync_start_date` sits at 2026-05-01/06-01 and our first
Sheet sync landed a few days later. The §5.5 date floor covers it.

**(f) The API and the Sheet disagree on the transaction date for Chase/Akoya — and `auth_date`
explains it exactly.** The API's `date` is the **posted** date; its `auth_date` is what we have been
storing (the Sheet's `⚡ Date`). Verified row by row: `COSTCO WHSE #1123 184.85` is `date 2026-07-14 /
auth_date 2026-07-13`, ours is 07-13; `MONK'S STEAMER BAR 95.18` is `06-25 / 06-23`, ours is 06-23.
GoCardless and SnapTrade accounts matched 100% because the converter already reads `bookingDate` /
`trade_date`, which the API's `date` agrees with. **Owner decision, §12.**

**(g) Three smaller corrections to this CR's own claims.**
- `merchant` is **not** universally populated: 276 of 484 sampled rows (57%), and **0** on the Chase
  accounts. Real gain, smaller than §6 implied.
- `category` is `null` on **every** sampled row — the owner does not use Fintable's categorizer, which
  matches our store exactly (0 of 2,393 local rows carry a `category_hint`). `category_hint` stays
  null; nothing changes.
- Descriptions now carry `[SALE]` / `[PAYMENT]` / `[ADJUSTMENT]` tags that older Sheet rows lack, so a
  re-sync **rewrites `description` on existing staged rows** (the upsert already does
  `DO UPDATE`). Harmless downstream — promoted ledger rows keep their own copy — but it means a
  post-cutover diff of staging descriptions is expected, not a defect. CR055's suggest-key already
  strips those tags.

**(h) Two live signals the Sheet path cannot show us.** The `Bank Pekao` connection reports
`healthy: false` with its last successful update on **2026-07-24**. And our stored balances for
`Black Card (9915)` and `Delta SkyMiles® Reserve Card (1002)` trail the API's by 136.96 and 302.32 —
consistent with snapshot staleness rather than a data fault, but worth confirming during P2.

**(i) Two API bugs worth reporting upstream.** The documented `pending=true|false` filter is **rejected
with 422** (`"The pending field must be true or false."`); only `pending=0|1` is accepted. And the
`type` field does not follow its documented taxonomy (see §5.2). Both cost this spike a re-run — the
probe's first pass returned zero transactions for all 29 accounts and would have read as "the API has
no data" if it hadn't printed the error per account.

## 12. Decisions needed before P1

1. ~~**Date basis for the four Chase/Akoya accounts** (§11f).~~ **DECIDED — the posted `date`**
   (`date ?? auth_date`), after the first decision was reopened and reversed by P1's shadow run
   ([§13.2](#132-the-date-decision-did-not-survive-a-bigger-sample)). `auth_date` stays in `raw.row`.
   *The first call was made on the smallest of three samples and was wrong; the record of that is
   deliberately left in §13.2.*
2. ~~**The two dead Revolut wallets** (§11d).~~ **DECIDED 2026-07-28 — re-link Revolut selecting all
   three wallets.** The connection was re-created on 2026-06-06 and came back with **one** account
   instead of three, which is why PLN and EUR froze (fin still carries their last balances, 72.14 PLN
   and 58.13 EUR, matching our stored snapshots to the cent). The owner re-links from the Fintable
   dashboard — a bank login needs a real browser, and the read-scope token cannot POST anyway. The
   wallets return with **new** ids, which P3 crosswalks like any other account. *Worth keeping: a
   GoCardless re-consent silently reduced the fed account set, and nothing in the Sheet path could
   report it — `GET /accounts` including disabled accounts is what made it visible.*

---

## 13. Phase 1 — built and verified against a shadow store (2026-07-28)

Built, default OFF (`FINTABLE_SOURCE=sheets`), nothing in prod or fin touched:

| File | |
|---|---|
| `src/adapters/fintableApi.js` | cursor paging (cap 500), `Retry-After` on 429, typed `FintableApiError`, `probe()` reporting tier + unhealthy connections |
| `src/converters/fintableApiToCanonical.js` | API JSON → the identical canonical shapes the Sheet converter emits |
| `src/services/fintableSync.js` | source switch, incremental high-water mark, full-sweep schedule, insert guard, "held locally with no upstream counterpart" report |
| `db/migrations/005_sync_state.sql` | the durable cursor (`sync_state`), kept out of `sync_jobs` so a failed run cannot advance it |
| `src/config.js`, `scheduler.js`, `routes/sync.js` | `FINTABLE_SOURCE` + API settings; scheduler and `/v1/sync/probe` follow the selected upstream |

**146 tests pass (102 pre-existing + 44 new), and the new ones were checked against a sabotaged
source:** reverting the date basis and moving `raw.parsed` off its path turns 3 red; disabling the
insert guard turns 1 red. A green test on an unreachable path is this project's most expensive
recurring lesson.

### 13.1 The shadow run

A **throwaway** Postgres (never dev, never the live feed store), migrated from scratch, loaded from the
API in one pass: **13 connections, 29 accounts, 2,406 transactions, 0 skipped, 0 unknown-account, 3.9
seconds** — against 17 `bank_connections` rows (6 orphans) on the Sheet path. A second run went
**incremental: 5 rows in 1 page instead of 2,406**, inserted 0, and advanced the stored high-water mark.

Diffed per account against the live Sheet-fed store: **26 of 29 accounts identical on both row count
and `SUM(amount)`**. All three residuals are the accounts P0 predicted, and every extra row is dated
*before* our earliest local row — the pre-Sheet back-fill the date floor exists to gate, not divergence.

### 13.2 The date decision did not survive a bigger sample

The Prime Visa diff came back full of pairs that agree on amount and description but disagree on date —
in the **opposite** direction to Marriott Chase. Measured properly, over every Akoya row where the
API's two dates differ:

~~| Prime Visa | 17 | **65** | TOTAL CHECKING | 13 | 11 | Marriott Chase | 2 | 1 |~~
**That table was wrong, and pass-1 review B4 caught it.** It paired rows on the *exact* description,
which systematically excluded every row where the API appends a tag (§13.2 above) — a biased
subsample, and the bias was not evenly distributed. Re-measured pairing on the **tag-stripped**
description, unambiguous pairs only, over all rows where the API's two dates differ:

| Account | provider | matches `auth_date` | matches posted `date` |
|---|---|---:|---:|
| Prime Visa | Akoya | **108** | 62 |
| Marriott Chase | Akoya | **12** | 2 |
| TOTAL CHECKING | Akoya | **9** | 0 |
| Black Card | Plaid | 0 | **127** |
| Delta SkyMiles | Plaid | 0 | **76** |
| OC Medycyny | GoCardless | 0 | **38** |
| Hilton Aspire | Plaid | 0 | **13** |
| Marriott Bonvoy | Plaid | 0 | **4** |
| CaixaBank EUR | GoCardless | 0 | **1** |
| **total** | | **129** | **323** |

Two corrections follow, and the second matters more than the first:

1. **The Akoya numbers reverse.** Chase history is predominantly `auth_date` (129 of 193), not posted.
2. **"Chase/Akoya only" is false.** 243 of the 445 differing rows are on **Plaid and GoCardless**
   accounts — and on every one of them our stored date equals the **posted** date, without exception.

**The decision still stands, for a better reason than the one first given.** Choosing posted
(`date ?? auth`) leaves all 323 Plaid/GoCardless rows exactly where they have always been and moves
~129 Akoya rows; choosing `auth ?? date` would do the reverse and move more. Posted is also the only
option that is provider-consistent rather than a mixture rule. The `pending`-at-export explanation
remains unsupported — ingest lag is a median 2.9 days for posted-basis rows and 3.4 for auth-basis
ones, indistinguishable — so the split is still unattributed.

What follows regardless of which basis is chosen:
- **The P3 crosswalk cannot key on an exact date.** It must match on `(account, amount,
  normalized description)` with a ±3–5 day tolerance, because our own history is inconsistent.
- **And the normalization is load-bearing — measured, not assumed** (pass-1 review B2/B3). The raw key
  matches only **1,453 of 2,480 archived rows (58.6%)**. Of the 1,027 misses, **1,026 match on
  account+amount+date and fail on description alone**, because the API appends a trailing tag whose
  vocabulary is far wider than §11g's `[SALE]/[PAYMENT]/[ADJUSTMENT]`: `[SELL -3 @ 1.38]`,
  `[BUY SPAXX 1895.77 @ 1]`, `[LOAN SPLV -310]`, `[DIVIDEND QQQ]`, `[JOURNALED]`. Two more are Plaid
  rows where the API *replaces* the description with a cleaned merchant (`COMCAST / XFINITY` →
  `Comcast`). **The gate's own normalizer had the same defect** — `/\[[A-Z ]+\]/` silently kept every
  tag containing a digit or symbol; fixed to strip any trailing `\[[^\]]*\]`, which is most of the
  investment accounts.
- **Loosening it makes the match non-injective, which is the real design problem.** With a
  prefix-tolerant rule 2,474/2,480 match — but as **2,686 pairs**: 116 live rows have several
  candidates and 166 API ids are contested. **190** unmatched rows have `amount = 0.0000`, and on
  `Options` the same-day `EXPIRED PUT …` clusters are distinguished by *nothing but the description* —
  the exact field being loosened. So P3 must state (a) the tie-break (the gate's greedy
  nearest-date-then-description consume is a reasonable candidate), (b) the disposition of rows that
  never match — at least **63** cannot, since Black Card holds 242 live against the API's 180 — and
  (c) that the dry-run **aborts on any contested API id**, rather than discovering it as a unique-key
  violation halfway through a two-database migration.
- **Nine accounts across three providers are affected — not four Akoya ones** — and only for rows
  arriving after cutover. Existing ledger rows are crosswalked by id and keep their dates. Recorded
  consequence: **135 already-ingested rows** get their `bankfeed_staging.transaction_date` rewritten
  while the promoted ledger row keeps the old date; **5 of them cross a month boundary** (max gap 3
  days). (A re-sync does rewrite
  `bankfeed_staging.transaction_date` for already-promoted rows via the existing `DO UPDATE`; the
  promoted `transactions` row is untouched.)

**Decided: the API's posted `date`** — well-defined, what a card statement reconciles to, and what the
majority of our own recent history already agrees with; `auth_date` is kept in `raw.row`. Reloading the
shadow store on the new basis reproduces **the same 26 of 29 identical accounts**, and Prime Visa's
residual becomes clean (+2 rows, both from the pre-Sheet window) now that the date noise is gone —
which is the confirmation the choice was the right one.

## 14. The equivalence gate (`scripts/compare-sources.js`, run 2026-07-28)

Nothing goes live on the strength of a spot check, so the comparison is a committed, repeatable script
with a pass/fail exit code — `npm run compare-sources`. It reads **both upstreams at the same moment**
and compares each converter's canonical output. Deliberately not the database: that isolates *is the
API the same data* from *has our ingest run yet*.

**The pass criterion is directional, because the two sources are not symmetric.** Only differences that
*lose* something fail the run: a transaction or an account the **Sheet** has and the API does not, or a
disagreeing currency. Rows the API adds are reported, never punished — but they are printed, so a PASS
can never be mistaken for "the two sources are identical". `pending` rows (the API path asks for
`pending=0`, fintable's own advice, and fin drops them anyway) and date shifts within the tolerance
(§13.2) are expected and ignored.

| | |
|---|---:|
| rows matched | **2,175** |
| date-shifted (posted vs authorization, Chase/Akoya only) | 135 |
| API has, Sheet lacks — *inside the Sheet's own date range* | **9** |
| API has, Sheet dropped — older than the Sheet's window | 222 |
| **Sheet has, API lacks** | **0** |

**Zero in the only direction that matters.** There is not one transaction, and not one field, that the
Sheet carries and the API does not.

**The nine are the finding.** They are not rows the Sheet never saw — **our own database ingested them
from the Sheet earlier and still holds them**: four `-250.00` rows on PKO Main dated 2026-06-03 (the
Sheet now shows one row that day, ours shows five) and five OC Medycyny rows in early July (ours has 38
July rows, the Sheet 33). Across all accounts the Sheet holds **2,176 rows against the API's 2,406**,
and on the GoCardless accounts it holds roughly half (Infinity CB: 116 vs 230). **The Sheet is a lossy
rolling view that drops rows it once carried; Postgres is the archive, and the API agrees with the
archive.** That is a strong argument for this CR — the current upstream is quietly shedding data.

**But not the argument rev 2 made here, which pass-2 review M3 knocked down.** This section claimed the
loss "shows up as a wrong number" on two accounts. It does not: `OCME Sp. z o.o.` (fin account 45) has
**no bank-feed mapping** — it is on the manual path — so fin never reads that balance and the
7,120.17 PLN is invisible to the owner. That left Black Card's 136.96, which **§11h attributes to
snapshot staleness rather than a data fault** — this CR was giving two incompatible explanations for
its own headline number. The value case rests on the arguments that survive, and they are the strong
ones: the display-name join stops existing (the Black Card mechanism — 31 duplicates, net +$267,
invisible to a balance check), silent upstream failures become visible (Pekao unhealthy since
2026-07-24; a June re-consent dropped two mapped wallets and went unnoticed for seven weeks), a whole
credential system leaves the path, and `source_synced_at` becomes true.

**It failed on first run, correctly** — the two Revolut wallets (§11d) still appeared in the Sheet but
no longer existed upstream. **After the 2026-07-28 re-link it PASSES**, with one recorded exception
(below). See §16 for what the re-link did and did not fix.

**The exception list has to be earned.** `scripts/compare-exceptions.json` holds accepted differences,
each with a reason; every entry is printed on each run, and **an entry that stops matching anything
fails the run** — an allowlist nobody re-earns is exactly how a gate becomes something people learn to
ignore. Anything unlisted still fails. Verified by exit code in both directions: the real list exits 0,
a deliberately bogus one exits 1 (1 unaccounted + 1 stale).

*Field differences, all improvements, none of them blocking:* the API's account `type` classifies four
credit cards as `credit` where the Sheet-derived heuristic said `other`, and two Fidelity accounts as
`brokerage` (vs `checking`/`other`). Verified safe: fin's reconciliation reads its **own**
`accounts.account_type`, never the feed's, so `feed_accounts.type` is display-only downstream.

## 15. What else the API makes possible

The docs describe a good deal more than an ingestion feed. Assessed against what fin and bank-feed
actually need — several are worth doing, two are worth refusing.

**A. Connection health and one-click reconnect — do this first.** `GET /connections` already gives
`healthy`, `needs_reconnect` and `status_text`; `POST /connections/{id}/link` mints a browser link to
re-authenticate a bank. Today's evidence for why this matters is not hypothetical: **Bank Pekao has
been reporting `healthy: false` since 2026-07-24** and nothing in our stack could say so, and a Revolut
re-consent silently reduced a three-wallet connection to one. The Sheet path cannot express either.
Surface the flag on the recon page and the admin routing page, with a Reconnect button that mints the
link for the owner to open. *Needs a **write-scope** token — the only item here that does.*
Small; belongs in this CR as a P5.

**B. Holdings — the biggest one, and its own CR.** `GET /accounts/{id}/holdings` returns daily
snapshots with quantity, price, market value and cost basis. fin's securities tables are **0 rows**
(verified: `securities` 0, `quicken_price_staging` 0), which is why [CR056](cr-056-investment-returns.md)
had to derive investment returns from ledger postings and [CR058](cr-058-quicken-valuation-anchors.md)
has to reconstruct brokerage history out of Quicken. Six Fidelity accounts feed this. Caveats to design
around: `cost_basis` is the **position total, not per share** (a provider quirk fintable passes through
rather than guessing at), there is **no history pagination** — one call per day per account — and
snapshots only exist from whenever fintable started recording.

**C. Market prices — pairs with B, public and unauthenticated.** `GET /prices?symbols=` (≤50 tickers)
and `/prices/{symbol}/history` (adjusted for splits and dividends). fin has **no** market-price source
at all today. Caveat worth respecting: the default `iex` feed is one exchange, not the consolidated
tape, and is cacheable for up to an hour — fine for valuing a position, not a quote. Same CR as B.

**D. Sync control.** `GET /sync` exposes the schedule, live progress and per-connection state;
`POST /sync` asks fintable to pull from the bank — **1/hour at this account's office tier** (not the
2/day the docs quote for Personal). This is the one thing that would make fin's "Refresh from bank"
button mean what its label says, instead of "re-read what fintable last exported". Recommend keeping
the default as a read and adding an explicit *Force upstream refresh* that respects the budget and
surfaces 429/403 verbatim.

**E. `sync_start_date` per account/connection** (`PATCH`). Could be aligned with fin's
`promote_from_date` so history we have decided not to promote is never fetched at all. Hygiene, not a
capability; the ingest-side date floor already covers the risk. Low priority, write scope.

**F. Onboarding a new bank** (`POST /connections/link`). Would let the admin page add a bank without
visiting fintable's dashboard. For a single-user setup the dashboard already does this well —
**skip** unless the owner wants one place for everything.

**G. The categorizer — recommend against.** Categories and JSONLogic rules are a complete second
categorization system, and fin already has a COA plus [CR055](cr-055-category-suggest-backoff.md)'s
suggest engine. Adopting it creates two sources of truth for the same decision. (Confirms itself in the
data: **every** sampled transaction came back with `category: null`, matching our own 0 of 2,393
category hints — the owner does not use it.) The only defensible slice — pushing fin's chosen category
back so the fintable dashboard isn't blank — is cosmetic and needs write scope. Skip.

**H. Diagnostics — cheap, fold into the existing probe.** `GET /me` (tier, connection headroom,
renewal) and `GET /integrations` (which spreadsheets fintable still writes to, and whether they are
healthy) — the latter is how we confirm at P4 that nothing still depends on the Sheet.

**I. FX rates — no new capability.** fintable's `/rates` is ECB data; fin already pulls ECB data
through **Frankfurter** (`exchange_rates.source = 'frankfurter'`). Same numbers, same publisher. Worth
knowing only as a fallback if Frankfurter ever goes away.

**Explicitly not wired: `DELETE /connections/{id}`** (purges a bank and its data upstream) and
**`PATCH /accounts/{id}` with `enabled: false`**, which fintable's own docs warn **permanently deletes
that account's transactions**. Neither belongs behind a button in our admin page.

*Proposed split:* **A, D, H** are small bank-feed additions and fit this CR as **P5**. **B + C** are a
new CR of their own — they add tables, a backfill and a report surface, and they are the reason the
API matters beyond plumbing.

## 16. The Revolut re-link — what it fixed, and the decision to proceed without it (2026-07-28)

The owner re-linked Revolut. **All three wallets are served again** (31 API accounts, up from 29) with
live balances, so the gate's account-level failure cleared. Two things did not resolve:

1. **The connection's sync is stuck failed.** `healthy: false`, last job `state: failed`, stage frozen
   at *"Queued categorizer pass (0 rules)…"* across six polls over 2½ minutes; both rebuilt wallets
   report `last_tx: null`. Balances came through, transactions did not. Bank Pekao shows the same
   `PROCESSING` state, so this looks like a fintable-side queue rather than anything about Revolut.
   Retrying needs the dashboard or `POST /sync/{id}` — a **write** the read-scope token cannot make.
2. **The rebuilt wallets came back with `sync_start_date = 2026-06-28`**, so fintable will never
   re-serve anything before that date for them — including one Sheet row (EUR, 2026-06-08, +25.00).

**Decision: proceed.** Those two wallets have been dead on the Sheet path since the 2026-06-06
re-consent; cutting over does not degrade them, it replaces a stale 58.13 with a live 98.13. The one
unserved row is **already promoted into fin's ledger** (`promoted_transaction_id` set), so nothing is
lost — it is recorded as an accepted exception with that reasoning rather than left as a red gate.

**One real gap, and it is small.** The EUR wallet's last transaction anywhere is **2026-06-08** while
its live balance is **98.13** against our stored 58.13 — **+40.00 of activity that exists in neither
source**, because the Sheet stopped and the API's window starts 2026-06-28. If those transactions fall
after 06-28 a working sync will deliver them; if they fall in the 06-08 → 06-27 gap they will never
arrive and need a manual entry ([CR025](cr-025-manual-transaction-entry.md)) or a statement upload
([CR036](cr-036-manual-statement-upload.md)). PLN is 72.14 on both sides — nothing missing there.

**Open design item raised by pass 1 (S1): connection identity churns wholesale at cutover.** The
converter sets `institution_id` to fintable's `conn_nordigen_…`, a different namespace from the Sheet
path's PSD2 ids (`PKO_BPKOPLPW`), and `ensureConnections` matches on `(source, institution_id)` — so
cutover would create **13 new `bank_connections` rows**, reparent all 31 accounts and orphan the
existing 17, the opposite of §5.2's promise to clean the orphans up. Names churn too (`Fidelity` →
`Fidelity (Connection-1)`), which renames the recon page's institution chip for six accounts and breaks
§5.2's "`institution_name` must not churn". And since fintable connection ids change on re-consent
(§16), this reintroduces the 17-rows-for-11-institutions problem by a new mechanism. **The identity
rule has to be decided deliberately before P3**, and `bank_connections` added to §4's inventory.

**Two conditions carried into P3/P4:** the rebuilt wallets have **ULID-style ids**
(`acc_01KYN7AH3…`) and no transactions, so they carry no `{account_id}--{hash}` prefix and must
crosswalk by name+currency — the fallback path, with one PLN and one EUR wallet each so it is
unambiguous. And **Revolut-PLN and Revolut-USD are two of the five `promote_from_date = NULL`
mappings** (§5.5) that must be filled before cutover regardless.

## 17. Pass-2 sign-off (`cr-signoff-pm`) — **revise**, and one finding removed the riskiest phase

**M1 — the transaction crosswalk was never necessary, and this CR did not notice.** It carried *both*
a date floor (§5.5) *and* a full-history crosswalk (§8), without ever asking what the second buys once
the first exists. The answer: almost nothing — because the floor was specified as "the earliest date we
already hold", which is exactly the setting that *forces* the crosswalk. **Owner decision 2026-07-29:
set the floor at cutover − ~7 days and cut P3b.** Rows before the floor are never fetched, never
staged under an API id, and cannot collide; the boundary window is a few dozen recent rows. The
riskiest data migration this project has attempted is deleted rather than mitigated.

*What that forfeits, stated rather than left as a side effect (pass-2 R6):* upstream **corrections** to
pre-floor rows will never reach us, and the **222 rows of pre-Sheet history** the API holds (§14) stay
unfetched. Both are small; both are revisitable later with cutoffs set. **P3a — the 31 account
mappings — is unavoidable and unchanged**: `account_source_mappings.external_name` holds Sheet UUIDs,
and orphaning them takes every fed account's `feed_sign`, `feed_negate_tx` and `promote_from_date` with
it.

**M2 — the bank-feed database had no backup at all. Fixed and rehearsed.** "Rollback = restore" was
unimplementable for half the migration: `deploy-to-production.sh` and `backup-to-remote.sh` both dump
only `fin-postgres`, and `bank-feed/scripts/` had no backup script. Added `scripts/backup-db.sh`
(gzip-integrity + table-count checked, because a dump that cannot be read back is not a backup), and
**rehearsed the restore into a throwaway container: exit 0, zero errors, all four counts identical to
live** — 31 accounts, 2,480 transactions, 17 connections, 1,499 jobs.

**M3, M4 — applied in rev 3/4** (the value headline that rested on an unmapped account; the index,
roadmap and footer that disagreed with reality).

**M5 — P5 is cut from this CR.** Two reasons from the CR's own text: the reconnect link needs a
**write-capable token**, which §10 rejected for MCP on exactly that ground, and surfacing connection
health on fin's pages changes the `/v1` surface against non-goal #1. **But the read-only half moves
forward now, outside this CR** (pass-2 R3): `GET /connections` already returns `healthy` /
`needs_reconnect` / `status_text` with the read-scope token in hand and works regardless of
`FINTABLE_SOURCE`. Pekao has been unreported for five days. Tracked as [CR060](cr-060-feed-connection-health.md);
holdings + prices as [CR061](cr-061-holdings-and-prices.md).

**R1 — the never-fired full sweep is now exercised**, by forcing a tick rather than waiting for
2026-08-04: **2,422 rows in 5 pages, 0 inserted / 2,422 updated** — idempotent — with the upstream
report correctly naming both unhealthy connections. A code path that has never received data is this
project's most expensive recurring lesson; it has now received data.

**R2 — the insert guard is re-sized on measurement, 500 → 300.** 2,406 rows over ~89 days is ~27/day,
so a cutover floor's first read is ~190 rows and a daily delta is a few dozen; 300 is ~11 days of
traffic. The old 500 sat within 15% of a 438-row batch already seen in the wild — those were updates,
which do not count toward the guard, but the margin was too thin to defend.

**R5 — done 2026-07-30, though not the way pass 2 sketched it (migration 043).** Three of the five
`promote_from_date = NULL` mappings are ignore-only rows where a cutoff is meaningless and setting one
now would bake in a stale date; they stay NULL. The two live ones are pinned to the earliest row already
staged for them (Revolut-USD → 2026-07-26, Revolut-PLN → today), so **today's behavior is unchanged**
while a row arriving *later* dated before that point is blocked. `setBankFeedMapping` now applies the
same pin whenever an account is mapped.
*Pass 2 proposed defaulting to `CURRENT_DATE` or requiring a cutoff at mapping time. Rejected on
inspection: `promote_from_date` is **read-only everywhere in the frontend** — it appears in help text
and the diagnostic page, with no write path in the API — so an account mapped today would promote
nothing and the owner would have no way to fix it. **Stated plainly: this does not close the Black Card
class.** Those 31 duplicates were already staged at the moment of mapping, so a pin derived from staged
rows would have included them. Closing it needs a deliberate cutoff *choice* at mapping time, which
needs that UI write path — [roadmap §4](../current/project-roadmap.md).*

**Build order from pass 2:** **P3a + P4 first** among the in-progress CRs, ahead of CR019's
investment-side promote and CR023's tail — both want a quiet feed surface and neither is moving.

## Status

P0 done (§11), P1 built and shadow-verified (§13), both §12 decisions settled, default still
`FINTABLE_SOURCE=sheets` — nothing in prod or fin has changed. **146 tests green.**

**The equivalence gate (§14) PASSES** with one earned exception (§16). **P2 is running**: an hourly
cron tick (`scripts/p2-shadow-run.sh`, installed 2026-07-28, `17 * * * *`) syncs the throwaway shadow
store incrementally and re-runs the gate, appending one line per hour to `tmp/p2-shadow.log`. It never
touches the live feed store or fin, and aborts loudly rather than logging a green line against a dead
container. What the days buy that two runs minutes apart cannot: a stalled high-water mark, an upstream
edit that never moves `updated_at`, or a full sweep that never fires. Then **P3**, the crosswalk, whose
shape P0/P1 have now fixed: accounts from the `{api_account_id}--{hash}` prefix (exact), transactions
by `(account, amount, tag-normalized description)` within a few days (§13.2).

**Both review passes returned `revise`; everything they raised is now applied or tracked — see §17.**
The headline: pass 2 established that the **transaction crosswalk was never necessary**, and it is cut.
What remains to build is **P3a** (31 account mappings, exact key) and **P4** (cutover). Migration 044
in fin is correspondingly smaller — three id sites on 31 rows, not four sites on 2,480.
