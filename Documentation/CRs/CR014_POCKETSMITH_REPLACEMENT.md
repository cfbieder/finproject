**Status:** OPEN — [Plan](../FC_NEXT_STEPS.md#cr014)

# CR014 — PocketSmith Replacement

# PocketSmith Replacement Analysis

**Date:** 2026-03-14
**Purpose:** Evaluate alternatives to PocketSmith for bank transaction aggregation in the Fin project.

> **Caveat:** Pricing details are based on research as of early 2026. All providers use contact-sales models for production pricing. Verify directly before committing.

---

## Current State: How PocketSmith Is Used

PocketSmith serves as a bank aggregation intermediary. It connects to banks (PKO Bank Polski, US accounts, etc.), pulls transactions, and exposes them via its REST API. The Fin project:

1. Calls PocketSmith API (`GET /users/{id}/transactions` with `updated_since` for delta sync)
2. Stages raw data in `psdata_staging` table
3. Syncs to `transactions` table with account/category mapping (name → FK)
4. Provides a review UI (accept, edit, split, neutralize transactions)

**PocketSmith-specific code is well-isolated:**
- `server/src/services/retrieval/pocketsmith.js` — API client
- `server/src/services/retrieval/psdataConverter.js` — field mapping
- `server/src/v2/services/refreshPsApiV2.js` — 5-step sync pipeline
- `server/src/v2/services/psCsvIngestorV2.js` — CSV import fallback

**Required data fields from any replacement:**

| Field | Required? | Currently From |
|-------|-----------|----------------|
| Transaction ID (unique) | Yes | `transaction.id` |
| Transaction date | Yes | `transaction.date` |
| Amount (local currency) | Yes | `transaction.amount` |
| Currency code | Yes | `transaction_account.currency_code` |
| Account/institution reference | Yes | `transaction_account.name` |
| Payee/merchant name | Yes | `transaction.payee` |
| Amount in base currency (USD) | Valuable | `transaction.amount_in_base_currency` |
| Category | Valuable | `transaction.category.title` |
| Closing balance | Valuable | `transaction.closing_balance` |
| Transaction type (credit/debit) | Valuable | `transaction.type` |
| Original payee | Nice-to-have | `transaction.original_payee` |
| Labels/tags | Nice-to-have | `transaction.labels[]` |
| Memo, Note | Nice-to-have | `transaction.memo`, `transaction.note` |
| Bank/institution name | Nice-to-have | `transaction_account.institution.title` |

---

## Option 1: GoCardless Bank Account Data (formerly Nordigen)

### Overview
PSD2/Open Banking-focused aggregator acquired by GoCardless. Strongest in EU coverage with a free tier.

### Pricing

| Tier | Cost | Limits |
|------|------|--------|
| **Free** | $0 | ~50 bank connections, limited API calls/day |
| **Paid** | Contact sales | Scaled by connections and API volume |
| **Premium** | Contact sales | Enhanced data, longer history for some institutions |

### Bank Coverage

| Region | Coverage | Notes |
|--------|----------|-------|
| **EU/EEA** | 2,000+ institutions across 31 countries | Core strength, PSD2-mandated APIs |
| **Poland** | PKO BP, mBank, ING, Pekao, Santander PL, Alior | Strong coverage |
| **UK** | Major banks (Barclays, HSBC, Lloyds, Monzo, etc.) | Good via Open Banking |
| **US** | **NOT SUPPORTED** | No PSD2 equivalent — critical gap |
| **Canada** | Not supported | No open banking regulation |

### API Data — Transaction Fields

| GoCardless Field | Maps To (psdata_staging) | Notes |
|------------------|--------------------------|-------|
| `internalTransactionId` | `ps_id` | Stable GoCardless-assigned ID |
| `bookingDate` | `transaction_date` | When transaction was booked |
| `transactionAmount.amount` | `amount` | String, needs parsing |
| `transactionAmount.currency` | `currency` | ISO 4217 |
| `creditorName` / `debtorName` | `description1` | Counterparty name |
| `remittanceInformationUnstructured` | `description2` or `memo` | Free-text, quality varies by bank |
| `bankTransactionCode` | `transaction_type` | Bank-specific code |
| (not provided) | `base_amount` | **Must calculate yourself** using FX rates |
| (not provided) | `closing_balance` | Available via separate `/balances/` endpoint |
| (not provided) | `category_name` | **No auto-categorization** |
| (not provided) | `labels`, `note` | Not available |

### Authentication Flow
1. Create end-user agreement (specify scopes + validity)
2. Create requisition → generates redirect URL
3. User authenticates at their bank's OAuth page
4. Callback → requisition contains linked account IDs
5. Poll for transactions via `/accounts/{id}/transactions/`
6. **Re-authentication required every 90 days** (PSD2 mandate)

### Developer Experience
- REST API with `nordigen-node` npm package (may be rebranded)
- Good documentation at `developer.gocardless.com`
- Dashboard for managing keys and testing
- Basic integration achievable in ~1 day

### Strengths
- Free tier (up to 50 connections)
- Strong Polish bank coverage
- PSD2-regulated (secure, reliable EU connections)
- Simple REST API

### Weaknesses
- **No US bank support** — dealbreaker if US accounts needed
- No auto-categorization (you'd need to build or find this)
- No base currency conversion (must use your existing FX rates)
- 90-day re-auth requirement needs UX handling
- Transaction field quality varies wildly by bank
- Data not real-time (polling-based)

### Implementation Difficulty: **Medium**
- Replace `pocketsmith.js` with GoCardless API client (~1 day)
- Update `psdataConverter.js` field mappings (~0.5 day)
- Build bank connection redirect flow in frontend (~1-2 days)
- Build consent expiry management (90-day re-auth) (~1 day)
- Handle missing fields (base_amount calculation, no categories) (~1 day)
- **Total estimate: 4-6 days**
- **Does not solve US bank connectivity**

---

## Option 2: Salt Edge

### Overview
Established bank data aggregator (founded 2013). Broadest global coverage with 5,000+ institutions. Offers both PSD2-compliant and credential-based connections.

### Pricing

| Tier | Cost | Limits |
|------|------|--------|
| **Sandbox** | Free | Test/fake providers only — no real bank connections |
| **Production** | Contact sales | Per-connection + platform fees |
| **Typical starting cost** | ~€200-500+/month (estimated) | Varies by volume and region |

No free production tier. Contact sales required.

### Bank Coverage

| Region | Coverage | Notes |
|--------|----------|-------|
| **EU/EEA** | Extensive (PSD2) | Strong across all EU countries |
| **Poland** | PKO BP, mBank, ING, Pekao, Santander PL | Explicitly supported |
| **UK** | Major banks | Via Open Banking |
| **US** | Major banks (Chase, BofA, Wells Fargo, etc.) | Via screen-scraping (not API-based) |
| **Canada, Australia, Israel** | Available | Varies by institution |

**Key advantage: Covers both US and EU banks in a single provider.**

### API Data — Transaction Fields

| Salt Edge Field | Maps To (psdata_staging) | Notes |
|-----------------|--------------------------|-------|
| `id` | `ps_id` | Salt Edge transaction ID |
| `made_on` | `transaction_date` | Booking date |
| `amount` | `amount` | Numeric |
| `currency_code` | `currency` | ISO 4217 |
| `description` | `description1` | Transaction description |
| `category` | `category_name` | **Auto-categorized** (groceries, utilities, etc.) |
| `extra.original_amount` | `base_amount` (partial) | Available for FX transactions |
| `extra.original_currency_code` | — | Original currency |
| `extra.account_balance_snapshot` | `closing_balance` | When available |
| `extra.merchant_id` | — | Merchant identifier |
| `mode` | `transaction_type` | normal, fee, transfer |
| `status` | — | posted, pending |
| (account metadata) | `account_name`, `bank` | From account/connection objects |

### Authentication Flow
1. Create "connect session" via API
2. Redirect user to Salt Edge Connect widget
3. User selects bank → authenticates (OAuth for PSD2, credentials for US)
4. Callback to your app with connection ID
5. Fetch transactions via connection ID
6. Re-authentication: 90 days (PSD2) or as-needed (credential-based)

### Developer Experience
- REST API — **no official Node.js SDK** (use axios/fetch)
- Good documentation with Postman collection
- Sandbox with fake providers
- Webhooks for connection status and new transactions

### Strengths
- **Broadest coverage** — US + EU + UK in single provider
- **Auto-categorization** built in (great for personal finance)
- Credential-based connections for non-PSD2 banks (broader reach)
- Webhook support for transaction notifications
- Established company (10+ years)

### Weaknesses
- **No free production tier** — estimated €200-500+/month
- No official Node.js SDK
- US connections rely on screen-scraping (can break)
- Contact-sales pricing = friction for personal project
- Two separate APIs (Spectre vs Partners) can be confusing

### Implementation Difficulty: **Medium**
- Replace `pocketsmith.js` with Salt Edge REST client (~1 day)
- Update `psdataConverter.js` field mappings (~0.5 day)
- Build Connect widget redirect flow in frontend (~1-2 days)
- Handle connection lifecycle (90-day re-auth, webhook handlers) (~1-2 days)
- Map Salt Edge categories to your COA categories (~0.5 day)
- **Total estimate: 4-6 days**
- **Solves both US and EU bank connectivity**

---

## Option 2b: TrueLayer

### Overview
UK-founded fintech (2016). Strong UK/EU coverage. Increasingly focused on payments rather than data aggregation.

### Pricing

| Tier | Cost | Limits |
|------|------|--------|
| **Sandbox** | Free | Test environment only |
| **Production** | Contact sales | Per-connection or per-call fees |

No free production tier. Contact sales required.

### Bank Coverage

| Region | Coverage | Notes |
|--------|----------|-------|
| **UK** | Excellent | Core market, deepest coverage |
| **EU (Western)** | Good | France, Germany, Spain, Italy, Netherlands |
| **Poland** | **Limited / unproven** | Eastern EU coverage lags behind |
| **US** | Growing (launched ~2023-24) | Less mature than UK/EU |

### API Data — Transaction Fields

| TrueLayer Field | Maps To (psdata_staging) | Notes |
|-----------------|--------------------------|-------|
| `transaction_id` | `ps_id` | TrueLayer ID |
| `timestamp` | `transaction_date` | ISO timestamp |
| `amount` | `amount` | Numeric |
| `currency` | `currency` | ISO 4217 |
| `description` | `description1` | Transaction description |
| `transaction_category` | `category_name` | Bank's own category (not TrueLayer-generated) |
| `merchant_name` | `description1` (alt) | When available |
| `running_balance` | `closing_balance` | When available |
| `transaction_type` | `transaction_type` | credit/debit |
| `meta` | — | Provider-specific extra fields |

### Developer Experience
- **Official Node.js SDK** (`truelayer-client-javascript`)
- Excellent documentation (best-in-class)
- Sandbox with detailed test scenarios
- Webhooks for events

### Strengths
- Best developer experience and documentation
- Official Node.js SDK reduces boilerplate
- Excellent UK coverage
- Strict OAuth-only (more secure)

### Weaknesses
- **Weak Polish bank support** — critical gap for this project
- No auto-categorization (relies on bank's own categories)
- **Strategic pivot toward payments** — Data API may receive less investment
- No free production tier
- US coverage still maturing

### Implementation Difficulty: **Medium**
- Similar effort to Salt Edge (~4-6 days)
- Node.js SDK reduces API client work
- **Polish bank coverage gap may be a dealbreaker**

---

## Option 3: Plaid

### Overview
US-dominant bank aggregation leader. Best-in-class US coverage with 12,000+ institutions. Expanding internationally.

### Pricing

| Tier | Cost | Limits |
|------|------|--------|
| **Sandbox** | Free | Fake data, full testing |
| **Development** | Free | ~100 live bank connections |
| **Production** | Contact sales | ~$0.30-$1.50 per connected account (estimated) |

**The Development tier (100 live connections for free) is excellent for a personal project.**

### Bank Coverage

| Region | Coverage | Notes |
|--------|----------|-------|
| **US** | 12,000+ institutions | Industry-leading |
| **Canada** | Major banks (TD, RBC, Scotiabank, BMO) | Good |
| **UK** | Major banks | Via Open Banking |
| **EU (Western)** | Growing | Expanding but not comprehensive |
| **Poland** | **Unlikely** | EU expansion has been slow, Eastern EU lagging |

### API Data — Transaction Fields

| Plaid Field | Maps To (psdata_staging) | Notes |
|-------------|--------------------------|-------|
| `transaction_id` | `ps_id` | Plaid ID |
| `date` / `authorized_date` | `transaction_date` | When posted/authorized |
| `amount` | `amount` | Numeric (positive = debit in Plaid convention) |
| `iso_currency_code` | `currency` | ISO 4217 |
| `merchant_name` | `description1` | Merchant name |
| `name` | `description2` | Full transaction description |
| `personal_finance_category` | `category_name` | **Auto-categorized** (detailed hierarchy) |
| `payment_channel` | `transaction_type` | online, in_store, etc. |
| `pending` | — | Boolean pending flag |
| `account_id` | `account_name` | Need to resolve via accounts endpoint |
| (not provided) | `base_amount` | Must calculate using FX rates |
| (not provided) | `closing_balance` | Available via `/accounts/balance/get` |
| `location` | — | Merchant location data |

### Authentication Flow
1. Create link token via API
2. Open Plaid Link (drop-in widget) in frontend
3. User selects bank → enters credentials in Plaid's secure modal
4. Plaid returns `public_token` → exchange for `access_token`
5. Use access token to fetch transactions
6. Re-auth: credential-based connections may break periodically; Open Banking = 90 days
7. **Webhooks** notify of new transactions, errors, re-auth needs

### Developer Experience
- **Official Node.js SDK** (`plaid-node`) — well-maintained
- Excellent documentation (industry benchmark)
- Quickstart repos for rapid prototyping
- Plaid Link widget is polished and user-friendly
- Python, Ruby, Go, Java SDKs also available

### Strengths
- **Best US coverage** by far (12,000+ institutions)
- **Free Development tier** (100 live connections — perfect for personal use)
- **Auto-categorization** with detailed `personal_finance_category` hierarchy
- Best-in-class documentation and developer experience
- Official Node.js SDK
- Webhooks for transaction updates (near real-time notifications)
- Investment and liability data also available

### Weaknesses
- **Polish bank support unlikely** — EU expansion focused on Western Europe
- Amount convention is inverted (positive = debit) — needs handling
- Credential-based connections can break
- Production pricing requires sales contact
- Data refreshes 1-2x/day (not real-time)

### Implementation Difficulty: **Medium-Low**
- Official Node.js SDK simplifies API client (~0.5 day)
- Plaid Link widget for frontend bank connection (~1 day)
- Update `psdataConverter.js` field mappings (~0.5 day)
- Handle amount sign convention (Plaid positive = debit) (~0.5 day)
- Webhook handler for transaction updates (~1 day)
- Map Plaid categories to your COA (~0.5 day)
- **Total estimate: 3-5 days**
- **Does not solve Polish/EU bank connectivity**

---

## Comparative Summary

| Dimension | GoCardless | Salt Edge | TrueLayer | Plaid |
|-----------|-----------|-----------|-----------|-------|
| **Free production tier** | Yes (50 connections) | No | No | Yes (100 connections) |
| **US bank coverage** | No | Yes (screen-scraping) | Limited | Excellent (12k+) |
| **Polish bank coverage** | Yes (strong) | Yes (strong) | Weak | Unlikely |
| **Auto-categorization** | No | Yes | No (bank's own) | Yes (detailed) |
| **Base currency conversion** | No | Partial | No | No |
| **Node.js SDK** | Community/rebranded | No (REST only) | Yes (official) | Yes (official) |
| **Documentation quality** | Good | Good | Excellent | Excellent |
| **Re-auth frequency** | 90 days (PSD2) | 90 days / varies | 90 days | Varies |
| **Estimated monthly cost** | $0 (free tier) | €200-500+ | Contact sales | $0 (dev tier) |
| **Transaction field richness** | Varies by bank | Rich + categories | Moderate | Rich + categories |
| **Webhook support** | No | Yes | Yes | Yes |
| **Data freshness** | Polling | Polling + webhooks | Polling + webhooks | 1-2x/day + webhooks |
| **Connection stability** | High (PSD2 APIs) | Varies (scraping for US) | High (OAuth only) | Varies (credential-based) |

---

## Recommended Approach: Dual-Provider Strategy

Given that this project manages **both US and Polish/EU bank accounts**, no single provider covers everything adequately. The recommended approach is:

### **GoCardless (EU/Poland) + Plaid (US) — both on free tiers**

| Provider | Role | Cost | Connections |
|----------|------|------|-------------|
| GoCardless | Polish banks (PKO, mBank, etc.) + any EU banks | Free (up to 50) | EU/UK accounts |
| Plaid | US bank accounts | Free (up to 100) | US accounts |

### Why This Combination Works

1. **$0/month** — both have free tiers sufficient for personal use
2. **Best coverage** — GoCardless is strongest for Polish PSD2 banks; Plaid is strongest for US banks
3. **Both have Node.js support** — GoCardless via REST/nordigen-node, Plaid via official plaid-node SDK
4. **Eliminates PocketSmith subscription**

### Architecture Change

```
Current:
  PocketSmith API → psdataConverter → psdata_staging → transactions

Proposed:
  GoCardless API ──→ gcConverter ──→ psdata_staging → transactions
  Plaid API ────────→ plaidConverter ─↗
```

The staging table and everything downstream (sync, review UI, accept/split/neutralize) remains unchanged. Only the retrieval layer changes.

### What You'd Need to Build

| Component | Effort | Description |
|-----------|--------|-------------|
| GoCardless API client | 1 day | Replace `pocketsmith.js` for EU banks |
| Plaid API client | 0.5 day | New client using `plaid-node` SDK |
| Field converters | 1 day | Map both providers' fields to psdata_staging format |
| Bank connection UI | 2 days | Frontend for GoCardless redirect + Plaid Link widget |
| Provider selection logic | 0.5 day | Route to correct provider based on institution |
| Consent management | 1-2 days | Track 90-day re-auth (GoCardless), handle Plaid re-auth webhooks |
| Base amount calculation | 0.5 day | GoCardless/Plaid don't provide base currency — use your existing FX rate service |
| Category mapping | 0.5 day | Map Plaid categories to your COA; build simple rules for GoCardless |
| Webhook handlers (Plaid) | 1 day | Handle new transactions, connection errors |
| Testing & edge cases | 1-2 days | Multi-currency, missing fields, error handling |
| **Total** | **8-12 days** | |

### Alternative: Salt Edge Only (Single Provider)

If you prefer a single provider that covers both US and EU:

| Aspect | Detail |
|--------|--------|
| Coverage | US + EU + Poland in one API |
| Cost | ~€200-500+/month (estimated) |
| Effort | 4-6 days (single integration) |
| Trade-off | Simpler architecture but ongoing monthly cost |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GoCardless free tier removed/limited | Medium | High | Already have CSV upload fallback; could switch to Salt Edge |
| Plaid Development tier restricted | Low-Medium | High | Only ~5-10 US connections needed; well within limits |
| 90-day re-auth friction | Certain (PSD2) | Medium | Build reminder/notification system in UI |
| Bank data field quality varies | Certain | Medium | Robust field mapping with defaults; manual review UI already exists |
| Screen-scraping connections break (Salt Edge US / Plaid) | Medium | Medium | Webhooks alert to broken connections; CSV fallback |
| Provider API changes | Low | Medium | Isolated client code makes updates manageable |

---

## Decision Matrix

| If your priority is... | Choose... | Why |
|------------------------|-----------|-----|
| **Zero cost** | GoCardless + Plaid (free tiers) | Both cover your regions at $0/month |
| **Simplest integration** | Salt Edge alone | One provider, one API, one auth flow |
| **Best US coverage** | Plaid | 12,000+ US institutions, best docs |
| **Best Polish coverage** | GoCardless or Salt Edge | Both strong for PKO and Polish PSD2 banks |
| **Least maintenance** | Salt Edge (or keep PocketSmith) | Single provider handles everything |
| **Best developer experience** | Plaid + GoCardless | Official SDKs, excellent docs |

---

## Account Balances: How PocketSmith Provides Them & How to Replace

### Current Approach

PocketSmith provides a `closing_balance` field on every transaction — the account balance **after** that transaction posted. The balance sheet report (`GET /api/v2/reports/balance`) relies on this as the **sole source of account balances**:

```sql
-- reports.js: fetchAccountBalances(asOfDate)
SELECT DISTINCT ON (account_id) account_id, closing_balance, currency, transaction_date
FROM transactions
WHERE closing_balance IS NOT NULL AND transaction_date <= $1
ORDER BY account_id, transaction_date DESC, id DESC
```

This means: for each account, take the **most recent transaction with a closing balance** as of the report date. Convert to USD using exchange rates. No running totals are computed — PocketSmith's closing balance is trusted as-is.

### The Problem with Replacement Providers

| Provider | Closing Balance per Transaction? | Account Balance API? |
|----------|--------------------------------|---------------------|
| PocketSmith | Yes (on every transaction) | Yes (via transaction_accounts) |
| GoCardless | **No** (not per transaction) | Yes (`/accounts/{id}/balances/`) |
| Plaid | **No** (not per transaction) | Yes (`/accounts/balance/get`) |

Neither GoCardless nor Plaid provide a closing balance on each transaction. They provide **current account balances** as a separate API call, but not the historical balance after each transaction.

### Replacement Strategy: Two Options

#### Option A: Periodic Balance Snapshots (Recommended)

Create a new table to store account balance snapshots fetched from GoCardless/Plaid:

```sql
CREATE TABLE account_balance_snapshots (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  balance DECIMAL(15,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  balance_date DATE NOT NULL,
  source VARCHAR(20) NOT NULL,        -- 'gocardless', 'plaid'
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, balance_date)
);
```

- Fetch balances from GoCardless/Plaid during each sync (both provide current balance endpoints)
- Store one snapshot per account per day
- Balance sheet report queries this table instead of `transactions.closing_balance`
- **Effort: 1-2 days** (new table, fetch logic, update report query)
- **Pro:** Clean separation, accurate balances from bank, works with any provider
- **Con:** Only captures balances on days you sync; no retroactive historical balances

#### Option B: Calculated Running Balances

Compute balances by summing transactions from a known starting point:

- On initial migration, record current balance from GoCardless/Plaid as the "anchor" balance
- For any historical date: `anchor_balance - SUM(transactions after that date)`
- **Effort: 2-3 days** (more complex queries, edge cases with multi-currency)
- **Pro:** Can compute balance for any historical date
- **Con:** Accumulated rounding errors; requires accurate and complete transaction history; breaks if transactions are missing

**Recommendation:** Option A (periodic snapshots) is simpler, more reliable, and aligns with how GoCardless and Plaid actually work. Your existing balance sheet report would need a minor query change to read from `account_balance_snapshots` instead of `transactions.closing_balance`.

### Impact on Existing Data

Your existing 25.5k transactions already have `closing_balance` values from PocketSmith. These remain valid for historical reports. Going forward, new transactions from GoCardless/Plaid would have `closing_balance = NULL`, and the balance sheet would use the snapshot table for current balances.

---

## Comprehensive Migration Checklist: What Changes If You Replace PocketSmith

### Layer 1: Backend Services to Replace

| Current File | What It Does | What Changes | Effort |
|-------------|-------------|-------------|--------|
| `server/src/services/retrieval/pocketsmith.js` | PS API client (auth, fetch transactions, fetch categories) | Replace with GoCardless + Plaid API clients | 1.5 days |
| `server/src/services/retrieval/psdataConverter.js` | Maps PS API fields → psdata_staging format | Write two new converters (one per provider) | 1 day |
| `server/src/v2/services/refreshPsApiV2.js` | 5-step sync pipeline (fetch, classify, import, update) | Adapt for dual-provider flow; pagination logic changes | 1-2 days |
| `server/src/v2/services/psCsvIngestorV2.js` | Imports PS-format CSV | Keep as fallback; optionally add GoCardless/Plaid CSV formats | 0.5 day |

### Layer 2: Database Changes

| Change | Description | Effort |
|--------|-------------|--------|
| New `account_balance_snapshots` table | Store periodic balances from GoCardless/Plaid | 0.5 day |
| New `bank_connections` table | Track GoCardless requisitions + Plaid access tokens, consent expiry dates | 0.5 day |
| `transactions.source` values | Add `'gocardless'`, `'plaid'` as valid sources (currently `'pocketsmith'`, `'manual'`, `'split'`, `'auto-offset'`) | Trivial |
| `transactions.ps_id` column | Rename or generalize to `external_id`; GoCardless uses `internalTransactionId`, Plaid uses `transaction_id` | 0.5 day |
| `accounts.ps_account_name` column | Generalize — GoCardless uses IBAN, Plaid uses `account_id`. May need `external_account_id` + `provider` columns | 0.5 day |
| `categories.ps_category_id` column | No longer needed (GoCardless has no categories; Plaid has its own) | Trivial |
| Migration script | New migration file for all schema changes | 0.5 day |

### Layer 3: Missing Data Fields to Handle

| Field | PocketSmith Provides | GoCardless | Plaid | Solution |
|-------|---------------------|-----------|-------|----------|
| `base_amount` (USD equivalent) | Yes (`amount_in_base_currency`) | No | No | Calculate using your existing Frankfurter FX rate service (`GET /api/v2/util/exchange-rate`) |
| `closing_balance` | Yes (per transaction) | No (separate balance API) | No (separate balance API) | Use balance snapshot table (Option A above) |
| `category_name` | Yes (PS categories) | No | Yes (`personal_finance_category`) | For Plaid: map their categories to your COA. For GoCardless: leave blank, user assigns manually in review UI |
| `parent_categories` | Yes (resolved via API) | No | Yes (category hierarchy) | For Plaid: available. For GoCardless: N/A |
| `original_payee` (`description2`) | Yes (`original_payee`) | No | Yes (`name` vs `merchant_name`) | Map Plaid's `name` → `description2`. GoCardless: use `remittanceInformationUnstructured` |
| `labels` | Yes (PS labels) | No | No | Not available from either provider; field remains empty unless user adds manually |
| `note` | Yes (PS user notes) | No | No | Same — user-managed only |
| `bank` (institution name) | Yes (`institution.title`) | Yes (from institution metadata) | Yes (from institution metadata) | Both provide institution info |
| `transaction_type` | Yes (credit/debit) | Yes (`bankTransactionCode`) | Yes (inferred from amount sign) | Map accordingly; Plaid uses positive=debit convention (inverted from PS) |

### Layer 4: Frontend Changes

| Page/Component | What Changes | Effort |
|---------------|-------------|--------|
| `/refresh-ps` (RefreshPS.jsx) | Rename to generic "Sync Transactions". Add provider selector or auto-detect. Bank connection management UI | 2 days |
| Bank connection flow | **New**: GoCardless redirect page + Plaid Link widget integration. User connects banks, manages consent | 2 days |
| Consent expiry alerts | **New**: Show warnings when GoCardless connections approach 90-day expiry | 0.5 day |
| `/upload-ps` (UploadPS.jsx) | Keep as fallback CSV upload. Optionally support GoCardless/Plaid CSV export formats | 0.5 day |
| Transaction edit modal | Currently Amount/Currency/Account are "PS-sourced and not editable". Decide if this restriction still applies | 0.5 day |
| `/coa-management` (COAManagement.jsx) | "PS analysis" feature → generalize to "Provider analysis". Update account/category mapping UI | 0.5 day |
| Routes/navigation | Rename PS-specific routes and labels | 0.5 day |

### Layer 5: Configuration & Environment

| Item | Current | After Migration |
|------|---------|-----------------|
| `PS_API_KEY` env var | PocketSmith API key | Remove; add `GC_SECRET_ID`, `GC_SECRET_KEY`, `PLAID_CLIENT_ID`, `PLAID_SECRET` |
| `PS_USER_ID` env var | Hardcoded `330430` | Remove; connections managed via `bank_connections` table |
| `docker-compose.yml` | Contains PS env vars | Update with new provider env vars |
| `.env` file | Contains PS secrets | Update with GoCardless + Plaid secrets |
| `components/data/account_names.json` | PS account name list | Replace with provider-specific account mapping or remove (use DB-only mapping) |
| `components/data/category_names.json` | PS category name list | Replace with Plaid category mapping or remove |

### Layer 6: Hardcoded Assumptions to Address

| Assumption | Where | Impact | Action |
|-----------|-------|--------|--------|
| Base currency = USD | `psdataConverter.js`, `psdata.js`, `reports.js` | All amounts converted to/from USD | Keep (this is your actual base currency). Calculate `base_amount` yourself using FX rates |
| PS User ID = 330430 | `refreshPsApiV2.js`, docker-compose | Single-user assumption | Remove; use bank_connections table for multi-connection tracking |
| `ps_id` as unique transaction key | `transactions` table, sync queries | Deduplication relies on PS IDs | GoCardless: use `internalTransactionId`. Plaid: use `transaction_id`. Both are stable unique IDs |
| CSV column names match PS export | `psCsvIngestorV2.js` | CSV import breaks with different formats | Keep PS CSV support as legacy; optionally add new CSV formats |
| Amount sign convention | Throughout | PS: positive = credit, negative = debit | Plaid: **inverted** (positive = debit). Must negate amounts from Plaid |
| Closing balance = source of truth for balances | `reports.js` balance sheet | Balance sheet accuracy | Switch to balance snapshot table for new data; keep closing_balance for historical PS data |

### Summary: Total Migration Effort

| Category | Effort |
|----------|--------|
| Backend API clients + converters | 3-4 days |
| Database schema changes | 2 days |
| Balance snapshot system | 1-2 days |
| Frontend bank connection UI | 2-3 days |
| Frontend page updates (rename, generalize) | 1-2 days |
| Configuration & environment | 0.5 day |
| Testing & edge cases | 2-3 days |
| **Total** | **12-17 days** |

This is higher than the initial 8-12 day estimate because it accounts for the balance replacement, frontend generalization, and schema migration work that the initial estimate did not fully capture.

---

## Implementation Plan: GoCardless + Plaid (Dual-Provider)

### Decision: GoCardless + Plaid on Free Tiers

Based on the analysis above, we are proceeding with:
- **GoCardless Bank Account Data** — EU/Polish banks (PKO, mBank, etc.) — free tier (up to 50 connections)
- **Plaid** — US banks (Chase, Fidelity, etc.) — free Development tier (up to 100 connections)
- **Keep PocketSmith running** on the current production VM until migration is validated

---

### Development Strategy: New Branch + New VM

#### Why a Separate VM

This is a significant architectural change affecting the data pipeline, database schema, and frontend. To avoid disrupting the working production system:

1. **Current production VM** (`192.168.1.87`) stays untouched on `main` branch with PocketSmith
2. **New development VM** gets provisioned for the migration work
3. Once validated, merge the branch and deploy to production VM
4. Only then decommission PocketSmith

#### New VM Setup

Provision a new KVM guest using the existing scripts with modified parameters:

```bash
# On KVM host (192.168.1.61):
# 1. Copy and modify provision-vm.sh with new VM name and IP:
#    VM_NAME="fin-migrate"
#    STATIC_IP="192.168.1.83"    # New IP, different from prod (87) and old deploy (82)
#    VCPUS=2
#    RAM_MB=4096
#    DISK_GB=40

# 2. Provision the VM:
ssh cfbieder@192.168.1.61 'bash -s' < Scripts/provision-vm.sh

# 3. Deploy the app (after cloud-init completes ~3-5 min):
ssh cfbieder@192.168.1.83 'bash -s' < Scripts/deploy-on-vm.sh
```

#### Git Branch Strategy

```bash
# On development machine or the new VM:
git checkout -b feature/replace-pocketsmith

# Work proceeds on this branch
# Production VM (192.168.1.87) stays on main branch

# Periodically rebase onto main to stay current:
git fetch origin
git rebase origin/main
```

#### Database Strategy for the New VM

```bash
# After deploy-on-vm.sh completes on the new VM (192.168.1.83):
# Copy production data so we have real transactions to test against:

# 1. Dump from production VM:
ssh cfbieder@192.168.1.87 "docker exec fin-postgres pg_dump -U fin -d fin -Fc" > fin_migrate_seed.dump

# 2. Restore to new VM:
cat fin_migrate_seed.dump | ssh cfbieder@192.168.1.83 "docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists"

# 3. Run new migration on the new VM to add tables/columns needed for GoCardless+Plaid
```

#### Access URLs (New VM)

| Service | URL |
|---------|-----|
| Frontend HTTPS | `https://192.168.1.83:5175` |
| Frontend HTTP | `http://192.168.1.83:3006` |
| API | `http://192.168.1.83:3005` |
| Database | `192.168.1.83:5433` |

---

### Phase 1: Foundation (Days 1-3)

#### 1.1 Database Migration — New Schema

Create `server/db/migrations/004_bank_aggregation.sql`:

```sql
-- Bank connections table (tracks GoCardless requisitions + Plaid access tokens)
CREATE TABLE bank_connections (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(20) NOT NULL,            -- 'gocardless', 'plaid'
  institution_name VARCHAR(200),            -- "PKO Bank Polski", "Chase"
  institution_id VARCHAR(100),              -- Provider's institution ID
  external_connection_id VARCHAR(200),      -- GoCardless requisition_id or Plaid item_id
  access_token TEXT,                        -- Plaid access_token (encrypted at rest)
  status VARCHAR(20) DEFAULT 'active',      -- active, expired, error
  consent_expires_at TIMESTAMPTZ,           -- 90-day PSD2 expiry for GoCardless
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Account balance snapshots (replaces closing_balance dependency)
CREATE TABLE account_balance_snapshots (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  balance DECIMAL(15,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  balance_date DATE NOT NULL,
  source VARCHAR(20) NOT NULL,              -- 'gocardless', 'plaid', 'pocketsmith'
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, balance_date)
);
CREATE INDEX idx_balance_snapshots_account_date
  ON account_balance_snapshots(account_id, balance_date DESC);

-- Generalize ps_id → external_id (keep ps_id as alias for backward compat)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);
UPDATE transactions SET external_id = ps_id::TEXT WHERE ps_id IS NOT NULL AND external_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external_id
  ON transactions(external_id) WHERE external_id IS NOT NULL;

-- Add provider column to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider VARCHAR(20);
UPDATE transactions SET provider = 'pocketsmith' WHERE source = 'pocketsmith' AND provider IS NULL;

-- Generalize account external mapping
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS external_account_id VARCHAR(200);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS external_provider VARCHAR(20);

-- Link bank_connections to accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bank_connection_id INTEGER REFERENCES bank_connections(id);
```

**Effort:** 0.5 day

#### 1.2 Sign Up for Provider Sandboxes

- **GoCardless:** Register at `bankaccountdata.gocardless.com`, get `SECRET_ID` and `SECRET_KEY`
- **Plaid:** Register at `dashboard.plaid.com`, get `CLIENT_ID` and `SECRET`
- Verify Polish bank coverage in GoCardless institution list
- Test sandbox connections with both providers

**Effort:** 0.5 day (parallel with 1.1)

#### 1.3 Environment Configuration

Update `docker-compose.yml` and `.env`:

```yaml
# New env vars (add alongside existing PS vars during transition)
GC_SECRET_ID: ${GC_SECRET_ID:-}
GC_SECRET_KEY: ${GC_SECRET_KEY:-}
PLAID_CLIENT_ID: ${PLAID_CLIENT_ID:-}
PLAID_SECRET: ${PLAID_SECRET:-}
PLAID_ENV: ${PLAID_ENV:-sandbox}    # sandbox → development → production
```

**Effort:** 0.25 day

---

### Phase 2: Backend Services (Days 3-6)

#### 2.1 GoCardless API Client

Create `server/src/services/retrieval/gocardless.js`:
- Authentication (obtain access token with `SECRET_ID` / `SECRET_KEY`, handle token refresh)
- `createEndUserAgreement(institutionId, scopes)` — Create consent
- `createRequisition(agreementId, redirectUri)` — Generate bank auth redirect
- `listAccounts(requisitionId)` — Get linked accounts after auth
- `getTransactions(accountId, dateFrom, dateTo)` — Fetch transactions
- `getBalances(accountId)` — Fetch current balance
- `listInstitutions(country)` — List available banks by country

**Effort:** 1 day

#### 2.2 Plaid API Client

Create `server/src/services/retrieval/plaid.js`:
- Uses official `plaid-node` SDK (`npm install plaid`)
- `createLinkToken()` — Generate Plaid Link token for frontend
- `exchangePublicToken(publicToken)` — Exchange for access token after user connects
- `getTransactions(accessToken, startDate, endDate)` — Fetch transactions
- `getBalances(accessToken)` — Fetch account balances
- `getAccounts(accessToken)` — List connected accounts

**Effort:** 0.5 day (SDK handles most complexity)

#### 2.3 Data Converters

Create `server/src/services/retrieval/gcConverter.js`:

| GoCardless Field | → psdata_staging Field | Notes |
|------------------|------------------------|-------|
| `internalTransactionId` | `ps_id` / `external_id` | Stable ID |
| `bookingDate` | `transaction_date` | |
| `transactionAmount.amount` | `amount` | Parse string to number |
| `transactionAmount.currency` | `currency` | |
| `creditorName` or `debtorName` | `description1` | Pick based on amount sign |
| `remittanceInformationUnstructured` | `description2` | Free-text memo |
| (calculate) | `base_amount` | Use Frankfurter FX rate |
| `'USD'` | `base_currency` | Keep existing convention |
| (from connection metadata) | `account_name` | Institution + account name |
| (not available) | `closing_balance` | NULL — use balance snapshot instead |
| (not available) | `category_name` | NULL — user assigns in review UI |
| `bankTransactionCode` | `transaction_type` | Map to credit/debit |
| (from connection metadata) | `bank` | Institution name |

Create `server/src/services/retrieval/plaidConverter.js`:

| Plaid Field | → psdata_staging Field | Notes |
|-------------|------------------------|-------|
| `transaction_id` | `ps_id` / `external_id` | Stable ID |
| `date` | `transaction_date` | |
| `-amount` | `amount` | **Negate** (Plaid positive=debit) |
| `iso_currency_code` | `currency` | |
| `merchant_name` | `description1` | Merchant name |
| `name` | `description2` | Full transaction description |
| (calculate) | `base_amount` | Use Frankfurter FX rate |
| `'USD'` | `base_currency` | |
| (from account metadata) | `account_name` | |
| (not available) | `closing_balance` | NULL — use balance snapshot |
| `personal_finance_category.primary` | `category_name` | Map Plaid → your COA |
| (inferred from amount sign) | `transaction_type` | credit/debit |
| (from institution metadata) | `bank` | Institution name |

**Effort:** 1 day

#### 2.4 Unified Sync Service

Create `server/src/v2/services/bankSyncService.js` — replaces `refreshPsApiV2.js`:

```
Step 1: Fetch connections from bank_connections table (active, not expired)
Step 2: For each connection:
  a. Fetch transactions since last sync (or last 7 days)
  b. Convert via appropriate converter (gcConverter or plaidConverter)
  c. Calculate base_amount using FX rates for non-USD transactions
  d. Upsert into psdata_staging (using external_id for dedup)
Step 3: Fetch current balances from each connection
  a. Store in account_balance_snapshots table
Step 4: Auto-sync staging → transactions (existing logic, mostly unchanged)
Step 5: Update last_synced_at on each connection
```

Keep `refreshPsApiV2.js` intact for backward compatibility during transition.

**Effort:** 1.5 days

#### 2.5 Bank Connection API Routes

Create `server/src/v2/routes/bankConnections.js`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v2/bank-connections` | GET | List all connections with status |
| `/api/v2/bank-connections` | POST | Create new connection (start GoCardless/Plaid flow) |
| `/api/v2/bank-connections/:id` | DELETE | Remove a connection |
| `/api/v2/bank-connections/:id/sync` | POST | Trigger sync for specific connection |
| `/api/v2/bank-connections/sync-all` | POST | Trigger sync for all active connections |
| `/api/v2/bank-connections/institutions` | GET | List available banks by country/provider |
| `/api/v2/bank-connections/gc/callback` | GET | GoCardless OAuth callback handler |
| `/api/v2/bank-connections/plaid/link-token` | POST | Create Plaid Link token |
| `/api/v2/bank-connections/plaid/exchange` | POST | Exchange Plaid public token |
| `/api/v2/bank-connections/expiring` | GET | List connections expiring within 14 days |

**Effort:** 1 day

#### 2.6 Update Balance Sheet Report

Modify `server/src/v2/routes/reports.js` — `fetchAccountBalances(asOfDate)`:

```sql
-- New query: prefer balance snapshot, fall back to closing_balance
SELECT DISTINCT ON (a.id)
  a.id as account_id,
  COALESCE(bs.balance, t.closing_balance) as balance,
  COALESCE(bs.currency, t.currency) as currency,
  COALESCE(bs.balance_date, t.transaction_date) as balance_date
FROM accounts a
LEFT JOIN account_balance_snapshots bs
  ON bs.account_id = a.id AND bs.balance_date <= $1
LEFT JOIN transactions t
  ON t.account_id = a.id AND t.closing_balance IS NOT NULL AND t.transaction_date <= $1
ORDER BY a.id,
  COALESCE(bs.balance_date, t.transaction_date) DESC
```

This means: use the balance snapshot if available (new data from GoCardless/Plaid), otherwise fall back to closing_balance from PocketSmith historical data. Seamless transition.

**Effort:** 0.5 day

---

### Phase 3: Frontend (Days 6-9)

#### 3.1 Bank Connections Management Page

New page: `/bank-connections` (under Settings category)
- List connected banks with status (active, expiring soon, expired)
- "Add Bank" button → opens provider selection (GoCardless for EU, Plaid for US)
- GoCardless flow: redirect to bank auth page → callback
- Plaid flow: open Plaid Link widget → exchange token
- Show last sync time per connection
- "Sync Now" button per connection and "Sync All" button
- Expiry warnings with "Reconnect" action for approaching 90-day GoCardless expirations

**Effort:** 2 days

#### 3.2 Generalize Transaction Sync Page

Rename `/refresh-ps` → `/sync-transactions` (keep old route as redirect for bookmarks):
- Replace "Refresh PocketSmith" label with "Sync Transactions"
- Add provider indicator on each transaction in review table
- Keep all existing functionality (review tabs, accept, split, neutralize)
- Add "Sync All Banks" button alongside existing "Refresh" button
- Show which provider each transaction came from

**Effort:** 1 day

#### 3.3 Update Other PS References

| Page | Change |
|------|--------|
| `/upload-ps` → `/upload-csv` | Rename. Keep CSV upload working (PS format). Optionally detect CSV format |
| `/coa-management` | Rename "PS Analysis" → "Import Analysis". Update account mapping UI to show provider |
| Home page | Update quick action labels |
| Navigation (`routes.jsx`) | Update route paths and labels |
| Transaction edit modal | Consider making Amount/Currency/Account editable for non-PS sources |

**Effort:** 1 day

---

### Phase 4: Testing & Validation (Days 9-12)

#### 4.1 Sandbox Testing

- Test GoCardless sandbox with fake EU bank connections
- Test Plaid sandbox with fake US bank connections
- Verify data flows correctly through converters → staging → transactions
- Verify balance snapshots are captured and used in balance sheet

**Effort:** 1 day

#### 4.2 Real Bank Testing (Free Tiers)

- Connect real PKO BP account via GoCardless (free tier)
- Connect real US bank account via Plaid (Development tier)
- Verify transaction data quality, field completeness
- Compare imported transactions with PocketSmith data for same period
- Verify balance accuracy against bank statements

**Effort:** 2 days

#### 4.3 Regression Testing

- Balance sheet report: compare output with PocketSmith-sourced data
- Cash flow reports: verify totals match
- Budget realization: verify actuals still work
- Forecast: verify no impact
- Transaction browser: verify filtering, editing, split, neutralize all work
- CSV upload: verify still works as fallback

**Effort:** 1 day

---

### Phase 5: Migration & Cutover (Days 12-14)

#### 5.1 Merge & Deploy

```bash
# On development machine:
git checkout main
git merge feature/replace-pocketsmith

# Deploy to production VM (192.168.1.87):
./Scripts/deploy-to-production.sh

# Run new migration on production database:
docker exec -i fin-postgres psql -U fin -d fin < server/db/migrations/004_bank_aggregation.sql
```

#### 5.2 Production Bank Connections

- Connect real banks on production via the new Bank Connections page
- Run initial sync to populate balance snapshots
- Verify balance sheet accuracy with new data source
- Run PocketSmith refresh one final time to ensure data parity

#### 5.3 Transition Period

- Keep PocketSmith API key configured for ~1 month as safety net
- Both systems can coexist (PocketSmith data has `source='pocketsmith'`, new data has `provider='gocardless'`/`'plaid'`)
- After confirming new providers work reliably, cancel PocketSmith subscription
- Optionally remove PocketSmith-specific code in a cleanup commit

#### 5.4 Decommission Migration VM

```bash
# On KVM host (192.168.1.61):
virsh --connect qemu:///system destroy fin-migrate
virsh --connect qemu:///system undefine fin-migrate --remove-all-storage
```

---

### Phase Summary

| Phase | Days | Description |
|-------|------|-------------|
| **Phase 1:** Foundation | 1-3 | Schema, sandbox accounts, env config |
| **Phase 2:** Backend | 3-6 | API clients, converters, sync service, routes, balance sheet update |
| **Phase 3:** Frontend | 6-9 | Bank connections page, sync page, PS reference cleanup |
| **Phase 4:** Testing | 9-12 | Sandbox, real banks, regression |
| **Phase 5:** Migration | 12-14 | Merge, deploy, connect banks, transition |
| **Total** | **~14 days** | |

---

### Files Created / Modified Summary

#### New Files
| File | Purpose |
|------|---------|
| `server/db/migrations/004_bank_aggregation.sql` | Schema for connections, snapshots, generalized columns |
| `server/src/services/retrieval/gocardless.js` | GoCardless API client |
| `server/src/services/retrieval/plaid.js` | Plaid API client (uses plaid-node SDK) |
| `server/src/services/retrieval/gcConverter.js` | GoCardless → psdata_staging field mapping |
| `server/src/services/retrieval/plaidConverter.js` | Plaid → psdata_staging field mapping |
| `server/src/v2/services/bankSyncService.js` | Unified sync orchestrator |
| `server/src/v2/routes/bankConnections.js` | Bank connection management API |
| `server/src/v2/repositories/bankConnections.js` | Bank connections data access |
| `server/src/v2/repositories/balanceSnapshots.js` | Balance snapshots data access |
| `frontend/src/pages/BankConnections.jsx` | Bank connections management page |

#### Modified Files
| File | Change |
|------|--------|
| `server/src/v2/routes/reports.js` | Balance query: snapshot fallback to closing_balance |
| `server/src/v2/routes/ingestPs.js` | Add sync-all endpoint, integrate bankSyncService |
| `server/src/app.js` | Mount new bankConnections routes |
| `server/package.json` | Add `plaid` dependency |
| `docker-compose.yml` | Add GC/Plaid env vars (keep PS vars during transition) |
| `docker-compose.dev.yml` | Same env var updates |
| `frontend/src/config/routes.jsx` | Add bank-connections route, rename PS routes |
| `frontend/src/pages/RefreshPS.jsx` | Rename/generalize to SyncTransactions |
| `frontend/src/pages/UploadPS.jsx` | Rename/generalize to UploadCSV |
| `frontend/src/pages/COAManagement.jsx` | Rename PS Analysis → Import Analysis |

#### Kept Unchanged (Backward Compat)
| File | Why |
|------|-----|
| `server/src/services/retrieval/pocketsmith.js` | Keep during transition; remove after cutover |
| `server/src/services/retrieval/psdataConverter.js` | Keep during transition |
| `server/src/v2/services/refreshPsApiV2.js` | Keep during transition |
| `server/src/v2/services/psCsvIngestorV2.js` | Keep permanently as CSV fallback |

---

### npm Dependencies to Add

| Package | Purpose |
|---------|---------|
| `plaid` | Official Plaid Node.js SDK |

GoCardless uses a plain REST API — no additional npm package needed (use built-in `fetch` or existing HTTP client).

---

### Rollback Plan

If the migration fails or providers prove unreliable:

1. **Git:** `git revert` the merge commit on main — restores PocketSmith-only code
2. **Database:** The migration is additive (new tables, new columns). PocketSmith data and `closing_balance` values are never deleted. Reverting code still works with the old schema.
3. **PocketSmith:** Keep the subscription active for at least 1 month after cutover. API key remains in `.env`.
4. **Data:** All historical PocketSmith transactions remain in the database with `source='pocketsmith'`. Nothing is lost.

---

*This analysis should be re-evaluated if pricing, coverage, or regulatory landscape changes significantly.*
