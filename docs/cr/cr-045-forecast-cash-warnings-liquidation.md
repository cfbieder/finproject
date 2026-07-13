**Status:** ✅ COMPLETED — released v3.0.77–80 (2026-07-12). Open questions in §6 are optional follow-ups, not blockers. — [Roadmap](../current/project-roadmap.md)

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

## 4. Phase 2 — the sweep stops being a bare transfer (engine)

**Owner decision (2026-07-12): whole-asset liquidation mode is dropped.** An asset is only
ever auto-liquidated if it is *tagged*, and the sweep priority already **is** that tag —
the sweep has only ever touched ranked modules. Unranked assets (a business, a house) are
never sold on your behalf; an unfundable shortfall is **reported** (Phase 1's W2/W5) and
the owner schedules a disposal by hand. No migration, no new flag, no lumpy-sale mode.

That leaves two genuine engine defects, both of which bite precisely when you do what the
decision implies — tag *financial* assets (stocks) as the liquidation source:

**P2a — capital-gains tax on forced liquidation.** Draining a module's own balance is a
sale, but the sweep booked it as a bare transfer: *"no yield or tax calculations."* A
**scheduled** disposal of Fidelity Stocks computes gain and tax; the **forced** sweep
liquidation of the same $1.24M did not. Now it realizes a gain against the module's
proportional cost basis and taxes it on the same path a disposal does — same formula
(`fcbuilder-module.js:246`), same per-module rate override, same +1y deferral (CR003 G4).

The deferral is what keeps this a single forward pass: year Y's tax is paid in Y+1, which
the loop already knows by the time it arrives — no fixed-point iteration. It does chain
(paying the tax can push cash under the band, forcing another sale, taxed the year after),
which is exactly why the tax must run *inside* the sweep and not as a post-pass.

**P2b — swept funds must stop growing.** Withdrawals were carried forward **flat** while
the builder went on compounding the module's full pre-sweep balance: money sold in 2050
kept appreciating inside the module forever, cancelled only by the original amount. The
carry-forward is now compounded at the module's own effective growth rate, so it exactly
cancels the growth the builder applies to funds that are gone. This is the real cause of
F3 (the −$2,454 artifact) — that was the error finally going visible, not a rounding quirk.

Why it stayed hidden: the priority-1 module is **Fidelity Fixed Income**, `growth_rate = 0`
— for a deposit account flat *is* correct (CR003 G2: income % is the deposit rate, and the
convergence loop already recomputes yield on the sweep-adjusted balance). It only breaks
for a **growing** sweep source. `growth_rate = 0` ⇒ the compounding is the identity, so
deposit-account primaries are byte-identical and only genuinely-affected modules move.

Affected in prod: Fidelity Stocks (priority 2, `growth_rate = 1.0`, basis $1,019,072 vs MV
$1,369,072 — a **$350K embedded gain** realized tax-free) and 2026 Downside's primary
(`growth_rate = 0.5`).

## 5. Owner decisions (2026-07-12)

| Decision | Choice |
|---|---|
| Sequencing | **Warnings pane first**, engine change after |
| "House Purchase" sweep ranks | **Mirror Base** — Fidelity Fixed Income = 1, Fidelity Stocks = 2 (applied to prod + regenerated) |
| Illiquid-asset liquidation | **Only auto-liquidate a *tagged* asset** (= a ranked module). Everything else is flagged in the warnings and the owner decides what to sell — a business cannot be disposed of at will. **Whole-asset mode dropped**, and with it Q1 (excess proceeds) and Q3 (cap). |

## 6. Open questions

- **Q2** — Should W5/W6 also surface on `/forecast-compare`? A scenario that only "wins"
  because it liquidates tax-free is a misleading comparison. *(Less pressing post-P2a — the
  tax-free liquidation itself is now fixed.)*
- **Q4** — The 2060–62 shortfall is now permanent by design: the owner is told, and decides.
  Worth a "schedule a disposal" affordance from the warning, or is the warning enough?

## 7. Status

| Phase | State |
|---|---|
| §1 copy-bug fix + regression test | ✅ done (`f82abb9`) |
| §1 prod remediation (re-rank + regenerate) | ✅ done — shortfall 14y/−$20.1M → 3y/−$3.35M |
| Phase 1 — warnings pane (W1–W6) | ✅ done — 16 unit + 3 render tests |
| Phase 1b — BaseYear folded into sweep opening cash | ✅ done — +1 DB regression test; **no byte-parity** |
| Prod regenerate after 1b + deploy | ✅ done — v3.0.77; Downside −$475K→−$580K, House −$3.35M→−$2.67M |
| Phase 2a — capital-gains tax on forced liquidation | ✅ done — +6 sweep tests |
| Phase 2b — swept funds stop compounding | ✅ done — +2 sweep tests; identity at `growth_rate = 0` |
| Phase 2c — sweep may never drive a module below zero | ✅ done — +6 sweep tests (§4b) |
| Prod deploy + regenerate after Phase 2 | ✅ done — **v3.0.80**, previewed on a restored prod copy first |

Suites at Phase 2: **328 backend / 164 frontend green**; all three CI design guards pass.
The 10 pre-existing cash-sweep tests pass **unchanged** — P2a/P2b/P2c are inert at zero
growth, no cost basis and no future decline, which is the old behavior exactly.

## 4b. Phase 2c — the double-drain (found by shipping P2b, and reverting it)

**P2 was deployed as v3.0.78 and reverted the same hour (v3.0.79).** With the growth-aware
carry-forward live, Fidelity Stocks' balance went to **−$948K** — far worse than the −$2,454
it was meant to fix. The cause was not P2b:

`Fidelity Stocks` is a sweep **backup** *and* has its own **scheduled disposals** — $75K/yr
2040–45, **$50K/yr from 2049 with no end date**, and $500K one-time in 2052. The builder caps
those disposals against the module's **pre-sweep** market value; it cannot see what the sweep
already sold, so the same shares are sold twice. Under the old flat carry the two errors very
nearly cancelled, leaving the −$2,454 residue that read as a rounding artifact — **that was
the tell, and it was misread as cosmetic.** P2b did not create the error; it stopped it
hiding, and the true size showed: the plan had over-committed that asset by ~$950K.

**Rule (owner, 2026-07-12): the scheduled disposals win.** They are a deliberate plan; the
sweep is the backstop and gets only what is left. It can run dry earlier, and the shortfall
that follows is a real one for the owner to resolve — never a silent cancellation of a sale
they scheduled.

**Implementation — no reserve bookkeeping.** The builder's market value *already* has the
scheduled disposals in it, so the rule reduces to *"never push the balance below zero in any
future year."* Normalize by the module's cumulative growth factor `G`: a withdrawal `X` at
year `Y` permanently consumes `X/G[Y]` of capacity (it, and the growth it would have earned,
are gone), so the module stays solvent iff

```
usedNorm  ≤  min over all t ≥ Y of  mv[t] / G[t]
```

This year's capacity is that running minimum, less what past sales consumed, re-inflated to
today. It is **growth-aware by construction**: a distant commitment is funded by a balance
that has grown to meet it. The first attempt — reserve the *nominal* sum of future sales —
was wrong for exactly that reason: $1.65M of nominal future disposals against a $1.37M
balance froze the module from 2029 on and cost the early-2030s house-purchase dip ~$1M of
available cash. A `Full` disposal drives `mv` to 0, so the running minimum is 0 and the
module cannot be swept beforehand — correct: a sale of "whatever is there" claims the lot.

### Phase 2 effect on prod (measured on a restored prod copy *before* deploying)

| Scenario | v3.0.79 | v3.0.80 | sweep tax |
|---|---|---|---|
| 2026 Base | no shortfall | **unchanged** | — |
| 2026 Downside | 1 yr, −$580K | 1 yr, −$766K | −$68K |
| 2026 with House Purchase | 3 yrs, −$2.67M | **9 yrs, −$8.14M** | −$45K |

Fidelity Stocks' worst year-end balance: **−$38,580 → exactly $0** — never negative, in any
year of any scenario. Base is untouched (zero-growth deposit primary, no embedded gain: all
three fixes correctly inert), which is the parity evidence.

The House Purchase deterioration splits in two: **2031–35 (−$1.06M, new)** — Stocks can no
longer be drained to the bone, because it must retain enough to fund its own scheduled sales,
so the house-purchase dip is no longer papered over with shares that were already promised
elsewhere; and **2058–62 (−$7.08M)** — the known endgame, now larger because the tax is real
money and sold shares no longer keep compounding.

**Process note worth keeping:** v3.0.78 shipped straight to prod on the strength of a green
suite and put a −$948K balance on the owner's balance sheet. v3.0.80 was first run against a
`pg_restore` copy of prod in a scratch DB and diffed scenario-by-scenario. For an engine
change with no byte-parity, restore-and-diff is the verification — the test suite is not.
