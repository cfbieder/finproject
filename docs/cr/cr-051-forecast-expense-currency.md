# CR051 — Foreign-Currency Expense Lines (expose the currency that already exists)

**Status:** PLANNED · **Track:** v3 · **Opened:** 2026-07-15
**Depends on:** nothing (rides on CR050's override machinery where it overlaps, but does not require it).
**Touches:** the Forecast **Expenditures** page (`FCExpModal`, `FCExpTable`, the exp CRUD hooks),
the income/expense write path (`repositories/forecast.js`, `crud.js`), and the Review/Compare
display of income/expense lines. **No migration. Does not change the engine.**

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
| **Mixed-currency line** (e.g. 20% of Living Expenses is PLN) | **Split into separate lines** — one currency per line ("Living Expenses (USD)" + "Living Expenses PLN") | Reuses the engine as-is; fully auditable; sidesteps the *native-amount-vs-USD-value* weight-drift ambiguity a per-line mix would carry. A composition-on-a-line stays a possible follow-on only if hand-split rows prove too coarse. |
| **Foreign-line inflation** | **Single scenario inflation rate**, applied to the native amount, then convert at year FX (unchanged engine) | Zero new machinery. An inflation differential can already be baked into the FX-PLN assumption series (a steadily weakening złoty encodes hotter PL inflation). Per-currency inflation is a materially bigger CR (new assumption column + engine + CR050 override surface) — deferred. |
| **Amount entry / source-of-truth** | **Native** — user types the native figure; `base_value` (native) is source-of-truth; `base_value_usd` is a **derived display value** | Matches the engine's *inflate-native-then-convert* design and how the cost is actually known ("rent is 8,000 zł/mo"). An FX assumption edit then moves the USD figure with no re-typing. Entering USD and back-computing native reintroduces the drift/rot family CR050 just fought. |
| **Currencies offered** | **USD / EUR / PLN** only | Exactly the three with existing FX assumption columns + engine mappings; the picker can't create a line the engine silently fails to convert. Generalising to data-driven `FX-*` lookup is speculative until a 4th currency is real. |

## 4. Source-of-truth rule (the one thing to get right)

`base_value` = the native amount, and it is the truth. `base_value_usd` is **derived for display
only**: `base_value_usd = base_value / FX[currency, PeriodStart]` (the scenario's base-year FX
rate for that currency; `= base_value` when currency is USD).

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
   Modules picker's placement/labels for consistency.
2. **Native-amount entry** — when currency ≠ USD, the amount field is the native figure; on save,
   derive `base_value_usd` at the scenario's base-year FX for that currency. Show the derived USD
   equivalent read-only beside it so the conversion is visible.
3. **Write path** — ensure `currency` and `base_value` flow through the exp create/update.
   **Field whitelist:** CR043 N10 made the forecast write API *reject* unknown fields; confirm
   `currency` is in the allowed set for income/expense writes (add it if not) — otherwise the
   save 400s or silently drops it.
4. **Display** — `FCExpTable` (and the Review/Compare income/expense rows) show the native amount
   + currency code alongside the USD figure, so a PLN line reads as `PLN 100,000 (≈$25,000)`
   rather than a bare number.
5. **Tests**
   - Engine: a confirming test that a PLN income/expense line converts per-year via `FX - PLN`
     (guards the existing path against regression) and inflates in native before converting.
   - Write path: `base_value_usd` is derived (not trusted from the client); whitelist accepts
     `currency`.
   - CR050: a variant that overrides only `currency` on a line materializes correctly.
6. **Docs** — project-description (Expenditures page gains a currency field; note the
   engine already converts), roadmap item closed, this CR → COMPLETED, test-overview counts.

## 6. CR050 interaction

`currency` becomes an ordinary overridable field, so a variant can flip one line's currency for
free once the write path carries it (a natural "weak-PLN retirement" variant — and because FX is
*already* a CR050 assumption override, a variant can already stress the złoty **rate**; this lets
it also stress **exposure**). One small follow-through: the variant panel's field-label/format map
(`fcFieldLabels.js`) needs a `currency` entry so an overridden currency renders as a labelled,
readable change rather than a raw column name.

## 7. Open questions / risks

- **Matched lines arrive in USD.** Bank-feed/actuals-matched income/expense lines are USD by
  construction. Switching a *matched* line to PLN needs a defined base-year rate to back out the
  native amount, or the actuals anchor breaks. **Leaning:** allow currency ≠ USD only on
  **unmatched** lines for now (or require re-entering the native amount on switch); confirm with
  the owner before build.
- **Only PLN/EUR/USD are wired** (hardcoded `categories[2]/[3]` in the builders). A 3rd foreign
  currency is out of scope — it needs a new FX assumption column + mapping, not just a picker
  entry.
- **Single inflation series** (§3) means a PLN line inflates at the US/scenario rate in złoty
  terms. Accepted simplification; revisit only if the owner wants PL inflation and złoty FX as
  independent drivers.

## 8. Non-goals

- No per-line currency **mix/composition** (that was the rejected Option B — split into lines
  instead).
- No **scenario-level exposure knob** (rejected Option C — a sensitivity tool, a different CR).
- No **per-currency inflation** assumption.
- No **migration** and **no engine change** — if either becomes necessary, the design above is
  wrong and should be revisited before writing code.
