**Status:** COMPLETED — [Plan](../current/project-roadmap.md#cr007)

# CR007 — PWA & Mobile Simplified Shell

Installable Progressive Web App + dedicated mobile experience under `/m/*` separate from desktop pages. Bottom tab bar with 5 reports: Balance, Cash Flow, Refresh, Budget, Graph.

## Outcome — PWA

- `vite-plugin-pwa` installed.
- Cache-first for hashed Vite assets (JS/CSS/fonts/images), network-only for `/api/` calls.
- Auto-update detection every 60s with toast prompt ("A new version is available" + Update/Later).
- Manifest: `standalone`, `any` orientation. Icons: 192px, 512px, maskable, Apple Touch 180px.
- nginx: `sw.js`/`manifest.webmanifest` served `no-cache`; hashed `/assets/` `1y immutable`.
- Custom Install button in navbar via `useInstallPrompt` hook (captures `beforeinstallprompt`, hides when standalone).
- `PWAUpdatePrompt.jsx` mounted in `main.jsx`.

## Outcome — Mobile shell

- `useIsMobile`, `MobileLayout`, `MobileTabBar`, `MobileHome` (pure launcher).
- `mobile.css` token overlay (44px touch targets, 16px input font to prevent iOS zoom, safe area insets, `overscroll-behavior: none`).
- `/m/*` routing with auto-redirect both directions; "Switch to desktop view" escape hatch via localStorage `forceDesktop`.
- Pages shipped:
  - `MobileBalance` — KPIs + collapsible Level-1 groups.
  - `MobileCashFlow` — period pills, KPI cards, Top Expenses / Top Income.
  - `MobileBudgetRealization` — 2×2 KPI grid, top variances with progress bars.
  - `MobileBudgetGraph` — full-bleed Recharts horizontal grouped bar chart.
  - `MobileRefreshPS` — refresh trigger, Accept all, per-row Accept pills.
  - `MobileCategoryPicker` — full-screen searchable list with localStorage Recents.

## Key references

- PWA wiring: `frontend/vite.config.js`, `frontend/src/main.jsx`, `frontend/src/components/PWAUpdatePrompt.jsx`.
- Mobile shell: `frontend/src/mobile/`.
- Shared period helper: `frontend/src/utils/periodPresets.js`.
