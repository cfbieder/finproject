**Status:** 🟢 OPEN — [Roadmap](../current/project-roadmap.md)

# CR045 — Forecast Cash Warnings & Forced Liquidation

**Opened:** 2026-07-12 · **Track:** v3 · **Owner decisions:** settled 2026-07-12 (see §5)

## 1. Origin — a $20M error nobody was told about

The owner opened `/forecast-review` for **"2026 with House Purchase"** and saw the Bank
Accounts line dive through zero to −$3.7M. Cash going negative is not a possible outcome
of a real plan — the money has to come from somewhere — so the forecast was silently
producing a nonsense answer.

**Root cause (fixed, commit `f82abb9`):** `copyScenario` in
`server/src/v2/repositories/forecast.js` copied 21 module columns including the legacy
`cash_sweep_target` boolean, but never `cash_sweep_priority` (added by migration 031,
CR017). Every scenario created by *copying* another therefore started with **no ranked
sweep module at all**. The engine then took the `!sweepModule` branch of
`services/forecast/cash-sweep.js`: excess cash was still capped at the high band (hence
the plausible-looking flat line), but a shortfall merely wrote an unfunded
`Cash Shortfall` entry and let the bank balance run negative.

"2026 with House Purchase" was a copy of Base. Effect on prod:

| | before | after re-ranking + regenerate |
|---|---|---|
| Shortfall years | 14 (2029–2062) | 3 (2060–2062) |
| Cumulative shortfall | −$20.1M | −$3.35M |

**The lesson that drives this CR:** the engine *knew*. It wrote 14 `Cash Shortfall`
entries and the UI displayed none of them. A wrong forecast looked exactly like a right
one. Warnings are not a nicety here — they are the thing that would have caught this on
day one.

## 2. The residual finding — the plan really does run dry

After the re-rank, 2060–2062 still short by $3.35M cumulative. That is **not** a bug:
by 2060 both ranked modules are exhausted (Fixed Income drained from $2.7M in 2055 to
zero; Fidelity Stocks fully drained, $1.24M withdrawn). But the scenario still holds
**~$9.8M of unranked assets** — United Beverages ($4.2M), PL-Niemena ($1.2M), Barkeria
($1.1M), US-Casarina ($0.9M), the CVC funds, the Spanish properties. The sweep only
touches ranked modules, so the model declares insolvency at age 93 while the owner still
owns all of it.

Ranking them is not sufficient, for two reasons:

- **F1 — no tax on forced liquidation.** `cash-sweep.js` is explicit: *"purely a transfer
  mechanism — no yield or tax calculations."* A **scheduled** disposal of Fidelity Stocks
  computes realized gain and capital-gains tax; the **forced sweep** liquidation of the
  same $1.24M does not. Tail cash need is understated by the tax on every forced sale.
- **F2 — the sweep sells arbitrary fractions.** Correct for a brokerage account, wrong for
  a house or a business. Ranking PL-Niemena priority 3 would have the engine sell $180K
  slices of an apartment.
- **F3 (minor)** — the drain cap lets a module's own balance go marginally negative
  (Fidelity Stocks ends at −$2,454): `cumulativeWithdrawal` is capped against the
  *current* year's MV, which later years' MV can fall below.

## 3. Phase 1 — Warnings pane (read-only, no engine change)

A warnings panel between the KPI row and the Forecast Review table on `/forecast-review`.
Everything it needs is already on the page — no new endpoint, no engine change:

- `balanceDisplayValues.get("Bank Accounts")` — the running bank balance per year, the
  exact series the graph plots (`pages/FCReview.jsx:658-683`).
- raw `entries` — `account === 'Cash Shortfall'` rows written by the sweep.
- `modules` — `CashSweepPriority` per module.
- the scenario's `cash_sweep_low` / `cash_sweep_high`.

| # | Warning | Severity | Trigger |
|---|---|---|---|
| W1 | Cash goes negative | error | bank running balance < 0 in any year |
| W2 | Unfunded shortfall | error | any `Cash Shortfall` entry — engine could not fund the low band |
| W3 | **No sweep module configured** | error | no module in the scenario has priority 1 — *the config error that caused §1* |
| W4 | Cash below the low band | warning | bank balance < `cash_sweep_low` (band breached but funded) |
| W5 | Sweep source exhausted | warning | a ranked module's available balance reaches ~0 before the horizon ends |
| W6 | Module over-drained | warning | a ranked module's own balance ends negative (F3) |

Each warning names the years and the amount, and links to the fix (W3 → the Modules page).
Collapsible; a green "no warnings" state so its absence is meaningful rather than
ambiguous. Pure logic goes in `features/Forecast/utils/` behind unit tests — the FC pages
have **zero component tests** today, so testable-pure is the only honest way to cover it.

## 3b. Phase 1b — the base year never reached the sweep (found *by* the warnings pane)

On its first run against a **healthy** scenario (dev "2026 Base": one ranked module, zero
shortfalls) the new panel reported *"cash below the sweep low band, 7 years"*. It was
right, and it exposed a second engine bug.

`services/forecast/index.js` computed a corrected BaseYear cash delta under the comment
*"This ensures sweep's cash matches what the Review displays"* — and then never applied it.
The sweep iterates `years` = `PeriodStart…PeriodEnd` (`fcbuilder-setup.js`), so the BaseYear
(`PeriodStart - 1`) is **never visited**, and `cashDeltaByYear[baseYear]` was written but
never read. The engine therefore opened PeriodStart on the *LastActualYear ledger balance*,
ignoring a whole year of cash flow, and pinned the band against that inflated figure:

```
Starting cash balance (2025): 364142
BaseYear 2026 delta corrected: -123405 → -181725   ← computed, logged, dropped
```

The bank line the Review displays therefore sat a full BaseYear NCF **below** the low band
in every swept year, while the engine's audit log serenely reported `CashAfter = 200000.00`.
The sweep was systematically under-funding cash by the BaseYear net cash flow.

**Fix:** fold the corrected BaseYear delta into `startingCash` — the only path the sweep
actually reads — and drop the dead key (also in the convergence loop's `newCashDelta`).
The BaseYear stays free of sweep transfers, which the Review's budget-based BaseYear and
CR040's compare both assume.

**Consequence — no byte-parity.** This deliberately changes sweep amounts in *every*
scenario (dev Base: opening cash 364,142 → 337,880; the 2027 withdrawal 127,206 → 153,468).
The old numbers were wrong; the new ones reconcile with the displayed balance.

**Regression test:** `generate-transaction.test.js` asserts the BaseYear's effect on the
seed as a *difference* between two builds (item excluded vs included), so it holds on both
dev and CI regardless of the ledger's own bank balance. Pre-fix that difference was 0;
post-fix it is exactly the item's 100,000.

## 4. Phase 2 — Whole-asset liquidation + tax (engine)

Per-module **liquidation mode**, so a ranked module declares how it can be sold:

- `divisible` (default — brokerage, fixed income): sell exactly the shortfall. Today's
  behavior; keeps every existing scenario byte-identical.
- `whole` (property, business, PE): the sweep sells the **entire** module in the shortfall
  year; the proceeds above the low band flow back through the sweep (typically parking in
  the priority-1 module). Models reality — you cannot sell 12% of an apartment.

And **F1**: sweep liquidations compute realized gain and capital-gains tax on the same
path a scheduled disposal does (including the +1y tax deferral from CR003 G4), rather than
moving money tax-free.

Requires a migration (`forecast_modules.liquidation_mode`), the copy path must carry it
(the §1 bug class — a copy test per column is the guard), and engine parity must be
verified: **flag-off/divisible ⇒ byte-identical entries** on "2026 Base".

## 5. Owner decisions (2026-07-12)

| Decision | Choice |
|---|---|
| Illiquid-asset liquidation | **Rankable, but lumpy** — whole-asset mode (§4), not fractional slices |
| Sequencing | **Warnings pane first**, engine change after |
| "House Purchase" sweep ranks | **Mirror Base** — Fidelity Fixed Income = 1, Fidelity Stocks = 2 (applied to prod + regenerated) |

## 6. Open questions

- **Q1** — On a `whole` liquidation, where do the excess proceeds go? Assumed: back through
  the sweep into the priority-1 module. Confirm before implementing §4.
- **Q2** — Should W5/W6 also surface on `/forecast-compare`? A scenario that only "wins"
  because it liquidates tax-free is a misleading comparison.
- **Q3** — Cap on `whole` liquidation: if selling a $4.2M business to cover a $400K gap is
  the only option, do we do it, or warn and let the owner schedule a disposal explicitly?

## 7. Status

| Phase | State |
|---|---|
| §1 copy-bug fix + regression test | ✅ done (`f82abb9`) |
| §1 prod remediation (re-rank + regenerate) | ✅ done — shortfall 14y/−$20.1M → 3y/−$3.35M |
| Phase 1 — warnings pane (W1–W6) | ✅ done — 16 unit + 3 render tests |
| Phase 1b — BaseYear folded into sweep opening cash | ✅ done — +1 DB regression test; **no byte-parity** |
| Prod regenerate after 1b + deploy | ⚪ pending |
| Phase 2 — whole-asset liquidation + sweep tax | ⚪ not started (Q1 open) |

Suites at Phase 1b: **315 backend / 164 frontend green**; all three CI design guards pass.
