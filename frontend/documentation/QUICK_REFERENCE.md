# Quick Reference - Phases 1 & 2

## Path Aliases

```javascript
import Component from '@/App';                    // src/
import Nav from '@components/NavigationMenu';     // src/components/
import Balance from '@pages/Balance';             // src/pages/
import Report from '@features/Balances/BalanceReport';  // src/features/
import { formatCurrency } from '@utils';          // src/utils/ (Phase 2)
import Rest from '@lib/rest';                     // src/js/
import logo from '@assets/banner.png';            // src/assets/
import coa from '@data/coa.json';                 // components/data/
```

## Hooks

### useModal
```javascript
import { useModal } from '@/hooks';

const modal = useModal();

// Methods
modal.open()
modal.close()
modal.openWithData(data)
modal.setLoading(true)
modal.setError('Error message')

// State
modal.isOpen
modal.data
modal.isLoading
modal.error
```

### useAPI
```javascript
import { useAPI } from '@/hooks';

// Auto-fetch
const { data, isLoading, error, refetch } = useAPI(
  () => Rest.fetchJson('/api/endpoint'),
  { immediate: true }
);

// Manual
const { execute } = useAPI(
  (id) => Rest.fetchJson(`/api/item/${id}`)
);
execute(123);
```

### useFormState
```javascript
import { useFormState } from '@/hooks';

const form = useFormState(
  { name: '', email: '' },
  {
    validate: (values) => {
      const errors = {};
      if (!values.name) errors.name = 'Required';
      return errors;
    },
    onSubmit: async (values) => {
      await Rest.postJson('/api/submit', values);
    }
  }
);

<input
  value={form.values.name}
  onChange={form.handleChange('name')}
  onBlur={form.handleBlur('name')}
/>
{form.errors.name && <span>{form.errors.name}</span>}
<button onClick={form.handleSubmit}>Submit</button>
```

## PropTypes

```javascript
import PropTypes from 'prop-types';

MyComponent.propTypes = {
  // Primitives
  name: PropTypes.string,
  count: PropTypes.number,
  isActive: PropTypes.bool,
  onClick: PropTypes.func,

  // Required
  id: PropTypes.string.isRequired,

  // Arrays
  items: PropTypes.array,
  names: PropTypes.arrayOf(PropTypes.string),

  // Objects
  user: PropTypes.object,
  config: PropTypes.shape({
    name: PropTypes.string,
    age: PropTypes.number,
  }),

  // Multiple types
  value: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),

  // Specific values
  size: PropTypes.oneOf(['small', 'medium', 'large']),

  // Instances
  paths: PropTypes.instanceOf(Set),
};
```

## Common Patterns

### Replace Modal State
```javascript
// Before
const [showModal, setShowModal] = useState(false);
const [data, setData] = useState(null);
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState('');

// After
const modal = useModal({ initialData: null });
```

### Replace API State
```javascript
// Before
const [data, setData] = useState(null);
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState('');
const isMountedRef = useRef(true);

useEffect(() => {
  // ... complex fetch logic with isMounted checks
}, []);

// After
const { data, isLoading, error } = useAPI(
  () => Rest.fetchJson('/api/data'),
  { immediate: true }
);
```

### Update Imports
```javascript
// Before
import coa from '../../../../components/data/coa.json';
import Rest from '../../js/rest.js';

// After
import coa from '@data/coa.json';
import Rest from '@utils/rest';
```

## Phase 2: Utilities

### Formatters
```javascript
import { formatCurrency, formatPercentage, formatRate } from '@utils';

formatCurrency(1234.56);    // '$1,234.56'
formatCurrency(-1234.56);   // '($1,234.56)'
formatPercentage(0.15);     // '15.00%'
formatRate(2.5);            // '2.50%'
```

### Date Helpers
```javascript
import { getToday, getMonthOptions, formatLocalDate } from '@utils';

const today = getToday();              // '2024-01-15'
const months = getMonthOptions();      // [{ value: '01', label: 'January' }, ...]
const date = formatLocalDate(new Date()); // '2024-01-15'
```

### Tree Traversal
```javascript
import { collectCollapsiblePaths, buildAccountValueMap } from '@utils';

const paths = collectCollapsiblePaths(accounts);  // Set of expandable paths
const map = buildAccountValueMap(accounts);       // Map of path -> value
```

## Phase 2: Forecast Context

```javascript
import { useForecast } from '@/contexts';

const {
  scenarios,           // Array of scenarios
  assumptions,         // Full assumptions object
  isLoadingAssumptions, // Loading state
  refreshAssumptions   // Refresh after changes
} = useForecast();

// Use scenarios without fetching
<select>
  {scenarios.map(s => <option key={s.Name}>{s.Name}</option>)}
</select>
```

## Full Documentation

- **ARCHITECTURE_GUIDE.md** - Phase 1 complete guide
- **PHASE2_ARCHITECTURE.md** - Phase 2 utilities and contexts
- **PHASE1_COMPLETE.md** - Phase 1 implementation details
- **PHASE2_COMPLETE.md** - Phase 2 implementation details
