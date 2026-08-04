# CR069 — Forecast streams: one Modules section for everything Expenditures and Modules do today — OPEN

The Forecast setup collapses from two entity types to one. A **module** becomes *identity +
optional valuation + zero-or-more P&L **streams***; a stream is a first-class row (direction,
FC line, generator mode, change schedule, window, tax override). Every Expenditure item is then
an ordinary module with no valuation and one stream, the Expenditures step and its entire UI
stack retire, and the engine keeps **one** stream evaluator instead of the three divergent
implementations it carries now. Output contract unchanged: `forecast_entries` and everything
downstream of it (Review, Compare, Multi-Compare, sweep, variants materialization, AI review)
keep working against the same rows.
[Roadmap](../current/project-roadmap.md#cr069)

**Opened:** 2026-08-04 · **Track:** v3 · **Migrations:** three — P1 (schema, inert), P2
(backfill + override/origin rewrite, rides the cutover deploy), P3 (drops four tables). Numbers
assigned at build (next free is 057 today, and this repo's numbering has moved under a CR
before); each gets its `migrations.md` row.
**Depends on:** [CR003](cr-003-forecast-module.md) (both builders) · [CR041](cr-041-module-ownership-gating.md)
(ownership gate — re-keyed here) · [CR046](cr-046-module-income-window-and-hierarchy-graph.md) /
[CR047](cr-047-module-income-tax-override.md) (window + tax, generalized to both directions) ·
[CR050](cr-050-forecast-scenario-variants.md) (variant sync must carry streams) ·
[CR051](cr-051-forecast-expense-currency.md) (FX fail-loud, unchanged) ·
[CR062](cr-062-forecast-loan-module.md) (loan interest becomes a `derived` stream) ·
[CR064](cr-064-forecast-annual-close-and-assumptions.md) (P6 steps are absorbed; §5's objection is
answered structurally; §9.1's anchor split is stated as a rule)

**Phases.** Four separately shippable pieces; each leaves the app fully working. Nothing parks
half-finished in the shared tree (Known Issue #17's class, four incidents old).

| | scope | gate |
|---|---|---|
| **P0** | The attribution fix, alone: inc/exp entries labeled by item **name**, not account; audit CSV filename follows; the false ON CONFLICT comment corrected — §3 | Per-(account, year) sums over `forecast_entries` identical to the cent, all five scenarios, prod copy. Three items become visible under their own names. |
| **P1** | Schema **only**: `forecast_streams` (+ changes), `has_valuation` — empty, nothing writes or reads them — §5 | migration-reviewer pass; **byte-identical builds** (trivially — the tables are empty). |
| **P2** | **Backfill migration + engine cutover, one deploy** (§6 + §7): convert all 60 inc/exp items to flow modules, rewrite the 3 incexp overrides + 48 origin links, one stream evaluator, `fcbuilder-incexp.js` deleted; loaders, `getBaseYearValues`, `copyScenario`, auto-adjust, AI review, variant sync read streams. **The old write paths die here too** — the four `/incomeexpense` routes 410 and the Expenditures step disappears from the nav (§7.6); only the bulk deletion waits for P3 | Backfill counts assert exactly (§6.4). **The sums gate (§9): per-(account, year) sums identical to the cent, all five scenarios, on a prod copy.** Full backend suite; the semantics tests in §9.2. A write to `/incomeexpense` fails loud, not silently stale. |
| **P3** | UI cutover + drop: stream cards in the Modules editor, Expenditures step retired (6 steps → 5), `FCExp*` deleted, four tables dropped — §8 | Frontend suite; all six ratchets non-increasing; the five-step nav consistent in stepper + sidebar; grep proves no reader of the dropped tables remains. |

**Sequencing with the other forecast threads** *(set at PM sign-off)*: **CR064 P2/P4/P5/P10
build behind CR069 P2.** `copyScenario` is in this CR's scope (§7.4), so annual-close work built
first would be built against tables deleted weeks later; the close is not needed until the
2026→2027 boundary, so this ordering costs nothing. CR064's *owner-decision* items may proceed;
its code should not. CR066 P0 (a zero-code decision session) and CR059 (feed surface) run in
parallel freely — but **deploys serialize around P2** (hazard 4). Two items go to the owner at
kickoff, currently settled by review rather than by them: **Decision 9's inheritance coarsening**
(a variant that overrides one field of a stream stops inheriting base edits to that stream's
other fields — affects their 3 live incexp overrides) and **§6.1's deferred question** (whether
the three yield-mode modules' dead typed amounts, and the Period-1 tax they book, should survive
long-term — this CR preserves them).

**Why the backfill rides P2's deploy, not P1's** *(restructured at technical review — was a
blocker)*: nothing dual-writes the new tables, so a backfill that lands before the cutover goes
**stale on the first edit** — every module/incexp save, `syncVariant`, auto-adjust apply and
`copyScenario` would keep updating only the old tables, and P2 would cut over to whatever the data
looked like at P1 time: wrong numbers, no error. Schema first (P1, inert), backfill and cutover
atomically together (P2), exactly like the migrations-before-code rule this repo already runs
deploys under.

## 1. Problem

The system contains **three separate implementations of the same concept** — "a money stream that
grows from a base-year amount":

| implementation | growth control | change schedule | window | per-stream tax | entry label |
|---|---|---|---|---|---|
| Expenditure item ([fcbuilder-incexp.js](../../server/src/services/forecast/fcbuilder-incexp.js)) | `growth_rate` × inflation | **Percent % / Fixed $ / One-Off $** (115 rows live) | none | none | account/FC-line name |
| Module income (fcbuilder-module.js:485-519) | `income_growth_rate` × inflation (CR064 P6) | steps ≡ Fixed $ only | CR046 | CR047 two-rate chain | module name |
| Module expense (fcbuilder-module.js:346-425) | inflation **flat — no multiplier** | none | CR046 | none | module name |

The tell that this is accidental: **CR064 P6's `forecast_module_income_steps` (migration 055) is a
re-implementation of the Fixed $ change** that `forecast_incexp_changes` has had since migration
001. The math is the same — `base[i] = base[i-1]·(1+g) + fixed[i]` compounds the added amount from
its own year at the stream's growth rate, which is exactly the semantics P6 specified. The project
built the same feature twice because the two stream types live in different tables.

Every asymmetry in that table is an owner question whose answer is "wrong table": a window on
Travel, an expense that outgrows inflation, a Percent % change on a business's income. And the
split costs real structure:

- **Two UI stacks** — ~2,770 lines of `FCExp*` + ~4,200 of Modules UI — two CRUD route sets, two
  variant entity types, two auto-adjust branches, and `getBaseYearValues` glued from two halves.
- **Three prod items are invisible under their own names** (§3).
- **A pure-P&L module is inexpressible**: CR041's gate reads `MarketValue` 0-forever as "never
  owned" and zeroes every amount stream (fcbuilder-module.js:292-293) — which is *why* Expenditures
  must exist as a separate type today. Prod shows the residue: five `Sarasota House` rows carry
  `expense_amount = 45,000` on `market_value = 0`, parked on `setup_status = 'exclude'`.
- **Two base anchors** (CR064 §9.1): valuation series start at the module's own `base_date`; every
  P&L amount anchors at `PeriodStart − 1`; the Expenditure table has a `base_date` column its own
  engine never reads.

## 2. Decisions

Direction (one Modules section, streams as the unifying abstraction) was agreed with the owner
2026-08-04. The detail decisions below are locked unless marked open.

| # | Question | Decision |
|---|----------|----------|
| 1 | Discriminate with a `kind` column? | **No — streams are rows, not a type flag.** [CR064 §5](cr-064-forecast-annual-close-and-assumptions.md) killed per-type field gating for three reasons; the load-bearing one is that *fields are columns sent on every save*, so a hidden field is a stale live value. Rows dissolve that class: a module with no expense **has no expense stream** — there is nothing to go stale, no `loan-retype-preview` equivalent needed, and `module_type` stays what CR064 made it: a free-text label. |
| 2 | Where does "no balance sheet" live? | **`has_valuation BOOLEAN NOT NULL`** on the module, explicit — not inferred from `market_value = 0`, which is exactly the ambiguity that breaks CR041 today (a real asset worth nothing vs. a stream container). `has_valuation = FALSE` ⇒ engine skips the balance path, writes no MV entries, and the ownership gate stands down (§7.3). |
| 3 | One stream per direction, or N? | **N — bounded by two structural rules** *(tightened at technical review — was a blocker)*. (1) The evaluator fills **one** category frame per module across *all* its streams, so exactly one `forecast_entries` row per (module, account, year) is ever written — two same-line streams sum in the frame, never as duplicate NULL-`entry_type` rows, which the convergence loop's `UPDATE … SET amount = amount + $1` (index.js:993-1009) would otherwise double-apply. (2) **At most one `yield` stream per module** (the convergence loop assumes one yield context per module), enforced by the route, plus `UNIQUE (module_id, direction, fc_line_id)` so "two streams" always means two *lines*. Today's data is ≤1 per direction, so the migration creates at most two per module. |
| 4 | Change-schedule semantics | **One table, four flags, each unambiguous** (§5.2): `Percent %` (that year's growth override — single year), `Fixed $` (permanent level shift, compounds from its own year — absorbs P6 steps), `One-Off $` (single-year spike), `Spread %` (carry-forward yield spread — absorbs `forecast_module_income_pct`). Flag determines semantics; mode determines which flags are legal. |
| 5 | Sign convention | **Stream `amount` stored positive; `direction` supplies the sign** (module convention wins), derived from `item_type` with the stored sign as cross-check (§6.4). **Change amounts stay SIGNED, in the stream's direction frame** (positive = *more* of the stream, negative = less) — the migration **negates** Fixed $/One-Off $ rows on expense-direction streams (×−1), and must never take magnitudes: 20 of prod's 35 Fixed $ rows are **positive amounts on negative expense bases** — deliberate *reductions* (`Children` +25,000 in 2027 when the kids leave; `Travel` +15/20/30K ramping down with age). `abs()` would silently invert all 20 into expense increases — the worst defect class this codebase knows. Percent % rows are signed growth deltas and are **not** touched. *(Rewritten at technical review — was a blocker.)* |
| 6 | Base anchors | **Stated as a rule, one sentence: valuation anchors at `base_date`; every stream anchors at the base year (`PeriodStart − 1`).** This is what both P&L paths already do — the CR changes no anchor, it removes the table whose unread `base_date` column made the split look optional. CR064 P10 (base-year P&L from `budget_entries`) remains its own item and is neither blocked nor built here. |
| 7 | Entry labels | **Every entry labels by module name** — P0 makes the inc/exp side do this *before* the merge, because a merged world can only have one labelling rule and the current one hides data (§3). |
| 8 | Loans | The interest line moves onto a **`derived`-mode expense stream** (engine-owned amount; the form shows the stream read-only with its FC line editable). `loan_interest_rate` stays the switch, on the module, exactly as CR062 built it. The route guard "a loan must have an interest line" becomes "a loan must have exactly one derived expense stream with an FC line". |
| 9 | Variant model | **Streams are a child schedule of the module** — `SCHEDULE_KEYS` gains `streams`, replaced **wholesale** in a patch like `investments`/`amortization`, *including their change rows* (the one two-level copy; §7.5). Entity types shrink from `module` + `incexp` + `assumption` to `module` + `assumption`. **Accepted trade-off** *(named at technical review)*: today's incexp overrides are column-level (`{"base_value": …}`), so a variant that tweaks one field still inherits base edits to the others; a `streams` schedule patch pins the **whole stream set including changes** — a variant that overrides Travel's amount stops inheriting future base edits to Travel's changes/growth/window, and the overrides panel's "was → now" coarsens the same way. This is the semantics every *other* schedule (investments, amortization) already has, prod has exactly 3 incexp overrides, and per-stream override entities would be a second overrides model — not worth it. |
| 10 | What happens to `/forecast-setup-exp` | Retired in P3. The six-step nav becomes five (`FCStepNav` derives from route config, so this is a routes.jsx edit); "Add from Lines" (budget-seeded) joins "Add from Actuals" as a second seeding path into module creation. |

## 3. P0 — the attribution defect, fixed first and alone

`computeModule` in fcbuilder-incexp labels entries with `module.Account`
(fcbuilder-incexp.js:217) — the FC-line/account name, not the item's name. On prod `2026 Base`,
three of twelve items therefore emit **zero entries under their own names**: `Retirement Home`
files under `Living Expenses`, `Car Purchase Chris` under `One-Off Items`, `Social Security` under
`Total Salary`. Retirement Home's −200,000 Fixed $ in 2052 is visible only as `Living Expenses`
suddenly carrying two rows:

```
2051 | 1 row  | -153,911.63
2052 | 2 rows | -357,759.42   ← Retirement Home, inside Living Expenses
```

Every breakdown, audit-trail click-through and per-module query is blind to these three items.

**The code comment claiming this is safe is wrong.** fcbuilder-common.js:49-51 and
fcbuilder-incexp.js:66-68 say two items on one account "overwrite each other via ON CONFLICT —
live semantics, preserved". They do not: the unique index is
`(scenario_id, forecast_year, account, module, entry_type)`, the writers never set `entry_type`,
and NULLs are distinct in a Postgres unique index — **the ON CONFLICT clause has never once fired
for these rows**; they are silently additive. The *sums* are right (which is why nothing ever
looked wrong); the attribution and the comment are not.

P0 does three things, nothing else:

1. Label inc/exp entries with the item **name** (`module.Name`), as the BS builder always has.
2. Name the audit CSV by item (`writeEntriesAuditTrail` currently keys the filename on account
   too), so the Review breakdown's audit click-through — which matches
   `/audittrail/:scenario/:module` by sanitized module label (forecast.js:1690) — still resolves.
3. Correct the two comments to describe reality (additive rows, per-name labels).

**Gate:** on a prod copy, regenerate all five scenarios; per-(account, year) sums of
`forecast_entries` are identical to the cent before/after. Row *counts* may change (that is the
point: three items get their own rows back). This ships on its own release and stands even if
nothing else in this CR is ever built.

## 4. The model

```
Module  = identity   (name, account, type label, currency, status, comment)
        + valuation  (optional: base/market value ×2 currencies, growth,
                      invest/dispose, loan assumptions, sweep rank)
        + streams[]  (zero or more)

Stream  = direction  income | expense
        + FC line
        + mode       amount | yield | pct_of_value          (derived: engine-only)
        + amount     base-year, LOCAL currency, positive
        + growth     multiplier × inflation (NULL = 1)
        + changes[]  Percent % | Fixed $ | One-Off $ | Spread %
        + window     start/end year, July-1 half-year convention (CR046, unchanged)
        + tax        rate override — INCOME streams only (CR047 chain)
```

Tax stays income-only *(narrowed at technical review)*: no path today taxes an expense — both
builders tax positive values only — and an editable tax field on an expense card that does
nothing is exactly the stale-field class CR064 §5 killed. The route rejects it like it rejects a
`Spread %` on an amount stream.

Everything that exists today is a degenerate case:

| today | in the model |
|---|---|
| Expenditure item | module, `has_valuation = FALSE`, one amount stream |
| Module income — amount (+ P6 steps) | amount stream (steps → Fixed $ changes) |
| Module income — yield (`IncomePct`) | yield stream (`income_pct` → Spread % changes) |
| Module expense — 'inflation' method | amount stream (multiplier NULL = 1 ⇒ identical) |
| Module expense — 'pct_of_value' | pct_of_value stream |
| Loan interest (CR062) | derived stream, engine-owned |
| `forecast_module_income_steps` (055) | **deleted** — Fixed $ changes |
| `forecast_module_income_pct` (001) | **deleted** — Spread % changes |
| `forecast_income_expense` + `forecast_incexp_changes` | **deleted** — flow modules + stream changes |

## 5. Schema (P1)

### 5.1 New tables

```sql
CREATE TABLE forecast_streams (
  id                SERIAL PRIMARY KEY,
  module_id         INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
  direction         VARCHAR(10) NOT NULL CHECK (direction IN ('income', 'expense')),
  fc_line_id        INTEGER REFERENCES fc_lines(id) ON DELETE RESTRICT,
  mode              VARCHAR(15) NOT NULL DEFAULT 'amount'
                      CHECK (mode IN ('amount', 'yield', 'pct_of_value', 'derived')),
  amount            NUMERIC(15,2),          -- base-year, module currency, >= 0
  amount_usd        NUMERIC(15,2),          -- CR051 twin, derived server-side on write
  growth_mult       NUMERIC(8,4),           -- x inflation; NULL = 1 (dormant default)
  start_date        DATE,                   -- CR046 window, July-1 convention
  end_date          DATE,
  tax_rate_override NUMERIC(8,4),           -- CR047; income streams only; NULL = fall back; 0 is a real rate
  CHECK (amount IS NULL OR amount >= 0),
  CHECK (direction = 'income' OR tax_rate_override IS NULL),
  UNIQUE (module_id, direction, fc_line_id)  -- Decision 3: two streams means two lines
);
CREATE INDEX idx_fc_streams_module ON forecast_streams(module_id);
CREATE INDEX idx_fc_streams_line   ON forecast_streams(fc_line_id);

CREATE TABLE forecast_stream_changes (
  id          SERIAL PRIMARY KEY,
  stream_id   INTEGER NOT NULL REFERENCES forecast_streams(id) ON DELETE CASCADE,
  change_date DATE NOT NULL,
  amount      NUMERIC(15,2) NOT NULL,       -- SIGNED, direction frame (Decision 5). No sign CHECK, deliberately.
  flag        VARCHAR(20) NOT NULL
                CHECK (flag IN ('Percent %', 'Fixed $', 'One-Off $', 'Spread %'))
);
CREATE INDEX idx_fc_stream_changes_stream ON forecast_stream_changes(stream_id);

ALTER TABLE forecast_modules ADD COLUMN has_valuation BOOLEAN NOT NULL DEFAULT TRUE;
```

Deliberate omissions and column rules:

- **No `note` column** on changes — `forecast_incexp_changes.note` has 0 non-empty values on prod;
  dropped knowingly.
- **`amount_usd`** is the CR051 write-path twin, populated for converted inc/exp items (straight
  copy of `base_value_usd`) and by future saves; **NULL for module-derived streams** — the read
  path (`getBaseYearValues`) converts uniformly at the scenario's base-year rate (CR064 P8's
  `rateFor`), so a NULL twin can never desync a sum.
- **Mode legality extends to columns, not just flags**: `growth_mult` is amount-mode-only;
  `yield` and `pct_of_value` are illegal on a `has_valuation = FALSE` module (no value to yield
  on). Enforced in the route; the migration can assert it.

`forecast_modules` keeps identity, valuation, loan and sweep columns. The eight stream columns
(`income_amount`, `income_fc_line_id`, `income_growth_rate`, `income_start_date`,
`income_end_date`, `income_tax_rate_override`, `expense_amount`, `expense_fc_line_id`,
`expense_growth_method`, `expense_start_date`, `expense_end_date`) stop being read at P2 and are
dropped at P3 with the four retired tables.

The CR047 rate chain maps cleanly: a stream's `tax_rate_override` is CR047's
`income_tax_rate_override` when set; the module-level `tax_rate_override` (gains) stays on the
module, because a capital gain belongs to the valuation, not to a stream.

### 5.2 Change flags — the semantics, pinned

The four flags are the union of what exists, each with **one** meaning (the current system has two
tables whose "percent" rows mean different things — that distinction becomes explicit):

| flag | semantics | today's source | legal on mode |
|---|---|---|---|
| `Percent %` | overrides the growth % **in that year only**; other years keep multiplier × inflation | `forecast_incexp_changes` Percent % (fcbuilder-incexp.js:140-141) | amount |
| `Fixed $` | permanent level shift; **compounds from its own year** at the stream's growth | incexp Fixed $ **and** P6 steps — same math, verified | amount |
| `One-Off $` | that year only; does not enter the base | incexp One-Off $ | amount |
| `Spread %` | yield spread over inflation; **carries forward** until the next Spread % row | `forecast_module_income_pct` step function (fcbuilder-module.js:187-206) | yield |

The route rejects a flag illegal for the stream's mode, for the same reason CR062 rejects a stored
schedule on a loan: a row the engine will never read is a lie waiting to be believed.

Two more rules, both from technical review:

- **A change dated before the base year is refused on write and ignored by the engine** — the
  incexp bounds-check behavior (fcbuilder-incexp.js:138-139), pinned. The two sources disagree
  today (P6 steps *count* a pre-horizon step, grown from its own year, fcbuilder-module.js:514-515);
  no prod row exercises either (earliest change 2027-12-31, earliest step 2027-07-01), so either
  choice passes the sums gate — but the evaluator gets **one** behavior and a §9.2 test, not an
  inherited ambiguity.
- **A mode change is the loan-retype discipline in miniature**: switching amount → yield leaves
  Percent/Fixed/One-Off rows and a dead `growth_mult` behind — stored rows the engine will never
  read again. The route refuses a mode change that strands rows unless the request also clears
  them; the UI confirms and deletes, exactly as the Asset → Loan retype does.

## 6. Backfill (rides P2's deploy, atomically with the cutover — see the phase-table note)

### 6.1 From module columns

For each of the 110 modules: an expense stream where `expense_amount ≠ 0` **or**
`expense_fc_line_id` is set (mode from `expense_growth_method`); an income stream where
`income_amount ≠ 0`, `income_fc_line_id` is set, **or** `income_pct` rows exist (mode `yield` iff
`income_pct` rows exist — the `hasIncomePct` precedence at fcbuilder-module.js:434, now structural).
Loans get their `derived` expense stream carrying the old `expense_fc_line_id`. P6 step rows →
Fixed $ changes; `income_pct` rows → Spread % changes.

**A yield stream carries the legacy typed amount forward, deliberately** *(added at technical
review — was a blocker)*. Three prod modules sit in yield mode with a non-zero `income_amount`
the projection loop ignores (CVC Fund VIII 25,800 · Fidelity Stocks 40,000 · Fidelity Fixed
Income 46,000) — but the **base-year tax block** (fcbuilder-module.js:670-689) has no
`hasIncomePct` guard and books Period-1 tax on those dead amounts today. Dropping the amount at
backfill would silently delete that tax and fail the sums gate. The amount rides along unread by
the projection, read by the base-year tax — the quirk is *preserved*, and §9.2 pins it; whether
to retire it is an owner decision for another day, because the stated gate of this CR is "no
number moves".

### 6.2 From Expenditure items

Each of the 60 `forecast_income_expense` rows becomes a module:
`has_valuation = FALSE`, name/account/currency/comment/`setup_status` carried over (the
`setup_status NOT IN ('new','exclude')` build filter applies unchanged), plus one amount stream
(`fc_line_id`, magnitude of `base_value`, `base_value_usd` twin, `growth_rate` → `growth_mult`),
and its change rows sign-adjusted per Decision 5 — **negated for expense-direction streams,
never `abs()`'d** (the 20 positive-Fixed-$-on-expense reduction rows must stay reductions).
`budget_source_year` carries onto the module (it is provenance, not math).

**The Taxes special case ports explicitly.** An item whose resolved account label is `Taxes` has
its own values folded into the tax row (fcbuilder-incexp.js:202-206). The unified evaluator keeps
this behavior keyed on the same label; §9.2 pins it with a test, because it is exactly the kind of
one-line special case a rewrite silently loses.

### 6.3 Variants and overrides

- The 48 materialized variant items (12 × 4 variants) become flow modules whose
  `origin_base_id` points at the **new base module** created from the same base item — the
  mapping rides the migration in one transaction.
- The **3** live `incexp` overrides are rewritten as `module` overrides against the new base ids,
  their patch keys translated (`base_value`/`growth_rate`/`changes` → the stream schedule patch).
  Three rows: hand-verified in the migration, asserted by §6.4.
- `UNIQUE(scenario_id, name)` holds on `forecast_modules`; a name collision between an existing
  module and a converted item aborts the migration (none exists on prod or dev today — verified —
  but the migration must fail loud, not rename silently).

### 6.4 Counts asserted in-migration

Fail-loud `DO` blocks (mindful of Known Issue #12 — guards must tolerate a **data-free** database,
the class that broke CI three times: every assertion is of the form *converted = source*, which
holds vacuously at 0 = 0):

- flow modules created = `forecast_income_expense` rows (60 on prod);
- stream change rows from incexp = `forecast_incexp_changes` rows (115), each verifying
  **|amount| preserved AND amount × direction-sign preserved** — *not* "sign matches direction",
  which the 20 reduction rows legitimately violate (Decision 5);
- Spread % rows = `forecast_module_income_pct` rows; Fixed $ (from steps) = step rows;
- rewritten origin links = 48; rewritten overrides = 3 (prod values; the assertions compare
  counts, not literals).

## 7. Engine (P2)

### 7.1 One evaluator

`computeStream(stream, module, scenario, frames…)` replaces the three implementations. Amount
mode is today's incexp math **plus** window, gate and tax (which the incexp path never had —
but with no window rows and no overrides backfilled, those paths are dormant no-ops on day one);
yield and pct_of_value modes are the module paths verbatim; derived mode reads the loan balance
path exactly as CR062 wrote it. `fcbuilder-incexp.js` is **deleted**, along with
`loadIncExpModulesForScenario` and `loadIncExpCategoriesForScenario` (index.js:192-309).

### 7.2 What each mode keeps, byte-for-byte

- **CR051 F1** — a non-USD stream with no usable FX rate **throws** (both builders already do).
- **CR064 P13** — the USD-label contradiction check, on the module, unchanged.
- **Tax deferral by one year**, the CR047 rate chain, the CR046 half-year window convention, the
  CR041 gate-vs-window 25% interplay (fcbuilder-module.js:600-611) — all carried, all pinned by
  the §9.2 tests.
- **The deferred base-year income tax** (fcbuilder-module.js:670-689) *(added at technical review
  — was a blocker; it is the one live divergence between the two builders)*: Period-1 tax on the
  base-year typed amount, booked whenever `absIncomeAmount > 0 && acquisitionIdx === 0`, with
  **no** yield-mode guard — so it fires for Barkeria and United Beverages (amount mode) *and* on
  the three yield-mode modules' dead typed amounts (§6.1). It is **keyed on `has_valuation =
  TRUE`** in the unified evaluator: the incexp path has no such block (fcbuilder-incexp.js:174-180
  taxes forecast years only), so a converted flow item with positive income (Total Salary, 3,786)
  must NOT gain it. Corollary for §7.3: the gate stand-down for flow modules must **not** be
  implemented by faking `acquisitionIdx = 0` — that would arm this block and fail the sums gate.
- **The income↔sweep convergence loop** (index.js:739-1068) reads the module's single yield
  stream (Decision 3 guarantees at most one) instead of `IncomePct` rows — a loader change, not a
  math change.

### 7.3 The ownership gate, re-keyed

CR041's gate applies to amount streams **only when `has_valuation = TRUE`**. A flow module has no
acquisition to gate on; today that case is unreachable (it is why Expenditures are a separate
type), so this is the one place the engine's *reachable* behavior is extended rather than
preserved — and it is exactly the extension that makes the merge possible. Implementation
constraint per §7.2: stand the gate down by **skipping the gate**, never by pretending
`acquisitionIdx = 0`, which would arm the base-year tax block. The five `Sarasota House` rows
(MV 0 + expense 45,000 — four `exclude`, one **`in_progress`, which builds today and is zeroed by
the gate**) stay `has_valuation = TRUE`; their behavior is unchanged, including the building one.

### 7.4 Readers that move off the old tables

- `crud.getBaseYearValues` — the incexp UNION half merges into the streams query (one source, the
  CR049 principle this function exists for). CR064 P8's per-currency conversion applies uniformly.
- **`copyScenario`** (repositories/forecast.js:202-404) *(added at technical review — was
  missing)*: its hand-listed child-table inserts gain streams + stream changes and lose the
  incexp/changes/income_pct/steps blocks. CR064 P2's annual close and auto-adjust's scratch
  scenario both ride this path — a copy that drops streams is the CR045 §1 "copied scenario runs
  unswept" class again.
- **Every hand-kept column/schedule list** migration 055's registry row already enumerates:
  `MODULE_WRITE_FIELDS`, `MODULE_COLUMN_DEFAULTS`, `replaceModuleSchedules`,
  `previewLoanRetype`/`clearForLoanRetype`, variant sync's `SCHEDULE_TABLES`, plus
  `fcModulePayload.js` on the frontend. The grep gate in P3 exists because this list is exactly
  the kind that drifts.
- `forecastAutoAdjust` — `ENTITY_TABLES.incexp` retires; the solver adjusts a stream's `amount`
  (same knob, new address).
- `aiReview.js:163` — reads streams.
- `fcLines` delete-RESTRICT check (repositories/fcLines.js:150) — counts `forecast_streams`
  references instead.

### 7.5 Variant sync

`SCHEDULE_KEYS` for `forecast_modules` gains `streams`; the copier handles the one **two-level**
schedule (streams + their changes) — copy stream rows, remap ids, copy change rows under the new
ids, all inside sync's existing transaction. A patch key of `streams` replaces the whole set
including changes, which is exactly the wholesale-replace semantics every other schedule already
has (migration 039's design note). The `incexp` entity type is removed from `ENTITY_TABLES`,
routes (`:entityType` validation at forecast.js:532) and the overrides UI.

**The nested schedule touches five helpers, not one** *(scoped at technical review)*:
`baseSchedule`, `replaceSchedule`, `scheduleEqualsBase`, `quantizeSchedule` and `pruneOverride`
(forecastVariants.js:625-665) all assume flat rows. The Hazard-2 unit test therefore covers
**equality, quantization and prune** against a nested fixture, not just the copy — a
`pruneOverride` that cannot compare nested schedules silently keeps or drops stream overrides on
every sync, which is invisible until a base edit fails to propagate.

### 7.6 The old write paths die AT P2, not P3 *(added at PM sign-off — was a gap)*

At P2 nothing reads `forecast_income_expense` any more — so an Expenditures-page save between
the P2 and P3 deploys would be **accepted, stored, and ignored**: the B3 staleness class, moved
onto the write path. Therefore, in the P2 deploy itself:

- the four `/incomeexpense` routes return **410 Gone** (fail loud, CR043 N10's principle);
- `/forecast-setup-exp` loses its route entry, which removes it from the stepper and the sidebar
  in one edit (`FCStepNav` derives from route config).

P3 then only *deletes* — components, hooks, routes file entries, tables. Nothing between P2 and
P3 can write into the retired model.

## 8. UI (P3)

- **One Modules page.** The table gains a shape column derived from data (valuation yes/no,
  stream count) — never from the free-text type. Filters unchanged.
- **Stream cards.** `fcModulesEditSections.js` already renders "Expenses" and "Income" as
  sections; they become one repeatable **stream card** (direction, FC line, mode, amount, growth,
  changes editor, window, tax). Add/remove card = insert/delete row — the §5 objection's answer
  in the DOM. The CR064 §4.1 emptiness-collapse rule carries over: no cards ⇒ section collapsed.
  The Valuation section collapses to an explicit "no balance sheet" state for flow modules
  (`has_valuation` is edited as *presence of the section*, with the same confirm-before-clear
  discipline as the loan retype, because clearing valuation deletes real values).
- **The changes editor is the FCExpModal one** (Percent/Fixed/One-Off already built, tooltips and
  all), generalized with the Spread % flag for yield streams.
- **Seeding.** "Add from Lines" (budget-seeded, today's `FCAddFromLinesModal`) and "Add from
  Actuals" both create modules — one flow-shaped, one valuation-shaped.
- **Steps 6 → 5.** `/forecast-setup-exp` route removed; `FCStepNav` and the sidebar both derive
  from route config, so they cannot disagree (FCStepNav.jsx:5-13). Check `DESKTOP_TO_MOBILE` for a
  stale entry. Mapping → Scenarios → Modules → Review → Compare.
- **Deleted:** `FCExpSetup` + all `FCExp*` components + 4 `useFCExp*` hooks (~2,770 lines), the
  four `/incomeexpense` routes + `INCEXP_WRITE_FIELDS`, the incexp repository half. The route
  file's module write contract gains `Streams` (an array of stream objects, whitelisted fields
  each) and loses the eight per-direction fields — the CR043 N10 enumerate-don't-drop rule holds.

## 9. Verification

### 9.1 The sums gate — non-negotiable, and cheap to state

On a **prod copy** (same harness as the CR064 P6 byte-identical check and the restore drill):
regenerate all five scenarios before and after each of P0 and P2. **Per (account, forecast_year),
summed `forecast_entries` must match to the cent.** Not row-identical — P0 deliberately changes
labels — but no number a report can display may move. Any diff is a defect in the CR, full stop.
P1 is gated stronger: nothing reads the new tables, so builds must be **byte-identical**.

The check is mechanical, not a procedure — snapshot before, diff after:

```sql
CREATE TABLE _cr069_before AS
  SELECT scenario_id, account, forecast_year, ROUND(SUM(amount), 2) AS total
  FROM forecast_entries GROUP BY 1, 2, 3;
-- deploy + regenerate all five scenarios, then:
SELECT COALESCE(b.scenario_id, a.scenario_id), COALESCE(b.account, a.account),
       COALESCE(b.forecast_year, a.forecast_year), b.total AS before, a.total AS after
FROM _cr069_before b
FULL OUTER JOIN (
  SELECT scenario_id, account, forecast_year, ROUND(SUM(amount), 2) AS total
  FROM forecast_entries GROUP BY 1, 2, 3
) a USING (scenario_id, account, forecast_year)
WHERE b.total IS DISTINCT FROM a.total;
-- gate: zero rows
```

### 9.2 Semantics tests (the rewrite-loss insurance)

Each row of §5.2 gets an engine test asserting its exact semantics, plus:

- Percent % is single-year; Spread % carries forward (the two "percent" meanings, distinguished).
- Fixed $ compounds from its own year at multiplier × inflation — one test fed by an old P6 steps
  fixture, proving the absorption is lossless — **and a signed-reduction test**: a positive
  Fixed $ on an expense stream *shrinks* the expense (the `Children` +25,000 shape, Decision 5).
- **The base-year tax quartet** (§7.2): amount-mode module income books Period-1 tax; a
  yield-mode module's dead typed amount **still** books it; a flow module's income does **not**;
  and the gate stand-down does not arm it.
- An expense-direction stream is **never taxed** — the direction sign applies *before* the `> 0`
  tax test, or normalized-positive expense amounts would suddenly qualify.
- A `base = 0`, changes-only stream (15 of the 60 prod items are exactly this shape).
- A change dated before the base year is ignored (§5.2's pinned rule).
- The Taxes-label fold (§6.2), the CR046/CR041 25% double-halving guard, the loan-never-gated and
  loan-window-immune rules (CR062), tax deferral including the last-year pile-up, the CR051 FX
  throw on a flow module.
- Flow module: no MV entries, no Transfer - Bank row, gate inert, entries labeled by module name.
- Two streams on one module, different FC lines: one entries row per (module, account, year)
  (Decision 3 rule 1).

### 9.3 Suite + ratchets

Backend and frontend suites green at every phase; lint 0 errors; all six ratchets non-increasing —
P3 *shrinks* several (buttons/modals/hex lose the `FCExp*` contributions). Existing
`fcbuilder-incexp` tests are ported to the stream evaluator before the old file is deleted, not
dropped with it.

## 10. Non-goals

- **No change to `forecast_entries` or anything downstream** — Review, Compare, Multi-Compare,
  sweep, convergence, audit CSV format, AI review payload shape.
- **No change to loan derivation, variant materialization design, or the assumptions document.**
- **CR064 P2 (annual close) and P10 (budget-seeded base year)** stay their own items; Decision 6
  states the anchor rule but moves no anchor.
- **No per-type form gating** — CR064 §5 stands; types remain labels.
- **No mobile Forecast setup.**

## 11. Known hazards for the build

1. **The migration renumbers identity.** Every converted item gets a new module id; anything
   holding an incexp id across the deploy (an open browser tab's edit modal) 404s once. Accepted —
   single-owner app, and the deploy sequence (migrations before code, git-concurrency rule 6)
   already implies a restart.
2. **Two-level schedule copy in variant sync** (§7.5) is new machinery; the nested-fixture unit
   test covers copy, equality, quantization and prune before it is trusted with prod's 48 links.
3. **`insertModuleEntries`' ON CONFLICT is still load-bearing for nothing** (§3) — after P0 the
   clause is dead weight on NULL `entry_type` rows. Leave it (it guards a hypothetical non-NULL
   writer); the comment now says what it does and does not do.
4. **The dirty-tree deploy class** (Known Issue #17): each phase's migration file must not sit
   uncommitted in `server/db/migrations/` while another thread deploys. Commit the migration in
   the same commit as its phase, immediately. The P2 backfill is the dangerous one — it rewrites
   overrides and origin links — which is one more reason it ships atomically with the cutover
   code rather than ahead of it.
5. **No edits between P2's backfill and P2's cutover** — there is no window by construction (one
   deploy), but the same reasoning bans a long-lived P2 branch: the backfill converts the data as
   it stands on deploy day, so the migration must be re-verified against fresh prod counts (§6.4)
   if the branch ages.
6. **In-migration count assertions must hold on a data-free database** (Known Issue #12, three
   incidents): every §6.4 assertion is *converted = source*, which passes vacuously at 0 = 0 — no
   unconditional `found <> 1` guards.
