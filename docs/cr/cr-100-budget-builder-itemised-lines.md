# CR100 — Itemised budget lines (a line built from listed items, by month, in any currency) — DRAFT

**Status:** DRAFT rev 2 (2026-11-05). Pass 1 `cr-technical-reviewer` **REVISE** on rev 1; all 18 findings
addressed in rev 2 (§8). Pass 2 `cr-signoff-pm` is pending. Owner decisions D1–D6 taken 2026-11-05 (§3).
**Depends on:** CR098 (budget builder: lines, policies, monthly split, stored rates, publish token)
**Roadmap anchor:** [project-roadmap.md#cr100](../current/project-roadmap.md#cr100)
**Deadline context:** the builder code freeze is **2026-12-03**, and the first 2027 publish is due **2026-12-10**
([status.md](../current/status.md)). This is the last builder change planned before that publish.

## 1. The ask

Some budget lines are a list of separate items, not a figure scaled from last year. The owner's example is
*Travel – Flights*: one row per trip, each placed in the month it is paid, some priced in PLN, some in USD or
EUR. Today the builder offers Recurring (estimate × inflation), One-off (0) or Fixed (one typed figure,
spread by a split). The trips have to be added up and converted by hand, outside Fin, and the list
is lost once the total is typed into the Fixed field.

The ask: a fourth input mode that opens a modal with this year's actual and budget for reference at
the top, and below it a grid of described rows by month, each in its own currency, summed into the
line's total.

## 2. What exists (read from the code, 2026-11-05, v3.84.1)

- A builder line is a **(category, currency)** pair (`budget_build_lines`, `currency CHAR(3)`, unique
  per build as `bbl_line_uniq`). A category spent in two currencies has two lines.
- `annualFor()` (synchronous, one line) gives a line's annual figure from its policy. It is called only
  from `getBuild`; `compareYear` reads through `getBuild`; `publish` stores the annual as `annual_amount`;
  restore and un-publish read the stored figures and never recompute.
- `computeCells()` splits the annual into account × month cells with `splitLine()`. The split goes
  **account first**: the annual is divided across accounts, then each account's share is divided across
  months with its own rounding (`allocate`). The annual is exact per account; **the month totals across
  accounts can drift by a cent or two.** Reproduced 2026-11-05: twelve cent-level month totals over 3 accounts came
  back off by `[0, +.01, 0, 0, +.01, −.01, 0, 0, −.02, 0, +.01, 0]`. **This also affects v3.84.0's monthly
  amounts** on any line spread over more than one account. Car – Lease has one account and is unaffected.
- A draft's FX comes from its scenario (`scenarioRates`); a published build reads its stored
  `published_rates` and stored cells. Rates are local-per-USD for `USD`, `PLN`, `EUR` only (`CURRENCIES`).
- **The publish token hashes every cell a publish would write** (`cellsHash`), so any edit that changes
  a figure invalidates an earlier preview.
- `budget_category_policy` remembers **one** row per category at publish (`rememberPolicies`, also run by
  restore; **not** by un-publish). `policyLines()` picks the line with the largest |LE full year| in USD.
  `createBuild()` applies that row to **every** currency line of the category, and when starting from a
  parent build it keeps a parent line missing from the new LE **only if it is Fixed** (the rest are reported as
  `dropped`).
- Profit-and-loss categories carry `accounts.account_type` = `expense` (136 on prod) or `income` (15).
- The reference data exists on the server: `previewPublish` returns each line's `priorActual` by
  month; `loadGrids()` loads this year's budget by month but does not send it. Both are lost when a rate is
  missing, because `split` is emptied (`missingRate`).
- `/budget-worksheet` is a different page (budget entry with a balance comparison). Hence the name
  *Itemised*, not *worksheet*.

## 3. Decisions (owner, 2026-11-05)

| # | Question | Decision |
|---|---|---|
| D1 | Where it lives | A **policy**, *Itemised*, beside Recurring · One-off · Fixed. It sets the annual figure as well as the months. |
| D2 | The category's lines in other currencies | **Set to One-off automatically** when the items are saved, and the page says which lines it changed. |
| D3 | Next year's draft | **Copies the rows as a starting point**, amounts included, on the same currency line; the other currency lines start as One-off. |
| D4 | What publish writes | **Totals, as now:** one budget entry per account and month. Item descriptions stay in the builder. |
| D5 | Name | **Itemised.** |
| D6 | A second line of the same category itemised | **Refused:** *already itemised on the PLN line; switch it first*. One Itemised line per category; a USD trip goes on that line as a USD row. |
| — | Budget-currency selector | **Not built.** The items total into the currency of the line they were opened from. |

## 4. Design

### 4.1 Storage (migration 088)

```sql
CREATE TABLE IF NOT EXISTS budget_build_line_items (
  id          SERIAL PRIMARY KEY,
  line_id     INTEGER NOT NULL REFERENCES budget_build_lines(id) ON DELETE CASCADE,
  position    SMALLINT NOT NULL,
  description VARCHAR(200) NOT NULL CHECK (btrim(description) <> ''),
  currency    CHAR(3) NOT NULL CHECK (currency IN ('USD', 'PLN', 'EUR')),
  months      NUMERIC(15,2)[] NOT NULL CHECK (
                cardinality(months) = 12 AND array_position(months, NULL) IS NULL
                AND (0 <= ALL(months) OR 0 >= ALL(months))),     -- stored SIGNED, one sign per row
  CONSTRAINT bbli_pos_uniq UNIQUE (line_id, position)
);
ALTER TABLE budget_build_lines     DROP CONSTRAINT IF EXISTS bbl_policy_chk;
ALTER TABLE budget_build_lines     ADD  CONSTRAINT bbl_policy_chk CHECK (policy IN ('recurring','one_off','fixed','itemised'));
ALTER TABLE budget_category_policy DROP CONSTRAINT IF EXISTS bcp_policy_chk;
ALTER TABLE budget_category_policy ADD  CONSTRAINT bcp_policy_chk CHECK (policy IN ('recurring','one_off','fixed','itemised'));
ALTER TABLE budget_category_policy
  ADD COLUMN IF NOT EXISTS items_line_id INTEGER REFERENCES budget_build_lines(id) ON DELETE SET NULL;
```

- The constraint names are the ones 084 created; 085 and 087 do not touch them. `'itemised'` fits `VARCHAR(12)`.
- Safe on prod before the code ships: it adds a new table and a nullable column, and only widens CHECKs.
- **Rollback:** drop the table and the column, then narrow both CHECKs. Narrowing fails while any line or
  policy is `itemised`, so set those to `fixed` first (at their itemised annual).
- The number is claimed by the `088` row in [migrations.md](../current/migrations.md), written with this revision.

`items_line_id` points at the itemised line of the **published** build. Published and superseded builds are
never deleted, so the rows stay readable for next year's copy without being stored twice.

### 4.2 Figures

**Sign: decided once, on the server, at save; stored signed.** The `PUT` receives amounts as typed.
Positives take the line's sign: the sign of its `le_fy`, else `−` for an `expense` category and `+` for
`income` (`accounts.account_type`). Negatives stay negative. **Every amount on a line must end up with one
sign**, and the save is refused otherwise, with the reason. The rows are then stored signed, so a copy or a
later read never re-signs them, even when next year's `le_fy` is 0 or has flipped.

**The annual is derived on every read, never stored** (except as a publish's `annual_amount`, as today).
For an Itemised line in currency *C*, with build rates *r* (local per USD):

```
month_m = round2( Σ_items item.months[m] × (item.currency = C ? 1 : r[C] / r[item.currency]) )
annual  = Σ_m month_m
```

- A same-currency item needs no rate (factor exactly 1).
- An item in a currency with no rate in the build makes the line's annual `null`.
- `getBuild` loads all of a build's items in **one query** and passes each line's items to `annualFor`,
  which stays synchronous. It also returns the twelve `itemMonths` for `computeCells`.
- A stored total would go stale when the scenario's FX changes. That is Fin's recurring defect class: state
  that exists, renders, and has no effect.

**The month split goes month first.** For a line with known month totals (Itemised, and the existing
*monthly* split), `splitLine` divides **each month's total across the accounts**:
`allocate(month_m, |account weights from actuals|)`. Month totals and the annual are then exact by
construction. An account's yearly share can now drift by a cent instead, which nobody reads.

This replaces the account-first path for `custom` too, so it also fixes the v3.84.0 drift (§2). The existing test
*each account keeps its share and the line sums exactly* is restated to assert month totals.

**Missing rate.** `previewPublish` and `publish` each send `noInflationMessage` for a `null` annual. Both get
an Itemised branch: *Travel – Flights has an item in GBP and the scenario has no GBP rate*. The reference rows
(§4.5) are computed outside `computed`, so they survive a missing rate, and the modal stays editable.

### 4.3 Endpoints and rules

`PUT /budget-builder/:id/lines/:lineId/items`, with body `{ items: [{ description, currency, months[12] }] }`. **Drafts only.**

- **Input:** only those three keys are read. `description` is trimmed, 1–200 characters. `currency` must be in
  `CURRENCIES`. `months` must be exactly 12 entries, each blank (→ 0) or a finite number with at most 2
  decimals. Non-numeric strings are refused, not coerced. At most **100 rows**, and at least one: *use One-off
  for nothing*. Every refusal is a 400 with its reason, never a database error falling through as a 500.
- **Refused** on a parent category (*put it on a sub-category*, the message the publish check already uses),
  and while **another line of the category is Itemised** (D6).
- **In one transaction:**
  - lock the build `FOR UPDATE`;
  - replace the line's rows (stored signed, §4.2);
  - set the line to `policy = 'itemised'` and reset `fixed_amount`, `inflation_pct`, `split_method = 'auto'`,
    `split_weights`, `split_month` to neutral, so no unused split sits under the line;
  - set every other currency line of the category to `one_off`, and clear `done` on the lines whose policy
    actually changed;
  - bump `updated_at`.
- **Returns** the build view plus `setOneOff: [{ lineId, currency }]`, listing only the lines that changed.

`PATCH /:id/lines/:lineId`:

- refuses `policy: 'itemised'` (rows only arrive through the `PUT`);
- on an Itemised line, refuses edits to the split and the Fixed amount;
- a policy other than `itemised` on an Itemised line **deletes its rows**. The page confirms first. Leaving
  for Fixed starts the Fixed amount at the itemised annual, not at `le_fy`, so nothing jumps.

`GET /:id` returns `items` on each Itemised line. `GET /:id/preview` adds, per line, `thisYearMonths` beside
`priorActual`, both computed outside the rate check.

### 4.4 Copies and memory

- **Start from** (a parent build): an Itemised line is copied **with its rows**. A parent Itemised line the
  new LE lacks is kept, as a Fixed one already is (`le_fy` 0, rows copied), not dropped. Otherwise the
  category would go to zero with only a *dropped* notice, because its siblings are One-off.
- **`policyLines()`** prefers a category's Itemised line over its siblings, whatever their estimates.
- **`rememberPolicies()`** writes `items_line_id` on every run: the Itemised line's id, or `NULL`. The
  `ON CONFLICT DO UPDATE` sets it from `EXCLUDED`, so a category later published as Recurring loses the
  pointer.
- **`createBuild()` without a parent:** for a category remembered as Itemised, the line in the
  `items_line_id` line's currency becomes Itemised with a copy of those rows (created with `le_fy` 0 if the
  new LE lacks it). The category's other lines start as **One-off**.
- **No line without rows is ever Itemised.** On either path, a remembered `itemised` applied to a line that
  receives no rows, including when `items_line_id` is `NULL`, becomes `one_off` on every line of the
  category. Creation then returns a notice, *Travel – Flights was itemised but its rows were not found*.
- **Un-publish** (CR098 gap, now material): `unpublish` re-runs `rememberPolicies` for the build that goes
  live again, so next year's draft does not copy rows from a withdrawn budget. When no build goes live
  again (the first publish undone), memory stays as the withdrawn publish left it. That is a stated
  limitation, as in CR098.

### 4.5 The page

- **Grid row:**
  - The policy dropdown gains *Itemised*. Choosing it opens the modal, and nothing is saved until Save.
  - The Fixed cell shows the derived annual, read-only, and the Months cell shows **Items (N)**.
  - On a parent-category line, Itemised is left out of the dropdown.
- **A sibling set to One-off by D2** shows a muted note, *itemised on the PLN line*. If it is switched back,
  the note becomes the flag *⚠ also itemised on the PLN line: counted twice*.
- **Modal** (the shared `Modal`):
  1. Header: category, line currency, and the build rates used.
  2. Reference: **Actual {LE year}** and **Budget {LE year}** by month for every currency line of the
     category, converted into the line currency **at the build's rates**, and labelled so (*converted at the
     2027 rates*). It will not match the Budget page to the cent.
  3. Grid: description · currency · Jan…Dec · row total (own currency) · row total (line currency). Rows can be
     added and deleted, and blank is zero. Amounts are shown signed, as stored.
  4. Footer: month totals and the annual in the line currency.
  5. Save / Cancel. A refusal is shown in the modal and the rows are kept.
- A published or superseded build shows the rows read-only.
- The modal's arithmetic (conversion, sign, totals) lives in a small pure module so Vitest can test it. The
  page must pass `check-modal-adoption.sh`, `check-inline-hex.sh` and `check-dead-tokens.sh`.

## 5. Verification

Server (`budgetBuilder.test.js`, dev DB):
1. Items in PLN, USD and EUR on a PLN line spread over **≥ 2 accounts with odd cents**: month totals and the
   annual equal the hand conversion at the build's rates, and the preview's months equal them **to the cent**.
2. The *monthly* split over ≥ 2 accounts gives month totals exactly as typed (the v3.84 drift, fixed).
3. A scenario FX change moves a draft's Itemised annual and leaves a published build's figures unchanged.
4. Saving items sets the category's other lines to One-off, clears their `done`, and reports only the lines
   that changed.
5. Refused, each with a 400 and a message:
   - mixed signs, a blank description, a description over 200 characters, an unknown currency, eleven
     months, a 3-decimal amount, a non-numeric string, 101 rows, or an empty list;
   - a parent category;
   - a second Itemised line in the same category (D6);
   - `PATCH policy:'itemised'`, and a split or Fixed edit on an Itemised line.
6. Leaving Itemised deletes the rows, and leaving for Fixed starts at the itemised annual. Deleting a draft
   cascades.
7. *Start from* copies the rows, and editing the copy leaves the parent unchanged. A parent Itemised line the
   new LE lacks is kept with its rows.
8. Publish, then a draft from a later LE: the remembered currency line is Itemised with the rows copied, and
   the sibling is One-off, **including when the sibling's estimate is larger**.
   - A remembered `itemised` with `items_line_id` NULL gives One-off and a notice.
   - A category republished as Recurring clears the pointer.
   - Un-publish re-points memory at the build that goes live again.
9. Rows stored signed survive a next-year `le_fy` of 0 and of the opposite sign.
10. An item currency with no rate: the preview and publish both name the currency, and the reference rows are still
    returned.
11. A preview token goes stale when an item amount changes.

Frontend (Vitest): the pure module's conversion, sign and totals, including **negative and positive input**.
Page: the modal walked on dev in **both themes**. v3.84.0 shipped a sign defect because the walk typed
positives only.

## 6. Non-goals

- **Per-item budget entries** (D4). If item names are wanted in budget-vs-actual later, that is its own CR,
  after the first publish has run once.
- Inflation on items. Rows are typed for the target year.
- Currencies beyond USD, PLN and EUR.
- Itemising outside the builder (the official budget, the LE).

## 7. Phasing and cost

One phase, **P1**: migration 088, §4.2–4.4 (including the month-first split), the two endpoints, the modal.
Estimated at two sessions. **Target: on prod by 2026-11-20**, leaving two weeks before the 2026-12-03 freeze.
If it cannot ship by the freeze, it waits until after the 2027 publish; it does not go in late. The
month-first split fix (§4.2) could ship on its own first if P1 slips, because it corrects v3.84.0's figures.

## 8. Review log

**Pass 1 — `cr-technical-reviewer`, rev 1 (2026-11-05): REVISE**, with 4 blocking, 10 should-fix and 4 nit
findings. All 18 are addressed in rev 2:

- **Blocking:**
  - #1 month totals not exact over several accounts: reproduced, and §2 was wrong. Fixed by the month-first
    split, §4.2, which also fixes v3.84.0.
  - #2 a second Itemised line deletes the first one's rows: owner decision **D6, refuse**.
  - #3 *Start from* drops an Itemised line, or creates one with no rows: §4.4.
  - #4 sign undefined, so copied rows could flip: stored signed at save, with the fallback from
    `account_type` and a per-row CHECK, §4.1 and §4.2.
- **Should-fix:**
  - #5 pointer never cleared, and #6 a NULL pointer: §4.4.
  - #7 un-publish leaves memory stale: §4.4.
  - #8 PATCH rules: §4.3.
  - #9 input validation: §4.3.
  - #10 the missing-rate message in two places, and the reference rows lost with it: §4.2 and §4.3.
  - #11 `done` on swept siblings: §4.3.
  - #12 parent categories: §4.3 and §4.5.
  - #13 migration housekeeping: §4.1, with the migrations.md row.
  - #14 tests: §5.
- **Nits:**
  - #15 annual derived on read: confirmed, with the one-query load noted in §4.2.
  - #16 same-currency factor: §4.2.
  - #17 reference conversion: labelled, §4.5.
  - #18 the `/budget-worksheet` naming fact: verified by the author against `routes.jsx`.

*(Pass 2 `cr-signoff-pm`: pending)*
