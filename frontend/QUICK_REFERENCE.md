# Quick Reference - Phase 1 Improvements

## Path Aliases

```javascript
import Component from '@/App';                    // src/
import Nav from '@components/NavigationMenu';     // src/components/
import Balance from '@pages/Balance';             // src/pages/
import Report from '@features/Balances/BalanceReport';  // src/features/
import Rest from '@utils/rest';                   // src/js/
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

## Full Documentation

See **ARCHITECTURE_GUIDE.md** for complete details and examples.
