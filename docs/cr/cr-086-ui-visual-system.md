# CR086 — The visual system: four token values, three primitives, and a renderer that runs

**Status:** **OPEN** — designed, nothing built.
**Track:** v3 · **no schema change, no migration.**
**Depends on:** [CR085](cr-085-forecast-sensitivity.md) (added `--primary-strong`) · [CR042](cr-042-ui-look-and-feel.md) (tokens/primitives) · [CR026](cr-026-ui-revamp.md) §14 (the gate it recommended and never shipped).
**Roadmap anchor:** [project-roadmap.md#cr086](../current/project-roadmap.md)
**Origin:** A three-part review run 2026-08-15 and refreshed 2026-08-23: `ui-design-reviewer` (static,
whole-app), `financial_software_expert` (domain, whole-app — carved out to
[CR087](cr-087-money-legibility.md)), then a **live headless-Chromium pass over every route in both
themes**, which is what this CR is actually built on. The two static passes proposed a large
remediation campaign. The render pass cut it to a much smaller one and falsified four of its claims.

---

## 1. The one-sentence shape

> **Six token values are 92% of every contrast failure in the app — and 45% of those are the two
> money colours; three missing primitives make every new page diverge; and nothing in CI has ever
> looked at a rendered pixel.** Fix the tokens, add the
> primitives, and commit the renderer that found this.

## 2. Why now, and why it is smaller than it looks

[CR026](cr-026-ui-revamp.md) built the sidebar/dark/⌘K shell. [CR042](cr-042-ui-look-and-feel.md)
built the token layer. Both are COMPLETED and both **worked** — the problem is not that they were
wrong, it is that only one of the scales they defined was ever adopted, and nothing measures the
other three.

Measured with identical commands against both trees, eight days apart:

| | v3.28.3 (2026-08-15) | v3.37.1 (2026-08-23) | Δ |
|---|---:|---:|---:|
| CSS files | 92 | 98 | +6 |
| **CSS lines** | 27,718 | **29,879** | **+2,161** |
| `rgba(` literals | 877 | **877** | **0** |
| hex in `.css` | 257 | 259 | +2 |
| hex in `.jsx` | 179 | **179** | **0** |
| `font-size` declarations | 966 | **1,059** | **+93** |
| …using `var(--text*)` | 13 | **13** | **0** |

**This table is the whole argument.** Over 2,161 new lines of CSS — six new stylesheets across four
new routes (`/forecast-sensitivity`, `/budget-le`, `/tax/fbar`, `/tax/foreign-accounts`) — the colour
convention held **perfectly**: zero new `rgba()`, zero new hex in JSX. The type scale absorbed **93
new declarations at zero adoption**, so adoption *fell*, 1.35% → **1.23%**.

Colour held because `Scripts/check-inline-hex.sh` exists and ratchets. Type did not because nothing
measures it. That is the entire difference, and it is the reason Phase 0 is a guard and not a sweep.

⚠️ **The corollary matters more than the finding:** every new page makes the eventual type sweep
bigger, and Fin is currently adding pages faster than it is adopting scales. `FCSensitivity.css` is
671 lines with 111 `var(--)`, **0 rgba, 0 hex — and 34 hardcoded font sizes.**

## 3. Six token values, measured

Not estimated. Computed from the rendered DOM across 37 routes, then re-derived arithmetically for
each candidate replacement.

⚠️ **Pass 1 falsified this table twice (§12 C2, C3) and the version below is the corrected one.** The
draft named four tokens, missed the app's **second-largest** failing colour, and repointed a token the
money path does not read. Ratios are per-surface, because two of them pass on white and fail on the
surfaces they are actually used on.

| Token | Value | Where it lands | white | cream | surf-muted | primary-subtle |
|---|---|---|---:|---:|---:|---:|
| `--muted-light` | `#A0AEB9` | footer tagline **+ `DataTable` data cells** | **2.27** | **2.21** | **2.16** | **1.95** |
| `--primary` | `#6B8E6B` | breadcrumbs, tabs, chips, **white-on-filled buttons** | **3.68** | **3.58** | **3.49** | **3.17** |
| `--growth-positive` **=** `--success` | `#1A9E74` | **every positive money figure** | **3.39** | **3.31** | **3.22** | **2.92** |
| `--growth-negative` **=** `--danger` | `#C0504D` | **every negative money figure** | 4.67 | 4.55 | **4.43** | **4.02** |
| `--primary-hover` | `#5A7D5A` | `sidebar__label` (28 routes) | 4.65 | 4.53 | 4.41 | **4.00** |
| `--muted` | `#6C7782` | body/secondary text | 4.57 | **4.45** | **4.33** | **3.93** |

⚠️ **C3 — the money path does not read `--success`.** [index.css:73-74](frontend/src/index.css#L73-L74)
declares `--growth-positive: #1A9E74` and `--growth-negative: #C0504D` as **separate declarations** from
`--success` (`:37`) and `--danger` (`:49`), and
[LEGrid.css:197-198](frontend/src/features/BudgetLE/LEGrid.css#L197-L198) reads the `--growth-*` pair.
**Repointing `--success` alone would have left every money figure in the app unchanged.**

⚠️ **C2 — `--growth-negative` was missed entirely, and §9 told you to globalise it.** It is every
negative money figure, and §9's "Diverging pair" row proposes lifting `FCCompare.css`'s
`--fc-cmp-neg` — which **is** `#C0504D` — into `index.css` as a global token.

The fix needs almost no invention, because **`--primary-strong: #537453` already exists** —
[CR085](cr-085-forecast-sensitivity.md) added it for the focus ring (§4) and it is already proven
app-wide:

| Repoint | Before (worst surface) | After (worst surface) |
|---|---:|---:|
| `--primary` → `--primary-strong` `#537453`, text + filled-button bg | 3.17 | **4.53** |
| white on `--primary` → white on `--primary-strong` | 3.68 | **5.26** |
| **`--growth-positive` + `--success`** `#1A9E74` → `#0F7A57` | 2.92 | **4.58** |
| **`--growth-negative` + `--danger`** `#C0504D` → **`--danger-strong` `#A43F3C` (EXISTS, `index.css:50`)** | 4.02 | **5.39** |
| `--primary-hover` `#5A7D5A` → `--primary-strong` | 4.00 | **4.53** |
| `--muted` `#6C7782` → `#5B6672` | 3.93 | **5.04** |
| `--muted-light` `#A0AEB9` | 1.95 | **restrict to borders/dividers — it carries text at no surface** |

⚠️ **The margins on `--primary-subtle` (the sidebar tint) are thin — 4.53 and 4.58.** Validate the
repoint **per surface**, not on white, or the sweep will pass its own guard and still fail on the
sidebar. And `--growth-*` are aliased by `--chart-*`, which `chartTheme.jsx` resolves into Recharts
`fill`/`stroke`: **repointing them changes series colours, and no chart assertion exists.**

**Reach — re-derived from uncapped data (§12 C1).** Across 37 routes there are **2,364** light-mode
contrast failures and only **12 distinct failing colours**. Six tokens are **92.3%** of them:

| Rank | Token | Failures | Share | Routes |
|---:|---|---:|---:|---:|
| 1 | `--growth-positive` / `--success` `#1A9E74` | **649** | 27.5% | 10 |
| 2 | `--muted` `#6C7782` | **636** | 26.9% | **37** |
| 3 | `--growth-negative` / `--danger` `#C0504D` | **407** | 17.2% | 5 |
| 4 | `--primary` `#6B8E6B` | 248 | 10.5% | 36 |
| 5 | `--muted-light` `#A0AEB9` | 130 | 5.5% | **37** |
| 6 | white on a filled `--primary` button | 111 | 4.7% | 27 |

⚠️ **The two money colours alone are 1,056 failures — 44.7% of every contrast failure in the app.**
That is the single strongest argument in this CR and the draft did not contain it: the app's contrast
problem *is* a money-legibility problem, which is why §3 and [CR087](cr-087-money-legibility.md) §2
should land together.

Dark is a different and much smaller shape: **146** failures total, 53% of them the one footer tagline.

⚠️ **The money pair is what is still spreading.** `/budget-le`, shipped 2026-08-18, carries **183**
failures of which **154 (84%) are the two money colours** — 107 `--growth-negative`, 47
`--growth-positive`, on `span.le-grid__money--neg` / `--fav`. A brand-new page shipping both signs of
money below AA, eight days after the defect was measured.

⚠️ **The draft's flagship example was wrong (§12 C1).** It claimed *"`fc-review`'s 594 failures are one
cluster — `--muted-light` at 2.27:1."* Uncapped: `fc-review` has **12** distinct failing colours;
`--muted-light` is **40 of 594 (6.7%), rank 4**. The real leader is `--growth-negative` at **294
(49.5%)**, with `--growth-positive` second at 205 (34.5%) — **84% of that page is money too.**

## 4. What the render pass falsified

Recorded rather than quietly dropped, because three of the four came from *this* review's own earlier
passes and one came from a completed CR.

1. **"Dark mode is broadly broken."** It is not. **32 of 37 routes render zero light-surface leaks.**
   The dark defects are three classes, not a sprawl — and the largest is **three CSS declarations**
   ([FCModulesTable.css:257](frontend/src/features/Forecast/FCModulesTable.css#L257),
   [PageLayout.css:1105](frontend/src/pages/PageLayout.css#L1105) and
   [:2614](frontend/src/pages/PageLayout.css#L2614)), all the same value
   `rgba(248, 250, 254, 0.35)`.
2. **"698 colour-bearing rgba literals."** That was one reviewer's filtered count, quoted onward as
   if comparable. Measured consistently it is **877, and it was 877 eight days earlier too** — the
   metric has never moved. A number is not a baseline until the command that produced it is recorded.
3. **"Five money tables lack tabular figures."** At render time, **two** tables miss it, both with
   1–2 money cells. `.balance-report-table__value` covers the rest.
   [PageLayout.css:4234](frontend/src/pages/PageLayout.css#L4234)'s dead
   `tabular-nums: tabular-nums;` is real — ⚠️ **and costs more than the draft said (§12 C11):** it sits on
   **`.data-table__number`**, the `<DataTable>` primitive's numeric cell, so every table migrated in
   Phase 3's "wave 2" inherits a numeric column with no tabular figures. One-word fix:
   `font-variant-numeric: tabular-nums`.
4. **`frontend/dark-audit.mjs` does not exist.** [CR026 §14](cr-026-ui-revamp.md) describes the rig
   and its own line records it as *"Throwaway verification rig … **Not yet committed.**"* It then
   recommends *"a lint for `rgba(2\d\d,…)` light fills … or wire `dark-audit.mjs` into CI"* — which
   never happened, which is why (1) went unmeasured for two months.

**And one claim the render pass confirmed rather than killed:** [CR082](cr-082-tax-section-fbar-114.md)'s
index row carries ⚠️ *"Nothing has been rendered in a browser — no renderer on this host."* There
**is** a working renderer on this host: `@playwright/test@1.61.1` with four Chromium builds in
`~/.cache/ms-playwright/`, already used by `frontend/e2e/*.spec.js` and `Scripts/e2e.sh`. §8 turns it
into a gate.

## 5. The P0s, re-verified 2026-08-23

Every one still open at HEAD, checked by grep and by probe, not assumed:

| Defect | Evidence | Measured |
|---|---|---|
| `ConfirmModal` is 100% naked hex | [ConfirmModal.css](frontend/src/components/ConfirmModal/ConfirmModal.css) — 17 literals, `#2563eb` ×2 | In dark: a **`rgb(255,255,255)` card on a `rgb(19,21,23)` page = 18.30:1**, with a blue primary button that exists nowhere else in Fin **as a button colour** (4 sites total; 2 are URL-encoded in data-URI SVGs, invisible to `check-inline-hex.sh`) |
| `<Modal>` scrim is a light-ink hardcode | [Modal.css:18](frontend/src/components/Modal/Modal.css#L18) `rgba(45, 52, 54, 0.18)` | Composites to `rgb(24,27,29)` over the dark page — **1.06:1 separation. Invisible**, on all **20** consumers |
| `ConfirmModal` z-index | `1000` vs `<Modal>` card `10401` | ⚠️ **Worse than 'behind' (§12 C9):** `frontend/e2e/nested-modal.spec.js` records that an open Radix layer sets `pointer-events: none` on `<body>`, so this non-portalled overlay is **dead to clicks and absent from the a11y tree** |
| `ConfirmModal` has no Esc, no focus trap | [ConfirmModal.jsx:11-46](frontend/src/components/ConfirmModal/ConfirmModal.jsx#L11-L46) — bare `role="dialog"` | It gates **promote / calibrate / delete** |
| Horizontal overflow | `/quicken-import` | **27px, both themes**, visibly clipping the sidebar |
| No `<h1>` | 10 pages incl. `fc-review`, `fc-compare`, `fc-modules`, `quicken-import` | Breadcrumb is the only page identity |

The modal figures come from injecting each component's own markup into a live dark page and reading
computed styles — no clicks, so nothing could fire a write against prod.

## 6. The primitives, and the proof they are needed

**`<PageHeader>` is not a tidiness item — it is actively diverging.** There were five rival page-title
treatments on 2026-08-15. There are **six** now, and the two newest pages *each picked a different
one*: `/forecast-sensitivity` renders a large sentence-case `<h1>`; `/budget-le` renders the 1.35rem
UPPERCASE green `report-toolbar-header__title`. Two pages, same fortnight, same convention-less path.

The clearest single instance is still inside one report: `/balances` renders 1.625rem ink left-aligned
([BalanceV2.jsx:211](frontend/src/pages/BalanceV2.jsx#L211)), then 1.35rem UPPERCASE green
([BalanceSheetPeriods.jsx:201](frontend/src/pages/BalanceSheetPeriods.jsx#L201)), then **no `<h1>` at
all** on the chart tab — switching tabs inside one report changes the header's size, colour, case and
alignment, then makes it vanish.

Also needed, in order of evidence:

- **`<Money>`** — 13 hand-rolled `formatCurrency*` and 41 `Intl.NumberFormat` instantiations across
  32 files, **22 of which use the browser's locale** (`toLocaleString(undefined, …)`). On a `pl-PL`
  browser the same app renders `1.234,56` on the reconcile table and `$1,234.56` on the balance
  sheet. This one is shared with [CR087](cr-087-money-legibility.md) §2 and should be built once.
- **`<FilterPanel>`** — `.balance-panel` is defined in **three** files with materially different
  visuals (flat surface vs a gradient with an `rgba(255,255,255,.5)` inset), six components consume
  it, and **which look you get depends on lazy-chunk load order.** Plus six rival date-range
  selectors totalling 1,398 lines against a shared `PeriodSelector` with 16 consumers.

## 7. Phases

**Phase 0 — measure, so Phase 1 cannot regress.** (S)

⚠️ **Pass 1 could not reproduce ANY of the three drafted baselines (§12 C7).** A shrink-only guard
baselined below the true count **fails on its own first CI run and blocks every commit** until someone
deletes code to meet it. So Phase 0's first task is to re-measure each one **and record the literal
command beside the number** — which is §4.2's own rule, stated in this CR and then broken by it.

- `Scripts/check-token-scale-adoption.sh` — per-file count of `font-size` / `padding` / `gap` /
  `font-weight` declarations not using a token, shrink-only. ⚠️ **Baseline TBD**: the draft said 1,046;
  pass 1 measured **1,120** comment-stripped and could not reach 1,046 under eight command variants.
  It must also cover the **217 inline `fontSize` occurrences in `.jsx`**, or it inherits exactly the
  blind spot §7 criticises `check-inline-hex.sh` for. ⚠️ `check-dead-tokens.sh` **cannot** catch any of
  this: a defined-but-unused token passes it, which is how 1.23% adoption went unnoticed for two months.
- `Scripts/check-css-literals.sh` — the CSS-side twin of `check-inline-hex.sh`, which reads only `.jsx`.
  ⚠️ **Baseline TBD**: the naive `grep 'rgba('` **counts comment prose** — the only per-file rgba delta
  between the two trees is the word "rgba()" inside a comment — and comment-stripped hex measures
  **312**, not 259. Re-measure with a comment-stripping command. This one **ratchets a win rather than
  opening a campaign** (§2), and it is the guard [CR026 §14](cr-026-ui-revamp.md) asked for and never got.
- `Scripts/check-duplicate-selectors.sh` — fail on a class defined in >1 CSS file. ⚠️ **Baseline is
  131, not the drafted 95.** Would have caught `.balance-panel` ×3 and `.data-table` ×3.

⚠️ **Wiring, which the draft did not cost.** The existing four guards are npm scripts
(`frontend/package.json`) invoked from `ci.yml`'s blocking "Design-primitive adoption guards" step, each
with a `Scripts/.<name>-baseline.txt`. Three new guards = three scripts, three baseline files, three
`lint:*` entries and a `ci.yml` edit. No conflict with the existing four — the ConfirmModal migration
only *removes* rows from `.modal-adoption-baseline.txt`, which `comm -13` permits.

**Phase 1 — the cheap half. Every item here is S, and together they cover all 37 routes.**

1. **The token repoints** (§3). ⚠️ **Not "one file, five values"** — the real set is `--primary`,
   `--primary-hover`, `--success`, `--growth-positive`, `--growth-negative`, `--danger`, `--muted`,
   `--muted-light`, **plus their dark twins and the `--chart-*` aliases**. Verify per-surface and in
   both themes with the §8 rig, and eyeball the charts.
2. **The three `rgba(248,250,254,.35)` rules** (§4.1). Fixes 324 washed cells on `fc-compare` dark
   plus 27 elsewhere.
3. **`ConfirmModal` → Radix `<Modal>`** + tokens + `.btn`. Removes 17 hex, the rogue blue, the
   z-index inversion and the missing Esc/focus-trap on the destructive gate. Delete
   [QuickenImport.jsx:917](frontend/src/pages/QuickenImport.jsx#L917)'s **second component also named
   `ConfirmModal`**.
4. **The `<Modal>` scrim** — one line, fixes the backdrop for all **20** consumers.
5. **`<h1>` on the 10 pages missing one**; a `404` route (`App.jsx` has no `<Route path="*">`, so an
   unknown URL renders full chrome around a blank page).

**Phase 2 — the type scale.** (M) Cut to **6 steps** from the measured histogram: 36 distinct
rendered sizes, but the top six cover **75%** of 31,809 visible elements (13.12px 22% · 13.33px 21% ·
15.2px 14% · 14.4px 7% · 16px 7% · 13.6px 6%). Adopt in the **six new stylesheets first** — they are
the cleanest and the ones still growing — then the top ten by declaration count.

**Phase 3 — the primitives.** (M/L) `<PageHeader>` → `<Money>` → `<FilterPanel>`, in that order:
§6 shows the header is the one currently costing per-page.

⚠️ **Sequencing against in-flight work (pass 1).** Three collisions the draft did not name:
**CR083 (IN-PROGRESS)** — Phase 2 says "adopt in the six new stylesheets first", two of which
(`LEGrid.css`, `FyLandingStrip.css`) CR083 is still editing; **CR060 (IN-PROGRESS)** — `RefreshFeeds.jsx`
is a ConfirmModal, `<Modal>` **and** `<DataTable>` consumer, and Phase 1.3 rewrites it; and
**[CR087](cr-087-money-legibility.md) §3** owns `/balance-calibration`'s calibrate P0 while Phase 4 owns
its visuals — **CR087 lands first.**

**Phase 4 — the two worst working surfaces.** (M) `/balance-calibration` (see
[CR087](cr-087-money-legibility.md) §3 — the currency column is a money defect, but the clipped
`Reconcile` button, the unstyled native `<select>`s in table cells at two widths, and the 2× row-height
variance are visual) and `/quicken-import` (the 27px overflow, plus it is leaking an absolute
`/tmp/claude-1000/...` scratchpad path into the Source Files column).

**Explicitly NOT a phase: the rgba sweep.** The Aug-15 draft sized it **L** and put it second. §2
shows the convention is self-enforcing and 32/37 routes render clean. It ratchets via Phase 0 and
never becomes a campaign.

## 8. The renderer becomes a gate

`Scripts/check-ui-render.sh` — headless Chromium over every nav-visible route in both themes,
asserting four things a grep cannot see:

1. **No light surface** > 2,500px² in dark (composited, gradient stops sampled individually).
2. **No text below its WCAG threshold**, computed against the *effective* backdrop by walking
   ancestors to the first opaque background — not against the declared one.
3. **`document.scrollWidth === clientWidth`** (this is the only thing that finds `/quicken-import`).
4. **Every route renders exactly one `<h1>`.**

⚠️ **Pass 1 reshaped this section (§12 C5, C6). Two changes, both blocking.**

**C5 — it must not point at prod.** The rig currently targets the running prod frontend, and **prod row
counts cannot be baselined**: `trans-actual` moved 185 → 293 between two runs on data alone, so a
shrink-only gate would ratchet red with no code change. `Scripts/e2e.sh` already builds exactly the
right thing — throwaway Postgres → the full migration chain → `ci-seed.sql` + `e2e-seed.sql` → the real
server → the **built** bundle → Playwright — and **CI already runs it** (`.github/workflows/ci.yml`,
`e2e:` job). This becomes a spec in `frontend/e2e/`, not a new script. ⚠️ Open item: `e2e-seed.sql` is
274 lines built for money paths, so `/quicken-import`, `/bank-feed-diagnostic`, `/tax/fbar` and
`/forecast-sensitivity` will render empty states and assert little — accept that, or add a `ui-seed.sql`.

**C6 — assertion 2 cannot ship yet.** `bd()` never inspects `backgroundImage`, so it walks past
gradient-painted ancestors and **scores white-on-white as 1.00:1** — 76 elements on `/forecast-modules`
alone. Until it samples gradient stops the way `leaks` already does, contrast cannot gate.

**So §8 ships in two steps.** Assertions **1, 3 and 4 are data-independent** and gate now; assertion 2
lands once `bd()` is fixed and the seed question is answered. Runtime ~6 min for 37 routes × 2 themes
here (a GitHub runner is 2–3× slower); it belongs in the `e2e:` job, not the pre-commit path.

⚠️ **This is the item with the longest evidence trail in the CR.** [CR026 §14](cr-026-ui-revamp.md)
recommended it and shipped the rig uncommitted. Two months later its exact defect class was still
live and unmeasured. [CR085](cr-085-forecast-sensitivity.md) then found **eleven defects of one shape
— state that renders and produces no visible effect — ten of them found by a person looking at the
output rather than by a gate**, and recorded that *"the ENGINE half now has a gate and the DISPLAY
half does not."* This is the display half's gate.

## 9. Reference implementations — standardise on these

| Surface | File | Why |
|---|---|---|
| Page CSS | [BudgetWorksheetV2.css](frontend/src/pages/BudgetWorksheetV2.css) | 671 lines, 106 `var(--)`, **0 rgba, 0 hex** |
| **New-page CSS** | [FCSensitivity.css](frontend/src/pages/FCSensitivity.css) | 671 lines, 111 `var(--)`, 0 rgba, 0 hex — the colour convention held under 2,161 new lines |
| Dense table | [TransactionExplorer.css](frontend/src/pages/TransactionExplorer.css) | 143 `var(--)`, 1 rgba, correct sticky header + right-aligned `tabular-nums` |
| Tab shell | [ReportTabs](frontend/src/components/ReportTabs/) | fully tokened, `aria-current="page"`, deep-linkable, unknown-slug canonicalisation |
| Chart theming | [chartTheme.jsx](frontend/src/utils/chartTheme.jsx) | resolves tokens once per theme and hands Recharts concrete hex — the only correct way to colour an SVG here |
| Diverging pair | [FCCompare.css:5-13](frontend/src/pages/FCCompare.css#L5-L13) | the only file defining a custom colour pair **with a `[data-theme="dark"]` twin**. Lift to `index.css` as `--diverging-pos/-neg` |
| **Page design** | `/forecast-sensitivity` | real `<h1>`, an explanatory subtitle, and a **cost preview before you commit** (*"5 bands · 11 builds ≈ 6s"*) |
| **Provenance** | `/budget-le`'s `BASIS` column | `Mixed` / `Budget` / `Typed` / `—` per row — the actuals-side answer to [CR087](cr-087-money-legibility.md) §5 |

## 10. Not in scope

- **Mobile.** `/m/*` was not rendered. Two findings are recorded and deliberately deferred: 41
  desktop CSS files carry `@media (max-width: 640px)` blocks that **can never match** (the shell hands
  off to `/m/*` at exactly 640, `useIsMobile.js:41`), and `AttentionStrip` is desktop-only while a
  read-only chart holds a permanent mobile tab. Both want a decision before a build.
- **Colour-vision deficiency.** [CR026 §15](cr-026-ui-revamp.md) left residual CVD overlap open; not
  re-measured.
- **Print/export surfaces.** `FCReview.jsx`'s exporter is documented light-mode-only and intentionally
  keeps hardcoded hex.
- **The IA consolidation** the domain review proposed (30 nav-visible routes → 12 top-level surfaces).
  It is a real proposal and it is **not** a visual change; it needs its own owner decision.
- **`PageLayout.css`** (4,316 lines / 539 classes) splitting, `<DataTable>` wave 2 (**3** consumers —
  RefreshFeeds plus **both new Tax pages**, so the primitive *is* being adopted by new work — vs **48**
  files with a hand-rolled `<table>`; and **two rival DataTable stylesheets** exist,
  `components/DataTable.css` and `components/DataTable/DataTable.css` — the `.balance-panel` pathology
  inside the CR042 primitive itself), `<FormField>` / `<StatusChip>` / `<ErrorState>`. All L, all real, none blocking
  — they follow Phase 3 or never.

## 11. What has already been fixed, and by whom

**The focus ring — closed by [CR085](cr-085-forecast-sensitivity.md) Tier 2, v3.36.0.**
[index.css:375-405](frontend/src/index.css#L375-L405) now sets an opaque
`2px solid var(--primary-strong)` on `button`, `a`, `[role="button"]`, `summary` and the three input
types. Its comment records the same measurement this review took independently — *"a 15%/25%-alpha
green that composites to **1.18:1** on white and **1.65:1** on the dark surface"* — and its reasoning
is the reason §3 is cheap: *"An opaque outline, not a translucent shadow, because a shadow tinted at
15% cannot reach 3:1 against a light surface whatever hue it uses."* The token it introduced,
`--primary-strong`, is what §3 repoints the rest of the app onto.


---

## 12. Pass 1 technical review — what it falsified (2026-08-23)

Recorded rather than quietly patched. **Verdict: REVISE.** Every finding below was re-verified by this
CR's author before being written down; where the reviewer was itself wrong, that is recorded too.

| # | The draft said | Actually | How |
|---|---|---|---|
| **C1** | §3's clusters, incl. *"fc-review's 594 are ONE cluster, `--muted-light` 2.27:1"* | **The rig was sampling.** `audit.mjs:27` truncated the contrast array to **25 rows per route** while `conN` reported the true count — so every cluster proportion in the draft came from a 25-row sample of pages with up to 594 failures. Uncapped: `--muted-light` is **5.5%** app-wide and **rank 4** on fc-review. §3 re-derived | removed both `.slice()` caps, re-ran; kept **2,510 = conN 2,510** |
| **C2** | four failing tokens | **Six.** `--growth-negative` `#C0504D` (**17.2%**, every negative money figure) and `--primary-hover` (37 routes) were missing. And §9 proposed globalising `--fc-cmp-neg`, which **is** `#C0504D` | uncapped clusters |
| **C3** | repoint `--success` | **The money path reads `--growth-positive`.** `index.css:73-74` declares the `--growth-*` pair separately from `--success`/`--danger`, and `LEGrid.css:197-198` reads it. **Phase 1.1 as drafted would have fixed no money figure.** `--danger-strong` already exists for the other half | `grep`; per-surface arithmetic |
| **C4** | "28 of 37 routes render zero light-surface leaks" | **32 of 37.** Counted from the console instead of the data — in the *falsification* section, and it had propagated to `status.md`, the roadmap and the CR index. **All four corrected** | `audit.json` |
| **C5** | §8: a new `check-ui-render.sh` against prod | **Prod row counts cannot be baselined** (`trans-actual` moved 185→293 on data alone). `Scripts/e2e.sh` already builds a throwaway stack and **CI already runs it**. §8 must be a spec under that job. See C6 | reviewer; `ci.yml` |
| **C6** | §8 asserts contrast in CI | ⚠️ **`bd()` scores white-on-white as 1.00:1.** It never inspects `backgroundImage`, so it skips gradient-painted ancestors — **76 elements on `/forecast-modules`** alone. Assertions 1, 3, 4 are data-independent and can gate now; **assertion 2 must wait** for a backdrop walk that samples gradients | reviewer probe |
| **C7** | §7's three baselines | **None reproduces.** Font-size non-token measures **1,120**, not 1,046; duplicate selectors **131**, not 95. A shrink-only guard baselined low **fails on its own first CI run**. §4.2 of this CR states the rule — *"a number is not a baseline until the command that produced it is recorded"* — and §7 then recorded none | reviewer, 8 command variants |
| **C8** | counts | `<Modal>` **20** consumers not 15 · `DataTable` **3** not 1 (and both are the new Tax pages — the primitive *is* being adopted) · **48** hand-rolled tables · `toLocaleString(undefined` **22** not 18 · `#2563eb` at **4** sites, 2 URL-encoded inside data-URI SVGs where `check-inline-hex.sh` cannot see them | verified independently |
| **C9** | §5: ConfirmModal *"renders behind"* a Radix modal | **Wrong mechanism, and the repo already has the right one on disk.** `frontend/e2e/nested-modal.spec.js` records that a Radix layer sets `pointer-events: none` on `<body>`, so a non-portalled overlay is **dead to clicks and absent from the a11y tree** — not merely behind. Remedy unchanged; cite the spec | reviewer |
| **C10** | §10: 41 mobile media blocks *"can never match"* | **43**, and `index.css:444-457` **does** apply on `/m/*` since `index.css` is always loaded. True for the other 42 | reviewer |
| **C11** | §4.3: the dead `tabular-nums` is a page one-off | It is on **`.data-table__number`** — the `<DataTable>` primitive's numeric cell — so every table migrated in "wave 2" inherits a numeric column with no tabular figures. Raises its priority | reviewer |
| **C12** | §2 levels | Deltas hold (**0** new rgba, **0** new hex in JSX, adoption frozen at 13 — the argument survives), but four of seven *levels* are filtered counts. Also the naive `grep 'rgba('` **counts comment prose**; and `FCSensitivity.css` has **43** hardcoded font sizes, not 34 — a stronger argument for Phase 2 than the draft made | `git archive` both trees |

**Verified CORRECT and unchanged:** all six of §3's stated ratios, independently re-derived from WCAG
2.x sRGB relative luminance · the rig is **deterministic** (two full runs: leaks 352/352, contrast
2,510/2,510, identical `<h1>` on all 74 cells) · §5's modal probe (**18.30:1**, **1.06:1**) · z-index
1000 vs 10401 · ConfirmModal's 17 hex, `#2563eb` ×2, no Esc, no focus trap · the duplicate
`ConfirmModal` at `QuickenImport.jsx:917` · `/quicken-import`'s 27px, the only route · **exactly 10**
routes with no `<h1>`, none with more than one · the three `rgba(248,250,254,.35)` declarations at the
exact cited lines · `dark-audit.mjs` never committed · `.balance-panel` in exactly three files with six
consumers · `<PageHeader>` divergence · 13 `formatCurrency*` / 41 `Intl.NumberFormat` / 32 files.

**Reviewer nits not accepted:** the scrim is at **`Modal.css:18`**, not 19 (verified). And §9's two
671-line files are genuinely both 671 lines — not a copy-paste error.

**Still open for pass 2:** C5/C6 make §8 a phased gate (3 assertions now, contrast later) — confirm that
is acceptable, or defer §8 entirely; and C7 means Phase 0's baselines must be re-measured with recorded
commands **before** any guard is committed.
