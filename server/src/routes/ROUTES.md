# API Routes Documentation

This document provides comprehensive documentation for all API routes/endpoints in the server application.

## Table of Contents

1. [Health Check](#health-check)
2. [Utility Routes](#utility-routes)
3. [Chart of Accounts (COA)](#chart-of-accounts-coa)
4. [Cash Flow](#cash-flow)
5. [Balance Sheet](#balance-sheet)
6. [Budget](#budget)
7. [PS Data Ingestion](#ps-data-ingestion)
8. [Forecast](#forecast)

---

## Health Check

**Base Path:** `/health`

### GET /health

Health check endpoint to verify server status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

---

## Utility Routes

**Base Path:** `/util`

### GET /util

Get utility service status and file paths summary.

**Response:**
```json
{
  "status": "util-service",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "paths": {
    "dataDirectory": "/path/to/data",
    "tempDirectory": "/path/to/temp",
    "dataPaths": { ... },
    "tempFiles": { ... }
  }
}
```

### GET /util/getappdata

Fetch all application data from MongoDB.

**Response:**
```json
[
  { "key": "value", ... }
]
```

### POST /util/appdata

Update or insert application data entries.

**Request Body:**
```json
{
  "updates": [
    { "key": "lastRefresh", "value": "2024-01-15" },
    { "key": "setting1", "value": true }
  ]
}
```

**Response:**
```json
{
  "updatedKeys": ["lastRefresh", "setting1"]
}
```

### GET /util/paths

Get data and temporary directory paths.

**Response:**
```json
{
  "dataDirectory": "/path/to/data",
  "tempDirectory": "/path/to/temp",
  "dataPaths": { ... },
  "tempFiles": { ... }
}
```

### POST /util/ensure-data-dir

Ensure components data directory exists.

**Response:**
```json
{
  "ensured": true,
  "path": "/path/to/data"
}
```

### POST /util/ensure-temp-dir

Ensure temporary directory exists.

**Response:**
```json
{
  "ensured": true,
  "path": "/path/to/temp"
}
```

### POST /util/fc-setup/periods

Save forecast period setup configuration.

**Request Body:**
```json
{
  "periods": [
    { "key": "2024-01", "type": "B" },
    { "key": "2024-02", "type": "F" }
  ]
}
```

**Response:**
```json
{
  "periodsUpdated": 2,
  "path": "/path/to/fc_setup.json"
}
```

### GET /util/exchange-rate

Get exchange rate from USD to specified currency.

**Query Parameters:**
- `currency` (required): Currency code (e.g., "EUR", "GBP")
- `date` (optional): Date for historical rate (YYYY-MM-DD)

**Example:** `/util/exchange-rate?currency=EUR&date=2024-01-15`

**Response:**
```json
{
  "baseCurrency": "USD",
  "quoteCurrency": "EUR",
  "asOfDate": "2024-01-15",
  "rate": 0.92
}
```

### GET /util/currencies

Get list of all currencies in PS data.

**Response:**
```json
{
  "currencies": ["EUR", "GBP", "USD"]
}
```

---

## Chart of Accounts (COA)

**Base Path:** `/coa`

### GET /coa/BalanceSheet

Get Balance Sheet accounts from COA.

**Response:**
```json
{
  "Assets": [...],
  "Liabilities": [...],
  "Equity": [...]
}
```

### GET /coa/CashFlow

Get Profit & Loss accounts from COA.

**Response:**
```json
{
  "Income": [...],
  "Expense": [...]
}
```

---

## Cash Flow

**Base Path:** `/cashFlow`

### GET /cashFlow

Generate cash flow report for a date range.

**Query Parameters:**
- `fromDate` (required): Start date (ISO format)
- `toDate` (required): End date (ISO format)
- `transfers` (optional): "include", "only", or "exclude" (default: "exclude")
- `includeUnrealizedGL` (optional): "true" or "false" (default: "false")

**Example:** `/cashFlow?fromDate=2024-01-01&toDate=2024-12-31&transfers=exclude`

**Response:**
```json
{
  "categories": [...],
  "totals": { ... },
  "summary": { ... }
}
```

### GET /cashFlow/transactions

Get transactions for specific categories within a date range.

**Query Parameters:**
- `fromDate` (required): Start date
- `toDate` (required): End date
- `category` or `categories` (required): Category name(s) (comma-separated or array)
- `limit` (optional): Max results (default: unlimited, max: 2000)

**Example:** `/cashFlow/transactions?fromDate=2024-01-01&toDate=2024-12-31&categories=Salary,Bonus&limit=100`

**Response:**
```json
{
  "transactions": [
    {
      "Date": "2024-01-15T00:00:00.000Z",
      "Category": "Salary",
      "Amount": 5000,
      ...
    }
  ]
}
```

---

## Balance Sheet

**Base Path:** `/balance`

### GET /balance

Generate balance sheet report as of a specific date.

**Query Parameters:**
- `asOfDate` (required): Report date (ISO format)

**Example:** `/balance?asOfDate=2024-12-31`

**Response:**
```json
{
  "assets": { ... },
  "liabilities": { ... },
  "equity": { ... },
  "asOfDate": "2024-12-31T00:00:00.000Z"
}
```

---

## Budget

**Base Path:** `/budget`

### Budget Entries

#### GET /budget

Retrieve budget entries with optional filters.

**Query Parameters:**
- `fromDate` (optional): Start date
- `toDate` (optional): End date
- `account` (optional): Account name(s)
- `category` (optional): Category name(s)
- `currency` (optional): Currency code(s)
- `baseCurrency` (optional): Base currency code(s)
- `limit` (optional): Max results (default: 500, max: 2000)

**Example:** `/budget?fromDate=2024-01-01&toDate=2024-12-31&category=Salary&limit=100`

**Response:**
```json
[
  {
    "_id": "...",
    "Date": "2024-01-01T00:00:00.000Z",
    "Account": "...",
    "Category": "...",
    "Amount": 1000,
    "BaseAmount": 1000,
    ...
  }
]
```

#### POST /budget

Create new budget entry/entries.

**Request Body:**
```json
{
  "entries": [
    {
      "Date": "2024-01-01",
      "Account": "Checking",
      "Category": "Salary",
      "Amount": 5000,
      "Currency": "USD",
      "BaseAmount": 5000,
      "BaseCurrency": "USD"
    }
  ]
}
```

**Response:**
```json
{
  "insertedCount": 1
}
```

#### PATCH /budget/:id

Update a specific budget entry by ID.

**Parameters:**
- `id`: MongoDB ObjectId

**Request Body:**
```json
{
  "Amount": 5500,
  "Note": "Updated amount"
}
```

**Response:**
```json
{
  "entry": { ... }
}
```

#### DELETE /budget/:id

Delete a budget entry by ID.

**Parameters:**
- `id`: MongoDB ObjectId

**Response:**
```json
{
  "deleted": true
}
```

### Actual Entries

#### GET /budget/actual-entries

Retrieve actual (non-budget) financial entries with filters.

**Query Parameters:**
- `month` (optional): Specific month (1-12), overrides fromMonth/toMonth
- `fromMonth` (optional): Starting month (1-12, default: 1)
- `toMonth` (optional): Ending month (1-12, default: 12)
- `actualYear` (optional): Year (default: current year)
- `categories` or `category` (optional): Category name(s)
- `accounts` or `account` (optional): Account name(s)
- `description` (optional): Search in description fields
- `valueFrom` (optional): Minimum BaseAmount
- `valueTo` (optional): Maximum BaseAmount
- `limit` (optional): Max results (default: 500, max: 2000)

**Example:** `/budget/actual-entries?month=6&actualYear=2024&categories=Groceries,Dining&valueFrom=50&valueTo=500`

**Response:**
```json
{
  "entries": [...]
}
```

#### PATCH /budget/actual-entries/:id

Update an actual entry by ID.

**Parameters:**
- `id`: MongoDB ObjectId

**Request Body:**
```json
{
  "Category": "Updated Category",
  "Note": "Corrected entry"
}
```

**Response:**
```json
{
  "entry": { ... }
}
```

#### DELETE /budget/actual-entries/:id

Delete an actual entry by ID.

**Parameters:**
- `id`: MongoDB ObjectId

**Response:**
```json
{
  "deleted": true
}
```

### Analysis & Reporting

#### GET /budget/summary

Get budget vs actual summary by month.

**Query Parameters:**
- `fromMonth` (optional): Starting month (1-12, default: 1)
- `toMonth` (optional): Ending month (1-12, default: 12)
- `actualYear` (optional): Year for actual data (default: current year)
- `budgetYear` (optional): Year for budget data (default: current year)
- `categories` or `category` (optional): Filter by category
- `accounts` or `account` (optional): Filter by account

**Example:** `/budget/summary?fromMonth=1&toMonth=12&actualYear=2024&budgetYear=2024&categories=Salary,Bonus`

**Response:**
```json
{
  "months": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  "fromMonth": 1,
  "toMonth": 12,
  "actualYear": 2024,
  "budgetYear": 2024,
  "actualByMonth": {
    "1": 5000,
    "2": 5200,
    ...
  },
  "budgetByMonth": {
    "1": 5000,
    "2": 5000,
    ...
  }
}
```

#### GET /budget/cash-flow

Generate cash flow report for budget data.

**Query Parameters:**
- `fromDate` (required): Start date
- `toDate` (required): End date
- `transfers` (optional): "include", "only", or "exclude" (default: "exclude")
- `includeUnrealizedGL` (optional): "true" or "false" (default: "false")

**Example:** `/budget/cash-flow?fromDate=2024-01-01&toDate=2024-12-31`

**Response:**
```json
{
  "categories": [...],
  "totals": { ... }
}
```

#### GET /budget/category-groups

Get Income and Expense category groups from COA.

**Response:**
```json
{
  "Income": ["Salary", "Bonus", "Investment Income", ...],
  "Expense": ["Rent", "Utilities", "Groceries", ...]
}
```

---

## PS Data Ingestion

**Base Path:** `/ingestPs`

### POST /ingestPs

Ingest PS transactions from CSV into MongoDB.

**Response:**
```json
{
  "insertedCount": 150,
  "skippedCount": 10,
  "updatedCount": 5
}
```

### POST /ingestPs/clearall

Clear all PS records from MongoDB.

**Response:**
```json
{
  "cleared": true
}
```

### POST /ingestPs/upload-ps

Upload PS CSV file to server.

**Request Body:** Raw CSV content (text/csv)

**Response:**
```json
{
  "message": "Payroll file saved to components/data/ps-transactions.csv",
  "size": 12345
}
```

### GET /ingestPs/analyze-ps

Analyze PS data for missing/unknown accounts and categories.

**Response:**
```json
{
  "misAcct": ["Account1", "Account2"],
  "missCOAact": ["COAAccount1"],
  "misCat": ["Category1"],
  "missCOACat": ["COACategory1"]
}
```

### POST /ingestPs/analyze-ps

Same as GET version - analyzes PS data.

### GET /ingestPs/psdata/count

Get count of PS data records in MongoDB.

**Response:**
```json
{
  "count": 1523
}
```

### GET /ingestPs/psdata/options

Get available accounts and categories from PS data.

**Response:**
```json
{
  "accounts": ["Checking", "Savings", "Credit Card", ...],
  "categories": ["Salary", "Groceries", "Utilities", ...]
}
```

### POST /ingestPs/appdata/last-refresh

Update last refresh timestamp in appdata.

**Response:**
```json
{
  "matchedCount": 1,
  "modifiedCount": 1,
  "upsertedCount": 0,
  "upsertedId": null,
  "lastRefresh": "2024-01-15T12:00:00.000Z"
}
```

### GET /ingestPs/new-transactions

Get newly imported transactions from last refresh.

**Response:**
```json
[
  {
    "Date": "2024-01-15T00:00:00.000Z",
    "Category": "Groceries",
    "Amount": 125.50,
    ...
  }
]
```

### GET /ingestPs/modified-transactions

Get modified transactions from last refresh.

**Response:**
```json
[
  {
    "Date": "2024-01-10T00:00:00.000Z",
    "Category": "Updated Category",
    ...
  }
]
```

### POST /ingestPs/refresh-ps

Refresh PS data from external source.

**Request Body:**
```json
{
  "daysHistory": 30
}
```

**Response:**
```json
{
  "newCount": 15,
  "modifiedCount": 3
}
```

---

## Forecast

**Base Path:** `/forecast`

### Forecast Modules

#### GET /forecast/modules

Retrieve all forecast modules.

**Response:**
```json
[
  {
    "_id": "...",
    "Scenario": "Base Case",
    "Module": "Revenue",
    "Account": "Sales",
    ...
  }
]
```

#### GET /forecast/modules/unmatched

Get unmatched accounts for a scenario.

**Query Parameters:**
- `scenario` (required): Scenario name

**Example:** `/forecast/modules/unmatched?scenario=Base%20Case`

**Response:**
```json
[
  {
    "Account": "Unmatched Account 1",
    "Category": "...",
    ...
  }
]
```

#### POST /forecast/modules

Create new forecast module(s).

**Request Body:**
```json
{
  "modules": [
    {
      "Scenario": "Base Case",
      "Module": "Revenue",
      "Account": "Sales",
      "BaseValue": 100000,
      "BaseValueUSD": 100000,
      ...
    }
  ]
}
```

**Response:**
```json
{
  "insertedCount": 1
}
```

#### PUT /forecast/modules/:id

Update a forecast module by ID.

**Parameters:**
- `id`: MongoDB ObjectId

**Request Body:**
```json
{
  "BaseValue": 120000,
  "Note": "Updated forecast"
}
```

**Response:**
```json
{
  "module": { ... }
}
```

#### DELETE /forecast/modules/:id

Delete a forecast module by ID.

**Parameters:**
- `id`: MongoDB ObjectId

**Response:**
```json
{
  "deleted": true
}
```

### Forecast Assumptions

#### GET /forecast/assumptions

Retrieve entire FCAssump.json file.

**Response:**
```json
{
  "scenarios": [...],
  "growthRates": [...],
  "assumptions": { ... }
}
```

#### GET /forecast/assumptions/sections/:sections

Get specific sections from FCAssump.json (comma-separated).

**Parameters:**
- `sections`: Comma-separated section names

**Example:** `/forecast/assumptions/sections/revenue,expenses`

**Response:**
```json
{
  "revenue": [...],
  "expenses": [...]
}
```

#### PUT /forecast/assumptions

Replace entire FCAssump.json file.

**Request Body:**
```json
{
  "scenarios": [...],
  "assumptions": { ... }
}
```

**Response:**
```json
{
  "replaced": true
}
```

#### POST /forecast/assumptions/:section

Append new entry to an array section.

**Parameters:**
- `section`: Section name

**Request Body:**
```json
{
  "name": "New Scenario",
  "description": "..."
}
```

**Response:**
```json
{
  "section": "scenarios",
  "index": 2
}
```

#### PUT /forecast/assumptions/:section/:index

Update specific entry in array section.

**Parameters:**
- `section`: Section name
- `index`: Array index (0-based)

**Request Body:**
```json
{
  "name": "Updated Scenario",
  "description": "..."
}
```

**Response:**
```json
{
  "updated": true,
  "section": "scenarios",
  "index": 1
}
```

#### DELETE /forecast/assumptions/:section/:index

Delete specific entry from array section.

**Parameters:**
- `section`: Section name
- `index`: Array index (0-based)

**Response:**
```json
{
  "deleted": true,
  "removed": { ... }
}
```

### Forecast Income/Expense

#### GET /forecast/incomeexpense

Retrieve income/expense entries.

**Query Parameters:**
- `scenario` (optional): Filter by scenario name

**Example:** `/forecast/incomeexpense?scenario=Base%20Case`

**Response:**
```json
{
  "entries": [...]
}
```

#### POST /forecast/incomeexpense

Create income/expense entries.

**Request Body:**
```json
{
  "items": [
    {
      "Scenario": "Base Case",
      "Category": "Revenue",
      "Amount": 50000,
      ...
    }
  ]
}
```

**Response:**
```json
{
  "insertedCount": 1
}
```

#### PUT /forecast/incomeexpense/:id

Update an income/expense entry by ID.

**Parameters:**
- `id`: MongoDB ObjectId

**Request Body:**
```json
{
  "Amount": 55000,
  "Note": "Updated"
}
```

**Response:**
```json
{
  "entry": { ... }
}
```

#### DELETE /forecast/incomeexpense/:id

Delete an income/expense entry by ID.

**Parameters:**
- `id`: MongoDB ObjectId

**Response:**
```json
{
  "deleted": true
}
```

### Forecast Scenarios

#### GET /forecast/scenarios

List all distinct scenarios.

**Response:**
```json
{
  "scenarios": ["Base Case", "Best Case", "Worst Case"]
}
```

#### GET /forecast/scenarios/years/:scenario

Get distinct years for a scenario.

**Parameters:**
- `scenario`: Scenario name

**Example:** `/forecast/scenarios/years/Base%20Case`

**Response:**
```json
{
  "years": [2024, 2025, 2026]
}
```

#### GET /forecast/scenarios/accounts/:scenario

Get distinct accounts for a scenario.

**Parameters:**
- `scenario`: Scenario name

**Response:**
```json
{
  "accounts": ["Sales", "COGS", "Operating Expenses", ...]
}
```

#### GET /forecast/scenarios/modules/:scenario

Get distinct modules for a scenario.

**Parameters:**
- `scenario`: Scenario name

**Response:**
```json
{
  "modules": ["Revenue", "Expenses", "Cash", ...]
}
```

#### DELETE /forecast/scenarios/:scenario

Delete all modules and income/expense rows for a scenario.

**Parameters:**
- `scenario`: Scenario name

**Response:**
```json
{
  "deleted": true,
  "modulesDeleted": 25,
  "incomeExpensesDeleted": 150
}
```

#### POST /forecast/scenarios/:scenario/copy

Copy a scenario and all its related data to a new scenario.

Copies all FCModule and FCIncExp database entries from the source scenario to a new scenario with the specified name. The frontend is responsible for copying scenario assumptions (inflation, FX rates, tax rates, period configuration) from FCAssump.json.

**Parameters:**
- `scenario`: Source scenario name to copy from (URL-encoded)

**Request Body:**
```json
{
  "newScenarioName": "Q1 2025 Forecast"
}
```

**Response:**
```json
{
  "copied": true,
  "sourceScenario": "Base Case",
  "newScenario": "Q1 2025 Forecast",
  "modulesCopied": 25,
  "incomeExpensesCopied": 150
}
```

**Error Responses:**
- `400` - Missing source scenario name or new scenario name
- `500` - Database operations failed

### Forecast Entries

#### GET /forecast/entries

Retrieve forecast entries.

**Query Parameters:**
- `scenario` (optional): Filter by scenario name

**Response:**
```json
{
  "entries": [...]
}
```

### Forecast Generation

#### POST /forecast/generate/:scenario

Generate complete forecast for a scenario.

**Parameters:**
- `scenario`: Scenario name

**Response:**
```json
{
  "message": "Forecast generation completed",
  "scenario": "Base Case",
  "deletedCount": 200,
  "modulesProcessed": 25,
  "entriesCreated": 300,
  "durationMs": 1523
}
```

### Audit Trail

#### GET /forecast/audittrail/:scenario/:module

Retrieve the audit trail CSV file for a specific scenario and module combination. The endpoint performs case-insensitive file matching to locate audit trail files.

**Parameters:**
- `scenario`: Scenario name (e.g., "2025_Base")
- `module`: Module name (e.g., "Fidelity_IRA")

**Example:** `/forecast/audittrail/2025_Base/Fidelity_IRA`

**Response:**
```json
{
  "headers": ["Account", "Year", "Amount", "Note"],
  "rows": [
    {
      "Account": "Fidelity IRA",
      "Year": "2025",
      "Amount": "50000",
      "Note": "Annual contribution"
    }
  ]
}
```

**Error Responses:**
- `400` - Missing scenario or module parameter
- `404` - Audit trail file not found or directory doesn't exist
- `500` - File read or CSV parse error

**Notes:**
- File names are expected to follow the pattern: `{scenario}_{module}_entries.csv`
- The endpoint normalizes input parameters to match file naming conventions (underscores, lowercase)
- File matching is case-insensitive to handle various file naming conventions
- Empty files return `{ headers: [], rows: [] }`

---

## Error Responses

All endpoints return standard error responses in the following format:

```json
{
  "error": "Error message describing what went wrong"
}
```

Common HTTP status codes:
- `400` - Bad Request (invalid parameters or missing required fields)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error (server-side error)

---

## Notes

- All dates should be in ISO 8601 format (e.g., "2024-01-15T00:00:00.000Z" or "2024-01-15")
- MongoDB ObjectIds are 24-character hexadecimal strings
- Query parameters can be single values or arrays (comma-separated or multiple parameters with same name)
- Default limits are in place for most list endpoints to prevent large responses
- Most POST/PUT/PATCH endpoints accept both single objects and arrays

---

**Last Updated:** 2024-12-29
