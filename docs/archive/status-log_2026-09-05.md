# Status log — headlines archived from `status.md` (through v3.59.0, 2026-09-05)

> Archived 2026-09-05 because [`status.md`](../current/status.md) had grown to **404 lines**
> against the ≤ ~60-line rule in the [documentation standard](../documentation-standard.md), with
> **12 of its 25 "Next" bullets already finished** — a shipped item still sitting under *Next* is
> the exact pattern the standard names. Nothing here was edited: the bullets are lifted verbatim,
> in the order they stood, so the reasoning behind each one survives the trim.
>
> **This file is history, not state.** Canonical CR statuses live in the [CR index](../cr/README.md);
> per-release detail and ship versions live in
> [project-roadmap.md §1.2](../current/project-roadmap.md). Read this for the *why* behind a
> finished piece of work, never to learn what is true now.
>
> Earlier headlines: [status-log_2026-08-01.md](status-log_2026-08-01.md).

## Archived from "Current phase"

- **[CR085](../cr/cr-085-forecast-sensitivity.md) is COMPLETE, with no unbuilt scope** (v3.32.0 →
  v3.37.1, migration 073). `/forecast-sensitivity` ranks **which assumption the plan rests on** —
  every bar a real engine build on CR084's scratch harness. **Measured on `2026 Base`: 154 knobs —
  143 move the plan, 8 do not, 0 can kill a run.** That count is a fact about the DATA, not the page:
  prod offers 153, because one disposal there carries no selling cost and the schema-floor gate
  correctly withholds it. As-built detail is §17–§25 of the CR; the release notes are in the
  [roadmap](../current/project-roadmap.md).
  *(Its durable lesson — the display-side defect class — was deliberately KEPT in `status.md`: it is
  standing guidance, not history, and it caught three more defects in CR092 P1 the day this was
  archived.)*

## Completed "Next" entries (in the order they stood, newest first)

- ✅ **[CR092](../cr/cr-092-net-worth-bridge.md) P2 — `/net-worth-drivers`** (owner-requested from
  the modal: *"make this a report where the user can select the period"*). The same bridge over any
  period under **Reports & Graphs**, via the sibling report's `PeriodSelector`, with **every**
  account in a grid sortable by any driver column. The rendering is **shared** with the hero's modal
  (`features/NetWorthBridge/`) rather than copied — gated by all 11 modal tests passing unchanged.
  🔴 **Rendering it on a YTD window exposed a P0 prose defect that P0's own window could not show:**
  the lead named the largest driver by ABSOLUTE value, so a **$96,705 fall** read *"almost all of it
  is one thing: money earned added $368,591"*. Two rules now — a leading driver must share the
  change's sign, and cancelling drivers get **no** leader — and `buildSummary` is tested directly,
  since both depend on a driver mix no particular database is guaranteed to hold. ⚠️ Also fixed:
  **`Scripts/check-lint-debt.sh` failed SILENTLY** whenever the tree held any eslint error
  (`pipefail` killed it mid-pipe) — a gate that fires with no visible effect, which is this repo's
  most-cited defect class, in a gate. ⚠️ Desktop-only, like `/investment-returns`.
  **Polished v3.58.0** — a **dotted leader** now runs the bar column on every row of the
  waterfall, on both surfaces at once (they share `bridgeParts`): the label sits far left and
  the figure far right, and a contributor row has no bar to follow, so on the report page the
  two sat **~1,500px apart with nothing between them**. ⚠️ The leader alone did not work — the
  label column was absorbing the table's slack, so the dots began ~400px right of the text
  they should start from and the gap merely moved; the label and figure columns now shrink to
  their own content, which also widened every bar. ⚠️ It shipped **inside v3.58.0 with no
  mention in that release's note** — committed between the release's feature commit and its
  tag by a second session, neither able to see the other.

- ✅ **[CR092](../cr/cr-092-net-worth-bridge.md) is COMPLETE — P1, the LLM narration, shipped
  v3.59.0.** `ocr-llm` registered `finance_networth_narration` the day it was filed; the caller,
  the three defects that only RENDERING found, and the measurements are in
  [CR092 §9](../cr/cr-092-net-worth-bridge.md). ⚠️ **One item stays open and it is theirs, not
  ours, and it CLOSED hours later** — `ocr-llm` registered the measured `deadline_ms = 90000` the
  same day, so the chain now nests `~27 s < 90 s < 120 s < 150 s`
  ([§3 #27](../current/project-roadmap.md#3-known-issues), fixed). ⚠️ **#24 and #25 both SHIPPED in v3.55.2**
  ([roadmap §3](../current/project-roadmap.md#3-known-issues)), on owner decisions taken 2026-09-05: **#24** fixed
  the `base_amount` writer and **deliberately left the 271 historical rows** unrepriced (the $85,780
  sits in an `Unrealized G/L` posting the default Cash Flow view excludes, so only ~$1,950 is visible
  in the views actually read); **#25** gave the three remaining rate lookups the same tie-break, with
  no convention change.

- ✅ **[CR093](../cr/cr-093-portfolio-xray.md) P1 is COMPLETE — exposure v3.55.0, the sector picker
  v3.55.1, the fixed-income X-ray v3.56.0, the security detail chart v3.57.0, its yield row v3.57.1 — and **P3 (income) v3.58.0**.**
  `/investments/exposure` answers *what am I exposed to* by asset class, by sector with funds seen
  through, and by credit / maturity / coupon across the **58%** that is fixed income; any symbol in
  the register opens its chart. **Open: P2 (risk).** ⚠️ P3 shipped, and the `EAI` warning it was written around is now the
  code's central test: a bond maturing inside the window pays fewer coupons, and the schedule
  reproduces the custodian's own figure on all 27. ⚠️ **BDJ and EOS ($40,367) still need a hand-classification** no provider
  can give, and **`FMP_API_KEY` remains unverified**.

- ✅ **[CR061](../cr/cr-061-holdings-and-prices.md) P2 is COMPLETE (2026-09-05) — 117 of 117 account-statements
  reconcile, back to 2016-03-31.** 113 by the deterministic parser, **4 through the ocr-llm
  `finance_statement_extract` task**, both answering the same gate and provenance stored per snapshot. Dev holds
  **422 snapshots / 8,458 positions**; **prod holds all 117 statement snapshots** (437 total with the
  feed's 320, 8,742 positions), loaded across the v3.51.0–v3.55.0 deploys. The month-boundary question is answered and the
  answer is that there is no material drift: **IRA 42/42 and Cash Mgt 24/24 tie**, Stocks 4 dates at 0.00–0.05%,
  Bond 2 at +35.05 — the feared *"+14,163 on Fidelity Bond"* was the parser, not the ledger.

- ✅ **[CR090](../cr/cr-090-investments-section.md) P3 SHIPPED v3.52.0 — the decade is on the page.**
  Until it, `accountHistory()` filtered `source = 'bank-feed'` and **no page called the endpoint at all** —
  CR061 P2's 117 statement snapshots were queryable and unreachable. ⚠️ **It is TWO series, never one line:**
  the statement series is **quarterly, dated by `valued_on`**, the feed series is **daily, dated by
  `polled_on`**, and **they do not overlap** (statements end 2026-06-30, the feed starts 2026-07-04), so a
  continuous line would splice two datings across a seam no observation validates. Statement points are
  **discrete markers, never interpolated**. Live on Fidelity Bond: **103 points, 42 statement + 61 feed**.

- ✅ **[CR085](../cr/cr-085-forecast-sensitivity.md) — everything it deferred is now BUILT.** Tier 2
  (a token focus ring app-wide, replacing a default that composited to **1.18:1** — the widest-reach
  fix on this list, and it was never really about this page) · Tier 3 (compose and read stop sharing
  the page; a search over the catalogue; multi-band nested bars) · owner-typed bands · the knob
  sweep · the `forecast_stream_changes` schedules · the starting set. **The one thing still worth
  doing is not scope: nothing checks that a CHART draws everything it was handed** — every
  display-side instance of this CR's defect class was found by the owner, not by a gate.

- ~~Advisories~~ · ~~Real terms on Compare~~ **BOTH DONE** — all 15 advisories walked, **every one
  already deliberate, no model change** ([CR076 §13](../cr/cr-076-forecast-model-review.md)); two
  rules firing on streams **not in the plan** guarded, 17 → 15
  ([CR077 §7](../cr/cr-077-assumption-advisor-tab.md)); Compare in today's money, v3.26.0
  ([CR079 §7](../cr/cr-079-real-terms-view.md)) — only the **Home hero** stays nominal-only.

- ~~The editor-side consequence preview~~ **DONE, v3.29.0** (spinner v3.30.1; **LIVE on prod** since v3.30.0)
  ([CR084](../cr/cr-084-save-time-consequence-preview.md)): **Save now shows what it DOES first** —
  net assets before → after, nominal **and** in today's money, plus which scenarios move and which
  do **not**. Two real engine builds on a throwaway copy, applied through the SAME body→columns
  mapping the save uses (`services/moduleWrite`, extracted) so a preview cannot differ from the
  save. **Three defects only a browser found**, incl. a preview failure that *saved anyway*.
  **CR081 stays DEFERRED** — AI-proposed-edit acceptance measured **0/15, twice**, and its one
  high-value phase needs data a local model cannot fetch.

- ✅ **[CR082](../cr/cr-082-tax-section-fbar-114.md) — a `Taxes` section, first form FinCEN 114
  (FBAR). COMPLETE, and fully on prod 2026-08-16** (migrations **070** + **071**). TY2025 carries a
  figure on every line — 16 lines, **$2,627,821**, threshold exceeded — and TY2024 is recorded as
  filed. What shipped and the four defects that closing it exposed:
  [§11c](../cr/cr-082-tax-section-fbar-114.md#11c-the-remaining-items-closed-2026-08-16); the
  security half (`/util/coa-traits` served a full account number for **all 230 accounts to any
  caller**) is [§7.1](../cr/cr-082-tax-section-fbar-114.md#71-account-numbers--and-a-claim-the-review-falsified).
  **TY2025 is FILED (2026-08-16)** — the owner entered Part I and froze the year in the UI the same
  evening, so **freeze-on-file has now been exercised on real data**, which is the one item the
  tests could only simulate. The snapshot copied **16 lines / $2,627,821**, with the account number
  and institution name on each **copied, not joined**; the diff reads **16 of 16 comparable, 0
  moved**. ⚠️ **TY2024 carries an empty draft amendment** (seq 1, 0 lines) from trying that button,
  so the 2024 page reads `draft` while the original filing — 31 lines, $1,462,652, filed
  2025-10-07 — is intact underneath. Deleting the one row restores the `filed` display.

- ✅ **[CR088](../cr/cr-088-budget-vs-actual-le-table.md) — COMPLETE, v3.43.0 → v3.47.0.** The owner asked
  for `/budget-vs-actual` to read like the LE grid, and the restyle was **not only cosmetic**: the page
  drew hierarchy in colour and opacity — five `!important` per-level backgrounds and
  `opacity: 0.7 / 0.6 / 0.55` **on the money cells** — which is [CR086](../cr/cr-086-ui-visual-system.md)
  §3's contrast failure put back by hand on one page. It now follows LEGrid's stated rule (*depth is
  indentation and weight, never colour*). ⚠️ **Page-scoped, because `CashFlowReport.css` is imported by
  FOUR pages** and an edit in place would have restyled three reports nobody asked about. **P2** adds the
  three-state comparison over the selected period (new `GET /budget/le/:id/cash-flow`, no migration).
  ⚠️ **Its load-bearing fact, measured on prod: before the LE's cut the LE IS the actual** — 0 of 111
  leaves differ over Jan–Jul and the sums tie to the cent, so the page **says so** instead of letting two
  columns that agree by construction read as corroboration. Past the cut it is real signal: 17 of 57
  categories carry typed estimates. **Two more instances of the CR054 cascade lesson** — a cell font-size
  and the totals-row ground both lost silently and were settled by a **DOM probe**, not by reasoning
  about specificity. **P3 (v3.44.0) then put the look on EVERY report table** — lifted into
  `components/ReportTable.css`, opted into by four surfaces over seven pages, deleted at source
  rather than overridden. ⚠️ **It exposed two defects neither of which was cosmetic:** clicking an
  account name on the Balance Sheet did **nothing** (the `<td>` and its `<span>` both toggled the
  same key, so one click turned the highlight on and straight off — only the empty padding worked,
  while the label carried `cursor: pointer`; Cash Flow's identical span had always stopped
  propagation and this one had drifted), and the highlight fill was **three colour literals kept in
  sync by hand**. ⚠️ **Three more cascade losses, all measured not reasoned** — including two
  components that got the class but not the import, so they styled correctly **only if the user had
  visited Cash Flow first**, a defect that depends on navigation order and never reproduces on a
  direct load. **P4 (v3.45.0)** then fixed the chrome the dense tables had left out of proportion —
  a banner card that on `/balances` repeated the `<h1>` **word for word** in a box taller than the
  three rows beneath it (the words moved to the `<caption>`, where they stay for screen readers and
  print), one page of seven with a title nobody chose, and **two of CR086's "six rival title
  treatments" that turned out to be the same treatment twice**. `CashFlowReport.css` — which began
  this CR governing four pages' whole appearance — reached **zero rules and is deleted**.
  🔴 **Its last defect was found by the OWNER READING THE PAGE, and is the one worth keeping:** a
  variance column named `VAR VS LE` that actually computed **LE − BUDGET**. The methodology, the
  figures and the engine were all correct — *the header was lying about them*. **CR087's defect
  class (a column that can be read wrong) reproduced in a LABEL rather than a computation**, and
  §3.2 had ANTICIPATED the confusion without preventing it: the page already said *"LE will equal
  Actual on every row"*, which made the variance look impossible rather than explaining it.
  ⚠️ **A note stating a fact the column header contradicts does not resolve the contradiction.**
  **P5 (v3.46.0) fixed the MODEL that produced that label**, at the owner's direction — the page
  compares any **two of BUDGET · ACTUAL · LE** (`Act vs Bud` · `Act vs LE` · `LE vs Bud` · `All`),
  every variance header names its own pair, and it is now titled **`Budget Analysis`** (route
  deliberately unchanged). 🔴 **Its finding is the durable one: two of the three are variances and the
  THIRD MEASURES TIME.** `ACT−LE` reads **+150,091 favourable on full-year expenses** — essentially
  all of it September–December not having happened — and is **zero by construction** before the cut.
  That is [CR087](../cr/cr-087-money-legibility.md) P0b's exact shape reached by **honest arithmetic
  rather than a bug**, which makes it harder to catch, so it ships with a guard that counts unelapsed
  months rather than a footnote. Export follows the mode too — it had hardcoded three columns *and*
  kept its own copy of the row rule, the **third** screen-vs-workbook divergence in that one file.
  **P6 (v3.47.0)** closed the last two tabs. `/balances` → Trends is **transposed** so it cannot opt
  into the shared stylesheet; it shares the type scale and ⚠️ **`--font-mono` on figures that had been
  rendering in the BODY font**. Net Worth had **no `<h1>` at all** — ⚠️ **and adding one BROKE the
  page**, caught only by rendering: `.balance-grid` is a two-column grid, so the header became a grid
  item and shoved the chart into the 260px sidebar track. 🔴 **Its durable lesson is about
  MEASUREMENT, not CSS:** sweeping ELEVEN report pages instead of nine turned up a **twelfth** rival
  title treatment. **P4's "nine pages now render one title treatment" was true and incomplete — a
  measurement is only as good as its list**, which is the same shape as CR086's rig reporting true
  totals over a 25-row sample.

- ~~Real terms on Compare~~ **DONE** ([CR079 §7](../cr/cr-079-real-terms-view.md)) — one
  `buildScenarioMatrix` choke point; each scenario deflates by its OWN inflation, the anchor is
  shared. Only the **Home hero** is still nominal-only.

- ~~CR080 — the `accrue` reconcile mode~~ **DONE, v3.28.0 (2026-08-11)**
  ([CR080](../cr/cr-080-feed-accrual-reconcile-mode.md), migrations 065–067). Two **Wise Assets**
  accounts hold a money-market fund whose yield the feed reports in its BALANCE and never posts as
  a transaction; `calibrate` would fold a recurring flow into a constant at opening and `mtm` books
  it to an **expense** category. Both now book to `Interest Income` on a dated row, guarded by
  **implied annualised yield** — a missed transfer that `mtm`'s 15%-of-balance test would pass is
  refused. **Both accounts currently refuse, correctly:** the feed's day-jitter exceeds one day of
  accrual, so this runs at **month-end**, beside the MTM run. **Corrected 2026-08-11 by migration 069:** 065 had filed the
  leftover difference as an unexplained `Unrealized G/L` loss, reasoning that fin sitting ABOVE the
  feed could not be yield. It was a **calibration plug** — the owner had been calibrating for
  months, and `calibrate()` rewrites `opening_balance`, shifting every historical date by one
  constant, **with no audit row**. Moved into `opening_balance`; a fabricated −32.56 loss removed,
  `Interest Income` untouched, and **all eight anchors now tie to the feed to the cent**. Dev's
  ledger lacks 065–067/069 (applied prod-first) — `sync-db-prod-to-dev.sh` resolves it.
  **Pre-June-2026 interest: owner decided 2026-08-12 to book nothing.** No Wise interest statement
  exists; measured from PocketSmith's own `closing_balance` chain it is **+187.21 USD** (2023→May
  2026, order-independent, cross-checked two ways) — but **−504.27 on EUR, which interest cannot
  be**, so that account has a real gap, likely one missing transaction around 2026-05. ⚠️ **Balances
  are correct on both**; only the *classification* is missing (it sits in `opening_balance`, not
  `Interest Income`). Full record, including two false trails that looked convincing, in
  [CR080](../cr/cr-080-feed-accrual-reconcile-mode.md#historical-reconstruction--attempted-measured-and-declined-2026-08-12).
