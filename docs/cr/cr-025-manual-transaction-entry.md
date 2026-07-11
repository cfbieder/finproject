# CR025 — Manual Transaction Entry

**Status:** SHIPPED to prod (v3.0.4, 2026-06-05)
**Anchor in FC_NEXT_STEPS.md:** [cr025](../current/project-roadmap.md#cr025)

## As-built (2026-06-05)
- **Page** `frontend/src/pages/ManualTransactionEntry.jsx` + `.css` at **`/manual-entry`**; **Manual Entry** card on the `/transactions` landing (`routes.jsx`, category Transactions, `PlusCircle` icon).
- Reuses `AccountPicker` (account_id direct), `CategorySelector` (plTree, name→id via `fetchCategoriesV2`), `useTransactionExchangeRates` + `computeTransactionBaseAmount` (FX → USD, blank-on-no-rate with a warning + Save blocked), `useTransactionCurrencyOptions`. Native `<input type=date>` for the date.
- **Sticky-after-save** (decision 3): account/date/currency persist; amount/base/category/descriptions/memo/note/labels clear; focus returns to Amount.
- **Backend gap #1 closed:** `repo.create()` now inserts `accepted` — default **TRUE** for `source='manual'`, FALSE for other sources (preserves importer behavior); explicit `accepted` honoured. No migration. Sends v2 snake_case + `source:'manual', accepted:true` (gap #2: page sends snake_case, no route change).
- **Tests:** `repositories/__tests__/createTransaction.test.js` (manual→accepted TRUE / other→FALSE / explicit honoured).
- Unblocks the CR023 manual-bucket accounts (OCME 45, dormant holdings) leaving PocketSmith.

## Summary

A dedicated page for manually entering a single **actual** transaction into the `transactions` table (`source='manual'`, `accepted=TRUE`). Reached via a new **Manual Entry** card on the `/transactions` landing page. After a successful save the form stays open with sticky account/date/currency for rapid sequential entry.

Budget transactions are **out of scope** for this CR (they originate from the Budget Worksheet flow; a manual budget-entry path can be a follow-up CR if needed).

## Decisions (settled with owner 2026-06-03)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | **Actuals only** — inserts into `transactions`, `source='manual'`. Budget excluded. |
| 2 | Entry point | **New card on the `/transactions` landing page** → routes to a new `/manual-entry` page. |
| 3 | Post-save behavior | **Stay open for rapid entry** — success toast; account/date/currency persist; amount/description/category clear; focus returns to the amount field. |

## Current state (what already exists)

This is **almost entirely a frontend CR** — the create path exists:

- **Route:** `POST /api/v2/transactions` → `repo.create(req.body)` ([server/src/v2/routes/transactions.js:284](../../server/src/v2/routes/transactions.js#L284)). Returns `201 { data: <row> }`.
- **Repository:** `create(data)` ([server/src/v2/repositories/transactions.js:286](../../server/src/v2/repositories/transactions.js#L286)) — defaults `currency='USD'`, `base_currency='USD'`, `source='manual'`, and `base_amount = amount` when not supplied.
- **Schema:** the `transactions` table already has every needed column (`transaction_date`, `description1/2`, `amount`, `currency`, `base_amount`, `account_id`, `category_id`, `memo`, `note`, `bank`, `labels`, `source`, `accepted`, …) — no migration needed.
- **Landing page:** `CategoryLandingPage.jsx` auto-renders one card per route with `category: "Transactions"`, so the new card is a single entry in [frontend/src/config/routes.jsx:124](../../frontend/src/config/routes.jsx#L124).
- **Reusable form pieces:** `AccountPicker` (typeahead, hierarchy), `CategorySelector` (flattened P&L tree), `TransactionDateSelector` (day/month/year selects), `useTransactionCurrencyOptions()`, and `computeTransactionBaseAmount()` (FX → USD) — all already used by the bulk-edit modal.

### Two real gaps to close (backend)

The existing POST path was built for programmatic/import callers, not a form:

1. **`accepted` is not insertable.** `create()`'s INSERT column list omits `accepted`, so a manual row defaults to `accepted=FALSE` ([migration 003](../../server/db/migrations/003_*.sql)) and could be swept/overwritten by a feed refresh. Manual entries must be `accepted=TRUE`. → Add `accepted` to `create()`'s columns, defaulting `TRUE` only when `source='manual'` (else preserve current behavior / explicit value).
2. **No field-name transform on POST.** Unlike `PATCH`, the POST route passes `req.body` straight through (no `transformV1ToV2Fields`), so the frontend must send **v2 snake_case** fields. We will send snake_case from the new page — no route change required, but the CR notes it so the contract is explicit.

## Scope

- New page `frontend/src/pages/ManualTransactionEntry.jsx` + `ManualTransactionEntry.css`.
- New lazy route + card in `frontend/src/config/routes.jsx` (category `Transactions`, icon `PlusCircle` or similar).
- Backend: extend `repo.create()` to accept/insert `accepted` (default `TRUE` for `source='manual'`).
- Tests: backend unit test for the `accepted` behavior; optional Vitest for the form's payload builder / FX computation.

## UX

**Form fields** (single-column form, grouped):

| Field | Control | Notes |
|-------|---------|-------|
| Account | `AccountPicker` | Required. Sets the row's `account_id`. Sticky after save. |
| Date | `TransactionDateSelector` | Required, defaults to today. Sticky after save. |
| Amount | numeric input | Required. Sign convention matches existing transactions (negative = outflow). |
| Currency | currency select (`useTransactionCurrencyOptions`) | Defaults to the selected account's currency; sticky after save. |
| Base amount (USD) | numeric input, auto-filled | Computed via `computeTransactionBaseAmount(amount, currency, date)`; editable override. Shown read-only-ish with an "edit" affordance when `currency === 'USD'` (1:1). |
| Category | `CategorySelector` | Optional but recommended; flattened P&L tree. Cleared after save. |
| Description | text (`description1`) | Cleared after save. |
| Description 2 / Memo / Note | text (optional, collapsible "More" section) | Cleared after save. |
| Labels | optional | Cleared after save. |

- **Validation:** require account, date, and a non-zero amount before the Save button enables. Surface inline errors (reuse the modal's error pattern).
- **FX:** when `currency !== 'USD'`, auto-compute `base_amount` on amount/currency/date change; allow manual override. When the FX lookup finds no nearby rate, leave `base_amount` blank and warn (don't silently send `amount`).
- **Post-save (decision 3):** POST → on `201`, show a success toast (e.g. "Transaction added"), **keep** account/date/currency, **clear** amount/description(s)/category/memo/note/labels, refocus the amount input. On error, keep all values and show the message.

## Data flow

1. Form builds a **v2 snake_case** payload: `{ transaction_date, account_id, amount, currency, base_amount, category_id, description1, description2, memo, note, labels, source: 'manual', accepted: true }`.
2. `POST /api/v2/transactions` (e.g. `Rest.createTransaction(payload)` — add helper if not present).
3. Backend `create()` inserts with `accepted=TRUE` (after gap #1 fix) and returns the new row.
4. Frontend toasts + resets per decision 3. The row is now visible on `/trans-actual` and `/ledger` and contributes to balances immediately.

## Files changed

| File | Change |
|------|--------|
| `frontend/src/pages/ManualTransactionEntry.jsx` | New page (form + sticky-entry logic). |
| `frontend/src/pages/ManualTransactionEntry.css` | New stylesheet. |
| `frontend/src/config/routes.jsx` | Lazy import + route/card entry under Transactions. |
| `frontend/src/api/Rest.js` (or equivalent) | Add `createTransaction(payload)` helper if missing. |
| `server/src/v2/repositories/transactions.js` | `create()` accepts + inserts `accepted` (default TRUE for `source='manual'`). |
| `server/src/v2/repositories/__tests__/...` | Unit test for the `accepted` default. |
| `docs/current/project-description.md` | Routes table updated. |
| `docs/current/project-roadmap.md` | Anchor + Migration History entry. |
| `docs/cr/README.md` | CR025 row added. |

## Manual QA checklist

- [ ] `/transactions` shows a new **Manual Entry** card; clicking it opens `/manual-entry`.
- [ ] Required-field validation: Save disabled until account + date + non-zero amount are set.
- [ ] Selecting an account defaults the currency to that account's currency.
- [ ] Non-USD amount auto-computes a sensible USD `base_amount`; manual override sticks; USD is 1:1.
- [ ] No nearby FX rate → `base_amount` left blank with a warning, not silently equal to `amount`.
- [ ] Save inserts a row with `source='manual'` and **`accepted=TRUE`**; it appears on `/trans-actual` and `/ledger` and moves the account balance.
- [ ] A subsequent feed refresh does **not** overwrite or sweep the manual row.
- [ ] After save: account/date/currency persist; amount/description/category clear; focus returns to amount; toast shown.
- [ ] On API error, all field values are retained and the error message is shown.
- [ ] Mobile (≤ 900px): form is single-column and usable.

## Non-goals / follow-ups

- **Budget transaction entry** — separate flow/table; possible future CR.
- **Bulk / CSV manual entry** — out of scope (Quicken/bank-feed import already cover bulk).
- **Editing existing transactions** — already handled by the bulk-edit modal on `/trans-actual`.
- **Transfer pairing at entry time** — manual transfers are matched post-hoc via `/transfer-analysis`.

## Update history

- **2026-06-03** — CR opened; scope settled (actuals only, landing-page card, stay-open-after-save). Planning only — no code yet.
