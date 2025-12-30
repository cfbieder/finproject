# Forecast Generation System - Complete Logic Documentation

## Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Main Entry Point: generateForecast()](#main-entry-point-generateforecast)
4. [Configuration Loading](#configuration-loading)
5. [Database Operations](#database-operations)
6. [Module Processing](#module-processing)
   - [Balance Sheet Modules (FCModule)](#balance-sheet-modules-fcmodule)
   - [Income/Expense Modules (FCIncExp)](#incomeexpense-modules-fcincexp)
7. [Data Structures](#data-structures)
8. [Financial Calculations](#financial-calculations)
9. [Audit Trail](#audit-trail)
10. [Flow Diagrams](#flow-diagrams)

---

## Overview

The Forecast Generation System creates multi-year financial projections for different scenarios. It processes two types of modules:

1. **Balance Sheet Modules (FCModule)**: Track assets, investments, disposals, realized/unrealized gains, and associated income/expenses
2. **Income/Expense Modules (FCIncExp)**: Project recurring income and expenses with growth rates and discrete changes

The system outputs:
- Database entries (FCEntries collection) for querying and reporting
- CSV audit trails for detailed analysis and debugging

---

## System Architecture

```
generateForecast()  (index.js)
    │
    ├── loadScenarioConfig()  (fcbuilder-setup.js)
    │   └── Loads FCAssump.json with scenarios, rates, and periods
    │
    ├── ForecastDatabaseManager  (database-manager.js)
    │   ├── ensureConnection()
    │   ├── clearEntriesForScenario()
    │   ├── loadModulesForScenario()
    │   ├── loadIncExpModulesForScenario()
    │   └── loadCategoriesForScenario()
    │
    ├── processModule() for FCModule  (fcbuilder-module.js)
    │   ├── Calculate market values and base values
    │   ├── Process investments and disposals
    │   ├── Calculate realized/unrealized gains
    │   ├── Calculate income and expenses
    │   ├── Calculate taxes
    │   ├── Convert LC to USD
    │   ├── Update df_categories
    │   ├── writeAuditTrail()
    │   └── insertCategoryEntries()
    │
    └── processModule() for FCIncExp  (fcbuilder-incexp.js)
        ├── Calculate income/expense values with growth
        ├── Apply discrete changes
        ├── Calculate taxes
        ├── Update df_categories
        ├── writeEntriesAuditTrail()
        └── insertCategoryEntries()
```

---

## Main Entry Point: generateForecast()

**Location**: `index.js`

### Function Signature
```javascript
async function generateForecast(scenarioName, options = {})
```

### Parameters
- `scenarioName` (string): Name of the scenario to generate (e.g., "Baseline", "Optimistic")
- `options.mongoUri` (string, optional): MongoDB connection URI

### Return Value
```javascript
{
  success: boolean,
  scenario: string,
  deletedCount: number,        // Entries deleted before generation
  modulesProcessed: number,     // Total modules processed
  entriesCreated: number,       // Total FCEntries created
  durationMs: number           // Processing time in milliseconds
}
```

### Processing Steps

#### Step 1: Load Scenario Configuration
```javascript
const config = loadScenarioConfig(scenarioName);
```

Returns:
- `scenario`: Scenario object with Name, PeriodStart, PeriodEnd, TaxRate
- `categories`: Array of category names [category, Inflation, FX-PLN, FX-EUR]
- `inflationRates`: Array of inflation rates for each year
- `fxratesPLN`: Array of USD/PLN exchange rates
- `fxratesEUR`: Array of USD/EUR exchange rates
- `years`: Array of forecast years [2025, 2026, ...]

#### Step 2: Create Assumptions DataFrame
```javascript
const df_assumptions = new dfd.DataFrame(
  {
    [categories[1]]: inflationRates,  // "Inflation"
    [categories[2]]: fxratesPLN,      // "FX - PLN"
    [categories[3]]: fxratesEUR,      // "FX - EUR"
  },
  { index: years }
);
```

This DataFrame provides year-indexed lookup for all modules to access inflation and FX rates.

#### Step 3: Initialize Database Manager
```javascript
const dbManager = new ForecastDatabaseManager(options.mongoUri);
await dbManager.ensureConnection();
```

Establishes MongoDB connection for querying modules and inserting results.

#### Step 4: Clear Existing Entries
```javascript
const deletedCount = await dbManager.clearEntriesForScenario(scenarioName);
```

Deletes all FCEntries for this scenario to ensure a clean slate before regeneration.

#### Step 5: Load Modules and Categories
Performs 4 parallel database queries:
1. Load FCModule documents for this scenario
2. Load FCIncExp documents for this scenario
3. Load unique categories (expense, income, account names) from FCModule
4. Load unique categories from FCIncExp

#### Step 6: Build Category Structures
```javascript
const scenarioCategories = buildScenarioCategories(
  accountNames,
  incomeCategories,
  expenseCategories
);
```

Creates ordered list of categories:
1. "Bank Accounts"
2. "Transfer - Bank"
3. All account names (e.g., "Fidelity IRA", "US - Properties")
4. All income categories (e.g., "Salary", "Dividends")
5. All expense categories (e.g., "Property Tax", "Groceries")
6. "Taxes US"

#### Step 7: Initialize Category DataFrames

Two DataFrames are created for aggregating results:

**df_categories** (for FCModule results):
- Rows: scenarioCategories
- Columns: [baseYear, year1, year2, ...]
- Initialized with zeros

**df_categories2** (for FCIncExp results):
- Rows: incexpCategories + ["Taxes", "Bank Accounts"]
- Columns: [baseYear, year1, year2, ...]
- Initialized with zeros

#### Step 8: Process All Modules in Parallel
```javascript
const results = await Promise.all([
  ...bsModules.map((module) => processBSModule(...)),
  ...incexpModules.map((module) => processIncExpModule(...))
]);
```

Each module gets its own temporary DataFrame to avoid race conditions during parallel processing.

#### Step 9: Return Results
Aggregates metadata from all module processing results and returns summary statistics.

---

## Configuration Loading

**Location**: `fcbuilder-setup.js`

### loadScenarioConfig(scenarioName)

#### Purpose
Loads and parses FCAssump.json to extract scenario configuration, inflation rates, FX rates, and tax rates.

#### FCAssump.json Structure
```json
{
  "scenarios": [
    {
      "Name": "Baseline",
      "PeriodStart": 2025,
      "PeriodEnd": 2035
    }
  ],
  "category": ["category", "Inflation", "FX - PLN", "FX - EUR"],
  "inflation": [
    { "Scenario": "Baseline", "Year": 2025, "Rate": 2.5 },
    { "Scenario": "Baseline", "Year": 2026, "Rate": 2.3 }
  ],
  "FX": [
    {
      "Scenario": "Baseline",
      "Year": 2025,
      "Rates": { "USDPLN": 4.0, "USDEUR": 0.92 }
    }
  ],
  "Tax Rate": [
    { "Scenario": "Baseline", "Rate": 25 }
  ]
}
```

#### buildRates(entries, periodStart, periodEnd)

Creates rate arrays for the full forecast period by carrying forward rates when no entry exists:

**Input**:
```javascript
entries = [
  { Year: 2025, Rate: 2.5 },
  { Year: 2027, Rate: 2.3 }
]
periodStart = 2025
periodEnd = 2029
```

**Output**:
```javascript
[2.5, 2.5, 2.3, 2.3, 2.3]
// Years: 2025, 2026, 2027, 2028, 2029
```

This ensures every forecast year has a rate, even if not explicitly defined in FCAssump.json.

---

## Database Operations

**Location**: `database-manager.js`

### ForecastDatabaseManager Class

#### ensureConnection()
Establishes MongoDB connection if not already connected. Uses connection pooling from mongoose.

#### clearEntriesForScenario(scenarioName)
```javascript
await FCEntries.deleteMany({ Scenario: scenarioName })
```
Removes all existing forecast entries for the scenario to prevent duplicates.

#### loadModulesForScenario(scenarioName)
```javascript
return FCModule.find({ Scenario: scenarioName }).lean().exec();
```
Returns array of FCModule documents containing asset/investment configurations.

#### loadIncExpModulesForScenario(scenarioName)
```javascript
return FCIncExp.find({ Scenario: scenarioName }).lean().exec();
```
Returns array of FCIncExp documents containing income/expense configurations.

#### loadCategoriesForScenario(scenarioName)
Uses MongoDB aggregation to extract unique category values:
```javascript
FCModule.aggregate([
  { $match: { Scenario: scenarioName } },
  {
    $group: {
      _id: null,
      expenseCategories: { $addToSet: "$ExpCategory" },
      incomeCategories: { $addToSet: "$IncomeCategory" },
      accountNames: { $addToSet: "$Account" }
    }
  }
])
```

Returns deduplicated lists of all categories used in modules.

---

## Module Processing

### Balance Sheet Modules (FCModule)

**Location**: `fcbuilder-module.js`

#### Module Document Structure
```javascript
{
  Name: "Fidelity IRA Module",
  Account: "Fidelity IRA",
  BaseDate: Date("2024-12-31"),
  BaseValue: 250000,        // LC value
  BaseValueUSD: 250000,     // USD value
  MarketValue: 265000,      // LC market value
  MarketValueUSD: 265000,   // USD market value
  Currency: "USD",          // USD, PLN, or EUR
  Growth: 0.05,             // 5% growth (inflation-adjusted)
  IncomePct: [              // Array of income percentages by year
    { Date: Date("2025-01-01"), Value: 0.02 },  // 2% in 2025
    { Date: Date("2026-01-01"), Value: 0.025 }  // 2.5% in 2026
  ],
  ExpensePct: 0.005,        // 0.5% expense (inflation-adjusted)
  IncomeCategory: "Dividends",
  ExpCategory: "Financial Expenses",
  Invest: [
    { Date: Date("2025-06-30"), Amount: 10000 }
  ],
  Dispose: [
    { Date: Date("2027-12-31"), Amount: 50000, Flag: "Partial" }
  ]
}
```

#### Processing Algorithm

##### 1. Initialize Value Arrays
```javascript
const yearsCount = endyear - startyear + 1;
const baseValues = new Array(yearsCount).fill(module.BaseValue);
const marketValues = new Array(yearsCount).fill(module.MarketValue);
const fxrates = new Array(yearsCount).fill(1);
const investValues = new Array(yearsCount).fill(0);
const disposeValues = new Array(yearsCount).fill(0);
```

##### 2. Calculate Inflation-Adjusted Percentages
```javascript
for (let i = 0, year = startyear; year <= endyear; i++, year++) {
  const idx = year - periodStart;
  growthValues[i] = growthPct * inflationSeries[idx];
  incomePctValues[i] = incomePct * inflationSeries[idx];
  expPctValues[i] = -expPct * inflationSeries[idx];
}
```

**Example**:
- Growth = 5% (0.05)
- Inflation for 2025 = 2.5% (1.025)
- Adjusted Growth = 0.05 × 1.025 = 5.125%

##### 3. Map Investment and Disposal Transactions
```javascript
if (Array.isArray(module.Invest)) {
  for (let entry of module.Invest) {
    const year = new Date(entry.Date).getFullYear();
    const idx = year - startyear;
    investValues[idx] = entry.Amount;
  }
}

if (Array.isArray(module.Dispose)) {
  for (let entry of module.Dispose) {
    const idx = new Date(entry.Date).getFullYear() - startyear;
    disposeValues[idx] = -entry.Amount;  // Negative for cash inflow
  }
}
```

##### 4. Calculate Year-over-Year Values

**Core Financial Loop**:
```javascript
for (let i = 1; i < yearsCount; i++) {
  // Unrealized gain = previous market × growth rate
  unrealizedGainValues[i] = marketValues[i - 1] * (growthValues[i] / 100);

  const prevMarket = marketValues[i - 1];
  const prevBase = baseValues[i - 1];

  // Proportional reduction of base value when disposing
  const safeDisposeAdjustment =
    prevMarket === 0 ? 0 : (disposeValues[i] * prevBase) / prevMarket;

  // Base value = previous base + new investments + proportional reduction
  baseValues[i] = prevBase + investValues[i] + safeDisposeAdjustment;

  // Market value = previous market + growth + investments + disposals
  marketValues[i] =
    prevMarket + unrealizedGainValues[i] + investValues[i] + disposeValues[i];

  // Realized gain = disposal proceeds - proportional cost basis
  realizedGainValues[i] =
    -disposeValues[i] + (prevMarket === 0 ? 0 : (disposeValues[i] * prevBase) / prevMarket);
}
```

**Example Calculation**:
```
Year 0:
  Base Value = 250,000
  Market Value = 265,000

Year 1 (5% growth, 10,000 investment, no disposal):
  Unrealized Gain = 265,000 × 0.05 = 13,250
  Base Value = 250,000 + 10,000 + 0 = 260,000
  Market Value = 265,000 + 13,250 + 10,000 + 0 = 288,250
  Realized Gain = 0

Year 2 (5% growth, no investment, 50,000 disposal):
  Unrealized Gain = 288,250 × 0.05 = 14,412.50
  Disposal Adjustment = (-50,000 × 260,000) / 288,250 = -45,078
  Base Value = 260,000 + 0 + (-45,078) = 214,922
  Market Value = 288,250 + 14,412.50 + 0 + (-50,000) = 252,662.50
  Realized Gain = -(-50,000) + (-50,000 × 260,000) / 288,250 = 4,922
```

##### 5. Handle Full Disposals
```javascript
if (entry.Flag == "Full") {
  const idx = new Date(entry.Date).getFullYear() - startyear;

  // Recalculate unrealized gain as half year's growth
  unrealizedGainValues[idx] =
    (marketValues[idx] - marketValues[idx - 1]) / 2;

  disposeValues[idx] = marketValues[idx - 1] + unrealizedGainValues[idx];
  realizedGainValues[idx] = disposeValues[idx] - baseValues[idx];

  // Zero out all future years
  for (let j = idx + 1; j < yearsCount; j++) {
    baseValues[j] = 0;
    marketValues[j] = 0;
    unrealizedGainValues[j] = 0;
    incomePctValues[j] = 0;
    expPctValues[j] = 0;
    growthValues[j] = 0;
  }
}
```

##### 6. Calculate Income and Expenses
Uses average market value to smooth intra-year fluctuations:
```javascript
for (let i = 0; i < yearsCount; i++) {
  const avgMarket = (marketValues[i] + marketValues[i - 1]) / 2;

  incomeValues[i] = (avgMarket * incomePctValues[i]) / 100;
  expenseValues[i] = (avgMarket * expPctValues[i]) / 100;
}
```

**Example**:
```
Market Value Year 0 = 265,000
Market Value Year 1 = 288,250
Average = (265,000 + 288,250) / 2 = 276,625

Income (2%) = 276,625 × 0.02 = 5,532.50
Expense (0.5%) = 276,625 × -0.005 = -1,383.13
```

##### 7. Calculate Taxes
Applied only to positive realized gains and income:
```javascript
const taxRate = scenario.TaxRate;  // e.g., 25
const rateFactor = -taxRate / 100;  // -0.25 (negative = outflow)

for (let i = 0; i < yearsCount; i++) {
  if (realizedGainValues[i] > 0) {
    taxValues[i] += rateFactor * realizedGainValues[i];
  }
  if (incomeValues[i] > 0) {
    taxValues[i] += rateFactor * incomeValues[i];
  }
}
```

##### 8. FX Conversion to USD
All LC values are converted to USD:
```javascript
for (let i = 0; i < yearsCount; i++) {
  baseValuesUSD[i] = baseValues[i] / fxrates[i];
  marketValuesUSD[i] = marketValues[i] / fxrates[i];
  incomeValuesUSD[i] = incomeValues[i] / fxrates[i];
  // ... etc
}
```

For USD currency modules, `fxrates[i] = 1` for all years.

##### 9. Update df_categories DataFrame

The module updates multiple rows in the categories DataFrame:

```javascript
// Market values
df_categories[module.Account][year] = marketValuesUSD[i];

// Net transfers (disposals - investments)
df_categories["Transfer - Bank"][year] = disposeValuesUSD[i] - investValuesUSD[i];

// Income
df_categories[module.IncomeCategory][year] += incomeValuesUSD[i];

// Expenses
df_categories[module.ExpCategory][year] += expenseValuesUSD[i];

// Taxes
df_categories["Taxes US"][year] += taxValuesUSD[i];

// Net cash change
const cashChange = incomeValuesUSD[i] + expenseValuesUSD[i] + taxValuesUSD[i] + transferValues[i];
df_categories["Bank Accounts"][year] += cashChange;
```

##### 10. Write Audit Trail
Creates three CSV files:
- `{scenario}_{module}_LC.csv`: Local currency values
- `{scenario}_{module}_USD.csv`: USD values
- `{scenario}_{module}_entries.csv`: Category assignments

##### 11. Insert Database Entries
Transforms DataFrame to database documents:
```javascript
{
  Scenario: "Baseline",
  Year: 2025,
  Amount: 288250,
  Account: "Fidelity IRA",
  Module: "Fidelity IRA Module"
}
```

Only non-zero values are inserted to reduce database size.

---

### Income/Expense Modules (FCIncExp)

**Location**: `fcbuilder-incexp.js`

#### Module Document Structure
```javascript
{
  Name: "Base Salary",
  Account: "Salary",
  BaseValue: 150000,    // Starting value
  Growth: 1.0,          // 100% of inflation (keeps pace)
  Changes: [
    { Date: Date("2026-01-01"), Amount: 10, Flag: "P%" },  // 10% increase
    { Date: Date("2028-01-01"), Amount: 5000, Flag: "D" }   // $5000 bonus
  ]
}
```

#### Processing Algorithm

##### 1. Initialize Arrays
```javascript
const yearsCount = endyear - startyear + 1;
const changeDValues = new Array(yearsCount).fill(0);  // Dollar changes
const changePValues = new Array(yearsCount);          // Percentage changes
const incexpValues = new Array(yearsCount);           // Calculated values
const taxValues = new Array(yearsCount).fill(0);
```

##### 2. Calculate Default Percentage Changes
Based on inflation and growth multiplier:
```javascript
const growth = module.Growth ?? 0;  // e.g., 1.0

for (let i = 0, year = startyear; year <= endyear; i++, year++) {
  const idx = year - periodStart;
  changePValues[i] = inflationSeries[idx] * growth;
}
```

**Example**:
- Growth = 1.0 (keep pace with inflation)
- Inflation 2025 = 2.5%
- Inflation 2026 = 2.3%
- changePValues = [2.5, 2.3, ...]

##### 3. Apply Discrete Changes
Override defaults with module-specific changes:
```javascript
if (Array.isArray(module.Changes)) {
  for (let entry of module.Changes) {
    const year = new Date(entry.Date).getFullYear();
    const idx = year - startyear;

    if (entry.Flag[0] === "P") {
      changePValues[idx] = entry.Amount;  // Percentage change
    } else {
      changeDValues[idx] = entry.Amount;  // Dollar change
    }
  }
}
```

##### 4. Calculate Year-over-Year Values

**Year 1**:
```javascript
incexpValues[0] =
  module.BaseValue * (1 + changePValues[0] / 100) + changeDValues[0];
```

**Example**:
```
BaseValue = 150,000
changePValues[0] = 2.5
changeDValues[0] = 0

incexpValues[0] = 150,000 × (1 + 0.025) + 0 = 153,750
```

**Subsequent Years**:
```javascript
for (let i = 1; i < yearsCount; i++) {
  incexpValues[i] =
    incexpValues[i - 1] * (1 + changePValues[i] / 100) + changeDValues[i];
}
```

**Example with 10% increase in Year 2**:
```
incexpValues[1] = 153,750 (from Year 1)
changePValues[2] = 10  (override from Changes)
changeDValues[2] = 0

incexpValues[2] = 153,750 × (1 + 0.10) + 0 = 169,125
```

**Example with $5,000 bonus in Year 4**:
```
incexpValues[3] = 169,125 × (1 + 0.023) = 173,015
changePValues[4] = 2.5 (default inflation)
changeDValues[4] = 5000 (bonus from Changes)

incexpValues[4] = 173,015 × (1 + 0.025) + 5000 = 182,340
```

##### 5. Calculate Taxes
Applied to positive income only (expenses don't generate tax credits):
```javascript
for (let i = 0; i < yearsCount; i++) {
  if (incexpValues[i] > 0) {
    taxValues[i] = -(incexpValues[i] * scenario.TaxRate) / 100;
  }
}
```

##### 6. Calculate Cash Change
```javascript
for (let i = 0; i < yearsCount; i++) {
  cashChange[i] = incexpValues[i] + taxValues[i];
}
```

For income:
```
Income = 150,000
Tax = -37,500 (25%)
Cash Change = 112,500 (net)
```

For expenses (negative values):
```
Expense = -50,000
Tax = 0 (no tax on expenses)
Cash Change = -50,000
```

##### 7. Update df_categories DataFrame

```javascript
// Main account value
df_categories[module.Account][year] = incexpValues[i];

// Special handling for "Taxes" account
if (module.Account === "Taxes") {
  taxValues[i] += incexpValues[i];
}

// Tax category
df_categories["Taxes"][year] += taxValues[i];

// Bank accounts (net cash)
df_categories["Bank Accounts"][year] += cashChange[i];
```

##### 8. Write Audit Trail and Insert Entries
Similar to FCModule processing, creates CSV audit trail and inserts non-zero entries into database.

---

## Data Structures

### DataFrame Structure: df_categories

**Purpose**: Aggregates all module results into a unified forecast view.

**Structure**:
```
Index (Rows)          | Year0  | Year1  | Year2  | ...
---------------------|--------|--------|--------|-----
Bank Accounts        |  1000  |  1100  |  1200  | ...
Transfer - Bank      |     0  |  -500  |   200  | ...
Fidelity IRA         | 265000 | 288250 | 252663 | ...
US - Properties      | 920000 | 935000 | 950000 | ...
Salary               | 150000 | 153750 | 169125 | ...
Dividends            |   5000 |   5533 |   5800 | ...
Property Tax         | -10000 | -10250 | -10506 | ...
Financial Expenses   |  -1300 |  -1383 |  -1450 | ...
Taxes US             | -40000 | -42000 | -44500 | ...
```

**Year0**: Baseline year (year before forecast period starts)
**Year1+**: Forecast years

### DataFrame Structure: df_assumptions

**Purpose**: Provides year-indexed lookup for rates used in calculations.

**Structure**:
```
Year | Inflation | FX - PLN | FX - EUR
-----|-----------|----------|----------
2025 |     2.5   |    4.0   |    0.92
2026 |     2.3   |    4.1   |    0.93
2027 |     2.4   |    4.0   |    0.91
```

---

## Financial Calculations

### Growth Rate Application

**Inflation-Adjusted Growth**:
```
Adjusted Growth = Module Growth × Inflation Rate

Example:
  Module Growth = 5% (0.05)
  Inflation = 2.5% (1.025)
  Adjusted = 0.05 × 1.025 = 5.125%
```

This means the module grows at 5% *in real terms*, adjusted for inflation.

### Income Calculation

**Formula**:
```
Income = Average Market Value × Income Percentage

Average Market Value = (Current Year Market + Previous Year Market) / 2
```

**Why Average?**: Using the average smooths out intra-year fluctuations and provides a more realistic estimate of income earned throughout the year.

**Example**:
```
Year 0 Market = 265,000
Year 1 Market = 288,250
Average = 276,625

Income (2%) = 276,625 × 0.02 = 5,532.50
```

### Realized vs Unrealized Gains

**Unrealized Gain**: Increase in market value due to growth
```
Unrealized Gain = Previous Market Value × Growth Rate
```
- Not taxed until realized
- Affects market value but not cash

**Realized Gain**: Profit from selling/disposing assets
```
Realized Gain = Disposal Proceeds - Cost Basis

Cost Basis = (Disposal Amount / Previous Market Value) × Previous Base Value
```
- Taxed when realized
- Generates cash inflow

**Example**:
```
Previous Base = 260,000
Previous Market = 288,250
Disposal = 50,000

Cost Basis = (50,000 / 288,250) × 260,000 = 45,078
Realized Gain = 50,000 - 45,078 = 4,922
Tax (25%) = -1,230.50
```

### Tax Calculation

**Applied to**:
1. Realized gains (from disposals)
2. Income (dividends, salary, etc.)

**Not applied to**:
1. Unrealized gains
2. Expenses

**Formula**:
```
Tax = -(Taxable Amount × Tax Rate / 100)
```

Negative because it's a cash outflow.

### Foreign Exchange Conversion

**LC to USD**:
```
USD Value = LC Value / FX Rate

Example (PLN to USD):
  LC Value = 1,000,000 PLN
  FX Rate = 4.0 (1 USD = 4 PLN)
  USD Value = 1,000,000 / 4.0 = 250,000 USD
```

**FX Rates**:
- USD currency: FX rate = 1.0 (no conversion)
- PLN currency: Uses "FX - PLN" column from df_assumptions
- EUR currency: Uses "FX - EUR" column from df_assumptions

---

## Audit Trail

### Purpose
Creates detailed CSV files for debugging, analysis, and external reporting.

### File Types

#### 1. Local Currency Files (`*_LC.csv`)
Contains all calculations in the module's native currency (USD, PLN, EUR).

**Columns**:
- FX: Exchange rate for the year
- GrowthPct: Inflation-adjusted growth percentage
- IncomePct: Income percentage for the year (from IncomePct array by Date)
- ExpensePct: Inflation-adjusted expense percentage
- BaseValue: Cost basis value
- MarketValue: Market value including unrealized gains
- UnrealizedGain: Growth in market value
- RealizedGain: Profit from disposals
- Invest: Investment amounts
- Dispose: Disposal amounts (negative)
- [IncomeCategory]: Income generated
- [ExpCategory]: Expenses incurred
- Tax: Tax liability

#### 2. USD Files (`*_USD.csv`)
Same structure as LC files but with all values converted to USD.

#### 3. Entries Files (`*_entries.csv`)
Shows how module values are mapped to the categories DataFrame.

**Columns**: Years
**Rows**: Category names (accounts, income categories, expense categories, taxes, bank accounts)

### File Naming Convention
```
{ScenarioName}_{ModuleName}_{Type}.csv

Examples:
  Baseline_Fidelity_IRA_Module_LC.csv
  Baseline_Fidelity_IRA_Module_USD.csv
  Baseline_Fidelity_IRA_Module_entries.csv
  Baseline_Base_Salary_entries.csv
```

### Storage Location
All audit trail files are stored in:
```
components/data/auditTrail/
```

---

## Flow Diagrams

### Overall Forecast Generation Flow

```
START
  │
  ├─ Load FCAssump.json configuration
  │   ├─ Scenario details (name, period, tax rate)
  │   ├─ Inflation rates by year
  │   ├─ FX rates (PLN, EUR) by year
  │   └─ Category names
  │
  ├─ Create df_assumptions DataFrame
  │   └─ Year-indexed lookup for inflation and FX rates
  │
  ├─ Connect to MongoDB
  │
  ├─ Clear existing FCEntries for scenario
  │
  ├─ Query database for:
  │   ├─ FCModule documents (balance sheet modules)
  │   ├─ FCIncExp documents (income/expense modules)
  │   ├─ Unique category names from modules
  │   └─ Unique account names from modules
  │
  ├─ Build ordered category list
  │   └─ [Bank Accounts, Transfer - Bank, Accounts, Income, Expenses, Taxes]
  │
  ├─ Initialize df_categories DataFrames
  │   ├─ df_categories (for FCModule results)
  │   └─ df_categories2 (for FCIncExp results)
  │
  ├─ Process all modules in parallel ──┐
  │                                     │
  │   ┌───────────────────────────────┘
  │   │
  │   ├─ For each FCModule:
  │   │   ├─ Calculate market values year-over-year
  │   │   ├─ Process investments and disposals
  │   │   ├─ Calculate unrealized gains
  │   │   ├─ Calculate realized gains
  │   │   ├─ Calculate income and expenses
  │   │   ├─ Calculate taxes on realized gains and income
  │   │   ├─ Convert LC to USD
  │   │   ├─ Update df_categories
  │   │   ├─ Write audit trail CSV files
  │   │   └─ Insert FCEntries into database
  │   │
  │   └─ For each FCIncExp:
  │       ├─ Calculate values with inflation-adjusted growth
  │       ├─ Apply discrete changes (percentage or dollar)
  │       ├─ Calculate taxes on income
  │       ├─ Update df_categories2
  │       ├─ Write audit trail CSV file
  │       └─ Insert FCEntries into database
  │
  ├─ Aggregate results from all modules
  │
  └─ Return summary statistics
END
```

### Balance Sheet Module Processing Flow

```
START processModule(FCModule)
  │
  ├─ Extract module configuration
  │   ├─ Base/Market values (LC and USD)
  │   ├─ Currency (USD, PLN, EUR)
  │   ├─ Growth, Income, Expense percentages
  │   ├─ Investment transactions
  │   └─ Disposal transactions
  │
  ├─ Initialize value arrays for all years
  │
  ├─ Load FX rates from df_assumptions
  │
  ├─ Calculate inflation-adjusted percentages
  │   ├─ Growth % = Module Growth × Inflation
  │   ├─ Income % = Module Income % × Inflation
  │   └─ Expense % = Module Expense % × Inflation
  │
  ├─ Map investment transactions to years
  │
  ├─ Map disposal transactions to years
  │
  ├─ Year-over-year calculation loop ────┐
  │   │                                   │
  │   └─ For each year (1 to N):         │
  │       ├─ Unrealized Gain = Prev Market × Growth %
  │       ├─ Disposal Adjustment = (Dispose × Prev Base) / Prev Market
  │       ├─ Base Value = Prev Base + Invest + Disposal Adjustment
  │       ├─ Market Value = Prev Market + Unrealized + Invest + Dispose
  │       └─ Realized Gain = -Dispose + Disposal Adjustment
  │
  ├─ Handle "Full" disposals
  │   └─ Zero out all future years after full disposal
  │
  ├─ Calculate income and expenses
  │   └─ Using average market value for each year
  │
  ├─ Calculate taxes
  │   ├─ On realized gains (if positive)
  │   └─ On income (if positive)
  │
  ├─ Convert all LC values to USD
  │
  ├─ Create df_module_LC DataFrame
  │
  ├─ Create df_module_USD DataFrame
  │
  ├─ Update df_categories rows:
  │   ├─ Account → Market Values
  │   ├─ Transfer - Bank → Net Transfers (Dispose - Invest)
  │   ├─ Income Category → Income Values
  │   ├─ Expense Category → Expense Values
  │   ├─ Taxes US → Tax Values
  │   └─ Bank Accounts → Cash Change (Income + Expense + Tax + Transfers)
  │
  ├─ Write audit trail CSV files
  │   ├─ {scenario}_{module}_LC.csv
  │   ├─ {scenario}_{module}_USD.csv
  │   └─ {scenario}_{module}_entries.csv
  │
  ├─ Insert FCEntries into database
  │   └─ One entry per (Year, Account, Non-Zero Amount)
  │
  └─ Return processing metadata
END
```

### Income/Expense Module Processing Flow

```
START processModule(FCIncExp)
  │
  ├─ Extract module configuration
  │   ├─ Account name (e.g., "Salary", "Property Tax")
  │   ├─ Base value (starting amount)
  │   ├─ Growth multiplier (e.g., 1.0 = 100% of inflation)
  │   └─ Discrete changes array
  │
  ├─ Initialize arrays
  │   ├─ changePValues (percentage changes)
  │   ├─ changeDValues (dollar changes)
  │   ├─ incexpValues (calculated values)
  │   └─ taxValues (tax calculations)
  │
  ├─ Calculate default percentage changes
  │   └─ changeP = Inflation × Growth
  │
  ├─ Apply discrete changes from module
  │   ├─ If Flag = "P%" → Override changePValues
  │   └─ If Flag = "D" → Set changeDValues
  │
  ├─ Calculate Year 1 value
  │   └─ Value = BaseValue × (1 + changeP/100) + changeD
  │
  ├─ Calculate subsequent years ────┐
  │   │                              │
  │   └─ For each year (2 to N):    │
  │       └─ Value = PrevValue × (1 + changeP/100) + changeD
  │
  ├─ Calculate taxes
  │   └─ If Value > 0: Tax = -(Value × TaxRate / 100)
  │
  ├─ Calculate cash change
  │   └─ CashChange = Value + Tax
  │
  ├─ Update df_categories rows:
  │   ├─ Account → IncExp Values
  │   ├─ Taxes → Tax Values
  │   └─ Bank Accounts → Cash Change
  │
  ├─ Write audit trail CSV file
  │   └─ {scenario}_{account}_entries.csv
  │
  ├─ Insert FCEntries into database
  │
  └─ Return processing metadata
END
```

---

## Key Design Decisions

### 1. Parallel Module Processing
Each module receives its own temporary DataFrame to avoid race conditions. Results are aggregated after all modules complete.

### 2. Zero-Value Filtering
Only non-zero amounts are inserted into FCEntries to reduce database size and improve query performance.

### 3. Inflation-Adjusted Percentages
All growth, income, and expense percentages are multiplied by inflation rates to maintain real purchasing power.

### 4. Average Market Value for Income
Income and expenses use the average of current and previous year market values to smooth intra-year fluctuations.

### 5. Proportional Disposal Adjustments
When disposing assets, the cost basis is reduced proportionally to maintain accurate gain/loss calculations.

### 6. Tax on Positive Values Only
Taxes are only applied to positive realized gains and income. Unrealized gains and expenses do not generate tax liabilities or credits.

### 7. FX Conversion
All final values are converted to USD for consistent reporting, even if calculated in PLN or EUR.

---

## Common Scenarios

### Scenario 1: Retirement Account with Contributions
```javascript
{
  Account: "401k",
  BaseValue: 500000,
  Growth: 0.07,           // 7% real growth
  IncomePct: [],          // No income
  ExpensePct: 0.001,      // 0.1% fees
  Invest: [
    { Date: "2025-12-31", Amount: 20000 },
    { Date: "2026-12-31", Amount: 20000 }
  ]
}
```

**Result**: Account grows at 7% (inflation-adjusted), receives annual $20k contributions, and incurs 0.1% annual fees.

### Scenario 2: Rental Property
```javascript
{
  Account: "Rental Property",
  BaseValue: 500000,
  MarketValue: 600000,
  Growth: 0.03,           // 3% appreciation
  IncomePct: [            // 5% rental yield increasing over time
    { Date: "2025-01-01", Value: 0.05 },
    { Date: "2027-01-01", Value: 0.055 }
  ],
  ExpensePct: 0.02,       // 2% expenses (property tax, maintenance)
  IncomeCategory: "Rental Income",
  ExpCategory: "Property Expenses"
}
```

**Result**: Property appreciates 3%, generates 5% rental income, and incurs 2% expenses annually.

### Scenario 3: Salary with Raises
```javascript
{
  Account: "Salary",
  BaseValue: 150000,
  Growth: 1.0,            // Keep pace with inflation
  Changes: [
    { Date: "2026-01-01", Amount: 10, Flag: "P%" },     // 10% raise
    { Date: "2027-01-01", Amount: 3, Flag: "P%" },      // 3% raise
    { Date: "2028-12-31", Amount: 20000, Flag: "D" }    // $20k bonus
  ]
}
```

**Result**: Salary grows with inflation, receives specified raises in 2026/2027, and a one-time $20k bonus in 2028.

---

## Error Handling

### NaN Detection in Base Values
The system validates base value calculations and provides detailed diagnostics:
```javascript
if (Number.isNaN(baseValues[i])) {
  console.warn(`BaseValue becomes NaN in year ${year}: ${cause}`);
  console.warn(`Inputs: prevBase=${prevBase}, prevMarket=${prevMarket}, invest=${invest}, dispose=${dispose}`);
}
```

Common causes:
1. Initial BaseValue is missing or NaN
2. Previous market value is 0 (division by zero in disposal adjustment)
3. Non-finite invest or dispose entries

### Database Connection Failures
If MongoDB connection fails, the system returns an error result with diagnostic information:
```javascript
{
  success: false,
  scenario: scenarioName,
  error: error.message,
  durationMs: processingTime
}
```

### Missing Configuration
If scenario or assumptions are not found, clear errors are thrown during configuration loading with guidance on what's missing.

---

## Performance Optimizations

### 1. Parallel Processing
All modules process simultaneously using `Promise.all()`, significantly reducing total processing time.

### 2. Pre-allocated Arrays
Arrays are pre-allocated with `new Array(size)` instead of using `push()` for better memory efficiency.

### 3. Zero-Value Filtering
Only non-zero amounts are inserted into the database, reducing database size by ~50-70% in typical scenarios.

### 4. Lean Queries
Database queries use `.lean()` to return plain JavaScript objects instead of Mongoose documents, reducing memory overhead.

### 5. Batch Inserts
All entries are inserted using `insertMany()` instead of individual inserts, reducing database round trips.

---

## Future Enhancement Opportunities

1. **Multi-Currency Support**: Currently converts everything to USD; could support reporting in other currencies
2. **Quarterly/Monthly Periods**: Currently year-based; could support finer time granularity
3. **Scenario Comparison**: Built-in tools for comparing multiple scenarios side-by-side
4. **Probabilistic Forecasting**: Monte Carlo simulations for risk analysis
5. **Tax Optimization**: Automated suggestions for tax-loss harvesting and timing of disposals
6. **Custom Formulas**: User-defined calculation logic for specialized modules

---

## Glossary

**Base Value**: Original cost basis of an asset, used to calculate realized gains
**Market Value**: Current fair market value of an asset, including unrealized gains
**Unrealized Gain**: Increase in market value that hasn't been realized through sale
**Realized Gain**: Profit from selling an asset (market value - cost basis)
**LC (Local Currency)**: The currency in which the asset is denominated (USD, PLN, EUR)
**FX Rate**: Foreign exchange rate for converting LC to USD
**Inflation-Adjusted**: Multiplied by inflation rate to maintain real purchasing power
**df_categories**: DataFrame containing aggregated forecast results across all modules
**df_assumptions**: DataFrame containing inflation and FX rates indexed by year
**FCModule**: Balance sheet module tracking assets and investments
**FCIncExp**: Income/expense module tracking recurring cash flows
**FCEntries**: Database collection storing individual forecast entries
**Audit Trail**: CSV files providing detailed calculation breakdown for debugging

---

**Document Version**: 1.0
**Last Updated**: 2025-12-29
**Author**: Auto-generated from source code analysis
