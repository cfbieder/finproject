**Status:** ✅ **P1 COMPLETE** — shipped v3.50.0 (2026-09-03). **Track: v3.** Depends on
[CR061](cr-061-holdings-and-prices.md) P1 (shipped in the same release). **P2 (the live-quote
overlay) and P3 are open.**

# CR090 — The Investments section

A new top-level app section: **a portfolio view per Fidelity account** — every position, what it is
worth, what share of the account it is, what it cost, and what it has gained — with live equity
quotes as a labelled overlay. Start as a register with a reconciliation; elaborate into performance
metrics as snapshot history accrues.

Split from [CR061](cr-061-holdings-and-prices.md) rev 3 (owner decision, 2026-09-02) after a two-pass
review: CR061 rev 2 had grown into three CRs, and the ingest — the piece with a clock on it, since
**nothing recovers a day nobody stored** — was scheduled behind the page, which has none. CR061 keeps
the ingest and the price source; this CR is the page.

Roadmap anchor: [project-roadmap.md#cr090](../current/project-roadmap.md#cr090).

## Why

fin has no page that answers *"what do I actually own"*. The balance sheet knows the five tracked
Fidelity accounts as five numbers totalling ~$3.87M — **43% of net worth** — with no view underneath
them. Every measurement this design rests on is in [CR061 §4](cr-061-holdings-and-prices.md); this CR
does not restate them, it consumes them.

## 0. Non-goals — confirmed by the owner 2026-09-03

**This section writes nothing.** It is a read-only view of what the custodian reports, and at this
stage it deliberately does not:

- **book anything to the ledger** — no MTM rows, no `Unrealized G/L` postings, no journal of any kind;
- **auto-reconcile against the balances fin already holds** — the existing reconcile loop stays the
  only thing that books a mark, and this page neither triggers nor pre-empts it;
- **change any balance** — no `opening_balance` re-anchoring, and ⚠️ **`balance_from_feed` stays
  FALSE** ([CR061 §4.11](cr-061-holdings-and-prices.md) records why enabling it breaks
  `/investment-returns`);
- **compute a return** — [CR056](cr-056-investment-returns.md) owns that number; this page links to it.

⚠️ **"Reconciliation" in this CR means arithmetic on screen, not a process.** The residual row (§1)
displays `custodian balance − Σ positions` so the page cannot quietly disagree with the balance sheet.
It surfaces the difference; it never resolves it.

Deeper portfolio analysis is sequenced in §5 and arrives as snapshot history accrues — none of it
changes this non-goal.

## 1. The page — P1

### Account header

**The custodian balance is the headline and the account total, always.** Beneath it: Σ positions
reported · the **residual row** · the value-weighted freshness statement (§2) · fin-ledger-vs-custodian
drift with the last-mark date and a link to reconcile · cost basis and unrealized G/L on covered
positions with a coverage badge · cash/MMF share · largest position as % of account · TTM income from
the ledger, labelled *account-level, from the ledger* · a link out to `/investment-returns`.

⚠️ **Reuse the existing drift computation** — the Home attention strip and the reconcile page already
surface it. Two surfaces computing "drift" two ways is exactly the "two answers to one question"
failure §1.2 forbids for returns.

### Columns, priority order

market value · % of account · identifier (symbol *or* CUSIP, **one** column) · name (`—` for CUSIPs,
never an echo of the identifier) · quantity + unit · price + basis · **price-provenance chip** ·
cost basis (labelled *total*) · unrealized G/L $ · unrealized G/L %.

Display rules that follow from [CR061 §4.4](cr-061-holdings-and-prices.md)'s three conventions:

- A bond renders **`99.89` per 100 face**, not `0.9989` — which reads as a penny stock. Store raw,
  transform once, in one place.
- Money market renders **`par`**, not `1.00`.
- **Never aggregate `quantity` across kinds, and never offer it as a sort default** — it sums 37 bond
  face values into ~1.2M "units" and puts every bond above every equity.
- **No per-share cost in P1.** `cost_basis / quantity` gives dollars-per-share for an equity, a price
  *fraction* for a bond, and 1.00 for a money-market fund: three units, one column.

### 🔴 The residual row is universal, not an Options special case

```
Positions reported (1)                     70,526.53
Not reported by the feed                   33,081.00   ← 31.9% of this account
──────────────────────────────────────────────────────
Fidelity Options — custodian balance      103,607.53
```

Run it on all five tracked accounts; on four it renders as cents (the measured residuals are 0.01 /
0.04 / 10.00 / 0.10) and collapses under a $50 threshold — and *that* is what makes 33,081.00
legible when it appears.

It is not invented data: both figures come from the custodian, and from **the same fetch** ([CR061
§6.1](cr-061-holdings-and-prices.md)'s snapshot header exists so the pairing cannot tear). Same
construction as CR056's `Unattributed` row — exhaustive, always computed, visible — and if fintable
ever starts reporting option contracts it shrinks to zero with no code change.

The alternatives, and why not: **excluding the account** silently drops $103,607 from every total;
**a banner alone** leaves a wrong total on screen, which CR088 P5 established does not work;
**manual entry as the primary answer** decays into a second wrong number beside the right one.

### Unrealized G/L, truthfully

`UGL$ = market_value − cost_basis`, `UGL% = UGL$ / cost_basis`, **only where `cost_basis > 0`**.
Where it is not, render `—` and distinguish two kinds:

- **no basis by nature** — money market and core cash. CR058 §12.9 flags this `cashOnly` explicitly:
  *"cash account, genuinely zero" and "failed to parse" must not look alike*.
- **basis missing** — a position that should have one and doesn't. That is a finding.

**Per account, UGL is the sum of the covered positions' UGLs** — *not* `account market value − Σ cost
basis`, which is wrong whenever coverage is partial. State coverage as a share of value and reuse
CR056's bands so the owner reads one instrument, not two: **≥90% plain · 50–90% badged · <50%
suppressed**.

⚠️ **Do not assert `cost + unrealized = market value`.** CR058 §12.9 records a test that deliberately
asserts at least one account *breaks* it, because SPAXX carries market value with no basis.

Label it **`Unrealized G/L vs cost`**, not `gain` — for the CUSIP bonds it blends price movement with
premium/discount amortisation, and it is not a tax gain.

## 1.2 What P1 must NOT show

- **Any return percentage computed on this page.** CR056 already ships a mark-gated, identity-closed
  account return. A second number derived from snapshots would disagree with it. Link; do not re-derive.
- **Day change / "today's gain"** — needs a previous close at a consistent provenance. Mixing a live
  equity quote against yesterday's custodian bond price manufactures a gain.
- **Asset-class or sector allocation.** `securities.sector` / `country` / `exchange` are not in the
  feed. A pie built from `name` is invention.
- **A cross-account unrealized total without stated coverage** — CR058 §12.9 records this producing a
  fabricated **$1.28M** gain by reading a cash-only account's `$0.00` as a cost basis.
- **Duration, maturity ladder, coupon, YTM** for Fixed Income — the feed gives a CUSIP and nothing else.
- **Realized G/L, tax lots, wash sales** — zero disposal data. Blocked (CR020), not deferred.
- **A portfolio total that sums position rows** — it understates by the $33,081 of unreported option
  contracts. (The untracked `Individual` account's $26,112 is a separate, deliberate exclusion —
  [CR061 §10.1](cr-061-holdings-and-prices.md) — and belongs in the page's scope line, not a total.)

## 2. The real-time ask — an overlay, not a revaluation

The owner asked that positions be valued at real-time quotes rather than the custodian's stale
prices. **Only 47.5% of the portfolio by value can be quoted** ([CR061
§4.6](cr-061-holdings-and-prices.md)); the rest is CUSIP bonds, a mutual fund, money market and three
unclassified positions, none of which any equity feed prices.

The design stores both bases, so the literal ask **is** deliverable — `Σ(quote where available) +
Σ(custodian elsewhere)` — as a separate panel. What must not happen is that figure becoming the
account total:

```
Custodian value       Σ(quantity × custodian price)    ← the account total
Live-adjusted value   Σ(quantity × best available)     ← a panel, labelled hybrid
Δ since snapshot      the difference, with coverage: "equities only — 87% of this account"
```

**The custodian-priced total stays the account total and the only figure any other fin surface may
consume**, because the balance sheet, `/investment-returns` and the MTM reconcile all key off that
basis — and a second basis leaking into them recreates exactly the `balance_from_feed` disagreement
CR056 documents. It also keeps the reconciliation that makes the Options residual legible.

### Freshness is the stalest material price, not the newest

A header stamped with the newest timestamp on the page is the most likely way this surface tells a
lie. Value-weighted, worst material component first:

> `Polled 2026-09-02 (custodian) · 47% refreshed 15:31 (IEX, delayed) ·
> 53% has no market quote by nature`

⚠️ **The valuation date is not the poll date, and P1 will usually not know it** — [CR061
§4.10](cr-061-holdings-and-prices.md). Read `valued_on`, never `polled_on`; when it is null say
**"polled"**, not "valued", and never print the poll date under a valuation label. A confident
*"priced at the 08-31 close"* is precisely [CR088 P5](cr-088-budget-vs-actual-le-table.md)'s shape —
correct figures under a label that lies about them — and CR089's own pass 1 falsified the evidence
row that sentence rested on.

🔴 **And a snapshot is not a valuation.** CR089 §P2.4 measured it: the 08-31 snapshot holds the right
**quantities** and the wrong **prices**; the 09-02 snapshot holds the right **prices** and the wrong
**quantities** (dividend and sweep credits landing after month-end). On Cash Mgt the quantity effect
was **ten times the mark and the opposite sign**. So this page reports *what the custodian last
reported*, never "what this was worth on date X" — and the residual row is a reconciliation of one
poll, not a valuation.

An account with **0% quotable** (Cash Mgt, Individual, Options) shows the panel greyed with *"no
position in this account can be quoted"* — **never a Δ of 0.00**, which reads as "the market didn't
move". ⚠️ This is also P1's actual state, since quotes are P2: assert the 0%-quoted rendering.

The chip on a quoted row reads **`IEX · delayed`**, never `LIVE`. A refused quote (CR061 §5) names
the refusal on the chip and drops the panel's coverage — silence would read as "didn't move".

## 3. Warnings

Shape follows `fcWarnings.js` (`{id, severity, title, detail, amount}`), with CR074's
dismissal-expires-when-the-figures-change. No advisory tab — these are data facts, not owner
judgements, so CR077's split does not apply.

| id | Severity | Condition | Threshold, and why |
|---|---|---|---|
| `holdings-vs-balance-<acct>` | **error** >1% or >$1,000 · **warning** >$50 · silent ≤$50 | \|Σpositions − balance\| | Four accounts tie within $10; Options is 31.9% / $33,081 |
| `no-positions-<acct>` | **error** | balance > 0, header `status = fetched`, zero rows | Catches the feed dropping a whole account — the failure that looks like nothing. ⚠️ Must read `status`, or `absent` and `empty` both fire |
| `snapshot-partial-<acct>` | **warning** | header `status = partial` | A partial fetch rendered as complete invents "not reported by the feed" dollars |
| `snapshot-stale-<acct>` | **warning** >3d · **error** >7d | today − `polled_on` | 3 covers a long weekend; 7 means broken, not resting |
| `unmapped-feed-brokerage-<ext>` | **error** | feed brokerage account holds positions, `account_id IS NULL` **and `ignored = FALSE`** | ⚠️ The `ignored` clause is load-bearing — without it this fires forever on the deliberately-untracked Individual. Nothing fires today; preventive, for the re-consent case |
| `quote-refused-<symbol>` | **warning** | CR061 §5's structural or magnitude refusal fired | Names why, so the position doesn't read as "didn't move" |
| `quote-missing-<symbol>` | **info** | quote-eligible, none returned | The custodian price is a valid fallback; info so a systematic 503 outage is visible |
| `unknown-instrument-<symbol>` | **warning** | `asset_class = 'unknown'` | Must never be silently quoted or treated as equity |
| `ledger-vs-custodian-<acct>` | **warning** | last mark > 35 days **or** drift > 3% | Gated on **mark age**, so it means "you are due to re-mark". A pure drift rule fires most of every month, which is normal market movement |
| `cost-basis-coverage-<acct>` | **info** <90% · **warning** <50% | share of value with a basis | Mirrors CR056's bands |

**Deliberately not a warning: "53% of this portfolio is unpriceable".** Fidelity Fixed Income has
zero quotable positions and always will; as a warning it fires forever and suppresses the all-clear —
CR074's rule, *a rule that cannot NOT fire carries no information*. It belongs in the freshness
statement, stated once.

## 4. Where it goes in the app

⚠️ **Owner revision 2026-09-03 — the placement changed twice, and this is the settled one.**
It was first built as its own top-level section, then moved *under* Reports on the reasoning that a
whole nav group for one page was heavier than the content. The owner's answer resolved both halves:
it is **its own section, positioned below Reports**, and it is **two pages, not one** — which is what
made a section the right size for it after all.

| Nav entry | Path | What it is |
|---|---|---|
| **Investment Summary** | `/investments` | Totals, then one row per account — balance, positions, residual, unrealized, coverage, priceable — each linking into its register |
| **Investment Positions** | `/investments/positions` | One account's register. A nav entry needs a static path, so this opens the first account |
| *(not in nav)* | `/investments/positions/:accountId` | The same register, deep-linkable. What the summary links to and the tab strip navigates between |

Registered via `category` in `frontend/src/config/routes.jsx`, which is what makes it appear in
**both** nav shells; the CR026 `navLayout` flag defaults to `legacy` on prod, so wiring only the
sidebar would leave it invisible. Keep `frontend/src/config/routes.test.js` green.

**Shared rendering is split three ways so each module exports one kind of thing** — `investmentFormat.js`
(pure formatters), `investmentView.jsx` (components), `positionColumns.jsx` (the column spec). A single
module exporting both breaks React Fast Refresh, and `Scripts/check-lint-debt.sh` ratchets that warning
downward. The summary and the detail share every formatter, so a figure cannot read one way in the list
and another on the register.

**The account switcher is links, not buttons** — each account has a URL, so it must be right-clickable
and bookmarkable — styled with the existing `report-tabs` classes rather than a one-off button class,
which `Scripts/check-button-css.sh` ratchets.

- **Server:** CR043's route→service split — `server/src/services/investments.js` beside
  `investmentReturns.js`, thin routes, the `{data, meta}` envelope that
  `Scripts/check-api-envelope.sh` ratchets.
- **Frontend:** `frontend/src/features/Investments/`, TanStack Query, `Rest.unwrap()`.
- **Table:** decide **once** between `DataTable` and CR088 P3's consolidated
  `components/ReportTable.css` — a twelfth rival table look is the lesson CR088 P6 closed on.
- **Account switching:** `AccountPicker` / `HierarchyFilter` + `utils/hierarchyFilterGroups.js`,
  as CR054 solved the same problem. §1.2 forbids a summed portfolio total; the page's scope line
  carries Σ of the five tracked custodian balances and names the excluded account.
- **Charts:** `useChartTheme()` — recharts colours are JS values and don't follow tokens.
- **Money:** define a local formatter matching `TaxFbar.jsx`'s, and adopt CR087's `<Money>` when P1
  lands. Never drop the currency from the markup.
- **CSS:** design tokens only, `TaxFbar.css`'s header as the model. Must pass
  `check-dead-tokens.sh`, `check-inline-hex.sh`, `check-button-css.sh`, `check-lint-debt.sh` — and
  **both themes rendered and looked at**, because no gate catches a dark-mode defect.
- Any modal uses the Radix `<Modal>` (`Scripts/check-modal-adoption.sh`).

## 5. Phases

| Phase | What | Needs to accrue |
|---|---|---|
| **P1** | the register · reconciliation + residual row · unrealized on covered basis · provenance + weighted freshness · account TTM income · fin-vs-custodian drift · link to `/investment-returns` | nothing beyond CR061 P1 |
| **P2** | the quote overlay panel · concentration (top-N) · cash/MMF share | nothing |
| **P3** | **the history view — TWO series, not one** · position value history · **quantity-change log** · position contribution to account change | ✅ **accrued** — [CR061](cr-061-holdings-and-prices.md) P2 landed **117 quarterly statement snapshots back to 2016-03-31** (2026-09-05), so the chart no longer waits on the daily feed. See §5.1 |

**Not carried here** — trailing-12m position return and yield on cost are roadmap items until twelve
months of snapshots exist. A classification-override *screen* is gold-plating for three `unknown`
instruments, one owner and one database: `classification_source = 'manual'` plus a row edit is the wedge.

Two calls inside P3:

- **Quantity-change detection is the highest-value early metric** — available from snapshot day 2,
  and it turns a level series into an activity log with no trade feed. But it **cannot distinguish a
  purchase from a transfer-in or a DRIP**, so label it `quantity change`, never `trade`, and
  corroborate against the ledger's `Transfer - Securities Trades` legs on the same date.
- **Position contribution to account change misleads until that decomposition exists** —
  `Δmarket_value` for a position bought into is mostly the purchase. Ship them together or neither.

**Explicitly impossible, so it is not rediscovered:** any annualized return before twelve months ·
volatility / drawdown (twelve months daily, measurable only on the quotable 47.5%, and decoration for
a buy-and-hold owner) · benchmarking a 53%-fixed-income-and-cash portfolio against SPY (needs a
blended benchmark) · **deriving realized gains from consecutive snapshots** — a quantity drop is a
sale *or* a transfer *or* a corporate action, and they book differently. That last is the shape
CR058 §12.8 already killed for `Change in Investment Value`.

## 5.1 P3 — the history view, and why it is **two series**

⚠️ **State as of 2026-09-05: the history is stored and NOTHING RENDERS IT.** Two independent reasons,
both measured:

1. `accountHistory()` hardcodes `source = 'bank-feed'`
   ([`services/investments.js`](../../server/src/services/investments.js#L27)), so the 117 statement
   snapshots are filtered out — the endpoint returns 64 rows beginning 2026-07-04.
2. **No page calls the endpoint at all.** Nothing under `frontend/src` references
   `/investments/accounts/:id/history`.

So P1 shipped a register with no time axis, and CR061 P2 put a decade of history behind it that the
app cannot see. P3 is the first consumer, and the endpoint change is part of it.

### 🔴 The two series must not become one line

This is the whole design, and everything else is detail.

| | statement series | feed series |
|---|---|---|
| cadence | **quarterly** (period end) | **daily** |
| dated by | `valued_on` — the custodian states the date its figures are true for | `polled_on` — when we ASKED. `valued_on` is **NULL** and must stay so ([CR089](cr-089-month-end-observation-dating.md)) |
| span | 2016-03-31 → 2026-06-30 | 2026-07-04 → today |
| total | the statement's own printed account total | `custodian_balance` from the same fetch |

⚠️ **They do not overlap.** Statements end **2026-06-30**, the feed begins **2026-07-04** — a four-day
gap with no shared date anywhere, which is the finding that already cost CR061 its planned
cross-check. So there is **no observation that validates the join**, and a single continuous line
would splice two differently-dated series across a seam neither one can vouch for. It would look
smooth and be unverifiable.

**Therefore:** statement observations render as **discrete markers** — they *are* discrete quarterly
observations — and the feed renders as a continuous line. **Never interpolate between statement
points.** A straight segment from 2016-06-30 to 2016-09-30 asserts a path through a quarter nobody
observed, and on an account taking 1.46M of additions while losing 1.17M of value in one year
([CR058](cr-058-quicken-valuation-anchors.md) §9) that path is not merely unknown, it is wrong.

The axis legend states both datings in words. "Polled" vs "Valued" is already the vocabulary P1 uses
on the account header, so the page does not have to teach a new one.

### Each account starts on its own date, and that is not when the account started

| account | statement snapshots | earliest |
|---|---|---|
| Fidelity IRA | 42 | 2016-03-31 |
| Fidelity Bond | 42 | 2016-03-31 |
| Fidelity Cash Mgt | 24 | 2020-09-30 |
| Fidelity Stocks | 9 | **2024-06-30** |

⚠️ **A chart that simply begins where its data begins claims the account began there.** Fidelity
Stocks has value long before 2024 — what it lacks is a *statement* we hold. This is the same class as
the drift report's *"33 statement date(s) predate fin's first record for this account"*, which is
stated in words precisely so it cannot be read as drift. The chart must say **"statements held from
2024-06-30"**, not draw an axis that starts there silently.

### What P3 must NOT do

- **No returns derived from the series.** A level series is not a performance series. This is settled
  three times over — [CR056](cr-056-investment-returns.md) §3.3, [CR058](cr-058-quicken-valuation-anchors.md)
  §9 step 5 (which left the return column `—` for 25 years *by design*), and §12.8's
  *"CHANGE IN INVESTMENT VALUE IS NOT A RETURN"*. The link to `/investment-returns` is the answer.
- **No interpolation, no smoothing, no area fill** under the quarterly series — each is a visual claim
  about unobserved time.
- **No mixing into one downloadable/tabular series** without the `source` and dating column, or the
  distinction survives only in the picture.

### Quantity-change log — now decade-wide, and coarser than it looks

P1's note assumed two days of daily snapshots. There are now **~40 quarterly observations per
account**, which is far more useful — and coarser in a way that must be labelled: ⚠️ **a buy and a
sell inside one quarter are invisible**, and so is everything about *when* within the quarter. The
existing rule stands and is now more important, not less: call it **`quantity change`, never
`trade`**, and corroborate against the ledger's `Transfer - Securities Trades` legs.

### Scope

Endpoint returns both sources with `source` and both dates per row; one page consumes it; the
markers-vs-line distinction and the two coverage statements above are acceptance criteria, not
polish. **Position-level** history and contribution stay behind the account-level chart — the
`security_positions` rows exist for all 2,830 statement positions, but per-position quarterly history
needs the quantity-change decomposition shipped alongside it or it misleads exactly as §5 records.

## 6. Open

**Manual entry for the missing option contracts** — deferred. When it arrives it must **reduce the
residual row**, never add to the account total: the only shape in which manual entry cannot become a
second wrong number sitting beside the right one.

## 7. Depends on

[CR061](cr-061-holdings-and-prices.md) P1 (positions, securities master, classification) and its P2
for the quote overlay. Reads [CR089](cr-089-month-end-observation-dating.md)'s `valued_on`. Does not
block, and is not blocked by, [CR020](cr-020-stock-investment-module.md).
