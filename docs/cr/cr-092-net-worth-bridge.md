**Status:** ✅ **P0 shipped v3.53.0 · P2 COMPLETE (2026-09-05).** **Track: v3.** No migration.
**P1 (the LLM narration) is open** — the `ocr-llm` handoff was **filed 2026-09-05**
(`finance_networth_narration`), so it now waits on them, not on us.

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

## 6b. P2 — the drivers report (owner request, 2026-09-05)

*"I really like this graph — can we make this a report in the reports section where the user can
select the period?"* `/net-worth-drivers`, under **Reports & Graphs › Reports**, beside
`/investment-returns` and deliberately shaped like it.

- **Period** via the existing `PeriodSelector` (owner decision over presets and over free date
  pickers: it is the proven control on the sibling report, and day precision invites comparing a
  43-day span to a 31-day one without noticing). Plus a **Break down by** control —
  month / quarter / year / whole period — since the endpoint already took `granularity`.
- ⚠️ **The chosen period is NOT the dates sent.** A period of *Jan–Dec 2026* is sent as
  `fromDate = 2025-12-31`, because the bridge reads `fromDate` as the **opening boundary** and
  attributes transactions *after* it — passing `2026-01-01` would bury that day's transactions in
  the opening balance and drop them from the explanation. The page says so on screen rather than
  leaving a reader wondering why January's report starts on 31 December. `toDate` is clamped to
  today, the same defect P0 had to fix in the hero. `windowFor` is its own module with seven tests,
  `today` injected — a "clamps to today" test pinned against the real clock passes for a month and
  then fails on its own.
- **Every account, not the modal's twelve.** New `movers=<n>` query param, bounded at 500 by the
  service; an unbounded caller-supplied limit is a payload-size hole, not a feature. The grid is
  **sortable by any driver column**, on absolute value — a driver column holds both signs, and
  ranking it raw would bury the biggest negative under every small positive. An unsorted 58-row
  grid is a worse object than the capped 12-row one it replaces.
- **One rendering, not two.** The waterfall, period table and account grid moved to
  `features/NetWorthBridge/bridgeParts.jsx` and are now rendered by **both** the modal and the
  report. Copying them would have been faster and is exactly how a modal and a report start
  disagreeing about the same number while each stays internally consistent. The refactor's gate is
  that all 11 modal tests pass **unchanged**.

🔴 **Rendering the report on a different window exposed a defect in P0's prose that P0's own window
could never show.** On year-to-date the page said:

> *"Net worth fell $96,705. **Almost all of it is one thing: money earned added $368,591.**"*

Earning money does not cause a fall. `buildSummary` took `drivers[0]` — the largest by **absolute**
value — and asserted it explained the change. On the 12-month window that happened to be a
re-valuation of −1.74M against a −1.9M fall, so it read correctly and shipped. Two rules now:

1. **The leading driver must share the CHANGE's sign.**
2. **When the drivers largely cancel, no driver leads at all** — the same net-of-gross test §6a
   introduced for contributors. That window's change is **7.7%** of its **$1,259,734** of gross
   driver movement, so it now reads *"No single thing accounts for that — $581,515 of gains against
   $678,220 of losses, and the change is what is left over"*, and those two figures reconstruct the
   change exactly.

`buildSummary` is exported and tested **directly** for this: both rules depend on a driver *mix*
that whichever database a suite runs against may simply not contain, so a DB-backed assertion would
have kept passing while the page kept lying.

⚠️ **Also fixed in passing: `Scripts/check-lint-debt.sh` failed SILENTLY.** eslint exits 1 when the
tree holds any error, and its JSON is still complete — but piped under `set -o pipefail` that killed
the gate with no output and no reason. A gate that fires and produces no visible effect, in a repo
whose most-cited defect class is exactly that. It cost two debugging detours in one session; it now
tolerates eslint's exit code and fails loudly if eslint genuinely produced nothing. Falsified by
introducing an error and confirming the counts still print.

⚠️ **Desktop-only**, like `/investment-returns`: a phone gets the `/m/*` shell, which has its own
curated route set. Reachable there through the existing *switch to desktop* control. Not a
regression — a stated limit.

⚠️ **Not mine, observed while checking:** in dark mode the top nav renders on a light cream ground.
Verified identical on `/investment-returns`, a page this CR does not touch, so it is pre-existing
and app-wide — a [CR086](cr-086-ui-visual-system.md)-family item, logged rather than fixed here.

### 6c. Totals, and the row that makes them true (owner request, 2026-09-05)

*"We should have totals at top or bottom."* Both grids now foot. What made it more than a
`reduce()`:

- **The footer reads `data.drivers`, not the rendered rows.** The rows and the driver totals are
  computed on different paths, so a footer that re-added the rows would agree with itself no matter
  what and prove nothing. Falsified: switching it to sum the rows fails the test.
- 🔴 **A footed column did not actually foot, and the test caught it.** The grid filtered out
  accounts with `|change| < 1` — **16 of prod's 58 leaves** — so the columns missed their totals by
  **$0.48**: small enough to read as rounding, and it was not. Two fixes. The filter now keeps an
  account if its change **or any driver** is material, since an account with income +500 and
  spending −500 nets to zero and was taking $1,000 of real activity out of the columns. And the
  server emits a **remainder** — everything not shown, derived **by subtraction** from the
  authoritative totals — so shown rows **+ remainder = total**, by construction rather than nearly.
- ⚠️ **The modal foots too, and only because of that remainder row.** It shows a top-12 of 42; a
  bare `Total` beneath a top-N list is a subtotal wearing a total's name — the same shape as §6a's
  legs-under-a-cancelling-driver. `Other accounts (30)` is what makes its column honest. The
  first cut instead *refused* to foot and printed "showing the 12 largest of 42"; the remainder row
  is strictly better, so that note is gone.
- ⚠️ **The PIXELS still do not foot exactly, and the page says so.** Figures render to whole
  dollars, so 42 rounded rows sum to **−$96,707** against a **−$96,705** total — measured. The
  decomposition is exact; the display is rounded. A note states it, because a reader adding the
  column and finding $2 missing would rightly stop trusting the rest, and the hint that claimed the
  months add up *"exactly"* was softened for the same reason.
- The totals row sits in `<tbody>`, not `<tfoot>` — [CR054](cr-054-cash-flow-by-account.md) put one
  in `<tfoot>` where it missed the frozen-column selector and scrolled its label away from its
  figures.

### 6d. ⚠️ Where §6c's code actually lives in the history

The totals work in §6c is committed as part of
**`e5f5f42e feat(cr093): the Exposure page`**, not under a CR092 message. It was not a mistake
inside that commit — it is what a shared working tree does.

Two sessions were writing at once. This one staged its files and ran a bare commit; the other
session's commit consumed the shared **index** first, taking these ten files with it, and this
session's commit reported *"nothing added to commit"* and made nothing. By the time it was noticed
the commit was pushed, tagged **v3.55.0** and deployed, so correcting it would have meant
force-pushing over a tag and a running container — declined (owner, 2026-09-05).

**The code is correct, released and live; only the attribution is wrong.** Recorded here because
history for `bridgeParts.jsx`, `netWorthBridge.js` or `NetWorthDrivers.jsx` otherwise points at a
message about an Exposure page with no explanation.

⚠️ **The lesson is [git-concurrency.md](../../.claude/rules/git-concurrency.md) §0, and this session
had already followed it once.** It built P0 and P2 in worktrees, then left the worktree to run
`/close` — because the deploy script builds from the main tree — and kept working there afterwards.
**Leaving the worktree for the release is the whole failure.** The rule's escape hatch ("you may
work directly on main when you are demonstrably the only writer") was not re-checked before
committing, and by then it was false.

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
