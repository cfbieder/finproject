# Forecast Model — Terminology, Mechanics & Ratified Assumptions

> The reference for **what the forecast engine models**, not how the code is laid out.
> Structure/routes live in [project-description.md](project-description.md); the rationale
> for each mechanic lives in its CR ([CR041](../cr/cr-041-module-ownership-gating.md),
> [CR045](../cr/cr-045-forecast-cash-warnings-liquidation.md),
> [CR046](../cr/cr-046-module-income-window-and-hierarchy-graph.md),
> [CR047](../cr/cr-047-module-income-tax-override.md),
> [CR048](../cr/cr-048-model-review-fixes.md)).
>
> **Last reviewed against the engine:** 2026-07-13 (v3.0.93).

---

## 1. Period Definitions

| Term | Formula | Example (PeriodStart=2027) | Description |
|------|---------|---------------------------|-------------|
| **PeriodStart** | — | 2027 | First forecast year. All FC engine projections begin here. |
| **BaseYear** | PeriodStart − 1 | 2026 | Budget year. P&L sourced from budget. BS modules project ending balances via engine. |
| **LastActualYear** | PeriodStart − 2 | 2025 | Most recent completed year. P&L and BS sourced from actuals (ledger/reports). |

**BaseDate constraint:** each BS module's BaseDate must be LastActualYear (Dec 31). The engine derives its start year from BaseDate, so misalignment shifts the period grid and produces wrong results.

**The BaseYear is never a swept year.** Its net cash flow is folded into the sweep's *opening cash* instead (see §5), so the BaseYear column carries no sweep transfers.

---

## 2. FC Review — Column Data Sources

| Row | LastActualYear (PS−2) | BaseYear (PS−1) | PeriodStart → end |
|-----|----------------------|-----------------|-------------------|
| **Income** | Actual (by FC Line) | Budget | FC Exp + BS module income |
| **Expense** | Actual (by FC Line) | Budget | FC Exp + BS module expense |
| **Cash Flow** | Income − Expense | Income − Expense | Income − Expense |
| **Transfers** | *Deferred* | FC BS Module | FC BS Module **+ cash sweep** |
| **Net Cash Flow** | Cash Flow *(no transfers yet)* | Cash Flow + Transfers | Cash Flow + Transfers |
| **Bank Accounts** | Actual (fixed) | Prior Cash + Net Cash Flow | Prior Cash + Net Cash Flow |
| **Other Assets** | Actual | FC BS Module | FC BS Module (net of sweep drains) |
| **Liabilities** | Actual | FC BS Module | FC BS Module |

### Notes
- **Budget** = BaseYear P&L from `base-year-values`. Combines BS-module base amounts (`income_amount`/`expense_amount`) and FC IncExp base values. Both are **window-filtered and half-weighted** per §8 (v3.0.88/89 fix).
- **Actual (by FC Line)** = LastActualYear P&L mapped to FC Line names via `fc_line_categories`.
- **Bank Accounts (display)** = running balance built in the Review layer from Income/Expense/Transfers — *not* from the engine's `Bank Accounts` entry rows.
  ⚠️ **The engine's `Bank Accounts` entries are still load-bearing in the model** — they are the sole source of the `cashDeltaByYear` the cash sweep consumes, and the convergence loop updates them. They are "unused *by the display layer*", never "unused".
- **Transfers** sign convention: positive = disposal/cash-in, negative = investment/cash-out.
- **LastActualYear Transfers** — intentionally deferred (no actual transfer data source yet), so its Net Cash Flow excludes transfers. Known asymmetry with later columns.

---

## 3. BS Module Fields

### Value fields

| Label | Meaning |
|---|---|
| **PY Actual (*year*)** / (USD) | Prior year-end actual from ledger balances (read-only), and its USD conversion. |
| **Cost Basis** / (USD) | Book value. Used to compute **realized gains** on disposal (and on forced liquidation). |
| **Market Value** / (USD) | Fair value at forecast start. The starting point for growth projection. |
| **PY → Cost Basis** / **PY → Market Value** | Copy helpers. |

Cost Basis = Market Value = PY Actual for most assets; they diverge when there is an unrealized gain (bought at 100, worth 150 ⇒ basis 100, MV 150).

### Income precedence (not obvious)
A **yield schedule (`IncomePct`) overrides `income_amount` entirely** — they do not add. The effective yield is **inflation% + spread%** (additive), so a "spread" is quoted *over* inflation, not absolute.

### Expense growth
`expense_growth_method` ∈ `inflation` | `pct_of_value` (legacy `expense_pct`). A NULL `expense_fc_line_id` with a zero amount means "no expense line".

### Windows & tax (the new fields)
- Four **year** selects — income start/end, expense start/end (§8).
- Two **tax overrides** — "Full Tax Override" (gains + income) and "Recurring Income Tax Override" (income only) (§9).

---

## 4. Engine Order of Operations (`services/forecast/index.js`)

Steps 2–8 run inside **one transaction** holding `pg_advisory_xact_lock(scenario_id)`: a failed build rolls back to the previous entries, and concurrent builds of the same scenario serialize.

1. **Load** scenario config (period, inflation, FX PLN/EUR, tax rate).
2. **Resolve** scenario + `cash_sweep_low/high`; take the advisory lock.
3. **Preload** FC Line id→name map.
4. **Load** BS modules, inc/exp items, categories (`setup_status` in `new`/`exclude` is skipped).
5. **Build** category structures/columns.
6. **Compute → persist:** pure BS-module builders, then pure inc/exp builders (deterministic order) → audit CSVs → `DELETE` prior entries → insert in the same order.
   *(The last-write-wins `ON CONFLICT` between same-account inc/exp items is load-bearing — order matters.)*
7. **Cash sweep** (§5) — pure computation, then insert sweep entries.
8. **Income ↔ sweep convergence loop** (§6) — the only iterative part.
9. **Statistics; COMMIT.**

**Pseudo-modules** written by the sweep into `forecast_entries.module` (they are not real modules): `_cash_sweep`, `_sweep_bal`, `_rebalance`.

---

## 5. Cash Sweep & Forced Liquidation (CR045)

### Configuration
- The sweep runs **only if the scenario has a band** (`cash_sweep_low` / `cash_sweep_high`). One set ⇒ the other is filled from it (a point band).
- `cash_sweep_priority` on a module is the **liquidation opt-in and rank**:
  - **Priority 1 = primary** — the *only* deposit target, and the first source drained.
  - **Priority 2, 3, … = backups** — drained in order, **own balance only**; they never receive deposits.
  - **Unranked = never touched.** A business or a house is not silently sold; an unfunded **shortfall** is reported instead.
- **No primary at all** ⇒ degraded `_rebalance` mode: excess cash parks in a synthetic account and shortfalls simply run cash negative. *This was the CR045 §1 bug — `copyScenario` dropped `cash_sweep_priority`, so every copied scenario ran unswept.*

### Opening cash
`startingCash` = LastActualYear **ledger** bank balance (FX-converted) **+ the BaseYear's net cash flow** (budget NCF + BaseYear `Transfer - Bank` entries). The BaseYear is then removed from the cash deltas so it can never be double-counted.
Budget NCF is **budget-based, not engine-based**, and must mirror `crud.getBaseYearValues` exactly — including the §8 window filter and half-weighting.
A missing COA account named **`Bank Accounts`** throws rather than silently starting from $0.

### Per-year sequence (PeriodStart … PeriodEnd)
1. Grow the balances the sweep itself carries.
2. **Pay last year's deferred capital-gains tax** from any forced liquidation.
3. Apply the year's natural cash delta.
4. **cash > high** ⇒ sweep the excess into the **primary** only.
5. **cash < low** ⇒ withdraw in strict order:
   a. the primary's **swept balance** (the sweep's own money coming back — no basis, **no gain, untaxed**),
   b. the primary's **own balance** (a real sale ⇒ **taxed**),
   c. cascade into **backups** by priority.
   Anything still unfunded ⇒ a **`Cash Shortfall`** entry.
6. Tax realized this year defers to Y+1 (in the final year it stays put — see §10).

### Three invariants
- **Forced sales are taxed.** Draining a module's own balance is a sale: proportional basis consumption, gain realized, taxed on the **gains** chain (`tax_rate_override ?? scenario rate`) — deliberately *not* the income override, because a liquidation is a gain.
- **Basis can't be spent twice** (CR048 A2). A backward-pass **basis floor** means the sweep may only claim basis that survives every future year; where a forced sale and a scheduled sale overlap, the scheduled sale keeps its basis and the forced sale carries the higher gain (conservative).
- **The sweep may never drive a module below zero in *any future* year** (CR045 P2c). Withdrawal capacity is growth-normalized across the remaining horizon, so scheduled disposals always win over the sweep, and a module with a `Full` disposal cannot be swept at all before that sale.

### A drained module
- **Stops compounding** — effectively. The builder keeps compounding the full pre-sweep MV, but the sweep emits `_sweep_bal` carry-forward entries that exactly cancel the growth applied to money that is gone.
- **Stops paying *yield* income** — the convergence loop recomputes yield income off the **sweep-adjusted** balance (CR048 A1).
- **Keeps paying *amount-based* income** — deliberately. A contractual amount (rent, salary) is not a percentage of an asset, so drains don't scale it.

---

## 6. Income ↔ Sweep Convergence Loop

Income depends on balances; the sweep changes balances; so it is solved as a fixed point.

- Max **10 iterations**, tolerance **$100** max income delta across all ranked yield modules.
- Each iteration: recompute every **ranked module with a yield schedule** off the sweep-adjusted, FX-converted balance (honouring Full disposal and the §8 window) → update the income / Taxes / Bank Accounts rows → delete all sweep entries and **re-run the whole sweep**.
- Income is re-taxed on the **income** chain (CR048 A3 — it previously re-taxed on the *gains* chain, silently overriding CR047 on every rebuild).
- **Known limit:** the loop **UPDATEs, never INSERTs**. A year whose builder income was exactly 0 has no entry row, so the loop cannot raise it later.

---

## 7. Ownership Gating (CR041)

Acquisition is **derived, never stored** (no column): if base MarketValue ≠ 0 the module is owned from the start; otherwise the acquisition year is the first year with a non-zero MV (the first effective Invest). Never-owned ⇒ no streams at all.

When acquired *after* the base year, **amount-based** streams are **0 before** the acquisition year, **50% in it**, full after.

**MV-driven streams (yield-spread income, legacy `expense_pct`) are NOT gated** — pre-purchase average MV is already 0 and the acquisition year averages to half naturally; gating them would double-halve.

The deferred base-year income tax is skipped when the module wasn't owned at base.

---

## 8. Income / Expense Window (CR046)

Four nullable DATE columns on `forecast_modules` (migration 037): `income_start_date`, `income_end_date`, `expense_start_date`, `expense_end_date`.

- The owner picks a **year**; it is stored as **July 1**. Consequence: the **first and last year each book 50%** (the engine's half-year convention). A single-year window is halved **once**.
- **NULL = unbounded** ⇒ byte-identical to pre-CR046 behavior.
- The window bounds **when** a stream runs, **never how much** — the amount stays a base-year figure compounded at inflation.
- Applies to **amount-based *and* yield-based** income, and to expenses.
- **Ownership wins.** The window is applied first, the CR041 gate second (bought 2035 + rent from 2030 ⇒ nothing before 2035). **Never double-halved** — the gate skips indices the window already halved, or you'd get 25% of a year.
- **Base year (v3.0.88/89):** both base-year sums (the displayed BUDGET column *and* the engine's budget-NCF that feeds opening cash) filter on the window and halve when the window's start/end year *is* the base year. Deliberate: **"starts in the base year" ≠ blank** — half, not whole. The deferred base-year income tax follows the *booked* figure, not raw `income_amount`.
  *This was the v3.0.88 bug: phantom rent wasn't only displayed, it was **spent** — overstating opening cash.*

---

## 9. Tax Overrides (CR047)

| Field (UI label) | Fallback chain | Applies to |
|---|---|---|
| `tax_rate_override` — **"Full Tax Override"** | `?? scenario.TaxRate` | **Realized capital gains** *and* income (unless the income override is set) |
| `income_tax_rate_override` — **"Recurring Income Tax Override"** | `?? tax_rate_override ?? scenario.TaxRate` | **Income only** — wins over Full |

- The income rate covers **all** income kinds: amount-based, yield-based, and the deferred base-year income tax.
- **NULL falls back** (existing modules byte-identical). **`0` is a real rate** (taxed at nothing) — the code tests `!= null`, never truthiness.
- **Forced liquidation ignores the income override** — it's a gain, so it uses the gains chain.
- *Why:* the United Beverages dividend arrives already taxed in Poland (~3% incremental US tax), but a future **sale** of the same holding is still an ordinary capital gain.

---

## 10. Tax Timing

- **Deferred one year.** Tax realized in year Y is paid in Y+1 (both the module builder and the sweep).
- **Final-year bunching.** The last year has no next year, so it carries **its own tax plus the prior year's deferred tax**. In the sweep, that tax lands *after* the final band check and can push the final year under the band — by design (CR048 A5).
- **Base-year income tax** defers into **Period 1**, computed from the *booked* (possibly halved, possibly zero) base-year income.
- **Only positive gains/income are taxed.** No loss netting, no carry-forward, no tax relief on losses (CR048 A4).

---

## 11. Entry Categories Written

**BS module builder** (per module):

| Category | Value |
|---|---|
| Module account (e.g. "PL Investments") | Market values (USD) |
| `Transfer - Bank` | −(Dispose) − Invest |
| Income category | Income (USD) |
| Expense category | Expense (USD) |
| `Taxes` | Tax (USD, deferred 1 year) |
| `Bank Accounts` | Income + Expense + Tax + Transfers |

**Cash sweep** (pseudo-modules):

| Pseudo-module | Writes |
|---|---|
| `_cash_sweep` | `Transfer - Bank` + the module's account (the deposit/drain), and `Taxes` ("capital gains tax on … liquidation") |
| `_sweep_bal` | The module's account — carry-forward that cancels growth on drained money |
| `_rebalance` | `Cash Shortfall` (unfunded) / `Cash Rebalance - Deposits` (no-primary fallback) |

**BaseYear Full disposal:** asset zeroed from index 0, base-year P&L kept as budget, all forecast years zeroed — and it still books a **realized gain** at index 0, whose tax defers into Period 1.

---

## 12. Cash Warnings (`/forecast-review`)

Computed in the Review page from already-loaded data (bank running balance, entries, module priorities, `cash_sweep_low`).

| # | Severity | Trigger |
|---|---|---|
| **W1** negative-cash | error | Bank running balance < 0 in any year — not a real outcome. |
| **W2** unfunded-shortfall | error | A `Cash Shortfall` entry — the sweep ran out of ranked assets to sell. |
| **W3** no-sweep-module | error | No module has priority 1 (the CR045 §1 config error). Checked first. |
| **W4** below-low-band | warning | Bank balance < `cash_sweep_low` (breached but still positive). |
| **W5** sweep-source-exhausted | warning | A ranked module's balance hits ≈0 before the horizon ends. |
| **W6** module-over-drained | warning | A ranked module ends **negative** — should be impossible post-CR045 P2c; a canary. |

---

## 13. Ratified Model Assumptions (CR048)

Deliberate simplifications — **known, accepted, not bugs**:

- **Cash earns 0% forever** (~$500K forgone over the horizon). Ratified conservatism; it also makes the frozen nominal sweep band self-consistent.
- **Flat-tax world** — no estate tax, no basis step-up, no IRA/retirement-account character. Fidelity is a taxable brokerage. The 2062 net-assets figure is a **living, pre-estate** number.
- **No loss relief** — losses are not netted and do not carry forward.
- **Final-year tax bunching** (§10).
- **Amount-based income is not scaled by sweep drains** — it's contractual, not a % of value.

**Open / scheduled:** all growth being a multiple of inflation (experiment scenario generated, owner to decide); FX paths unstressed (to be folded into the Downside scenario).
