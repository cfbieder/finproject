# Fin Finance App UI — conventions

A small set of reusable, prop-driven React components from the Fin personal-finance
app, plus its design-token layer. Components are imported from the compiled bundle as
`window.FinUI.<Name>` and are **self-styled**: each ships its own CSS. The look (warm
off-white surfaces, muted forest-green brand, soft charcoal ink) comes entirely from
CSS custom properties + the **Outfit** font.

## Setup — no provider, just the stylesheet

There is **no theme/context provider**. Components render correctly as long as the
bundle's `styles.css` is loaded (it `@import`s the tokens, the Outfit `@font-face`, and
the component CSS). Without it, components fall back to unstyled browser defaults.

- **Dark mode:** set `data-theme="dark"` on a root ancestor (e.g. `<html data-theme="dark">`).
  All tokens (`--ink`, `--surface`, `--border`, …) flip automatically. Default is light.
- **Font:** Outfit is the base + heading family; it ships with the bundle, no extra setup.

## Styling idiom — CSS custom properties (no utility classes)

This is **not** a Tailwind/utility-class system and there are no styling props on the
components — they style themselves. When you write your **own** layout glue around these
components (page scaffolding, grids, spacing), style it with the design tokens via
`var(--token)`, never hard-coded colors/spacing. The real token families (from
`styles.css`):

| Family | Real tokens |
|---|---|
| Surfaces / bg | `--bg` `--bg-secondary` `--bg-tertiary` `--surface` `--surface-muted` `--surface-elevated` |
| Text / ink | `--ink` `--ink-secondary` `--ink-tertiary` `--muted` |
| Brand / accent | `--primary` `--primary-strong` `--primary-hover` `--primary-subtle` `--accent` |
| Semantic | `--success` `--warning` `--danger` `--info` `--gold` (+ `-strong` / `-subtle` variants) |
| Charts | `--chart-emerald` `--chart-teal` `--chart-navy` `--chart-amber` `--chart-rose` `--chart-purple` `--chart-indigo` |
| Borders | `--border` `--border-subtle` `--border-strong` |
| Spacing | `--space-xs` `--space-sm` `--space-md` `--space-lg` `--space-xl` `--space-2xl` |
| Radius | `--radius-sm` `--radius-md` `--radius-lg` `--radius-xl` `--radius-full` |
| Shadow | `--shadow-soft` `--shadow-md` `--shadow-lg` `--shadow-xl` `--shadow-focus` |
| Type | `--font-mono` `--font-weight-medium` `--font-weight-semibold` `--font-weight-bold` |

## Where the truth lives

- `styles.css` and its `@import` closure (tokens + `_ds_bundle.css`) — read it before
  styling; it defines every token above for light and `[data-theme="dark"]`.
- Per-component `<Name>.prompt.md` + `<Name>.d.ts` — the props and an example for each.

## What's here

Inputs/pickers: `AccountPicker` (searchable COA combobox), `AccountSelector` &
`CategorySelector` (grouped checklists), `HierarchyFilter` (grouped leaf picker),
`PeriodSelector` (period/range control), `PeriodCountSelector`.
Feedback/overlay: `Toast`, `ConfirmModal`, `HelpPanel`, `LoadingSpinner`, `EmptyState`.
Data display: `KpiCard` / `KpiCardRow` (metric tiles with sparklines). `Footer`.

## Idiomatic snippet

```jsx
const { KpiCardRow, KpiCard, Toast } = window.FinUI;

// Library components for the controls; your own layout glue uses tokens.
<div style={{ background: "var(--bg)", padding: "var(--space-lg)", display: "grid", gap: "var(--space-md)" }}>
  <KpiCardRow>
    <KpiCard title="Net Worth" value={2840000} changeValue={4.2} changeLabel="YTD" chartData={[{value:3},{value:5},{value:8}]} />
    <KpiCard title="Cash on Hand" value={184500} changeValue={1.1} changeLabel="vs last month" />
  </KpiCardRow>
  <Toast type="success" message="Reconciliation complete." onClose={() => {}} />
</div>
```
