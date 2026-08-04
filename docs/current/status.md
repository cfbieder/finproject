# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [status log](../archive/status-log_2026-08-01.md).

**Last updated:** 2026-08-04 · **Live version:** v3.13.1 (see `VERSION` / git tags)

## Current phase
**[CR069](../cr/cr-069-forecast-streams.md) drafted and two-pass reviewed (GO, 2026-08-04) — the
owner-directed unification of Forecast Expenditures into Modules.** A module becomes *identity +
optional valuation + N first-class streams*; one stream evaluator replaces three divergent ones;
the Expenditures step, ~2,770 lines of `FCExp*` and four tables retire. Four phases, each
shippable; gate everywhere: per-(account, year) `forecast_entries` sums identical to the cent on
a prod copy. **P0 shipped in v3.13.1 and is live** — inc/exp entries now carry the item's name,
not its FC line, so `Retirement Home`, `Car Purchase Chris` and `Social Security` stop hiding
inside `Living Expenses` / `One-Off Items` / `Total Salary`. The gate ran on a real prod copy:
**4,030 (scenario, account, year) sum rows, zero differing**, exactly 15 module labels gained and
0 lost, 791 backend tests. The "last-write-wins ON CONFLICT" comment was false in both halves and
now says so (the clause has never fired — `entry_type` is never written and NULLs are distinct in
a unique index, so the rows were always additive and only *attribution* was lost). **P1 is applied
on dev + prod as migration 057** — the two stream tables and `has_valuation`, inert and proved so
(a prod copy regenerated before and after is byte-identical). Review caught that the CR's own
`UNIQUE (module_id, direction, fc_line_id)` constrains nothing when the line is NULL — P0's trap,
written into its own fix — and that the frozen backfill note would have **inverted 58 of 113
change rows** by negating `Percent %`, a rate rather than an amount. **P2 (backfill + cutover, one
deploy) is next.** Sequencing per PM sign-off: **CR064 P2/P4/P5/P10 code waits behind CR069 P2**
(`copyScenario` is in CR069's scope); two owner sign-offs due at kickoff (CR §2 Decision 9
coarsening; §6.1 dead typed amounts).
**[CR066](../cr/cr-066-fc-line-mapping-completeness.md) is next up, at the owner's request** — twelve COA
categories with real activity map to no FC line, so **−78,689 of expense and +31,474 of income sit
outside the forecast** and no screen says so. P0 is a decision per row, not code.
**[CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) remains the live engineering thread** —
P0/P1/P3/P6/P7/P8/P9/P11/P12/P13 shipped; **P2 decided 2026-08-02 (keep minting a copy each year), designed but not built**;
P4/P5/P10 designed. Otherwise: owner-found defects, their follow-ups, and a long thread of
brokerage-history data work. Detail lives in the CR file linked from each line.

- **[CR068](../cr/cr-068-mobile-actuals-search.md) — the Actuals search a phone did not have, and a
  totals tile that was adding currencies together (v3.13.0).** Owner-requested; P3 deferred. There was
  no mobile Actuals page *at all* — `/trans-actual` had no `DESKTOP_TO_MOBILE` entry, so a phone
  opening it was dropped on `/m` home. `/m/transactions` is a search box over three chips; it holds an
  `ACTUAL_CONFIG`-shaped filter object, so `useTransactions` and the period mapping are **shared** with
  the desktop page and the two cannot drift on what a month means. **The screenshot that prompted it
  was showing a wrong number:** `PLN (453.64) + EUR (116.23)` *was* the `EXPENSES (BASE)` tile —
  a mixed-currency sum labelled base ([CR064 P8](../cr/cr-064-forecast-annual-close-and-assumptions.md)'s
  class, invisible with one currency in range). On real July data: **(68,064.39) shown vs (46,321.61)
  true.** `BaseAmount` was in the response all along, unread. **Three more defects in the same
  endpoint**, all fixed: four filter params sent and never read, a silent `LIMIT` truncation, and
  `Description1` mapped to a column that does not exist (so Budget-vs-Actual showed an em-dash for
  every row).
- ⚠️ **CR067 reached prod inside another thread's v3.11.16 deploy — the FOURTH instance of this
  class** (2026-08-03 02:11). `deploy-to-production.sh` builds the frontend from the shared working
  tree: P1 was committed and **P2's files were still uncommitted** when that deploy ran, so the
  bundle carries `FCMultiCompare-*.js` and the route while the `v3.11.16` tag contains only P1.
  **Prod therefore matched no tag.** *Harm: none, and it was checked rather than assumed* — against
  real prod data the page renders all four variants (five lines, base at weight 3, correct hues,
  zero page errors), which incidentally cleared the one gate the CR had deferred to post-deploy.
  Released deliberately as **v3.12.0**, which is what makes the running build reproducible from a
  tag — the same remedy the CR064 P6 incident record prescribes. *Same lesson, now four incidents
  old: work parked in the shared tree is not inert, and the migrations directory is not the only
  place it bites.* Now its own [Known Issue #17](project-roadmap.md#3-known-issues), with two fix
  candidates — build the image from `git archive HEAD`, or refuse a deploy on a dirty tree.
- **[CR067](../cr/cr-067-forecast-multi-compare.md) — the fan of variants, on one chart.**
  Owner-requested. `/forecast-multi-compare`: a base scenario and up to six of its variants as
  trajectory lines, base bold, same five metrics as Compare, *nothing else* — no delta grid, no
  commentary. **P1 + P2 built, verified on dev and on prod (v3.12.0).** Cheap because
  `buildScenarioMatrix` was already pure and single-scenario; the pairwise layer is simply not
  called. Two things carried the risk. **P1 modified CR040's shipped Compare page** to extract the
  shared chart — and its gate had to be *built first*, because neither Compare component had a
  single test: the parity render test was written against the shipped component, passed there, and
  passes unchanged after. **The alignment is by year, not by index** — each matrix trims to its own
  `PeriodStart`, so a positional plot silently shifts scenarios against each other; it would pass
  every check today (all five share a `PeriodStart`) and break the moment
  [CR064 P2](../cr/cr-064-forecast-annual-close-and-assumptions.md) ships. Palette validated against
  Fin's own surfaces, not the reference ones. *Also found, and **corrected 2026-08-03 after checking the code**:* the yearly
  copy does not lose *its own* lineage — `copyScenario` creating a **root is right**, a new year's
  base is a base, and `trg_fc_reject_nested_variant` would refuse it as a variant. What does not
  happen is that the **variants come across** ([CR064 P2](../cr/cr-064-forecast-annual-close-and-assumptions.md)
  item 4, already scoped), so next January's `2027 Base` starts with zero variants and this page
  draws one line until they are re-created against it.
- **[CR066](../cr/cr-066-fc-line-mapping-completeness.md) — what the forecast is not looking at.**
  The 2025 `Expense` stack totals **487,897** against a header row of **566,586**: the header reads the
  ledger's COA total, every child is an FC line, and a leaf mapped to no line is counted by one and
  neither the other nor the chart. **Neither number is wrong and nothing regressed** — they had always
  disagreed; nothing had put them side by side until v3.11.14 did. `Property One-Off` (−47,187) and a
  five-row `Patrick - *` cluster (−36,500) are the bulk; `Tax Adjustment` is a **+8,078 credit inside
  Expense**; `Rental - Spain` (+31,306) is probably *already* modelled via the SP modules, so mapping it
  would **double-count** — and that ambiguity is the real defect: "unmapped" means both *modelled
  elsewhere* and *not modelled at all*, indistinguishably.
- **The forecast graphs now start at the actuals year (v3.11.14).** Owner-found from a screenshot. Two
  paths fed the graph modal: the line chart resolved the pre-forecast columns through the table's own
  overlay, the stacked breakdown read `getCellValue` — null for both years by design — so its bars were
  zero and the all-zero filter dropped them. The overlay moved to `utils/fcCashValue.js` so both
  resolve a cell the same way. **The balance half is guarded deliberately:** the ledger holds every
  leaf while the engine writes many balance rows at level 2 and never at their leaves, so a naive
  overlay would turn rows that sensibly fall back to a line chart into stacks filled in 2025 and empty
  after (Bank Accounts: 24 segments, one column). It runs *after* the engine-data filter — 3 rows gain
  a real 2025 column. Columns read `· Actual` / `· Budget` and draw lighter: three bases in one chart
  otherwise look like one trend.

- **A forecast module labelled USD over PLN values — 18,250 of liability that does not exist**
  ([CR064 P13](../cr/cr-064-forecast-annual-close-and-assumptions.md#11a-p13--a-module-labelled-usd-over-pln-values-and-the-credit-card-question-that-found-it),
  migration **056**). Found while answering a *modelling* question — should the credit cards be
  forecast as a ratio of expenses? Five `PLN Credit Cards` modules carried `currency='USD'` over
  PLN values, inherited from account 65, a **parent rollup mislabelled in `accounts`**. The engine
  reads the FX assumptions only when `Currency !== 'USD'`, so the branch never ran, `fxrates` kept
  its `fill(1)`, and the PLN amount posted straight onto a USD balance sheet; the `MarketValueUSD`
  override repairs **index 0 only** — a year that is not even an output column — so the one correct
  year was invisible and all 36 wrong ones were not. **A wrong non-USD label announces itself; a
  wrong USD label is silent forever**, which is why the engine now **throws** on the contradiction
  rather than healing it (exactly the five bad rows trip it; none of the other 110 does). Repaired
  on dev + prod, both balances refreshed to their `base_date` ledger, `USD Credit Cards` enabled,
  variants synced from base and all five scenarios regenerated — every scenario now carries an
  identical, correct card position. **The answer to the question was no:** 4,772 card transactions
  since Jan 2025, **two** of them interest — the balance is *float*, and float cannot change net
  worth under any treatment. It also corrects the "~52K of missing debt" figure in P12's close-out,
  which was built on the mislabelled number; the true position was **28.6K**.
- **[CR065](../cr/cr-065-neutralize-pair-identity.md) — a neutralize counter-leg is claimable exactly
  once.** Owner-found: Fidelity Cash Mgt showed −107,830.71 of drift and it "cannot just be MTM". It
  could not — **$108,635 was bookkeeping, $804.50 was market**. `neutralize()` tested "already has a
  counter-leg?" by *value*, which is not identity, so two genuine $150,000 CD purchases claimed the
  same mirror. Migration **053** makes the **database** refuse a double-claim. **Live in v3.11.4**
  (053 + the prod data fix applied 2026-08-02): drift **−107,830.71 → +42,169.29**, which is exactly
  the unpromoted 07/31 feed rows (41,364.79) + the real MTM (804.50), and the new per-account
  unpaired-leg check reads **0** everywhere; the 07/31 backlog is promoted. **§8 — the same defect
  recurred an hour after the deploy** because `refreshBankFeedV2`'s sweep mirror and
  `transferToAccount` also make pairs and did not record them, so their counter-legs read as
  unclaimed (+$20,000 on Fidelity Bond). Fixed, migration **054**, and *the check caught it the same
  hour*. **§9 (v3.11.5)** adds the owner-asked guard: the review queue badges a securities leg with **no offset** and all four accept paths ask before letting one through — already flagging 3 of 71 rows. **§10: Cash Mgt now reconciles at drift 0.00** (−107,830.71 → 0) — three IRA reinvestment legs neutralized and the MTM booked (−804.50). **§11 (v3.11.6):** the owner proved the feed's lag with a calendar — 7/31 was a Friday, so Friday's close must equal Sunday's, and it did not. A balance is labelled with the date it *synced*, in the small hours, so the row dated D predates D's trading; marking against it booked Stocks **−44,600.45** (24,352.57 below the custodian) and proposed **+$40,150.79** on a CD ladder held at par. Guard (c) now refuses any observation synced before the day it would mark, and `balanceDate` names the one that contains it. **§11.1 (v3.11.7):** the guard had left the UI with a refusal and no remedy — it now lists the candidate observations with their balances and the page has a "mark against balance dated" input. **All five Fidelity accounts reconcile at drift 0.00**, and **§12** closed the last one: Chase Checking was −1,950.61 out on a *perfect* transaction match (142/142 against the bank export) because the Quicken promote ran **`ps-anchored`** and pinned it to *PocketSmith's* closing balance — but PS coverage ended 2026-06-01 and the feed owns it from 06-03, so it was anchored to a source that had stopped being true. Same failure mode `quicken-promote.js` already names for Fidelity Stocks (−42,552.71), unnoticed on Chase. Re-anchored −1,995.64 → −45.03. **`total_unreconciled: 0`.**
- **CI is green again** — migration **050**'s `found <> 1` guard was unconditional and aborted the
  chain on a data-free database, so `main` had been red since `2d49ff3`. **Third instance of this
  class** (046 was the first, and the fix note for it says exactly this), and again nothing
  announced it — [Known Issue #12](project-roadmap.md#3-known-issues), now three incidents old.
  Amended under the migrations rule's "unavoidable" clause; the chain builds all 52 files.
- ⚠️ **CR064 P6 reached prod as work-in-progress, via another thread's deploy** (2026-08-02
  20:21). `deploy-to-production.sh` builds from the shared working tree and applies every pending
  file in `server/db/migrations/`, so migration **055** and the P6 **engine** code went out while
  still uncommitted — the same hazard migration 051's row records for 044. **Harm: none, and it
  was checked rather than assumed.** The change is dormant by construction (`income_growth_rate`
  NULL everywhere, `forecast_module_income_steps` empty) and was proved byte-identical on a copy
  of prod (7,916 entries, all five scenarios); the served **frontend bundle carries no P6 UI**, so
  nothing can set either control. Released deliberately as **v3.11.8**, which is what
  makes the running build reproducible from a tag rather than from a working tree. *The lesson is the one already on the books: an
  unfinished file parked in the migrations directory is not inert.*
- **[CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) — one question, three defects**
  (P0/P1/P3 live). *Should the other module types get a custom form like Loan's?* **No** — §5. But:
  the module editor computed foreign-currency USD at **FX = 1** and in the wrong direction (**P0**,
  an unmatched €390K property posts $390K); renaming a scenario stranded its assumptions, which two
  saves later reads as **0% inflation for 36 years, silently** (**P1**, migration **052**, five
  dead names in prod); and the two blank prod modules are **Generate**'s doing, not Cancel's —
  CR042 fixed Cancel a day before they were written (**P3**). **P2 — the annual close:** every
  module is anchored **2025-12-31** while every scenario runs `PeriodStart 2027`, and the copy path
  never moves `PeriodStart`, so each scenario carries two base years at once.

- **The Fidelity accounts now reconcile to the custodian, not to themselves** ([CR058 §12](../cr/cr-058-quicken-valuation-anchors.md), dev + prod). All four anchored to Fidelity's own statements; the stale-feed MTM marks restated; the 2023 handoff plug found and corrected; and the anchors, which are `is_transfer` rows, no longer report as capital contributions — so return percentages exist for 2020–2024 for the first time. *Open:* whether to book any of the statement-derived unrealized series ([§12.8–12.9](../cr/cr-058-quicken-valuation-anchors.md)), Fidelity Options (markable, never anchorable), and whether the feed's +2-day lag is calendar or business days.
- **[CR059](../cr/cr-059-fintable-api-ingestion.md) — fintable's REST API replaces the Google-Sheet scrape.** P0–P2 built and gate-verified; **nothing live** (`FINTABLE_SOURCE=sheets`). Remaining: P3a (31 account mappings) then P4 cutover. Retires the display-name join behind the Black Card incident. ⚠️ **Migration 044 reached prod on 2026-08-01 while still untracked** — another thread's deploy scans the migrations directory — **and was incomplete** (it missed `bankfeed_balances`, so all 27 mappings read "no feed"). Reversed by **051** on 2026-08-02; the feed stalled rather than corrupting (0 promoted, 0 ledger rows). **The real crosswalk needs a new number and all three id columns.** **050** is applied on prod (it rode the same accidental deploy) — harmless, and still correct.
- **[CR060](../cr/cr-060-feed-connection-health.md) — a broken feed announces itself.** Bank-feed side deployed; **fin's recon page still to do**.
- **A secured-asset link set inside a VARIANT was erased by the save that set it** ([CR062 §11.2](../cr/cr-062-forecast-loan-module.md), fixed in v3.11.3, prod rows repaired). Owner-found: "2026 Buy Business" read *"No asset carries debt"* with both loans secured. Two id spaces reach variant sync's link resolution — an inherited link is a **base** module id, an overridden one is a **variant** id (the picker offers the variant's own modules) — and it mapped base→variant unconditionally, so `|| null` unsecured the loan inside `interceptWrite`'s own transaction: the PUT that saved the link returned 200 with it already gone. Now resolved by which scenario the target sits in. Nothing was lost — the override patches are the record — and on prod the links **self-healed on the first read after the deploy**: the very operation that used to erase them now restores them.
- **[CR050](../cr/cr-050-forecast-scenario-variants.md) — variants** are live and adopted; §10 (v3.11.0) made a variant read as one in all seven pickers. Owner has not yet run `adopt-variant` on "2026 Downside".
- **A module carries TWO base-year anchors, and that is now the open design question** ([CR064 §9.1](../cr/cr-064-forecast-annual-close-and-assumptions.md)). Its **value** series starts at the module's own `base_date` (2025-12-31 on 18 of 21) and takes no growth until `PeriodStart`; its **income/expense amounts** anchor to `PeriodStart − 1` (2026). v3.11.12 fixed the label that read the wrong one of the two, but not the split itself. **P10** — base-year P&L from `budget_entries`, module amount = the first forecast year — is designed and unbuilt; the objection that killed it earlier (per-module base-year tax) is weak: **0 of 110 modules carry a tax override**.
- **The forecast was rebuilt on the corrected opening cash (v3.11.11).** [CR064 P8](../cr/cr-064-forecast-annual-close-and-assumptions.md) fixed a base year summed in mixed currencies — `2026 Base` went **+144,395 → −254,728** — and that figure is the cash sweep's opening cash. The regenerate was held until the owner confirmed United Beverages' 500,000 is **PLN** (2026-08-02), which is how it was already stored, so no data was corrected. All five scenarios regenerated. *Residue left to the owner:* the 500,000 was meant for **2027** but sits in the **2026** field, so it projects 512,500 PLN next year; 487,805 would give exactly 500,000. The form now shows that derived figure, which is the point of the change.
- **Recent releases:** v3.13.1 ([CR069](../cr/cr-069-forecast-streams.md) P0 — an inc/exp item's entries carry its own name; no migration) · v3.13.0 ([CR068](../cr/cr-068-mobile-actuals-search.md) — the mobile Actuals search + the base-totals fix; no migration) · v3.12.0 ([CR067](../cr/cr-067-forecast-multi-compare.md) — Forecast Multi-Compare) · v3.11.16 (CR064 P13 — a module labelled USD over PLN values, migration 056) · v3.11.15 (CR064 P12 — Net Assets added the debt) · v3.11.14 (the forecast graphs' actual + budget columns) · v3.11.13 (CR064 P11) · v3.11.12 (CR064 P9) · v3.11.11 (the forecast rebuilt on the corrected opening cash) · v3.11.10 (CR064 P8 — the base year's currencies, and the sweep's opening cash) · v3.11.9 (CR064 P7 — the budget hint's currencies) · v3.11.8 ([CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) P6, migration 055) · v3.11.7 · v3.11.6 · v3.11.5 · v3.11.4 ([CR065](../cr/cr-065-neutralize-pair-identity.md), migrations 053/054) · v3.11.3 ([CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) P0/P1/P3 + the variant link above, migration 052) · v3.11.2 (the red CI) · v3.11.1 (the period filter) · v3.11.0 ([CR050 §10](../cr/cr-050-forecast-scenario-variants.md)) · v3.10.0 ([CR063](../cr/cr-063-coa-ordering.md), migration 049) · v3.8.0–v3.9.2 ([CR062](../cr/cr-062-forecast-loan-module.md) loans + equity, migrations 047/048).

## Known issue
- ⚠️ **"2026 Downside" has no sweep backup ranked** — *owner is redoing this scenario themselves (2026-07-13); **do not fix it**.* `Fidelity Stocks` carries no `cash_sweep_priority` there, so the engine reports **−$1.25M of shortfall across 2061–62 while $1.2M of stock sits untouched**. That is [CR045](../cr/cr-045-forecast-cash-warnings-liquidation.md) §5 working as designed (unranked = "I cannot sell this"), but for a liquid brokerage account it is almost certainly a data slip. One-row fix, left to the owner because it changes Downside's conclusions.
- Everything else: [roadmap §3](project-roadmap.md#3-known-issues) — 15 entries, including the timezone rule (#3), migrations reaching prod before dev (#15), the feed's settle lag (#14), the legacy unlinked transfer legs (#13), the 13 untriaged same-signed transfer clusters (#8), the ESLint JSX blind spot (#10), and the unannounced red `main` (#12).

## Live infrastructure
- **Dev and prod are the same host** (`192.168.1.87` / Tailscale `100.94.46.62`). Prod `docker-compose.yml` (project `psproject`, :3005, DB :5433, volume `fin_postgres_data`); dev `docker-compose.dev.yml` (:3105/:5434); v4 `docker-compose.v4.yml` (`finv4`, :3205/:5435, flags ON, isolated volume). Prod frontend: `https://fin.tail413695.ts.net`.
- `bank-feed/` microservice (:3007, separate repo) feeds 28 accounts; ocr-llm LLM gateway at `100.66.213.40:8080` (AI Review).
- Deploy: `./Scripts/deploy-to-production.sh` (DB backup first). Migrations: manual `psql -f`, registry in [migrations.md](migrations.md); runner shipped in CR043 P1.1 (`npm run migrate`).
- **Gates:** 788 backend / 396 frontend / 8 e2e tests; lint **blocking** (0 errors), plus six ratchets that may only shrink (lint-debt, api-envelope, buttons, modals, hex, tokens).

## Recently shipped
Canonical dates/versions: **[CR index](../cr/README.md)**. Per-release detail:
**[roadmap §1.2](project-roadmap.md)**. Full prior headlines: **[status log](../archive/status-log_2026-08-01.md)**.
- **v3.10–v3.11** — COA ordering (CR063, migration 049) · forecast loans + equity (CR062, migrations 047/048) · variant lineage (CR050 §10) · the period-filter fix.
- **v3.6–v3.7** — Investment Returns + IRR (CR056) · Book Income at Source (CR057, migration 041) · reset-opening (CR033) · the Revolut misattribution across both repos · the bank-feed ingest paging cap · the `Math.abs` reversal and `base_amount` sign defects · the JSX lint blind spot.

## Next
**Next up:**
- [CR069](../cr/cr-069-forecast-streams.md) **P2** — the backfill *and* the engine cutover, in one
  deploy (they cannot be split: nothing dual-writes, so an early backfill goes stale). Gate: the
  per-(account, year) sums identical to the cent, all five scenarios, on a prod copy.
  Then P3 (UI, drop).

**Next up (owner-requested, 2026-08-03):**
- [CR068](../cr/cr-068-mobile-actuals-search.md) — **shipped in v3.13.0 and live.** Worth the owner's
  eye on a real phone: it was verified at 390 px in a headless browser, and `<input type="month">`
  plus the safe-area padding behave differently on actual iOS — which is the class the last three
  fixes in that CR came from. P3 (row actions) is deferred by decision, with recategorize the one
  most likely worth building.
- [CR066](../cr/cr-066-fc-line-mapping-completeness.md) **P0** — decide an FC line for each of the twelve
  unmapped categories, or record it as deliberately excluded. Check `Rental - Spain` against a
  generated scenario's SP income **first** — mapping it may double-count. Then P1, so the next
  unmapped category announces itself instead of waiting to be found by a chart.

**With the owner (do not start these unasked):**
- "2026 Downside" — the owner is redoing it; also CR048's equity-growth and FX-stress decisions.
- [CR058 §12.8–12.9](../cr/cr-058-quicken-valuation-anchors.md) — whether to book any of the statement-derived unrealized series.
- [CR059](../cr/cr-059-fintable-api-ingestion.md) — the Chase date basis (`auth_date` vs posted) and the two Revolut wallets that no longer exist upstream.

**Engineering, unblocked:**
- CR059 P3a — a **new** crosswalk migration covering all three id columns (044 is reversed) → P4 cutover; CR060's fin-side recon page.
- CR043 tails: the lint-debt baseline (may only shrink), `util.js` hygiene split, Phase 4 (TypeScript).
- Long-running: [CR019](../cr/cr-019-quicken-import.md) investment-side promote · [CR023](../cr/cr-023-pocketsmith-removal.md) per-account PS migration · [CR034](../cr/cr-034-security-hardening-ci.md) rotate `BANK_FEED_API_KEY`.
- Full plan: [project-roadmap.md](project-roadmap.md).

## Conventions
Docs layout & rules: [documentation standard](../documentation-standard.md) · working rules
load from `.claude/rules/` (collaboration, git-concurrency, migrations, compose-safety,
env-secrets, data-import) · procedures: `/close`, `/question`, [month-end reconcile](../guides/month-end-reconcile.md) · dual-track v3/v4:
[dev-workflow](../guides/dev-workflow.md) · permissions setup:
[claude-code-permissions](../guides/claude-code-permissions.md).

## Drills & reviews
Last restore drill: **2026-07-13 — PASSED** ([runbook + log](../guides/restore.md)): a real prod dump restored in 3 s / 0 errors, the server booted against it, and the balance sheet **and** a regenerated forecast came back **byte-identical to prod**. Backups verified, not assumed.
Secrets inventory: [secrets-inventory.md](secrets-inventory.md) (escrow status open).
