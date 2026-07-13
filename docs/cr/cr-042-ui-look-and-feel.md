# CR042 — UI Look & Feel Modernization (2026-07-11 Design Review)

**Status:** ✅ **COMPLETE** (2026-07-13, v3.0.101) — U1–U5 all shipped and owner-accepted; the final IA items are settled and built (see §Owner decisions round 2). Produced by the 2026-07-11 three-lens review (UI · code structure · marketability). Companion CRs: [CR043](cr-043-code-structure-program.md) (code structure), [CR044](cr-044-productization-marketability.md) (marketability).
**Track:** v3 — frontend only, no migrations, no flags.
**Anchor in FC_NEXT_STEPS.md:** [cr042](../current/project-roadmap.md#cr042)

## Overall verdict

The shell (CR026 sidebar + TopStrip + ⌘K + dark mode + help glossary) is a competent Monarch/Linear-era app frame, and the newest "V2" pages (BudgetWorksheetV2, BalanceV2, FCCompare) are near-commercial quality. But the app is **two products wearing one coat of paint**: under the polished frame sit ~35 flat report pages, native `<select>`s, four rival table CSS systems, three coexisting button generations, 577 inline styles, hand-rolled SVG charts with frozen light-mode hex, and 17 files with literal `"Loading..."` strings. The first screen a user sees — Home — is the *least* visually rich screen in the app (four number tiles + two link grids, zero charts), while every market reference (Monarch, Copilot, Empower, ProjectionLab) leads with a net-worth hero chart. The "Mindful Minimalist" warm-cream/sage palette is **distinctive rather than dated** — worth keeping — but its execution is diluted.

## Findings by theme

### T1 — Token system: strong foundation, three gaps (P1)

Evidence: `frontend/src/index.css` (168 tokens, researched dark theme), `components/KpiCards.css`.

1. **Dead token references in shipped CSS:** `KpiCards.css` uses `var(--text-muted)` (5×), `var(--text)` (5×), `var(--font-heading)` (4×) — none defined anywhere (drift from an older naming scheme; the real tokens are `--ink*`). Values silently fall back to inherited styles.
2. **No type scale, coarse spacing scale:** zero font-size tokens → **110 distinct `font-size` values** across the CSS (0.85rem ×100, 0.9rem ×94, 0.95rem ×82, 0.8rem ×80…). Spacing jumps 0.75rem→1.5rem with nothing between, so pages hardcode in-between values. Market-grade systems run on a 6–8-step type scale.
3. **Green does four jobs:** `--primary` and `--accent` are the identical `#6B8E6B`; `--success`/`--growth-positive` are `#5B8C5B`; `--chart-emerald` is `#6B8E6B` again. Brand color, interactive state, and "money went up" are visually indistinguishable — exactly what finance-app leaders avoid. Split brand green from money green (one deliberate decision, then tokens enforce it).

Also: default `.panel`/`.kpi-card` treatment is 24px radius + `--shadow-lg` (`pages/PageLayout.css:6-16`) — heavier than the market norm of 12–16px radius + 1px border + minimal shadow. Flatten the default; reserve big shadows for overlays.

### T2 — Information architecture: the sidebar is right, its contents are wrong (P1)

Evidence: `config/routes.jsx` (35 routes; `SIDEBAR_GROUPS` ~:517), `components/Sidebar/*`.

- Page-per-report IA: the Reports group has 7 pages where market practice is ~2 (the four balance views `/balance`, `/balance-trends`, `/balance-sheet-periods`, `/balance-chart` are one "Balances" report with a view switcher; the two cash-flow pages are one). Budgeting has 5 pages (3 are budget-vs-actual variants). Transactions mixes daily tasks (Actuals, Refresh Feeds) with rare setup tasks (both calibration pages) — 9 items. Monarch ships ~8 top-level destinations *total*; Copilot ~6.
- Nav naming leaks internals: "FC Inc/Exp Mapping", "Upload PS", "Trans Budget" are developer vocabulary.
- Forecast already demonstrates the right pattern internally (`FCStepNav` 6-step pill flow) while the sidebar lists the same 6 steps as siblings — double navigation.

**Recommendation:** execute the FC_NEXT_STEPS §2 report-consolidation item (already awaiting owner decision) as the centerpiece: Balances 4→1 (Summary/Periods/Trends/Chart tabs), Cash Flow 2→1, Budget-vs-Actual 3→1; move calibration/setup pages under Settings/"Account setup"; target ≤8 primary sidebar items; rename to user vocabulary. `periodHelpers.js` is already shared, so this is mostly a routing/tabs exercise.

### T3 — Home is the weakest screen in the app (P1)

Evidence: `pages/Home.jsx`, `components/KpiCards.jsx`, `features/Balances/BalanceChartPanel.jsx`.

Home = 4 plain tiles + attention pills + two grids of links; no chart. Yet the app already owns everything a market-grade dashboard needs: `KpiCards.jsx` has Recharts sparklines + trend deltas + compact `$1.2M` formatting (used on FCCompare/FCReview but not Home), and net-worth-over-time data exists on `/balance-chart`. The AttentionStrip is genuinely *better* than market practice — keep it, give it a richer container.

**Recommendation:** rebuild Home as net-worth hero area chart (12–24 months) + KPI row using the existing `KpiCard` + AttentionStrip + recent activity; demote the "All Features" link grid (sidebar + ⌘K already do that job). Highest visible-impact change available.

### T4 — Tables & modals: one design system, four generations (P2)

Evidence: `pages/BudgetWorksheetV2.css` (best-in-repo), `pages/RefreshFeeds.jsx` (worst: three button systems on one screen, bespoke `role="dialog"` modals, literal loading text), `components/DataTable.css` (CSS with **no `DataTable.jsx`**), `.balance-report-table` redefined in 4 CSS files, 9 bespoke Forecast modals (e.g. 22KB `FCExpModal.css`) beside the good shared `ConfirmModal`.

**Recommendation:** codify the BudgetWorksheetV2 table pattern as a real `<DataTable>` (sticky header, uppercase micro-labels, right-aligned `tabular-nums` numerics, sortable column headers — replacing FCModulesTable's `<select>`-based sorting) plus a `<Modal>` primitive. Migrate RefreshFeeds first (highest daily exposure), Forecast second. **Adoption guardrail is mandatory** — the last generation of shared abstractions (`useAPI`/`useModal`/`useFormState`, `LoadingSpinner`, `DataTable.css`) shipped without one and died; pair each primitive with a lint/CI check like `check-button-css.sh`.

### T5 — Charts: `--chart-*` palette is dead code; two rendering worlds (P2)

Evidence: `index.css:73-79,222-228` (unconsumed chart tokens), `features/Forecast/FCCompareCharts.jsx` (market-grade, correct light/dark handling), vs hand-rolled SVG in `BalanceChartPanel.jsx` / `pages/CategoryTrend.jsx` (frozen light-mode hex gradients that don't flip in dark mode; `preserveAspectRatio="none"` stretch distortion) and CSS-div bars in `BudgetRealizationGraph.jsx`.

**Recommendation:** extract a `chartTheme.js` (the FCCompareCharts approach generalized: resolve token values once per theme) + shared `<ChartTooltip>`; converge the 3 hand-rolled chart pages onto Recharts through it. Fixes the dark-mode chart defects and distortion in one move; prerequisite for the T3 hero chart.

### T6 — Inline-style debt is localized but a dark-mode time bomb (P2)

Evidence: 577 `style={{}}`; top offenders `pages/FCLineMapping.jsx` (98), `FCReviewTable.jsx`/`FCAIReviewDrawer.jsx` (57 each); `FCStepNav.jsx` fully inline including JS `onMouseEnter` hover handlers; naked hex in `FCModulesEdit.jsx:611,1118,1241`; `FCReview.jsx:843-995` print-export HTML re-hardcodes the whole palette.

Nuance: much inline styling uses `var(--token, #fallback)` and themes fine — the real hazards are the naked-hex subset and the JS hover handlers no CSS migration will catch. **Recommendation:** migrate Forecast inline styles to token CSS starting with the naked-hex files; convert FCStepNav to ~30 lines of CSS; add the planned lint guard. The print exporter either reads `getComputedStyle` or stays documented light-mode-only.

### T7 — First-run & empty states (P2, cheap slice only)

Zero onboarding surfaces exist (grep confirms); the full guided first-run stays CR027D as planned. Pull forward two cheap slices that serve the owner too: **actionable empty states** (`EmptyState.jsx` already accepts children — add CTA buttons: "Connect a feed", "Import Quicken", "Create a budget"; currently copy is non-actionable "No balance data for current filters") and a Home empty-DB branch ("Start by importing data" instead of $0.00 KPIs).

### T8 — Mobile shell: separate shell is the right call (P3)

`useIsMobile.js` logic is unusually careful; the 8-page read-and-reconcile subset matches real phone use; tokens are shared so the brand doesn't fork. Verdict: **don't chase route parity or a responsive rewrite** — fix only the already-backlogged data-layer fork (shared data hooks; see CR043 Phase 3).

### T9 — Micro-polish inventory (P3)

- `translateY(-2px)` lift + colored glow on *every* button hover (`components/buttons.css:53`, global rule `index.css:328-331`) — 2019-era tell; reserve motion for cards/CTAs.
- Outfit loads from Google Fonts CDN (`frontend/index.html:16`) — self-host (privacy, PWA offline, FOUT).
- `pages/PageLayout.css` is a 4,278-line grab-bag mixing shared utilities with page-specific classes — split before it grows.
- Stale "prod-dormant until the sidebar is enabled" comments in `CommandPalette.jsx`/`HelpPanel.jsx` (CR026 shipped ON a month ago). HelpPanel lists 3 shortcuts; the palette does navigation+theme only — add actions (e.g. "new manual transaction").

## Target look & feel — direction options

- **Option A — Refine Mindful Minimalist (RECOMMENDED).** Keep warm cream + sage + Outfit; fix execution: split brand-green from money-green, add type/spacing scales, flatten default card elevation, tighten table density to the BudgetWorksheetV2 standard, tokened charts. *Rationale:* the palette is the app's one genuinely distinctive asset in a category converging on interchangeable cool-gray + electric-accent; the weaknesses are consistency problems, not palette problems; every A deliverable is also a prerequisite for B/C, so nothing is wasted if taste changes.
- **Option B — Fintech-neutral pivot** (Inter/Geist, cooler neutrals, 8–12px radii, denser everything). Buys "looks like Monarch" at the cost of looking like everyone and forces re-auditing the dark theme + all chart palettes + ~26k lines of CSS. Not recommended.
- **Option C — Hybrid ("warm shell, neutral data"):** warm brand chrome, cooler/denser/higher-contrast data surfaces (the ProjectionLab balance). Treat as a possible phase 2 if tables still feel soft after A's density pass.

## Plan

**Quick wins (days, no design decisions needed):**

1. Fix dead `--text*`/`--font-heading` tokens in `KpiCards.css` (P1, trivial).
2. Home phase 1: swap `home-kpi` tiles for the existing `KpiCard` — deltas + sparklines land for free (P1).
3. Kill remaining `"Loading..."` literals → `LoadingSpinner`; kill remaining `.generate-report-button` usages (P2).
4. Consolidate `formatCurrency` onto `utils/formatters.js` + lint guard (3 files remain — see CR043 verification) (P2).
5. `FCStepNav.jsx` → CSS classes; fix CategoryTrend's frozen dark-mode gradient hex (P2).
6. Self-host Outfit; EmptyState CTAs; delete stale "prod-dormant" comments (P3).

**Structural phases (each a release or sub-CR; order matters):**

| Phase | Scope | Depends on |
|---|---|---|
| U1 | Token scale + green split + elevation flattening + Forecast inline-style migration with lint gates (T1, T6) — ✅ **core DONE v3.0.69** (tokens/green/elevation); ✅ **inline-style migration DONE v3.0.75** (FCStepNav→CSS, 62 naked-hex Forecast style values → tokens, blocking `check-inline-hex.sh` guard) | — |
| U2 | Chart theme (`chartTheme.js` + Recharts convergence of the 3 hand-rolled pages) (T5) — ✅ **theme + frozen-gradient fixes DONE v3.0.70**; full Recharts convergence deferred (balance chart consolidated in U5) | U1 |
| U3 | Home dashboard v2 — net-worth hero + composed dashboard (T3) — ✅ **DONE v3.0.70** | U2 |
| U4 | `<DataTable>` + `<Modal>` primitives with CI adoption guardrails; RefreshFeeds migrated first, Forecast second (T4) — ✅ **COMPLETE v3.0.95.** Primitives + guardrails + RefreshFeeds (v3.0.71); 8 Forecast modals via the new `bare` mode (v3.0.74); the last two heavyweights — FCModulesEdit + FCExpModal — landed v3.0.95. **No bespoke `role="dialog"` overlay remains under features/Forecast.** | U1 |
| U5 | Report consolidation + sidebar re-cut to ≤8 items + user-vocabulary renames (T2) — **Balances 4→1 (v3.0.72, owner-approved) + Cash Flow 2→1 + Budget-vs-Actual 3→1 DONE v3.0.73** (all three via shared `<ReportTabs>`); 2 vocab renames done; ✅ **owner-accepted v3.0.97** (all tabs and all nine old-URL redirects verified against the owner's own bookmarks). Deferred (owner input): calibration→Settings move, Forecast-step sidebar collapse. **"Upload PS" settled 2026-07-13 — KEEP as-is** (already under Data Sources; retained as a PocketSmith-CSV escape hatch — do not delete) | **owner decision**; easier after U4 |

**Progress (2026-07-11, Opus).** U1 core / U2 / U3 shipped as v3.0.69–v3.0.70 (see roadmap). Deployed: emerald green split, flatter cards, type/spacing scales, `chartTheme.jsx` + dark-mode gradient fixes, and the Home net-worth-hero dashboard. **U4 primitives shipped v3.0.71:** `components/Modal/Modal.jsx` (Radix Dialog `@radix-ui/react-dialog` under the app tokens — focus trap, ESC, scroll-lock, ARIA the hand-rolled overlays lacked) + `components/DataTable/DataTable.jsx` (BudgetWorksheetV2 pattern codified: sticky header, uppercase micro-labels, right-aligned tabular-nums, built-in sort). Two CI adoption guards now **blocking** (`Scripts/check-button-css.sh` + new `check-modal-adoption.sh`, wired in `ci.yml`). RefreshFeeds migrated: its 5 bespoke `role="dialog"` overlays → `<Modal>`, `generate-report-button` → `.btn`, both read-only tables → `<DataTable>`. +9 vitest (138 total). **U5 Balances 4→1 shipped v3.0.72:** new `pages/Balances.jsx` — a deep-linkable `/balances/:view` tab switcher (Summary/Periods/Trends/Net-Worth) rendering the four existing page components unchanged (pure IA/routing, no report logic moved); the four old routes removed from config and 301-redirected in `App.jsx`; sidebar Reports group drops 4→1; Breadcrumbs + Sidebar active-state made param/prefix-aware. +3 vitest (141). **U5 Cash Flow 2→1 + Budget-vs-Actual 3→1 shipped v3.0.73** (owner approved the Balances pattern at the checkpoint): extracted a shared `components/ReportTabs/ReportTabs.jsx` (the tab-shell primitive, `.report-tabs` CSS) and refactored Balances onto it; `pages/CashFlowTabs.jsx` merges `/cash-flow` + `/cash-flow-periods` → `/cash-flow/:view` (Summary / By Period); `pages/BudgetVsActual.jsx` merges `/budget-realization` + `/budget-graph` + `/budget-variances` → `/budget-vs-actual/:view` (Realization / Chart / Variances). Budget Worksheet + Budget FX stay separate (not vs-actual). Old URLs redirect (App.jsx); +3 vitest (144). Two vocabulary renames ("FC Inc/Exp Mapping" → "Income & Expense Mapping", "FC Settings" → "Forecast Settings"). Deferred to owner input: moving the calibration/setup pages under Settings, the "Upload PS" legacy page's fate, and collapsing the six Forecast steps in the sidebar (FCStepNav already covers them). Remaining: U1's Forecast inline-style migration, U4's 9 Forecast modals. **U4 Forecast modals shipped v3.0.74:** added a `bare` mode to `<Modal>` (Radix overlay + focus-trap + ESC + portal, but the caller's own card keeps its look) so the bespoke `fc-*-modal` overlays migrate visually 1:1 while gaining a11y. Migrated 8: FCExpConfirmDeleteModal, FCModulesDeleteModal, FCReviewAuditTrailModal, FCReviewBreakdownModal, FCCashTransferModal, FCReviewAdjustTransferModal, FCModulesUnmatchedModal, FCScenariosModal (fixed two latent hooks-after-early-return violations in the two review modals along the way). Deferred the two heavyweight forms (FCModulesEdit, FCExpModal) — real regression risk without live click-testing. Modal-adoption baseline 19→15; +1 vitest (145). **U1 Forecast inline-style migration shipped v3.0.75:** `FCStepNav.jsx` → CSS (`FCStepNav.css`), removing the fully-inline styling and the JS `onMouseEnter/onMouseLeave` hover handlers (the real dark-mode hazard CSS can't reach); 62 of 64 naked-hex Forecast inline-style values (`color: "#808E9B"` …) → theme tokens (`var(--muted)` …) so they flip in dark mode — only exact-match / semantic-safe tokens were used (two off-palette blues left for an owner-reviewed pass); `FCCompareCharts` left untouched (its palette already handles light/dark). New blocking guard `Scripts/check-inline-hex.sh` (per-file baseline, count may only shrink) wired into `ci.yml` — the third adoption guard alongside buttons + modals.

**T1 reopened, then closed properly (v3.0.95).** Quick win #1 above ("fix dead tokens in `KpiCards.css`") was fixed and marked done — but the finding was never *only* KpiCards. A sweep found **63 `var(--…)` references across 30 files pointing at tokens that are never defined** (`--text-secondary`, `--ink-muted`, `--surface-hover`, `--warn`, `--ok`, `--font-heading`…). This is the quietest failure mode in CSS: `color: var(--text-secondary)` lints clean, reads as deliberate, and does **nothing** — it inherits, so the styling silently ignores the theme, dark mode included. Several carried a hardcoded fallback (`var(--warn, #f59e0b)`), which is worse: correct in light, frozen forever. All 63 remapped; `--font-heading` (referenced 4×, never defined) now exists. New **blocking** guard `check-dead-tokens.sh` — **no baseline; the bar is zero**. In the same pass the hex guard turned out to be the bug: it only matched `prop: "#hex"` and missed every composite (`"1px solid #hex"`), so its "66" was fiction — the true count was **170**, now frozen and shrinking. Outfit self-hosted (variable font, 2 files, SW-precached): no Google CDN request per page load, and the font finally works offline.

**Owner acceptance pass (v3.0.97).** The owner walked six test steps — module save, the ten migrated modals, audit trail, the consolidated reports, dark mode (the real test of the 63 token remaps), fonts. **All six passed; nothing in CR042 regressed.** The five bugs the walkthrough surfaced were all pre-existing (see the v3.0.97 entry in the [roadmap](../current/project-roadmap.md)); one belongs to CR042 and is fixed: the **Review toolbar** carried five equally-loud buttons (two rival greens, a purple gradient slab, two outlines), each pinned to `min-width: 150px`, wrapping into a ragged second row — an exact instance of T7's "three coexisting button generations". Only **Generate** mutates anything, so it became the sole filled primary on the shared `.btn` system, with Cash Sweep / Graph / Excel / AI Review quiet behind a divider (AI keeps its identity via a `--info`-tinted icon, not a gradient). This **removed** bespoke button classes (baseline 123 → 122) and two more naked hexes (170 → 167) rather than adding any — the adoption guards are now ratcheting *down*, which is what they were for.

## Owner decisions (settled 2026-07-11 via /question)

1. **Direction: Option A — refine Mindful Minimalist**, no rebrand. Option C's data-density instincts fold into the U4 table standard; revisit C only if tables still feel soft afterward.
2. **Report consolidation (U5): approved — all three merges** (Balances 4→1, Cash Flow 2→1, Budget-vs-Actual 3→1), executed balances-first with an owner checkpoint after the first merge. Old URLs redirect; each view keeps a deep-linkable tab. Closes the FC_NEXT_STEPS §2 owner-decision item.
3. **Green split: sage `#6B8E6B` stays brand/interactive**; `--success`/`--growth-positive` move to a distinct emerald tuned for light+dark contrast.
4. **Primitives (U4): selective Radix** — `@radix-ui` Dialog (+ DropdownMenu/Select where touched) under existing tokens for the new `<Modal>`; `<DataTable>` stays hand-rolled from the BudgetWorksheetV2 pattern. Resolves the never-enacted §4.5 "Radix UI" decision as *behavioral primitives only*.

## Owner decisions round 2 (settled 2026-07-13 via /question) — CR042 closes

5. **"Upload PS": KEEP, no change.** The open item was posed on a wrong premise: the page is not a stray top-level nav item — it already sits in the `Database` category the sidebar renders as **Data Sources**. Nothing has been imported through it since **2026-06-04** (the feed cutover completed 2026-06-06; the 8 non-fed accounts with recent activity are fed manually or by Quicken), but it stays as a working PocketSmith-CSV escape hatch. **Do not delete it or `/api/v2/ingest-ps`.**

6. **Calibration pages STAY under Transactions — the CR's own proposal was wrong.** "Move calibration under Settings" assumed they were configuration. They are not: *"calibrate non-fed account balances by entering the current balance by hand"* is **recurring work**, and Settings is where things go to be configured once and forgotten. Burying a recurring job there to satisfy the ≤8 nav target would optimise the count and degrade the app — the target exists to reduce **noise**, not to hide **work**. What *was* misfiled: **Bank Feed Setup** (a page literally named Setup, sitting in the daily Transactions list) and **Forecast Settings** — both moved to Settings.

7. **Forecast sidebar mirrors the stepper; it is not collapsed.** The CR proposed collapsing the six Forecast steps into one sidebar entry, since `FCStepNav` already covers them. Rejected: Forecast is the busiest area of the app, and collapsing turns one click into two on every visit. The real defect was never the redundancy — it was the **inconsistency**: two hand-kept lists of the same six pages, in different orders, with different names (`FC Mapping` in the stepper vs `Income & Expense Mapping` in the sidebar — precisely the developer vocabulary T2 objected to). `FCStepNav` now **derives** its steps from `routes.jsx` (`step` / `stepLabel`), so the two lists cannot diverge again, and the sidebar renders the same step numbers. The number lives in a dedicated `step` field, not in `label` — `label` also feeds breadcrumbs and ⌘K, where a step number is noise.

8. **Creating a module no longer writes before you say so.** v3.0.97 made "New" POST-then-open-the-editor, which left a blank nameless module behind on Cancel — a real row the engine iterates over. Now "New" opens the editor on an unsaved **draft** and the POST fires on Save. The alternative (delete-on-cancel-if-untouched) was rejected: it gates a **destructive** action on a pristine-check that rots the first time a field is added to the editor and left out of the check.

## Out of scope

Guided onboarding/tour (CR027D), auth-related UI (v4), mobile route parity (T8 verdict: keep the shell minimal), any backend change (CR043 owns those).

**Progress (2026-07-13, Opus — overnight run).**
- **U4 COMPLETE (v3.0.95).** FCModulesEdit (~1.5k lines) + FCExpModal (~860) migrated onto `<Modal bare>`; FCModulesEdit's nested audit modal moved out of the overlay to a fragment sibling so it still renders above the editor. Both use `closeOnOutside={false}` (a stray backdrop click must not discard a half-typed module) and `dismissable={!editSaving}`. Adoption baseline 15 → 14 — the remainder is Budget/Transaction/COA, for a later pass.
- **Quick wins (v3.0.95).** *Outfit self-hosted* — it was a Google-CDN request on every load (privacy), gave no font at all offline in the PWA, and caused a FOUT; Outfit v15 is a **variable** font, so all five weights come from two files (~47KB), now preloaded and SW-precached. *Four block-level `<p>Loading...</p>` → `<LoadingSpinner>`* (the rest of the "Loading..." strings are inline control labels — "Loading…" vs "Generate" — where a spinner would be wrong). *Stale "prod-dormant" comments* corrected (the sidebar shipped in v3.0.0).
- **T1 was never actually closed.** The dead-token finding was fixed in KpiCards and marked done — but **63 references across 30 files** pointed at tokens that were never defined (`--text-secondary`, `--ink-muted`, `--surface-hover`, `--warn`, `--ok`, `--font-heading`, …). A `color: var(--text-secondary)` lints clean, looks deliberate, and silently does nothing: it falls back to the inherited value, so the styling quietly ignores the theme — dark mode included. Several carried a hardcoded fallback (`var(--warn, #f59e0b)`), which is worse: right in light, frozen forever. All 63 remapped onto real tokens; `--font-heading` is now actually *defined*. New **blocking** guard `check-dead-tokens.sh` (`npm run lint:tokens`) — **no baseline; the bar is zero**, because there is no such thing as an acceptable dangling token.
- **Hex pass finished (v3.0.95).** FCAIReviewDrawer's AI action blocks (applied/not-applied) and selected-row highlight tokenized; `background:"white"` → `var(--surface)` (it stayed white in dark mode); naked border composites (`"1px solid #E8E6DF"` ×19, etc.) → `var(--border)`. **The guard was the real fix**: `check-inline-hex.sh` only ever matched the pure `prop: "#hex"` form, so every composite sailed past it. Widened to count *any* literal hex that is not a `var(--token, #hex)` fallback — revealing the true number: **170 across 22 files, not 66**. Re-baselined at 170 (frozen, may only shrink). The bulk is FCReview's print exporter (69 — documented light-mode-only) and the chart palettes (already theme correctly), left baselined rather than blindly rewritten: picking a token for each is a visual judgment, not a mechanical swap.
