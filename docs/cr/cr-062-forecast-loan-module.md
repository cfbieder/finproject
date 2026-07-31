# CR062 — Forecast Loan Module, and the Equity report it makes possible — PLANNED (nothing built)

Give the forecast a Loan module — principal, year taken, rate, end year and a per-year
amortization schedule — and then let a loan be secured against any asset so the plan can show
**equity**, not just gross value. Rev 3: both review passes landed.
[Roadmap](../current/project-roadmap.md#cr062)

**Opened:** 2026-07-31 · **Track:** v3 · **Migration:** 047 (P1) · 048 (P2)
**Depends on:** CR041 (ownership gate) · CR045 (cash sweep) · CR046 (income/expense window +
July-1 convention) · CR049 (`getBaseYearValues` as the single base-year source) · CR050
(scenario variants) · CR053 (auto-adjust)

**Phases.**

| | scope | gate |
|---|---|---|
| **P0** | The §5.6 `isLiability` sign fix, **alone** — one commit, patch release | Ship first, ahead of everything. It is the only part of this CR that changes a path existing scenarios already run, it is provably dormant (15 liability modules, **all** `expense_amount = 0.00`), and shipped by itself it makes V1/V17 a clean before/after with nothing else in the release to blame. *(pass 2 R1)* |
| **P1** | The Loan module — §1–§7 | After P0. No honest seam inside it: a headless loan the owner cannot enter delivers nothing and contradicts this CR's own v3.0.97 lesson. |
| **P2** | Securing a loan against an asset + the Equity report — §8 | **Not started until P1 is on prod _and_ the owner has built the SRQ mortgage and read the cash flow.** P1 is capability (currently inexpressible); P2 is presentation — asset row minus loan row is already legible on Review once P1 exists. *(pass 2 R2)* |

---

## 1. The gap

The forecast cannot model a loan. Not "models it awkwardly" — cannot. The owner is planning a
Sarasota house purchase (`2026 SRQ House Purchase` already carries a `Sarasota House` module
at MV 0) and there is no way to express the mortgage that pays for it.

Three findings, each **verified by calling `computeModule` directly**, and independently
re-derived in pass 1:

### 1.1 Liability interest is sign-inverted

```js
expenseValues[i] = isLiability ? val : -val;      // fcbuilder-module.js:307, 315, 329
```

Prod stores liabilities as **negative** market value (`PLN Credit Cards −24,542.66`). On a
negative balance `pct_of_value` already yields a positive `val` by double negation, and the
inflation path yields a positive `compounded` unconditionally — so the ternary does not
correct a sign, it *inverts* one. Liability, MV −500,000, `expense_amount 25,000`:

```
pct_of_value :  Interest Expense +25,000 flat   ·  Bank Accounts +25,000
inflation    :  +25,625 → +32,002 growing       ·  Bank Accounts +25,625 → +32,002
asset control:  −25,625                         ✅
```

**A mortgage entered today would fund the plan instead of draining it.** Latent only because
all **15** modules on a liability account in prod carry `expense_amount = 0.00` *(pass 2 N1 —
I had said 12; the conclusion is unchanged, the count was not)*. Two further modules carry no
`account_id` at all, so `AccountType` is `''` and they take the asset branch — confirm that is
still true after the fix. A Loan module is the first thing that would hit this.

### 1.2 The liability interest model has tests, but no data can reach it

G6 (`fcbuilder-module.test.js` 1.10–1.13, *"Interest calculated on liability balance"*) drives
interest through `module.ExpensePct`. The `expense_pct` column was **dropped in migration
008**, and the loader hard-codes it back to zero (`index.js:95`). The tests do **run** —
`runModule` hand-builds a module and bypasses `loadModulesForScenario` — but nothing in
production can carry a rate, so **there is no working way to charge interest on a liability**.
Unreachable from real data, not unrunnable. They also assume a *positive* liability balance,
a convention prod does not use.

Pass 1 found the sharper version of this: the harness sets `BaseDate = PeriodStart − 1`, while
real modules carry `base_date = 2025-12-31` against `PeriodStart = 2027` — **a two-year
offset** — and `Sarasota House` carries `2026-12-31` where the other 18 carry `2025-12-31`.
That divergence, not the `ExpensePct` zeroing, is what would hide a loan indexing bug (§5.1).

### 1.3 `Dispose` is silently dead on a liability

The "market value cannot go negative" cap zeroes any disposal when `availableMarket <= 0`,
always true for a negative balance. `Dispose 50,000` on MV −500,000: **no balance change, no
transfer, no cash movement, no warning.** `Invest` is the only working primitive
(`Invest +50,000` → balance −450,000, cash −50,000 ✅).

---

## 2. Decisions taken (owner, 2026-07-31)

| # | Decision | Chosen |
|---|---|---|
| 1 | What does the amortization % apply to? | **% of the original principal.** `Σ% = 100` is checkable and it is how amortization plans are written. |
| 2 | Ship the §1.1 sign fix here or separately? | **Here.** Zero rows in prod use the path, so it changes no existing number, and the Loan module is the first caller. |
| 3 | Track | **v3.** Flag-independent; verified against dev (`:3105`). |
| 4 | How does the schedule close to exactly zero? | **The final year repays the remaining balance**, not a percentage. "The loan ends at zero" becomes true by construction rather than by rounding luck, and the balloon warning fires only when the *schedule* leaves a residual — never when arithmetic does. |
| 5 | Scope of the asset link (added mid-draft) | **Any asset module, not just Real Estate**, and it brings its own report — **P2**, §8. |

**Decision 4 shapes the data model directly:** the year of `loan_end_date` is *always* the
remainder year and carries **no schedule row**. Schedule rows cover `drawYear+1 … endYear−1`.
Straight-line fill writes `100/n` across those and lets the last year absorb the rounding.
A genuine balloon is expressed by under-scheduling the earlier years, and is detected by the
final repayment exceeding 2× the median scheduled one — not by a rounding residual.

---

## 3. Design principles

### 3.1 Store the assumptions, derive the schedule

The inputs fully determine the schedule, so it is **re-derived on every generate** and never
materialized. A wizard that writes thirty `Invest` rows is the CR049/CR050 rot pattern: change
the rate and the rows keep the old answer while looking authoritative.

### 3.2 Activate on the data, not on `module_type`

`module_type` is a **user-editable free-text list** in Forecast Settings (prod already carries
a lowercase `asset`), and the engine has never read it — `FCModulesEdit` says so explicitly.
Keying engine behaviour on a string the owner can rename would make a scenario stop computing
interest because someone tidied a settings list.

**`Type = 'Loan'` decides which fields the form shows; `loan_interest_rate IS NOT NULL`
decides what the engine does.** The form matches case-insensitively **and** falls back to
`loan_interest_rate != null`, so a mistyped or renamed type can never leave live loan
assumptions uneditable while the engine goes on using them *(pass 1 S5)*.

### 3.3 The half-year convention falls out of the interest formula

Interest on `avg(balance[y], balance[y−1])` **is** a July-1 assumption. The draw year averages
`(0 + −P)/2` — exactly half a year. A repayment year averages to mid-year. No special-casing,
and it is the convention CR041, CR046 and the Full-disposal path already use.

---

## 4. Data model — migration 047 (`047_forecast_loan_module.sql`)

*(044 is reserved by CR059 P3a and still unapplied; 045 and **046** are applied — 046 landed from a concurrent thread on 2026-07-31, which is why this CR is 047/048 and not 046/047.)*

```sql
ALTER TABLE forecast_modules
  ADD COLUMN IF NOT EXISTS loan_principal     NUMERIC(15,2),  -- original amount, LC. NULL = not a loan
  ADD COLUMN IF NOT EXISTS loan_start_date    DATE,           -- year taken, stored YYYY-07-01
  ADD COLUMN IF NOT EXISTS loan_end_date      DATE,           -- YYYY-07-01; its year is the remainder year
  ADD COLUMN IF NOT EXISTS loan_interest_rate NUMERIC(8,4);   -- annual %, on average outstanding

CREATE TABLE IF NOT EXISTS forecast_module_amortization (
  id             SERIAL PRIMARY KEY,
  module_id      INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,                       -- YYYY-07-01
  pct            NUMERIC(8,4) NOT NULL CHECK (pct >= 0),  -- % of loan_principal repaid that year
  UNIQUE(module_id, effective_date)
);
CREATE INDEX IF NOT EXISTS idx_fc_amortization_module ON forecast_module_amortization(module_id);
```

`CHECK (pct >= 0)` because a negative percentage is a silent re-draw *(N4)*.
`loan_start_date` / `loan_end_date` are DATEs of which **only the year is read**; `YYYY-07-01`
is the storage convention and the year picker must not round-trip through a Date instant —
that was the v3.0.110 CR050 defect *(N3)*.

Every column nullable and the table empty ⇒ **each existing scenario is byte-identical**
(the CR046/CR047/CR050 dormancy pattern). No backfill. Verified against a **fresh
`postgres:16-alpine` running the whole migration chain**, as 042's registry row records — CI
builds from migrations, not an incremental apply *(N6)*.

**Two roles, deliberately separate:**

| field | meaning |
|---|---|
| `loan_principal` | the **% base** — the original amount, fixed for the life of the loan |
| `market_value` | **today's outstanding** (negative), the base-year balance the projection starts from |

An existing mortgage carries both (original 400,000 taken 2015, outstanding −250,000 today).
A future loan carries `loan_principal = 400,000`, `market_value = 0`, and the draw arrives in
`loan_start_date`'s year. **No history is reconstructed** — the loan fields describe the
forward path, `market_value` describes today.

---

## 5. Engine

### 5.1 `fcbuilder-loan.js` — new, pure

```
deriveLoanSchedule({ principal, drawYear, endYear, amortPct[], baseOutstanding,
                     baseYear, horizonEnd }) → { invest[], warnings[] }
```

No db, no fs — unit-testable in isolation (CR043 Phase 2.3 load → compute → persist). It
emits **only `Invest` entries**, the one primitive verified to work on a negative balance.

**`baseYear` is `scenario.PeriodStart − 1` — never the module's `base_date` year.**
Pass 1 proved why (B2): the frame's first column *is* `PeriodStart − 1`, and
`writeValuesToCategoryRow` **discards** anything written before it. A draw placed at
`investValues[0]` propagates into every later `marketValues[i]` and is then dropped on write:

| draw year | module `base_date` | Mortgage row | Transfer - Bank |
|---|---|---|---|
| 2026 | 2025-12-31 | −400,000 from 2026 | +400,000 ✅ |
| **2025** | 2025-12-31 | −400,000 from 2026 | **0** ❌ **liability with no cash** |
| 2026 | 2026-12-31 | −400,000 from **2027** | +400,000 |

Row 3 is the same draw year landing a year later purely because that module carries a
different `base_date` — and dev has **both** values live in every scenario. So:
`drawYear < PeriodStart − 1` is **rejected with a 400**, and the derivation asserts an
invariant that it never emits an entry outside `[PeriodStart−1, PeriodEnd]`.

1. **Draw.** `drawYear > baseYear` ⇒ `Invest[drawYear] = −principal` (a negative Invest pushes
   the balance down and releases cash). `drawYear ≤ baseYear` ⇒ no draw entry; the projection
   starts from `baseOutstanding`. Warn if `drawYear ≤ baseYear` and `baseOutstanding = 0`.
2. **Repayments.** For each schedule row in `(baseYear, endYear)`:
   `principal_y = pct_y/100 × principal`, **clamped to the outstanding balance**, emitted as a
   positive `Invest`. The balance can never cross zero into a phantom asset; a clamp warns.
3. **Remainder.** `endYear` always repays whatever is left (decision 4). Warn only when that
   final repayment exceeds **2× the median** scheduled repayment — a real balloon, never a
   rounding residual.
4. `Σ% > 100` warns (the clamp will bite); `Σ% < 100` does not (it just means a larger final
   year, which rule 3 already judges).

**Injection point** *(pass 1 S1)*: `loadModulesForScenario` sets `mod.Invest` to the derived
array — **replace, never merge**. Stored `forecast_module_investments` rows on a loan module
are ignored by the engine and rejected by the route (§6), so there is exactly one source.

### 5.2 Interest — six lines in `computeModule`

Computed **after** `marketValues` is final, replacing the `expense_amount` branch for loans:

```js
if (module.LoanRate != null) {
  const idx = year - periodStart;
  if (idx < 0 || idx >= inflationLen) continue;          // the guard every sibling loop carries (N2)
  const prev = i === 0 ? (module.MarketValue ?? 0) : marketValues[i - 1];
  expenseValues[i] = -(module.LoanRate / 100) * Math.abs((marketValues[i] + prev) / 2);
}
```

It reads the **authoritative** balance path rather than re-deriving it, so interest cannot
drift from principal. The sign is explicit and negative — cash out — independent of the
`isLiability` tangle §5.5 fixes. The `idx` guard keeps phantom pre-plan interest out of the
audit CSV (`FCModuleAuditModal`) for an existing mortgage.

**The CR046 window must be neutralised, not merely unused** *(pass 1 B4)*. `applyWindow` runs
*after* this block; a residual `expense_start_date`/`expense_end_date` turns
`25,625 … 32,002` into `0 0 0 13,797.66 28,285.21 14,496.17 0 0 0 0`. Two ways stale dates
survive: `buildModulePayload` re-sends them from `editForm` whatever section is rendered, and
a module retyped Asset → Loan keeps them. So **saving a loan module nulls the four window
columns and deletes its `Invest`/`Dispose`/`IncomePct` child rows** — a leftover
`Flag: 'Full'` disposal would otherwise zero the balance and halve the interest at line 461.

**That clear is the only data-destroying operation in this CR, so it is guarded like one**
*(pass 2 M2)*. An irreversible delete of hand-entered schedules, triggered by changing a Type
field, with no confirm and no undo, is not something this codebase ships — CR028 has a
dry-run, CR033 a confirm that spells out the consequence, CR057 a guarded undo. Therefore:

- The API **reports the counts it will destroy** before destroying them (the CR028 dry-run
  shape, sharing the write path), and the UI confirms with those counts **on the first save
  that flips a module to Loan**. A loan module already saved as a loan has nothing to clear,
  so it never re-prompts.
- **On a variant the clear is an override, not a delete.** A raw delete of inherited child
  rows is reversed by the next force-sync from base — handing the module back exactly the rows
  the route then 400s on, which is §5.2's own argument turned around. It goes through
  `variants.interceptSchedules` as `{investments: [], disposals: [], income_pct: []}`, which is
  already how that function replaces a schedule wholesale.
- A **variant-local** loan (`origin_base_id IS NULL`) is untouched by sync, so the plain
  delete is correct there. Both paths are asserted in V19/V20, not assumed.

`growth_rate` is **coerced to 0 on write**, not rejected *(S3)*: `buildModulePayload` always
emits `Growth`, so a module retyped from Asset (Growth 1.0) would 400 on every save with no
visible field to fix. Growth on a liability capitalizes interest into the balance, which would
double-count against the interest line.

### 5.3 Base-year interest — `getBaseYearValues`, not a second derivation

**Correctly-placed insurance, not the first thing that bites** *(pass 1 B1; pass 2 N3)*. It
fires only when an **existing** mortgage is entered — prod has no loan module at all today —
whereas §5.1 and §5.4 bite on the very first loan. `crud.getBaseYearValues`
derives the base-year P&L in SQL from `m.expense_amount`; that figure is both the Review's
base-year column **and** the cash sweep's opening cash (`index.js:509`). A loan's interest is
derived and never stored, so an **existing mortgage** would show **zero interest in the base
year** while every forecast year charges ~12,500 — the sweep opens one year of interest rich
and, because it pins cash to the band every year, the error rides the whole horizon. That is
CR049 §1 exactly, in the function CR049 created to end that class.

Fix: a third UNION branch in the same query — `market_value × loan_interest_rate`, with the
same `halfYear` treatment when the loan is drawn in the base year. **One query, one source.**
A second JS derivation would recreate the drift CR049 removed.

### 5.4 Where the numbers land

Nothing new: balance → the liability account row, interest → the Expense FC Line, principal →
`Transfer - Bank`, both → `Bank Accounts`. **The cash sweep therefore picks up the funding
need with no sweep change** — a year whose payments breach the low band already triggers
CR045's cascade and CR053's auto-adjust.

Two guards on that, though:

- **An Interest Line is required** *(pass 1 B3)*. `cashChange` sums `expenseValuesUSD`
  unconditionally, but the expense only *lands* on a row if
  `df_categories.index.indexOf(module.ExpCategory)` resolves. Probed: a blank or unknown
  `ExpCategory` gives `Bank Accounts +25,625…` with the expense row all zeros — **cash moves
  every year and appears in no P&L line anywhere**. The route 400s on create/update when
  `loan_interest_rate IS NOT NULL` and `expense_fc_line_id IS NULL`.
- **A loan cannot be a cash-sweep source** *(S6)*. `cash-sweep.js` reads
  `moduleBalanceByYear` as an absolute market value, so a −400,000 loan would read as 400,000
  of sellable assets in the CR045 cascade. `CashSweepPriority` / `CashSweepTarget` are
  rejected on a loan module.

### 5.5 Worked example

400,000 drawn 2027, 5.0%, ends 2036, straight-line `11.1111%` across 2028–2035, remainder 2036:

| Year | Balance | Interest | Principal | Cash |
|---|---:|---:|---:|---:|
| 2027 | −400,000 | 10,000 *(½ yr)* | — | **+390,000** |
| 2028 | −355,556 | 18,889 | 44,444 | −63,333 |
| 2029 | −311,111 | 16,667 | 44,444 | −61,111 |
| … | … | … | … | … |
| 2036 | **0** | 1,111 | 44,445 *(remainder)* | −45,556 |

Reproduced to the cent through the real engine in pass 1. *Display convention: the table shows
interest positive as an expense magnitude; storage is negative (cash out) *(N5)*.

### 5.6 The `isLiability` sign fix

Remove the ternary at lines 307, 315, 329 — the expense is **always** negated:

| case | before | after |
|---|---|---|
| asset, `pct_of_value` | `derivedPct>0 × avgMV>0` ⇒ `−val<0` | unchanged ✅ |
| liability (negative MV), `pct_of_value` | `derivedPct<0 × avgMV<0` ⇒ `+val` ❌ | `−val<0` ✅ |
| liability (**positive** MV — the G6 convention, still reachable by hand entry) | `+val` ❌ | `−val<0` ✅ |
| zero-MV fallback (line 315) | `+compounded` ❌ | `−compounded<0` ✅ |
| inflation mode | `+compounded` ❌ | `−compounded<0` ✅ |

`effectiveExpPct` (line 140) is **left alone**: on the legacy pct path the double negative is
intentional and lands correctly for both sides. Only the absolute-amount branches are wrong.

G6 (1.10–1.13) is **retargeted** onto the loan model with prod's negative-balance convention,
and gains a guard asserting the loader zeroes `ExpensePct` — the dead path documented rather
than silently re-tested.

### 5.7 Warnings need a transport

`computeForecastWarnings` (`utils/fcWarnings.js`) is **pure client code** over data `FCReview`
already holds; nothing carries a server-side warning to it, and the module *list* endpoint
does not serve child schedules *(pass 1 B6 — and that omission is the v3.0.97 "Modify Transfer
had never worked" defect)*. Chosen: **keep the pure-function pattern**. The four `loan_*`
columns and the `Amortization` array are added to the modules payload `FCReview` already
loads, and `fcWarnings.js` gains the loan rules. Most of them (`residual at end year`,
`balloon`) are derivable from the **entries** the client already has; only the clamp warning
needs the schedule. *(Rejected: persisting engine warnings + a new transport — larger, and
this CR does not need it.)*

### 5.8 The driving scenario is a CR050 **variant**

`2026 SRQ House Purchase` is scenario **61** with `parent_scenario_id = 47` — it is a
**variant of `2026 Base`**, not a standalone scenario *(pass 2 M1; verified on prod)*. So the
loan the owner actually wants runs through the variant machinery on every build, because
`generateForecast` **force-syncs a variant at Step 0** (`index.js:278`). Three properties,
each asserted rather than assumed:

| case | expected | test |
|---|---|---|
| Loan created **in** SRQ (`origin_base_id IS NULL`) | Variant-local. `syncEntity` only touches rows where `origin_base_id IS NOT NULL`, so the loan and its schedule survive every sync untouched. | V19 |
| Loan defined in `2026 Base`, **inherited** by SRQ with **zero overrides** | Sync re-materializes the child schedules from base ⇒ **identical amortization rows and byte-identical entries**. This is the dangerous one: miss it and the variant's loan has no repayments — a **flat balance that looks deliberate**. | V20 |
| Loan inherited, `loan_interest_rate` **overridden** | The override pins; base's other changes still flow. | V15 |

`Sarasota House` in SRQ carries `base_date = 2026-12-31` while the scenario's other 18 modules
carry `2025-12-31`, and scenario 61's entries span **2026–2062** ⇒ `baseYear = 2026`. Which
branch of §5.1 the owner actually uses therefore depends on the draw year they pick:
`drawYear > 2026` takes the draw-entry path, `drawYear ≤ 2026` takes the type-the-outstanding
path and puts §5.3's base-year interest on the critical path. **V18 exercises the owner's real
choice, not a synthetic one.**

---

## 6. UI

`Type = 'Loan'` (case-insensitive, or `loan_interest_rate != null`) swaps the
Valuation / Expenses sections for a **Loan** section in `fcModulesEditSections.js`:

| field | control |
|---|---|
| Original Loan Amount | number (LC) |
| Year Taken | year picker → `YYYY-07-01` (the CR046 control) |
| Interest Rate (%) | number |
| End Year | year picker → `YYYY-07-01` — *the remainder year* |
| Interest Line | `fc-line-expense` (reuses `ExpenseFcLineId`) — **required** |
| Current Outstanding | `MarketValue`, shown only when Year Taken ≤ base year |
| **Amortization** | the repeated-row percentage editor already used for `IncomePct`, covering `drawYear+1 … endYear−1`, **plus a "Straight line" button** filling `100/n` |

**"Secured Against" is not in the P1 form.** It arrives with P2 (§8), so `fcModulePayload`
and the route allowlist churn once rather than twice *(pass 2 R2)*.

That button is what makes it *simple*: five fields and one click produce a complete loan that
closes at exactly zero.

`Invest` / `Dispose` / `IncomePct` editors are **hidden** on a loan module and the route
**rejects a non-empty** array (an empty array must be accepted — it is how the retype path
clears stale rows, §5.2). The derivation owns `Invest`; a hand-added row would silently add to
the derived schedule, and a hand-added `Dispose` is the §1.3 silent no-op. Early payoff is
expressed by editing the amortization schedule.

---

## 7. The paths that silently drop new fields

Each has broken a previous CR. All are in scope:

| path | why it bites |
|---|---|
| `crud.getBaseYearValues` | §5.3 — base-year interest, and therefore the sweep's opening cash. **The CR049 class.** |
| `repositories.copyScenario` | **Hand-lists 27 module columns** — the class that dropped `cash_sweep_priority` (CR045 §1) and the assumptions (CR048). Needs the 4 columns, the amortization child copy, **and P2's FK remap (§8.2)**. |
| `crud.replaceModuleSchedules` | The actual write path for child schedules — needs an `Amortization` branch *(S4)*. |
| `forecastVariants` | `SCHEDULE_KEYS.forecast_modules` += `amortization`, `SCHEDULE_TABLES.amortization`, `interceptSchedules` → `patch.amortization`. Columns ride along free (sync reads `information_schema`, CR050's deliberate fix); **the child table does not**. |
| `fcModulePayload` | An explicit whitelist — a rendered field this omits is dropped **silently on Save**. Killed CR046's dates and CR047's override (v3.0.86). Its FIELD_SECTIONS coverage test catches the columns; the **`Amortization` array must be added by hand**. |
| `routes/forecast.js` | `MODULE_WRITE_FIELDS`, `assertModuleBody`, create/update DTO, and the four loan guards (interest line required, sweep rejected, growth coerced, schedules rejected). The API 400s on unknown fields, so an omission here fails **loudly** — unlike the five above. |
| `repositories.createModule` / `updateModule` | INSERT column list + `allowedFields`. |
| `crud.refreshModulesFromActuals` | *(S2)* It updates `base_value`/`base_date` and deliberately **not** `market_value` ("broker-reported MV cannot be derived from the ledger"). For a loan, `market_value` **is** the outstanding, and a mortgage account's ledger balance derives it exactly. Loan modules opt **in** to the MV refresh. The `base_date` shift is harmless — derive-on-generate absorbs it, which is a point in the design's favour. |

---

## 8. Phase 2 — securing a loan against an asset, and the Equity report

**Migration 048.** One column on the **loan** row:

```sql
ALTER TABLE forecast_modules
  ADD COLUMN IF NOT EXISTS secured_asset_module_id INTEGER
    REFERENCES forecast_modules(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fc_modules_secured_asset ON forecast_modules(secured_asset_module_id);
```

Many loans → one asset (mortgage + HELOC on one house). **Any** module qualifies as the
asset, not just Real Estate — a margin loan against a brokerage account and a shareholder loan
against a business are the same shape. Route guards: same scenario, target is not itself a
loan, no self-reference.

### 8.1 The report

New page `/forecast-equity` + `GET /api/v2/forecast/equity?scenario=…`, in the Forecast
sidebar (the step nav derives from `routes.jsx`, CR042 — no second hand-kept list).

It needs **no engine work**: `forecast_entries` already carries `(forecast_year, account,
module, amount)`, and `UNIQUE(scenario_id, name)` on `forecast_modules` makes the module name
a safe join key within a scenario.

**But not for the obvious reason** *(pass 2 N2, re-verified on prod)*. `forecast_entries` has
`UNIQUE(scenario_id, forecast_year, account, module, entry_type)` — and `entry_type` is
**NULL on all 7,788 rows**, so that constraint never arbitrates. Prod carries **570** duplicate
`(scenario, year, account, module)` groups today. **Zero of them sit on a BS-module name** —
every one is an income/expense item sharing an FC-line label. The report is safe because it
reads *module* rows, not because the key is unique, and a future reader must not take the
constraint at face value.

Per asset, with years as columns (the CR040/CR054 house layout):

| row | source |
|---|---|
| Asset value | asset module's balance entry |
| Less: loan balance | Σ over secured loans of their balance entries |
| **Equity** | the difference |
| Asset income | asset's income line |
| Asset expense | asset's expense line |
| Loan interest | Σ over secured loans of their interest lines |
| **Net income** | income − expense − interest |
| Principal (and draw) | the loans' `Transfer - Bank` entries |
| **Net cash after debt service** | net income − principal |

Two bottom lines on purpose: principal is a **transfer**, not an expense, so folding it into
"net income" would misstate the P&L — and leaving it out would misstate the cash. CR056's
discipline about not conflating flows applies directly. The value block and the flow block are
separated, as CR056's layout settled.

**Graph** (recharts, already a dependency): gross asset value and equity as two lines with the
debt as the shaded gap between them — the equity build, which is exactly the ask. Net income
as an optional bar series.

**USD only, by construction** — every `forecast_entries` amount is already USD
(`marketValuesUSD` is what the builder writes). A EUR asset with a EUR loan reports in USD.
CR054's USD ⇄ original toggle is the precedent if that is ever wanted; it is not built here.

### 8.2 The FK remap trap — the thing most likely to go silently wrong

`copyScenario` inserts modules one at a time. A naive copy carries the **source** module's id
in `secured_asset_module_id`, so the copied scenario's report would read **the source
scenario's asset** — cross-scenario contamination that no balance check can see, because both
numbers are real. Same for CR050 variant materialization, where the override patch stores a
**base-scenario** module id that must be translated on sync.

Required, and tested by asserting on the **copy** rather than the source:

- `copyScenario` builds an `oldId → newId` map and runs a **second UPDATE pass** to repoint
  `secured_asset_module_id`.
- Variant sync resolves the link through `origin_base_id`.
- A verification query asserts **no `secured_asset_module_id` crosses a scenario boundary** —
  it belongs in the migration's `DO` block and in a test.

---

## 9. Verification

Falsify first, then fix — every assertion must be shown failing against current `main`.

| # | Test | Falsifiable because |
|---|---|---|
| V1 | Liability + `expense_amount 25,000` ⇒ interest **−25,000** to cash | `main` returns **+25,000** |
| V2 | Loader guard: `ExpensePct` is 0 after `loadModulesForScenario` | Documents why G6 was retargeted. *Pass 2 R4 calls this the only ceremony in the list — keep it **only** if it stays three lines.* |
| V3 | Pure derivation reproduces §5.5 to the cent | Exact table, not a shape assertion |
| V4 | Draw-year interest = `r × P / 2` **exactly** | Replacing the average with a spot balance doubles it |
| V5 | **The whole `Bank Accounts` row of §5.5 through `computeModule`** | The failure class is silently-wrong *cash*; V3 tests only the pure half |
| V6 | **Existing mortgage** (`drawYear ≤ baseYear`, outstanding −250,000): base-year interest appears in `getBaseYearValues` **and** the sweep's opening cash | The B1 path — zero before the fix |
| V7 | `drawYear = PeriodStart − 1` ⇒ **400**, and the derivation never emits outside `[PeriodStart−1, PeriodEnd]` | B2's vanishing draw; asserts on `Transfer - Bank`, which reads 0 today |
| V8 | Blank Interest Line ⇒ **400** | B3 — today it silently drains cash into no P&L row |
| V9 | Retype Asset → Loan clears window dates + child schedules; a stale `Flag:'Full'` no longer halves interest | B4, with the exact 13,797.66 counter-example |
| V10 | `Σ% = 100` straight-line ⇒ balance **exactly 0** at `endYear` and **no warning** | The one-click happy path, and decision 4's whole point |
| V11 | `Σ% = 150` ⇒ clamps at 0, never positive, warning raised | Unclamped, the loan flips into an asset |
| V12 | Interest-only schedule ⇒ balloon warning fires (final > 2× median) | Distinguishes a real balloon from rounding |
| V13 | **Non-USD (PLN) loan**: LC interest ÷ `fxrates[i]` | The class CR051's F1 guard exists for |
| V14 | Loan rejected as a cash-sweep source | S6 — otherwise −400,000 reads as sellable |
| V15 | **Copy** a scenario with a loan ⇒ 4 columns + amortization rows + **P2 FK repointed to the copy's own asset**; variant override of `loan_interest_rate` survives sync | §8.2. Asserting on the source proves nothing (CR045 §1) |
| V16 | `buildModulePayload` carries every new field incl. `Amortization` | Extends the FIELD_SECTIONS coverage test |
| V17 | **Dormancy:** regenerate `2026 Base`, diff all 1,426 entries | *Expected to pass trivially* — all 12 liability modules carry `expense_amount = 0`, so the sign fix cannot move an existing number **by construction**. Kept as the dormancy proof; **V1 is what proves the fix**, not this. |
| V18 | End-to-end on dev: build the Sarasota mortgage in `2026 SRQ House Purchase` **at the draw year the owner actually wants**, read the cash flow **and the P2 Equity report in a browser** | The v3.0.97 lesson — a UI fix verified only by unit test is worse than none. §5.8: the draw year decides which §5.1 branch is even exercised |
| V19 | **Variant-local loan** (created in SRQ, `origin_base_id IS NULL`) survives a force-sync with schedule intact | §5.8. `generateForecast` syncs on every build, so this runs constantly in the owner's real scenario |
| V20 | **Inherited loan, zero overrides**: sync re-materializes the amortization rows and the variant's entries are **byte-identical to base's** | §5.8's dangerous case — the failure is a flat balance that looks deliberate, not an error |
| V21 | Retype-to-Loan **reports the counts it will destroy** before destroying them; on a *variant* the clear is an override that survives the next force-sync | §5.2 / pass 2 M2 — a raw delete is silently reversed by sync |

---

## 10. Out of scope

- **Annuity / level-payment** amortization. The explicit % schedule is strictly more flexible;
  an `amortization_method` column could add it later.
- **Variable interest rates** — one rate for the life of the loan. A per-year rate schedule
  would reuse the amortization table's shape exactly.
- **Mortgage interest deductibility.** The engine taxes gains and income only; expenses have
  no tax effect anywhere, so there is nothing to hook.
- **Refinancing** — model as a second loan plus a short schedule on the first.
- **LTV covenants / stress tests** on the P2 report. LTV is one division away once the report
  exists; not built here.

---

## 11. Status

| Item | Phase | State |
|---|---|---|
| **`isLiability` sign fix + G6 retarget — standalone patch release** | **P0** | ⬜ |
| Migration 047 | P1 | ⬜ |
| `fcbuilder-loan.js` (pure derivation) | P1 | ⬜ |
| `computeModule` interest branch + window neutralisation | P1 | ⬜ |
| Retype-to-Loan clear: dry-run counts, confirm, variant override path | P1 | ⬜ |
| `getBaseYearValues` loan branch | P1 | ⬜ |
| Repo columns / create / update / **`copyScenario`** / `replaceModuleSchedules` / `refreshModulesFromActuals` | P1 | ⬜ |
| Route DTO / allowlist / validation / four loan guards | P1 | ⬜ |
| `forecastVariants` schedule wiring | P1 | ⬜ |
| `FCModulesEdit` Loan section + straight-line fill | P1 | ⬜ |
| `fcModulePayload` + coverage test · `fcWarnings` loan rules | P1 | ⬜ |
| Migration 048 + FK remap in copy/variant paths | P2 | ⬜ |
| `GET /forecast/equity` + `/forecast-equity` page + chart | P2 | ⬜ |
| V1–V21 | | ⬜ |
| Deploy | | ⬜ |

**Deploy path** *(pass 2 R3)*: `Scripts/deploy-to-production.sh` **Step 2b applies pending
migrations before the code**, which is what satisfies schema-before-code for 047 and 048 — no
manual `psql` step. Note that **044 is reserved by CR059 P3a and unapplied**, and
`server/db/migrate.js` is lexicographic and ledger-driven, so 044 will apply **out of order**
whenever CR059 P3a lands. Harmless to this CR — 044 is a feed-mapping crosswalk and touches no
forecast table — but written down rather than discovered.

**Sequencing against the live backlog** (pass 2's recommendation): **P0 first**, ahead of
everything, since it is minutes and de-risks the rest. Then **CR060's fin recon page** (small,
half-built, closes a live incident class — Bank Pekao unhealthy since 2026-07-24). Then
**CR062 P1** during CR059's P2 parallel-run window, while CR059 is paced by its observation
period. **P2 after CR059's P4 cutover** — a forecast page and a feed cutover should not ride
the same prod deploy off a shared trunk. CR061 stays behind all of it.
