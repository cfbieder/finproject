# CR104 — Budget builder: Cash Flow by currency (monthly roll-forward, with what-if transfers) — DRAFT

**Status:** PLANNED 2026-11-15 — **rev 3**. Pass 1 (`cr-technical-reviewer`) REVISE on rev 1 → rev 2;
pass 2 (`cr-signoff-pm`) **GO** on rev 2, on four conditions, applied in rev 3 (§6, §8).
**Hard stop: 2026-11-26** — P1 on prod by then, or it ships after the 12-10 publish.
**Track:** v3 · **Migration:** **090** `090_budget_build_cash_plan.sql` (P1; §3.4)
**Depends on:** CR098 (the builder, `computeCells`, `loadGrids`/`allocate`), CR100 (itemised lines), CR101
(inactive lines), CR083 (the Latest Estimate, per month × currency), CR075 (the base year is the budget — why
transfers stay out of `budget_entries`).
**Deadline context:** builder code freeze **2026-12-03**; first 2027 publish due **2026-12-10**. P1 is only
worth much before the publish.

## 1. The ask

Owner, 2026-11-15: a **Cash Flow** button on the budget builder opening a modal that shows, **per currency, not
per account** (USD, PLN, EUR), for each month of the build's year: opening balance + inflows − outflows = ending
balance, using the open build. Purpose: see whether money has to move between currencies, and when.

Why it matters (measured on prod, 2026 budget, `budget_entries`): the year nets roughly **PLN +148k,
USD −252k, EUR −15.6k**. The currencies drift apart inside a single budget, and nothing in Fin shows it —
the forecast's cash is one USD pool (`server/src/services/forecast/crud.js:521`, `getOpeningBankCash`;
the sweep has no currency).

## 2. Decisions (owner, 2026-11-15, via /question)

| # | question | decision |
|---|---|---|
| D1 | Transfers | **What-if only**, entered in the modal and saved with the draft. **Never** written to `budget_entries`. |
| D2 | Opening balance (Jan 1) | **Estimate + override**: a computed estimate (D5), with a per-currency × block field the owner can type over, saved with the draft. |
| D3 | What counts | **Two blocks per currency**: **Cash** (bank + credit cards, netted) and **Investments** (brokerage). What-if transfers move money between the blocks as well as between currencies. |
| D4 | Process | This CR, two-pass review, P1 before the 12-03 freeze. |
| D5 | Opening snapshot (from pass 1 item 1) | **At the build's LE cut-off**: ledger balances on the build's source LE's `actual_through`, plus that LE's months after it. One coherent snapshot; the override covers anything since. *(Rejected: today's balance + remaining LE months double-counts the months between `actual_through` and today; last month-end is exposed to feed / manual-statement lag.)* |

Why not real Transfer rows (rejected for D1): the LE excludes the 13 Transfer categories
(`le.excluded_category_ids`, `budgetBuilder.js:155`), so every LE would drop them; under CR075 the forecast's
base year would take rows the sweep already models; and each conversion would leave an FX residual in
Budget vs Actual.

## 3. Design

### 3.1 Which account goes where
One constant listing the **root accounts** of each block; every account under a root follows it — the same
root-name rule the sweep uses (`name = 'Bank Accounts'`, `crud.js:521`). There is no account type that marks
cards or brokerage.
- **Cash:** `Bank Accounts`, `PLN Credit Cards`, `USD Credit Cards`.
- **Investments:** `Fidelity Fixed Income`, `Fidelity Stock`, `CVC Investments`, `PL Investments`,
  `US - Investments`.
- **A named root that is missing fails loudly** (error, and a test), never silently shrinks a block.
- **Other accounts:** any cell whose account is in neither block (2026: −55,000 USD on `Tax Liabilities`;
  properties, mortgages, Historical) goes to an explicit **Other accounts** row per currency — shown, counted in
  the reconciliation, in neither block's ending.
- **Unassigned** (no account; 2026: 32 rows, −104,833 USD): counted in the **Cash** ending as **its own row**,
  not merged into − Out, so the short-cash flag stays cautious and the row stays visible.

### 3.2 Numbers
- **Currencies:** USD, PLN, EUR (`CURRENCIES`, `budgetBuilder.js:28`). Any other currency held in a block
  (today `WISE - GBP` under `Bank Accounts`) is listed as *"GBP not modelled: balance X"* — never folded in
  at 1:1 or converted.
- **Flows:** keyed on the **cell's** currency, not the account's; mismatches (2026: 6 USD rows on an EUR
  account) are listed, not re-keyed. A **draft** reads `computeCells` (`budgetBuilder.js:833`, computed live —
  drafts store no cells); a **published** build reads its stored cells (`cellsFor`). Inactive lines (CR101)
  publish nothing and are left out.
- **Opening (D5):** per currency × block —
  1. Ledger balance of each block account at the build's source LE's `actual_through`, in **local** currency.
     The per-account balance CTE is **lifted** out of `getOpeningBankCash` into a shared function returning
     (account, currency, balance) as of a date; the forecast keeps its total (a test pins it unchanged). The new
     path has **no** `COALESCE(currency,'USD')` — a currency-less account is an error.
  2. Plus that LE's rows with `period_month > actual_through` (and in the current year), `amount` not
     `base_amount`. LE rows carry no account (`072_budget_le_schema.sql:172`), so each row is split across
     accounts by the build's trailing-12 actual grid (`loadGrids` + `allocate`, `budgetBuilder.js:716, 801`),
     then placed by §3.1. A part with no grid goes to Unassigned.
  3. An override, if set, replaces the estimate for that currency × block.
- **Scope label (on the modal, not in a footnote):** *"Budgeted income and expenses only. Excludes loan
  principal, card-payment timing, price moves and reinvestment. Investments are at ledger value — a transfer
  out of them is a sale."* Investments stay at **ledger** value (agrees with the balance sheet; CR061 treats
  quotes as an overlay).

### 3.3 Modal
- Button **Cash flow** (`btn btn--outline`) after Compare forecast. Shared `components/Modal`, size `chart`,
  structure copied from `features/Budgets/CompareForecastModal.jsx`; new `features/Budgets/CashFlowModal.jsx`.
- **One table per currency, stacked** (USD, PLN, EUR); never a cross-currency total. Each table:
  **Cash** — Opening · + In · − Out · Unassigned · ± Transfers (P2) · = Ending;
  **Investments** — Opening · + In · − Out · ± Transfers (P2) · = Ending;
  **Other accounts** — net flows (memo). Columns Jan–Dec + Year (Jan open → Dec close). Sticky label column,
  horizontal scroll. Desktop only (the route already is).
- Each opening cell states its source: *estimate (LE-11-26, balances at 2026-10-31)* or *your override*.
- **Flags:** a negative Cash ending is red text (`.bb-neg`) plus a glyph; Investments are never flagged. One
  summary line on top: *"⚠ PLN cash short Mar–Apr (lowest −12,400)"*. Colour means sign; no `<Money signed>`.

### 3.4 Storage — migration 090
`budget_build_cash_plan`: `id`, `build_id` FK → `budget_builds` ON DELETE CASCADE, `kind`
(`opening` | `transfer`), `currency`, `block`, `month`, `to_currency`, `to_block`, `amount` NUMERIC(15,2)
(local, from side), `rate` NUMERIC(15,6), `to_amount` NUMERIC(15,2), `note`, timestamps.
- `block` / `to_block` CHECK `IN ('cash','investments')`.
- Per-kind CHECKs: **opening** — `month`, `to_*`, `rate`, `to_amount` NULL; **transfer** — all set,
  `month` 1–12, `rate > 0`.
- `UNIQUE (build_id, currency, block) WHERE kind = 'opening'`.
- Additive and fresh-DB safe. Row in `docs/current/migrations.md`; **applied to prod before the code ships**.
- P1 writes `opening` rows only; P2 adds `transfer` rows — no second migration.
- **Copy rule:** `createBuild` from `parentBuildId` (`budgetBuilder.js:191–360`) copies plan rows **only when
  the parent has the same `target_year`** — openings and transfer months belong to one year.
- Plan writes are **draft-only**; 409 on a published build.

### 3.5 Endpoints
`GET /api/v2/budget-builder/builds/:id/cash-flow` (the grid) and `PUT …/cash-plan` (P1: openings; P2:
transfers). `Rest.unwrap` envelope; whitelisted bodies (CR043 N10). Non-numeric amounts are **rejected**, never
coerced with `parseCurrency`.

### 3.6 P2 — what-if transfers
Rows in the modal: month, from (currency + block), to (currency + block), amount, rate. The build's FX is
*local per USD*, so `rate` is defined **to-per-from**: default `fx[to] / fx[from]`, 1 within a currency;
editable. `to_amount` = amount × rate rounded to cents and **stored**, so totals reconcile with no residual.
Shown as **± Transfers** in both tables touched. Nothing publishes.

## 4. Verification
- **Service fixture:** two currencies, a card line (pins that card liabilities net with the same sign as bank
  balances), an investment-income line, an Other-account line, an unassigned line, an LE remainder split across
  two accounts, an override — and the expected 12-month roll-forward to the cent.
- **Independent reconciliation:** per currency, Σ cells = `getBuild().totals[currency]` (via `annualFor`,
  computed separately; `allocate` preserves the sum to the cent, so they match exactly).
- **Roll-forward identity:** per currency × block, Opening + flows (+ Unassigned for Cash) + transfers =
  Ending every month; per currency, block flows + Other = Σ cells.
- **Lift guard:** `getOpeningBankCash`'s total is unchanged after the CTE is extracted.
- **Missing root:** renaming a listed root fails the endpoint and the test.
- **Opening at cut-off:** a fixture with a transaction after `actual_through` proves it is not in the opening.
- **P2:** a transfer changes the from-currency by −amount and the to-currency by +`to_amount`, exactly.
- **Frontend:** Vitest for the modal (summary line, flags, source labels, GBP line).
- **Render both themes** on the real 2027 draft before calling it done (status.md: the display half has no gate).

## 5. Non-goals
- No change to the forecast's numbers, the sweep or the LE. No per-currency forecast.
- No writing of transfers into the budget (D1). Revisit only if a per-currency forecast ever exists.
- No card-payment lag, no tax on sales, no market-price projection, no GBP modelling.

## 6. Phasing
- **P1** — migration 090, endpoints, modal with Cash / Investments / Other, opening estimate + override.
  **Hard stop 2026-11-26.** If it slips, cut the Investments block first. Steps, in order:
  1. Build in a worktree; tests green; render both themes on the 2027 draft.
  2. **Migration 090 to prod first**, via `deploy-to-production.sh` Step 2b, then the code.
  3. **Freeze gate:** checksum build 12's lines and items before and after the deploy — CR104 must not change
     them. **No CR104 deploy between 11-26 and the 12-10 publish.**
- **P2** — what-if transfers. Plan writes are draft-only, so P2 is useful only while a draft is open. **Either it
  lands by 2026-11-26 with P1, or it moves to the roadmap backlog, tied to the 2028 draft** (≈ Nov 2027).
- **Sequencing:** next in the builder lane, **ahead of CR098 P3c** (the hand-edit warning). Not built in
  parallel with it — same files (`budgetBuilder.js`, the builder page). Re-run the lift-guard test before the
  January CR064 close, since the shared balance function feeds the forecast.

## 7. Open questions
None — rev 1's three are answered in §3.1 (Unassigned, roots) and §3.2 (ledger value).

## 8. Review log
- **Pass 1 — `cr-technical-reviewer`, rev 1: REVISE** (2026-11-15). Blocking: (1) opening double-counted the
  months between the LE's `actual_through` and today → D5 (owner chose the cut-off snapshot); (2) LE rows carry
  no account → split by the trailing-12 grid; (3) accounts in neither block → Other accounts row; (4) GBP →
  listed, not modelled; (5) migration shape → §3.4. Should-fix 6–11 (copy rule, independent reconciliation,
  lift the balance CTE, stored cells for published builds, to-per-from rate + stored `to_amount`, endpoint
  rules) applied. §7 answered: Unassigned as its own Cash row; roots by name constant, fail loudly; ledger
  value. Verified independently: latest **final** LE is LE-10-26 (`actual_through` 2026-09-30); build 12
  (2027 v6) sources LE id 10, LE-11-26 (`actual_through` 2026-10-31); `WISE - GBP` exists; 090 unclaimed.
  All applied in rev 2.
- **Pass 2 — `cr-signoff-pm`, rev 2: GO on four conditions** (2026-11-15): (1) hard stop 11-26 + freeze gate
  with build-12 checksums; (2) migration 090 to prod before the code, in P1's steps; (3) refresh the stale index
  row; (4) re-time P2 explicitly — by 11-26 or backlog tied to the 2028 draft. All applied in rev 3 (§6, index).
  Also: build P1 ahead of CR098 P3c, not in parallel; P1 is the right minimum, Investments block cut first if
  the date slips.
