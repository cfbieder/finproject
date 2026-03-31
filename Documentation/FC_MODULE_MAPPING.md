# Forecast Module — Terminology & Data Mapping

## 1. Period Definitions

| Term | Formula | Example (PeriodStart=2027) | Description |
|------|---------|---------------------------|-------------|
| **PeriodStart** | — | 2027 | First forecast year. All FC engine projections begin here. |
| **BaseYear** | PeriodStart − 1 | 2026 | Budget year. P&L sourced from budget. BS modules project ending balances via engine. |
| **LastActualYear** | PeriodStart − 2 | 2025 | Most recent completed year. P&L and BS sourced from actuals (ledger/reports). |

**BaseDate constraint:** Each BS module's BaseDate must be set to LastActualYear (Dec 31). The engine derives its start year from BaseDate, so misalignment (e.g., BaseDate = 2024 when LastActualYear = 2025) will shift the period grid and produce incorrect results.

---

## 2. FC Review — Column Data Sources

| Row | LastActualYear (PS−2) | BaseYear (PS−1) | PeriodStart | PeriodStart+1 | … |
|-----|----------------------|-----------------|-------------|---------------|---|
| **Income** | Actual (by FC Line) | Budget | FC Exp | FC Exp | FC Exp |
| **Expense** | Actual (by FC Line) | Budget | FC Exp | FC Exp | FC Exp |
| **Cash Flow** | Income − Expense | Income − Expense | Income − Expense | Income − Expense | Income − Expense |
| **Transfers** | *Deferred* | FC BS Module | FC BS Module | FC BS Module | FC BS Module |
| **Net Cash Flow** | Cash Flow *(no transfers yet)* | Cash Flow + Transfers | Cash Flow + Transfers | Cash Flow + Transfers | Cash Flow + Transfers |
| **Bank Accounts** | Actual (fixed) | Prior Cash + Net Cash Flow | Prior Cash + Net Cash Flow | Prior Cash + Net Cash Flow | Prior Cash + Net Cash Flow |
| **Other Assets** | Actual | FC BS Module | FC BS Module | FC BS Module | FC BS Module |
| **Liabilities** | Actual | FC BS Module | FC BS Module | FC BS Module | FC BS Module |

### Notes
- **Budget** = BaseYear P&L display values from `base-year-values` API. This combines two sources: BS module base amounts (income_amount, expense_amount) and FC IncExp base values. Not strictly "budget table" data — it is the best available estimate of BaseYear P&L derived from forecast setup inputs.
- **Actual** = Historical P&L and BS from year-end ledger balances (`useBaseYearActuals`, `useBaseYearBalanceSheet`). These are derived from transaction ledger data, not directly imported account snapshots.
- **Actual (by FC Line)** = LastActualYear P&L actuals mapped to FC Line names via `categoryToLineMap`. Leaf COA categories are aggregated into their parent FC Line using the `fc_line_categories` mapping (e.g., "Financial Income - Dividend" + "Option Trade" → "Dividend Income").
- **FC Exp** = FC Income/Expense engine (`fcbuilder-incexp.js`), starts from PeriodStart
- **FC BS Module** = Balance Sheet module engine (`fcbuilder-module.js`), starts from LastActualYear (BaseDate)
- **Transfers** = Invest/Dispose transfer amounts from BS modules (Transfer − Bank category)
- **Bank Accounts** = Running cash balance. LastActualYear is the actual fixed balance from ledger. All subsequent years: `Prior Year Cash + Current Year Net Cash Flow`. Engine-computed Bank Accounts entries are not used for display — the running balance is derived in the Review display layer.
- **Net Cash Flow** = Cash Flow + Transfers (sign convention: Transfers are positive for disposals/cash inflows, negative for investments/cash outflows)
- **LastActualYear Transfers/Net Cash Flow** — Intentionally deferred. LastActualYear has no transfer data source yet, so Net Cash Flow = Cash Flow (excludes transfers). This creates a known asymmetry with later columns. Will be addressed in a future phase when actual transfer data becomes available.

---

## 3. BS Module Field Labels

### Current → New Label Mapping

| Current Label | New Label | Tooltip (i) Description |
|---------------|-----------|------------------------|
| Account Value | PY Actual (*year*) | Prior year-end actual account value in local currency, derived from year-end ledger balances. |
| Account Value USD | PY Actual (USD) | Prior year-end actual value converted to USD at year-end exchange rate. |
| Base Value | Cost Basis | Original cost basis (book value) of the asset/liability at start of forecast. Usually equals PY Actual unless adjusted. |
| Base Value (USD) | Cost Basis (USD) | Cost basis converted to USD. |
| Market Value | Market Value | Current market value at start of forecast. May differ from Cost Basis for assets with unrealized gains/losses. |
| Market Value (USD) | Market Value (USD) | Market value converted to USD. |
| Copy Base | PY → Cost Basis | Copies PY Actual value into Cost Basis field. |
| Copy Market | PY → Market Value | Copies PY Actual value into Market Value field. |

### Field Relationships

```
PY Actual (2025)          ← Year-end ledger balance (read-only)
         │
         ├── [PY → Cost Basis] ──→  Cost Basis        ← Editable, usually = PY Actual
         │
         └── [PY → Market Value] ─→ Market Value      ← Editable, may differ from Cost Basis
```

- **Cost Basis** tracks the original purchase price / book value. Used to calculate realized gains on disposal.
- **Market Value** tracks the current fair market value. Used as the starting point for growth projections.
- For most assets, Cost Basis = Market Value = PY Actual.
- They differ when an asset has unrealized gains (e.g., stock purchased at $100 now worth $150: Cost Basis = $100, Market Value = $150).

---

## 4. Engine Processing by Period

### FC IncExp Engine (`fcbuilder-incexp.js`)
- **Starts at:** PeriodStart
- **Processes:** Income and expense line items
- **BaseYear:** Not processed — budget covers P&L

### FC BS Module Engine (`fcbuilder-module.js`)
- **Starts at:** LastActualYear (derived from BaseDate)
- **Processes:** Market values, growth, transfers (invest/dispose), income, expenses, tax, FX
- **BaseYear:** Engine computes ending balance from PY Actual + growth + transfers
- **BaseYear transfers:** Invest/Dispose entries dated in BaseYear adjust the ending balance
- **BaseYear Full disposal:** Asset zeroed, P&L kept as budget, all forecast years zeroed

### Output Categories Written by BS Module Engine
| Category | Values |
|----------|--------|
| Module Account (e.g., "PL Investments") | Market values (USD) |
| Transfer − Bank | −(Dispose) − Invest |
| Income Category | Income values (USD) |
| Expense Category | Expense values (USD) |
| Taxes | Tax values (USD, deferred 1 year) |
| Bank Accounts | Income + Expense + Tax + Transfers |
