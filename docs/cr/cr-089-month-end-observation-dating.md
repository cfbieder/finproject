# CR089 — Month-end observation: relocate the control, then date it by evidence — P1 PROPOSED · P2 BLOCKED on CR061

**Track: v3. No schema change, no migration.**

Roadmap anchor: to be added (see §Housekeeping).

Two increments that were drafted as one and should not be:

- **P1 — relocate the observation control** into the per-row confirm dialog. **No dependencies.**
  Closes a footgun that can book **permanent income**.
- **P2 — date the observation from position prices.** **Blocked on
  [CR061](cr-061-holdings-and-prices.md)**, whose bank-feed holdings deliverable ships first, and
  whose discriminant is **not yet proven to separate** (§P2.3). Deliberately left unscoped until
  CR061's snapshots are queryable from fin.

⚠️ **This CR's first draft claimed the two could be worked in parallel. They cannot** — see
§P2.5 — and both review passes returned **revise** on that and on §Evidence, which had a fabricated
row. What survives is recorded below; what did not is recorded in §What the reviews corrected,
because this project's habit is to keep the falsified claim next to the corrected one.

## The pain, stated accurately

Booking August's month-end MTM on five Fidelity accounts (2026-09-02), all five were refused by
`mtm`'s `syncedBeforeDayEnded` guard, and the correct action was to set *"mark against balance
dated"* to **2026-09-02** for an entry dated **2026-08-31**.

⚠️ **That is NOT undocumented, and the first draft was wrong to call it a design failure.**
[guides/month-end-reconcile.md](../guides/month-end-reconcile.md) §3–4 already carries the mechanism
(*"the feed labels a balance with the date it SYNCED"*), the July proof table, the *"two days after
month-end — but that is an observation, not a rule"* caveat, and **two decision procedures** for
choosing between candidates — including *"once one account on a connection is settled this way, the
same date applies to all of them — they share a sync schedule"*, which the draft re-derived and
presented as its own design. **The refusal is deliberate; the procedure exists.** What follows must
earn its place against a written runbook, not against a vacuum.

## P1 — the control moves into the dialog

**Independently shippable. Nothing below the fold is required for it.**

`· mark against balance dated` sits **above the table** and applies to **every row reconciled while
it is set**. It is sent for `mtm` and — since CR080 §B2.1 — for `accrue`.

🔴 **The risk is not symmetric, and this is the whole argument for P1.** Leaving the box set after a
brokerage month-end and then touching a Wise row pins that **accrual** to a brokerage's observation.
An `mtm` mark self-corrects at the next mark; an **accrual books permanent income** and nothing ever
looks at it again ([CR080 §B4](cr-080-feed-accrual-reconcile-mode.md)). **A page-level control with a
row-level effect, on a page mixing both modes, twelve times a year.**

- Remove it from the page.
- The **dialog** gains the date, per row, **pre-filled** from the engine's existing
  `later_observations`.
- ⚠️ **"Confirm" must also mean "change".** The control is **relocated and pre-answered**, never
  deleted — a removed field with no dialog-side entry turns a refusal into a dead end.
- `Book MTM entry as of` (with its month/quarter/year-end presets) **stays**: a different question.

⚠️ **N2 from pass 1 — this is build, not fallback.** `later_observations` is returned by the engine
today but the modal never renders it; it reaches the owner only as prose inside `stale_reason`.
⚠️ **Sequence P1 behind the in-flight reconcile-modal work** (pass 2): it edits
`ReconcilePreviewModal.jsx` and `MtmDateControl.jsx`, and the latter is shared with
`ManualReconciliation.jsx`, which passes no `onBalanceDateChange` and has its **own unrelated
`balanceDate`** (the balance's date in the manual PUT). Do not collide the names.

## P2 — dating by evidence (BLOCKED; scope when CR061 lands)

### P2.1 The problem P2 would solve

`bankfeed_balances.balance_date` is a **poll** date, and stores whatever the custodian reported at
that moment:

| Feed row | Synced | Fidelity Stocks | Contains |
|---|---|---|---|
| 2026-08-31 Mon | 04:59 UTC = **00:59 ET** | 1,187,764.08 | Friday 08-28's close — the market had not opened |
| 2026-09-01 Tue | 04:04 UTC | 1,187,764.08 | still Friday's |
| 2026-09-02 Wed | 03:16 UTC | 1,185,594.38 | **Monday 08-31's close** |

⚠️ **fintable's own `snapshot_date` is a poll date too** — the finding that rules out the obvious
fix. `GET /accounts/{id}/holdings?date=2026-08-31` returns positions priced at **Friday's** close
(Σ 1,187,764.09). **No field anywhere states the valuation date.**

⚠️ **And the poll TIME drifts ~1 h/day** (07-28 04:12Z → 08-10 16:30Z → 09-02 03:16Z), so the
effective lag oscillates between one and two calendar days: the 09-01 poll at 02:29 ET had not seen
Monday's close, the 08-04 poll at 19:23 ET had. **That, not "syncs in the small hours", is the reason
a lag constant cannot work** — and it is why any detector must run at reconcile time rather than be
encoded.

### P2.2 A lag constant, and "first change wins", both fail

Both observed months settle at +2, but the rule that looks equivalent gets **July wrong**:

| | month-end | first change after | correct |
|---|---|---|---|
| July | 07-31 Fri | 08-01 = 1,157,779.86 | **08-02 = 1,165,523.25** ✅ (what was booked) |
| August | 08-31 Mon | 09-02 = 1,185,594.38 | **09-02** ✅ |

July's 08-01 is an intermediate the custodian later restated. Verified under the price test in
pass 1: snapshot 08-01 carries **07-30's** closes, snapshot 08-02 carries **07-31's**, rejected by a
4–200× margin. A third free fixture: snapshot 08-29 carries **08-27's** closes.

### P2.3 🔴 The discriminant is NOT yet proven to separate

The first draft's strongest row — `JEPI 57.50 = 57.50` — **was wrong**. It took `previous_close`
from `GET /prices?symbols=`; the real 08-31 close from `GET /prices/{sym}/history` is **57.13**. Two
fintable price endpoints disagree by **0.65%** about the same close, and the draft mixed them.

Measured per-symbol residual between custodian price and history close: **0.005% (CSCO) to 1.3%
(JEPI, July)**, systematically positive. **The 1.3% bias exceeds the 0.7% adjacent-day separation the
confidence argument rested on.** A single global tolerance calibrated on DIA will mis-date any basket
weighted toward less-liquid ETFs.

**Before P2 is scoped:** name the history bars as the sole authoritative series (never
`previous_close`), and re-measure with a **bias-immune** score — the day-over-day *change vector*, or
the **median relative residual** across the basket with the threshold derived from the measured
distribution. If the corrected margin does not separate, **P2 does not get built.**

### P2.4 🔴 It dates PRICES; the ledger books price × quantity

Measured live, 08-31 snapshot vs 09-02 snapshot (independently reproduced):

| Account | Δ snapshot | of which **quantity** | Proposed mark | Contamination |
|---|---:|---:|---:|---|
| Stocks | −2,169.70 | 82.04 | +19,082.64 | 0.4% |
| Bond | −882.35 | 43.20 | −940.10 | 4.6% |
| IRA | −370.63 | **293.35** | +5,516.95 | 5.3% |
| Options | +199.03 | **199.03** | +1,115.00 | 18% |
| **Cash Mgt** | +1,067.16 | **1,232.16** | **−119.00** | **1,035%** |

The 09-02 observation carries 08-31 **prices** and post-08-31 **positions** (QIMHQ +1,211.68 on Cash
Mgt; FDRXX/BDJ/EOS on IRA; SPAXX +82.04 on Stocks — dividend and sweep credits landing 09-01/02).
🔴 **For Cash Mgt the quantity effect is ten times the mark and the opposite sign — that mark is not
a market movement at all.**

⚠️ **The 08-31 snapshot has the right QUANTITIES and the wrong PRICES; the 09-02 snapshot has the
right PRICES and the wrong QUANTITIES. Neither observation is the August month-end.** The correct
value is Σ(month-end quantities × month-end closes), which no single snapshot holds.

**Open question P2 must answer in its text, before any build** — (a) book the custodian balance
as-is and *state* the quantity delta in the dialog; (b) refuse when quantities differ beyond a
threshold, naming the amount; (c) value at Σ(month-end qty × dated closes) — most correct, but breaks
the "the number booked is the custodian's own" property [CR061 §5](cr-061-holdings-and-prices.md)
defends. Pass 1 recommends **(b) above a threshold, (a) below it**.

⚠️ **Until this is answered, the proposed dialog sentence — *"priced at the 2026-08-31 close"* —
asserts more than the arithmetic supports.** That is [CR088 P5](cr-088-budget-vs-actual-le-table.md)'s
exact shape: correct methodology, correct figures, **a label lying about them**, owner-found by
reading the page.

### P2.5 The dependency is a hard block, not coordination

Verified: bank-feed has **no holdings route**; fin has **no holdings table** and **no
`bank_connections` table at all**. [CR061 §13](cr-061-holdings-and-prices.md) lists the bank-feed
holdings deliverable (`008_feed_holdings.sql`, `fetchHoldings`, `routes/holdings.js`, contract +
`HANDOFFS.md`) as **CR061's own first shipment**. P2's evidence cannot be gathered until that lands,
in another repo, owned by another thread.

**Re-cut accordingly:** P2 should read **fin-local tables CR061 fills**, not add a second live
passthrough. That deletes most of the timeout/cache/fail-open machinery and removes a network call
from a read-only preview path entirely.

### P2.6 Constraints P2 inherits

- **Group by sync run, not by connection** — fin cannot see connections. Identical
  `source_synced_at` works and is local: on 2026-09-02 the six Fidelity accounts share `03:16:53`
  exactly. (One 06:31:28 batch groups six non-Fidelity accounts, all `calibrate` — harmless, but say
  so.)
- **Co-movement is stronger than the draft claimed:** across **all 94 days** of `bankfeed_balances`
  history there is **not one day** on which some of the five Fidelity feeds moved and others did not.
- **Only 2 of 5 accounts are datable** — Stocks and IRA hold tickers; Bond is all CUSIPs, Cash Mgt is
  CUSIPs + a money-market fund, Options holds only SPAXX. Hence grouping.
- **Floor of 2026-07-04** ([CR061 §4.8](cr-061-holdings-and-prices.md)): `?date=` before that returns
  `data: []`. No earlier month-end can be dated this way.
- **Symbol selection is unspecified and must not be** — how many, chosen how, excluding CUSIPs, MMFs
  at par and unclassified tickers; `BRKB`→`BRK.B` normalisation lives in CR061. Two rules the design
  lacks: **exclude symbols whose close did not move between candidate days** (they cannot
  discriminate), and handle **split/dividend-adjusted** series against as-traded custodian prices.
- **Reliability unmeasured for the endpoint actually used.** CR061 §4.7 measured `/prices` 503-ing on
  4 of 5 batches; pass 1 measured `/prices/{sym}/history` 200 on every call — different endpoints,
  neither number inherited. ⚠️ **`/prices/{sym}/history` working also falsifies CR061 §4.7's
  "do not plan a price backfill on it"** — tell that thread. Parameters are `start`/`end`; `from`/`to`
  404s with a misleading *"No price history for that ticker and range."*
- **Interaction with the three existing stale signals is unspecified** — state whether price evidence
  supersedes the flat-run and `syncedBeforeDayEnded` heuristics or sits behind them.

## Non-goals

- Filling `securities` / `quicken_price_staging` — [CR061](cr-061-holdings-and-prices.md), another
  thread. P2 **reads**; it stores nothing.
- Touching `accrue` (CR080 §B2.1 already self-selects) or `calibrate`.
- A lag constant (§P2.2); auto-apply — the write stays confirm-gated; re-marking prior months
  (§P2.6 floor); revaluing the custodian total (CR061 §5).
- **No schema change, no migration** — CR061 has already claimed 075.

## Verification

**P1:** the footgun reproduced (set the box on a brokerage row, then reconcile an accrue row, and
show the accrual pinned to the wrong observation) — then shown fixed. Both themes. The dialog
rendered, because every display defect this project found this week was found by a person looking at
a page and none by a gate.

**P2 (when scoped):** captured JSON fixtures, not network — snapshots are mutable
([CR061 §4.9](cr-061-holdings-and-prices.md) measured a snapshot re-minted under the same
`snapshot_date` within a day), the API 503s, and CI has no network. A **pure** function over
`(positions, close series)`. Three fixtures: **August ⇒ 09-02**, **July ⇒ 08-02** (must reject 08-01),
**08-29 ⇒ 08-27's closes**. Falsification: widen the tolerance until July picks 08-01 and confirm the
test fails. Plus a mandatory guard — **Σ(fetched snapshot) must equal the cached
`bankfeed_balances.balance` being marked** (they tie to the cent on all five today); refuse otherwise,
because matching evidence against a different number than the one booked is this repo's recurring
shape.

## What the reviews corrected

Kept next to the corrected claim, per house habit.

| Draft claimed | Reality |
|---|---|
| *"so the two can be worked in parallel"* | **Sequential.** P2 waits on CR061's bank-feed shipment (§P2.5). |
| *"the owner had to know a poll date — a design failure"* | The procedure is **documented** in [month-end-reconcile.md](../guides/month-end-reconcile.md) §3–4, including the connection-grouping rule the draft presented as its own. |
| `JEPI 57.50 = 57.50 ✅` | **Wrong endpoint.** The 08-31 close is **57.13**; residuals reach 1.3% against a 0.7% separation (§P2.3). |
| *"the dating is not an inference; it is arithmetic"* | **Circular.** The Σ-positions tie holds for **every** snapshot, so it corroborates nothing about the date. |
| CR087 P0c protects this path | It did **not** — `expect` covered `calibrate` only. **Fixed separately in `4048003c`**, not carried here. |
| *"fail-open, never fail-wrong"* | Reads as "let it through". It is fail-**closed** on the write, falling back to the refusal. Reword. |

## Depends on

**P1:** nothing. **P2:** [CR061](cr-061-holdings-and-prices.md)'s bank-feed holdings shipment and the
fin-local tables it fills. `/prices` needs nothing — public and unauthenticated.

## Housekeeping

⚠️ **CR index row and roadmap anchor still NOT added.** Another session holds uncommitted edits to
`docs/cr/README.md`, `docs/current/project-roadmap.md` and `docs/current/status.md` (and has since
claimed **CR090**); a pathspec commit takes the **worktree** state of a path, so adding them here
would sweep that thread's work into this commit
([git-concurrency.md](../../.claude/rules/git-concurrency.md), Known Issue #23). Pass 2 rates this a
**must-before-build**. Add once their work lands:

- `docs/cr/README.md` — a CR089 row (roll-up still reads Total 88).
- `docs/current/project-roadmap.md` — an `<a id="cr089"></a>` bullet under §1.1.

Also for the roadmap, not this CR's body: the quantity-decomposition question (§P2.4) and the
CUSIP/MMF undatable accounts (3 of 5) outlive this CR.
