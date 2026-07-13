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
      // DX, not correctness. When this fires, Vite falls back to a full page reload in dev
      // instead of a hot swap — production behavior is identical. Fixing it means hoisting
      // co-located helpers/hooks/constants out of 9 component files (TransactionTable,
      // PeriodSelector, …) and rewriting imports app-wide; that is churn on the money path
      // to buy hot-reload ergonomics. Kept VISIBLE as a warning, but it must not block the
      // gate: the gate exists to stop bugs, and this rule catches none. Extract per-file
      // when someone is already in that file for another reason.
      'react-refresh/only-export-components': 'warn',

      // Debt, not breakage — and tracked as debt: `Scripts/check-lint-debt.sh` baselines the
      // count and CI fails if it GROWS, exactly like the design guards. It may only shrink.
      //
      // Why it is not an error: every rule that catches an actual bug (no-undef,
      // no-unused-vars, rules-of-hooks, react-hooks/refs, react-hooks/immutability, the
      // toISOString guard below) is at ZERO and blocking. This rule flags state synced from
      // props inside an effect: an extra render pass, and wrong under concurrent rendering,
      // but not broken today. The 36 remaining sites are behavioral surgery across the
      // Budget worksheets, the Transaction filters and the mobile pages — hand-work needing
      // browser verification per site, not a batch edit. Blocking CI on them would have
      // meant either never flipping the gate on, or rushing edits to the money paths.
      // Burn them down per-file when you are already in the file.
      'react-hooks/set-state-in-effect': 'warn',

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
