# CR051 — Foreign-Currency Expense Lines (expose the currency that already exists)

**Status:** COMPLETED — **shipped v3.2.0, live in prod** (2026-07-15) · **Track:** v3 · **Opened:** 2026-07-15
**Depends on:** nothing (rides on CR050's override machinery where it overlaps, but does not require it).
**Touches:** the Forecast **Expenditures** page (`FCExpModal`, `FCExpTable`, `FCExpSetup`, the exp
CRUD hook), the income/expense write path (`v2/routes/forecast.js`), the base-year FX helper
(`services/forecast/fcbuilder-setup.js`), and the FX guard (`services/forecast/fcbuilder-incexp.js`).
**No migration.** No engine *behavior* change for existing (USD) scenarios — but **one defensive
engine fix landed** (§5.5, finding F1): the incexp FX path had no guard on a missing/zero rate, so a
non-USD line would divide by 1.0 (silent ~4× overstatement) or by 0 (`Infinity`). That could never
fire before (no non-USD income/expense line existed); this CR arms it, so the guard ships with it.

> **Shipped v3.2.0 (2026-07-15).** Built and verified on dev overnight, then released to prod.
> **407 backend tests** (13 new), **195 frontend**, **7/7 Playwright** incl. a new CR051 browser
> round-trip (add a PLN expense → USD derives at −400/4 = −100 → survives save+reopen), lint gate
> 0 errors. No migration, no engine behavior change for USD scenarios. The owner opted to ship
> directly (the pre-release dev walkthrough was waived). See §5 for what shipped vs the original plan.

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

## 5. Work breakdown — as built (2026-07-15)

1. **Currency selector** — ✅ `FCExpModal.jsx` gains a USD/EUR/PLN `<select>`, **expense-only**
   (finding F5: incexp income is taxed at the flat `scenario.TaxRate`
   [`fcbuilder-incexp.js`](../../server/src/services/forecast/fcbuilder-incexp.js) and ignores
   CR047's `income_tax_rate_override`, so "foreign income already taxed abroad" is inexpressible
   here — the picker is hidden for Income, and switching a line's Type away from Expense resets it
   to USD). Also **disabled while Matched** (matched lines are USD-anchored to actuals — §7).
2. **Native-amount entry** — ✅ when currency ≠ USD the Base Value field is the native amount and
   the USD field is read-only, deriving live from `FCExpSetup`'s base-year FX rate for a preview;
   the server re-derives authoritatively on save. `useFCExpCrud.js` no longer hard-pins `Currency`
   to `"USD"` (it did in **three** places — the actual reason every line read back as USD).
3. **Write path + server-side derivation** — ✅ `POST`/`PUT /incomeexpense` derive
   `base_value_usd = round(base_value / baseYearFxRate(scenario, ccy), 2)` for a non-USD line
   (`baseYearFxRate` new in `fcbuilder-setup.js`), **ignoring** the client USD so it can't rot;
   USD lines are untouched (1:1, client value trusted, matched lines unchanged). A missing/zero FX
   rate returns **400** at save. `Currency` was already in `INCEXP_WRITE_FIELDS` (CR043 N10), so no
   whitelist change was needed.
4. **Display** — ✅ `FCExpTable` shows the native amount + currency code beneath the USD figure for
   a non-USD line (`PLN 100,000` under the `$25,000`). (Review/Compare already read `base_value_usd`,
   which is now correct; no change needed there for v1.)
5. **FX guard (finding F1) — the engine fix that shipped.** ✅ The real failure mode was **not** a
   short FX series (the engine's `buildRates` always carry-forwards a full-length series) — it was a
   **missing or zero rate for a currency in use**. The incexp builder divided by it with no guard:
   `incexpValues[i] / fxrates[i]` → **`Infinity`** on a 0, and a genuinely-absent `FX - <ccy>` column
   left the rate at **1.0** (silent ~4× overstatement). Fix: for a non-USD line, throw a clear error
   if the `FX - <ccy>` column is absent, or if any in-period rate is non-finite/≤ 0
   ([`fcbuilder-incexp.js`](../../server/src/services/forecast/fcbuilder-incexp.js)). Scoped to the
   incexp builder (the newly-armed path); the module builder's pre-existing `|| 1` mask is left as-is
   (out of scope, and changing it risks existing non-USD *module* forecasts).
6. **Tests** — ✅ **13 new** (backend 394 → **407**; frontend 195; e2e 6 → **7**):
   - Engine (5, `fcbuilder-incexp.test.js`): PLN books at native ÷ FX; inflation applied in native
     *before* conversion (proved with a per-year-varying FX); F1 zero-rate throws; F1 missing-column
     throws; a USD line is unaffected.
   - Helper (5, `fcbuilder-setup.baseYearFxRate.test.js`): USD → 1; base-year rate; carry-forward;
     zero and missing-currency both throw.
   - Route (2, `cr051.incexp-currency.routes.test.js`, DB): a non-USD line on a non-convertible
     scenario is **400**; on a convertible one, `base_value_usd` is derived (not the client's value).
   - CR050 variant (1): a `currency` override materializes on the variant, base stays USD, reverts.
   - E2E (1, `cr051-currency.spec.js`): the full browser round-trip (add PLN → USD derives → survives
     save + reopen).
7. **Docs** — ✅ this CR, project-description (Expenditures gains a currency field), roadmap, CR
   index, test-overview.

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
