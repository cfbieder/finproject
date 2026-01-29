# FIN Application Migration Plan: MongoDB to PostgreSQL

## Document Purpose
This document outlines a comprehensive plan to migrate the FIN financial management application from MongoDB to PostgreSQL while maintaining the three core functions: (1) actuals tracking from PocketSmith, (2) annual budget management, and (3) long-term forecast modeling.

---

## 1. Current State Analysis

### 1.1 Existing Architecture
```
Frontend (React 19 + Vite)  →  Backend (Express 5)  →  MongoDB (Mongoose 9)
         ↓                            ↓
    Port 3000                    Port 3005              Port 27018
```

### 1.2 Current MongoDB Collections

| Collection | Purpose | Document Count (Est.) | Complexity |
|------------|---------|----------------------|------------|
| `psdata` | Actual transactions from PocketSmith | High (10k+) | Simple flat documents |
| `budgetData` | Budget entries | Medium (1k+) | Simple flat documents |
| `FCModule` | Forecast balance sheet modules | Low (<100) | Complex nested arrays |
| `FCIncExp` | Forecast income/expense items | Low (<100) | Moderate nested arrays |
| `fcEntries` | Generated forecast summaries | Medium (1k+) | Simple flat documents |

### 1.3 Current File-Based Configuration
- `coa.json` - Chart of Accounts (hierarchical)
- `coa_traits.json` - Account attributes
- `FCAssump.json` - Forecast assumptions
- `account_names.json` / `category_names.json` - Auto-generated lists

### 1.4 Key Pain Points (Inferred)
1. **Nested array updates** in FCModule (Invest[], Dispose[], IncomePct[]) are awkward in MongoDB
2. **No referential integrity** between collections
3. **Aggregation pipelines** for reporting are complex and hard to maintain
4. **File-based config** mixed with database storage is inconsistent
5. **No transactions** for multi-document operations (MongoDB supports them but they're not used)

---

## 2. Proposed PostgreSQL Schema

### 2.1 Core Transaction Tables

```sql
-- Actual transactions from PocketSmith
CREATE TABLE transactions (
    id BIGSERIAL PRIMARY KEY,
    ps_id BIGINT UNIQUE,                    -- PocketSmith transaction ID
    transaction_date DATE NOT NULL,
    description1 VARCHAR(500),
    description2 VARCHAR(500),
    amount DECIMAL(15,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    base_amount DECIMAL(15,2),
    base_currency CHAR(3) DEFAULT 'USD',
    transaction_type VARCHAR(50),
    account_id INTEGER REFERENCES accounts(id),
    closing_balance DECIMAL(15,2),
    category_id INTEGER REFERENCES categories(id),
    labels TEXT[],                          -- PostgreSQL array type
    memo TEXT,
    note TEXT,
    bank VARCHAR(100),
    source VARCHAR(20) DEFAULT 'pocketsmith', -- 'pocketsmith', 'manual', 'import'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_date ON transactions(transaction_date);
CREATE INDEX idx_transactions_account ON transactions(account_id);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_ps_id ON transactions(ps_id);

-- Pending transactions: staging table for PocketSmith entries awaiting review
-- See Section 4 for detailed workflow description
CREATE TABLE pending_transactions (
    id BIGSERIAL PRIMARY KEY,
    ps_id BIGINT UNIQUE NOT NULL,           -- PocketSmith transaction ID
    transaction_date DATE NOT NULL,
    description1 VARCHAR(500),
    description2 VARCHAR(500),
    amount DECIMAL(15,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    base_amount DECIMAL(15,2),
    base_currency CHAR(3) DEFAULT 'USD',
    transaction_type VARCHAR(50),
    account_id INTEGER REFERENCES accounts(id),
    closing_balance DECIMAL(15,2),
    ps_category_id INTEGER,                  -- Original PocketSmith category
    ps_category_name VARCHAR(200),           -- Original category name for display
    posted_category_id INTEGER REFERENCES categories(id),  -- User-selected category
    labels TEXT[],
    memo TEXT,
    note TEXT,
    bank VARCHAR(100),
    change_type VARCHAR(20) NOT NULL,        -- 'new', 'updated'
    changed_fields TEXT[],                   -- For 'updated': list of changed field names
    previous_amount DECIMAL(15,2),           -- Previous value if amount changed
    previous_category_id INTEGER,            -- Previous category if changed
    ps_updated_at TIMESTAMPTZ,               -- PocketSmith's updated_at timestamp
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_change_type CHECK (change_type IN ('new', 'updated'))
);

CREATE INDEX idx_pending_date ON pending_transactions(transaction_date);
CREATE INDEX idx_pending_ps_id ON pending_transactions(ps_id);
CREATE INDEX idx_pending_change_type ON pending_transactions(change_type);

-- Budget entries (similar structure, separate table for clarity)
CREATE TABLE budget_entries (
    id BIGSERIAL PRIMARY KEY,
    entry_date DATE NOT NULL,
    description VARCHAR(500),
    amount DECIMAL(15,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    base_amount DECIMAL(15,2),
    base_currency CHAR(3) DEFAULT 'USD',
    account_id INTEGER REFERENCES accounts(id),
    category_id INTEGER REFERENCES categories(id),
    labels TEXT[],
    note TEXT,
    budget_year INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_budget_date ON budget_entries(entry_date);
CREATE INDEX idx_budget_year ON budget_entries(budget_year);
CREATE INDEX idx_budget_category ON budget_entries(category_id);
```

### 2.2 Chart of Accounts (Normalized)

```sql
-- Account types
CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');
CREATE TYPE account_section AS ENUM ('balance_sheet', 'profit_loss');

-- Accounts (unified from coa.json and coa_traits.json)
CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES accounts(id),
    account_type account_type NOT NULL,
    section account_section NOT NULL,
    currency CHAR(3) DEFAULT 'USD',
    account_number VARCHAR(50),
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    ps_account_name VARCHAR(200),           -- Mapping to PocketSmith account name
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_accounts_parent ON accounts(parent_id);
CREATE INDEX idx_accounts_type ON accounts(account_type);

-- Categories (from PocketSmith, maps to accounts)
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES categories(id),
    ps_category_id BIGINT,                  -- PocketSmith category ID
    mapped_account_id INTEGER REFERENCES accounts(id),
    is_transfer BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_account ON categories(mapped_account_id);
```

### 2.3 Forecast Module Tables (Normalized)

```sql
-- Forecast scenarios
CREATE TABLE forecast_scenarios (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Forecast modules (balance sheet items)
CREATE TABLE forecast_modules (
    id SERIAL PRIMARY KEY,
    scenario_id INTEGER NOT NULL REFERENCES forecast_scenarios(id) ON DELETE CASCADE,
    account_id INTEGER REFERENCES accounts(id),
    name VARCHAR(200) NOT NULL,
    module_type VARCHAR(50),                -- Asset, Liability, etc.
    currency CHAR(3) DEFAULT 'USD',
    expense_category VARCHAR(100),
    expense_amount DECIMAL(15,2) DEFAULT 0,
    expense_pct DECIMAL(8,4) DEFAULT 0,
    income_category VARCHAR(100),
    income_amount DECIMAL(15,2) DEFAULT 0,
    base_date DATE,
    base_value DECIMAL(15,2) DEFAULT 0,
    market_value DECIMAL(15,2) DEFAULT 0,
    base_value_usd DECIMAL(15,2) DEFAULT 0,
    market_value_usd DECIMAL(15,2) DEFAULT 0,
    growth_rate DECIMAL(8,4) DEFAULT 0,
    comment TEXT,
    is_matched BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(scenario_id, name)
);

CREATE INDEX idx_fc_modules_scenario ON forecast_modules(scenario_id);
CREATE INDEX idx_fc_modules_account ON forecast_modules(account_id);

-- Forecast module income percentages (normalized from nested array)
CREATE TABLE forecast_module_income_pct (
    id SERIAL PRIMARY KEY,
    module_id INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
    effective_date DATE NOT NULL,
    value DECIMAL(8,4) NOT NULL,

    UNIQUE(module_id, effective_date)
);

-- Forecast module investments (normalized from nested array)
CREATE TABLE forecast_module_investments (
    id SERIAL PRIMARY KEY,
    module_id INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
    investment_date DATE NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    flag VARCHAR(50),
    note TEXT
);

CREATE INDEX idx_fc_investments_module ON forecast_module_investments(module_id);

-- Forecast module disposals (normalized from nested array)
CREATE TABLE forecast_module_disposals (
    id SERIAL PRIMARY KEY,
    module_id INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
    disposal_date DATE NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    flag VARCHAR(50),
    note TEXT
);

CREATE INDEX idx_fc_disposals_module ON forecast_module_disposals(module_id);

-- Forecast income/expense items
CREATE TABLE forecast_income_expense (
    id SERIAL PRIMARY KEY,
    scenario_id INTEGER NOT NULL REFERENCES forecast_scenarios(id) ON DELETE CASCADE,
    account_id INTEGER REFERENCES accounts(id),
    name VARCHAR(200) NOT NULL,
    item_type VARCHAR(50),                  -- Income, Expense
    currency CHAR(3) DEFAULT 'USD',
    base_date DATE,
    base_value DECIMAL(15,2) DEFAULT 0,
    base_value_usd DECIMAL(15,2) DEFAULT 0,
    growth_rate DECIMAL(8,4) DEFAULT 0,
    comment TEXT,
    is_matched BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(scenario_id, name)
);

CREATE INDEX idx_fc_incexp_scenario ON forecast_income_expense(scenario_id);

-- Forecast income/expense changes (normalized from nested array)
CREATE TABLE forecast_incexp_changes (
    id SERIAL PRIMARY KEY,
    incexp_id INTEGER NOT NULL REFERENCES forecast_income_expense(id) ON DELETE CASCADE,
    change_date DATE NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    flag VARCHAR(50),
    note TEXT
);

CREATE INDEX idx_fc_changes_incexp ON forecast_incexp_changes(incexp_id);

-- Generated forecast entries (output of forecast generation)
CREATE TABLE forecast_entries (
    id BIGSERIAL PRIMARY KEY,
    scenario_id INTEGER NOT NULL REFERENCES forecast_scenarios(id) ON DELETE CASCADE,
    forecast_year INTEGER NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    account VARCHAR(200),
    module VARCHAR(200),
    entry_type VARCHAR(50),                 -- balance, income, expense, etc.
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(scenario_id, forecast_year, account, module, entry_type)
);

CREATE INDEX idx_fc_entries_scenario_year ON forecast_entries(scenario_id, forecast_year);
```

### 2.4 Configuration Tables

```sql
-- Forecast assumptions (replaces FCAssump.json)
CREATE TABLE forecast_assumptions (
    id SERIAL PRIMARY KEY,
    scenario_id INTEGER REFERENCES forecast_scenarios(id),  -- NULL = global
    section VARCHAR(100) NOT NULL,          -- growth_rates, tax_rates, fx_rates, etc.
    key VARCHAR(100) NOT NULL,
    value JSONB NOT NULL,                   -- Flexible value storage
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(scenario_id, section, key)
);

-- Exchange rates
CREATE TABLE exchange_rates (
    id SERIAL PRIMARY KEY,
    from_currency CHAR(3) NOT NULL,
    to_currency CHAR(3) NOT NULL,
    rate DECIMAL(15,6) NOT NULL,
    rate_date DATE NOT NULL,
    source VARCHAR(50) DEFAULT 'frankfurter',
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(from_currency, to_currency, rate_date)
);

CREATE INDEX idx_fx_rates_date ON exchange_rates(rate_date);

-- Audit log for tracking changes
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id BIGINT NOT NULL,
    action VARCHAR(20) NOT NULL,            -- INSERT, UPDATE, DELETE
    old_values JSONB,
    new_values JSONB,
    user_info VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_table ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_time ON audit_log(created_at);
```

### 2.5 Views for Reporting

```sql
-- Balance sheet view (replaces complex aggregation)
CREATE VIEW v_balance_sheet AS
SELECT
    a.id AS account_id,
    a.name AS account_name,
    a.account_type,
    a.parent_id,
    pa.name AS parent_name,
    t.transaction_date,
    SUM(t.base_amount) AS balance
FROM accounts a
LEFT JOIN accounts pa ON a.parent_id = pa.id
LEFT JOIN categories c ON c.mapped_account_id = a.id
LEFT JOIN transactions t ON t.category_id = c.id
WHERE a.section = 'balance_sheet'
GROUP BY a.id, a.name, a.account_type, a.parent_id, pa.name, t.transaction_date;

-- Budget vs Actual comparison view
CREATE VIEW v_budget_vs_actual AS
SELECT
    DATE_TRUNC('month', t.transaction_date) AS month,
    c.name AS category,
    a.name AS account,
    SUM(t.base_amount) AS actual_amount,
    COALESCE(b.budget_amount, 0) AS budget_amount,
    SUM(t.base_amount) - COALESCE(b.budget_amount, 0) AS variance
FROM transactions t
JOIN categories c ON t.category_id = c.id
LEFT JOIN accounts a ON c.mapped_account_id = a.id
LEFT JOIN (
    SELECT
        DATE_TRUNC('month', entry_date) AS month,
        category_id,
        SUM(base_amount) AS budget_amount
    FROM budget_entries
    GROUP BY DATE_TRUNC('month', entry_date), category_id
) b ON DATE_TRUNC('month', t.transaction_date) = b.month
   AND t.category_id = b.category_id
GROUP BY DATE_TRUNC('month', t.transaction_date), c.name, a.name, b.budget_amount;
```

---

## 3. Efficiency Improvements

### 3.1 Database-Level Improvements

| Current (MongoDB) | Proposed (PostgreSQL) | Benefit |
|-------------------|----------------------|---------|
| Nested arrays for investments/disposals | Normalized tables with foreign keys | Easier updates, better indexing |
| No referential integrity | Foreign key constraints | Data consistency guaranteed |
| Aggregation pipelines | SQL views + materialized views | Simpler queries, better performance |
| File-based COA config | Database tables | Transactional updates, version control |
| Manual ID management | SERIAL/BIGSERIAL | Automatic, collision-free IDs |
| String-based account references | Integer foreign keys | Faster joins, less storage |

### 3.2 Query Performance Improvements

```sql
-- Current: MongoDB aggregation for balance sheet (complex pipeline)
-- Proposed: Simple SQL with materialized view

CREATE MATERIALIZED VIEW mv_account_balances AS
SELECT
    a.id AS account_id,
    a.name,
    a.account_type,
    a.section,
    SUM(t.base_amount) AS total_balance,
    MAX(t.transaction_date) AS last_transaction
FROM accounts a
JOIN categories c ON c.mapped_account_id = a.id
JOIN transactions t ON t.category_id = c.id
GROUP BY a.id, a.name, a.account_type, a.section;

-- Refresh periodically or on-demand
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_account_balances;
```

### 3.3 Application-Level Improvements

1. **Connection Pooling**: Use `pg` with connection pooling (e.g., `pg-pool` or `pgBouncer`)
2. **Prepared Statements**: Replace dynamic query building with parameterized queries
3. **Batch Operations**: Use `INSERT ... ON CONFLICT` for upserts, `COPY` for bulk imports
4. **Caching Layer**: Add Redis for frequently accessed data (FX rates, COA structure)
5. **Remove DanfoJS dependency**: PostgreSQL window functions and CTEs can replace most dataframe operations

### 3.4 Code Simplification

| Current Service | Lines | Proposed Approach | Est. Reduction |
|-----------------|-------|-------------------|----------------|
| `fcbuilder-module.js` | 835 | SQL functions + simpler JS | 50-60% |
| `fcbuilder-incexp.js` | 436 | SQL functions + simpler JS | 50-60% |
| `balanceSheetFetcher.js` | 324 | SQL views | 70-80% |
| `cashFlowFetcher.js` | 619 | SQL views | 70-80% |

---

## 4. PocketSmith API Integration Redesign

### 4.1 Current Integration
- CSV upload via `/upload-ps` endpoint
- Direct API refresh via `/refresh-ps`
- Manual sync process

### 4.2 Proposed Integration: Staged Review Workflow

The new workflow introduces a **review stage** for incoming PocketSmith data before entries become part of the main ledger:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  PocketSmith    │────▶│  Pending         │────▶│  Transactions   │
│  API            │     │  Transactions    │     │  (Main Ledger)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │                        │
   "Update Recent         User Review:              Accepted &
    Data" button         - View changes             categorized
                         - Update category          entries
                         - Accept entry
```

#### Step 1: Update Recent Data (Fetch from PocketSmith)
- User clicks "Update Recent Data" button
- System calls PocketSmith API to fetch transactions since last sync
- **Delta-only logic**: Only new transactions OR transactions where key fields have changed are inserted/updated in `pending_transactions`
- Existing unchanged entries in PocketSmith are ignored (no database write)

#### Step 2: User Review
- User sees list of pending entries (new + changed)
- For each entry, user can:
  - View the original PocketSmith category
  - Update the "posted category" (the category to use in our system)
  - Add/edit notes or labels
- Changed entries are highlighted to show what changed from the previously accepted version

#### Step 3: Accept Entry
- User accepts individual entries (or bulk accept)
- On acceptance, entry moves from `pending_transactions` to `transactions` (main ledger)
- The `pending_transactions` record is deleted (or marked as processed)

#### Step 4: Normal Ledger
- Accepted transactions appear in the normal transactions list
- They are included in reports, budget comparisons, etc.

### 4.3 Pending Transactions Table

```sql
-- Staging table for PocketSmith entries awaiting review
CREATE TABLE pending_transactions (
    id BIGSERIAL PRIMARY KEY,
    ps_id BIGINT UNIQUE NOT NULL,           -- PocketSmith transaction ID
    transaction_date DATE NOT NULL,
    description1 VARCHAR(500),
    description2 VARCHAR(500),
    amount DECIMAL(15,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    base_amount DECIMAL(15,2),
    base_currency CHAR(3) DEFAULT 'USD',
    transaction_type VARCHAR(50),
    account_id INTEGER REFERENCES accounts(id),
    closing_balance DECIMAL(15,2),
    ps_category_id INTEGER,                  -- Original PocketSmith category
    ps_category_name VARCHAR(200),           -- Original category name for display
    posted_category_id INTEGER REFERENCES categories(id),  -- User-selected category
    labels TEXT[],
    memo TEXT,
    note TEXT,
    bank VARCHAR(100),

    -- Change tracking
    change_type VARCHAR(20) NOT NULL,        -- 'new', 'updated'
    changed_fields TEXT[],                   -- For 'updated': list of changed field names
    previous_amount DECIMAL(15,2),           -- Previous value if amount changed
    previous_category_id INTEGER,            -- Previous category if changed

    -- Sync metadata
    ps_updated_at TIMESTAMPTZ,               -- PocketSmith's updated_at timestamp
    fetched_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_change_type CHECK (change_type IN ('new', 'updated'))
);

CREATE INDEX idx_pending_date ON pending_transactions(transaction_date);
CREATE INDEX idx_pending_ps_id ON pending_transactions(ps_id);
CREATE INDEX idx_pending_change_type ON pending_transactions(change_type);
```

### 4.4 Delta-Only Sync Logic

```javascript
// services/pocketsmith/sync.js
class PocketSmithSync {
    /**
     * Fetch only new/changed transactions from PocketSmith
     * and insert them into pending_transactions for review
     */
    async updateRecentData(userId) {
        // 1. Get last sync timestamp
        const lastSync = await this.getLastSyncTimestamp();

        // 2. Fetch transactions from PocketSmith (updated since lastSync)
        const psTransactions = await this.fetchTransactions(userId, {
            updated_since: lastSync
        });

        // 3. For each PS transaction, check if it's truly new or changed
        const pending = [];
        for (const psTxn of psTransactions) {
            const existing = await this.findExistingTransaction(psTxn.ps_id);

            if (!existing) {
                // New transaction - never seen before
                pending.push({
                    ...this.mapPsToLocal(psTxn),
                    change_type: 'new',
                    changed_fields: null
                });
            } else {
                // Check if any tracked fields actually changed
                const changes = this.detectChanges(existing, psTxn);
                if (changes.length > 0) {
                    pending.push({
                        ...this.mapPsToLocal(psTxn),
                        change_type: 'updated',
                        changed_fields: changes,
                        previous_amount: existing.amount,
                        previous_category_id: existing.category_id
                    });
                }
                // If no changes detected, skip entirely (no DB write)
            }
        }

        // 4. Upsert into pending_transactions (by ps_id)
        if (pending.length > 0) {
            await this.insertPendingTransactions(pending);
        }

        // 5. Update last sync timestamp
        await this.updateLastSyncTimestamp();

        return { count: pending.length };
    }

    /**
     * Compare existing transaction with PocketSmith version
     * Returns array of changed field names
     */
    detectChanges(existing, psTxn) {
        const trackedFields = ['amount', 'description1', 'description2',
                              'transaction_date', 'category_id', 'labels'];
        const changes = [];

        for (const field of trackedFields) {
            const localValue = existing[field];
            const psValue = this.mapPsField(psTxn, field);

            if (!this.valuesEqual(localValue, psValue)) {
                changes.push(field);
            }
        }

        return changes;
    }

    /**
     * Find existing transaction in main ledger by ps_id
     */
    async findExistingTransaction(psId) {
        const sql = `
            SELECT id, amount, description1, description2,
                   transaction_date, category_id, labels
            FROM transactions
            WHERE ps_id = $1
        `;
        const result = await db.query(sql, [psId]);
        return result.rows[0] || null;
    }
}
```

### 4.5 Accept Transaction Flow

```javascript
// services/pocketsmith/review.service.js
class TransactionReviewService {
    /**
     * Accept a single pending transaction into the main ledger
     */
    async acceptTransaction(pendingId, { postedCategoryId, note }) {
        return await db.transaction(async (client) => {
            // 1. Get the pending transaction
            const pending = await this.getPendingById(pendingId, client);
            if (!pending) {
                throw new AppError('Pending transaction not found', 404);
            }

            // 2. Determine final category (user override or default)
            const finalCategoryId = postedCategoryId || pending.posted_category_id || pending.ps_category_id;

            // 3. Upsert into main transactions table
            const sql = `
                INSERT INTO transactions (
                    ps_id, transaction_date, description1, description2,
                    amount, currency, base_amount, base_currency,
                    transaction_type, account_id, closing_balance,
                    category_id, labels, memo, note, bank, source
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'pocketsmith')
                ON CONFLICT (ps_id) DO UPDATE SET
                    transaction_date = EXCLUDED.transaction_date,
                    description1 = EXCLUDED.description1,
                    description2 = EXCLUDED.description2,
                    amount = EXCLUDED.amount,
                    category_id = EXCLUDED.category_id,
                    labels = EXCLUDED.labels,
                    note = EXCLUDED.note,
                    updated_at = NOW()
                RETURNING id
            `;

            const result = await client.query(sql, [
                pending.ps_id, pending.transaction_date, pending.description1,
                pending.description2, pending.amount, pending.currency,
                pending.base_amount, pending.base_currency, pending.transaction_type,
                pending.account_id, pending.closing_balance, finalCategoryId,
                pending.labels, pending.memo, note || pending.note, pending.bank
            ]);

            // 4. Remove from pending
            await client.query(
                'DELETE FROM pending_transactions WHERE id = $1',
                [pendingId]
            );

            return { transactionId: result.rows[0].id };
        });
    }

    /**
     * Bulk accept multiple pending transactions
     */
    async acceptMultiple(pendingIds) {
        const results = [];
        for (const id of pendingIds) {
            const result = await this.acceptTransaction(id, {});
            results.push(result);
        }
        return { accepted: results.length };
    }

    /**
     * Update the posted category for a pending transaction
     */
    async updatePostedCategory(pendingId, categoryId) {
        const sql = `
            UPDATE pending_transactions
            SET posted_category_id = $1
            WHERE id = $2
            RETURNING id
        `;
        const result = await db.query(sql, [categoryId, pendingId]);
        if (result.rowCount === 0) {
            throw new AppError('Pending transaction not found', 404);
        }
        return { updated: true };
    }

    /**
     * Reject/dismiss a pending transaction (don't import)
     */
    async rejectTransaction(pendingId) {
        const sql = 'DELETE FROM pending_transactions WHERE id = $1 RETURNING ps_id';
        const result = await db.query(sql, [pendingId]);
        if (result.rowCount === 0) {
            throw new AppError('Pending transaction not found', 404);
        }
        // Optionally: track rejected ps_ids to prevent re-fetching
        return { rejected: true };
    }
}
```

### 4.6 PocketSmith API Endpoints to Utilize

| Endpoint | Purpose | Sync Frequency |
|----------|---------|----------------|
| `GET /me` | User info, base currency | On connect |
| `GET /users/{id}/accounts` | All accounts | Daily |
| `GET /users/{id}/categories` | All categories | Daily |
| `GET /users/{id}/transactions` | All transactions | On "Update Recent Data" |
| `GET /users/{id}/budget` | Budget config | On demand |
| `GET /accounts/{id}/transactions` | Per-account sync | Incremental |

### 4.7 Application API Endpoints (New)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v1/pocketsmith/sync` | Trigger "Update Recent Data" - fetches from PS |
| `GET` | `/api/v1/pending-transactions` | List all pending transactions for review |
| `GET` | `/api/v1/pending-transactions/:id` | Get single pending transaction details |
| `PATCH` | `/api/v1/pending-transactions/:id/category` | Update posted category before accepting |
| `POST` | `/api/v1/pending-transactions/:id/accept` | Accept single transaction into ledger |
| `POST` | `/api/v1/pending-transactions/accept-bulk` | Accept multiple transactions |
| `DELETE` | `/api/v1/pending-transactions/:id` | Reject/dismiss pending transaction |

### 4.8 Frontend Components for Review Flow

```
features/
└── pocketsmith-sync/
    ├── components/
    │   ├── UpdateRecentDataButton.jsx   # Triggers sync, shows progress
    │   ├── PendingTransactionsList.jsx  # List of pending items for review
    │   ├── PendingTransactionRow.jsx    # Single row with change highlights
    │   ├── CategoryUpdateDropdown.jsx   # Quick category selection
    │   ├── AcceptRejectButtons.jsx      # Action buttons per row
    │   ├── BulkAcceptBar.jsx            # Select all / bulk accept actions
    │   └── ChangeIndicator.jsx          # Shows what changed (for 'updated' type)
    ├── hooks/
    │   ├── usePendingTransactions.js    # Fetch and manage pending list
    │   └── useSyncStatus.js             # Track sync progress
    └── pages/
        └── ReviewPendingPage.jsx        # Main review page
```

#### UI Mockup: Review Pending Transactions

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Review Pending Transactions                    [Update Recent Data]   │
├─────────────────────────────────────────────────────────────────────────┤
│  ☑ Select All (12 pending)                      [Accept Selected (3)]  │
├─────────────────────────────────────────────────────────────────────────┤
│  ☐ │ 2026-01-28 │ Amazon.com         │ $45.99  │ [Shopping ▼] │ ✓  ✗  │
│    │            │ Order #123-456     │ NEW     │              │        │
├─────────────────────────────────────────────────────────────────────────┤
│  ☑ │ 2026-01-27 │ Whole Foods        │ $127.43 │ [Groceries▼] │ ✓  ✗  │
│    │            │                    │ NEW     │              │        │
├─────────────────────────────────────────────────────────────────────────┤
│  ☐ │ 2026-01-25 │ Electric Company   │ $89.00  │ [Utilities▼] │ ✓  ✗  │
│    │            │ CHANGED: amount    │ was:    │              │        │
│    │            │ ($85.00 → $89.00)  │ $85.00  │              │        │
├─────────────────────────────────────────────────────────────────────────┤
│  ...                                                                    │
└─────────────────────────────────────────────────────────────────────────┘

Legend:
  NEW      = First time seeing this transaction
  CHANGED  = Previously accepted, but PocketSmith data changed
  ✓        = Accept into ledger
  ✗        = Reject/dismiss
```

---

## 5. Migration Strategy

### 5.0 Deployment Context: New Linux Host Migration

**Important**: At the end of this migration process, the entire application will be deployed to a **new Linux host**. This affects the migration approach:

```
┌─────────────────────────┐          ┌─────────────────────────┐
│   CURRENT HOST          │          │   NEW LINUX HOST        │
│   (Continues running)   │          │   (Built from scratch)  │
├─────────────────────────┤          ├─────────────────────────┤
│  Docker:                │          │  Docker:                │
│  - MongoDB              │   ───►   │  - PostgreSQL           │
│  - Express backend      │  migrate │  - Express backend      │
│  - React frontend       │   data   │  - React frontend       │
│                         │          │                         │
│  Status: KEEP RUNNING   │          │  Status: TEST FIRST     │
└─────────────────────────┘          └─────────────────────────┘
```

**Key points:**
- The current system on the existing host continues to operate normally during the entire migration
- Development and testing of the new PostgreSQL-based system happens on the new Linux host
- Data migration happens once: export from current MongoDB → import to new PostgreSQL
- Only after the new system is fully tested and validated do we switch over
- The old system remains available as a fallback until confidence is established

**Benefits of this approach:**
1. Zero downtime for day-to-day use during development
2. Clean slate on new host - no legacy artifacts
3. Easy rollback - just keep using the old system if issues arise
4. Can take time to validate without pressure

### 5.1 Phase 1: Parallel Setup
1. Set up PostgreSQL alongside MongoDB
2. Create all tables, indexes, and views
3. Build data migration scripts
4. Create new repository layer with dual-write capability

### 5.2 Phase 2: Data Migration (Week 2-3)
1. Migrate static data (COA, categories, accounts)
2. Migrate historical transactions (bulk COPY)
3. Migrate forecast modules and scenarios
4. Validate data integrity

### 5.3 Phase 3: Code Migration (Week 3-5)
1. Replace Mongoose models with PostgreSQL repository classes
2. Update services to use new repositories
3. Simplify forecast builders using SQL
4. Update PocketSmith sync service

### 5.4 Phase 4: Testing & Validation (Week 5-6)
1. Parallel run: compare outputs between systems
2. Performance testing
3. Data reconciliation
4. User acceptance testing

### 5.5 Phase 5: Cutover to New Host
1. **Final data export** from current MongoDB on old host
2. **Import to PostgreSQL** on new Linux host
3. **Validation testing** on new host:
   - Verify transaction counts match
   - Verify balance calculations match
   - Test all core workflows (sync, budget, forecast)
   - Run reports and compare outputs
4. **Switch over** - start using new host for daily operations
5. **Parallel monitoring** - keep old system available for 1-2 weeks
6. **Decommission old host** once confident in new system

---

## 6. Technology Stack Changes

### 6.1 Remove
- `mongoose` (MongoDB ODM)
- `danfojs` (can be replaced with SQL)
- `arquero` (can be replaced with SQL)

### 6.2 Add
- `pg` (PostgreSQL client)
- `pg-pool` (connection pooling)
- `node-pg-migrate` or `knex` (migrations)
- Optionally: `kysely` or `drizzle-orm` (type-safe query builder)

### 6.3 Keep
- Express 5
- React 19 + Vite
- Docker setup (replace mongo with postgres container)

---

## 7. Questions for Clarification

### 7.1 Data & History

1. **Historical Data Retention**: How far back should transaction history be retained? Should we implement archival/partitioning?
   - **Decision: Keep all data indefinitely** - No archival or partitioning. At personal finance scale (<100K rows), PostgreSQL handles this easily. Simplifies queries and avoids complexity. Can revisit if needed in future.

2. **PocketSmith Sync Frequency**: Should syncing be:
   - **Decision: Manual only** - User clicks "Update Recent Data" to initiate sync. Aligns with staged review workflow where user consciously initiates the process. No background job infrastructure needed.

3. **Multi-User Support**: Is this single-user only, or should we plan for multi-tenancy?
   - **Decision: Single-user with basic auth** - One user, but add password protection. Useful if app is exposed beyond localhost. No `user_id` columns or multi-tenancy complexity. Simple session-based or token-based auth.

### 7.2 Forecasting

4. **Scenario Isolation**: When copying scenarios, should we deep-copy all related data or use a different approach?
   - **Decision: Deep copy** - When duplicating a scenario, copy all related records (modules, income/expense items, investments, disposals). Each scenario is fully independent. Simple, clean deletion with `ON DELETE CASCADE`, and storage is minimal for forecast data.

5. **Forecast Recalculation**: Should forecasts be:
   - **Decision: On-demand (current approach)** - Calculate forecast fresh each time user views it. Always current, no cache invalidation complexity. Forecast calculations are lightweight (simple math, small data). Can add caching later if performance requires.

6. **Audit Trail**: The current CSV audit trail - should this become database-stored?
   - **Decision: Database audit log** - Store changes in `audit_log` table with JSONB for old/new values. Queryable, searchable, included in database backups. Can use PostgreSQL triggers to automate capture. Export to CSV if needed for sharing.

### 7.3 Budget

7. **Budget Periods**: Currently using calendar year. Should we support:
   - **Decision: Calendar year only** - Budgets are Jan-Dec. Simple, matches personal finance norms and tax years. `budget_year` column is just the year number. Can add fiscal year offset later if needed without schema changes.

8. **Budget Versions**: Should we support multiple budget versions per year (e.g., original, revised, final)?
   - **Decision: Named versions** - Support multiple named versions per year (e.g., "2025 Original", "2025 Q2 Revised"). Add `budget_version_id` foreign key to budget_entries, with a `budget_versions` table containing name, year, and is_active flag. Enables comparison between versions.

### 7.4 Technical

9. **ORM Preference**: Would you prefer:
   - **Decision: Raw SQL (pg client)** - Write SQL directly using `pg` client. Most control, best performance, no abstraction layer. SQL is transparent and debuggable. Use parameterized queries for safety. Can use `node-pg-migrate` for migrations.

10. **Hosting**: Will PostgreSQL be:
    - **Decision: Self-hosted (Docker)** - Run PostgreSQL in Docker container alongside app, like current MongoDB setup. Full control, no external dependencies, no recurring costs. Data stays local for privacy. Easy to backup with `pg_dump` scripts.

11. **Backup Strategy**: MongoDB backups exist - what PostgreSQL backup approach?
    - **Decision: pg_dump scripts** - Simple SQL dump scripts, can run via cron daily. Creates portable `.dump` files that restore anywhere. At personal finance scale, dumps complete in seconds. Keep last N days with simple rotation. Can add cloud sync later if desired.

### 7.5 Features & Scope

12. **Feature Parity**: Should we aim for exact feature parity first, or take the opportunity to:
    - **Decision: Hybrid - Parity + selective improvements** - Maintain parity for core features (transactions, budget, forecast) for validation. Include well-defined improvements like the staged PocketSmith review flow. Defer or soft-drop unused features discovered during migration. Avoid scope creep by being selective.

13. **COA Management**: The hierarchical COA is currently JSON. In PostgreSQL:
    - **Decision: Adjacency list** - Each row has `parent_id` pointing to parent. Simple, flexible for updates. Use PostgreSQL recursive CTEs for tree queries. COA is small (<100 accounts) so performance is not a concern. No extensions required.

14. **Reporting**: Should complex reports be:
    - **Decision: Database views (real-time)** - SQL views compute on each query. Always current data, no stale data concerns. At personal finance scale, even complex aggregations run in milliseconds. Can promote to materialized views later if specific reports become slow.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Data loss during migration | Low | Critical | Full backups, parallel run, checksums |
| Performance regression | Medium | High | Benchmark before/after, optimize queries |
| Feature regression | Medium | Medium | Comprehensive test suite, parallel validation |
| Extended downtime | Low | Medium | Blue-green deployment, quick rollback |
| Forecast calculation differences | Medium | High | Side-by-side comparison, audit trail validation |

---

## 9. Proposed File Structure

```
fin/
├── frontend/                    # (mostly unchanged)
├── server/
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js      # PostgreSQL connection
│   │   │   └── constants.js
│   │   ├── repositories/        # Data access layer
│   │   │   ├── transaction.repository.js
│   │   │   ├── budget.repository.js
│   │   │   ├── forecast.repository.js
│   │   │   ├── account.repository.js
│   │   │   └── category.repository.js
│   │   ├── services/            # Business logic
│   │   │   ├── pocketsmith/
│   │   │   │   ├── sync.service.js
│   │   │   │   └── api.client.js
│   │   │   ├── forecast/
│   │   │   │   ├── generator.service.js
│   │   │   │   └── scenario.service.js
│   │   │   ├── budget/
│   │   │   │   └── budget.service.js
│   │   │   └── reporting/
│   │   │       ├── balance-sheet.service.js
│   │   │       └── cash-flow.service.js
│   │   ├── routes/              # API endpoints
│   │   ├── middleware/
│   │   └── utils/
│   ├── migrations/              # Database migrations
│   ├── seeds/                   # Seed data
│   └── tests/
├── docker-compose.yml           # Updated for PostgreSQL
└── MIGRATION_PLAN.md
```

---

## 10. Next Steps

1. **Review & Feedback**: Review this plan and provide answers to the questions above
2. **Schema Finalization**: Finalize the PostgreSQL schema based on feedback
3. **Proof of Concept**: Build a minimal POC with one feature (e.g., transactions)
4. **Migration Scripts**: Develop and test data migration scripts
5. **Incremental Implementation**: Migrate feature by feature with validation

---

## 11. Summary

This migration offers significant benefits:
- **Better data integrity** through foreign keys and constraints
- **Simpler queries** using SQL views instead of aggregation pipelines
- **Improved performance** with proper indexing and materialized views
- **Reduced code complexity** by moving calculations to the database
- **Easier maintenance** with a well-structured relational schema

The main trade-off is the upfront migration effort, but the long-term benefits in maintainability and performance justify the investment.

---

## 12. Frontend Redesign Plan

### 12.1 Current Frontend Issues (Critical)

#### God Components (Immediate Priority)
| Component | Lines | Issues | Recommendation |
|-----------|-------|--------|----------------|
| `BudgetInput.jsx` | 757 | 50+ state variables, mixed concerns, handles loading/filtering/forms/modals | Split into 5-6 focused components |
| `FCExpSetup.jsx` | 600+ | Handles assumptions, entries, modals, account loading | Split into 3-4 components |
| `TransActual.jsx` | 393 | Near-identical to TransBudget (DRY violation) | Extract shared base component |
| `TransBudget.jsx` | 293 | Near-identical to TransActual (DRY violation) | Extract shared base component |

#### Critical DRY Violations
```
// These patterns are duplicated across multiple files:

1. Transaction Filter Logic (80+ lines duplicated)
   - TransActual.jsx: lines 152-180
   - TransBudget.jsx: lines 81-120
   - useTransactions.js: lines 38-88

2. collectCollapsiblePaths() function
   - Balance.jsx: lines 15-35
   - BalanceChart.jsx: lines 17-37
   → Should be in shared utils/treeHelpers.js

3. Date Initialization Logic
   - TransActual.jsx, TransBudget.jsx, BudgetInput.jsx
   - Each calculates default date ranges independently
   → Should be in shared hooks/useDateRange.js

4. Month Options Array
   - Defined in budgetInputUtils.js
   - Recreated in multiple components
   → Should be in shared constants/dates.js

5. FX Rate Lookup
   - BudgetInput.jsx: lines 243-253
   - Various transaction modals
   → Should be in shared utils/currency.js
```

#### Missing Shared Components
The application lacks reusable components that should exist:

| Missing Component | Used In | Current State |
|-------------------|---------|---------------|
| `<Modal>` | 5+ places | Each modal is custom-built |
| `<DataTable>` | 6+ places | Tables are custom each time |
| `<FilterPanel>` | 4+ places | Filter UI duplicated |
| `<FormField>` | 10+ places | Inputs are custom per form |
| `<LoadingSpinner>` | All pages | "Loading..." text varies |
| `<ErrorMessage>` | All pages | Error display inconsistent |
| `<ConfirmDialog>` | 5+ places | Delete confirms duplicated |
| `<DateRangePicker>` | 4+ places | Date selection varies |
| `<CurrencyInput>` | 3+ places | Amount inputs inconsistent |

### 12.2 Proposed Component Architecture

```
frontend/src/
├── components/                    # Shared, reusable components
│   ├── ui/                        # Base UI primitives
│   │   ├── Button/
│   │   │   ├── Button.jsx
│   │   │   ├── Button.css
│   │   │   └── index.js
│   │   ├── Input/
│   │   ├── Select/
│   │   ├── Modal/
│   │   ├── Spinner/
│   │   ├── ErrorMessage/
│   │   └── Card/
│   │
│   ├── data-display/              # Data presentation components
│   │   ├── DataTable/
│   │   │   ├── DataTable.jsx      # Core table with sorting/selection
│   │   │   ├── TablePagination.jsx
│   │   │   ├── TableFilters.jsx
│   │   │   └── index.js
│   │   ├── StatCard/
│   │   ├── TreeView/              # For hierarchical COA display
│   │   └── Chart/
│   │
│   ├── forms/                     # Form-related components
│   │   ├── FormField/
│   │   ├── FormGroup/
│   │   ├── DatePicker/
│   │   ├── DateRangePicker/
│   │   ├── CurrencyInput/
│   │   ├── AccountSelect/         # Account dropdown with hierarchy
│   │   └── CategorySelect/        # Category dropdown with hierarchy
│   │
│   ├── feedback/                  # User feedback components
│   │   ├── Toast/                 # Success/error notifications
│   │   ├── ConfirmDialog/
│   │   ├── EmptyState/
│   │   └── LoadingSkeleton/
│   │
│   └── layout/                    # Layout components
│       ├── PageHeader/
│       ├── PageLayout/
│       ├── Sidebar/
│       └── FilterSidebar/
│
├── features/                      # Feature modules (domain-specific)
│   ├── transactions/              # Unified transaction handling
│   │   ├── components/
│   │   │   ├── TransactionTable.jsx
│   │   │   ├── TransactionFilters.jsx
│   │   │   ├── TransactionEditModal.jsx
│   │   │   └── TransactionRow.jsx
│   │   ├── hooks/
│   │   │   ├── useTransactions.js
│   │   │   └── useTransactionFilters.js
│   │   ├── utils/
│   │   └── index.js
│   │
│   ├── budget/
│   │   ├── components/
│   │   │   ├── BudgetWorksheet/
│   │   │   │   ├── BudgetWorksheet.jsx    # Orchestrator only
│   │   │   │   ├── BudgetEntryForm.jsx
│   │   │   │   ├── BudgetEntryTable.jsx
│   │   │   │   └── BudgetFilters.jsx
│   │   │   ├── BudgetRealization/
│   │   │   └── BudgetChart/
│   │   ├── hooks/
│   │   └── utils/
│   │
│   ├── forecast/
│   │   ├── components/
│   │   │   ├── ScenarioManager/
│   │   │   ├── ModuleEditor/
│   │   │   ├── AssumptionsEditor/
│   │   │   └── ForecastReview/
│   │   ├── hooks/
│   │   ├── context/               # ForecastContext lives here
│   │   └── utils/
│   │
│   ├── reports/
│   │   ├── components/
│   │   │   ├── BalanceSheet/
│   │   │   ├── CashFlow/
│   │   │   └── Charts/
│   │   └── hooks/
│   │
│   └── settings/
│       ├── components/
│       │   ├── COAManager/
│       │   └── FXSettings/
│       └── hooks/
│
├── hooks/                         # Shared hooks
│   ├── useAPI.js                  # Enhanced with caching
│   ├── useDebounce.js             # NEW: Debounce filter changes
│   ├── useDateRange.js            # NEW: Unified date range logic
│   ├── useLocalStorage.js         # NEW: Persist filter preferences
│   ├── usePagination.js           # NEW: Unified pagination logic
│   └── useToast.js                # NEW: Toast notifications
│
├── utils/                         # Shared utilities
│   ├── formatting/
│   │   ├── currency.js            # formatCurrency, parseCurrency
│   │   ├── dates.js               # formatDate, parseDate, dateRanges
│   │   └── numbers.js             # formatNumber, formatPercent
│   ├── validation/
│   │   ├── transactions.js
│   │   ├── budget.js
│   │   └── common.js
│   ├── tree/
│   │   ├── treeHelpers.js         # collectCollapsiblePaths, etc.
│   │   └── hierarchyBuilder.js
│   └── api/
│       ├── client.js              # Enhanced API client
│       └── endpoints.js           # API endpoint constants
│
├── constants/
│   ├── dates.js                   # MONTH_OPTIONS, YEAR_OPTIONS
│   ├── currencies.js              # SUPPORTED_CURRENCIES
│   ├── transactions.js            # BATCH_SIZE, DEFAULT_FILTERS
│   └── routes.js                  # Route paths as constants
│
├── pages/                         # Thin page wrappers
│   ├── TransactionsPage.jsx       # Just renders <Transactions type="actual" />
│   ├── BudgetTransactionsPage.jsx # Just renders <Transactions type="budget" />
│   ├── BudgetWorksheetPage.jsx
│   └── ...
│
└── styles/
    ├── variables.css              # CSS custom properties
    ├── reset.css                  # CSS reset
    ├── utilities.css              # Utility classes
    └── components/                # Component-specific styles
```

### 12.3 Shared Transaction Component (Example Refactor)

```jsx
// features/transactions/components/TransactionsView.jsx
// Replaces BOTH TransActual.jsx AND TransBudget.jsx

import { useState } from 'react';
import { useTransactions } from '../hooks/useTransactions';
import { useTransactionFilters } from '../hooks/useTransactionFilters';
import { TransactionTable } from './TransactionTable';
import { TransactionFilters } from './TransactionFilters';
import { TransactionEditModal } from './TransactionEditModal';
import { ConfirmDialog, PageLayout, Toast } from '@/components';

export function TransactionsView({
  type = 'actual',  // 'actual' | 'budget'
  apiEndpoint,
  editEndpoint,
  deleteEndpoint
}) {
  // Unified filter logic (was duplicated 80+ lines)
  const { filters, setFilter, resetFilters, filterOptions } = useTransactionFilters({
    type,
    persistKey: `transactions-${type}-filters`
  });

  // Unified data fetching (was duplicated)
  const {
    transactions,
    loading,
    error,
    totals,
    refetch,
    hasMore,
    loadMore
  } = useTransactions({ type, filters });

  // Modal state (was duplicated)
  const [editModal, setEditModal] = useState({ open: false, item: null });
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, item: null });
  const [toast, setToast] = useState(null);

  const handleEdit = async (data) => {
    // Unified edit logic
  };

  const handleDelete = async () => {
    // Unified delete logic
  };

  return (
    <PageLayout title={type === 'actual' ? 'Actual Transactions' : 'Budget Transactions'}>
      <TransactionFilters
        filters={filters}
        options={filterOptions}
        onChange={setFilter}
        onReset={resetFilters}
      />

      <TransactionTable
        transactions={transactions}
        loading={loading}
        error={error}
        totals={totals}
        onEdit={(item) => setEditModal({ open: true, item })}
        onDelete={(item) => setDeleteConfirm({ open: true, item })}
        onLoadMore={loadMore}
        hasMore={hasMore}
      />

      <TransactionEditModal
        open={editModal.open}
        item={editModal.item}
        type={type}
        onSave={handleEdit}
        onClose={() => setEditModal({ open: false, item: null })}
      />

      <ConfirmDialog
        open={deleteConfirm.open}
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction?"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm({ open: false, item: null })}
      />

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

// Pages become thin wrappers:
// pages/TransactionsPage.jsx
export default function TransactionsPage() {
  return <TransactionsView type="actual" />;
}

// pages/BudgetTransactionsPage.jsx
export default function BudgetTransactionsPage() {
  return <TransactionsView type="budget" />;
}
```

### 12.4 UI/UX Improvements

#### Current Inconsistencies to Fix

| Issue | Current State | Proposed Fix |
|-------|--------------|--------------|
| Loading states | Mix of "Loading...", "Loading…", spinners | Unified `<LoadingSkeleton>` component |
| Error display | Different per page | Unified `<ErrorBanner>` with retry button |
| Empty states | Inconsistent messages | Unified `<EmptyState>` with illustration |
| Button styles | `.generate-report-button` used everywhere | Button variants: primary, secondary, danger |
| Form validation | Scattered, inconsistent | Centralized validation with error messages |
| Date selection | Different controls per page | Unified `<DateRangePicker>` |
| Notifications | None currently | Toast system for success/error feedback |

#### Proposed Design System

```css
/* styles/variables.css - Enhanced */

:root {
  /* Spacing scale (consistent) */
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.5rem;    /* 24px */
  --space-6: 2rem;      /* 32px */
  --space-8: 3rem;      /* 48px */

  /* Typography */
  --font-sans: 'Plus Jakarta Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;

  /* Colors - Semantic */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --color-info: #3b82f6;

  /* Financial-specific colors */
  --color-income: #10b981;
  --color-expense: #ef4444;
  --color-transfer: #6366f1;
  --color-budget-over: #ef4444;
  --color-budget-under: #10b981;

  /* Component tokens */
  --button-height: 2.5rem;
  --input-height: 2.5rem;
  --border-radius-sm: 0.25rem;
  --border-radius-md: 0.5rem;
  --border-radius-lg: 0.75rem;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 200ms ease;
}
```

#### New Features to Add

1. **Toast Notifications**
   ```jsx
   // After successful save
   showToast({ type: 'success', message: 'Transaction saved successfully' });

   // After error
   showToast({ type: 'error', message: 'Failed to save. Please try again.' });
   ```

2. **Keyboard Shortcuts**
   - `Ctrl+S` - Save current form
   - `Escape` - Close modal
   - `Ctrl+N` - New entry
   - `?` - Show keyboard shortcuts

3. **Breadcrumb Navigation**
   ```
   Home > Budgeting > Budget Worksheet
   ```

4. **Search Functionality**
   - Global search across transactions
   - Search within current view

5. **Loading Skeletons**
   - Skeleton placeholders instead of "Loading..." text
   - Maintains layout during load

### 12.5 Performance Optimizations

#### Component Memoization
```jsx
// Wrap expensive components
import { memo } from 'react';

export const TransactionRow = memo(function TransactionRow({ transaction, onEdit, onDelete }) {
  // Component implementation
});

// Use useMemo for expensive calculations
const sortedTransactions = useMemo(() => {
  return [...transactions].sort((a, b) => /* sorting logic */);
}, [transactions, sortConfig]);

// Use useCallback for event handlers passed to children
const handleEdit = useCallback((item) => {
  setEditModal({ open: true, item });
}, []);
```

#### Virtual Scrolling for Large Lists
```jsx
// For tables with 1000+ rows
import { useVirtualizer } from '@tanstack/react-virtual';

function TransactionTable({ transactions }) {
  const virtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48, // row height
  });

  // Render only visible rows
}
```

#### API Response Caching
```jsx
// Enhanced useAPI with caching
function useAPI(endpoint, options = {}) {
  const { cache = true, cacheTime = 5 * 60 * 1000 } = options;

  // Use SWR or React Query pattern
  // Stale-while-revalidate for better UX
}
```

#### Debounced Filters
```jsx
// Prevent excessive API calls
const debouncedFilters = useDebounce(filters, 300);

useEffect(() => {
  fetchTransactions(debouncedFilters);
}, [debouncedFilters]);
```

### 12.6 State Management Improvements

#### Option 1: Enhanced Context (Recommended for this app size)
```jsx
// contexts/AppContext.jsx
const AppContext = createContext();

export function AppProvider({ children }) {
  // Global app state
  const [user, setUser] = useState(null);
  const [preferences, setPreferences] = useState({});

  // Cached reference data
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [currencies, setCurrencies] = useState([]);

  // Load reference data once
  useEffect(() => {
    Promise.all([
      fetchAccounts(),
      fetchCategories(),
      fetchCurrencies()
    ]).then(([acc, cat, cur]) => {
      setAccounts(acc);
      setCategories(cat);
      setCurrencies(cur);
    });
  }, []);

  return (
    <AppContext.Provider value={{
      user, preferences,
      accounts, categories, currencies,
      // Helper methods
      getAccountById: (id) => accounts.find(a => a.id === id),
      getCategoryById: (id) => categories.find(c => c.id === id),
    }}>
      {children}
    </AppContext.Provider>
  );
}
```

#### Option 2: Zustand (If state grows more complex)
```jsx
// stores/appStore.js
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useAppStore = create(
  persist(
    (set, get) => ({
      // Reference data
      accounts: [],
      categories: [],

      // User preferences (persisted)
      preferences: {
        baseCurrency: 'USD',
        dateFormat: 'YYYY-MM-DD',
        defaultFilters: {}
      },

      // Actions
      setAccounts: (accounts) => set({ accounts }),
      setPreference: (key, value) => set((state) => ({
        preferences: { ...state.preferences, [key]: value }
      })),
    }),
    { name: 'fin-storage' }
  )
);
```

### 12.7 TypeScript Migration (Recommended)

#### Benefits for This Project
- Catch type errors at compile time (common with financial calculations)
- Better IDE support and autocomplete
- Self-documenting code
- Safer refactoring

#### Migration Strategy
1. Add TypeScript gradually (`.tsx` files alongside `.jsx`)
2. Start with shared utilities and types
3. Move to hooks and components
4. Finish with pages

#### Key Types to Define
```typescript
// types/transaction.ts
export interface Transaction {
  id: number;
  psId?: number;
  date: Date;
  description1: string;
  description2?: string;
  amount: number;
  currency: CurrencyCode;
  baseAmount: number;
  baseCurrency: CurrencyCode;
  accountId: number;
  categoryId: number;
  labels: string[];
  memo?: string;
  note?: string;
}

// types/budget.ts
export interface BudgetEntry {
  id: number;
  date: Date;
  description: string;
  amount: number;
  currency: CurrencyCode;
  baseAmount: number;
  accountId: number;
  categoryId: number;
  budgetYear: number;
}

// types/forecast.ts
export interface ForecastModule {
  id: number;
  scenarioId: number;
  name: string;
  type: 'asset' | 'liability';
  currency: CurrencyCode;
  baseValue: number;
  marketValue: number;
  growthRate: number;
  investments: Investment[];
  disposals: Disposal[];
}

// types/common.ts
export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'JPY' | /* ... */;

export interface ApiResponse<T> {
  data: T;
  error?: string;
  meta?: {
    total: number;
    page: number;
    pageSize: number;
  };
}
```

---

## 13. Backend Code Quality Comments

### 13.1 Current Issues Identified

#### Service Layer Complexity
| Service | Lines | Issues |
|---------|-------|--------|
| `fcbuilder-module.js` | 835 | Monolithic, hard to test, mixes data access with business logic |
| `fcbuilder-incexp.js` | 436 | Similar issues, duplicated patterns from module builder |
| `cashFlowFetcher.js` | 619 | Complex MongoDB aggregation, hard to maintain |
| `balanceSheetFetcher.js` | 324 | Could be simplified with SQL views |

#### Missing Abstractions
```javascript
// Current: Direct MongoDB operations scattered throughout
const PSdata = require('../models/PSdata');
await PSdata.find({ Date: { $gte: fromDate, $lte: toDate } });

// Proposed: Repository pattern
class TransactionRepository {
  async findByDateRange(fromDate, toDate) { /* ... */ }
  async findByAccount(accountId) { /* ... */ }
  async aggregateByCategory(options) { /* ... */ }
}
```

#### Error Handling Inconsistencies
```javascript
// Current: Mix of try/catch patterns
// Some routes: res.status(500).json({ error: error.message })
// Other routes: res.status(500).send(error.message)
// Some services: throw error (unhandled)

// Proposed: Centralized error handling
class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message,
    code: err.code,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});
```

### 13.2 Proposed Backend Architecture

```
server/
├── src/
│   ├── config/
│   │   ├── database.js          # PostgreSQL pool configuration
│   │   ├── pocketsmith.js       # PS API configuration
│   │   └── constants.js         # App constants
│   │
│   ├── db/
│   │   ├── migrations/          # Database migrations
│   │   ├── seeds/               # Seed data
│   │   └── queries/             # Raw SQL queries (if needed)
│   │
│   ├── repositories/            # Data access layer (one per entity)
│   │   ├── base.repository.js   # Base class with common operations
│   │   ├── transaction.repository.js
│   │   ├── budget.repository.js
│   │   ├── forecast.repository.js
│   │   ├── account.repository.js
│   │   └── category.repository.js
│   │
│   ├── services/                # Business logic layer
│   │   ├── pocketsmith/
│   │   │   ├── client.js        # API client
│   │   │   ├── sync.service.js  # Sync orchestration
│   │   │   └── mapper.js        # Data mapping
│   │   │
│   │   ├── forecast/
│   │   │   ├── generator.service.js
│   │   │   ├── scenario.service.js
│   │   │   └── calculator.js    # Pure calculation functions
│   │   │
│   │   ├── budget/
│   │   │   ├── budget.service.js
│   │   │   └── comparison.service.js
│   │   │
│   │   ├── reports/
│   │   │   ├── balance-sheet.service.js
│   │   │   └── cash-flow.service.js
│   │   │
│   │   └── fx/
│   │       ├── rates.service.js
│   │       └── converter.js     # Pure conversion functions
│   │
│   ├── controllers/             # Request handlers (thin)
│   │   ├── transactions.controller.js
│   │   ├── budget.controller.js
│   │   ├── forecast.controller.js
│   │   └── reports.controller.js
│   │
│   ├── routes/                  # Route definitions
│   │   ├── index.js             # Route aggregator
│   │   ├── transactions.routes.js
│   │   ├── budget.routes.js
│   │   └── forecast.routes.js
│   │
│   ├── middleware/
│   │   ├── error-handler.js     # Centralized error handling
│   │   ├── validator.js         # Request validation
│   │   ├── logger.js            # Request logging
│   │   └── rate-limiter.js      # API rate limiting
│   │
│   ├── utils/
│   │   ├── date.js              # Date utilities
│   │   ├── currency.js          # Currency utilities
│   │   └── tree.js              # Tree/hierarchy utilities
│   │
│   ├── types/                   # JSDoc type definitions (or TypeScript)
│   │   └── index.js
│   │
│   └── app.js                   # Express app setup
│
├── tests/
│   ├── unit/
│   │   ├── services/
│   │   └── utils/
│   ├── integration/
│   │   └── routes/
│   └── fixtures/
│
└── package.json
```

### 13.3 API Design Improvements

#### Current Issues
- Inconsistent response formats
- Missing pagination on list endpoints
- No API versioning
- Limited error codes

#### Proposed API Standards

```javascript
// Consistent response format
{
  "success": true,
  "data": { /* payload */ },
  "meta": {
    "total": 1250,
    "page": 1,
    "pageSize": 50,
    "totalPages": 25
  }
}

// Error format
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid date range",
    "details": [
      { "field": "fromDate", "message": "Must be before toDate" }
    ]
  }
}

// API versioning
/api/v1/transactions
/api/v1/budget
/api/v1/forecast

// Consistent query parameters
GET /api/v1/transactions?
  page=1&
  pageSize=50&
  sortBy=date&
  sortOrder=desc&
  fromDate=2025-01-01&
  toDate=2025-12-31&
  accountId=5&
  categoryId[]=1&categoryId[]=2
```

---

## 14. Additional Questions

### 14.1 Frontend Questions

15. **Component Library**: Should we adopt an existing component library?
    - **Decision: Radix UI + custom styling** - Use Radix for unstyled, accessible primitives (Dialog, DropdownMenu, Select, Tabs, Toast). Keep full control over visual styling. No style conflicts, smaller bundle than full libraries. Handles accessibility, keyboard navigation, and focus management.

16. **Charting Library**: Currently using custom chart implementations. Should we standardize on:
    - **Decision: Recharts** - React-friendly, declarative API, good defaults. Built on D3. Covers needed chart types (line, bar, area for forecasts/budgets). Good documentation, reasonable bundle size.

17. **Testing Strategy**: No tests currently exist. What level of testing?
    - **Decision: Unit tests initially, expand to E2E later** - Start with Vitest for unit tests on high-value code: forecast calculations, currency conversions, date utilities, data transformations. Later add Playwright E2E tests for critical flows (sync, accept transactions, budget entry). Skip component tests - they often test implementation details and break on refactors.

18. **Mobile Support**: Should the redesign consider:
    - **Decision: Desktop only** - Optimize for desktop screens. Personal finance is a "sit down and focus" activity. Complex tables and forms don't translate well to mobile. Can add tablet breakpoints later if needed.

### 14.2 Backend Questions

19. **API Documentation**: Should we add:
    - **Decision: Lightweight README** - Simple markdown file listing endpoints with request/response examples. Sufficient for single-user personal project. Low maintenance overhead. Can upgrade to OpenAPI later if needed.

20. **Logging & Monitoring**: Currently minimal logging. Should we add:
    - **Decision: Structured logging (Pino)** - JSON-formatted logs with levels (info, warn, error). Fast and lightweight. Easy to search/filter with grep and jq. No external services required. Useful for debugging sync issues, API errors, and calculations.

21. **Background Jobs**: For scheduled syncs and report generation:
    - **Decision: None needed** - All operations are user-triggered (manual sync, on-demand forecasts). Backup scripts run via OS cron outside the app. No in-app job queue required. Can add node-cron later if a need arises.

---

## 15. Recommended Implementation Order

### Phase 1: Foundation (Database + Core Backend)
1. PostgreSQL schema creation
2. Data migration scripts
3. Repository layer implementation
4. Core API endpoints migration

### Phase 2: Frontend Foundation
1. Create shared component library (Button, Input, Modal, Table)
2. Implement design system (CSS variables, typography)
3. Add Toast notification system
4. Create unified TransactionsView component

### Phase 3: Feature Migration
1. Transactions (actual + budget) - uses shared component
2. Budget worksheet
3. Reports (balance sheet, cash flow)
4. Forecast modules

### Phase 4: Polish
1. Performance optimizations (memoization, virtual scrolling)
2. Loading skeletons
3. Error boundaries
4. Keyboard shortcuts

### Phase 5: Enhancement
1. TypeScript migration (optional)
2. Testing suite
3. API documentation
4. Mobile responsiveness

---

## 16. Estimated Effort Breakdown

| Phase | Backend | Frontend | Total |
|-------|---------|----------|-------|
| Phase 1: Foundation | 60% | 40% | ~2-3 weeks |
| Phase 2: Frontend Foundation | 10% | 90% | ~1-2 weeks |
| Phase 3: Feature Migration | 40% | 60% | ~2-3 weeks |
| Phase 4: Polish | 20% | 80% | ~1 week |
| Phase 5: Enhancement | 30% | 70% | ~1-2 weeks |
| **Total** | | | **~7-11 weeks** |

---

## 17. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Largest component (lines) | 757 (BudgetInput) | <200 |
| Duplicated code blocks | 5+ major | 0 |
| Shared components | ~3 | 15+ |
| API response time (p95) | Unknown | <500ms |
| Test coverage | 0% | >60% |
| Lighthouse Performance | Unknown | >80 |
| Build size | Unknown | <500KB gzipped |

---

*Document updated: 2026-01-29*
*Status: All decisions finalized - Ready for implementation*
*Sections added: Frontend Redesign, Backend Code Quality, Additional Questions*
