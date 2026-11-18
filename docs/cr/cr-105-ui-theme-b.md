# CR105 — UI theme B ("Workbench" palette, Inter, flat, compact) — IN-PROGRESS

**Status:** IN-PROGRESS 2026-11-18 — **P1 (tokens) built on branch `cr105-theme`, unreleased.** P2+ (the
Workbench shell) not decided. Roadmap: [§1.1 CR105](../current/project-roadmap.md#cr105).
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

## 2. P1 — what changed (branch `cr105-theme`)

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
- **Contrast**, measured on the same 8,925 text elements across 15 routes, prod v3.92.2 against this branch:
  light **487 → 61** below AA, dark **78 → 62**. Every remaining failure is `--muted-light` (60 in each theme),
  an existing class that P1 did not touch. (The CR086 rig was never committed, so this was a fresh
  in-page pass: computed colour against the composited background, 4.5:1 or 3:1 for large text.)

## 4. Not in P1 (known, deliberate)

- **Chart and category palettes**, which are hardcoded per chart (`chartColor="#5B8C5B"` on the KPI tiles,
  `FCReview` series, `FCLineMapping` types, "deposit" in the audit/sweep modals), keep their colours. They are
  data colours, not chrome, and need a chart pass of their own.
- **Page headers** still use the uppercase brand-coloured title (Budget Builder, Balances). That pattern is
  B's P2/P4 territory.
- JetBrains Mono for IDs (B's spec): the existing mono stack is kept, because it is used in only 11 places.
- The Outfit files stay in `public/fonts/` (no longer loaded) until P1 is accepted, so a revert is one line.
- `--muted-light` contrast (above).

## 5. Next

Owner trial of P1 on prod, then decide on the shell (B's P2: rail, header tabs, global period, inspector).
**The budget builder is frozen 2026-12-03 → 12-10**, so no builder layout work before the 2027 publish.
