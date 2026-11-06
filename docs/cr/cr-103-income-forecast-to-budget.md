# CR103 — Investment income by account, copied into the budget builder — APPROVED (rev 3)

**Status:** IN-PROGRESS. **P1 (P1a + P1b) live v3.89.0 (2026-11-06)**, freeze gate passed; awaiting the owner's look on prod and the 2027 paste into build 12, then COMPLETE — `budgetYear()` / `mergeBySecurity()` in `services/income.js`, `?year=&reinvestRate=` on `GET /investments/income`, tabs and the *Budget year* panel (`IncomeBudgetYear.jsx`); 9 new server tests, 2 page tests. **Code review (`code-quality-reviewer`) found no wrong number in the server's rows; its fixes are in:** the copy panel is keyed by tab/year/rate so a stale copy box cannot survive a switch; the heading follows the rows' year and Copy is disabled while another year loads; the age line reads the **oldest** held load, not the newest; per-account reinvestment rates are shown; an invalid rate says so; year options follow the server's (UTC) window; an unknown account keeps the tab strip; and the two missing tests exist — a DB-backed D6 test (a load two months stale still gives 12 payments; it fails on the old window) and the route's 400s. **As built, two deliberate departures from §4:** §4.9 — All merges a security held in several accounts into one row (exactly the v3.88.0 view, which is what the parity check needs), rather than listing it once per account; §4.10 — each tab's headline stays Scheduled / Estimated (reliability), and the Dividend / Interest split is shown in the *Budget year* panel. Checked read-only against prod data: All's coupons ($60,317.38, identical by month), cash and estimated totals equal v3.88.0 to the cent; every 2027 row's months sum to its total. **P0 confirmed working by the owner on prod 2026-11-06.** **P0 live v3.88.0 (2026-11-06)** (`applyPaste` in `itemsMath.js`, `onPaste` in `ItemsModal.jsx`; 18 parser tests plus the first `ItemsModal` component test); freeze gate passed (build 12's lines and items identical before and after the deploy). Prod dividends reloaded 2026-11-06 (§7): the page's estimated income went from $47,855 to $56,485.
- Pass 1 `cr-technical-reviewer`: **REVISE** on rev 1 (3 blocking, 9 should-fix, 5 nits). All are addressed in
  rev 2; see §9.
- Pass 2 `cr-signoff-pm`: **GO** on rev 2, on four conditions, applied in rev 3 (§7, §9).
- Owner decisions D1–D8 taken 2026-11-06 (§3).
- **P0 target 2026-11-13, hard stop 2026-11-26.** P1 target 2026-11-27, fallback cutoff 2026-12-05 (§7).

**Depends on:** CR093 P3 (the Investment Income page, `services/income.js`); CR090 (per-account positions
tabs); CR098 + CR100 (the budget builder and its itemised lines).
**Roadmap anchor:** [project-roadmap.md#cr103](../current/project-roadmap.md#cr103)
**Deadline context:** the builder code freeze is **2026-12-03**, and the first 2027 publish is due
**2026-12-10** ([status.md](../current/status.md)). P0 changes the builder, so it must land before the freeze.
P1 doesn't touch the builder, but it is only useful if it ships before the publish.

## 1. The ask

The Investment Income page (`/investments/income`) forecasts what the portfolio pays over the next twelve
months, for the whole portfolio at once. The owner wants to use it to build the 2027 budget's
investment-income lines:

1. **One tab per account**, like the investment positions page.
2. **Each account's income forecast**, split the way it will be budgeted.
3. **A copy-to-budget action**: next year's Jan–Dec on the clipboard, pasted into the budget builder's
   itemised modal (CR100).

**What it changes in the 2027 budget.** The only 2027 draft (build 12, prod, 2026-11-06) already has both
lines filled in and marked done:

| Line | Draft policy | Draft figure | Holdings-based forecast (rough, §2) |
|---|---|---|---|
| `Interest Income` USD | Fixed, even split | $75,000 | ~$69k |
| `Financial Income - Dividend` USD | Recurring on LE FY | ~$40,058 | ~$55k |
| `Interest Income` PLN (PKO) | Recurring | 14,045 PLN | not covered (outside the feed) |

So CR103 is a **refinement, not a rescue**. It moves about $15k between the two lines (FLDR is booked as
Dividend now, while the LE still carries part of it as Interest), moves each total the right way, and gives
both lines a real monthly shape instead of an even or automatic split. It matters because the 2027 budget
becomes `2027 Base`'s base year at the January close (CR064).

## 2. What exists (read from the code and prod, 2026-11-06, v3.87.0)

- **`buildIncome({ asOf })`** (`server/src/services/income.js:334`) reads the latest bank-feed snapshot of each
  account and **groups positions by security across all accounts**, so it has no per-account view. The route
  (`v2/routes/investments.js:121`) takes no parameters.
- **One `from` drives three things:**
  - coupon dates, where `from` is **exclusive** (`income.js:67,80`), so a coupon on `from` is dropped;
  - the months for spreading estimated income (`monthsBetween`, which starts at `from`'s month, so a rolling
    window already spreads over **13** months);
  - the end of the last-12-month dividend window (`:355`).
- **Three bases, two buckets.** Bond coupons from `security_bond_terms` are *scheduled* (dated). Cash and
  money-market funds (`security_cash_rates`, market value × rate) and any other holding with a positive
  last-12-month total of `CD` dividends are *estimated*, **spread evenly** across the window's months, on
  purpose.
- **What the portfolio holds and pays.** Measured on prod, 2026-11-06:

  | Basis | Holdings | Market value | Next 12 months (window ends today) | Window ending at the 09-05 load |
  |---|---|---|---|---|
  | Stocks and equity ETFs, distributions | 39 | $1.21M | $23.1k | **$27.6k** |
  | Bond funds (`asset_class='bond' AND price_basis='per_share'`), distributions | 4 | $589k | $20.9k | **$25.5k** |
  | Cash and money-market rate | 4 | $143k | ~$3.8k | — |
  | Bonds with coupon terms (scheduled) | 32 | $1.31M | $60.3k | — |
  | No data: 5 bonds without terms, 1 mutual fund, 1 unknown | 7 | $508k | — (understates the total) | — |

- **Dividend data is stale.** `security_dividends` was last loaded **2026-09-05** by hand
  (`Scripts/load-dividends.js --apply`, not scheduled). A window ending today holds only ~10 months of data:
  FLDR shows 10 of 12 monthly rows, and QQQ, SPY and SCHD 3 of 4 quarterly ones. That is why the figures in
  the column ending today are low.
- **`pay_date` is filled** on all 747 `CD` rows with an ex-date in the last 400 days, an average of 12 days
  after the ex-date. Specials are type `SC` and are already excluded (`dividend_type = 'CD'`).
- **The ledger books income on the account holding the security** (last 12 months to 2026-11-06):

  | Account | Dividend | Interest | 2026 budget |
  |---|---|---|---|
  | Fidelity Stocks | $20.3k | $0.1k | Dividend $28k |
  | Fidelity Bond | $9.4k | $37.4k | Interest $22k |
  | Fidelity Cash Mgt | $0.2k | $26.5k | Interest $24k |
  | Fidelity IRA | $9.8k | $0.0k | — (never budgeted) |
  | Fidelity Options | $1.5k | — | — |
  | PKO, Wise, Capital One, Chase (not in the feed's holdings) | — | ~$5.7k | — |

- **How each kind of income is booked:**
  - **Bond coupons and the FDIC deposit** (QIBZQ in Cash Mgt, `rate_kind='interest_rate'`, ~$2.8k): Interest.
  - **Money-market funds** ("DIVIDEND RECEIVED … MONEY MARKET", ~$2.1–2.5k across all five accounts):
    **Dividend**.
  - **Stock and equity-fund distributions:** Dividend.
  - **FLDR** (the large bond fund, $557k, in Fidelity Bond): **Interest until 2026-06** (≈$11.2k,
    Nov–Jun), **Dividend since 2026-07** (5 rows, $8.97k). The position also nearly doubled during the year
    (6,005 → 11,171 shares). The four bond funds and where they sit: FLDR (Bond, $19.2k forecast), HYG and
    NVG (Stocks, $0.9k + $0.6k), AGG (IRA, $0.2k).
- **Securities held in more than one account:** SPAXX (accounts 27, 28, 31), QQQ and DIA (26, 27). No bond sits
  in two accounts, and prices are identical across accounts.
- **Cash rates** (`security_cash_rates`, keyed by security, no account column), as held per account:

  | Account | Holding | Rate | Kind |
  |---|---|---|---|
  | Fidelity Bond | SPAXX | 3.29% | 7-day yield |
  | Fidelity Cash Mgt | FZDXX | 3.47% | 7-day yield |
  | Fidelity Cash Mgt | QIBZQ | 1.82% | interest rate (FDIC) |
  | Fidelity IRA | FDRXX | 3.36% | 7-day yield |

- **Per-account tabs** already exist on `/investments/positions/:accountId`
  (`frontend/src/pages/InvestmentAccount.jsx:163`): a `report-tabs` nav of `Link`s. The route entry is in
  `config/routes.jsx:651-657`.
- **The itemised modal** (`frontend/src/features/Budgets/ItemsModal.jsx`, CR100) edits one builder line
  (category × currency):
  - each row has a description, a currency (USD/PLN/EUR) and twelve month text inputs;
  - the row setters close over `rows` (`:32-33`);
  - amounts are validated by `parseAmount` (`itemsMath.js:17-23`: no commas, at most 2 decimals), with
    `MAX_ITEMS = 100` (`:11`) and the sign rule in `summarise` (`:44-45`);
  - **there is no paste handling and no clipboard use anywhere in `frontend/src`, and no `ItemsModal` component
    test.**
- **An itemised line has no account per item.** At publish, each month's total is divided across accounts by
  the category's last-12-month actual account shares (CR100 §4, `splitLine`, month-first). `cellsHash` is
  computed on the server from saved cells (`services/budgetBuilder.js:872,1066,1092`).

## 3. Decisions (owner, 2026-11-06, via `/question`)

| # | Question | Decision |
|---|---|---|
| D1 | How each account's forecast is split | **By budget category: Dividend / Interest** as the headline numbers, with the detail bases underneath. Each kind of income goes where the ledger books it (D7). |
| D2 | How the numbers reach the builder | **Clipboard**, into the itemised modal (not the fixed-amount field). A "From portfolio" option that reads the forecast directly is deferred until after the 2027 publish. |
| D3 | Paste support in the modal | **Yes.** A pasted tab-separated row fills Jan–Dec; several pasted rows add several items. |
| D4 | Bonds that mature or are called before the year ends | **A separate reinvestment row**: matured principal × a rate set on the page (default: the account's money-market 7-day yield), from the month after maturity. Callable bonds are counted as paying and flagged, as today. |
| D5 | Monthly shape of dividends in the copy | **Last year's payment months (by pay date), in the copy only**, labelled as a shape. The page chart stays even. |
| D6 | Stale dividend data (pass 1 B1) | **Reload, warn, and anchor:** reload before P1 is verified; the page shows the load date and warns past 35 days; each holding's last-12-month window ends at its own load date, not today. No scheduled load. |
| D7 | Money-market income and reinvestment (pass 1 S1) | **Follow the ledger:** money-market funds (`asset_class='mmf'`) and reinvestment → **Dividend**; coupons and FDIC deposits (`rate_kind='interest_rate'`) → **Interest**. |
| D8 | Does D6's anchored window apply to the rolling view? (pass 2 condition 3) | **Both modes.** The everyday page is corrected too. The rolling-mode parity check covers coupons and cash; dividends are checked against the anchored expectation. |

## 4. Design

### P0 — Paste into the itemised modal (builder; must land before 2026-12-03)

- An `onPaste` handler on a row's description input and on each month input. If the pasted text contains no
  tab and no newline, **do nothing special** (the browser's normal paste). Otherwise call
  `preventDefault()`, parse, and apply the whole result in **one** `setRows` (the existing setters close
  over `rows`, so per-cell setters would lose updates).
- A pure parser `parsePastedItems(text, lineCurrency, existingCount)` in `itemsMath.js` (unit-tested):
  - **Lines:** split on CRLF or LF; trailing empty lines are ignored, and so is a trailing tab on a line.
  - **Cells per line**, tab-separated, in the **same column order as the grid**:
    - **14 cells**: description, currency, Jan…Dec.
    - **13 cells**: description, Jan…Dec (currency = the line's).
    - **12 cells**: Jan…Dec only. Allowed only when the paste is **a single line**. It fills Jan–Dec of the
      row it was pasted into, whichever month cell received it, and keeps that row's description and
      currency.
    - Any other count rejects the paste.
  - **Numbers:** an empty cell is 0. Commas are accepted **only** as exact thousands separators
    (`^-?\d{1,3}(,\d{3})+(\.\d+)?$`) and then stripped. Every cell is then validated by **`parseAmount`**, the
    modal's existing rule, never a second rule. So `1820,50` (a decimal comma), `$`, parenthesised negatives
    and non-breaking-space thousands separators all **reject**.
  - **Currency** must be in `CURRENCIES`.
  - **Limit:** existing items plus pasted items must not exceed `MAX_ITEMS` (100).
  - **Any failure rejects the whole paste**, with a message naming the row and column. Nothing partial is
    applied.
- **Placement** (13 and 14 cells): the first parsed item **replaces the row it was pasted into if that row is
  blank** (empty description and all months empty; currency ignored), otherwise it is appended. Every later
  item is appended.
- Nothing else changes: Save, the sign rule ("positive amounts take the line's sign"), the build's rates,
  preview and publish. A paste only changes the modal's local rows. Nothing reaches the server until Save,
  which already validates.

### P1 — The Investment Income page by account, with the budget copy

**Server** (`services/income.js`, `GET /api/v2/investments/income`):

1. **Per account.** Positions are grouped by **(account, security)**. The response carries every account's
   breakdown plus All. The client filters by tab, so there is **no `accountId` parameter**. All is summed from
   **unrounded** per-account pieces and rounded once, so its totals match today's response.
2. **Parameters**, whitelist-validated, with a 400 on bad input:
   - `year`: a 4-digit integer from the current year to the current year + 2;
   - `reinvestRate`: a percent from 0 to 20.
   Without `year`, the page behaves as now (rolling).
3. **Year mode: three boundaries, kept apart.**
   - **Months:** exactly the 12 months of `year`, generated from `year`, not from `monthsBetween(from, …)`.
   - **Coupons:** `couponDates(…, '${year-1}-12-31', '${year}-12-31')`. The exclusive start then still
     counts a 1 January coupon.
   - **Dividend window (D6, D8):** in **both** modes, each holding's last 12 months end at
     **`min(today, its dividends_as_of)`**, not at the window start, and not at today if the data is older.
   - **Cash:** today's market value × today's rate, for the whole year (stated on the page).
4. **Category per income piece (D1, D7):**

   | Detail basis | How it's identified | Category |
   |---|---|---|
   | `coupon` | bond terms | Interest |
   | `cash_deposit` | `rate_kind='interest_rate'` | Interest |
   | `money_market` | `asset_class='mmf'`, or `rate_kind='seven_day_yield'` | Dividend |
   | `reinvestment` | D4 | Dividend |
   | `distribution_fund` | `asset_class='bond' AND price_basis='per_share'` | Dividend |
   | `distribution_stock` | other distribution payers (incl. equity ETFs QQQ, SPY, DIA, JEPI) | Dividend |

5. **Reinvestment (D4):**
   - **Which bonds:** every bond whose `maturity_date` falls in **(today, year-end]**, including those that
     mature before 1 January (e.g. BLACKSTONE, 2026-12-15, $15k face).
   - **When:** from **`max(maturity month + 1, January)`** to December.
   - **Amount:** face × rate × months / 12.
   - **Rate:** `reinvestRate` if given. Otherwise the `rate_kind='seven_day_yield'` rate held in the
     **same account's** latest snapshot (Bond 3.29%, Cash Mgt 3.47%, IRA 3.36%), else the highest such rate
     in the portfolio. The response states the rate, its `as_of` and its source. Rates are stored and shown
     in percent.
   - **Callable bonds** are not reinvested (they are counted as paying to maturity and flagged with the
     at-risk amount, as now).
6. **Dividend shape (D5), copy only:** each holding's last-12-month total (D6 window) is placed in the
   month-of-year of each `pay_date` in that window, weighted by `cash_amount`, in the target year. Two pay
   dates in the same month-of-year both land in that month. A holding with no pay dates falls back to even.
   The page's chart keeps the even spread.
7. **Rows are the source of truth for money.** Each copy row (account × basis) is computed unrounded,
   rounded per month to the cent, and the residual is placed on the row's largest month (the `monthlyRows`
   rule, `income.js:313-331`). **A row's 12 cells sum exactly to its total**, and the page's per-account
   figures are the sums of those rows.

**Frontend** (`pages/InvestmentIncome.jsx`, `config/routes.jsx`):

8. **Tabs.** A `report-tabs` nav (**All** + one tab per account with positions), styled like
   `InvestmentAccount.jsx`, one URL per tab (`/investments/income/:accountId`, a route entry with
   `showInNav: false`, mirroring `routes.jsx:651-657`). Fidelity Options will have a tab holding only SPAXX.
   That is expected.
9. **Holdings lists** key on `${account_id}-${security_id}` (today `InvestmentIncome.jsx:164,207` key on
   `security_id`, which collides once SPAXX, QQQ and DIA appear per account). On **All**, a security held in
   several accounts is listed once per account, which is stated.
10. **Headline.** Each tab shows Dividend and Interest, with the detail bases underneath, and the no-data value
    for the account, e.g. *"Fidelity Cash Mgt: $295k in bonds with no terms is not counted."*
11. **Dividend data age (D6).** *"Dividend history loaded 2026-09-05."* Past **35 days** this becomes a
    warning: *"Dividend history is N days old. Reload it (`Scripts/load-dividends.js --apply`) before copying
    to the budget."*
12. **Budget year panel:**
    - inputs: year (default next year) and reinvestment rate (default from the server, editable, not saved);
    - two buttons, **Copy Interest rows** and **Copy Dividend rows**, each copying the 14-cell P0 format: one
      row per account × basis, positive, two decimals, no thousands separators, no header row. A tab copies
      only its own account's rows; **All** copies every account's;
    - an example row: `Fidelity Bond — reinvested maturities @ 3.29%`, then `USD` and 12 amounts;
    - a note under the buttons: *"Paste into the builder's itemised modal for the matching line. Each month's
      total is split across accounts by last year's shares, not by these rows."*
13. **Clipboard fallback.** `navigator.clipboard` needs a secure context, and dev is plain HTTP on :3105.
    Where it is unavailable or fails, show the text in a read-only, pre-selected `<textarea>` with *"Press
    Ctrl+C"*. Don't rely on the deprecated `execCommand`.
14. **Fidelity IRA** appears like any account. Its rows are included in the copy and labelled, so the owner
    decides in the modal whether IRA income is budgeted (it never has been).

## 5. Known limits (stated, not fixed)

- **The split across accounts is skewed on Fidelity Bond.** The builder spreads a line across accounts by
  last year's actual shares (CR100). FLDR's distributions were booked as Interest until June and as Dividend
  since July, so in 2027 **Dividend under-allocates to Fidelity Bond and Interest over-allocates, by roughly
  $10k each way**. Category totals by month are exact. The split corrects itself in the 2028 build.
- **Coverage.** Only accounts with bank-feed holdings. Interest from PKO, Wise, Capital One and Chase (~$5.7k
  over the last 12 months) must be added as hand items on the Interest line, or the account split gives those
  accounts part of Fidelity's income and the total understates.
- **Holdings with no data** ($508k) contribute nothing. Each tab names them (§4.10).
- **A copy goes stale** when holdings change. The "From portfolio" builder option (deferred, D2) is the fix.
- **The dividend shape is last year's calendar**, not announced dates. A changed dividend schedule shows as
  monthly variance, not annual.
- **Dividends are only as fresh as the last manual load.** D6 anchors the window so the total stays a full
  year, and the page warns, but a dividend cut since the load is not seen.

## 6. Verification

- **P0:**
  - Parser unit tests:
    - 14, 13 and 12 cells; a 12-cell paste into a non-January month;
    - `1,820.50` accepted; `1820,50`, `$5`, `(5)` and NBSP separators rejected;
    - empty cells; a bad currency; a non-number;
    - CRLF, trailing empty lines, a trailing tab;
    - the `MAX_ITEMS` limit;
    - blank-row replacement vs append.
  - The first `ItemsModal` component test (testing-library + jsdom are present): pasting three rows gives
    three items in one update.
  - On dev: paste a copied block into an itemised line, save, preview. The totals match the copied rows to
    the cent.
  - **Freeze gate** (as CR101): a checksum of the prod 2027 draft's cells, the same before and after **every
    prod deploy up to the publish**, P0 and P1 alike (P1 ships a shared frontend bundle and edits
    `routes.jsx`).
- **P1:**
  - **Rolling mode:** All's **coupon and cash** totals and their `by_month` equal v3.87.0's response on the
    same data, to the cent, because All is summed from unrounded pieces (§4.1). **Dividends** are not part of
    this check (D8 changes them on purpose); they equal the anchored-window figure computed independently in
    the test.
  - **Year mode:**
    - exactly 12 `by_month` rows, 2027-01 to 2027-12;
    - an estimated holding's 12 months sum to its total;
    - a 1 January coupon is counted.
  - **Rounding:** every copy row's 12 cells sum to its total, to the cent.
  - **Reinvestment:** $10,000 face maturing in June at 4% gives **$200.00** over Jul–Dec ($33.33 × 5 +
    $33.35 on the largest month).
  - **Before 1 January:** a bond maturing 2026-12-15 is reinvested Jan–Dec 2027.
  - **Dividend shape:**
    - a quarterly payer's total lands in its four pay months, to the cent;
    - two pay dates in one month-of-year both land there.
  - **Dividend window (D6):** with `dividends_as_of` = 2026-09-05, a monthly payer's window holds 12
    payments, not 10.
  - **Parameters:** bad `year` or `reinvestRate` → 400.
  - **Reconciliation:** after reloading dividends, compare each account's year-mode Dividend and Interest to
    the last-12-month ledger figures in §2. **Expected gaps:** the FLDR history (§5), maturities, purchases
    and holdings with no data. Every other gap over 15% is explained before P1 is called done.
- **Render both themes on dev and expect the owner to reshape the panel** (CR082 lesson). Check the copy
  fallback on dev (HTTP) and the clipboard on prod (HTTPS).

## 7. Phases and dates

| Phase | Scope | Target |
|---|---|---|
| **P0** | Paste into the itemised modal | **target 2026-11-13, hard stop 2026-11-26** (as CR100–CR102). Not started by 11-26 → after the publish. |
| **P1a** | (account, security) grouping, year mode, D6/D8 window, category split, tabs, copy buttons with fallback | target 2026-11-27 |
| **P1b** | The reinvestment row (D4, ~$0.5–1k in 2027: 3 holdings, ~$37k maturing) and the dividend shape (D5) | after P1a; **the first to drop** if 11-27 is at risk. D4/D5 stand as decided; only the order changes. |
| Later | A "From portfolio" builder option reading the forecast directly (D2); the reinvestment rate kept between visits; a scheduled dividend load | after the 2027 publish, separate CR(s); on the roadmap backlog |

**The publish does not wait for CR103.** If P1 is not verified on prod by **2026-12-05**, the owner publishes
with the draft's current lines (Interest fixed $75k, Dividend recurring), and CR103's rows feed a later
re-publish or the 2028 build.

**Reload dividends now**, not just before verification: `Scripts/load-dividends.js` (dry run by default, then
`--apply`; idempotent on `(security_id, ex_date, dividend_type)`, reversible by `source='tradier'`). It also
corrects today's page.

No migration. P0 is builder code (frontend only). P1 is a read-only endpoint and page.

## 8. Out of scope

- Re-booking FLDR's 2025-11 to 2026-06 distributions from Interest to Dividend (a ledger change, not this
  CR's).
- Per-item accounts in the itemised modal (would change CR100's split and publish).
- Accounts outside the bank feed's holdings.

## 9. Review log

**Pass 1, `cr-technical-reviewer`, 2026-11-06: REVISE.** Rev 2 addresses every finding:

| Finding | Severity | Where |
|---|---|---|
| B1 dividend data two months stale; the total understates by ~$9.1k and the shape has holes | blocking | D6; §2; §4.3, §4.11; §6 |
| B2 comma stripping turns `1820,50` into 182,050 | blocking | §4 P0: thousands pattern only, then `parseAmount` |
| B3 one `from` gives a 13-month spread in year mode | blocking | §4.3 three boundaries; §6 |
| S1 money-market income is booked as Dividend | should-fix | D7; §2; §4.4 |
| S2 FLDR's history; account-split skew | should-fix | §2; §5; §6 expected gaps |
| S3 reinvestment: pre-January maturities, pennies, rate rule, example rate | should-fix | §4.5, §4.7, §4.12; §6 |
| S4 rounding identity; copy rows sum | should-fix | §4.1, §4.7; §6 |
| S5 React key collision | should-fix | §4.9 |
| S6 parameter validation; drop `accountId` | should-fix | §4.1, §4.2 |
| S7 clipboard unavailable on HTTP dev | should-fix | §4.13 |
| S8 paste mechanics (one update, `MAX_ITEMS`, the 12-cell rule, blank, CRLF, first component test) | should-fix | §4 P0; §6 |
| S9 freeze gate | should-fix | §6 |
| N1 route entry · N2 the bond-fund rule · N3 no-data per account · N4 same-month pay dates · N5 the Options tab | nit | §4.8, §4.4, §4.10, §4.6, §4.8 |

**Pass 2, `cr-signoff-pm`, 2026-11-06: GO on rev 2, with four conditions.** All three pass 1 blockers were
confirmed resolved in the text. Rev 3 applies:

| Condition / recommendation | Where |
|---|---|
| C1 P0 hard stop 2026-11-26, target 11-13 | header; §7 |
| C2 the publish does not wait (fallback cutoff 12-05); the freeze gate on every prod deploy up to the publish | §7; §6 |
| C3 D6 in rolling mode contradicted the parity check | D8 (owner: both modes); §4.3; §6 |
| C4 deferred items tracked | roadmap §2 backlog |
| R1 value restated against the live draft | §1 |
| R2 cut line inside P1 | §7 (P1a / P1b) |
| R3 reload dividends now | §7 |
| R4 the publish action gains a CR103 step | roadmap, "Publish the 2027 budget" |
