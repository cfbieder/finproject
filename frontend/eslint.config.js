import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    // Build/test config files run in Node, not the browser — grant Node globals
    // (__dirname, process) so they don't trip no-undef.
    files: ['*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // `_` as an argument is the universal "intentionally ignored" convention
      // (`.map((_, i) => …)`); flagging it says nothing useful. Unused CAUGHT
      // errors are NOT ignored — write `catch { … }` (optional catch binding) if
      // you genuinely don't need the error, so "I ignored this on purpose" stays
      // visible in the code rather than being waved through by config.
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' },
      ],
      // Known Issue #3: toISOString() renders the UTC date, which is off by a
      // day for local dates near midnight. Use formatLocalDate/formatDateOnly
      // from utils/dateHelpers.js instead.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='split'][callee.object.callee.property.name='toISOString']",
          message:
            'Never derive YYYY-MM-DD via toISOString() — it shifts the date across the UTC boundary (Known Issue #3). Use formatLocalDate()/formatDateOnly() from utils/dateHelpers.js.',
        },
      ],
    },
  },
])
