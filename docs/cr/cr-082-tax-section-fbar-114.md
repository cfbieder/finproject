# CR082 — A Taxes section, first form: FinCEN Form 114 (FBAR) — ✅ COMPLETE (2026-08-16)

> **Every phase built and every open item closed — [§11c](#11c-the-remaining-items-closed-2026-08-16).**
> **Everything is on prod as of 2026-08-16** — P0b–P3 earlier that day, then the final increment
> (P0a, migration **071**, the carry-in guard, freeze-on-file, TY2024-as-filed, XLSX and the Part I
> filer block), with **071 applied to prod before the code** by the deploy script's Step 2b.
> Verified against the running API afterwards: `/util/coa-traits` serves **no** full account number
> for any of its 230 accounts, TY2024 reads `filed` with 31 lines, and TY2025 still reports 16 lines
> at **$2,627,821** with nothing outstanding.

Roadmap anchor: [project-roadmap.md#cr082](../current/project-roadmap.md#cr082). **Track: v3** —
no flags, no tenant context, nothing under `server/src/v2/db/`.
**Depends on:** [CR012](cr-012-opening-balance-calibration.md) (`opening_balance + SUM(transactions)`)
· [CR013](cr-013-collapse-categories.md) (one COA) ·
[CR023](cr-023-pocketsmith-removal.md) / [CR080](cr-080-feed-accrual-reconcile-mode.md) (the
reconcile modes that **retroactively rewrite** the history this reports — §6).
**Nothing here is forecast-facing.** No forecast number moves.

> ⏱ **TARGET: TY2025, due 2026-10-15** (owner on the automatic extension, confirmed 2026-08-15).
> **61 days.** This is not a park-until-April CR — see §9 for what that does to the phasing.

> **Revised 2026-08-15 after a two-pass review — both passes returned *revise*, and the technical
> pass falsified four of this CR's own load-bearing numbers.** Every correction is recorded in
> §12 rather than quietly patched, because the largest of them is **this CR committing, in §5, the
> exact failure its own §4 was written to prevent.**

## 0. Three corrections to the request, before the design

The request is sound and the feature is worth building. Three of its premises are not, and each
changes what gets built:

1. **It is FinCEN, not FINRA, and not the IRS.** Form 114 is the *Report of Foreign Bank and
   Financial Accounts* (FBAR), filed with **FinCEN** through BSA E-Filing — a Treasury bureau,
   separate from the IRS filing. It is **not** attached to the 1040. Due **April 15** with an
   **automatic** extension to **October 15** (nothing to request). The IRS-side sibling is
   **Form 8938**, filed *with* the return, on different thresholds and a partly different account
   population.
2. **Form 114 does not ask for a year-end balance.** Part II item 15 asks one thing: *maximum value
   of the account during the calendar year*. There is no year-end field. We still compute year-end
   — it is nearly free, it is what Form 8938 and a preparer want next, and it is the cheapest
   sanity check on the max — but labelled **supporting**, or the export teaches the wrong thing
   every year.
3. **"Foreign" is not a currency.** It is where the *institution* sits. `Wise - USD` (8) is a
   USD-denominated account at a foreign institution and is reportable; a EUR-denominated Spanish
   *property* is not an account at all. Explicit per-account designation; currency is a hint the
   owner confirms, never a filter.

**And one confirmation: Fintable carries no account numbers.** `bank-feed/contracts/v1/README.md`
lines 73–84 — the `Account` resource is `{id, connection_id, external_id, name, currency, type,
owner_app}`, no mask, no IBAN, no `official_name`; neither converter adds one; `bankfeed_balances.raw`
is **NULL on all 2,120 rows**. The only institution datum is `institution_name` on the *Connection*
— per-feed, no address. Account numbers are entered by hand, once, and remembered.

## 1. Problem

Every year the same reconstruction happens outside the app. Fin holds **29 years of transactions**
(1998–2026), daily FX back to 1999-12-30, and per-account opening balances — every input the form
needs, in none of the shapes it wants. The account numbers are not in the app at all: **3 of 57**
asset accounts have `accounts.account_number` populated.

The year-to-year memory is the value. The account list, the numbers, the institution addresses and
the joint/signature status change almost never; the balances change every year.

## 2. What Form 114 needs

Per account (Part II own · Part III joint · Part IV signature authority only):

| Field | Source |
|---|---|
| Maximum value during the calendar year, **USD** | computed (§5) |
| "Maximum account value unknown" checkbox | manual, per account-year |
| Account number *or other designation* | **manual, remembered** |
| Type: bank / securities / other *(+ description)* | manual, remembered |
| Financial institution name | manual (feed gives `institution_name` per *connection* only) |
| Institution street, city, state/province, postal, **country code** | **manual, remembered** |
| Jointly owned + co-owner name/TIN/address | manual, remembered |

That is the **whole** per-account field set — verified 2026-08-15 against the filed TY2024
form (Part III record blocks, `Client Copy 2024 …pdf` p.7): items 15/15a, 16, 17, 18, 19–23,
24–33 and nothing else. In particular there is **no "account opened during the year" and no
"account closed during the year" checkbox** on FinCEN 114 — those are **Form 8938** fields, which
is why they appear on the preparer's request sheet (§12.4).

Plus **Part I filer info** — name, **TIN**, **DOB**, address, filing capacity — constant, stored once.

Three rules that are computation, not data entry:

- **The $10,000 aggregate test.** If the *combined* maximum exceeds $10,000 at any time in the
  year, **every** account is reported, including a €50 one. The page states the aggregate and the
  verdict.
- **Conversion uses the Treasury year-end rate** — the *Treasury Reporting Rates of Exchange* for
  **December 31** of the reported year, applied to the maximum, **not** the rate on the day the
  maximum occurred. §4.
- **Maximums round UP** to the next whole dollar; a **negative maximum reports 0**.

## 3. Design — the data

One migration, **070** (068 retired, 069 last applied — [migrations.md](../current/migrations.md)).

**`accounts.account_number` is reused for ledger-backed accounts, not duplicated.** The column
exists (migration 001) and is already round-tripped by the COA editor
(`server/src/v2/routes/util/coa.js:101,119,155,186`).

**A reportable line is not always a fin account.** FBAR reports *accounts*, not equity interests: a
financial interest in `Barkeria Sp. z o.o.` puts **Barkeria's own bank accounts** on the form — not
the 4,811,201 PLN carrying value fin holds for the holding. Fin does not model those and never
should. Same for any Part IV signature-authority account. So `tax_foreign_accounts` carries its own
key and a **nullable** `account_id`: NULL ⇒ a **report-only line** with no ledger behind it,
nothing computed, a typed maximum.

```
tax_foreign_accounts
  id                   SERIAL PK
  account_id           FK accounts(id) NULL UNIQUE ON DELETE RESTRICT
  label                TEXT NOT NULL
  review_state         'unreviewed' | 'reportable' | 'excluded'   NOT NULL DEFAULT 'unreviewed'
  fbar_part            'II' | 'III' | 'IV'
  account_kind         'bank' | 'securities' | 'other'
  account_kind_other   TEXT
  own_account_number   TEXT          -- report-only lines ONLY; NULL when account_id is set
  own_currency         CHAR(3)       -- ditto; the tax_fx_rates key for a typed maximum
  institution_name / _street / _city / _region / _postal   TEXT
  institution_country  CHAR(2)
  joint_owner_name / _tin / _address                       TEXT
  notes                TEXT, created_at, updated_at
  CHECK (account_id IS NULL) = (own_currency IS NOT NULL)   -- exactly one source, never both
  CHECK (account_id IS NOT NULL OR own_account_number IS NOT NULL)

tax_fx_rates
  tax_year, currency   PK
  rate_to_usd   NUMERIC(15,6) NOT NULL CHECK (rate_to_usd > 0)   -- USD per 1 unit of currency
  source        TEXT NOT NULL     -- 'treasury' | 'frankfurter-prefill' | 'manual'
  note          TEXT

tax_fbar_filings
  id SERIAL PK, tax_year INT NOT NULL CHECK (tax_year BETWEEN 1998 AND 2100),
  amendment_seq INT NOT NULL DEFAULT 0,
  status 'draft' | 'filed' NOT NULL DEFAULT 'draft',
  filed_on DATE, filed_note TEXT, created_at,
  UNIQUE (tax_year, amendment_seq)

tax_fbar_filing_lines
  id SERIAL PK, filing_id FK ON DELETE CASCADE,
  tax_foreign_account_id FK NULL ON DELETE SET NULL,        -- soft ref; the line stands alone
  label, account_number, institution_name, institution_country,   -- COPIED, not joined
  fbar_part, account_kind, currency,
  max_value_native NUMERIC(15,2), year_end_native NUMERIC(15,2),
  fx_rate_used NUMERIC(15,6), fx_rate_source TEXT,
  max_value_usd NUMERIC(15,2), year_end_usd NUMERIC(15,2),
  max_unknown BOOL, closed_during_year BOOL,
  manual_value_native NUMERIC(15,2), manual_reason TEXT
```

All pseudo-enums are **VARCHAR + CHECK**, not Postgres enums — `accounts.account_type` is a real
enum and altering one is the migration this repo least wants to repeat.

**`review_state` is tri-state, not a boolean.** A boolean makes "deliberately excluded" and "nobody
has looked at this yet" indistinguishable — the defect [CR066](cr-066-fc-line-mapping-completeness.md)
exists to fix one floor down. Across 57 accounts, tri-state lets the review list reach zero and
makes next year's pass a diff rather than a re-read.

**`UNIQUE (account_id)` over a nullable column is deliberate and is the *opposite* of migration
057's case.** Postgres treats NULLs as distinct, which here permits **many** report-only lines while
allowing at most one designation per real account — the rule wanted. 057 added
`idx_fc_streams_unique_nullline` because *there* the NULL branch needed constraining. Flagged so a
later reader does not "fix" it into a partial index that would forbid a second report-only line.
Two report-only lines for the same real-world account are **not** prevented; that is the owner's
problem and is stated rather than silently permitted.

**`tax_fx_rates` is separate from `exchange_rates`** because that table's
`UNIQUE (from_currency, to_currency, rate_date)` means a `source='treasury'` row would have to
*replace* the frankfurter row for that date — corrupting a series the budget and the whole balance
sheet read.

**Filer info (Part I)** goes in `app_data` under one key. It carries a **TIN and DOB** and gets
**the same treatment as an account number** (§7) — that is not optional and was missed in the first
draft.

**Migration 070 is additive DDL only.** No data writes: the FX prefill is an **app action**, not a
migration insert. A `SELECT … FROM exchange_rates` inside 070 would be data-dependent, vacuous on
CI's empty database, and configuration in a migration — the reasoning that withdrew
[migration 068](../current/migrations.md). Post-conditions are **structural only** (Known Issue #12).

## 4. FX — the direction is a trap

`exchange_rates` stores **USD per unit of foreign currency**: EUR 1.175005, GBP 1.346547,
PLN 0.278373 at 2025-12-31. **Treasury publishes the reciprocal — foreign currency per USD** (its
EUR figure for the same date is ≈0.85).

PLN is safe by magnitude (0.278 against ≈3.59 — a 13× gap nobody misses). **EUR and GBP are not:**
both directions are plausible numbers of the same order, and pasting the wrong one moves the
maximum by ~38%, in the direction that under-reports. `rate_to_usd` names the direction in the
column and nothing enforces it.

Therefore: the input field **states the direction** (“USD per 1 EUR”), shows the frankfurter prefill
beside it, and a **plausibility gate refuses a pasted rate that differs from the prefill beyond a
tolerance** rather than accepting it silently. Rates are written with
`source='frankfurter-prefill'` and rendered with a visible *not the Treasury rate* marker until the
owner pastes the real figure (published each January at fiscal.treasury.gov) and the source flips to
`'treasury'`. **The export prints the rate and its source on every line.**

## 5. Computation — three ways to get it wrong, all three found in this CR's own draft

The native-currency balance model, taken **with its floor** from
`server/src/v2/services/openingBalanceWindow.js:36-37,52-63`:

```
balance(account, D) = opening_balance
                    + Σ transactions.amount
                      WHERE account_id = <account>
                        AND transaction_date >= opening_balance_date   ← the floor
                        AND transaction_date <= D
```

Note `account_id`, **not** `category_id`: `getBalances`
(`server/src/v2/repositories/accounts.js:211-240`) joins `t.category_id = a.id`, sums `base_amount`
(USD), and filters `is_active` — wrong on all three counts here. **The floor is not optional.**
`openingBalanceWindow.js` exists *because* this sum was copied three times unbounded, and its header
records `Chase Checking` displaying 1,950.61 under the feed it had just reconciled to. Latent today
(every `opening_balance_date` is 1990-01-01, 0 rows below any sentinel) but `calibrate()` can move a
sentinel. **This CR lifts `sumWithinBalanceWindow` / `BALANCE_WINDOW_FLOOR_SQL` rather than writing
the fourth copy.**

### 5.1 End-of-day, never a row-ordered running sum

Verified on prod, account `PKO` (18), 2025:

| method | max (PLN) | at 0.278373 |
|---|---:|---:|
| **end-of-day (correct)** | **631,678.72** | **$175,842** |
| running sum `ORDER BY (date, id)` — what `findLedgerWithRunningBalance` does | 793,547.72 | $220,902 |
| running sum `ORDER BY (date, amount DESC)` | 4,393,629.03 | $1,223,068 |

2025-06-23 saw **4,294,000.00 PLN in and out, net 0.00**. Transactions carry a `date`, not a
timestamp, so intra-day order **is not information we hold** — and the table is the proof: the naive
answer is not one wrong number but a *range* selected by an arbitrary tie-break, from +$45,060 to
+$1,047,226 of maximum that never existed. `findLedgerWithRunningBalance`
(`server/src/v2/repositories/transactions.js:228-254`) is what the next implementer will reach for;
it orders `(transaction_date, id)` at `:251` and has no sentinel floor. The repo already knows this
shape — `server/src/v2/services/incomeRestatement.js:339` orders a transfer leg first so the
Ledger's same-day running balance never displays a phantom.

**The compliance argument, not just the data one:** FinCEN directs filers to *periodic account
statement* values, which are end-of-day figures. Worth stating because a preparer will ask whether
an intra-day peak existed on 2025-06-23, and "the instructions don't ask for one" is a better answer
than "we have no timestamps".

**⚠️ It is not one account. A SECOND live instance surfaced the moment the engine ran (2026-08-15),
and on an account that was actually filed:**

```
WISE - GBP (24), 2025-10-25:  +1,065.00  "Moved From EUR"
                              −1,061.32  "Sent Christopher Franz Biedermann"
                                 net +3.68
```

Row-ordered, `WISE - GBP`'s 2025 maximum reads **1,065.00**; end-of-day it is **3.68** — a **289×**
overstatement on a two-transaction account, and the ledger holds *nothing else all year*. `PKO` was
the loud case (a 4.29M same-day round trip); this is the quiet one, and it is the more instructive
of the two: the pattern is **a transfer landing and leaving on the same day**, which is ordinary
behaviour for exactly the multi-currency accounts an FBAR reports. `Caixa EUR` moved too
(25,770.96 → 25,732.27). Assume it is present wherever money is moved between currencies, not that
it is a `PKO` peculiarity.

### 5.2 The maximum includes the January 1 carry-in

A max taken only over days that *have* a transaction in the year is wrong whenever the account was
drained. Verified on prod for 2025 — **12 accounts** carry in above their in-year maximum:

| account | in-year max | carry-in at 2024-12-31 |
|---|---:|---:|
| `Wise - USD` (8) — **this CR's own flagship reportable example** | 1,552.20 | **1,718.27** |
| `United Beverages` (PLN) | 27,642,000.00 | **30,425,000.00** |
| `SP - Panorama Mar 4` (EUR) | 390,035.00 | **474,494.77** |

Eight more (`PL - Niemena` 4,287,465.44, `US - Casarina` 919,581.00, …) have **zero** 2025
transactions, so an in-year max returns **NULL** — which §10 forbids rendering as 0.

```
max(account, Y) = MAX( balance(account, Dec-31 of Y−1),
                       max over end-of-day balances on transaction days in Y )
```

Year-end is the end-of-day balance at Dec 31, carried forward when no transaction falls on it.

### 5.3 A native sum must refuse cross-currency rows

Verified on prod: three balance-sheet accounts hold rows whose `transactions.currency` ≠ the account
currency — including **`CVC Fund IX` (34, EUR)**, which §8.2 names as a candidate: one USD row,
`id 2709883`, 41,564.86, dated 2026-07-31. `Σ amount` would add it straight into a EUR total. This
is the CR037 `amount`/`base_amount` class. **Rule: the engine refuses to report a maximum for any
account holding a row in a currency other than its own**, names the rows, and the account becomes
"needs a figure". Covered by a test.

### 5.4 Accounts whose value is not their ledger cash balance

`PKO TFI` (Polish mutual fund) and `CVC Fund VIII`/`IX` (EUR private-equity interests) report
*market value*, which fin holds — where at all — in `security_lots` / `security_prices`, on a
different footing. These render **"needs a figure"** with `manual_value_native` + `manual_reason`.
**Report-only lines** (`account_id IS NULL`) are the same path with computation never attempted.

**The engine must never treat a missing ledger, a NULL max, or a refused account as a zero balance.**
A silent 0 on a reportable account is the worst output this feature can produce, because it looks
like an answer.

## 6. History is not stable, so a filed year is frozen

**A balance computed for 2025 today is not the balance computed for 2025 last January.**
`calibrate()` (`reconcileToFeed.js:566-604`) rewrites `accounts.opening_balance` — one constant
across **every** historical date — via a bare `UPDATE accounts SET opening_balance = $2 WHERE
id = $1`. It writes **no audit row at all**, and still does not: the only `audit_log` writer in the
repo is `aiReview.js:772`. Migration
[069](../../server/db/migrations/069_wise_calibration_plug_not_a_loss.sql) is the case study —
months of owner calibrations dragged history, and 065 misread the residue as an unrealized loss.
`mtm` and `accrue` compound it from the other side with **back-dated** month-end plug rows.

All correct for a ledger. All fatal to a number that must never move once filed.

**Therefore the filing is frozen, not recomputed.** Marking a year filed copies every figure —
including account number and institution name, **copied rather than joined**, so a later rename
cannot rewrite what was filed. Reopening shows **filed vs recomputed side by side** with deltas, and
never overwrites. `(tax_year, amendment_seq)` rather than `tax_year UNIQUE`, because an amended FBAR
is a second filing for the same year.

The diff shows **what** changed. It cannot show **why**, because `calibrate()` leaves no trace —
stated plainly rather than promised away. Giving `calibrate()` an `audit_log` row is small and
serves the reconcile pages too; it is noted in §11 as adjacent work, not claimed here.

**A draft year needs the same store.** `max_unknown`, `closed_during_year` and the typed override
are per-account-**year**, so a `draft` filing row plus lines is materialised on first view of a
year; freezing flips `status` and re-copies. Without this, P2 has nowhere to put a typed figure.

## 7. Design — the surface

New nav category **`Taxes`** in `frontend/src/config/routes.jsx` (`CATEGORY_META:75` is the
established pattern; a landing page comes free).

- **`/tax/foreign-accounts`** — the designation screen. Every leaf asset/liability account **plus
  report-only lines**, with a *suggested* foreign flag (non-USD, or an institution already marked
  foreign) that the owner confirms. Inline edit of number, institution block, Part II/III/IV,
  joint owner. **Year-scoped, and NOT filtered by `is_active`:** you prepare a year's FBAR in a
  later year, and an account open during 2025 but closed in 2026 must still appear, with the box
  checked. A present-tense active-only list would quietly drop exactly the accounts most likely to
  be missed.
- **`/tax/fbar`** — year selector, account table, **aggregate + $10,000 verdict**, FX rates in force
  with source, per-line max/year-end native and USD, "needs a figure" rows called out,
  draft/filed state, and a `SELECT DISTINCT institution_country` line for **Schedule B Part III**
  (one row of output, one lookup saved every April — not a form, not a page).
- **Exports** — **XLSX** via `frontend/src/utils/excelExporter.js` (`xlsx@0.18.5` already a
  dependency) and a **print-stylesheet PDF**, which needs no library. Both are transcription
  worksheets and say so. **Explicitly not a filable Form 114** — FinCEN's own is an Adobe-only XFA
  form standard tooling cannot fill, and a look-alike would look official while being worth exactly
  what the worksheet is worth. BSA batch XML deferred: built for volume filers, and a rejection
  cannot be tested without filing for real.
  ⚠️ `excelExporter.js:64-67` — `formatNum` returns **`0`** for anything non-finite. Reused as-is, a
  "needs a figure" line exports as `0`, the one output §10 forbids. This sheet needs its own
  formatter plus a pre-flight refusal.

### 7.1 Account numbers — and a claim the review falsified

**Decision (owner, 2026-08-15): store the FULL number.** A partial would still be completed at
filing time from somewhere else, which is the retyping this CR exists to end. **The value lives in
Postgres and nowhere else** — `accounts.account_number` for ledger-backed accounts,
`tax_foreign_accounts.own_account_number` for report-only lines. It goes in **no document**:
[secrets-inventory.md](../current/secrets-inventory.md) gets a **location-only** row naming the
tables and columns, per that file's standing rule (*names and locations, never values*).

**⚠️ "Masked in the UI by default" was false as drafted, and the fix is a prerequisite, not a
mitigation.** `GET /api/v2/util/coa-traits` (`routes/util/coa.js:24-31` →
`repositories/accounts.js:503-518`) already returns `AccountNumber` for **every active account**, and
`frontend/src/features/COAManagement/COATreeRow.jsx:78` renders it as a plain column. So the numbers
would be served in plaintext to any unauthenticated caller the day they go in, and §10's
"appears in no log line" test would pass while the API served the whole set. P1 must close that
endpoint and that column **before** any number is entered. `server/src/scripts/seedAccounts.js:179-186`
writes numbers from `coa_traits.json` — not in the repo today (verified), and it must stay that way
(the CR039 shape).

Masking, no-logs, no-`audit_log`, no-diagnostic-dump apply equally to the **Part I TIN and DOB** in
`app_data`.

**The app is unauthenticated, and this CR is what puts foreign account numbers, a TIN and a DOB
into it.** The mitigation cannot be a sentence inside the CR that creates the exposure: nginx
basic-auth in front of Fin is **its own tracked roadmap item, landing before or with P1** —
independent of [CR027](cr-027-multi-tenancy-final-release.md)'s real auth. One thing to verify first:
that no non-browser caller (fin's feed cron, any bank-feed callback) traverses nginx, or basic auth
breaks ingestion.

## 8. What only the owner can decide

Tax-position questions the app records rather than infers. **None blocks the build** — report-only
lines and the typed-override path hold every shape they can take.

1. **The Polish operating companies** — `Barkeria`, `OCME`, `United Beverages`, `CVC - MIP`. A
   >50%-owned foreign corporation's own bank accounts are reportable as a financial interest. The
   fin holdings themselves default `excluded`: the equity interest is not the account.
2. ~~**`CVC Fund VIII` / `IX` / `PKO TFI`**~~ — **ANSWERED 2026-08-15** by the preparer's own
   request sheet (`Samples/Tax/`, gitignored): *"Foreign hedge funds and private equity funds are
   **not** reportable on the FBAR"*, while *"mutual funds or similar pooled funds"* are. So the two
   **CVC funds are OUT** and **`PKO TFI` is IN** — and `PKO TFI` was **missing from the 2024
   filing**.
3. **`PKO Visa Gold` / `Infinity` cards** — a personal credit card is normally not a reportable
   financial account. Default `excluded`, visible and reversible.
4. **Which accounts are Part III (joint).**
5. **Signature authority over accounts not in fin at all** — employer or company accounts, Part IV.
   The most commonly missed FBAR category, and now the report-only line's main job.
6. **Whether a spouse files separately or is covered by Form 114a** — the design assumes Part III
   joint accounts on the owner's own report, which is right unless a 114a is in play.

## 9. Phases — compressed for 2026-10-15

61 days. The freeze **ships with the report**, not after it: you can file by transcribing from the
browser, so the export is the convenience and the freeze is the only thing that makes filed figures
recoverable. P2 shipping without it means one `calibrate()` run destroys what was filed.

| Phase | Content | By |
|---|---|---|
| **P0** | nginx basic-auth in front of Fin (own roadmap item, verify no non-browser caller traverses it) | before P1 |
| **P1** | Migration 070; `/tax/foreign-accounts` incl. report-only lines; `Taxes` nav; filer info; FX prefill as an app action; **close the `coa-traits` number leak** | early Sept |
| **P2** | End-of-day max engine (§5.1–5.4) + `/tax/fbar` + aggregate/$10k verdict + **freeze-on-file and the filed-vs-recomputed diff** | late Sept |
| **P3** | XLSX + print-PDF export | early Oct |

**Seed TY2024 as `status='filed'` with hand-typed lines** from last year's actual filing. Same
manual path P1 already builds, no new code — and it turns P2's first run into a **verification
against a known-good output** instead of a leap of faith. On a form where being wrong carries
penalties this is the cheapest correctness gate available.

**P1 alone is not a shippable unit for this season** — it is an evening of data entry with the
payoff deferred and sensitive numbers sitting in the app. **P1+P2 is the unit.**

**Live caveat on P2's numbers, not a dependency:** [CR059](cr-059-fintable-api-ingestion.md) P3a is
Revolut transaction *attribution* — rows filed under the wrong account, which is exactly the input
to a per-account maximum. Exposure is limited (the accounts here are PKO and Wise, not Revolut) and
the ledger is in its best state since §22 closed 2026-08-12 with all 42 duplicate candidates
verified genuine.

## 10. Gates

- **End-of-day vs both row orderings**, on a **fixture the test builds itself** — an account with a
  day carrying equal in and out, plus rows whose `id` order and `amount` order disagree.
  `server/db/ci-seed.sql` is 34 lines with four P&L accounts and **zero transactions**, so a gate
  asserting a prod figure for account 18 cannot run in CI at all — the class
  `Scripts/test-fresh-db.sh` was written for, and the one that cost five red mains. The prod figure
  (631,678.72) stays as a one-off verification note, not a test.
- **The carry-in**: an account with zero in-year transactions reports its Dec-31-prior balance, not
  NULL and not 0. `Wise - USD` 2025 = 1,718.27, not 1,552.20.
- **The floor**: a row dated before `opening_balance_date` is excluded.
- **Cross-currency refusal** (§5.3) — `CVC Fund IX` refuses and names row 2709883.
- Year-end on a date with no transaction = last prior end-of-day balance.
- Negative maximum reports **0**; maximums round **up**; the aggregate sums **unrounded** natives.
- **The $10,000 verdict refuses to render when any reportable line lacks a figure.** A "no filing
  required" verdict computed with report-only lines silently absent is the "looks like an answer"
  failure one level up, and the more dangerous level.
- A report-only line with no typed maximum refuses to export and never renders as 0.
- No `tax_fx_rates` row for a currency+year ⇒ **refuses to export**. A pasted rate beyond tolerance
  of the prefill is refused (§4).
- A filed year is byte-stable across a `calibrate()` run on one of its accounts.
- The full number appears in no log line, error, `audit_log` payload, diagnostic dump, **or API
  response to an unauthenticated caller** (§7.1) — asserted by tests.
- Migration 070 applies clean on the full chain against empty Postgres + `ci-seed.sql`, is
  idempotent, post-conditions **structural only**.
- Primitives: `components/DataTable/DataTable.jsx` and `components/Modal/` (CR042) —
  `Scripts/check-modal-adoption.sh` fails the build on a bespoke `role="dialog"`. New endpoints use
  `Rest.unwrap()`; `check-api-envelope.sh` may only shrink. Note the neighbour `/util/coa-traits`
  (`coa.js:27`) is bare — not the pattern to copy.

## 11. Out of scope

Form 8938 (FATCA), Schedule B beyond the country list, PFIC/Form 8621, foreign tax credit, BSA batch
XML, filling the official 114 PDF, e-filing.

> **⚠️ 8938 is not hypothetical: the preparer's TY2024 sheet answers *"Does the taxpayer have an
> 8938 Filing Requirement?"* with YES.** It stays out of CR082 — different form, different
> population, and widening now would put the October date at risk — but the `Taxes` section has a
> known second occupant, and two facts should be carried forward rather than rediscovered:
> **8938 reports the equity interest in the Polish companies itself**, which §3 correctly says is
> *not* an FBAR account (`W.C. Holdings Ltd.` shares appear on the 2024 sheet for exactly that
> reason); and the **private-equity exclusion is FBAR-only** — the CVC funds drop off the FBAR
> under §8.2 and may well be 8938 items. Do not generalise the report-only line when 8938 arrives.

**⚠️ Corrected 2026-08-15, and the correction is the more useful finding.** This section first
claimed the preparer used the Treasury rate and that our ECB series sat **3.4%** away from it. That
was **inferred from a difference, never checked against Treasury** — a plausible number asserted as
authoritative, in the section written to forbid exactly that. Checked against Treasury's Fiscal
Data API:

| TY2024 PLN → USD | | |
|---|---:|---|
| Treasury, 31 Dec 2024 (4.108/USD) | **0.243427** | the mandated rate |
| our ECB series | 0.243019 | **0.17% away** — a good approximation |
| the preparer's, recovered from two filed lines | 0.251257 | **3.2% away** — the outlier |

**The preparer used Treasury's 31 MARCH 2024 rate (3.982 → 0.251130), not 31 December.** FBAR
requires the last day of the calendar year, so every PLN line on the TY2024 return was converted
~3.2% high — roughly **$30,000 of over-reported maximum**. Not a penalty exposure, but wrong, and
it will recur if it is baked into their process.

**What survives:** replace the prefill before filing — but for *citation*, not because it is
materially wrong. The expensive error is the **date**, not the source. (The round-UP rule is still
confirmed by the same pair: 10,000 × 0.2512571 = 2,512.571, filed as 2,513.) Adjacent and **not claimed here**: giving `calibrate()`
an `audit_log` row (§6). Carry forward one thing: **8938 reports the equity interest in `Barkeria`
itself**, precisely what §3 says is *not* an FBAR account — the report-only abstraction is
FBAR-shaped, do not generalise it when 8938 arrives.

`xlsx@0.18.5` (`frontend/package.json:32`) is the last npm-published line and carries unfixed
prototype-pollution/ReDoS advisories. Not this CR's doing, but "no new library" is claimed as a
virtue on a sheet that will carry foreign account numbers — worth one sentence, and a look at
`xlsx` sourced from its own CDN if this stays.

## 11a. Built 2026-08-15 (overnight) — P2 engine first, ahead of P1

> **Superseded by [§11b](#11b-shipped-to-prod-2026-08-16).** This is the build log as it
> stood on 2026-08-15 and still says "not deployed", "11 endpoints" and "prod still has no
> `tax_*` tables". All three were true that night and none is true now.

Built out of order, deliberately: the accountant needs **numbers** by 2026-08-16, and the numbers
need no account numbers, no designation screen and therefore no P0. The security prerequisite
still gates P1 and has not been touched.

| Shipped (dev + a from-scratch DB, **not** deployed, **not** committed) | |
|---|---|
| `server/src/v2/services/fbarMaxValue.js` | the §5 engine — end-of-day, carry-in, floor, cross-currency refusal, round-up |
| `server/src/v2/services/__tests__/fbarMaxValue.test.js` | **10 tests, all §10 gates**, on a fixture the suite builds itself |
| `server/db/migrations/070_tax_fbar_schema.sql` | the four tables. Additive DDL, no data, structural post-conditions |
| `Scripts/fbar-worksheet.js` | read-only working papers for a year — the pre-UI form of P2 |

**Verified, not asserted.** 928 backend tests pass (918 + 10). Migration 070 applies clean on the
**full 070-file chain against an empty Postgres + `ci-seed.sql`** via `Scripts/test-fresh-db.sh`,
its `DO` block emits its NOTICE, and it is **idempotent by measurement** — applied twice, still 4
tables and 21 columns. The scratch database was removed. `PKO` 2025 reproduces at **631,678.72 on
2025-12-23** through the engine, matching the independent SQL that found it, and `Wise - USD`
reports its **carry-in** of 1,718.27 — the two figures whose absence falsified the first draft.

**⚠️ Migration 070 has NOT been applied to dev.** Dev's ledger is behind prod by 065–067/069
(applied prod-first; `sync-db-prod-to-dev.sh` resolves it), so `migrate.js` there reports **five**
pending files and running it would drag those four along. Applying 070 by hand with `psql` is the
one thing migration 057's row warns against. **Resolve the ledger first, then migrate.**

### Continued the same day — P0b, P1 and P2 built

| Also shipped (dev, **not deployed**) | |
|---|---|
| `docker-compose.yml` · `docker-compose.dev.yml` · `vite.config.js` | **P0b** — every fin port off the LAN |
| `server/src/v2/services/fbarReport.js` | assembles a year: designations × engine × rates |
| `server/src/v2/routes/tax.js` | 11 endpoints, all enveloped |
| `Scripts/seed-fbar-designations.js` | seeds from last year's papers |
| `frontend/src/pages/TaxForeignAccounts.jsx` · `TaxFbar.jsx` | the two pages + `Taxes` nav |

**P0b was bigger than "add auth", because the first plan would not have worked.**
`curl http://192.168.1.87:3005/api/v2/util/coa-traits` returned **230 accounts, each with an
`AccountNumber`**, unauthenticated — a request that never touches nginx, so proxy auth would have
read as a fix while changing nothing. Then the same shape twice more: the **UI** published
`3006`/`5175` on every interface, so closing the API alone left the whole app open; and **dev** was
wide open on `3105`/`5174` while `sync-db-prod-to-dev.sh` was about to copy all of prod into it —
and closing dev's API alone would still have leaked, because Vite *proxies* `/api`. Everything is
now loopback, with the UI on the tailnet via `tailscale serve`. Owner chose Tailscale device auth
over basic-auth: no shared password, no PWA prompt. **The dev sync then resolved the 065–069 ledger
gap this CR had been carrying, and 070 applied through the runner as the only pending file.**

**Migration 070's `UNIQUE(account_id)` caught a defect in the seeder on the first row it saw.** The
auto-link rule was "exactly one fin candidate by institution + currency". It threw 23505 at once:
fin holds **one** `Santandar`, the 2024 filing holds **five** Bank Zachodni WBK accounts, and two
PLN rows both resolved to account 22. **One candidate is not the same as unambiguous** — when N
rows chase one account, picking any is a 1-in-N guess. Both counts must be 1. Result on dev: 20
Part III + 12 Part IV, **all `unreviewed`**, 6 auto-linked, 6 flagged with their competitors named,
7 with no fin account. The six linked lines reproduce the standalone worksheet to the cent.

**The FX direction guard is live and falsified.** `PUT /fx-rates/:year` compares against our
reference and refuses beyond ±25%. Pasting Treasury's EUR figure the natural way round (0.851) is
rejected with *"≈0.8511 is EUR per USD; you probably meant 1.175088"* — it returns the reciprocal of
what was typed, which is the number intended.

**`check-modal-adoption.sh` rejected the designation page's hand-rolled dialog**, which was a real
upgrade rather than gate-appeasement: `<Modal>` (CR042 U4) brings focus trapping, ESC, scroll lock
and ARIA wiring the bespoke overlay had none of.

⚠️ **Nothing has been rendered in a browser** — no renderer on this host. The pages pass lint, both
ratchets, the modal guard, 507 frontend tests and the build, but "the gates are green" and "the page
looks right" are different claims. **Prod still has no `tax_*` tables.**

**Two figures this build corrected:**

- **The form entry is `ceil`, and the CR quotes the conversion.** 631,678.72 × 0.278373 = 175,842.30
  → the form carries **175,843**. Every "$175,842" in this CR and the roadmap is the right
  *conversion* and the wrong *form entry*; rounding up is a FinCEN rule, not a display choice, and
  the two differ on every line. Pinned by a test rather than by a doc edit.
- **`WISE - GBP` (§5.1)** — a second live instance of the same-day artifact, 289×.


## 11b. Shipped to prod 2026-08-16

Migration **070** applied to prod 2026-08-15 23:25 UTC (backup first), code deployed 2026-08-16,
and the 35 designations copied from dev rather than re-seeded so the owner's review decisions
survived. A 36th (`OCME - Pekao`) was added through the new UI. `schema_migrations.checksum`
is **md5** — the registry insert fails on NOT NULL if you reach for sha256.

**TY2025 is complete in the app**, not on a spreadsheet: **16 lines, every one carrying a figure** —
13 computed from the ledger, 3 typed from statements (`Bank Zachodni WBK 2408` 45,000 PLN, `WBK 3533`
0.00 USD, `OCME - Pekao` 50,000 PLN) — aggregate **$2,627,821**, threshold exceeded, `needs_attention`
empty, and the aggregate is no longer a floor. Treasury 31-Dec rates fetched from the Fiscal Data API
rather than transcribed. *The three typed lines carry no `manual_reason`*, so the sheet cannot say
which statement each came from.

**Eight defects the owner's review found in one session, none of which the suite could see:**

| | what | why the tests missed it |
|---|---|---|
| 1 | Pages defined one-off button classes | CI caught it — the only one that was gated |
| 2 | Linking from the picker raised the raw CHECK-constraint name | 14 tests created designations already in their final shape; **none moved a row between states**, which is the only thing that screen does |
| 3 | `Reportable` / `Excluded` looked identical | no test asserts a colour, and none should |
| 4 | The USD column rendered reason prose under a `$` heading | ditto |
| 5 | Unlinked rows were the quietest thing in the row | ditto |
| 6 | Editing a typed figure twice left two override rows, arbitrary winner | no test edited the same line twice — §12.1's tie-break shape, in the one place a human types the number |
| 7 | **Print produced the app with the money column clipped** | `.data-table-scroll` scrolls sideways on screen and **clips** on paper, so the papers printed without Maximum (USD). A cut-off column looks like a narrower table, not like missing data |
| 8 | The rate box stamped `treasury` on whatever was typed | and it duly stamped the ECB values, transcribed from the wrong column of a two-column table in chat |

Items 3–5 and 7 are all the same gap: **nothing in the suite looks at the page.** The gates cover
tokens, primitives, envelopes and behaviour, and every one of them passed while the page was wrong.

**Still open:**

- **P0a was never done, and §9 wrongly places it inside shipped P1.** `GET /api/v2/util/coa-traits`
  still returns an `AccountNumber` field for all **230** accounts to any caller, and
  `COATreeRow.jsx:78` still renders it. P0b closed the *network* (loopback + tailnet; basic-auth was
  superseded by Tailscale device auth) but the *payload* was never scrubbed — and **32 of 36
  designations now hold full foreign account numbers**, so "before any number is entered" is a gate
  that has already been passed. This is the CR's own §7.1 finding, still true.
- **TY2024-as-`filed` was never seeded.** `tax_fbar_filings` holds one row: `(2025, 0, draft)`. §9
  called this "the cheapest correctness gate available" — a verification of P2's first run against a
  known-good output — and it silently did not happen.
- Freeze-on-file has never been exercised on real data.
- `review_state` is **global, not per-year**, so excluding a 2026-opened account hides it from TY2026
  too (§7 specified year-scoped and this does not deliver it).
- The §12b.14 carry-in guard · XLSX beyond CSV · Part I filer block (name, TIN, DOB, address) never
  entered.

## 11c. The remaining items, closed 2026-08-16

Everything §11b listed as still open. **Deployed to prod 2026-08-16**, migration **071** applied
first through the runner, and the TY2024 filing seeded on prod as well as dev.

| Item | What shipped |
|---|---|
| **P0a** — the account-number leak | `/util/coa-traits` now serves `AccountNumberMasked` + `HasAccountNumber`; the full value comes from `GET /util/coa/:id/account-number`, one account at a time, called by the COA edit form when it opens — the same shape `routes/tax.js` already used |
| **TY2024 as `filed`** | `Scripts/seed-fbar-2024-filing.js`; 31 lines (19 III + 12 IV), **$1,462,652**, matching the figure independently extracted from the client copy |
| **Freeze-on-file** | *Mark as filed* and *Open an amendment* on `/tax/fbar`, plus the filed-vs-recomputed diff loading unprompted |
| **Year-scoped `review_state`** | Migration **071** — a sparse per-year override, resolved `COALESCE(override, standing)` |
| **§12b.14 carry-in guard** | `carry_in_only` on the engine, `warning: unverified_carry_in` on the line, amber on screen, on the CSV, black on paper |
| **XLSX** | `utils/fbarWorkbook.js` with its own formatter and a pre-flight refusal |
| **Part I filer block** | `app_data.tax_filer`, masked read + explicit reveal, excluded from `/util/appdata` and refused by its POST |

**Four defects surfaced while closing them, none of which the suite could see.**

**1. P0a's frontend half was the dangerous half, and the roadmap's one-line prescription
("drop `AccountNumber` from the payload and the column") would have caused data loss.** COA rows
carried the stored number and posted it back on **every** save — `resolveField('accountNumber')`.
Remove it from the payload and that round-trip writes an **empty string** over a real account number
on any unrelated rename, and over **every selected account at once** in a multi-edit. The number is
now sent only when that edit typed one; `/coa/update` already treats an absent key as "leave it
alone", which is why the fix is a deleted key rather than a value. The move path stops restating it
at all.

**2. Item 15a blocked its own filing.** "Maximum value unknown" is an answer Form 114 provides for,
but the line sat in `needs_attention`, and `freezeYear` refuses a year with anything in that list.
So the only way to file a legitimately unknown maximum was `force` — i.e. to override the guard
protecting every other line. It is now its own category: no figure, aggregate still a **floor**, not
an outstanding task. §12b.13 called 15a "the one that gets used"; it was also the one that could not
be filed.

**3. The diff said "nothing has moved" when nothing had been *checked*.** TY2024's filed lines stand
alone — `tax_foreign_account_id` is NULL, exactly as migration 070 intends for a return transcribed
from paper — so there was nothing to recompute them against, and a null delta was indistinguishable
from a figure that still reconciles. **A filing where zero lines could be verified read as a filing
where zero lines had changed.** `filedVsRecomputed` now returns `comparable` per row with
`comparable_count` / `moved_count`, and the panel leads with how many of the filed lines can be
recomputed at all. *Found by seeding TY2024 — which is precisely the verification §9 said it would
buy, arriving within a minute of the seed.*

**4. The typed-figure dialog erased its own provenance.** The PUT **replaces** the override row
(there is no unique key on `(filing_id, designation)` — §12.1's shape), and the dialog opened with a
blank reason box. So correcting an amount wiped `manual_reason`. That is why the three TY2025 typed
lines carry no source, which §11b noted without finding the cause.

**Two exposure paths closed with the filer block, both `/util/coa-traits` one table over.**
`GET /util/appdata` merges the **whole `app_data` table** into its response with `Object.assign`, so
`tax_filer` would have been served to every caller on every page load; it is now on that endpoint's
redaction list, **named explicitly rather than pattern-matched**, because the dangerous key is always
the one nobody thought to list. And `POST /util/appdata` persists to a **JSON file on disk**, which
§7.1 forbids for a TIN — it now refuses the key with a sentence rather than dropping it silently.

**Verified:** 981 backend + 517 frontend tests; the tax suites **green on a from-scratch database**
via `Scripts/test-fresh-db.sh`, with 071's post-condition NOTICE emitted on the full chain; all five
ratchets clean. ⚠️ **Nothing has been rendered in a browser** — still no renderer on this host, and
§11b's eight owner-found defects are the standing evidence that green gates and a correct page are
different claims. The XLSX tests assert **cell contents** rather than that a file appeared, which is
the nearest available substitute.

**Still true, and out of scope here:** `PKO TFI` shows 6,000 PLN on the balance sheet continuously
since 1990 (a ledger defect, tracked on the roadmap), and giving `calibrate()` an `audit_log` row
remains the adjacent work §6 named — the diff can still show *what* moved and not *why*.

## 12. Corrections to this CR, made before any code (2026-08-15)

**The worst one first: §5 committed the exact failure §4 was written to prevent.** The draft
converted PLN at ≈0.2344 — a stale year's rate — while §4 argued at length that a plausible rate
asserted as an authoritative one is this project's most-repeated failure. Correct at the CR's own
stated 0.278373: **$175,842 / $220,902 / $1,223,068**, not "$148K" and "$1.03M".

1. **The 7× headline did not reproduce.** 4,393,629.03 appears only under `ORDER BY (date, amount
   DESC)`; the draft's query ordered by `transaction_date` alone with a `ROWS` frame, so the
   tie-break was arbitrary. The implementation anyone would actually write — `(date, id)`, as
   `findLedgerWithRunningBalance` does — gives 793,547.72, i.e. **1.26×**. Worse, the draft's other
   two rows were "1.0×" only under `(date, id)`: under `(date, amount DESC)` `PKO Savings` is
   4,565,961.57 and `WISE - PLN` is 3,000,165.58 (a 20% gap). One table, two methodologies.
   **The conclusion strengthened rather than weakened** — the naive answer is a *range* chosen by an
   arbitrary tie-break, which is a better argument than any single ratio (§5.1).
2. **The maximum missed the January 1 carry-in**, falsifying this CR's own flagship example
   (`Wise - USD` 1,552.20 vs 1,718.27) and understating `United Beverages` by 2,783,000 PLN. Eight
   accounts with no in-year activity returned NULL (§5.2).
3. **The balance formula was quoted without its floor** — `opening_balance_date` is interpolated one
   line below the cited `reconcileToFeed.js:271,487`. `openingBalanceWindow.js` exists because that
   sum was already copied three times unbounded (§5).
4. **The first gate could not run in CI** — it asserted a prod figure against a 34-line seed with
   zero transactions (§10).
5. **Report-only lines had no schema to live in** — no account number, no currency, and the typed
   maximum lived only on the P3 snapshot table (§3).
6. **"Masked in the UI" was false** — `/api/v2/util/coa-traits` already serves every account number
   in plaintext (§7.1).
7. **`tax_year UNIQUE` forbade the amended filing §6 claimed to enable** (§3).
8. **"You can see exactly what changed and why" was unsupported** — `calibrate()` writes no audit
   row, then or now (§6).
9. **The Treasury FX direction is the reciprocal of ours**, and EUR/GBP are both plausible in either
   direction (§4).
10. **Cross-currency rows** would corrupt a native sum on a named candidate account (§5.3).
11. **`is_reportable` as a boolean** conflated "excluded" with "not yet reviewed" (§3).
12. **The designation screen was present-tense and active-only**, dropping accounts closed since the
    reported year (§7).

## 12b. Corrections found after the code was written (2026-08-15)

13. **FBAR has no closed- or opened-during-the-year checkbox.** §3's field table listed "Account
    closed during the year" as a Form 114 field and the schema carries
    `tax_fbar_filing_lines.closed_during_year`. Verified against the filed TY2024 client copy
    (p.7, two full Part III record blocks): the per-account fields are **15/15a, 16, 17, 18,
    19–23, 24–33** and nothing more. Opened/closed-in-year are **Form 8938** fields — which is
    why the preparer's request sheet carries them, and 8938 *is* required for this filer
    (§11 out-of-scope note). Consequences:
    - **Nothing to build.** The absent UI control for `closed_during_year` was previously called
      a gap; it is not one. Do not add it as an FBAR field.
    - **The column stays.** Dropping it needs a migration and buys nothing; it is inert, defaults
      FALSE, and 8938 is the Taxes section's known second occupant. It is now documented as an
      8938/internal flag, not a 114 field.
    - **The real missing control is 15a, `max_unknown`** — a genuine Form 114 checkbox with no UI.
      With 21 of 35 TY2025 lines carrying no computed figure, this is the one that gets used.
    - A closed account is still **reported for the year it was open**; that rule was never in
      doubt. What was wrong was believing the form records the closure.

14. **The engine cannot tell "held X on 1 January" from "did not exist yet".** Both render as
    `max_on: carry-in`. Found 2026-08-16 when the owner corrected `PKO TFI` from "opened during
    2025" to **opened 2026**: it reported a TY2025 maximum of 6,000 PLN drawn from an
    `opening_balance` of 6,000 dated **1990-01-01** on an `accounts` row created 2026-03-01, with
    **no 2025 transactions at all** (first is 2026-02-09). The 1990 date is not the anomaly — it is
    the house CR012 convention on all 26 recent accounts. The anomaly is a calibration plug on an
    account with **no pre-history for it to represent**, which the plug then projects back 36 years.
    - §12.2 fixed the opposite error (a maximum that *missed* the carry-in). This is the same seam
      from the other side: a carry-in asserted for a year the account did not exist.
    - **`Revolut-PLN` has the identical signature** — zero 2025 transactions, first 2026-03-22 —
      and was on the TY2025 report at 0.00 as a carry-in. Owner question, not an engine bug.
    - **Cheap guard worth building:** a computed line whose maximum is a pure carry-in *and* which
      has zero transactions in the reported year is not a verified figure. It should carry a
      warning, not sit among the computed rows looking settled. Two of the fourteen computed
      TY2025 lines were in exactly that state.
    - Separately, and outside CR082: fin's balance sheet shows `PKO TFI` holding 6,000 PLN
      continuously since 1990. Small ($1,671) but wrong.
