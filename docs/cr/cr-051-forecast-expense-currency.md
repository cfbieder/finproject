# CR051 — Foreign-Currency Expense Lines (expose the currency that already exists)

**Status:** PLANNED · **Track:** v3 · **Opened:** 2026-07-15
**Depends on:** nothing (rides on CR050's override machinery where it overlaps, but does not require it).
**Touches:** the Forecast **Expenditures** page (`FCExpModal`, `FCExpTable`, the exp CRUD hooks),
the income/expense write path (`repositories/forecast.js`, `crud.js`), and the Review/Compare
display of income/expense lines. **No migration.** No engine *behavior* change for existing
scenarios — but **one defensive engine fix is required** (§5.6, finding F1): the incexp FX path
silently falls through to a rate of 1.0 for any out-of-range year, which today can't fire because
no incexp line is non-USD. This CR makes it fireable, so the guard lands with it.

---

## 1. The problem

Every forecast expense line is entered in USD, but real spending isn't. A meaningful slice of
living costs is denominated in **PLN** (and some in **EUR**), so its USD cost floats with the
złoty. Modelled as a flat USD number, a weakening złoty looks like *no change* when it should
be a real reduction in the USD burn rate — the single largest FX lever on the plan is invisible.

The owner's framing: *"Of the total Living Expenses, say 20% are actually PLN."*

## 2. The surprise — the rails already exist

This is almost entirely a UI-exposure job. The compute path is already built and already runs
for **modules** today:

- **The column exists.** `forecast_income_expense.currency CHAR(3) DEFAULT 'USD'`
  (migration 001) — every line already carries a currency; it has only ever been left at USD.
- **The engine already converts, per year.** [`fcbuilder-incexp.js:89-104`](../../server/src/services/forecast/fcbuilder-incexp.js#L89-L104)
  reads the line's currency, maps `PLN → "FX - PLN"` / `EUR → "FX - EUR"` assumption columns,
  and builds a per-year FX array; it inflates the amount **in native currency**
  ([`:139-153`](../../server/src/services/forecast/fcbuilder-incexp.js#L139-L153)) and only
  then divides by that year's FX ([`:170`](../../server/src/services/forecast/fcbuilder-incexp.js#L170)).
- **The loader already reads it.** [`index.js:188`](../../server/src/services/forecast/index.js#L188)
  — `item.Currency = (item.currency || 'USD').trim();`.
- **Modules already ship the UI.** `FCModulesEdit.jsx` has a currency picker; the **Expenses
  modal has none** — the `--currency` class in `FCExpModal.jsx` is money-input *styling*, not a
  selector.
- **FX rates are already per-year assumptions**, and already per-scenario overridable via CR050.

So "make an expense line PLN" needs no engine work and no migration. What's missing is the
selector, the native-amount entry rule, and legible display.

## 3. Decisions (owner-ratified 2026-07-15)

Four forks were settled up front; each choice keeps us on existing machinery:

| Decision | Choice | Why |
|---|---|---|
| **Mixed-currency line** (e.g. 20% of Living Expenses is PLN) | **Split into separate lines** — one currency per line ("Living Expenses (USD)" + "Living Expenses PLN") | Reuses the engine as-is; fully auditable; sidesteps the *native-amount-vs-USD-value* weight-drift ambiguity a per-line mix would carry. A composition-on-a-line stays a possible follow-on only if hand-split rows prove too coarse. **Note the split is fixed in *native* terms** — so the PLN *share of total* drifts with FX over the horizon (żłoty halves ⇒ that line's USD share roughly halves). That is the financially correct FX behavior, but it is *not* "20% held constant"; the "20%" is a base-year snapshot (finding F4). |
| **Foreign-line inflation** | **Single scenario inflation rate**, applied to the native amount, then convert at year FX (unchanged engine) | Zero new machinery. **This is load-bearing on the owner trending FX to weaken** (finding F3): PLN inflates at the US/scenario rate, but PL inflation structurally runs hotter — understating future złoty spend. That only self-corrects if the FX-PLN series depreciates the złoty (PPP). Hold FX *flat* and you implicitly assume the złoty *really appreciates* — an optimistic bias on a cost line. Kept for v1; carried as a caveat, not a silent default. Per-currency inflation (new assumption column + engine + CR050 override surface) is deferred. |
| **Amount entry / source-of-truth** | **Native** — user types the native figure; `base_value` (native) is source-of-truth; `base_value_usd` is a **derived display value** | Matches the engine's *inflate-native-then-convert* design and how the cost is actually known ("rent is 8,000 zł/mo"). An FX assumption edit then moves the USD figure with no re-typing. Entering USD and back-computing native reintroduces the drift/rot family CR050 just fought. |
| **Currencies offered** | **USD / EUR / PLN** only | Exactly the three with existing FX assumption columns + engine mappings; the picker can't create a line the engine silently fails to convert. Generalising to data-driven `FX-*` lookup is speculative until a 4th currency is real. |

## 4. Source-of-truth rule (the one thing to get right)

`base_value` = the native amount, and it is the truth. `base_value_usd` is **derived for display
only**: `base_value_usd = base_value / FX[currency, deriveYear]` (`= base_value` when currency is
USD).

**Pin `deriveYear` explicitly (finding F2).** Use the **first forecast year that has an FX rate
for that currency** — in practice `PeriodStart`. Do *not* naïvely use the line's `base_date`
year: a historical anchor can sit *before* the assumption period, where no FX rate exists and the
lookup would fall through to 1.0, deriving a wrong USD display (a PLN line shown at ~4× its value).
If `base_date` is outside the FX series, clamp to the first in-range year.

Two consequences worth stating, because the `base_value_usd`-rot family bit CR050 repeatedly:

- **The incexp engine does not read `base_value_usd`.** It drives off `BaseValue` (native) +
  `Currency` and re-derives USD every build. So a stale `base_value_usd` is a cosmetic display
  bug on the Expenditures page, not a wrong forecast — unlike the *module* rows, where
  `base_value_usd` rot changed results. This makes the incexp source-of-truth clean.
  *(Confirm during build: verify the incexp loader maps `BaseValue` from `base_value` (native),
  not `base_value_usd`.)*
- **`base_value_usd` must be re-derived on every write** that changes `base_value`, `currency`,
  or the base-year FX assumption — never typed, never carried. Cheapest correct rule: recompute
  it in the write path from the current base-year FX at save time; don't try to keep it live
  against later FX edits (the engine ignores it anyway).

## 5. Work breakdown

1. **Currency selector** in `FCExpModal.jsx` — USD / EUR / PLN, default USD. Mirror the
   Modules picker's placement/labels for consistency. **Scope to expense lines, or gate income
   (finding F5):** the `currency` column is on `forecast_income_expense`, so exposing the picker
   also enables foreign *income* lines — but incexp income is taxed at the flat `scenario.TaxRate`
   ([`fcbuilder-incexp.js:158`](../../server/src/services/forecast/fcbuilder-incexp.js#L158)) and
   does **not** honor CR047's `income_tax_rate_override` (modules-only), so "foreign income already
   taxed abroad, only incremental US tax" is inexpressible on an incexp line. Decide before build:
   show the picker on **expense lines only**, or allow income too and document the flat-tax
   limitation. Recommendation: expense-only for v1.
2. **Native-amount entry** — when currency ≠ USD, the amount field is the native figure; on save,
   derive `base_value_usd` at the pinned `deriveYear` FX (§4). Show the derived USD equivalent
   read-only beside it so the conversion is visible.
3. **Write path** — ensure `currency` and `base_value` flow through the exp create/update.
   **Field whitelist (hard pre-check):** CR043 N10 made the forecast write API *reject* unknown
   fields. **Before writing any UI**, grep the incexp write validator and confirm `currency` is in
   the allowed set (add it if not) — otherwise the first save 400s or silently drops it.
4. **Display** — `FCExpTable` (and the Review/Compare income/expense rows) show the native amount
   + currency code alongside the USD figure, so a PLN line reads as `PLN 100,000 (≈$25,000)`
   rather than a bare number.
5. **FX-series robustness guard (finding F1) — the required engine fix.** The incexp FX loop
   ([`fcbuilder-incexp.js:96-102`](../../server/src/services/forecast/fcbuilder-incexp.js#L96-L102))
   only assigns `fxrates[i]` when the year is in range; otherwise it stays **1.0**, so a foreign
   line in any out-of-range year books at native = USD (a PLN 100,000 expense → $100,000, ~4× too
   large). The module builder at least backfills pre-period with `firstFxRate`
   ([`fcbuilder-module.js:119-127`](../../server/src/services/forecast/fcbuilder-module.js#L119-L127))
   — the incexp builder does not, and **neither** handles the post-period tail. Fix: for any
   in-period year with no FX value, **fail loud** (a non-USD line whose horizon exceeds its FX
   series is a misconfiguration, not something to paper over at 1.0); optionally carry the nearest
   rate for genuinely out-of-period years, consistently with the module builder. This can't fire
   today (no non-USD incexp line exists) — CR051 arms it, so the guard ships here.
6. **Tests**
   - Engine: a PLN expense line converts per-year via `FX - PLN` and inflates in native *before*
     converting (guards the existing path against regression).
   - Engine (F1): a non-USD line whose horizon exceeds the FX series **fails loud** (or carries the
     nearest rate) — it must **never** silently convert at 1.0.
   - Write path: `base_value_usd` is derived server-side (not trusted from the client), at the
     pinned `deriveYear`; whitelist accepts `currency`.
   - CR050: a variant that overrides only `currency` on a line materializes correctly.
7. **Docs** — project-description (Expenditures page gains a currency field; note the
   engine already converts), roadmap item closed, this CR → COMPLETED, test-overview counts.

## 6. CR050 interaction

`currency` becomes an ordinary overridable field, so a variant can flip one line's currency for
free once the write path carries it (a natural "weak-PLN retirement" variant — and because FX is
*already* a CR050 assumption override, a variant can already stress the złoty **rate**; this lets
it also stress **exposure**). One small follow-through: the variant panel's field-label/format map
(`fcFieldLabels.js`) needs a `currency` entry so an overridden currency renders as a labelled,
readable change rather than a raw column name.

## 7. Open questions / risks

**Financial-correctness caveats (must reach the owner, not just the code):**

- **F3 — flat FX + US-rate inflation is the *optimistic* case.** A PLN cost line inflates at the
  scenario (US) rate but real PL inflation runs hotter, and if the FX-PLN assumption is held flat
  there is no depreciation to offset it — so the model implicitly assumes real złoty appreciation,
  quietly *understating* future USD cost. The two errors only cancel if the owner **trends FX to
  weaken** (PPP). Nothing in the app enforces or prompts this. Surface it at the point of use: a
  foreign line with a flat FX series should carry a visible caveat ("assumes real currency
  appreciation"). This is the one place the plan can be wrong in the owner's favor.
- **F5 — foreign *income* is a half-feature.** The `currency` column is on
  `forecast_income_expense`, so the picker also enables foreign income lines, but incexp income is
  taxed at the flat `scenario.TaxRate` and ignores CR047's `income_tax_rate_override` — "already
  taxed abroad, only incremental US tax" is inexpressible here (it is on *modules*). Resolve per
  §5.1: expense-only picker for v1, or document the limitation.

**Engineering / scope:**

- **Matched lines arrive in USD.** Bank-feed/actuals-matched income/expense lines are USD by
  construction. Switching a *matched* line to PLN needs a defined base-year rate to back out the
  native amount, or the actuals anchor breaks. **Leaning:** allow currency ≠ USD only on
  **unmatched** lines for now (or require re-entering the native amount on switch); confirm with
  the owner before build.
- **F4 — the split ratio drifts by design.** A native-fixed PLN line means the PLN *share of
  total* moves with FX (§3). Correct FX behavior, but not "20% held constant" — say so in the UI
  copy / owner notes so the drift isn't read as a bug.
- **Maintenance drift (the CR050 rot, re-created by hand).** Split lines must be kept proportional
  manually — a lifestyle change to "Living Expenses" means remembering to touch both the USD and
  PLN rows. Fine for 2–3 splits; the trigger to revisit Option B (mix-on-line) is the **count of
  split lines** growing, not code aesthetics.
- **Only PLN/EUR/USD are wired** (hardcoded `categories[2]/[3]` in the builders). A 3rd foreign
  currency is out of scope — it needs a new FX assumption column + mapping, not just a picker
  entry.
- **Single inflation series** (§3, F3) means a PLN line inflates at the US/scenario rate in złoty
  terms. Accepted simplification; revisit only if the owner wants PL inflation and złoty FX as
  independent drivers.

## 8. Non-goals

- No per-line currency **mix/composition** (that was the rejected Option B — split into lines
  instead).
- No **scenario-level exposure knob** (rejected Option C — a sensitivity tool, a different CR).
- No **per-currency inflation** assumption.
- No **migration**, and **no engine *behavior* change** for existing (USD) scenarios. The one
  engine edit in scope is the defensive FX-tail guard (§5.5, F1), which changes nothing for USD
  lines and only prevents a silent 1.0 conversion for the non-USD lines this CR introduces. If any
  *other* engine change becomes necessary, the design above is wrong and should be revisited before
  writing code.
