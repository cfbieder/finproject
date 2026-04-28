# Phase 2 Architecture Guide

This guide documents the Phase 2 additions to the frontend architecture: shared utilities, contexts, and refactoring patterns.

## Table of Contents
- [Shared Utilities](#shared-utilities)
- [Context Providers](#context-providers)
- [Updated Path Aliases](#updated-path-aliases)
- [Migration Patterns](#migration-patterns)

---

## Shared Utilities

All utilities are available in `src/utils/` and can be imported using the `@utils` alias.

### Tree Traversal Utilities

```javascript
import {
  collectCollapsiblePaths,
  buildAccountValueMap,
  collectLeafNames,
  findNodeByPath
} from '@utils';
```

#### collectCollapsiblePaths
Collects paths to all expandable nodes in a tree structure.

```javascript
const accounts = [
  { name: 'Assets', children: [{ name: 'Cash' }, { name: 'Receivables' }] },
  { name: 'Liabilities', children: [] }
];

const paths = collectCollapsiblePaths(accounts);
// Returns Set(['Assets']) - only Assets has children
```

#### buildAccountValueMap
Creates a path-to-value lookup map for account hierarchies.

```javascript
const accounts = [
  {
    name: 'Assets',
    totalUSD: 1000,
    children: [{ name: 'Cash', totalUSD: 500 }]
  }
];

const map = buildAccountValueMap(accounts);
map.get('Assets');       // 1000
map.get('Assets>Cash');  // 500
```

### Date Helpers

```javascript
import {
  formatLocalDate,
  getToday,
  getYearStart,
  getMonthStart,
  getMonthEnd,
  parseMonthYear,
  buildDateFromMonthYear,
  getMonthOptions,
  getYearOptions,
  getYearOptionsAroundNow
} from '@utils';
```

#### Common Date Operations

```javascript
// Get current dates
const today = getToday();                    // '2024-01-15'
const yearStart = getYearStart();            // '2024-01-01'
const monthStart = getMonthStart();          // '2024-01-01'
const monthEnd = getMonthEnd();              // '2024-01-31'

// Format dates
const formatted = formatLocalDate(new Date()); // '2024-01-15'

// Parse dates
const { month, year } = parseMonthYear('2024-03-15');
// month: '03', year: '2024'

// Build dates
const date = buildDateFromMonthYear('03', '2024');
// '2024-03-01'
```

#### Dropdown Options

```javascript
// Get month options for dropdowns
const months = getMonthOptions();
// [{ value: '01', label: 'January' }, ...]

// Get year range
const years = getYearOptions(2020, 2025);
// ['2020', '2021', '2022', '2023', '2024', '2025']

// Get years around current year
const recentYears = getYearOptionsAroundNow(2, 2);
// If 2024: ['2022', '2023', '2024', '2025', '2026']
```

### Formatters

```javascript
import {
  formatCurrency,
  formatPercentage,
  formatRate,
  formatFxRate,
  formatNumber,
  formatCompactNumber,
  parseCurrency
} from '@utils';
```

#### Currency Formatting

```javascript
formatCurrency(1234.56);    // '$1,234.56'
formatCurrency(-1234.56);   // '($1,234.56)'  - negative in parentheses
formatCurrency(null);       // '$0.00'
```

#### Percentage and Rate Formatting

```javascript
formatPercentage(0.1534);       // '15.34%'
formatPercentage(0.1534, 1);    // '15.3%'

formatRate(2.5);                // '2.50%'
formatRate(2.567);              // '2.57%'

formatFxRate(1.2345);           // '1.2345'
formatFxRate(1.23, 2);          // '1.23'
```

#### Number Formatting

```javascript
formatNumber(1234567);          // '1,234,567'
formatNumber(1234.567, 2);      // '1,234.57'

formatCompactNumber(1234);      // '1.2K'
formatCompactNumber(1234567);   // '1.2M'
formatCompactNumber(1.2e9);     // '1.2B'
```

#### Parsing

```javascript
parseCurrency('$1,234.56');     // 1234.56
parseCurrency('($1,234.56)');   // -1234.56
```

### Cash Flow Helpers

```javascript
import { addNetCashFlowCategory, buildCashFlowValueMap } from '@utils';
```

#### Add Net Cash Flow

```javascript
const nodes = [
  { name: 'Income', total: 5000 },
  { name: 'Expenses', total: -3000 }
];

const withNet = addNetCashFlowCategory(nodes);
// Returns original array plus:
// { name: 'Net cash flow', total: 2000 }
```

#### Build Value Maps

```javascript
const nodes = [
  {
    name: 'Income',
    total: 5000,
    children: [{ name: 'Salary', total: 5000 }]
  }
];

const map = buildCashFlowValueMap(nodes);
map.get('Income');         // 5000
map.get('Income>Salary');  // 5000
```

### Forecast Helpers

```javascript
import {
  parseLevelAccounts,
  aggregateForecastEntries,
  calculateNetCashFlow,
  formatTableCell
} from '@utils';
```

#### Parse Account Levels

```javascript
const coa = [
  {
    'Assets': [
      { 'Current Assets': ['Cash', 'Receivables'] }
    ]
  }
];

const { rows, mapping } = parseLevelAccounts(coa, true);

// rows: Flat structure with levels
// [
//   { label: 'Assets', level: 1 },
//   { label: 'Current Assets', level: 2 }
// ]

// mapping: Leaf to parent mapping
// Map('Cash' -> { level1: 'Assets', level2: 'Current Assets' })
```

#### Aggregate Forecast Entries

```javascript
const entries = [
  { Account: 'Salaries', '2024': 50000, '2025': 52000 }
];

const accountMap = new Map([
  ['Salaries', { level1: 'Expense', level2: 'Personnel' }]
]);

const { level1, level2, level3 } = aggregateForecastEntries(
  entries,
  accountMap,
  [2024, 2025]
);

// level1.get('Expense') -> { '2024': 50000, '2025': 52000 }
// level2.get('Personnel') -> { '2024': 50000, '2025': 52000 }
// level3.get('Salaries') -> { '2024': 50000, '2025': 52000 }
```

#### Calculate Net Cash Flow

```javascript
const level1Map = new Map([
  ['Income', { '2024': 100000, '2025': 110000 }],
  ['Expense', { '2024': -60000, '2025': -65000 }]
]);

const net = calculateNetCashFlow(level1Map, [2024, 2025]);
// { '2024': 40000, '2025': 45000 }
```

#### Format Table Cells

```javascript
const positive = formatTableCell(1000, 'cell');
// { value: '1,000', className: 'cell' }

const negative = formatTableCell(-500, 'cell');
// { value: '(500)', className: 'cell cell--negative' }
```

---

## Context Providers

### Forecast Context

The Forecast Context provides shared state for all forecast-related pages, eliminating duplicate API calls and ensuring data consistency.

#### Setup

Forecast routes are automatically wrapped with ForecastProvider in App.jsx:

```javascript
// Already configured in App.jsx
<Route path="/forecast-scenarios" element={
  <ForecastProvider>
    <FCScenarios />
  </ForecastProvider>
} />
```

#### Using the Context

```javascript
import { useForecast } from '@/contexts';

function MyForecastComponent() {
  const {
    // Data
    assumptions,        // Full assumptions object
    scenarios,          // Array of scenarios
    periodStart,        // Forecast start date
    periodEnd,          // Forecast end date

    // Loading states
    isLoadingAssumptions,
    assumptionsError,

    // Methods
    loadAssumptions,    // Reload assumptions
    refreshAssumptions, // Refresh after changes
    getScenarioByName,  // Find scenario by name
    hasScenario         // Check if scenario exists
  } = useForecast();

  // Use shared state - no need to fetch
  return (
    <div>
      {isLoadingAssumptions ? (
        <p>Loading...</p>
      ) : (
        <select>
          {scenarios.map(s => (
            <option key={s.Name} value={s.Name}>
              {s.Name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
```

#### When to Use

Use `useForecast()` in any component that needs:
- List of scenarios
- Forecast period dates
- Forecast assumptions
- Scenario validation

**Benefits:**
- No duplicate API calls
- Consistent data across pages
- Automatic updates when scenarios change
- Cleaner component code

#### Error Handling

```javascript
const { assumptions, assumptionsError, loadAssumptions } = useForecast();

if (assumptionsError) {
  return (
    <div>
      <p>Error: {assumptionsError}</p>
      <button onClick={loadAssumptions}>Retry</button>
    </div>
  );
}
```

---

## Updated Path Aliases

Phase 2 added new aliases and reorganized existing ones:

```javascript
// Root and structure
@           → ./src                  // Root src directory
@components → ./src/components       // Shared UI components
@features   → ./src/features         // Feature-based components
@pages      → ./src/pages            // Page components

// Phase 2: Separated utils and lib
@utils      → ./src/utils            // NEW: Shared utilities
@lib        → ./src/js               // UPDATED: Libraries (Rest, etc.)

// Resources
@assets     → ./src/assets           // Static assets
@data       → ./components/data      // Data files (COA, etc.)
```

### Usage Examples

```javascript
// Import utilities (Phase 2)
import { formatCurrency, getToday } from '@utils';

// Import custom hooks (Phase 1)
import { useModal, useAPI } from '@/hooks';

// Import contexts (Phase 2)
import { useForecast } from '@/contexts';

// Import libraries
import Rest from '@lib/rest';

// Import components
import NavigationMenu from '@components/NavigationMenu';
import BalanceReport from '@features/Balances/BalanceReport';

// Import data
import coa from '@data/coa.json';
```

---

## Migration Patterns

### Pattern 1: Replace Inline Utilities

**Before:**
```javascript
// Duplicate utility function in component
const formatCurrency = (value) => {
  const amount = value ?? 0;
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });
  return amount < 0
    ? `(${formatter.format(Math.abs(amount))})`
    : formatter.format(amount);
};

export default function MyComponent() {
  return <div>{formatCurrency(total)}</div>;
}
```

**After:**
```javascript
import { formatCurrency } from '@utils';

export default function MyComponent() {
  return <div>{formatCurrency(total)}</div>;
}
```

### Pattern 2: Replace Duplicate API Calls

**Before:**
```javascript
export default function ForecastPage() {
  const [assumptions, setAssumptions] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const data = await Rest.fetchJson('/api/forecast/assumptions');
        setAssumptions(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  const scenarios = assumptions?.scenarios || [];

  return <div>{/* Use scenarios */}</div>;
}
```

**After:**
```javascript
import { useForecast } from '@/contexts';

export default function ForecastPage() {
  const { scenarios, isLoadingAssumptions } = useForecast();

  // Data automatically loaded and shared across pages
  return <div>{/* Use scenarios */}</div>;
}
```

### Pattern 3: Combine Phase 1 + Phase 2

**Fully Optimized Component:**
```javascript
import { useForecast } from '@/contexts';
import { useModal, useAPI } from '@/hooks';
import { formatCurrency, formatRate } from '@utils';
import Rest from '@lib/rest';

export default function EnhancedForecastPage() {
  // Phase 2: Shared forecast state
  const { scenarios, refreshAssumptions } = useForecast();

  // Phase 1: Modal management
  const editModal = useModal({ initialData: null });

  // Phase 1: API calls with cleanup
  const { data, isLoading, execute } = useAPI(
    (scenarioName) => Rest.fetchJson(`/api/forecast/data?scenario=${scenarioName}`)
  );

  const handleEdit = (item) => {
    editModal.openWithData(item);
  };

  const handleSave = async () => {
    editModal.setLoading(true);
    try {
      await Rest.postJson('/api/forecast/save', editModal.data);
      await refreshAssumptions(); // Refresh shared state
      editModal.close();
    } catch (err) {
      editModal.setError(err.message);
    } finally {
      editModal.setLoading(false);
    }
  };

  return (
    <div>
      {/* Phase 2: Use formatted utilities */}
      {data?.amount && <p>{formatCurrency(data.amount)}</p>}

      {/* Phase 1: Modal with Phase 2 utilities */}
      {editModal.isOpen && (
        <Modal
          data={editModal.data}
          onSave={handleSave}
          isLoading={editModal.isLoading}
          error={editModal.error}
          onClose={editModal.close}
        />
      )}
    </div>
  );
}
```

---

## Best Practices

### Importing Utilities

**Do:**
```javascript
// Named imports for specific utilities
import { formatCurrency, getToday } from '@utils';
```

**Don't:**
```javascript
// Avoid default imports from index
import utils from '@utils';
utils.formatCurrency(); // ❌
```

### Using Contexts

**Do:**
```javascript
// Check loading state
const { scenarios, isLoadingAssumptions } = useForecast();
if (isLoadingAssumptions) return <Loading />;
```

**Don't:**
```javascript
// Fetch assumptions again
const { scenarios } = useForecast();
useEffect(() => {
  Rest.fetchJson('/api/forecast/assumptions'); // ❌ Duplicate call
}, []);
```

### Organizing Imports

```javascript
// 1. External dependencies
import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

// 2. Contexts and hooks
import { useForecast } from '@/contexts';
import { useModal, useAPI } from '@/hooks';

// 3. Utilities
import { formatCurrency, getToday } from '@utils';

// 4. Libraries
import Rest from '@lib/rest';

// 5. Components
import BalanceReport from '@features/Balances/BalanceReport';

// 6. Styles and assets
import './MyComponent.css';
import logo from '@assets/banner.png';
```

---

## Testing Utilities

All utility functions are pure and easily testable:

```javascript
// Example test for formatCurrency
import { formatCurrency } from '@utils';

test('formats positive currency', () => {
  expect(formatCurrency(1234.56)).toBe('$1,234.56');
});

test('formats negative currency with parentheses', () => {
  expect(formatCurrency(-1234.56)).toBe('($1,234.56)');
});

test('handles null values', () => {
  expect(formatCurrency(null)).toBe('$0.00');
});
```

---

## Summary

Phase 2 architecture improvements provide:

✅ **30+ reusable utility functions** organized by category
✅ **Forecast Context** for shared state management
✅ **Updated path aliases** with `@utils` and `@lib`
✅ **Clear migration patterns** for refactoring existing code
✅ **Better separation of concerns** between utilities, contexts, and components
✅ **Testable, documented functions** with JSDoc examples

Combined with Phase 1 (custom hooks, PropTypes), the architecture now supports:
- Cleaner component code
- Reduced duplication
- Better performance
- Easier testing
- Improved maintainability

See [PHASE2_COMPLETE.md](PHASE2_COMPLETE.md) for implementation details.
