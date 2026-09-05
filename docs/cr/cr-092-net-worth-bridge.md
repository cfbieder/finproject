**Status:** ✅ **P0 COMPLETE** — 2026-09-05. **Track: v3.** No migration. **P1 (the LLM narration)
is open** and blocked on a task registration in `ocr-llm`.

# CR092 — Why did net worth change?

The Home hero prints a twelve-month delta — **−$1,900,488** on prod — and nothing on the page says
what it is made of. This CR adds a **net-worth bridge**: the change decomposed into drivers a person
recognises, reachable from a *"What changed?"* button beside the figure itself.

Roadmap anchor: [project-roadmap.md#cr092](../current/project-roadmap.md#cr092).

---

## 1. The finding that shaped the design: the bridge CLOSES

Net worth here is, per account, `opening_balance + SUM(transactions)` converted at the as-of-date
rate ([`reports.js` → `fetchAccountBalances`](../../server/src/services/reports.js)). CR024's
feed-balance override is the one thing that would break additivity, and it has **zero rows on prod**.

So every dollar of net-worth change is **either a transaction or a rate move**. Nothing needs
estimating, no bucket is a dumping ground, and `meta.tie` is an assertion rather than a hope: the
live twelve-month window ties to **1.2e-10**, and so does every one of its eleven month-steps.

This is why the modal can promise the figures add up, and why the server reports `tieOk` rather than
the page assuming it.

## 2. What actually drove the owner's $1.9M (measured 2026-09-05, prod)

| Driver | USD |
|---|---:|
| Investments & property re-valued | **−1,741,398** |
| Money spent | −482,691 |
| Money earned | +412,492 |
| Exchange-rate moves | −65,231 |
| Transfers that didn't net out | −23,621 |
| Uncategorised | −39 |
| **Total** | **−1,900,488** ✓ |

🔴 **98% of the year is one posting.** `United Beverages`, `2025-12-31`, `−6,956,000 PLN`,
description `Unrealized G/L (manual MTM)`. The chart agrees: Nov→Dec 2025 is **−1,994,730** and the
other ten months sum to **+94,242**. A twelve-month decline that reads as a slow bleed is a single
mark, and the page could not say so.

The second-largest visible event nets to zero and the modal has to say that too: three properties
sold (`SP - Panorama Mar 4`, `SP - Sea Senses`, `US - Nokomis`, **−$1.34M** off the sheet) with the
proceeds landing in Fidelity Bond **+539K**, Cash Mgt **+518K**, PKO TFI **+108K**. Money moved
between accounts is not money lost, and a breakdown that shows the outflow without the inflow is
worse than none.

## 3. The FX convention, and the three that were rejected

Four conventions were built and measured against the live window. **All four tie.** They differ only
in *which rate values each event*, and the choice moves headline figures the owner reads:

| Convention | Re-valued | Income | Currency | Months sum to the year? | Matches Cash Flow page? |
|---|---:|---:|---:|:--|:--|
| A — today's rate, per period | −1,740,615 | 412,492 | −71,094 | ❌ | no |
| B — stored `base_amount` | −1,719,214 | **418,675** | −81,899 | ✅ | **yes** |
| C — book rate on the transaction's own date | −1,806,365 | 418,435 | **+5,830** | ✅ | no |
| **D — today's rate everywhere** *(chosen)* | −1,741,398 | 412,492 | −60,449 | ✅ | no |

**D** fixes the translation rate at `toDate` for *every* sub-period. That is the whole trick: with
one rate across all periods the drivers are date-fixed, so **the months sum to the year exactly** —
verified on all eleven steps, every column to the dollar. Under A they do not (measured: currency
**−1,608** chained versus **−81,899** for the period), and a table that visibly fails to add up under
a headline claiming it adds up is this repo's most expensive failure shape.

⚠️ **B was rejected because it inherits a real defect, not because of the convention.** `base_amount`
on the UB write-down implies **0.266042** PLN/USD when the book rate that day was **0.278373** — a
4.4% error worth **$85,780** on one line, which would sit inside the *largest figure in the modal*
with the offsetting error hidden in the currency row. Across the window **271 of 2,169** non-USD rows
(12.5%) are off by >1% from their own date's book rate, aggregating to **−$87,730**. Logged as its
own item; not fixed here, because rewriting `base_amount` restates Cash Flow history.

⚠️ **C was rejected for being useless, not wrong.** Its currency line reads **+$5,830** for a year in
which the zloty fell: the genuine translation loss nets against "the write-down happened at a
stronger rate". Arithmetically correct, and it tells the reader nothing.

**The stated cost of D:** income shows **412,492** where the Cash Flow page shows **418,675** — 1.5%,
because that page converts at each transaction's own date. `meta.basisNote` says so and the modal
prints it.

## 4. 🔴 The defect this CR had to fix first: net worth was NON-DETERMINISTIC

`fetchAccountBalances` picked its rate with `ORDER BY ABS(rate_date - $2)` **and no tie-break**.
`exchange_rates` has no row for `2026-06-30`, and `06-29` (PLN 0.266042) and `07-01` (0.265252) are
**equidistant** — so nothing decided which won.

**The same date returned 14,398,878 and then 14,373,541 within one session, on unchanged data.** A
**$25,337** swing on the Home chart, across ~28.5M PLN and ~2.4M EUR.

It is fatal to a bridge specifically: an ambiguous boundary moves two adjacent months by ±$25K in
opposite directions, and the difference lands in `currency`, which is a residual and absorbs it in
silence.

**Owner decision (2026-09-05): the tie-break ALONE** — `ABS(distance) ASC, rate_date ASC`. Measured
alternative, declined: adopting `fx.rateAsOf`'s stricter *"last rate on or before"* rule would also
move every weekend/holiday month-end (**Nov-30-2025 −112,229**, **Jul-31 −94,901**, **Aug-31
+33,696**), restating a shipped chart to fix a defect that only ever bit on ties. Under the chosen
version **11 of the 12 boundaries are byte-identical**.

⚠️ **So `reports.js` and `fx.js` still disagree on non-tie gap dates, deliberately.** And the same
ABS-only ordering — *without even the tie-break* — survives in `forecast/crud.js`,
`repositories/budget.js` and `utils/refreshExchangeRates.js`. Not swept here: those move forecast and
budget figures.

## 5. Two drivers the method structurally CANNOT see

Both ship in `meta.caveats` and render in the modal, rather than being quietly absent:

1. **`calibrate()` rewrites `opening_balance` retroactively.** Both endpoints read today's value, so
   a re-anchor never appears as a driver — it silently reshapes the whole history curve instead.
   Migration 074 gave it an audit trail, but only from **2026-08-24**; prod's last calibration was
   **2026-06-03**, so `audit_log` is legitimately empty and re-anchors inside this window are
   unrecoverable.
2. **The balance query filters `is_active = TRUE` at BOTH dates**, so closing an account rewrites its
   whole history rather than showing as a fall.

## 6. As built

**Server** — `services/netWorthBridge.js`, beside `reports.js` and `investmentReturns.js` for the
same reason (a report builder consumed by the v2 reports route).

- `GET /api/v2/reports/net-worth-bridge?fromDate=&toDate=&granularity=month|quarter|year|none`,
  `{ data, meta }` envelope. **192 ms** for a twelve-month monthly bridge on prod.
- Endpoints come from **`fetchAccountBalances` itself** — the function the hero's own report calls —
  not from a second query computing "the same" balance. A test pins agreement with
  `buildBalanceSheetReport` at both ends.
- `data.summary` is a **deterministic** plain-English lead. The numbers must never come from a model,
  and the explanation must not depend on a gateway being up.

**Frontend** — `NetWorthBridgeModal` on the Radix `<Modal>` primitive, opened from a *"What
changed?"* button **inside the delta row**, beside the figure it explains.

- Desktop passes the hero series' own endpoints, so `data.change` **is** the delta on the button.
- Mobile passes its **own** window: `MobileHome`'s delta is month-over-month, not the hero's twelve
  months, so reusing the hero's dates would explain a change the phone is not showing.
- Waterfall bars scale to the **largest driver**, not the net change: the drivers routinely dwarf
  their own total (−1.74M against +412K inside a −1.9M net), and scaling to the net pushes every bar
  off its row.

### 6a. Named items under each driver (owner request, 2026-09-05)

*"If there is one or more larger items (e.g. United Beverages) this should be shown with the account
name attached."* A driver line says a re-valuation cost 1.74M; it does not say the re-valuation **was
United Beverages**. Each driver now carries `contributors[]` and renders them as indented rows:

| Driver | Named item |
|---|---|
| Investments & property re-valued −1,741,398 | **United Beverages −1,873,619** |
| Money earned +412,492 | **Financial Income - UB Dividend +186,089** |
| Exchange-rate moves −65,231 | **United Beverages −58,629** |
| Money spent −482,691 | *no single item — spread across many categories* |
| Transfers that didn't net out −23,621 | *$1.75M moved in both directions and cancelled* |

Three rules, each of which is a decision rather than a default:

1. ⚠️ **The label is the ACCOUNT for balance drivers and the CATEGORY for income and spending**
   (`namedBy` says which, so the page can say which). Measured on prod before choosing: the top
   spending **accounts** are `PKO` and `Chase Checking` — *which card paid* — while the top spending
   **items** are `Kasia Spending` and `FL - Flights`. Naming the account under "Money spent" answers a
   question nobody asked. The owner's request said "account name"; this follows it everywhere the
   account *is* the item, and departs from it only where it is not.
2. 🔴 **Weight is judged against the GROSS, never the net — and the first version got this wrong.**
   A net-relative floor let `Transfers that didn't net out` (−23,621 net on **~1.75M** of movement)
   print four items of **±$500K** beneath it, and `Uncategorised` (−$39 net) print ±$27K legs.
   Individually true, collectively a lie about what the line means. A driver whose net is under 40%
   of its gross is a **cancelling** driver: it names no item and instead reports the gross, which is
   the actual answer to *"did I lose that money?"* — the thing the owner asked this modal for.
   **Found by reading the first render, not by a test.**
3. ⚠️ **No share percentage is emitted at all.** United Beverages is −1,873,619 against a −1,741,398
   driver, because other marks were positive — a truthful "108%" reads as an error rather than as
   "the rest offset it". A driver with no dominant item says so (*"spread across many categories"*)
   rather than rendering blank, which would read as missing data.

Gated the same way as the drivers: the modal test asserts **every contributor in the payload reaches
the DOM**, that a cancelling driver's legs are **absent**, and that no `%` appears anywhere —
falsified before being trusted. Server-side, the rules are asserted **as rules** (label kind, the
net-of-gross ratio) rather than against figures dev happens to hold; the first draft asserted the
fixture's own mark was listed and failed, because prod's −1.87M correctly outranks it.

## 7. What the RENDERED PAGE found that the tests did not

Consistent with [CR085](cr-085-forecast-sensitivity.md)'s lesson — the display half has no gate, and
the owner finds these by looking:

1. 🔴 **The hero's series ended on a FUTURE date.** `monthEndISO(0)` returned the *current month's
   end* — a future date on all but one day a month. The modal's header read *"to Sep 30, 2026"* under
   a figure read on the 5th, the chart plotted a point the calendar had not reached, and a phantom
   `Sep 2026` row appeared unmarked. Now clamped to today.
2. **A truncated FIGURE, not a truncated column.** With every table cell `nowrap`, the last money
   column rendered as `−$453,29` — which reads as corrupted data, not as something scrolled out of
   view. The account column now wraps; the figures never do.
3. **Prose asserting more than the arithmetic supports.** The summary said *"almost all of it United
   Beverages"* for a mover worth **64%** of its driver, and *"most of it is one thing"* where that
   thing was the **only** driver. The share language is now graded against what was measured.
4. **A control whose promise its content cannot keep** — CR085's defect class one step over: the
   *"Month by month"* section rendered on the mobile month-over-month window containing **exactly one
   row**. Hidden below two periods.

⚠️ **And one non-finding worth recording, because it looked like a defect for ten minutes.** The dev
hero moved 14,363,660 → 14,420,866 mid-session. Not the clamp: dev's `exchange_rates` were stale and
the first API call **refreshed them**. Measured before being blamed on the change that happened to be
in flight.

## 8. Gates

- `services/__tests__/netWorthBridge.test.js` — 14 tests. The load-bearing ones assert **invariants**
  (the tie is zero, the periods sum driver-by-driver, both endpoints equal
  `buildBalanceSheetReport`), which hold on any data including prod's.
- ⚠️ **The fixture is BUILT, not borrowed.** `ci-seed.sql` is 34 lines with four P&L accounts, zero
  transactions and **no `Assets` root at all**, so a test asserting *"United Beverages is
  −1,873,619"* would pass on dev and never run in CI — the ambient-data class that has turned `main`
  red five times. This seeds its own Assets/Liabilities chain, its own rates in a fixture-only
  currency (`ZZZ`), and cleans up by name and currency rather than by recorded ids — a crashed run
  otherwise leaves rows the next run silently inherits, which is exactly how it first "failed".
- `components/NetWorthHero/NetWorthBridgeModal.test.jsx` — 8 tests, and this is the piece
  [CR085](cr-085-forecast-sensitivity.md) says does not exist: **it asserts that every driver in the
  payload reaches the DOM**, by name and by figure. **Falsified before being trusted** — dropping one
  driver from the render makes it fail.
- Full suites green: **server 1175 passed / 89 suites**, **frontend 597 passed / 49 files**. All six
  ratchet gates at baseline.

## 9. P1 — the LLM narration (open, blocked on `ocr-llm`)

The deterministic summary is the floor; a narration would read better. The pattern already exists on
the gateway across other clients — **narration-only** tasks (`recovery_narration`,
`market_regime_narration`, `year_in_review_narration`): the caller computes every figure and inlines
them as GIVEN facts, and the model narrates and never calculates. That is exactly this payload.

**Blocked, and not on us.** Fin's tasks are **local-only** — personal financial detail must not leave
the tailnet — so this needs a new local-only task (`ollama_heavy → ollama_mid`, no cloud step)
registered in `ocr-llm`, requested via `HANDOFFS.md`. ~9 s for ~150 words on `ollama_heavy`.

Two rules for when it lands, both following from §1: the modal renders the table from the API and the
narration sits **above** it as prose, never in place of it; and a gateway failure degrades to the
deterministic summary rather than to an error.

## 10. Not in scope

- **The `base_amount` rate drift** (§3) — 271 rows, −$87,730. Its fix restates Cash Flow history.
- **The three remaining ABS-only rate lookups** (§4) — they move forecast and budget figures.
- **A user-selectable window.** The modal explains the number it sits beside; date pickers inside it
  would decouple the two.
