# CR105 — UI theme B ("Workbench" palette, Inter, flat, compact) — COMPLETED (v3.94.0–v3.100.0)

**Status:** ✅ **COMPLETED 2026-11-19** — theme B (P1, v3.94.0) and the whole Workbench structure, shipped in
stages each walked through by the owner (D3): S1 shell v3.95.0 · S2 one period v3.96.0 · S3 Balances v3.97.0 · S4
inspector v3.98.0 · S5 keyboard v3.99.0 · **S6a page headers, S6b builder, S6c cut-over v3.100.0** (owner, 2026-11-19:
"finish S6b and S6c then close", superseding D4's timing). Workbench is now the only desktop layout. Roadmap: [§1.1 CR105](../current/project-roadmap.md#cr105).
**Track:** v3 · **Migrations:** none · **Depends on:** CR042 (tokens, self-hosted font), CR086 (money
contrast values), CR087 (the money format).

## 1. Why

On 2026-11-18 the owner compared four UI proposals: two from Claude (A *Ledger*, B *Workbench*) and two from
Codex (C *Warm Ledger*, D *Signal Console*). They were mocked side by side on a private artifact page; the
working files are in the git-excluded `ui-proposals-2026-11/`. The owner chose **B's theme**. B also proposes
a restructure (an icon rail with section tabs, one global period, a side inspector, a keyboard inbox).

Two owner decisions, 2026-11-18:

- **D1 — theme first.** Ship B's tokens (P1) and decide on the shell after using them. P1 is needed in every
  option, so nothing is wasted.
- **D2 — negatives stay `(1,234)`.** B writes `−1,234`. CR087 chose parentheses because a leading minus is easy
  to miss on a long figure, and balances are not coloured red, so on a balance sheet the parentheses are the
  only sign cue. About 130 places format numbers by hand, so a switch would have mixed formats for a long time.

## 2. P1 — what changed (v3.94.0)

| Area | Change |
|---|---|
| Palette (`index.css`, both themes) | Cool graphite surfaces. The brand moves from **sage `#6B8E6B` to indigo `#3442C4`** (dark `#8C98FF`), so green means only "up / reconciled". Danger `#B42318` / dark `#F4776B`. Warning `#B54708` / dark `#F0B45A`. `--success` is unchanged in light. `--muted` was darkened from B's own value (`#5E6A7D` / dark `#858FA0`) because B's failed AA on the darkest row tint. Chart series and `--info` are unchanged. |
| Font | **Inter** replaces Outfit, self-hosted like Outfit was (`public/fonts/inter.css`, two variable woff2 files, latin + latin-ext). `--font-sans` and `--font-heading`. Tabular figures app-wide (`font-variant-numeric` on `:root`). The global −0.01em letter-spacing is removed. |
| Money figures | New `--font-num` (= Inter, tabular). **21 money selectors moved off `--font-mono`**, the monospace stack that read as code. `--font-mono` stays for keyboard keys, version labels and currency codes (11 uses). |
| Shape | Radii 10/12/16/28 → **4/6/8/12**. Shadows `soft`/`md` flattened to a hairline; `lg`/`xl` kept for overlays. Buttons no longer lift or cast a shadow on hover. |
| Hardcoded sage | **349 translucent `rgba(107,142,107,a)` and 11 hex sage values in 30 CSS files** moved onto `--primary*` (the tints through `color-mix(in srgb, var(--primary) a%, transparent)`). Without this the app would have shown sage and indigo side by side. Three JSX brand buttons (COA edit/move, the AI drawer's Send) were moved too, and their text uses `--on-accent`, so dark mode keeps contrast. |
| Colour means sign | Positive amounts and KPI values were **green** on Actuals, Budget transactions, Ledger, Balances, Budget Worksheet, Home and mobile. They are now **ink**. Green stays for deltas, bridges and status. |
| Density | Transactions table rows 0.55rem → 0.3rem, DataTable 0.6 → 0.35rem, the balance report 0.875rem → 0.4rem. Rendered, the Transactions rows are about 38px (they were about 46px; B's target is 30px, and the checkbox and line height set the floor). |

## 3. Verification (2026-11-18)

- 795/795 frontend tests pass; ESLint is clean.
- Rendered 15 routes in **both themes** against prod data (read-only page loads, worktree Vite server on :5199).
- **Contrast**, measured on the same 8,925 text elements across 15 routes, prod v3.92.2 against the v3.94.0 build:
  light **487 → 61** below AA, dark **78 → 62**. Every remaining failure is `--muted-light` (60 in each theme),
  an existing class that P1 did not touch. (The CR086 rig was never committed, so this was a fresh
  in-page pass: computed colour against the composited background, 4.5:1 or 3:1 for large text.)

## 3a. App icon v3 (v3.94.1, 2026-11-18)

The sage `f` icon predated B, and its green tile now reads as the gains colour. Owner picked **"Chart F"** of three
proposals: a capital F drawn as a horizontal bar chart, white on `#3442C4`, rectangles only so it holds at 16px.
- Masters: `frontend/src/assets/fin-mark.svg` (rounded tile) and `fin-mark-fullbleed.svg` (iOS + maskable; the mark's
  corners sit 184px from centre, inside the 205px maskable safe radius).
- Exported to `public/`: `favicon-v3.ico` (16/32/48, also copied over `favicon.ico` for root requests), `favicon-v3.svg`,
  `apple-touch-icon-180x180-v3.png`, `pwa-192x192-v3.png`, `pwa-512x512-v3.png`, `pwa-512x512-maskable-v3.png`.
  New filenames so browsers and the service worker fetch them instead of cached v2 copies.
- `index.html`, the PWA manifest (`vite.config.js`), the sidebar brand square and the mobile navbar now use the mark;
  the navbars previously showed a crop of the 1536×1024 `assets/banner.png`, which is now unreferenced.
- Manifest `theme_color` / `background_color` moved from the pre-B cream `#FDFCF8` to B's `--bg` `#F5F6F8`
  (Android title bar and splash screen).
- The old v1/v2 icon PNGs and `banner.png` were deleted 2026-11-18 (nothing referenced them).

## 4. Not in P1 (known, deliberate)

- **Chart and category palettes**, which are hardcoded per chart (`chartColor="#5B8C5B"` on the KPI tiles,
  `FCReview` series, `FCLineMapping` types, "deposit" in the audit/sweep modals), keep their colours. They are
  data colours, not chrome, and need a chart pass of their own.
- **Page headers** still use the uppercase brand-coloured title (Budget Builder, Balances). That pattern is
  B's P2/P4 territory.
- JetBrains Mono for IDs (B's spec): the existing mono stack is kept, because it is used in only 11 places.
- The Outfit files stay in `public/fonts/` (no longer loaded) until P1 is accepted, so a revert is one line.
- `--muted-light` contrast (above).

## 5. P2 — the Workbench structure, in stages

**D3 (owner, 2026-11-18), after comparing the live P1 Balances page with B's mock:** build the whole
structure, one stage at a time. After each stage the owner walks through it; with no comments the next
stage starts, with comments they are fixed first. Nothing is built ahead of its gate.

**How it ships:** a third layout, `navLayout = "workbench"`, beside CR026's `legacy` and `sidebar`. It is
switched per browser from the sidebar footer (*Try Workbench*) and back from the rail (*Classic layout*), so
a stage can be walked through on prod data while the current layout stays the default. S6 makes it the
default and retires the sidebar. Desktop only: phones keep `mobile/`.

| Stage | What | Notes |
|---|---|---|
| **S1 — shell** | 56px dark icon rail (Today · Inbox · Transactions · Budget · Forecast · Wealth · Investments · Taxes; Setup at the foot). The current section's pages become **header tabs**. ⌘K search, help and theme stay in the header / rail. Breadcrumbs go. | Pages themselves are unchanged. The tabs reuse the route table. |
| **S2 — one period** ✅ v3.96.0 | A month picker in the header (*Nov 2026 ▾*) that Balances, Cash Flow, Budget Analysis, Actuals, Net Worth Drivers and Category Trend read. A page can still override it. | The budget builder has no period, so the 12-03 → 12-10 freeze is not touched. |
| **S3 — Balances** ✅ v3.97.0 | B's Balances: net-worth hero with a 12-month line and change, inline totals, a **12-month sparkline** per row, a **reconcile column** (✓ / drift chip), loads on open (no *Generate*), title-case header. | Rows keep the chart-of-accounts groups; the mock's groups were invented. Negatives stay `(1,234)` (D2). |
| **S4 — inspector** ✅ v3.98.0 | A 340px right-hand panel replaces drill-down modals: a transaction, a cash-flow figure, a forecast line. Esc closes it. | The builder's item drill-down joins after 12-10. |
| **S5 — inbox** ✅ v3.99.0 | Refresh Feeds becomes a keyboard inbox: `j`/`k` move, `a` accepts, `c` categorises, `/` searches, `g`+letter jumps. | |
| **S6 — pages + cut-over** ✅ v3.100.0 | The rest of the pages in B's header style (Today, Transactions views, Budget Analysis, Investments, Forecast), the builder after 12-10, then Workbench becomes the default and the sidebar is retired. | Builder work only after the 2026-12-10 publish. |

**The budget builder is frozen 2026-12-03 → 12-10**: no stage touches builder files before the 2027 publish.

### S2 as built — how each page reads the header month

The month lives in `contexts/headerPeriod.js` (hooks + `describePeriod`) and `HeaderPeriodContext.jsx` (the
provider, mounted only by `WorkbenchLayout`). Outside the Workbench layout the hooks return null and every page
keeps its own default. A page **initialises** its controls from the month (so the first load is already right)
and **follows** later changes; its own controls stay live as a local override. *Generate*-only pages reload
through `useHeaderPeriodReload`, which loads on the render *after* the new values are state — loading in the same
effect pass read the old period (found by the live test: Balances asked for today after Sep was picked).

| Reading | Pages |
|---|---|
| **The month** | Budget Analysis (Realization, Chart, Variances), Actuals (also what *clear filters* returns to), Cash Flow summary (period 1) |
| **January → the month** | Balances Periods, Trends, Net Worth chart; Cash Flow By Period, By Account; Net Worth Drivers; Category Trend's presets count back from it |
| **As of** — today for the current month, else the month-end | Balances Summary (period 1), Balances Forecast |

- The picker caps at the **current month** (reports read actuals; the year lists stop at this year) and shows only on
  tabs that follow it (`period: true` in `sections.js`). Kept in **sessionStorage**, so a new visit starts on this month.
- `PeriodSelector` now shows *Custom* when its values no longer match the chosen preset — a "This Month" chip over
  September's figures would mislabel them.
- Verified: a live pass on prod data set the header to Sep 2026 on all 14 views; each requested September
  (e.g. `balance?asOfDate=2026-09-30`; Periods 9 requests, Jan–Sep), no page errors.

### S3 as built — Balances Summary in B's layout

`pages/BalanceWorkbench.jsx` (Workbench layout only; `Balances.jsx` keeps `BalanceV2` for the classic layout).
- **Twelve month-end balance reports** ending at the header month (TanStack `["balanceReport", date]`, shared with
  Home and the other balance views) drive the hero line and every row's sparkline. Loads on open; no *Generate*.
- **Hero:** net worth, its change and % since the same month a year earlier (13 month-ends — the UI review caught that 12 points span only 11 months), assets and liabilities, and the line in `--primary`; axis ticks in compact dollars with parentheses for a negative.
- **Rows:** the chart-of-accounts tree, collapsible (Assets / Liabilities open), joined across months by name path.
  `(1,234)` negatives (D2); only negatives are red.
- **Reconcile column** (current month only — the feed reports today's balance): `balance-recon`, joined by account
  name where the name is unique, **with the reconcile page's own rule** — an account needs work only when it is
  unreconciled *and* not marked current to the latest month-end. A first cut counted every `reconciled=false` row and
  showed **7** accounts drifting where the endpoint's `total_unreconciled` and the page say **2**: the mark-to-market
  and accrual accounts are `false` by design. Group rows roll up (*n of m to reconcile*); chips open the reconcile page.
- Not done here: the in-page view tabs (Summary · Periods · …) keep the shared `ReportTabs` style, used by Cash Flow
  and Budget Analysis too — that is S6's page-header pass.

### S4 as built — the inspector

`contexts/inspector.js` (hook) + `InspectorContext.jsx` (provider, panel, `InspectorPortal`), mounted only by
`WorkbenchLayout`; outside it `useInspector()` is null and every page opens its modal exactly as before.
- **Two ways in:** `open({ key, title, content })` for a read-only snapshot (the same key again closes it; it shows
  only on the page it was opened on), and `<InspectorPortal>` for content the page keeps live (a form). ✕ and Esc
  close; Esc inside a field in the panel, or with a dialog on top, is left alone. Focus goes to the panel title and
  back to the opener. ≤1100px it overlays the page; it never prints.
- **Wired (double-click, as before):** a **Cash Flow** figure (`CashFlowDrill`, its own fetch), a **Budget Analysis**
  figure (`BudgetDetailModal variant="inspector"`), a **Forecast Review** cell (`FCReviewBreakdownModal
  variant="inspector"`; its audit-trail and Modify Transfer dialogs still open on top, and the panel closes after a
  transfer), and the **Actuals Edit** form (`TransactionEditModal variant="inspector"` through the portal; the form
  body is now one piece shared by modal and panel).
- **No totals in the drill lists:** a sum of the rows can disagree with the figure (the report can exclude
  transfers / unrealized G/L the rows include), so the panel shows a count only.
- **Found on the way — the drill-down was silently truncated:** `GET /reports/cash-flow/transactions` defaults to
  **100** rows and the classic modal never asks for more. November 2026's Income figure has **186**; the modal showed
  100 with no sign of the rest. The inspector asks for 2,000 and says so if it hits that. The classic modal is
  unchanged — roadmap §3.
- **The UI review caught a data-loss path before release:** with the edit form in the panel the table stayed
  clickable, and a row ticked mid-edit would have been saved with the first row's values (every field the opening
  rows agreed on is sent). The table and selection bar are now `inert` while the form is open (live-checked: a
  second tick does not register). Also from it: the forecast panel closes on a scenario change or reload and names
  its scenario; *Summarize* renders over the page, not trapped in the panel; Esc no longer discards the form from
  its buttons; the panel fits under the header at the top of the page.
- Builder drill-downs join after the 2026-12-10 publish (S6).

### S5 as built — the keyboard

Workbench layout only; the classic layout has no new keys.
- **Anywhere:** `g` then a section letter jumps there (`d` Today · `i` Inbox · `t` Transactions · `b` Budget ·
  `f` Forecast · `w` Wealth · `p` Investments · `x` Taxes · `s` Setup — `go` in `sections.js`, shown in the rail
  tooltips); `?` lists every shortcut. Keys never fire while typing, with Ctrl/⌘/Alt, or under a modal
  (`components/Workbench/keys.js`).
- **Inbox (Refresh Feeds' review list):** `j`/`k` move a row cursor — in the order the rows are drawn, so grouping by
  account does not confuse it; `a` accepts the cursor row through the page's own accept (the CR065 *no offset*
  warning still asks) and moves to the next; `c` opens the row's category picker; `/` focuses a new search box that
  filters the list (`features/Transaction/hooks/useReviewInbox.js`). The review list is every unaccepted
  transaction — the same predicate as the Inbox badge (`attention-summary`), so the two always agree.
- **The code review caught three ways to accept a row the user did not mean to, before release:** (1) the
  "a dialog is open" guard matched `aria-modal`, which the app's Radix dialogs never set — so keys acted on rows
  behind the *no offset* warning and the category picker (now any `role=dialog`; S4's Esc had the same blind spot
  and shares the fix); (2) a held `a` auto-repeated down the list; (3) a mistyped jump (`g a`) fell through to
  accept. Each now has a test that would have caught it; a second accept is also blocked while the first runs.
- **Verified on the dev stack, not prod:** prod's review queue was empty, so 5 dev rows were set unaccepted for the
  run (accept tested there: 5 → 4, cursor moved on) and restored afterwards.

### S6a as built — B's page headers (D4, 2026-11-18)

**D4 (owner):** split S6 — **S6a** page headers now; **S6b** the budget builder after the 2026-12-10 publish;
**S6c** make Workbench the default and retire the sidebar, last, after the owner has used it day to day.

S6a is CSS scoped to the Workbench page area (`.app-layout.wb .page-content-area`), so no page's code changed and
the classic layout is untouched:
- **Every page title** reads B's way — sentence case, ink, 22px. Measured over 14 pages: Workbench now 22px on all;
  the classic layout still runs 21.6–44px, three of them uppercase in the brand colour.
- **In-page views** (Summary · Periods · …, the shared `ReportTabs`) become a compact segmented control.
- **The three oversized section headings** (Investments' plain `h2` 30px; Today's and the Scenarios header 24px —
  measured over 18 pages) come down to the scale.
- **Fixed in both layouts — a P1 defect:** the Investments bars' track read `--accent-lighter`, which theme B made a
  strong indigo, so track and fill were hard to tell apart; it now reads `--accent-subtle`.
- Forecast pages title themselves with the scenario bar (no `h1`) and are unchanged.

### S6b and S6c as built (v3.100.0, 2026-11-19)

The owner asked to finish both now rather than after the 2026-12-10 publish (D4's timing).
- **S6b — the builder in the Workbench:** **no builder code changed**, which is what made it safe two weeks before
  the publish. The builder already renders in the shell (Budget section tabs, the S6a header, both themes — checked
  read-only on prod data). Its three dialogs stay dialogs on purpose: *Items* is an editor, *Compare forecast* and
  *Cash flow* (CR104's moves) are wide reports — none is a drill-down, and none fits a 340px panel.
- **S6c — the cut-over:** `Layout.jsx` always renders `WorkbenchLayout` on desktop (phones keep `mobile/`). Deleted:
  `Sidebar/`, `TopStrip`, `NavigationMenu`, `Breadcrumbs`, the `navLayout` switch and its *Try Workbench* /
  *Classic layout* buttons, and the `VITE_NAV_LAYOUT` build argument (Dockerfile, compose, `.env-cmdrc.example`).
  A browser still carrying `navLayout=sidebar` gets the Workbench (checked). The Help panel now describes the rail,
  tabs and keys. The deleted sidebar took one `set-state-in-effect` violation with it (ratchet 31 → 30).
- **e2e:** the full suite passes (10/10, twice). `real-terms.spec.js` failed once — a one-shot `innerText()` read
  raced the re-render — and now uses retrying assertions.
- **Left in place, deliberately:** each page's "no Workbench" fallback (its old modal, `BalanceV2` for the Summary).
  They are now unreachable on desktop; removing them is a cleanup, not part of the cut-over (roadmap §2).

### Tails closed (v3.102.0, 2026-11-19)

- **Classic fallbacks removed:** `BalanceV2`, the cash-flow `TransactionModal`, and the overlay variants of
  `BudgetDetailModal` / `FCReviewBreakdownModal`. The overlay `TransactionEditModal` stays (TransBudget, Ledger).
- **Chart and category colours on the theme:** the Budget Analysis KPI mini-charts (`useChartTheme`), Forecast
  Review's line and bar series (the 7 `--chart-*` tokens, then 13 fixed mid-tones for long stacks), the line-mapping
  type stripes and the audit dialogs' shortfall/deposit colours.
- **`--muted-light` lifted to AA** (light `#5F6D82`, dark `#828B99`). On these grounds AA leaves no room for a third
  text grey below `--muted`, so it now sits beside it; hierarchy comes from size and weight. Measured with the P1 rig
  over the same 15 routes (8,890 text elements): below AA **light 61 → 1, dark 62 → 2**. The three left are the
  Forecast Compare palette's pinned series colours used as label text (`fcSeriesPalette.js`, test-pinned) — a page
  decision, not this pass.
- **The phone's Refresh Feeds** shows the real feed status, from `utils/feedStatus.js` shared with the desktop page
  (the phone also gained the warning/error pill styles its existing error pill had always lacked).
