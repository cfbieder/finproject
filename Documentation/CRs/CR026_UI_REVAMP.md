# CR026 — UI Revamp: Sidebar Navigation, Design Refresh, Mobile Expansion, Help & Commercialization-Readiness

**Status:** PLANNED (draft — key decisions settled 2026-06-04; §11.4–5 open) · [NEXT_STEPS anchor](../FC_NEXT_STEPS.md#cr026-ui-revamp)
**Created:** 2026-06-04
**Owner:** cfbieder
**Supersedes / relates to:** builds on CR002 (frontend refactor), CR007 (PWA/mobile shell), CR008 (HierarchyFilter redesign), CR010 (COA redesign). Does **not** replace them.

---

## 0. TL;DR for the reader

The brief asked for a "complete new revamp." After mapping the current frontend, **a from-scratch rebuild is the wrong call** — the app already has a token-driven design system, an SVG icon library (Lucide), a separate mobile shell, and a category-based information architecture. Three of the five requested items already exist in partial form. A "complete revamp" would rip out guardrailed, working systems (e.g. the `.btn` baseline lint, the `/m/*` mobile pages) for marginal gain.

This CR therefore reframes the work as **five targeted, high-leverage tracks** on top of the existing foundation, plus an explicit boundary around the newly-raised goal of **commercialising the software for other users** — which is an architecture program (auth, multi-tenancy, de-personalisation), not a UI task, and must not be smuggled into a CSS refresh.

---

## 1. Why this CR exists (the request)

Verbatim points from the request:
1. Replace the top menu bar with a modern **sidebar** (VS Code-like).
2. Rethink how **menu items are grouped**.
3. Improved **colour / font** scheme.
4. A **dedicated mobile** experience — simpler, key-points-first, phone-readable.
5. Improved **graphics and icons**.
6. (Added) Evaluate from the perspective of **commercialising** the software for other users.
7. (Added) Add a **help menu** and make the app **more intuitive**.

Follow best-practice "look and feel" in the market.

---

## 2. Honest baseline — what already exists (and must NOT be thrown away)

Mapped from the live frontend (`frontend/src/`):

| Requested item | Current reality | Verdict |
|---|---|---|
| **(1) Sidebar nav** | Top horizontal nav bar (`components/NavigationMenu.jsx`) — glassmorphic pill, 7 category links → category **landing pages** (not dropdowns). Mobile = hamburger drawer. | **Genuinely new work.** The biggest net-new change. |
| **(2) Menu grouping** | 7 categories in `config/routes.jsx`: Home, Database, Transactions, Budgeting, Forecasting, Reports & Graphs, Settings. Each route tagged with a `category`. | **IA rework, low code cost** — `routes.jsx` is already the single source of truth. |
| **(3) Colour/font** | Full token system in `index.css`: "Mindful Minimalist" — forest green `#6B8E6B`, warm cream `#FDFCF8`, Outfit + SF Mono, 4 shadow levels, radii, spacing scale. | **Refine, don't replace.** Foundation is solid; gaps are dark mode + contrast audit + data-viz palette. |
| **(4) Mobile** | Dedicated shell already exists: `frontend/src/mobile/` — `/m/*` routes, bottom tab bar, 5 simplified pages (Balance, Cash Flow, Refresh, Budget, Graph), 44px targets, safe-area insets, category picker. | **Expand coverage**, don't build from zero. Only 5 of 31 pages have a mobile view. |
| **(5) Icons/graphics** | **Lucide React** (SVG, tree-shakeable) already in use across `routes.jsx` and components. unDraw illustrations for empty states. | **Mostly done.** Polish: consistent sizing, icon-per-route audit, richer empty states. |
| **(6) Commercialisation** | **Nothing.** Single-user. No auth, no tenant isolation. Hardcoded personal assumptions (birth year in FC Settings, specific account names, OCME/Pekao/Fidelity specifics). | **Out of scope for a UI CR** — flagged as a separate program (§9). |
| **(7) Help / intuitiveness** | **Nothing.** No help menu, no onboarding, no tooltips, no command palette. Empty states exist but are passive. | **New work, high value** for both current use and commercialisation. |

**Critical takeaway:** the request reads as greenfield but ~60% of it is "evolve what's there." Scoping it as a rebuild would be the single most expensive mistake available. Everything below is additive/replacement-in-place.

---

## 3. Guiding principles

1. **Evolve the token layer, don't fork it.** All new surfaces consume `index.css` tokens. No hardcoded hex.
2. **Respect the `.btn` guardrail.** `Scripts/check-button-css.sh` stays green; no new `*-btn`/`*-button` classes. New chrome (sidebar) uses `.btn` + new namespaced component classes, not button sprawl.
3. **Desktop and mobile stay separate code paths** (the existing `/m/*` split), because the brief explicitly wants a *simpler* phone UI, not a squeezed desktop. Don't collapse them into one responsive tree.
4. **Commercialisation-aware, not commercialisation-delivering.** Design the sidebar, settings, and help system so multi-user/branding can drop in later — but ship single-user.
5. **No big-bang.** Ship behind a layout flag, page-group by page-group. The app stays usable on `main` throughout.

---

## 4. Track A — Sidebar navigation (replaces the top bar)

### 4.1 Target pattern

A **collapsible left sidebar** (VS Code / Linear / Stripe-dashboard family), not a top bar.

```
┌────────────┬─────────────────────────────────────────┐
│ ▣ Fin      │  Breadcrumbs                    ⌘K  ? ◑  │  ← slim top utility strip
│  v2.15.1   ├─────────────────────────────────────────┤
│            │                                         │
│ ⌂ Overview │                                         │
│ ▸ Accounts │            PAGE CONTENT                 │
│ ▸ Budget   │         (.page-shell, unchanged)        │
│ ▸ Forecast │                                         │
│ ▸ Reports  │                                         │
│ ─────────  │                                         │
│ ⚙ Data     │                                         │
│ ⚙ Settings │                                         │
│ ? Help     │                                         │
│ [collapse] │                                         │
└────────────┴─────────────────────────────────────────┘
```

- **Two states:** expanded (~240px, icon + label) and **rail/collapsed** (~64px, icon-only with hover tooltips) — the VS Code behaviour the brief references. State persisted to `localStorage`.
- **Expandable sections** (accordion) for multi-page groups; single-page groups are direct links. Active route highlights both the group and the leaf.
- **Top utility strip** retains breadcrumbs (keep `Breadcrumbs.jsx`) and adds: **⌘K command palette** (Track E), **? Help** (Track E), **◑ theme toggle** (Track C), Install button (move from navbar), env badge.
- **Mobile:** sidebar is **not** shown on phones — the existing `/m/*` bottom-tab shell stays. On tablet (≤1080px) the sidebar defaults to the collapsed rail; below 768px desktop chrome hands off to the mobile shell as today.

### 4.2 Why a sidebar here (the actual justification, not fashion)

- The app has **31 desktop routes across 7 groups** — a horizontal bar already overflows and leans on landing pages as a crutch. Vertical lists scale to dozens of items; horizontal bars don't (market consensus: sidebars are the default for SaaS/fintech with many sections — [Navbar Gallery](https://www.navbar.gallery/blog/best-side-bar-navigation-menu-design-examples), [Eleken](https://www.eleken.co/blog-posts/modern-fintech-design-guide)).
- A sidebar lets us **show second-level items inline** (expand a group, see its pages) instead of the current click-through-to-a-landing-page detour. Fewer clicks to deep pages.
- It creates a permanent home for **⌘K, Help, theme, and (future) account/tenant switcher** — all things a commercial product needs and a top bar has no room for.

**Counter-point considered:** sidebars cost horizontal space, which hurts the wide financial tables this app is full of (Balance Sheet, Forecast Review with many year columns). **Mitigation:** the collapsed rail (64px) plus the existing horizontal-scroll table wrappers; default to the rail on report-heavy pages. This is a real tradeoff, not a non-issue — the rail-by-default-on-reports rule is part of the spec, not an afterthought.

### 4.3 Implementation notes

- New `components/Sidebar/` (`Sidebar.jsx`, `SidebarSection.jsx`, `SidebarItem.jsx`, `Sidebar.css`). Driven by the **same `routes.jsx`** config (add an `order`/`group` refinement; reuse existing `icon` per route).
- `Layout.jsx` changes from `NavigationMenu + Breadcrumbs + content + Footer` to `Sidebar + (TopStrip(Breadcrumbs) + content + Footer)`. Behind a `VITE_NAV_LAYOUT` flag (or a settings toggle) so the old top bar remains as fallback during rollout.
- `NavigationMenu.jsx` retained until the sidebar is validated, then deleted.
- Category **landing pages** become optional once groups expand inline — keep them as the rail/mobile fallback and as section overviews; do not delete (they're generated, near-zero maintenance).

---

## 5. Track B — Information architecture (menu grouping)

Current grouping is data-pipeline-oriented ("Database"), which is fine for the author but opaque to a new user. Proposed regrouping (workflow-oriented, commercialisation-friendly):

| New group | Icon | Routes folded in | Notes |
|---|---|---|---|
| **Overview** | LayoutDashboard | `/` | Was "Home". Becomes the analytic landing (Track D candidate). |
| **Accounts & Transactions** | Receipt | `/trans-actual`, `/trans-budget`, `/ledger`, `/transfer-analysis`, `/refresh-ps`, `/balance-calibration`, `/manual-entry` (CR025) | Merges today's "Transactions". The day-to-day surface. |
| **Budget** | Calculator | `/budget-worksheet`, `/budget-realization`, `/budget-graph`, `/budget-variances`, `/budget-fx` | Unchanged contents, clearer label. |
| **Forecast** | TrendingUp | `/forecast-mapping`, `/forecast-scenarios`, `/forecast-modules`, `/forecast-setup-exp`, `/forecast-review`, `/fc-settings`, `/fx-options` | The 5-step flow + settings. Consider a step indicator in the sub-nav. |
| **Reports** | BarChart3 | `/balance`, `/balance-trends`, `/cash-flow`, `/cash-flow-periods`, `/balance-sheet-periods`, `/balance-chart`, `/category-trend` | Was "Reports & Graphs". |
| **Data Sources** | HardDrive | `/upload-ps`, `/quicken-import`, `/bank-feed-diagnostic`, `/backup-database` | Was "Database" — admin/plumbing, demoted below the workflow groups with a visual divider. |
| **Settings** | Settings2 | `/coa-management`, `/program-settings`, + new **Profile/Appearance/Help** | COA stays here. |

Decisions embedded:
- **"Data Sources" sits below a divider** — it's setup, not daily work. New users shouldn't hit "Database" first.
- **Forecast keeps all 7 pages** but the sub-nav should show the 1→5 step order (it's a wizard pretending to be a menu).
- **Balance Calibration / Transfer Analysis** are power-user tools — candidates to nest under an "Advanced" disclosure within their group so a commercial first-run isn't overwhelming.

---

## 6. Track C — Visual design refresh (colour, type, dark mode)

The token foundation stays; this track **fills gaps**, it does not repaint.

1. **Dark mode (net-new).** Add a parallel dark token set. Per market best practice ([Muzli](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/), [UX Design Institute](https://www.uxdesigninstitute.com/blog/dark-mode-design-practical-guide/)): no pure black (use ~`#121212`/`#1a1a1a` surfaces), no pure white text (use `#E0E0E0`–`#F0F0F0`), each accent gets a dark-variant that preserves perceptual weight, elevation via tonal layers + borders rather than shadows. Implement as `:root` light tokens + `[data-theme="dark"]` overrides; toggle in the top strip, persisted; default to system preference. **This is the single largest CSS effort** — every page CSS that hardcodes a colour must move to tokens first.
2. **Contrast audit (WCAG 2.2 AA).** Financial red/green on cream currently unverified. Audit text (≥4.5:1) and UI/chart elements (≥3:1). Critical for accessibility *and* for not shipping an inaccessible commercial product. ([accessibility.build](https://www.accessibility.build/tools/color-palette-generator))
3. **Data-viz palette as a first-class, separate scale.** The 7 chart colours exist but should be validated as a set against both light and dark backgrounds, and against red/green colour-blindness (finance leans hard on red=bad/green=good — add a non-colour cue, e.g. ▲/▼ or sign, which several mobile pages already do).
4. **Typography:** keep Outfit + SF Mono. Tighten the type scale (h1 2.5rem is large for a dense dashboard) and **standardise tabular-nums** everywhere numbers align in columns (partially done).
5. **Brand-token extraction (commercialisation hook):** isolate the green/cream/logo into a small `--brand-*` token group so a future tenant can re-theme without touching component CSS. Cheap to do now, expensive to retrofit later.

This track is the prerequisite for dark mode and is the cleanup that pays down the "page CSS hardcodes colours" debt.

---

## 7. Track D — Mobile expansion

The `/m/*` shell is good and proven (CR007). Gaps:

- Only **5 of 31** functions have a mobile view (Balance, Cash Flow, Refresh, Budget Realization, Budget Graph).
- **Net worth / overview** is the #1 thing a phone user opens for, per market research ([G & Co.](https://www.g-co.agency/insights/the-best-ux-design-practices-for-finance-apps)) — and the mobile home is currently a *pure launcher* with no data.

Proposed:
1. **Mobile Overview/home with live data** — net-worth hero, month cash-flow delta, 2–3 KPIs, top movers. Replaces the dumb launcher (keep the launcher links below the fold).
2. **Add mobile views** for the next-most-used: Transactions (read + categorise — the categorise flow already exists in `MobileRefreshPS`), Ledger (read-only), Balance Trends (single chart). Prioritise *reading* over *editing* on phone.
3. **Bottom tab bar** gains an **Overview** tab; revisit the 5-tab set (tabs should be the 5 highest-frequency destinations, currently includes Refresh which is periodic, not daily).
4. **Microinteractions** (pull-to-refresh, skeleton loaders, optimistic toasts — partly present) per 2025 mobile-finance norms.
5. Keep the **44px targets, 16px inputs, safe-area insets, flat cards** rules already codified in `mobile.css`.

Explicitly **not** doing: full feature parity on mobile. Forecast setup, COA editing, calibration stay desktop-only by design — the brief asked for "key points, simpler interface."

---

## 8. Track E — Help & intuitiveness

All net-new; the highest-leverage track for both the author's future self and any external user.

1. **Help menu (top strip `?`)** — opens a panel with: searchable docs, keyboard shortcuts, "what's on this page" contextual help, links to the CR/concept docs, version/changelog. Source content from existing `Documentation/`.
2. **Command palette (⌘K / Ctrl-K)** — fuzzy-jump to any route + quick actions (run report, add transaction). Cheap to build off `routes.jsx`; massively improves power-user speed and discoverability. (Pattern is now table-stakes in SaaS.)
3. **Contextual tooltips & inline help** over the linear product tour — market guidance is explicit that long tours are dead; use short contextual tips triggered by intent ([Userpilot](https://medium.com/@userpilot/onboarding-ux-patterns-and-best-practices-in-saas-c46bcc7d562f), [Flowjam](https://www.flowjam.com/blog/saas-onboarding-best-practices-2025-guide-checklist)). Many fin terms here are non-obvious (FC Lines, neutralize, calibration, sweep) — a `(?)` glossary tooltip per term beats a tour.
4. **Actionable empty states** — upgrade passive "no data" states to next-action prompts ("No transactions yet → Refresh feeds / Upload CSV / Add manually"). Several pages already have unDraw illustrations to build on.
5. **First-run onboarding checklist** (commercialisation hook) — progressive setup: connect a source → import → set budget year → first report. Skippable, progress-tracked. Build behind the same flag as commercialisation; ship the checklist component now, wire it up when multi-user lands.

---

## 9. Commercialisation — scope boundary (READ THIS)

The request to "consider commercialising for other users" is **not a UI change** and must not be scoped into this CR as deliverable work. Honest assessment of what commercialisation actually requires:

- **AuthN/AuthZ** — there is none today. Login, sessions, password reset, ideally OAuth/biometric.
- **Multi-tenancy / data isolation** — every table is single-user. Needs a tenant/user key on all data, row-level isolation, and a migration. This is the dominant cost and a security-critical correctness problem.
- **De-personalisation** — hardcoded assumptions (birth year, specific accounts, OCME/Pekao/Fidelity/PocketSmith specifics, Tailscale IPs, the `bank-feed` shared-Sheet coupling) must become per-user config.
- **Onboarding/account lifecycle, billing, GDPR/data-export/delete, hosting model** (self-host vs SaaS), support, ToS/privacy.

**This CR's only commercialisation deliverables are *hooks*, not the program:**
- Brand-token extraction (§6.5).
- Help/onboarding components built but flag-gated (§8.5).
- Sidebar with a reserved slot for a future account/tenant switcher (§4.1).
- IA that doesn't assume the author's mental model (§5).

A separate **CR027 "Multi-User & Commercialisation"** (or an epic) should own auth + tenancy + de-personalisation. Attempting it inside a UI refresh would couple a security-critical data migration to a CSS project — exactly the wrong risk profile. **Recommend: split it out.**

---

## 10. Phasing & rollout

Ship behind `VITE_NAV_LAYOUT` (sidebar vs legacy top bar) and `[data-theme]`; nothing is big-bang.

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 — Token hardening** | Move remaining hardcoded colours in page CSS onto tokens; extract `--brand-*`; contrast audit. | `grep` finds no raw hex in page CSS for colour; AA pass on core text. |
| **P1 — Sidebar (desktop)** | `components/Sidebar/`, top utility strip, `Layout.jsx` swap behind flag, IA regroup in `routes.jsx`. | Sidebar reaches all 31 routes; rail/expanded persist; `.btn` lint green; legacy bar still togglable. |
| **P2 — Dark mode** | Dark token set, theme toggle, per-page dark fixes, chart palette validation. | Every page legible in dark; toggle persists; AA in both themes. |
| **P3 — Help & ⌘K** | Command palette, help panel, glossary tooltips, actionable empty states. | ⌘K jumps to any route; help panel searchable; key fin terms have tooltips. |
| **P4 — Mobile expansion** | Mobile Overview w/ data, +3 mobile pages, tab-bar revisit, microinteractions. | Overview shows live net worth; new pages pass on-device check. |
| **P5 — Onboarding hooks** | First-run checklist component (flag-gated), brand-token wiring. | Checklist renders with dummy steps; no multi-user dependency leaked into `main`. |

Each phase is independently shippable and independently revertible.

## 11. Decisions

**Settled (2026-06-04):**
1. ✅ **Commercialisation split.** A separate **CR027** owns auth / multi-tenancy / de-personalisation. This CR ships single-user with only the *hooks* in §9.
2. ✅ **Dark mode stays in this CR as P2**, after the sidebar (P1). P0 token-hardening runs first so dark mode isn't blocked.
3. ✅ **Sidebar / command palette / tooltips are hand-rolled** in vanilla React + CSS tokens — no new UI dependency, consistent with the dependency-light ethos and the `.btn` guardrail discipline.

**Still open (decide before they're hit):**
4. **Landing pages: keep or retire** once the sidebar expands groups inline. **[recommended: keep as section overviews + mobile/rail fallback]** — decide during P1.
5. **Scope cut for v1.** If the full P0–P5 is too big, the minimum coherent slice is **P0 + P1 + P3-help** (sidebar + IA + help), deferring mobile expansion. (Dark mode now retained per decision 2.)

---

## 12. Files in scope (initial estimate)

- **New:** `components/Sidebar/*`, `components/TopStrip.jsx`, `components/CommandPalette/*`, `components/HelpPanel/*`, `components/Glossary/*`, dark-theme token block in `index.css`, mobile Overview page + 3 mobile pages under `mobile/pages/`.
- **Changed:** `Layout.jsx`, `config/routes.jsx` (group/order metadata), `index.css` (token additions, brand extraction), most `pages/*.css` (token migration for dark mode), `mobile/MobileTabBar.jsx` + `mobile.css`, `Breadcrumbs.jsx` (move into top strip).
- **Retired (end of rollout):** `components/NavigationMenu.jsx` + `.css` (after sidebar validated).
- **Untouched:** all `server/`, all feature business logic, the `.btn` system (consumed, not changed), the `/m/*` routing split.

## 13. Risks

- **Token-migration drag (P0).** ~20 page CSS files with possible hardcoded colours; dark mode is blocked until this is clean. Mitigate: lint rule for raw hex in page CSS, mirror of the `.btn` guardrail.
- **Horizontal space on wide reports** (§4.2) — rail-by-default on report pages.
- **Scope creep via commercialisation** — the single biggest risk; §9 boundary is the control.
- **Two nav systems live at once** during rollout — flag discipline; delete legacy promptly once validated.
- **`.btn` guardrail friction** — new chrome must use `.btn` + namespaced non-button classes; budget time to keep `check-button-css.sh` green.

---

*Draft prepared 2026-06-04 after a frontend audit + market review. Decisions in §11 are open; nothing here is committed to code.*
