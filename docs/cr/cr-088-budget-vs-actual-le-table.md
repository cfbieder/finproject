# CR088 — Budget Analysis: the LE grid's typography everywhere, and three comparisons instead of one

**Status:** **COMPLETE** — P1 + P2 ***v3.43.0***, P3 ***v3.44.0***, P4 ***v3.45.0*** (all 2026-08-26), P5 ***v3.46.0***, P6 ***v3.47.0*** (both 2026-08-27). **All eleven report pages now share one table look and one page header.** Frontend + one new endpoint, **no migration**. As-built notes are §6, what was deliberately not built is §8, P3 is §9, P4 (the chrome) is §10, §11 is the owner falsifying a column header, and §12 is what that led to.
**Track:** v3
**Migration:** none. `budget_le_lines` (migration 072) already carries everything P2 reads.
**Depends on:** [CR083](cr-083-budget-latest-estimate.md) for the LE itself · shares a defect class with
[CR086](cr-086-ui-visual-system.md) §3 and [CR087](cr-087-money-legibility.md).
**Roadmap anchor:** [project-roadmap.md#cr088](../current/project-roadmap.md)
**Origin:** Owner request, 2026-08-26 — *"use the same format as [the LE grid] as this one is much
easier to read … only difference is that we continue to allow the expand and contract of details"*,
plus *"Budget v Actual for period selected and Budget v LE for period selected"*.

---

## 1. The one-sentence shape

> **`/budget-vs-actual` draws hierarchy in colour and opacity; the LE grid draws it in indentation
> and weight. The owner finds the second legible and the first not — and the first is also a live
> instance of the two defect classes CR086 §3 and CR087 just spent three releases closing.**

## 2. P1 — the restyle

### 2.1 What is actually wrong, not just different

`CashFlowReport.css` (as it stood at v3.42.0 — **the file is deleted as of P4, §10.4**) gave each of five
tree levels its own `!important` background, a hardcoded `rgba(148, 163, 184, …)` left border, and —
for levels 2, 3 and 4 — `opacity: 0.7 / 0.6 / 0.55` applied to
`.balance-report-table__value`. That last one is the problem worth naming: **it dims money.** A leaf
figure three levels down renders at just over half opacity against its own tint, which is the
contrast failure CR086 §3 measured 2,364 instances of and cut to 1,227. This page put some of them
back by hand.

[LEGrid.css:317](../../frontend/src/features/BudgetLE/LEGrid.css#L317) states the opposing rule in a
comment, and it is the right one:

> *Depth is carried by indentation and weight, not by colour — a tinted "level" scale is the thing
> that inverts in dark mode.*

So P1 is not a taste change dressed as a fix. It is the fix, and the owner's preference and the
audit agree for once.

### 2.2 ⚠️ The trap: `CashFlowReport.css` is not this page's stylesheet

It is imported by **four** pages:

| Importer | What it is |
|---|---|
| [CashFlowReport.jsx](../../frontend/src/features/CashFlow/CashFlowReport.jsx) | the real Cash Flow report |
| [BudgetRealization.jsx](../../frontend/src/pages/BudgetRealization.jsx) | **this page** |
| [BudgetRealizationGraph.jsx](../../frontend/src/pages/BudgetRealizationGraph.jsx) | the Chart tab |
| [BudgetVariances.jsx](../../frontend/src/pages/BudgetVariances.jsx) | the Variances tab |

Editing it in place restyles three other reports silently, on a page nobody asked about. **P1
therefore adds a page-scoped class and does not touch the shared file.** The Cash Flow report keeps
its current look until someone asks otherwise.

### 2.3 What carries over from LEGrid, and what does not

Carried: `0.8rem` body / `0.68rem` uppercase muted headers · `0.3rem 0.5rem` cell padding · tokens
only, no `rgba()` literals, no `!important` · `--font-mono` + `font-variant-numeric: tabular-nums`
on every figure · `var(--surface)` ground with a `var(--surface-muted)` hover · weight-by-depth
(`d0` 700, rollup 600, leaf 400) with **no per-level background and no opacity**.

**Not** carried — the owner's stated exception: LEGrid has no expand/collapse, this table keeps it.
The toggle button lives *inside* the indent rather than displacing it, so a row's name still starts
at its depth's left edge. LEGrid's deliberate absence of a scroll container and sticky column
(a print constraint, [LEGrid.css:1-14](../../frontend/src/features/BudgetLE/LEGrid.css#L1-L14)) also
does not carry: this table can reach six columns under P2 and already lives in a scroll wrapper.

## 3. P2 — Budget vs LE for the selected period

### 3.1 The toggle (owner decision, 2026-08-26)

A three-state control in the toolbar. **The `BUDGET` column is always present**; the toggle chooses
what it is compared against.

| Mode | Columns |
|---|---|
| `Actual` | `CATEGORY · BUDGET · ACTUAL · VAR` — today's view, the default |
| `LE` | `CATEGORY · BUDGET · LE · VAR` |
| `Both` | `CATEGORY · BUDGET · ACTUAL · VAR · LE · VAR LE` |

### 3.2 ⚠️ Before the cut, the LE *is* the actual — and the page must say so

Measured on prod, 2026-08-26 (`LE-08-26`, `actual_through = 2026-07-31`):

| `source` | rows | categories | months |
|---|---:|---:|---|
| `actual` | 525 | 93 | 2026-01 → 2026-07 |
| `budget_carry` | 201 | 57 | 2026-08 → 2026-12 |
| `manual` | 48 | 17 | 2026-08 → 2026-12 |

`budget_le_lines` carries the transactions verbatim for every closed month. So for **any period
ending on or before the cut, the `LE` column is byte-identical to `ACTUAL`** and `VAR LE` is
byte-identical to `VAR`. Two columns that agree by construction read as corroboration; they are
not. The mode stays selectable — the owner chose an explicit toggle over auto-hiding — but the page
states the cut date and flags a period that does not reach past it.

Where the comparison *does* carry information: past the cut, LE = budget carried forward, overwritten
where the owner typed. **17 categories of 57** currently hold `manual` months for Aug–Dec, so a
forward or full-year period shows a real, sparse, readable signal — which is exactly the question
"where has my estimate departed from the budget I set".

### 3.3 ⚠️ The scope tie, and why the endpoint is shaped the way it is

The LE's own materialisation scope
([budgetLe.js:36-42](../../server/src/v2/repositories/budgetLe.js#L36-L42)) hard-excludes transfers
and `Unrealized G/L`, and rolls a parent's directly-posted amounts up. `/budget-vs-actual` **toggles**
both and counts leaf categories only. That mismatch is what
[FyLandingStrip.jsx](../../frontend/src/features/Budgets/FyLandingStrip.jsx) already has to state in
words — *"does not tie to the table below"*. Side-by-side columns would turn one footnote into a
per-row discrepancy.

**The fix is structural, not a disclaimer.** The new endpoint returns the *same shape* as
`GET /api/v2/budget/cash-flow` — a `Profit & Loss Accounts` tree of
`{ name, total, hasLe, children }`, built through the same `getNestedTree` and the same transfer
convention (`extractTransferCategories`, **imported from `budget.js` rather than re-implemented**;
a second copy of a name-matching rule is what cost CR087 §4b a wrong variance sign) — so the
frontend keys it by leaf name into the same `Map` as the other two columns and the hierarchy cannot
diverge.

One honest residual: **the LE holds no lines at all for transfer or `Unrealized G/L` categories**, so
with either toggle ON those rows have no LE figure. They render `—`, never `$0.00`. That is
CR087 P0b's rule, and it was learnt the expensive way: a failed fetch once rendered a page of
100%-favourable variances that looked like good news.

### 3.4 Endpoint

`GET /api/v2/budget/le/:id/cash-flow?fromDate&toDate&transfers`

Sums `budget_le_lines.base_amount` where `period_month` falls in `[fromDate, toDate]`, grouped by
category name, then builds the tree with `buildLeCashFlowNode` — a near-mirror of
`buildBudgetCashFlowNode` rather than a reuse of it, because that one has nowhere to put `hasLe`
and widening it would change the two columns this feature must not disturb. No migration.

`period_month` is the FIRST of each month, so a range is matched by containment of that
first-of-month, not by overlap; the period selector's real bounds (`2026-08-01 .. 2026-12-31`)
contain `2026-08-01 .. 2026-12-01`. A range outside the LE's budget year matches no lines and every
row comes back absent, which is the truthful answer rather than an error.

**Which LE?** There is exactly one non-superseded LE per budget year today. The page takes the head
of `GET /api/v2/budget/le?budgetYear=` (`findAll` already orders newest first and excludes
superseded). If the selected year has none, **the toggle is not rendered at all** and the mode falls
back to `Actual` — a disabled control the owner cannot act on is the CR085 defect class, and an
empty LE column would read as "the estimate is nothing".

## 4. Not in scope

- The Chart and Variances tabs keep their current look and their `Actual`-only comparison.
- `/m/budget-realization` (the mobile view) is untouched.
- The `includeUnrealizedGL` query param that
  [budget.js:514](../../server/src/v2/routes/budget.js#L514) accepts and never reads — the frontend
  filters `Unrealized G/L` client-side, so it is dead, not broken. Noted here so the next reader
  does not re-discover it; removing it is a separate cleanup.

## 5. Success criteria

1. `/budget-vs-actual` renders no `!important` background, no `rgba()` literal and no `opacity` on a
   money cell; every colour resolves from a token defined at both `:root` and `[data-theme="dark"]`.
2. The other three importers of `CashFlowReport.css` render byte-identically to before.
3. Expand/collapse, the one-layer buttons, the double-click detail modal and Export all still work.
4. Both themes rendered and read — not asserted from the CSS. The lesson of
   [CR082](cr-082-tax-section-fbar-114.md) is that no gate looks at the page.
5. P2: with a period ending on or before the LE cut, `LE` equals `ACTUAL` on every row — verified,
   and the page says why rather than leaving it to be noticed.

## 6. As built — and the four things that turned out differently

Everything in §2–§3 shipped as designed. These four did not, and each is the kind of thing that is
cheaper to write down than to rediscover.

### 6.1 Sizing the table is not sizing the cells

The first cut of `BudgetVaTable.css` set `font-size: 0.8rem` on `.budget-va .balance-report-table`
and stopped. The rows still rendered at the old height: PageLayout.css sizes the cells directly
through a bare `.balance-report-table td`, which inherits nothing from the table rule. **Measured
15px inside a 12.8px table.** Found by probing `getComputedStyle` in a real browser; it is invisible
in the stylesheet and almost invisible in a screenshot.

### 6.2 The totals row lost to its own ground rule

`.budget-va .balance-report-table__totals-row td { background: var(--surface-muted) }` was beaten by
`.budget-va .balance-report-table tbody td { background: var(--surface) }` — later in the file and
one selector more specific, because the Net Cash Flow row lives **inside `<tbody>`**. It rendered on
the wrong ground and looked deliberate.

Both 6.1 and 6.2 are the CR054 shape: a cascade tie settled by **a DOM probe**, not by reading the
CSS and reasoning about specificity. That reasoning was wrong twice in CR054 and would have been
wrong twice here.

### 6.3 The endpoint is enveloped; its sibling is not

§3.4 planned to mirror `/budget/cash-flow` exactly, bare response included. `check-api-envelope.sh`
refused it: bare responses are a **shrink-only ratchet** at 27, and the convention it exists to stop
spreading is *"this endpoint returns its payload bare because the one beside it does"*. The gate was
right and the CR was wrong. `GET /budget/le/:id/cash-flow` returns `{ data: … }`; the one caller is
new and unwraps.

### 6.4 A parent's own directly-posted lines do not show

`buildLeCashFlowNode` sums children and never looks a non-leaf up in the totals map — so the two
categories that post directly to a parent (`Car Expense`, `Children - Anna`) contribute nothing to
their own row. This is **deliberate and shared**: `/budget/cash-flow` and `/reports/cash-flow` have
the identical limitation, and the whole point of §3.3 is that the LE column must not disagree with
the two beside it. It does mean the LE column here and the LE **grid** at `/budget-le` legitimately
differ — the grid counts those lines (CR083 §2.1a). Pinned by a test rather than left to be
rediscovered as a bug.

## 7. What was verified, and how

- **Both themes rendered in a real browser**, not asserted from the CSS — criterion §5.4. Light and
  dark, collapsed and three levels deep, all three compare modes.
- **The pre-cut identity, on prod data.** `/reports/cash-flow` and `/budget/le/17/cash-flow` over
  2026-01-01..2026-07-31: **111 leaves, 0 differing, both sums 25,743.86**. Over
  2026-08-01..2026-12-31: **66 leaves differ**. This is §3.2 measured rather than argued.
- **Absent-vs-zero, in the DOM.** Transfers toggled ON, `Both` mode: **8 rows** render `—` in
  `--muted` across both LE columns — the four `Transfer - *` leaves and their parent, plus
  `Purchases - IT Costs` (budgeted, never estimated). None render `$0.00`.
- **The interactions survived the refactor**: expand/collapse one layer (99 → 54 rows), the
  double-click detail modal, Export. **0 console errors** in every run.
- **Gates:** `check-dead-tokens` (the runtime indent token is allowlisted alongside the two that
  already were), `check-inline-hex`, `check-modal-adoption`, `check-api-envelope` (back at baseline
  27 after §6.3), `check-button-css` (re-baselined for the segmented control — the same judgement
  LEGrid made for `.le-grid__catlink`: the shared `.btn` system would put three padded, bordered
  controls in a toolbar that already carries eight), `check-lint-debt` (**33 → 31**, re-baselined).
- **Tests:** 8 new backend tests, green on a from-scratch CI-shaped database
  (`Scripts/test-fresh-db.sh`, 1099 total); 582 frontend tests unchanged.

## 8. Not built

- **Export does not carry the LE columns.** `exportBudgetRealization` still writes Budget / Actual /
  Variance regardless of the selected mode. Small, and nobody asked; listed so the gap is known
  rather than assumed absent.
- **No LE picker.** The page takes the head of `GET /budget/le?budgetYear=` (newest first,
  superseded excluded). There is exactly one LE per budget year today; if that stops being true this
  needs a control, and a year with no LE hides the toggle entirely rather than offering an empty
  column.

## 9. P3 — every other report table (owner request, 2026-08-26)

> *"I think that font structure is much better — use the same for Cash Flow and Balances."*

### 9.1 One stylesheet, four opt-ins, seven pages

P1 scoped the look to one page **on purpose**, because `CashFlowReport.css` is imported by four and
an edit in place would have restyled three reports nobody had asked about (§2.2). The owner has now
asked for exactly those, so the rules were **lifted** into
[`components/ReportTable.css`](../../frontend/src/components/ReportTable.css) and every report opts
in by adding `report-table` beside its existing scope class — rather than copying
`BudgetVaTable.css` three times.

| Opt-in | Pages |
|---|---|
| `.balance-report report-table` ([CashFlowReport.jsx](../../frontend/src/features/CashFlow/CashFlowReport.jsx)) | `/cash-flow` — Summary · By Period · By Account |
| `.balance-report report-table` ([BalanceReport.jsx](../../frontend/src/features/Balances/BalanceReport.jsx)) | `/balances` — Summary · Periods |
| `.budget-va report-table` | `/budget-vs-actual` — Realization |
| `.cash-flow-report report-table` ([BudgetVariances.jsx](../../frontend/src/pages/BudgetVariances.jsx)) | `/budget-vs-actual` — Variances |

**Variances was not in the owner's ask and is included deliberately.** It hand-rolls the same
`.cash-flow-report` + `.balance-report-table` markup, so deleting the level tints at their source
would have left it half-restyled — worse than either extreme — and it is the sibling tab of the one
already done. Excluding it would have been *more* work and *less* consistent.

The old rules were **deleted at the source**, not overridden here, so no dead CSS is left behind.
`CashFlowReport.css` went 220 → 30 lines and `BalanceReport.css` 145 → 61; between them they gave up
five per-level `!important` backgrounds, the `opacity: 0.7 / 0.6 / 0.55` on money cells, the
`rgba(148,163,184,…)` tree connectors, two uppercase-green totals labels and a light-mode-only
sticky-head gradient.

**Three indent custom properties became one.** `--cashflow-indent-level`, `--balance-indent-level`
and `--budget-va-indent-level` were three names for one idea; they are now `--report-indent-level`,
which shrank `check-dead-tokens.sh`'s runtime allowlist from five entries to two.

### 9.2 ⚠️ Two defects the port exposed, neither of them cosmetic

**(a) Clicking an account name on the Balance Sheet did nothing.** Both the `<td>` and the
`<span>` inside it call `onToggleHighlight(pathKey)`, so one click on the label fired both handlers
and toggled the same key twice — on, then straight off. Only the cell's empty padding worked, which
nobody would find on purpose, while `.balance-report-table__name-text` carried `cursor: pointer` and
advertised the affordance anyway. **The Cash Flow report's identical span has always called
`event.stopPropagation()`; this one had drifted.** CR085's named defect class — state that renders
and produces no visible effect — and it took clicking the row in a real browser to find, because
nothing about the code reads as broken.

**(b) The highlight fill was three colour literals kept in sync by hand.** It was applied as an
**inline** `rgba(87, 188, 103, 1)` on every cell of the row; inline beats CSS, so the stylesheet
could only reach it with `!important`, which `BalanceReport.css` used — for the frozen first cell
only, in two hand-maintained hexes, one per theme. The row therefore had a pale first cell and
saturated remaining cells **by accident rather than design**, and the light/dark pair was exactly the
shape of all 12 CR026 dark-audit defects. The inline style is gone; one `--primary-subtle` rule now
paints it in both themes, shared with the Cash Flow report, which only ever set the class.

### 9.3 ⚠️ Where the cascade lost again, and how it was caught

Three more instances of §6's lesson, all found by measuring the rendered DOM rather than reading the
CSS:

1. **`.report-table` was added to two components without importing the stylesheet.** Cash Flow and
   Variances imported it; Balance Sheet and Budget vs Actual got the class only. CSS is global once
   loaded, so both pages styled correctly **if and only if the user had visited Cash Flow first** —
   a defect that depends on navigation order and would never reproduce on a direct page load.
2. **The highlight lost to the zebra-hover rule.** `…tbody tr:nth-child(even):hover td` scores
   (0,4,3) and beat a plain `…tr.--highlighted td` at (0,3,3), so a marked row on an even line, or
   under the cursor, silently reverted to the ordinary ground. Measured coming back
   `--surface-muted` instead of `--primary-subtle`; every odd/even × hover combination is now spelled
   out.
3. **A gate caught its own explanation.** `check-inline-hex.sh` failed on the two hex values quoted
   *inside the comment* documenting their removal — it greps text and cannot tell code from prose.
   Rewording was right; baselining would have permanently licensed two literals in that file.

### 9.4 Verified

- **All seven pages, both themes, measured in a real browser:** identical `12.8px` table and cell
  type, `0.3rem 0.5rem` padding, `opacity: 1`, mono tabular figures, opaque grounds
  (`--surface` / `--surface-muted`), and **0 console errors** on every page in every theme.
- **The frozen column under horizontal scroll**, which is the hazard in these reports and was CR054's
  actual defect. Both totals rows live in `<tfoot>`: after scrolling right, `Net Cash Flow` and
  `Net Worth` both measured `position: sticky` with their label pinned exactly at the wrapper's left
  edge, on fully opaque grounds in both themes. Nothing bleeds through.
- **The highlight** toggles on click and paints `--primary-subtle` uniformly across the row, with no
  inline style, in both themes.
- All six CSS/API gates green; 582 frontend tests unchanged.

### 9.5 Not touched

- **`/balances` → Trends** renders `.balance-trends-table`, a different table that shares none of
  this markup. It was not in the screenshots and is its own piece of work.
- **`/balances` → Net Worth** is a chart.
- **`/cash-flow` and `/balances` toolbars, KPI tiles and filter chips** — this is the table look
  only.

## 10. P4 — the chrome the dense tables left behind (owner request, 2026-08-26)

> *"Can you harmonize the style of those reports a bit more in line with recent changes?"*

P3 took the rows to `0.8rem`. Nothing around them moved, so the page furniture was suddenly out of
proportion with the report it framed. Three things, all of them things that only look wrong **because**
of the recent change, or that the change made visible.

### 10.1 A banner card that repeated the page title

Both report components opened with a `.budget-region` **card** — border, shadow, an accent bar and a
`1.35rem` uppercase `--primary` line — containing one sentence. On `/cash-flow` it read *"Cash Flow
Comparison"*; on `/balances` it read **"BALANCE SHEET" directly beneath an `<h1>` reading "Balance
Sheet"** — the same words twice, in a card **taller than the three rows underneath it**.

It is gone from both. **The words are kept, moved to where they belong:** a `<caption>` *is* a table's
accessible name, so screen readers announce it and the print stylesheet renders it — it is simply not
drawn on screen, because the page's own `<h1>` is already saying it. Clipped rather than
`display: none`, which would drop it from the accessibility tree and defeat the point.

### 10.2 One report of seven had its own title

`/balances` → Summary was the outlier: `--font-heading` at `1.625rem` in `--ink`, sentence case,
against the `1.35rem` uppercase `--primary` that `/cash-flow` ×3, `/balances` Periods and Trends,
`/budget-vs-actual` ×2 and `/budget-le` all use. Nothing chose that — the page was built on its own
and never reconciled. It now uses the shared header, and gained the one-line description its six
siblings already had.

**Nine report pages now render one title treatment**, measured rather than asserted: same class, same
`21.6px`, same uppercase, same colour, **zero banners**, in both themes.

### 10.3 Two class names, one style

`.realization-toolbar-header*` was **byte-identical** to `.report-toolbar-header*` — same four
declarations under a second name, so Budget vs Actual, Budget LE and Variances were styled by a copy
rather than by the original. Collapsed into one; **two of the "six rival title treatments"
[CR086](cr-086-ui-visual-system.md) counted were the same treatment twice.**

### 10.4 What the removal left dead, and was removed too

Deleting a thing is only finished when what fed it goes as well:

- **`features/CashFlow/CashFlowReport.css` is deleted.** P3 had already cut it 220 → 30 lines; the
  banner's two rules were the last things in it, so the file reached zero and its three imports went
  with it. It began this CR as the stylesheet that governed four pages' entire look.
- `.balance-report__title`, `.balance-report-table__caption`, `__caption-row` and `__caption h2` in
  `PageLayout.css` — four blocks with no remaining consumer.
- `.balance-report__title` in `BalanceReport.css`.

### 10.5 Verified

Nine report pages × both themes, measured in a real browser: one title class, one type size, one
transform, one colour; `0` `.budget-region__label` elements anywhere; captions present in the
accessibility tree and **not** visually rendered (`position: absolute`, clipped); **0 console errors
on every page in both themes**. Six gates green, 582 frontend tests unchanged.

### 10.6 Still not touched

`/balances` → **Trends** (a transposed table with accounts as columns and native+USD per cell — its
own structure, its own pass) and **Net Worth** (a chart, and one of the ten pages
[CR086](cr-086-ui-visual-system.md) counted as rendering no `<h1>` at all).

## 11. ⚠️ The LE variance column was named after the wrong benchmark

**Owner, 2026-08-26, reading the shipped page:** *"if the methodology for LE is to take the actual
for all months prior, why is this report showing a variance for vs LE?"*

**The methodology was right, the figures were right, and the header was lying about what they were.**
`VAR VS LE` computes **LE − BUDGET**. The name says the benchmark is the LE; it is not. On this page
every comparison is against the budget — that is the frame — and the LE is a third **subject**
alongside Actuals, not the thing being compared to.

Measured on prod for the owner's exact period, 2026-01-01 → 2026-07-31 (entirely before the cut):

| | Budget | Actual | LE | LE − Actual |
|---|---:|---:|---:|---:|
| Income | 318,784.02 | 360,920.09 | 360,920.09 | **0.00** |
| Expense | (327,656.59) | (335,176.23) | (335,176.23) | **0.00** |

**0 of 111 leaf rows differ between LE and Actual** — §3.2 holding exactly as designed. The
42,136.07 on screen is *actual vs budget*, a real and useful figure, mislabelled.

**This is [CR087](cr-087-money-legibility.md)'s defect class reproduced in a LABEL rather than a
computation** — a column that can be read wrong. It is worth recording that §3.2 anticipated the
confusion and still did not prevent it: the page already warned *"LE will equal Actual on every
row"*, which is what made the variance look impossible rather than explained. **A note that states a
fact the column header contradicts does not resolve the contradiction.** The owner found it by
reading their own page, which is this project's most reliable instrument and the one no gate
replaces.

Fixed: the header is now **`LE vs Budget`** — subject and benchmark both named, unmisreadable — and
the cut note says why a figure appears at all (*"it compares LE with the budget, not with actual —
over this period it is the same number the Actual variance shows"*). In `Both` mode over a pre-cut
period the page now makes the point itself: `Actuals` and `LE-08-26` render identical figures, and so
do `Variance` and `LE vs Budget`.

## 12. P5 — three subjects, three comparisons (owner, 2026-08-26)

> *"I see this brings the crux of the issue — we are comparing LE to budget here, correct. What we
> want is to compare ACT to BUD, ACT to LE and LE to BUD. Think how we can best allow for those three
> variants."*

§11 fixed the label. This fixes the **model behind it**, which is what generated the wrong label in
the first place.

### 12.1 The framing was wrong, not just the header

P2 modelled the page as *"what is the always-present BUDGET compared against"*. That is why the LE
variance ended up named after the wrong benchmark: **with three subjects the budget is not
privileged**, and a control implying it is will keep producing headers that name the wrong half.
There are three subjects — budget, actual, LE — and therefore three pairwise comparisons.

`compareMode` now names the **pair**, and every mode renders only the subjects it compares:

| Mode | Columns |
|---|---|
| `Act vs Bud` *(default)* | `BUDGETED · ACTUALS · ACT VS BUD` |
| `Act vs LE` | `ACTUALS · LE · ACT VS LE` |
| `LE vs Bud` | `BUDGETED · LE · LE VS BUD` |
| `All` | `BUDGETED · ACTUALS · LE · ACT VS BUD · LE VS BUD · ACT VS LE` |

Subjects keep a fixed order so a column never moves between modes, a 2px seam separates *what each
thing is* from *how they differ*, and — the rule §11 bought — **every variance header names its own
pair.** A column called just `Variance` is unambiguous only while one comparison is on screen; the
moment there were two it was read as naming a benchmark it did not name.

### 12.2 🔴 Two of the three are variances. The third measures TIME.

This is the finding, and it was worth measuring before building. On prod, 2026-08-27, cut
`2026-07-31`:

| Period | ACT−BUD | LE−BUD | **ACT−LE** |
|---|---:|---:|---:|
| July (closed, pre-cut) | −138 | −138 | **0** |
| August (post-cut, **in progress**) | −2,780 | −3,955 | **+1,175** |
| Full year (spans the cut) | +161,831 | +11,740 | **+150,091** |

**`ACT − LE` on the full year says expenses are $150,091 favourable, and essentially all of it is
that September–December have not happened.** Twelve months of estimate against eight months of
actual. It is not a variance; it is a calendar artefact wearing one's clothes — and it is
[CR087](cr-087-money-legibility.md) P0b's exact shape (*a page of favourable variances that looked
like good news*) arrived at by **honest arithmetic instead of a bug**, which makes it harder to
catch, not easier. `ACT − BUD` and `LE − BUD` cannot do this: both sides of each are whole-period
figures over the same months.

So `Act vs LE` ships **with a guard, not a footnote**. The page counts how many months of the
selected window have not finished and says so in a warning-toned note — *"5 of the 12 months in this
period have not finished … Act vs LE is measuring elapsed time, not performance"* — distinct from the
neutral cut note, because *"this is redundant"* and *"this figure is wrong to act on"* are different
statements and must not look alike. Over a window at or before the cut it says the other true thing:
the comparison is **zero by construction, an identity rather than a finding**.

### 12.3 ⚠️ A seam that would have drawn nothing

The subjects/variances rule was first written as
`th.budget-va__var-cell:first-of-type`. **`:first-of-type` matches the first sibling of an ELEMENT
type and ignores the class**, so that asks for a row whose *first* `<th>` is a variance cell — which
never happens, because the first cell is always `Category`. It would have matched nothing and drawn
no seam, silently. Caught by reading the selector rather than the render; the marker is now set in
JSX, where *"which variance column comes first"* is actually known.

### 12.4 Verified

All four modes × two period shapes (a closed pre-cut month, and the full year with five unelapsed
months), measured in a browser:

- **Columns and seam correct in every mode**, subjects fixed in order, seam on the first variance.
- **`Act vs LE` over July: `$0.00` on both roots**, with the identity note — not the warning.
- **`Act vs LE` over the full year: the warning fires**, naming *5 of 12* (Aug–Dec, today being
  2026-08-27).
- **`LE vs Bud` over July renders figures identical to `Act vs Bud`**, with the cut note saying so.
- **0 console errors** in every mode, both themes; 582 frontend tests unchanged; six gates green.

### 12.5 The name, and the export — resolved (owner, `/question`)

§12.5 originally ended by flagging that the page was three comparisons wide and still called
**Budget vs Actual**, one of the three. Both that and a second mismatch P5 exposed were then walked
through and decided:

**The page is now `Budget Analysis`** — h1, nav label and route description. ⚠️ **The ROUTE is
deliberately unchanged.** `/budget-vs-actual` already absorbs three [CR042](cr-042-report-consolidation.md)
redirects (`/budget-realization`, `/budget-graph`, `/budget-variances`); a fourth would be redirect
debt on redirect debt for a string nobody reads, while the *title* is the part sitting on screen
contradicting its own toggle. `routes.test.js` needed no change, because it asserts paths.

*Budget Analysis* over the sharper *Budget Performance* for one reason: **`LE vs Bud` compares two
plans, and nothing has been performed yet** — so "Performance" would overstate one mode of four.
That is this CR's own repeated failure (a label claiming more than the thing delivers, §11 and
§12.1), declined for a third time.

**Export now follows the mode**, and this is a defect P5 created rather than a polish item.
`exportBudgetRealization` hardcoded `["Category", "Budget", "Actual", "Variance"]` and knew nothing
about what was on screen, so exporting from `LE vs Bud` produced an Actual column the reader had not
asked for and **no LE at all**. ⚠️ **It also kept its own copy of the row-drop rule**
(`actual === 0 && budget === 0`), which stopped agreeing the moment the page learned to consider only
the subjects it renders — so the row SET could differ too. **This file has form:** the comment still
in it records CR087 §4b finding a duplicated *sign* branch here, which would have left *"the screen
and the exported workbook disagreeing about the sign of every variance"*. Same file, same shape,
third instance. The rule is now `makeShouldDropRow`, passed in — one rule, no second copy to drift.

Verified by exporting in three modes and reading the workbooks back: `LE vs Bud` →
`Category · Budget · LE-08-26 · LE vs Bud` with figures identical to the screen; `Act vs LE` →
**no Budget column**; `All` → all seven. Sheet and filename renamed with the page.

**Left alone deliberately:** the KPI cards stay actual-vs-budget in every mode. Unlike the export they
are labelled *"vs budget"* on their face, so they state their own scope rather than silently
disagreeing — the same reasoning `FyLandingStrip` already uses for a figure that does not tie to the
table beneath it.

## 13. P6 — the two tabs P3–P5 kept skipping

§9.5, §10.6 and §12 each ended by naming `/balances` → **Trends** and **Net Worth** as untouched.
This closes them, and finding the end of the list turned up two things the earlier passes had missed.

### 13.1 Trends: the same type scale, not the same class

Trends is **transposed** — periods down the rows, accounts across the columns — so it cannot opt into
`components/ReportTable.css`: the hierarchy, indent and totals rules there have nothing to attach to.
What it *can* share is what the owner actually asked to harmonise, and now does: the type scale
(`0.68rem`/600 headers, `0.8rem` body), the density (`0.3rem 0.5rem`, down from `0.7rem 0.85rem`),
and **`--font-mono` on the figures**.

⚠️ **The money was rendering in the body font** — measured `Outfit` at `15.2px` — while all seven
other report tables use `--font-mono`. `tabular-nums` was already set, so the columns did line up;
they simply did not look like money anywhere else in the app. The density change also pays for
itself: at the new scale **two more account columns fit on screen** without scrolling.

Three smaller things in the same file:

- **`letter-spacing: 0.06rem`, not `0.06em`** — the right number in the wrong unit, so it did not
  scale with the type it was tracking.
- ⚠️ **Negative money in `Both`-currency mode was on `--danger`, the ALERT token**, while the
  single-currency cell beside it uses `--growth-negative`, the MONEY token. **They resolve to the
  same value in both themes today, so nothing looks wrong** — the hazard is latent:
  [CR086](cr-086-ui-visual-system.md) §3's repoint moved the money colours specifically, and the next
  one would move `--growth-negative` and leave these behind.
- **Eight dead hex fallbacks** (`var(--primary, #6b8e6b)` ×5, `var(--primary-strong, #587958)` ×2,
  `var(--danger, #b14a4a)`). Every token is defined at both `:root` and `:root[data-theme="dark"]`, so
  none could ever fire — and each encodes the **light** value, so if one ever did it would light-mode
  a dark page. `check-inline-hex.sh` does not see CSS fallbacks.

### 13.2 Net Worth had no `<h1>` — and giving it one broke the page

It was the only Balances tab without a title while its three siblings all had one, jumping from the
tab strip straight into a chart card: one of the ten headingless pages
[CR086](cr-086-ui-visual-system.md) counted. It now carries the shared header. The chart's own
*"Assets vs Liabilities"* heading **stays** — that names the CHART, not the page, which is the same
distinction §10.1 drew when it moved the report name into the table's `<caption>`.

⚠️ **Adding the header broke the layout, and only rendering caught it.** `.balance-grid` is a
two-column grid (`2.1fr` / `minmax(260px, .75fr)`), so the new header became a grid **item**: it took
the 2.1fr column, shoved the chart into the 260px sidebar track and wrapped the controls onto a
second row. Fixed with `grid-column: 1 / -1`, scoped to `.balance-grid >` — `.report-toolbar-header`
is shared by eleven pages and must not learn about one page's grid.

### 13.3 🔴 A TWELFTH title treatment, found by sweeping eleven pages instead of nine

P4 harmonised the page titles and verified **nine** pages. Sweeping all **eleven** for P6 turned up
one more: `/budget-vs-actual/chart` rendered `budget-graph-title` at **28px** — the same defect
BalanceV2 had, a page built on its own and never reconciled, sitting inside a destination whose other
two tabs had already been fixed. **The measurement was only as good as its list**, which is worth
recording: P4's *"nine report pages now render one title treatment"* was true and incomplete.

The words stay (that tab is a chart and says so, exactly as the Variances tab keeps its own title);
only the treatment joins. `budget-graph-title`, `budget-graph-subtitle` and `budget-graph-header` had
no consumer left and are deleted.

**All ELEVEN report pages now render one title treatment**, verified in both themes with zero console
errors.

### 13.4 One pre-existing defect found, recorded, not fixed

Trends' **Generate** emits a React *"Cannot update a component while rendering a different
component"* warning. It is **not** from this work — `BalanceTrends.jsx` is untouched here and a CSS
change cannot produce it — and it is **development-only**, stripped from the production build (prod
at v3.46.0 shows zero). Fixing it properly means restructuring state flow in a 431-line component
this increment has no other reason to open, so it is recorded in the roadmap rather than folded in.
