# Frontend Architecture Guide

This guide documents the architectural patterns and best practices for the frontend application.

## Path Aliases

Path aliases are configured to simplify imports across the codebase. Instead of using relative paths with multiple `../`, use the following aliases:

### Available Aliases

```javascript
import Component from '@/components/Component';      // Root src directory
import Feature from '@components/NavigationMenu';     // Shared components
import Page from '@pages/Balance';                    // Page components
import { useModal } from '@utils/hooks';              // Utilities (js directory)
import BalanceReport from '@features/Balances/BalanceReport';  // Feature components
import logo from '@assets/banner.png';                // Static assets
import coa from '@data/coa.json';                     // Data files
```

### Configuration Files

- **vite.config.js**: Defines aliases for bundler resolution
- **jsconfig.json**: Provides IDE support for path completion and navigation

## Custom Hooks

Reusable hooks are available in `src/hooks/` to standardize common patterns.

### useModal

Manages modal state with loading, error handling, and data management.

**Basic Usage:**
```javascript
import { useModal } from '@/hooks';

function MyComponent() {
  const deleteModal = useModal();
  const editModal = useModal({ initialData: null });

  return (
    <>
      <button onClick={deleteModal.open}>Delete</button>
      <button onClick={() => editModal.openWithData(item)}>Edit</button>

      {deleteModal.isOpen && (
        <Modal
          onClose={deleteModal.close}
          isLoading={deleteModal.isLoading}
          error={deleteModal.error}
        />
      )}
    </>
  );
}
```

**API:**
- `isOpen` - Boolean indicating modal visibility
- `data` - Current modal data
- `isLoading` - Loading state
- `error` - Error message string
- `open()` - Open modal
- `close()` - Close modal and reset state
- `openWithData(data)` - Open modal with specific data
- `setData(data)` - Update modal data
- `setLoading(bool)` - Set loading state
- `setError(string)` - Set error message
- `reset()` - Reset data and states

### useAPI

Handles API calls with automatic cleanup, loading states, and error handling.

**Auto-fetch on Mount:**
```javascript
import { useAPI } from '@/hooks';
import Rest from '@utils/rest';

function Balance() {
  const { data, isLoading, error, refetch } = useAPI(
    () => Rest.fetchJson('/api/balance'),
    { immediate: true }
  );

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  return <BalanceReport data={data} />;
}
```

**Manual Execution:**
```javascript
function SearchForm() {
  const { data, isLoading, execute } = useAPI(
    (searchTerm) => Rest.fetchJson(`/api/search?q=${searchTerm}`)
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    execute(searchTerm);
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

**API:**
- `data` - Response data
- `isLoading` - Loading state
- `error` - Error message
- `execute(...args)` - Execute API call with arguments
- `refetch()` - Re-execute last call
- `reset()` - Clear all states

**Options:**
- `immediate` - Auto-execute on mount (default: false)
- `deps` - Dependencies for auto-refetch
- `onSuccess` - Success callback
- `onError` - Error callback

### useMultiAPI

Manages multiple API states in a single component.

```javascript
import { useMultiAPI } from '@/hooks';

function Dashboard() {
  const api = useMultiAPI();

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    // Load assumptions
    api.setLoading('assumptions', true);
    try {
      const data = await Rest.fetchJson('/api/assumptions');
      api.setData('assumptions', data);
    } catch (err) {
      api.setError('assumptions', err.message);
    }

    // Load scenarios
    api.setLoading('scenarios', true);
    try {
      const data = await Rest.fetchJson('/api/scenarios');
      api.setData('scenarios', data);
    } catch (err) {
      api.setError('scenarios', err.message);
    }
  };

  // Access: api.state.assumptions.data, api.state.assumptions.isLoading, etc.
}
```

### useFormState

Comprehensive form state management with validation.

**With Validation:**
```javascript
import { useFormState } from '@/hooks';

function UserForm() {
  const form = useFormState(
    { name: '', email: '' },
    {
      validate: (values) => {
        const errors = {};
        if (!values.name) errors.name = 'Name is required';
        if (!values.email.includes('@')) errors.email = 'Invalid email';
        return errors;
      },
      onSubmit: async (values) => {
        await Rest.postJson('/api/users', values);
      }
    }
  );

  return (
    <form onSubmit={form.handleSubmit}>
      <input
        value={form.values.name}
        onChange={form.handleChange('name')}
        onBlur={form.handleBlur('name')}
      />
      {form.errors.name && <span>{form.errors.name}</span>}

      <button type="submit" disabled={form.isSubmitting}>
        Submit
      </button>
      {form.submitError && <div>{form.submitError}</div>}
    </form>
  );
}
```

**Simple Form (No Validation):**
```javascript
import { useSimpleForm } from '@/hooks';

function QuickForm() {
  const [form, setForm, reset] = useSimpleForm({ search: '' });

  return (
    <>
      <input
        value={form.search}
        onChange={(e) => setForm('search', e.target.value)}
      />
      <button onClick={reset}>Clear</button>
    </>
  );
}
```

## PropTypes

All components should include PropTypes for runtime type checking.

### Adding PropTypes

```javascript
import PropTypes from 'prop-types';

export default function BalanceReport({
  balanceReports,
  periodDates,
  periodCount,
  collapsedPaths,
  onTogglePath,
}) {
  // Component implementation
}

BalanceReport.propTypes = {
  balanceReports: PropTypes.arrayOf(PropTypes.array),
  periodDates: PropTypes.arrayOf(PropTypes.string),
  periodCount: PropTypes.number,
  collapsedPaths: PropTypes.instanceOf(Set),
  onTogglePath: PropTypes.func,
};
```

### Common PropTypes Patterns

```javascript
// Primitives
PropTypes.string
PropTypes.number
PropTypes.bool
PropTypes.func
PropTypes.array
PropTypes.object

// Required props
PropTypes.string.isRequired

// Arrays with specific types
PropTypes.arrayOf(PropTypes.string)
PropTypes.arrayOf(PropTypes.object)

// Objects with shape
PropTypes.shape({
  name: PropTypes.string,
  age: PropTypes.number,
})

// One of several types
PropTypes.oneOfType([
  PropTypes.string,
  PropTypes.number,
])

// Specific values
PropTypes.oneOf(['small', 'medium', 'large'])

// Custom instances
PropTypes.instanceOf(Set)
PropTypes.instanceOf(Map)
```

## Component Patterns

### Container/Presentational Pattern

**Container (Smart) Components:**
- Handle data fetching and state management
- Located in `src/pages/`
- Pass data down as props

```javascript
// src/pages/Balance.jsx
function Balance() {
  const { data, isLoading } = useAPI(
    () => Rest.fetchBalanceReport(date),
    { immediate: true }
  );

  return <BalanceReport balanceReports={data} />;
}
```

**Presentational (Dumb) Components:**
- Pure rendering logic
- Located in `src/features/`
- Receive all data via props

```javascript
// src/features/Balances/BalanceReport.jsx
function BalanceReport({ balanceReports }) {
  return <div>{/* Render data */}</div>;
}
```

### Modal Pattern

Use the `useModal` hook instead of managing modal state manually:

**Before:**
```javascript
const [showModal, setShowModal] = useState(false);
const [modalData, setModalData] = useState(null);
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState('');
```

**After:**
```javascript
const modal = useModal({ initialData: null });
```

### API Pattern

Use the `useAPI` hook for consistent error handling and cleanup:

**Before:**
```javascript
const [data, setData] = useState(null);
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState('');
const isMountedRef = useRef(true);

useEffect(() => {
  isMountedRef.current = true;
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const result = await Rest.fetchJson('/api/data');
      if (isMountedRef.current) {
        setData(result);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err.message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };
  fetchData();
  return () => {
    isMountedRef.current = false;
  };
}, []);
```

**After:**
```javascript
const { data, isLoading, error } = useAPI(
  () => Rest.fetchJson('/api/data'),
  { immediate: true }
);
```

## Best Practices

### Import Order

1. External dependencies (React, libraries)
2. Internal utilities (hooks, helpers)
3. Components
4. Styles
5. Data/assets

```javascript
import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useModal, useAPI } from '@/hooks';
import Rest from '@utils/rest';
import BalanceReport from '@features/Balances/BalanceReport';
import './Balance.css';
import coa from '@data/coa.json';
```

### Component Organization

- Keep components under 500 lines
- Extract helper functions to utilities
- Use custom hooks for reusable logic
- Co-locate styles with components

### State Management

- Use `useReducer` for complex state (5+ useState calls)
- Extract modal/form logic to custom hooks
- Consider Context API for shared data within features

### Performance

- Memoize expensive calculations with `useMemo`
- Memoize callbacks with `useCallback`
- Use React.lazy() for route-based code splitting (upcoming)

## Migration Guide

### Converting Relative Imports to Aliases

**Before:**
```javascript
import coa from '../../../../components/data/coa.json';
import Rest from '../../js/rest.js';
```

**After:**
```javascript
import coa from '@data/coa.json';
import Rest from '@utils/rest';
```

### Converting to useModal

**Before:**
```javascript
const [showEditModal, setShowEditModal] = useState(false);
const [editForm, setEditForm] = useState(null);
const [editSaving, setEditSaving] = useState(false);
const [editError, setEditError] = useState('');

const openEdit = (item) => {
  setEditForm(item);
  setShowEditModal(true);
};

const closeEdit = () => {
  setShowEditModal(false);
  setEditForm(null);
  setEditSaving(false);
  setEditError('');
};
```

**After:**
```javascript
const editModal = useModal({ initialData: null });

const openEdit = (item) => {
  editModal.openWithData(item);
};
```

### Converting to useAPI

See API Pattern section above for detailed before/after examples.

## Future Improvements

Phase 2 and beyond (not yet implemented):
- TypeScript migration for compile-time type safety
- React Hook Form for complex forms
- Context API for Forecast module shared state
- Route-based code splitting with React.lazy()
- Unified routes configuration
- React Error Boundaries
