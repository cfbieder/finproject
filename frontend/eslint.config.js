import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import react from 'eslint-plugin-react'
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
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: 'detect' } },
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

      // JSX identifier resolution. Only two rules of `eslint-plugin-react` are
      // enabled — not its `recommended` set, which is largely prop-types and
      // stylistic and would land ~hundreds of findings unrelated to correctness.
      // These two exist purely to make ESLint see what JSX references:
      //
      //   `<Foo />` parses to a JSXIdentifier, and core ESLint builds no scope
      //   reference from it. Both directions of the lookup are therefore blind —
      //   an identifier used ONLY in JSX looks UNUSED, and one that does not
      //   exist at all is not UNDEFINED. The project used to compensate for the
      //   first with capitalized ignore patterns on `no-unused-vars` (every
      //   component name falls under `^[A-Z]`), which papered over the symptom
      //   and, being an ignore, could never address the second.
      //
      //   It cost a production bug. `ba4ef7f` deleted the `icon: Icon` binder
      //   from BOTH `MOBILE_TABS.map(({ icon: Icon }) => <Icon />)` in
      //   MobileTabBar and the identical launcher map in MobileHome, while both
      //   bodies still rendered `<Icon />`. The tab-bar copy was caught only
      //   because it happened to trip the ARGS pattern (which had no capitalized
      //   escape hatch yet) and turned the gate red from v3.4.8 to v3.6.0. The
      //   MobileHome copy produced no finding whatsoever and shipped: the mobile
      //   home page threw `ReferenceError: Icon is not defined` on render for two
      //   weeks, through a green build and a green test suite.
      //
      // `jsx-uses-vars` marks JSX-referenced identifiers as used, which is what
      // lets the capitalized escape hatches below be REMOVED — an unused
      // component import is now a real finding again. `jsx-no-undef` is the half
      // an ignore pattern could never buy: it reports the component that does not
      // exist. Reverting the MobileHome fix makes it error.
      'react/jsx-uses-vars': 'error',
      'react/jsx-no-undef': 'error',

      // `_` is the universal "intentionally ignored" convention (`.map((_, i) => …)`);
      // flagging it says nothing useful. Nothing else is exempt — capitalized names
      // are covered by `jsx-uses-vars` above when JSX genuinely uses them, and are
      // real findings when it does not. Unused CAUGHT errors are NOT ignored — write
      // `catch { … }` (optional catch binding) if you genuinely don't need the error,
      // so "I ignored this on purpose" stays visible in the code rather than being
      // waved through by config.
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
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
