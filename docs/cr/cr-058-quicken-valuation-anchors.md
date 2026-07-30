# CR058 — Quicken-era valuation anchors (brokerage history) — SHIPPED (rev 5 built; dev + prod 2026-07-29)

Give the pre-feed history of a **brokerage** account a correct balance curve, by anchoring each
year-end to Quicken's own Net Worth Report instead of letting it drift on cash flows that never see
the holdings. Adds a "preserve today" calibration mode, because PS-anchoring drags a **feed-owned**
account's current balance back to a stale PocketSmith number.

Roadmap anchor: [project-roadmap.md#cr058](../current/project-roadmap.md#cr058). **Track: v3** — no
flags, no tenant context, nothing under `server/src/v2/db/`; verify on dev (`:3105`).
**Depends on:** [CR019](cr-019-quicken-import.md) §22 (the value-only promote whose blind spot this
closes) · [CR024](cr-024-fidelity-feeds.md) (the feed that owns these accounts' *current* balances) ·
[CR056](cr-056-investment-returns.md) (whose numbers this **does** move — see [§3.5](#35-what-this-does-to-cr056)).

**Reviews:** pass 1 (cr-technical-reviewer) **revise** — 9 blocking. Rev 2 addressed 5 cleanly
(B3/B4/B5/B6/B9); the re-check found rev 2 had **shipped two arithmetic defects in its own headline
numbers**, left the CR056 test vacuous, and *regressed* B8. Rev 3 below fixes all of it.
Across both passes the anchor arithmetic and the rollback inverse reproduced exactly against dev. What
did not survive: the **verification story** (invariant 1 was the construction inverted), an unmentioned
**sentinel** that voids anchors and can be reset by a Reconcile click, the CR's own **`quicken-verify`**
hard-failing twice under the design, a **migration pattern copied from CR057 that is already breaking
CI**, the calibration mode's storage and the target ingestion path, the CR056 coupling — and then, in
rev 2, a **wrong-signed reversal** and a **2022 anchor sized from the wrong date**.

Migration **042** — 041 is CR057's.

**Owner decisions:** anchors run **through 2022-12-28** · scope is **Fidelity Stocks (27) only** ·
the sentinel gets a **root fix plus a guard** · targets live in a **pinned CSV** · the 2020 anchor is
resolved by **correcting a PocketSmith double-count** (§1.3), not by absorbing it.

**Built:** `114f690` (migration 042) · `3fd09bc` + `a1c280e` (preserve-today) · `52445f8` (anchor
writer + pinned CSV) · `247b307` (quicken-verify). See [§9 Rollout](#9-rollout--as-executed).

---

## 1. Problem

[CR019 §22](cr-019-quicken-import.md#22-investment-side--value-only-promote-2026-06-01-descope)
descoped the lot walker: a brokerage account is promoted as a plain balance-sheet asset, trades are
**neutral**, and only income legs and transfers reach the ledger. That is the right call for cost
basis, but it leaves the ledger tracking **cash only**. Holdings are invisible, so any year where the
cash/securities split moved produces a wrong balance, and the error compounds across 25 years.

Measured on dev after importing `fid_brokerage.QIF` (1998-03-21 → 2019-12-31) onto **Fidelity Stocks
(27)**, batch `f1fdf550`:

| | 1998 | 2008 | 2013 | 2019 |
|---|---:|---:|---:|---:|
| Ledger after import | 903,923.68 | 730,053.86 | 1,090,271.82 | 1,143,928.49 |
| Quicken's own report | 29,436.00 | 191,450.91 | 586,817.83 | 642,513.72 |
| **Overstated by** | **874,487.68** | **538,602.95** | **503,453.99** | **501,414.77** |

The reconstructed history overstates the account by **500K–874K** at every year-end. The CR019
backfill cannot ship for Fidelity without this.

*Rev 5 corrected this table's direction.* Revs 1–4 said "every pre-2020 year is **negative** … worse
than the pre-import state (a flat −302,785.91 plug)". Both halves were invalidated by §1.3's own
fixes, which moved `opening_balance` by 1,446,714.40, and by the switch to `preserve-today`. The
error was always the same size; only its sign relative to the plug changed. The pre-import state is
in fact a **flat 1,133,128.49 running back to 1990** against a true 1998 value of ~29,436 — which is
the real argument for this CR, and is the largest single pre-2020 distortion in the ledger. Every
other account carrying a pre-2020 plug is under 55K.

Reproduce the ledger column:

```sql
SELECT y, (a.opening_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t
         WHERE t.account_id = 27 AND t.transaction_date <= make_date(y,12,31)
           AND t.transaction_date >= a.opening_balance_date),0))::numeric(14,2)
  FROM accounts a, generate_series(1998,2022) y WHERE a.id = 27 ORDER BY y;
```

### 1.1 Why the ledger goes negative — worked example, 2008

The ledger recorded **−224,423.46** of flows in 2008 (100,000 out on 10-03, 100,000 on 10-15, 40,000
on 10-17, 38,057.96 to `Reserve for Tax`, …, net of dividends). The account's value barely moved:
**209,002.80 → 191,450.91**, a fall of 17,551.89. Both are true, because the withdrawals were funded
by selling securities:

```
Sell   1,127,093.39   (21 rows)
Buy      902,426.37   (32 rows)
       ──────────────
net    +224,667.02  of cash raised   ≈  the −224,423.46 that left the account
```

Under value-only the sales are neutral and the holdings reduction is untracked, so the ledger sees
only the withdrawal. Algebraically:

```
cumulative anchor  =  securities MV  −  cumulative net purchases  +  constant
annual anchor      =  ΔMV  −  net purchases in the year
```

which is why heavy liquidation (2008) or heavy deployment (2010) throws a large anchor while the
account's value hardly moves.

### 1.2 The second problem — calibration drags today backwards

`recalibrate` ([quicken-promote.js:657](../../server/src/v2/scripts/quicken-promote.js#L657)) is
**PS-anchored** per [CR019 §22.1](cr-019-quicken-import.md#221-calibration-redesign--ps-anchored-2026-06-01):
it pins today's computed balance to the latest non-Quicken `closing_balance`. That reasoning was
sound for PS-only cash accounts, whose "today" was wrong pre-import. It fails for Fidelity: CR024
wired these accounts to `feed_balances`, and PocketSmith stopped updating them in May 2026.

| Account | Before promote | After promote (stale PS anchor) | Damage |
|---|---:|---:|---:|
| Fidelity Stocks (27) | 1,157,037.74 | 1,114,485.03 | **−42,552.71** |

Measured on dev. Accounts 26 and 30 show the same class of drift but are **out of scope** (§6).

### 1.3 The 2020 anchor was a PocketSmith double-count — *rev 3*

> **Account-number correction — 2026-07-30.** This section identifies counterparties by reading the
> Fidelity account numbers out of PocketSmith's description text. Custodian statements
> ([CR061](cr-061-holdings-and-prices.md), parser `parse-fidelity-statement.js`) since established
> today's mapping by exact-to-the-cent balance matches: **`Z31-443539` = Fidelity Stocks (27)**,
> **`X27-230910` = Fidelity *Bond* (31)**, `X94-929946` = Cash Mgt (30), `194-901660` = IRA (26). So a
> description saying "`X27-230910`" does **not** denote account 27, and prose below that reads it that
> way is wrong.
>
> **The corrections themselves are unaffected**, because none of them rested on the numbers. Each was
> established by Quicken's own `XOut` for the same event plus the counterparty ledger showing the money
> arrive — two independent records, agreeing. The numbers were narrative colour.
>
> What is *not* yet resolved is what `X27-230910` denoted in **2020**. Fidelity Bond is a real, separate
> account — on 2024-06-09 account 27 sent it 421,630.00 and it transferred securities to `Z31-443539`
> the next day, so the two coexist — but fin did not track it until **2024-06-07**. Either the numbers
> were re-registered at some point, or `X27-230910` existed untracked all along and PocketSmith
> attributed its 2020 debit to account 27. Both readings leave household net worth and the anchors
> unchanged, and both leave the sign corrections correct; only the attribution of one leg is in
> question. Logged for the statement backfill, which can settle it from the custodian's side.
>
> *The transferable lesson: an account number inside a transfer description is the **counterparty's**
> text, not an identifier of the row's own account, and it is not stable enough to reason from. Use a
> balance match against an authoritative statement.*

Rev 2 extended the series through 2022 and produced a **2020 anchor of −1,445,246.13** — larger than
the cliff it was meant to remove, and sitting mid-chart. The re-check was right to reject it, and
right that it was "papering over a data defect". But the defect is not the mis-categorised
`Financial Income - Other Investments` row that CR056 flagged and CR057 deferred: recategorising a row
does not move a balance. **The defect is a sign.**

On **2020-08-26** a transfer of **617,957.20** moved from Fidelity Stocks to Fidelity Cash Mgt.
PocketSmith booked it as a **credit on both accounts**:

| | Account | Amount | Description |
|---|---|---:|---|
| prod tx **14027** | Fidelity Stocks (27) | **+617,957.20** | `Transferred From Vs X27-2309 (TRANSFERRED FROM VS X27-230910-1)` |
| prod tx **11429** | Fidelity Cash Mgt (30) | +617,957.20 | `TRANSFERRED FROM VS X27-230910-1` |

There is **no opposing leg anywhere in the ledger** — the cluster does not net to zero, so money
arrives in two places from nowhere. Quicken records the same event correctly, as
`XOut −617,957.20` to Fidelity Cash Mgt (staged in this batch, then cutoff-dropped), and the
counterparty ledger confirms the direction: account 30 shows the money *arriving*. Account 27's row
should be **−617,957.20**; the overstatement is **1,235,914.40**.

It went unnoticed for six years because `opening_balance` is a plug that absorbs it — the same shape
as the Black Card incident, where a $8.4K duplication netted to +$267 and no balance check could see
it. A sweep of every `is_transfer` PocketSmith row ≥ 10,000 for same-signed same-amount pairs within
±3 days found this as the only *unnetted* cluster affecting account 27. (Naive same-sign matching
also flags legitimate three-account same-day chains, which net to zero; the 800,000 and 300,000
clusters self-cancel **on account 27** and do not affect its anchors. An apparently unpaired
`Fidelity Cash Mgt −800,000.00` on 2022-06-14 is logged for the account-30 work, not owned here.)

**A second row of the same class** was then found by the same sweep, on **2020-11-04**: prod tx
**14081**, `+100,000.00` `"ELECTRONIC FUNDS TRANSFER PAID"`, paired against a **Chase Checking
+100,000.00 `Fid Bkg Svc`** row from the Quicken import — both legs positive, and "PAID" is outgoing.
*(Not the two Feb-2020 `Fid Bkg Svc` rows CR056 identified as genuine deposits — ids 13956 and 13969
are different rows and are untouched, so CR056's finding stands.)*

**Correcting both collapses the 2020 anchor from −1,445,246.13 → −209,331.73 → −9,331.73** — 2.4% of a
383,389.13 account, alongside 2021 at −16,930.58. Every other interior anchor is byte-identical,
because only one year's flows changed. That two independently-built reconstructions of the account
then agree on 2020 to within ~9K is far stronger corroboration than either row read alone; neither
would have been convincing on its own.

**Status: DONE.** Shipped as its own idempotent, name-guarded script
([`fix-ps-transfer-signs.js`](../../server/src/v2/scripts/fix-ps-transfer-signs.js), `f99a8c6`) —
dry-run by default, resolves accounts by name per CR019 §22.2, re-plugs `opening_balance` by the same
1,435,914.40 and **aborts if today's balance moves**. Applied to dev and prod 2026-07-28 with a named
backup at `Backups/pre-ps-sign-fix/`; prod's current balance verified unchanged at 1,157,037.74, and a
re-run confirmed as a no-op. Deliberately **not** CR058 feature work — same treatment as the parser
fixes (`d4bf7da`) and the §4.2 sentinel fix. CR058's anchor table is derived from the corrected
ledger.

**The other 13 clusters are NOT this defect and were left alone.** The sweep covered every
`is_transfer` row ≥ 1,000 — 15 same-signed multi-account clusters out of 903. Two more of the same
shape sit on **Fidelity Cash Mgt** (2021-07-19 / 2021-11-05, out of scope); one on account 27
(2022-06-14, −800,000) **self-cancels within 2022** so it moves no anchor; and several are legitimate
— the 2026 Wise pairs are a EUR→USD conversion plus a deposit, which correctly shows two credits.
Triage of the remainder is separate work.

---

## 2. Source of truth — Quicken's Net Worth Report, and why it is trustworthy

> ### 2026-07-30 — the report was checked against the custodian, and it holds (except 2022)
>
> Fidelity's own statements, parsed by [`parse-fidelity-statement.js`](../../server/src/v2/scripts/parse-fidelity-statement.js),
> give an **independent** valuation of the same account (`X27-230910`) at the same year-ends. Nothing
> connects the two records. They agree:
>
> | year-end | Quicken (this CR's target) | Fidelity statement | diff | |
> |---|---:|---:|---:|---|
> | 2016 | 733,288.25 | 733,460.95 | −172.70 | −0.024% |
> | 2017 | 575,743.37 | 575,709.73 | +33.64 | **0.006%** |
> | 2018 | 349,691.82 | 349,997.13 | −305.31 | −0.087% |
> | 2019 | 642,513.72 | 642,495.03 | +18.69 | **0.003%** |
> | 2020 | 383,389.13 | 383,424.52 | −35.39 | −0.009% |
> | 2021 | 874,742.02 | 875,068.01 | −325.99 | −0.037% |
> | **2022** | 1,160,619.23 | **997,171.99** | **+163,447.24** | **+16.4%** |
>
> **Six of seven within 0.09%**, four under 0.04%, on balances of 350K–875K. §2's original warrant was
> an *internal* share-and-price walk over Quicken's own price blocks — this is external corroboration
> of a kind the CR could not produce for itself, and it is far stronger.
>
> **2022 is a single outlier with a mechanical cause.** The QIF's last transaction is **2022-11-25** —
> Quicken stopped being maintained, so a report "as of 12/28/2022" priced stale holdings. The custodian
> trajectory makes the old figure impossible anyway: 1,133,114.89 at 09-30 → 997,171.99 at 12-31 cannot
> pass through 1,160,619 on 12/28 without a 27K rise then a 163K fall in three days. §2 always said the
> walk reconciled in only **22 of 24** years; 2022 is one of the two, and rev 3 trusted the report there
> regardless.
>
> **Change applied:** the pinned CSV's last row is now `2022-12-31,997171.99`, replacing
> `2022-12-28,1160619.23`. Re-anchored on dev and prod — the 2022 anchor falls from **+378,131.96 to
> +213,903.40** (the largest interior anchor, down 43%), Σ and the handoff reversal move to
> **∓321,173.66**, today is unchanged at 1,157,037.74 and all 26 targets still tie. Tables further down
> that quote the old figures are the as-designed record; this note supersedes them.
>
> *The growing reversal is not a regression — it is the 2023-onward era, which the custodian shows is
> still uncorrected, no longer being masked by a too-high 2022 target. Closing it is the CR061 backfill.*

`Samples/Downloads/fid_quickenMV.xlsx` — *"Net Worth Report — As of 12/28/2022 … (Includes unrealized
gains)"*, one row per account, one column per year-end 12/31/1999 → 12/28/2022.

**This is the strongest evidence in the CR and the whole basis for the targets.** A throwaway share
walker — written only to validate, never to ship — reconstructed positions from the QIF's own
`!Type:Invst` events and priced them from its 384,172 `!Type:Prices` entries. Two fully independent
reconstructions of a 25-year portfolio agreed **to the cent in 22 of 24 years**:

| Year | Report | Independent walk | Δ |
|---|---:|---:|---:|
| 1999–2007, 2009–2013, 2015–2022 | — | — | **0.00** (22 years) |
| 2008 | 191,450.91 | 188,051 | −3,400 (one position carries no price in the file) |
| 2014 | 719,821.95 | 720,768 | +946 |

That agreement, not any invariant this CR asserts, is what justifies the target series. **1998 has no
report column**; the walk gives **29,436.00**, the one target the report cannot corroborate (§10 Q2).

Practical consequence: the QIF used for the import needs **no** price or security blocks — the 697 KB
transactions-only export suffices, well inside the 25 MB upload cap.

---

## 3. Design

### 3.1 The anchor series

Anchors are **sequential** — each computed against the balance *after* all prior anchors:

```
anchor(Y) = target(Y) − [ ledger(Y) + Σ anchor(y) for y < Y ]
```

Measured on dev against the **corrected** ledger (§1.3), under `preserve-today` calibration (§3.4),
with each anchor dated to its own report column — the last is **12-28**, not a year-end.
**Σ = −156,945.10**, so the handoff reversal is **+156,945.10**.

The `+ prior anchors` column is kept so `anchor = target − (ledger + Σ prior)` is checkable from the
table alone.

| Anchor date | Ledger | + prior anchors | Target | **Anchor row** |
|---|---:|---:|---:|---:|
| 1998-12-31 | 903,923.68 | 0.00 | 29,436.00 | **−874,487.68** |
| 1999-12-31 | 922,408.73 | −874,487.68 | 51,950.03 | 4,028.98 |
| 2000-12-31 | 930,455.94 | −870,458.70 | 49,151.96 | −10,845.28 |
| 2001-12-31 | 940,395.34 | −881,303.98 | 60,249.04 | 1,157.68 |
| 2002-12-31 | 957,973.47 | −880,146.30 | 63,126.86 | −14,700.31 |
| 2003-12-31 | 966,570.45 | −894,846.61 | 89,013.63 | 17,289.79 |
| 2004-12-31 | 879,561.58 | −877,556.82 | 1,027.85 | −976.91 |
| 2005-12-31 | 879,576.58 | −878,533.73 | 1,198.68 | 155.83 |
| 2006-12-31 | 965,988.40 | −878,377.90 | 103,433.38 | 15,822.88 |
| 2007-12-31 | 954,477.32 | −862,555.02 | 209,002.80 | 117,080.50 |
| 2008-12-31 | 730,053.86 | −745,474.52 | 191,450.91 | **206,871.57** |
| 2009-12-31 | 747,179.38 | −538,602.95 | 258,467.01 | 49,890.58 |
| 2010-12-31 | 807,674.41 | −488,712.37 | 434,194.82 | 115,232.78 |
| 2011-12-31 | 786,317.17 | −373,479.59 | 281,922.02 | −130,915.56 |
| 2012-12-31 | 969,376.55 | −504,395.15 | 466,470.05 | 1,488.65 |
| 2013-12-31 | 1,090,271.82 | −502,906.50 | 586,817.83 | −547.49 |
| 2014-12-31 | 1,216,418.29 | −503,453.99 | 719,821.95 | 6,857.65 |
| 2015-12-31 | 1,249,538.79 | −496,596.34 | 670,808.13 | −82,134.32 |
| 2016-12-31 | 1,266,493.84 | −578,730.66 | 733,288.25 | 45,525.07 |
| 2017-12-31 | 1,069,537.16 | −533,205.59 | 575,743.37 | 39,411.80 |
| 2018-12-31 | 895,451.93 | −493,793.79 | 349,691.82 | −51,966.32 |
| 2019-12-31 | 1,143,928.49 | −545,760.11 | 642,513.72 | 44,345.34 |
| 2020-12-31 | 894,135.63 | −501,414.77 | 383,389.13 | **−9,331.73** |
| 2021-12-31 | 1,402,419.10 | −510,746.50 | 874,742.02 | −16,930.58 |
| **2022-12-28** | 1,317,564.33 | −527,677.08 | 1,160,619.23 | **+370,731.98** |

> **Superseded in three rows by the 2026-07-29 sign-fix wave** ([§9.2](#92-second-sign-fix-wave--2026-07-29)).
> The table below is the as-designed record and is left intact. What changed after five further
> PocketSmith sign defects were corrected at source: **1998-03-20 → −931,889.73**, **2021 → +33,069.42**,
> **2022-12-28 → +378,131.96**. Σ, the reversal, and **every other row including 2020's −9,331.73 are
> unchanged** — a uniform lift of the pre-2021 ledger is absorbed entirely by the first anchor and
> cancels out of each interior one.

The **1998 row is the opening plug** (−874,487.68), not market movement — it absorbs the whole-life
difference between the account's calibrated `opening_balance` and its true 1998 value, and sits at the
series *start* where a plug belongs.

**The largest interior anchor is 2022-12-28 (+370,731.98)**, not 2008 (+206,871.57) — 1.8× larger, and
the second-biggest row in the table after the plug. Rev 4 said 2008; that was wrong, and it matters
because §7 has to disclose the 2022 anchor and the 2023-01-01 reversal as **one join**, not two.
**2020 is −9,331.73**, down from −1,445,246.13 in rev 2, because the three sign errors behind it were
corrected at source rather than absorbed (§1.3).

Revs 4 and 5 regenerated this table from the progressively-corrected ledger. Across both, only the
**1998** (plug) and **2020**/**2022** rows moved; every other anchor is byte-identical to rev 3,
as it must be, since only those years' flows changed. **Σ is invariant to the sign fixes** — it is
pinned by today's balance, which the correction script preserves, so a fix before the last anchor
moves the plug and one interior row in equal and opposite amounts.

**Rev 3 fixed two arithmetic defects rev 2 shipped:**

- **The 2022 anchor was sized from the wrong date.** The target is "as of 12/28/2022", but rev 2 used
  the 12-31 ledger. Twelve PocketSmith dividends land on 12-30, so the two differ by **781.32** and the
  anchor missed by exactly that. Anchoring at 12-28 is correct: those dividends are real income
  received *after* the valuation date and should ride on top, putting 2022-12-31 at 1,161,400.55.
- **The reversal's sign was backwards** (see §3.2).

The writer computes `ledger(Y)` with the sentinel clause
(`AND t.transaction_date >= a.opening_balance_date`) — pinned here because omitting it is a
demonstrated bug shape in this codebase (`reconcileToFeed.calibrate`'s `sumTx`, `mtm`'s `computed`,
both unfiltered) and is exactly what invariant 1 exists to catch (§5).

**Granularity is annual** and is a **parameter**, not a constant — targets come from a CSV (§3.6), so
re-running monthly is a different CSV, not a code change. The sawtooth between anchors is real: within
2008 the balance still runs to −15,421 before the year-end anchor lifts it to 191,451.

### 3.2 Range and the handoff reversal — *rev 2*

**Rev 1 anchored pre-2020 only and reversed at 2020-01-01.** Pass 1 established that this does not
remove the discontinuity, it relocates it: a **−987,852.34 vertical cliff on 1 Jan 2020**, i.e. 154%
of the 2019 balance, on the exact chart this CR exists to fix.

**Rev 2 ran the series through 2022-12-28** — the report's last column — with the reversal at
**2023-01-01**. Two corrections in rev 3:

- **The reversal is `−Σ`, and Σ is negative, so the reversal row is POSITIVE: +156,945.10.** Rev 2
  wrote it negative, carrying the sign from rev 1 where Σ was positive; implementing from rev 2 would
  have landed twice Σ out. Rev 3 fixed the sign, but rev 4 then left **two different values** in this
  section — the same defect class, one revision later. There is now exactly one figure, agreeing with
  §3.1, §7 and §11: **+156,945.10**.
- **"8.6× smaller" was true of the reversal row and false of the series.** Rev 2 removed a −987,852.34
  cliff at 2020-01-01 and introduced a −1,445,246.13 anchor at 2020-12-31 — 1.46× *larger*, and
  mid-chart rather than at the edge. That is now resolved at source (§1.3): with the double-count
  corrected the 2020 anchor is **−9,331.73**, smaller than most of its neighbours, and the reversal is
  **+156,945.10**, landing on a real regime boundary (Quicken retired; bank-feed took over).

This extends anchoring across the 2020–2022 PocketSmith overlap, which reverses the earlier
"PocketSmith owns 2020+" boundary **for balances only** (PS still owns the transactions; anchors add
no transaction history). The evidence for preferring the report there:

- PS's `closing_balance` on this account is **not an independent valuation**. Its first 2020 row is
  −302,680.91 against an amount of 105.00, so the implied prior is −302,785.91 — which was, at the time
  this was checked, exactly the account's `opening_balance` plug. (§1.3's corrections have since moved
  that plug to 1,133,128.49; the point stands — PS was accumulating flows from a base it never
  observed, so its balances track its own arithmetic rather than the market.)
- The report reproduced an independent share-and-price walk to the cent in 22 of 24 years (§2).

Everything from 2023-01-01 forward is byte-identical to today, keeping this CR additive and cleanly
reversible — the property that made the rehearsal's rollback exact. This is the
[§22.3 `retire-handoff.js`](cr-019-quicken-import.md#223-retire-handoffjs--scripted-historical-account-handoff-2026-06-02)
pattern: one dated row zeroing an era's cumulative effect at a boundary.

### 3.3 Where anchors post — a new non-P&L leaf

New COA leaf **`Valuation - Historical`** under the **Transfers** parent, `is_transfer = TRUE`,
`skip_transfer_analysis = TRUE`, `account_type = 'expense'`, `section = 'profit_loss'`.
`skip_transfer_analysis` matters: an anchor has no counterparty and must never sit in
[/transfer-analysis](../current/project-description.md) as perpetually unmatched — the treatment
[CR019 §4.3](cr-019-quicken-import.md#43-existing-tables--minor-changes) gave `Return of Capital`.

**Correction from rev 1.** Rev 1 claimed "P&L reports exclude `is_transfer` rows". That is not the
mechanism. `extractTransferCategories`
([reports.js:362](../../server/src/services/reports.js#L362)) is a **name match** — it walks the P&L
tree collecting leaves under nodes whose *name* contains "transfer". `Valuation - Historical` is
excluded from Cash Flow because its **parent is named `Transfers`**, not because of the flag. The
outcome is right; the stated reason was wrong, and a future session would have relied on it.

#### Why not `Unrealized G/L`

`Unrealized G/L` (88) is CR056's unrealized numerator, so routing anchors there would light up
pre-2020 Investment Returns for free. **Rejected** — each anchor is a mixture, and three ingredients
are not market movement:

1. **Liquidation timing.** 2008's +206,871.57 is securities sold to fund withdrawals (§1.1). Booking
   it as a 2008 unrealized *gain* would be conspicuously false.
2. **Money-market sweep churn.** `FIDELITY CASH RESERVES`, `FIDELITY CASH`, `FIDELITY SELECT MONEY
   MARKET` are $1.00 cash vehicles Quicken records as securities — only **15 rows / ~535,000 across
   25 years**, but **512,925 of it falls in 2008**, 45% of that year's "sales".
3. **Gaps in Quicken's own share history.** CEDC sells **8,000 shares in May 2008** when the walk
   shows 500 held (750 post-split). Life-to-date it balances (32,500 bought + 6,667 `ShrsIn` against
   39,417 sold), so the timing is wrong, not the totals. Upstream data, not an import defect.

CR056 spent two review passes removing exactly this failure mode — a confident, precise, wrong return
percentage. **Pre-2020 Investment Returns will show realized income only** (the 2,815 imported
dividend/interest rows are genuine income, on the right account, in the right period) and no
unrealized figure. Reclassifying later is an `UPDATE`: every anchor carries `import_batch_id` and one
category, so if CR020's lot walker lands the decomposition can be done retroactively.

### 3.4 "Preserve today" calibration mode

`recalibrate` gains a **mode**, persisted per batch (§4):

| Mode | Rule | For |
|---|---|---|
| `ps-anchored` *(default)* | `opening_balance := ps_close − Σ(all tx)` | PS-only cash accounts whose "today" is wrong pre-import (CR019 §22.1) |
| `preserve-today` *(new)* | `opening_balance −= Σ(this batch's rows)` | Accounts whose current balance is already correct — feed-owned (CR024) |

The audit row (`quicken_calibration_audit.delta_amount = old_ob − new_ob`) is unchanged, so rollback's
deterministic inverse still holds — confirmed in pass 1, and confirmed empirically by the rehearsal's
exact rollback.

**`preserve-today` is the pre-§22.1 formula that CR019 §22.1 declared broken**, and the CR must say so
rather than quietly reinstate it. §22.1's complaint was that it "neutralized the imported history …
every backfilled account collapsed to $0 at the PS handoff and ran a meaningless negative ramp before
it." That is still true — on account 27 it puts 2019-12-31 at 1,143,928.49 against a true 642,513.72.
It is safe here
**only because the anchors overwrite the historical curve**, which makes CR058 a hard prerequisite for
the mode. The mode must therefore refuse to run without an anchor plan for the same batch.

Mode selection is **explicit**, never inferred from "does this account have a feed mapping" — that
would couple the importer to the feed cache and inherit its staleness failure modes, the standing
lesson of the Black Card incident.

### 3.5 What this does to CR056 — *rev 2, correcting rev 1*

Rev 1's header called CR056 "the report this deliberately does **not** feed." **False.**
`bucketOf` ([investmentReturns.js:415](../../server/src/services/investmentReturns.js#L415)) branches
on `row.is_transfer` → bucket **`flow`**. So anchors *do* appear in `/investment-returns`, as named
`Valuation - Historical` flow rows.

More consequentially, `fetchMvByBoundary` uses the additive basis, so anchors change **beginning and
ending MV and average capital** for every affected period. Fidelity Stocks' 2020 **beginning MV moves
DOWN, from 1,143,928.49 to 642,513.72** — a fall of 501,414.77. **CR056 shipped 2026-07-27 and the owner has looked at these numbers.**

*Rev 5 corrected the direction of this paragraph.* Revs 1–4 claimed the 2020 beginning MV moves *up*
from −345,338.62 and that "pre-2020 realized-% denominators go from large negatives to real numbers".
Both were artefacts of the rev-1, uncorrected, PS-anchored world. Prod holds **zero** transactions on
account 27 before 2020-01-01, so its pre-2020 MV is a flat 1,133,128.49, and under the corrected
ledger every pre-anchor year-end is positive (879,562 – 1,266,494) — no denominator was ever negative.
The change is a **correction downward**, not a rescue from nonsense. It is still a change to a
just-shipped report, owned here rather than discovered later. The falsifiable claim, replacing rev 1's
wrong one: **anchors bucket as `flow`, never as `price`; `priceReturn` for every period is unchanged
to the cent.** Confirmed algebraically and on dev — anchors shift `emv − bmv` and `netFlows`
identically, so `totalReturn` is invariant (2019–2022 measured unchanged to the cent).

**The test for it must not run on a zero numerator.** `priceReturn` for account 27 is 0.00 in every
year 2019–2022 both before and after, because there are no `Unrealized G/L` postings in that window —
a test over that span passes because the numerator is zero, not because anchors were excluded. It must
run over a span where `price ≠ 0`. Account 27 carries **18 `Unrealized G/L` rows**, 16 of them
`pocketsmith`-sourced — **12 in calendar 2025, netting +131,811.45**. Use 2025: a full calendar year
with twelve marks is a far better span than two rows straddling mid-2026.

Two further impacts, owned here: `returnPctUnrealized` also moves (same numerator, new denominator),
and `coverageShare` weights by `|BMV|` per account, so the **`Fidelity Stock` parent roll-up (25)**
changes which columns get their percentage suppressed or badged.

### 3.6 Target ingestion — *rev 2*

Rev 1 specified no ingestion path at all, while claiming granularity was "a parameter, not a
constant". With constants in a script that claim is false, and it fails
[`.claude/rules/data-import.md`](../../.claude/rules/data-import.md) on dry-run, pinned fixture and
fail-loud parsing. The source `.xlsx` is **gitignored** (`.gitignore:34`), so it can never be a
fixture.

Targets live in a **pinned CSV**, `Samples/quicken/fixtures/valuation_targets_fid_brokerage.csv`:

```
as_of_date,target
1998-12-31,29436.00
1999-12-31,51950.03
…
2022-12-28,1160619.23
```

Parsed fail-loud, mirroring the seed-fx path already in `quicken-import.js`
(`parseFxCsv` / `seedFxRates` / `runSeedFx`): headers matched case-insensitively with BOM/whitespace
trimmed, a missing or non-numeric `target` is a hard error (never a `0` default on a money field), and
a zero-row parse is an error, not a silent success. Dry-run is the default; `--apply` writes.

---

## 4. Data model

### Migration 042 — `042_valuation_anchors.sql`

Two things:

1. **`Valuation - Historical` leaf.** Created if absent, name-guarded ⇒ idempotent, with
   `is_transfer = TRUE`, `skip_transfer_analysis = TRUE`, `account_type = 'expense'` (NOT NULL, and
   both flags default FALSE — the CR057 silent-failure class), and a fail-loud assertion on the flags
   afterwards.

   **The parent id must be looked up by name, not hard-coded.** Rev 1 said "follow CR057's pattern";
   pass 1 found that pattern is **already breaking CI**: `041_income_restatements.sql` hard-codes
   `parent_id = 200`, which is correct on dev and prod but not on the migrations-only database CI
   builds, where `022_quicken_import.sql` creates `Transfers` with a serial id. Use 022's own pattern
   instead — `SELECT id INTO transfers_parent_id FROM accounts WHERE name = 'Transfers'` with a
   `RAISE EXCEPTION` guard. *(CR057's 041 needs the same fix; raised separately, not owned here.)*

2. **`quicken_import_batches.calibration_mode`** — `TEXT NOT NULL DEFAULT 'ps-anchored'` with a CHECK
   constraint. Rev 1 said "no new tables" and gave the mode nowhere to live, while
   `POST /batches/:id/promote` ([quickenImport.js:474](../../server/src/v2/routes/quickenImport.js#L474))
   calls `runPromote({ batchId, pool })` and **ignores the request body entirely**. Persisting it on
   the batch — the way `cutoff_overrides` already is — means re-promote after rollback
   (CR019 §6.5.6) keeps the mode instead of silently reverting to `ps-anchored`, and adds no
   request-body surface that could join CR046/CR047's list of silently-dropped fields.

Plus a row in [`docs/current/migrations.md`](../current/migrations.md).

Anchor rows are ordinary `transactions`:

| Column | Value |
|---|---|
| `account_id` | the brokerage account |
| `category_id` | `Valuation - Historical` |
| `transaction_date` | the anchor date, or the handoff date for the reversal |
| `amount` / `base_amount` | the computed anchor, rounded to 2dp before insert |
| `closing_balance` | **always NULL** — `recalibrate`'s `ps_close` subquery selects any non-`quicken-import` row with a non-null `closing_balance`, and would otherwise pick these up |
| `source` | `quicken-valuation` |
| `import_batch_id` | the CR019 batch being anchored |
| `accepted` / `transfer_matched` | `TRUE` / `FALSE` |

Carrying `import_batch_id` means CR019 §6.5's `DELETE FROM transactions WHERE import_batch_id = …`
removes the anchors with the batch — confirmed in pass 1 against `runRollback`, and since
Σ(anchors) + reversal = 0 exactly, the calibration-audit inverse is unaffected.

**All anchors for an account are written in one transaction.** They are a set that must net to zero; a
partial write leaves the account off by the missing rows.

### 4.1 `quicken-verify` must change — *rev 2*

Rev 1 put `quicken-verify` in the rollout while introducing two things that make it **hard-fail**
(both reproduced in pass 1 against dev):

- **Check 2, single-source** ([quicken-verify.js:103](../../server/src/v2/scripts/quicken-verify.js#L103))
  counts `DISTINCT source` over the batch → 2 with anchors present → `FAIL: batch spans 2 sources`.
  Check 1 also reports `min(source)` as *the* source, silently misreporting. Needs a source
  **allow-list** (`quicken-import` + `quicken-valuation`).
- **Check 5, balance-invariant** ([quicken-verify.js:179](../../server/src/v2/scripts/quicken-verify.js#L179))
  asserts `computed == ps_close` — precisely what `preserve-today` is designed to violate
  (1,157,037.74 vs 1,114,485.03 on dev). Must branch on the calibration mode; under `preserve-today`
  the meaningful comparison is against `bankfeed_balances`, not `closing_balance`.

Without this the CR ships a design that makes its own verifier report two failures.

### 4.2 The `opening_balance_date` sentinel — *rev 2*

Every balance query filters `t.transaction_date >= a.opening_balance_date`, and both reconcile
services do:

```sql
UPDATE accounts SET opening_balance = $2, opening_balance_date = '2000-01-01' WHERE id = $1
```

— [reconcileToFeed.js:235](../../server/src/v2/services/reconcileToFeed.js#L235),
[reconcileManual.js:234](../../server/src/v2/services/reconcileManual.js#L234) — while computing
`sumTx` over **all** transactions with no sentinel filter. The write is therefore **already
internally inconsistent** for any account holding pre-2000 rows: after calibrating, the displayed
balance does not equal the `expected` it calibrated to.

Prod carries **9 balance-sheet accounts** on that sentinel but only **1 pre-2000 row (1,950.61)**
today, so live exposure is negligible. It becomes **47,918.98** on account 27 the moment the Fidelity
import lands, and **−870,458.70** more once the 1998–99 anchors exist (they now net negative, so a
sentinel reset would swing the balance the other way) — pass 1 reproduced a
**−666,727.39** swing on dev. Reconcile is part of the weekly loop, not a rare admin action.

**Fix, committed separately from this CR's feature work** (its own revert boundary, as the parser
fixes got): stop both services writing `opening_balance_date` at all — since `sumTx` is unfiltered,
leaving the sentinel alone is strictly more correct than setting it to `2000-01-01`. Verified safe:
nothing reads the sentinel expecting `2000-01-01`, and neither `calibrate()` nor `mtm()` reads it.

**This stops the bleeding; it is not the root.** Rev 2 overclaimed. The root is that
`reconcileToFeed.calibrate` (`sumTx`), `reconcileManual.calibrate` (`sumTx`) and `reconcileToFeed.mtm`
(`computed`) all sum **unfiltered** while every read is filtered, and
[`accounts.js:272`](../../server/src/v2/repositories/accounts.js#L272) still **defaults new accounts
to `'2000-01-01'`**, so accounts keep being born on the bad sentinel. Carrying the sentinel clause into
those three sums is the real fix; logged as a follow-up, not owned here.

**Guard, in this CR:** the anchor writer fails loud on any anchor date earlier than the account's
`opening_balance_date`, rather than silently writing rows that no balance query will ever see.

---

## 5. Reconciliation invariants — *rev 2, rewritten*

Pass 1's headline: **rev 1's invariant 1 could not fail.** Since
`anchor(Y) := target(Y) − [ledger(Y) + Σ prior]`, the tie-out `balance(Y) = target(Y)` is the
construction inverted — it holds for *any* target vector, including a corrupt one. Rev 1's proposed
fault injection had the same defect: perturbing a target before the run changes the anchor by the
same amount and the tie-out still closes.

| # | Invariant | Can it fail? |
|---|---|---|
| 1 | **Cross-implementation tie-out.** The verifier recomputes each anchored date with the **Balance Sheet's own query** ([reports.js:65](../../server/src/services/reports.js#L65)) and asserts equality to 1¢. | **Yes — and it already has.** *Not* on the sentinel class, which §4.2's guard aborts before this runs. It catches **date-boundary** and **filter** divergence: rev 2's 2022 anchor was sized from the 12-31 ledger against a 12-28 target, and this check fails it by **781.32** (§3.1). The other live shape is a writer computing `ledger(Y)` unfiltered by the sentinel. |
| 2 | **Handoff neutrality.** Today's computed balance after anchoring equals the value captured before, within 1¢. | **Yes.** The anchor script captures its own before/after in the same transaction as the writes (`_pre_promote_balances` belongs to the promote transaction and does not exist here). |
| 3 | **Coverage is total.** Every year between the first imported transaction and the handoff has a target, or the run fails. Any year dropped is logged, never skipped silently. | **Yes.** |
| 4 | **Targets parse.** Missing/non-numeric target, or a zero-row CSV, is a hard error. | **Yes.** |
| 5 | **Σ(anchors) + reversal = 0.00 exactly**, asserted before writing. | **Yes** — on a rounding bug. |
| 6 | **Idempotent.** Re-running deletes this batch's prior `source='quicken-valuation'` rows *before* re-reading the ledger, then recomputes. | Structural, per `retire-handoff.js`. |
| 7 | **`preserve-today` lands on the feed.** After anchoring, the account's computed balance must be within tolerance of `bankfeed_balances` at the reconcile as-of date. **Hard failure, not a warning** — a mode that leaves the balance off the feed has silently done nothing useful, which is the shape both CR056 and CR057 drew *revise* for. | **Yes.** |

**A read-only `--check` mode** re-runs invariants 1 and 2 against the pinned CSV without writing, and
reports drift. The *targets* are frozen forever (Quicken is retired; last column 2022-12-28), but each
anchor is `target − ledger` and **the ledger can still move** — any of the 13 untriaged clusters
(§1.3), a re-import, or a recategorization silently invalidates the series with nothing to notice,
because invariant 1 otherwise runs only at write time. The writer is already idempotent and the
targets are frozen, so the check costs a flag.

**Fault injection that actually fails:** perturb the target **seen by the verifier only**, after the
anchors are written, and assert the run aborts. Perturbing the writer's input proves nothing — the
anchor moves with it and the tie-out still closes.

Stated honestly: that injection tests the *verifier's wiring* — that it reads targets, compares and
aborts. It does not test that the anchors are right. Nothing in this CR can: correctness of the
targets rests on §2's independent agreement, not on any self-check.

---

## 6. Scope

**In:** Fidelity Stocks (27), end to end.

**Out, and why:** Fidelity IRA (26) and Fidelity Cash Mgt (30) — neither has a QIF export yet, and the
Net Worth Report currently carries a single `Fidelity Brokerage` row, so there is no target series for
either and no knowledge of their Quicken date ranges. Account 30 also carries the `2000-01-01`
sentinel and looks like a cash account on the evidence (228 interest-income rows against 5 dividend
rows pre-2022), though it does hold 80,733 of securities-trade transfers — to be settled with its own
export, not by inference. Also out: any non-brokerage account (PKO, Chase ×2, Santander are cash
accounts, already promoted and verified on prod); the CR020 lot walker; cost basis; per-security
anything; Fidelity Options and Fixed Income (created 2024+, no Quicken history, skipped by
[CR019 §24](cr-019-quicken-import.md#24-prod-cutover--live-per-account-loop-actual-2026-06-03--supersedes-23)).

---

## 7. Known limitations — stated, not hidden

- **The `Fidelity Stock` parent roll-up (25) becomes half-right.** After this CR it rolls up a
  corrected account 27 alongside a still-plugged 26 and 30 — a selectively-correct pre-2020 curve,
  which is harder to read than a uniformly wrong one. This is CR056's coverage lesson (printing a
  number while suppressing the % it implies) in a new place. **Decision needed before ship:** carry a
  marker on the roll-up, or accept the mixed curve until 26 and 30 are anchored. `coverageShare`
  weights by `|BMV|` per account, so the roll-up's suppression/badging behaviour changes either way.
- **The anchors are not a return series.** §3.3, item by item. They make the *balance* right; they do
  not decompose why.
- **The Quicken→feed join is +527,677.08 across four days, not the +156,945.10 reversal alone.**
  Measured across the boundary §9 step 4 tells the owner to eyeball:

  | | balance | |
  |---|---:|---|
  | 2022-12-27 | 789,887.25 | |
  | **2022-12-28** | 1,160,619.23 | ← anchor **+370,731.98** |
  | 2022-12-31 | 1,161,400.55 | (+781.32 of real dividends) |
  | **2023-01-01** | 1,318,345.65 | ← reversal **+156,945.10** |

  The anchor and the reversal sum to **527,677.08** and the whole four-day move is **528,458.40**.
  They are **one join in two steps**, and the larger step is the anchor, not the reversal. Revs 1–4
  disclosed only the reversal. Measured on dev with the full rev-5 anchor set applied. This is the irreducible
  disagreement between Quicken's valuation and the feed-anchored ledger: not eliminated, only moved to
  a real regime boundary.
- **Sawtooth between anchors, and it is large.** Annual granularity leaves the intra-year path on
  incomplete flows. Rev 2 cited 2008 (−15,421 mid-year against a real 191,451) as the worst case; that
  was off by two orders of magnitude. With the corrected series the intra-2020 path still swings
  several hundred thousand between anchors, because a year's transfers all land before the December
  anchor corrects them. Mitigated by a finer CSV — the report regenerates with monthly columns.
- **The 1998 anchor (−874,487.68) is an opening plug**, not market movement. It is the largest row in
  the series, and §10 Q2 settles its dating: it moves to the account's **first transaction date**
  rather than 1998-12-31, because otherwise Jan–Dec 1998 — the first year of the very chart this CR
  exists to fix — renders on the uncorrected curve, ~904K against an account worth ~29K.
- **1998 is walker-sourced**, not report-sourced.
- **Quicken's share history has gaps** (CEDC). They wash out at year-end boundaries — where the
  anchors sit — but the intra-year record cannot be trusted for anything finer.
- **Two report years disagree with the walk** by 3,400 (2008) and 946 (2014); the report is taken as
  authoritative in both.

---

## 8. Test plan

Constructed, not asserted — CR056 and CR057 both drew *revise* in pass 1 for test plans whose central
assertion could not fail, and so did rev 1 of this CR.

- **The invariant must be able to fail** — perturb the **verifier's** target after writing, assert
  abort (§5). A green tie-out over a series forced to tie is worth nothing.
- **Cross-implementation:** verifier uses the Balance Sheet query, writer uses its own. A test where
  both call the same helper is not testing anything.
- **Sentinel guard:** an anchor dated before the account's `opening_balance_date` must abort. Run it
  against an account with a `2000-01-01` sentinel.
- **Handoff neutrality:** anchor → assert today unchanged to the cent → roll back the batch → assert
  `opening_balance` and today both return to pre-promote values. The rehearsal already proved the
  plain promote/rollback cycle is exact (3,334 rows in and out; `opening_balance` −302,785.91 →
  −614,777.36 → −302,785.91, all pre-sign-fix; dev now sits at 831,937.04).
- **`preserve-today` vs `ps-anchored`:** the same fixture batch under both modes must produce
  *different* `opening_balance` values, and only `preserve-today` leaves the snapshot intact. A test
  passing under both is not testing the mode. Add the falsifiable check the mode is named for: the
  computed balance is within tolerance of `bankfeed_balances`.
- **Mode persists across rollback → re-promote** (CR019 §6.5.6).
- **`quicken-verify` passes with 2 warnings** once §4.1's two hard failures are fixed. It will WARN on
  time-overlap (the batch's upper bound becomes 2023-01-01, overlapping PocketSmith's 2020→2026 range)
  and on within-import duplicates. Rev 1's "8 passed / 1 warning" baseline does **not** reproduce, and
  the test must assert the new one rather than the old.
- **CR056 coupling:** anchors bucket as `flow`, never `price`; `priceReturn` unchanged to the cent —
  asserted over a span where `price ≠ 0` (§3.5), never over 2019–2022 where it is zero anyway.
- **Idempotency:** anchor twice; row count and balances unchanged.
- **Σ = 0 pre-write assertion**, and a zero-row / malformed CSV both abort.

---

## 9. Rollout — as executed

**Done. Dev 2026-07-28, prod 2026-07-29.** Both ledgers carry the identical series; §3.1's table
reproduced on prod to the cent.

Step 4 was executed with one deliberate substitution: prod was loaded by
**`copy-quicken-to-prod.js`** rather than a fresh QIF upload, per CR019 §23 G2. The parse and the 152
name mappings were already done on dev, and re-uploading would have meant re-mapping by hand with no
gain — the script copies staging + mappings, translating account ids by name, and resets the batch to
`mapped` so promote runs natively on the target. `calibration_mode='preserve-today'` copied verbatim
with the batch, which is exactly why §4 put it on the batch row rather than in a CLI flag.

Checked before applying: dev's 654 Fidelity staging ids (14682–15335) sit entirely above prod's
max (11939), so the script's `ON CONFLICT (id) DO NOTHING` could not silently skip a row. **A copy
into a target whose staging ids overlap would partially no-op without saying so** — check the ranges
before trusting the inserted counts.

| | dev | prod |
|---|---:|---:|
| Balance today (unchanged both sides) | 1,157,037.74 | 1,157,037.74 |
| `opening_balance` after promote | 874,489.75 | 874,489.75 |
| `quicken-import` rows | 3,334 | 3,334 |
| Anchor rows | 27 | 27 |
| Σ anchors / reversal | −156,945.10 / +156,945.10 | identical |
| `quicken-verify` | 7 pass / 2 warn / 0 fail | 7 pass / 2 warn / 0 fail |

Promote counts on prod: 328 standalone, 191 transfer rows, 2,815 investment income, 2,378 neutral
skipped, 135 + 812 dropped by cutoff, 1 account recalibrated. Both `quicken-verify` warnings are
expected by design — `time-overlap` is the anchors deliberately reaching into the PocketSmith-owned
era (2020-01-02 → 2023-01-01), and `within-import-dupes` is the same 7 groups / 8 rows reviewed on dev.

The step-4 stop-and-check paid for itself as insurance rather than as a catch: prod's ledger column
matched dev's at every one of the 26 dates before a single anchor was written, so the divergence it
guarded against did not occur. Post-write `--check` re-read the committed rows: all 26 still tie, 0.00
drift.

Backup taken first: `Backups/fin_backup_pre_cr058_20260729_011206.dump`.

Steps 2 and 3 turned out to be already done — migration 042 and the CR058 scripts rode to prod on the
other session's **v3.6.6** deploy, so this rollout was data-only. Verified in place before starting:
`Valuation - Historical` present as id 229 with `is_transfer` and `skip_transfer_analysis` both true,
and `quicken-anchor.js` present in the running container.

**Step 5 — `/investment-returns` before/after. DONE 2026-07-30**, and the result is more interesting
than "the numbers moved". Captured by calling `buildInvestmentReturns` from the working tree against
each database state rather than through a container, so the figures reflect current code; "before" was
reconstructed by rolling the batch back on dev, capturing, and restoring.

| Fidelity Stocks (27), annual | before | after |
|---|---|---|
| 1998–2019 market value | **flat 1,201,328 every year** | the real curve, 29,436 → 642,514 |
| 1998–2019 income | 0.00 in every year | real dividends/interest, ~440K total |
| Periods with a return % | 2025, 2026 only | **2025, 2026 only — unchanged** |
| `fxEffect` | 0 | **0** (all-USD invariant holds) |
| `unattributed` | — | **0 in every period** |

**The headline is the row that did *not* change.** For every year from 1998 to 2024 the report shows
`priceReturn = 0` and a return of **`—`**. The anchors are `is_transfer` rows, so CR056 buckets them
as **`flow`**, and a flow moves market value without generating return. So CR058 gives the account
22 years of *balance* history and deliberately **no** return series — and CR056, correctly, prints
`—` rather than inventing one, because no `Unrealized G/L` posting falls in those periods and its
coverage rule abstains.

That is exactly the outcome §3.3 argued for. Routing anchors to `Unrealized G/L` would have produced a
confident 25-year return series built on liquidation timing, money-market sweep churn and gaps in
Quicken's own share history. The report saying "I don't know" for 1998–2024 is the honest answer, and
it is worth the owner knowing that the new history is a **value** series, not a **performance** one.

*Not claimed:* the rolled-back "before" also showed wildly inflated income (2.57M in 2023). That state
is **not** a faithful reconstruction of pre-CR058 prod — a batch rollback leaves the nine PocketSmith
sign corrections in place, since they are not batch rows — so those figures are an artefact of a state
that never existed and are deliberately not reported as a before/after delta. What is verified is the
**current** state: `unattributed = 0` and sane income in every period.

### 9.2 Second sign-fix wave — 2026-07-29

Triaging the roadmap's outstanding sign clusters, hours after this CR shipped, found **five more
PocketSmith sign defects** on the Fidelity accounts. Applied to dev and prod (`fix-ps-transfer-signs.js`,
now covering nine rows across two accounts), then account 27 re-anchored.

**The method that found them is the reusable part.** The Fidelity QIF's 2020–2022 rows sit in
`quicken_staging` **cutoff-dropped and unpromoted** — they never entered the ledger, so they are an
*independent* record of exactly the era PocketSmith owns and cannot be circular evidence. Comparing
`sum(amount)` per `(date, magnitude)` bucket between the two systems isolates every disagreement in
one query; the ACH **PPD trace numbers** then prove that two rows describe one event. That is far
stronger than the same-signed-cluster heuristic, which produced 42 candidates of which most were
artifacts of its own ±3-day chaining.

| tx | Account | Date | Was | Now | Evidence |
|---|---|---|---:|---:|---|
| 14221 | Fidelity Stocks | 2021-04-09 | +25,000.00 | −25,000.00 | Quicken `XOut → Chase (C)`, **PPD 1035141375**; Chase's ledger shows the +25,000 arriving |
| 11572 | Fidelity Cash Mgt | 2021-07-19 | +20,000.00 | −20,000.00 | Chase Quicken row targets `[Fidelity Cash Mgt]`, **PPD 0368504603** |
| 11643 | Fidelity Cash Mgt | 2021-11-05 | +15,000.00 | −15,000.00 | Chase Quicken row targets `[Fidelity Cash Mgt]`, **PPD 1035141375** |
| 14725 | Fidelity Stocks | 2022-06-29 | +3,699.99 | −3,699.99 | Quicken `XOut → Fidelity EUR` |
| 14699 / 14705 | Fidelity Stocks | 2022-06-14/15 | −800k / +800k | +800k / −800k | both backwards vs Quicken; **nets to zero either way** |

**Anchor impact — smaller than it looks.** Only **three** anchors moved: 1998-03-20 → −931,889.73,
2021 → +33,069.42, 2022-12-28 → +378,131.96. **Σ and the reversal are unchanged at −156,945.10 /
+156,945.10**, and so is every interior anchor — including 2020's −9,331.73, the number §1.3 rests on.
The reason is structural: `opening_balance` re-plugs to hold today, lifting the whole pre-2021 ledger
by a constant, and a constant lift cancels between `ledger(D)` and `Σ prior anchors` in
`anchor(D) = target(D) − ledger(D) − Σ prior`. Only the first anchor and the periods where the lift
*changes* can move. An initial estimate that Σ would fall to −99,545.12 was wrong for exactly this
reason.

**`--check` caught the drift unprompted**, before any re-anchor — 25 of 26 dates, uniformly
+57,399.98 pre-2021. That is the failure mode §4.1 predicted (targets frozen, ledger still mutable)
arriving within a day of the feature that guards it.

**Honest note on corroboration.** The 2020 fix converged the two reconstructions (anchor −1.4M →
−9K), which was strong evidence. This wave does **not** converge — 2021 moves from −16,930.58 to
+33,069.42, slightly further from zero. On an 874,742 account that is noise, and the PPD-matched
evidence stands on its own, but it is weaker corroboration than §1.3's and is recorded as such.

**Left alone: 2022-11-02**, where the systems differ by ~187,689 across two magnitudes — Quicken has
+300,000 in from Cash Mgt and two −112,310.56 legs out to Fidelity EUR; PocketSmith has +300,000, a
−300,000 "YOU EXCHANGED", and one −112,310.56. That is a modelling difference over a USD→EUR
conversion, not a sign error, and resolving it needs the Fidelity statement. It is now the **only**
remaining disagreement between the two records for 2020–2022.

Verified after: all 26 targets tie, `quicken-verify` 7 pass / 2 warnings / 0 failures, today unchanged
at 1,157,037.74 on both stacks, 523 backend tests green. Backup
`Backups/fin_backup_pre_signfix2_20260729_015229.dump`.

#### 9.2.1 The fix shipped half-applied — `base_amount`

Reported by a parallel thread and confirmed on both stacks: `fix-ps-transfer-signs.js` ran
`UPDATE transactions SET amount = …` and **never touched `base_amount`**. Every row it had ever
corrected — all nine, both waves — kept the **old sign in `base_amount`**: 1,504,114.38 of divergence
on Fidelity Stocks, 70,000.00 on Fidelity Cash Mgt.

**It hid for exactly the reason the original defects did — the checks that existed read the column
that was right.** Everything this CR verifies against (`opening_balance` re-plug, the anchor tie-out,
`quicken-verify`, Balance Trends) reads `amount`. `base_amount` is the **USD** read path:
`refreshFromActuals` seeding forecast `base_value_usd` (account 27 maps to four forecast modules and
is a cash-sweep source, so a scenario copy would have seeded it ~1.5M rich — the CR045 §1 / CR049
shape), Cash Flow USD mode, budget summaries, and category totals. All nine rows sit on `is_transfer`
categories, so transfer category totals were affected too.

`/investment-returns` is what exposed it, and the reason is worth keeping: on an **all-USD** selection
its FX plug must be **exactly zero by construction**. It was reporting **−1,435,914** for 2020. A
quantity that is provably zero makes a far better detector than one that merely looks plausible.

Fixed the same day:

- The UPDATE now sets `base_amount = -base_amount`. **Negated, not copied from `amount`** — negating
  preserves whatever FX rate the row was booked at, so it stays correct for a non-USD row; copying
  `amount` would silently rewrite the rate to 1.0. For these USD rows the two are identical, which is
  precisely why the omission was invisible.
- A **repair pass** heals rows an earlier version half-corrected (matching on the *corrected* amount
  plus a diverging `base_amount`), so the script is self-healing and still idempotent.
- `currency='USD' ⇒ base_amount = amount` is asserted **inside the write transaction**, so a run that
  would leave a half-corrected row rolls back rather than commits, and again in
  `usdBaseAmountInvariant.test.js`. The test injects a deliberately-broken row and asserts on **that
  row's id** — never on a count or on "it resolves", which would pass or fail with ambient data.

Zero violations on dev and prod afterwards; **527 backend tests / 40 suites green**; the anchors
re-checked clean (they read `amount`, so they were never wrong). Backup
`Backups/fin_backup_pre_baseamt_20260729_162752.dump`.

*Also checked and benign:* 54 non-USD rows where `base_amount = amount` — 49 are zero-amount, and the
remaining 5 are WISE - EUR rows totalling €0.40 where the conversion rounds to the same figure.

**The lesson generalises past this CR:** a defect survives exactly as long as every check reads the
column it did not corrupt. Writing a value in two places obliges you to assert the relationship
between them.

#### 9.2.2 `Math.abs()` turned every reversal into a second credit

Found by pulling on this CR's own **`within-import-dupes` warning** instead of accepting it. The
warning read *"7 group(s), 8 extra row(s) — verify these are genuine repeated entries"*, and two of
those groups were not duplicates at all. Reading the source QIF for 2015-12-29:

```
+39.73  DIVIDEND RECEIVED
-39.73  DIVIDEND RECEIVED      ← the reversal
+39.73  SHORT-TERM CAP GAIN
```

Quicken credited a dividend, backed it out, and re-booked it as a capital gain. Net **+39.73**. The
ledger held **three** rows of +39.73, because
[`insertInvestmentCashRows`](../../server/src/v2/scripts/quicken-promote.js) ran

```js
// Income is a cash inflow → positive on the asset account regardless of how
// the QIF signed gross_amount.
const gross = row.gross_amount == null ? 0 : Math.abs(parseFloat(row.gross_amount));
```

The comment is right for the 6,003 ordinary rows in the batch and wrong for the 3 negatives. Two are
income — a `Div` reversal and a `-125.69 IntInc` whose memo says **"CORP INT ADJUSTMENT"** in so many
words — and both promoted as credits, overstating income by **330.84**. The third is a `Sell`, which
is in `NEUTRAL_INVST_ACTIONS` and never reaches this line, so no trade sign was ever at stake.

**Why nothing caught it, and why that is the same story as §9.2.1.** The anchors tie each year-end to
Quicken's report, so an intra-year overstatement is silently absorbed and every year-end still ties to
the cent. `quicken-verify` did emit a signal — it just classified a booking-and-its-reversal as a
"duplicate", which reads as benign. Only `/investment-returns` income was actually wrong.

Fixed by preserving the sign, plus a regression test that asserts the **pair nets to zero** — asserting
only that a row exists, or only its magnitude, passes perfectly well against `Math.abs()`. Falsified
against the old code before being trusted: `Expected: -39.73, Received: 39.73`, off by exactly the
79.46 the defect produces.

The data was repaired by **rollback → re-promote → re-anchor** rather than by patching two rows: the
three +39.73 ledger rows are indistinguishable without tracing memos back to staging, and re-deriving
from staging through corrected code is the operation this CR already provides. Applied to dev and
prod. Income 281,008.44 → **280,677.60** on both, today unchanged at 1,157,037.74, all 26 targets
still tie, and `within-import-dupes` fell from **7 groups / 8 rows to 6 / 6** — the two reversal pairs
resolving into what they always were. 528 backend tests green. Backup
`Backups/fin_backup_pre_reversalfix_20260729_233402.dump`.

*Worth keeping: a warning that says "verify these are genuine" is an instruction, not a disposition.
Two of seven were not.*

### 9.3 Second account — Fidelity IRA, 2026-07-30

The IRA was deferred at §6 for one reason: Quicken's Net Worth Report has no IRA column, so there
were no valuation targets. **Fidelity's combined statement carries one**, which removed the blocker
without needing Quicken regenerated — and made this the first account anchored *entirely* on custodian
data.

| | |
|---|---|
| Source | `fidelity_ira.QIF` — 1,312 rows staged, **0 skipped** |
| Promoted | **822 rows**, 2013-03-06 → 2019-12-31 (cutoff = PocketSmith start 2020-01-03) |
| Mode | `preserve-today` — the account is feed-owned |
| Anchors | **41**: opening 0.00 at 2013-03-05 + **40 quarterly custodian values** 2016-03-31 → 2025-12-31 |
| Handoff | 2026-01-01 |
| **Σ anchors** | **−0.32** |
| Verify | **8 pass / 1 expected warning / 0 failures** — and no duplicate warning |

**Σ = −0.32 is the result worth reading twice.** A ten-year reconstruction built from Quicken
transactions lands **within thirty-two cents** of Fidelity's own valuation at 2025-12-31, so the whole
anchor series neutralises to essentially nothing at the handoff. Stocks' equivalent is −321,173.66.
Neither side could have been fitted to the other — the ledger comes from Quicken, the target from the
custodian, and they share no inputs. This is the strongest evidence the CR has produced that the
promote arithmetic is right, and it is evidence the import could not manufacture for itself.

**It also repaired an 18-month freeze.** fin's IRA ledger sat at exactly **219,278.29** from 2022-09-30
through 2024-03-31 while the account really moved 131,369.73 → 193,453.35. The statements exposed it;
the anchors lift the curve back onto reality.

**Two names needed mapping**: `fidelity_ira` → Fidelity IRA (26), and `IRA` → `Transfer - Historical`,
the latter being the counterparty of the account's opening **ACAT rollover** (40,279.90 across two 2013
rows) from a custodian fin does not track.

**The 2013–2015 gap cost less than feared.** No statement exists before 2016, so those years stay
flow-only. The action mix suggested this would hurt — **1,024 of 1,312 rows are `ReinvDiv`**, and a
reinvested dividend posts as income while its matching `Buy` is skipped as neutral, inflating the
ledger by ~32K over the account's life. In the event the first anchor after the opening is just
**−6,057.39**: about 6K of drift on a 60K account. Worth stating that those three years are
**approximate** rather than pretending the series is uniform.

### 9.4 Valuation-only sets — Cash Mgt and Bond, 2026-07-30

CR058 anchors took their owning batch for free from the Quicken import. Accounts with **no** Quicken
history had nothing to inherit, and that alone was what blocked them — not the data, which existed all
along in Fidelity's statements. `--valuation-set <label>` resolves or creates a batch row carrying
only anchors; `--clear` removes a set and **asserts today's balance does not move**, since a complete
set sums to zero by construction. No new table, no second removal path.

| account | targets | Σ | outcome |
|---|---|---:|---|
| Fidelity Cash Mgt (30) | 22 quarterly, 2020-09-30 → 2025-12-31 | +5,783.65 | all tie; **6 anchors are 0.00** |
| Fidelity Bond (31) | 8 (opening + 7 quarterly, 2024-06 → 2025-12) | +2,437.70 | all tie |

**Cash Mgt was not what it looked like.** Its gaps read as varying and structureless; they were a
**constant 14,436.32** across five periods — the account's own `opening_balance` plug. fin's cumulative
flows to 2020-09-30 equal the custodian **exactly** (1,278,965.19), and the owner's Quicken export
independently confirmed to **1.12**. The transaction data was never wrong. The account has
`reconcile_mode = 'calibrate'` and **zero MTM rows ever** — correct while it held cash, wrong once it
held CDs (86% "Other" today). That six of its 22 anchors came out at **0.00**, exactly where the flows
already matched, is the cross-check showing through: the anchors corrected what drifted and left alone
what did not.

**Bond can only ever cover 2024-06 onward.** `X27-230910` has 42 custodian points back to 2016, but
fin's Bond account starts 2024-06-07 — its earlier history lives in **account 27** (the splice,
§1.3's correction note). And unlike the other three, Bond has **no independent witness**: Quicken ends
2022-11 and fin's Bond era starts 2024-06, so there is zero overlap. The custodian is the only source,
and anchoring makes the account match **by construction**. That is worth stating rather than letting a
reader assume Bond carries the same evidential weight as Σ = −0.32 on the IRA.

**The `opening_balance` plug stays — a correction to what §9.4 first claimed.** The plan recorded here
was: anchor, then reset Cash Mgt's −14,436.32 plug as a *consequence* of history being right. That is
wrong. A plug is a **single constant**, so it can be correct at exactly one point in time: it is wrong
for 2020 (which the anchors now fix) and **right for 2026** — fin sits 298 from the custodian at
2026-06-30 *with* it. The handoff reversal deliberately preserves today, so the plug remains
load-bearing for the post-handoff era; zeroing it would move today by +14,436.32 and break the one date
it currently gets right. The real end-state is **continuous month-end marking**, now trustworthy given
the stale-feed guard — once 2026 is marked monthly the ledger tracks the feed throughout and the plug
can go to zero without moving anything. Going forward, not retrospective.

### 9.1 The original plan

**~~Hard gate~~ — CLEARED.** Revs 1–4 warned that prod ran the pre-`d4bf7da` parser and that the two
investment-QIF fixes had to ship before any Fidelity QIF was uploaded. They shipped with v3.6.0–3.6.4:
the running prod image contains both the `XOut` negation and `f14a37f`'s reconcile-sentinel fix,
verified in the container. No ordering constraint remains here.

Order corrected from rev 1, which listed the deploy before the migration it depends on
([git-concurrency rule 6](../../.claude/rules/git-concurrency.md)):

0. **`pg_dump` prod** — first, so a bad migration has a pre-migration dump to fall back to
   (CR019 §24 step 1). Rev 2 had this at step 3, after the migration and the deploy.
1. ~~Apply the §1.3 sign fix.~~ **DONE 2026-07-28** (`f99a8c6`), dev + prod, today's balance verified
   unchanged. The anchor table in §3.1 assumes it.
2. Apply **migration 042** to prod.
3. Deploy `d4bf7da` + this CR's code + the §4.2 reconcile fix via `Scripts/deploy-to-production.sh`.
4. Per account, following [CR019 §24](cr-019-quicken-import.md#24-prod-cutover--live-per-account-loop-actual-2026-06-03--supersedes-23)
   **minus its destructive steps** — no delete, no `promote_from_date` guard, because the auto-cutoff
   already equals the account's PS start date (verified 2020-01-02 for account 27), so the import
   fills only the era PocketSmith never covered: upload QIF → map → pre-flight (confirm the cutoff and
   set `calibration_mode` — whatever endpoint writes it needs an explicit field whitelist, per
   CR043 N10) → promote → **STOP: reproduce §3.1's Ledger column on prod before anchoring** → anchor
   (dry-run, then `--apply`) → `quicken-verify` (expect **PASS with 2 warnings**, not rev 1's
   "8 passed / 1 warning" — §4.1) → eyeball Balance Trends across the 2022-12-28 → 2023-01-01 join.

   The stop-and-check is explicit because **the §3.1 table was computed on dev and prod has never
   parsed an investment QIF**. Invariant 1 would catch a divergence, but after the anchors are
   written; catching it before is free.
5. **Capture a before/after of `/investment-returns`** for account 27 *and* the parent 25 roll-up as a
   rollout artefact. §3.5 owns the CR056 coupling, but CR056 shipped 2026-07-27 and the owner has
   looked at those numbers — show what moved rather than letting it be noticed.
6. Ships as a **minor** — new COA object, new column, new ledger rows, new calibration mode.

---

## 10. Open questions

1. **Does the Net Worth Report separate the three Fidelity accounts?** The current export has a single
   `Fidelity Brokerage` row. IRA and Cash Mgt need their own columns before they can be scoped in.
2. ~~**Drop the 1998 anchor, or keep it walker-sourced?**~~ **Resolved: keep it, and date it to the
   account's first transaction (1998-03-21), not 1998-12-31.** It is not low-stakes — rev 4 priced it
   at the 29,436.00 *target*, but the **anchor row is −874,487.68**, the largest in the series, and
   dated at year-end it leaves Jan–Dec 1998 rendering ~904K on an account worth ~29K. The target
   itself stays walker-sourced (the report has no 1998 column); §2's 22-of-24 agreement is the
   warrant.
3. ~~`Valuation - Historical` vs reusing `Transfer - Historical` (221)?~~ **Resolved: a distinct
   leaf.** 221 already carries 2,741 rows that CR057 explicitly declined to touch; mixing anchors in
   would make neither set separable, and the anchors need to be reversible as a group.

---

## 11. Update history

- **2026-07-29 (built + shipped)** — Rev 5 implemented and rolled out to dev and prod; see
  [§9](#9-rollout--as-executed). Four commits: `114f690` migration 042, `3fd09bc`+`a1c280e`
  preserve-today, `52445f8` the anchor writer, `247b307` quicken-verify. Prod reproduced dev's series
  to the cent — same `opening_balance`, same 27 anchors, same verify result. Three things the build
  found that neither review pass had: **`--check` cleared the anchors before reading them**, so it
  reported drift across all 26 dates of a healthy series (write paths must clear for idempotency, the
  read path must not); **an unquoted thousands separator in the CSV would have parsed as `1`** — a
  silently wrong money value no downstream check could catch, now a hard error on cell count; and the
  first preserve-today commit went in on a **misread of a single-suite result while the combined run
  was red**, root-caused to the test harness leaking a sentinel row (fixed in `a1c280e`, which now
  deletes sentinel transactions before sentinel accounts). Owner confirmed the Balance Trends curve on
  dev before prod. Ships in the next minor.

- **2026-07-28 (rev 5)** — **Pass 2 (cr-signoff-pm): GO**, positioned **first** among the four
  IN-PROGRESS CRs. Pass 1's re-check confirmed §3.1 reproduces byte-for-byte and every one of its 9
  blocking findings closed, but found rev 4 had regenerated **only §3.1** after §1.3's corrections
  moved `opening_balance` by 1,446,714.40 — so six sections still described the pre-fix world. Rev 5
  is a **numbers-only sweep**, no design change:
  **§1's conclusion had inverted** (it claimed every pre-2020 year read negative against a −302,785.91
  plug; the truth is a 500K–874K *overstatement* against a flat **1,133,128.49** plug running back to
  1990 — which pass 2 identified as the strongest scope argument in the CR, since every other account
  with a pre-2020 plug is under 55K) · **§3.2 stated the reversal twice with two different values** ·
  **§7's 1998 anchor was rev 3's figure** · **§3.5's CR056 impact pointed the wrong way** · **§9's hard
  gate was already cleared** by the v3.6.x releases · the **largest interior anchor is 2022, not
  2008**, so §7 now discloses the anchor and the reversal as **one join in two steps**
  (527,677.08 of anchor across four days).
  A **third** mis-signed PocketSmith row was found and corrected — 2022-07-05 `+5,400.00` (`4238e33`,
  dev + prod) — moving the 1998 and 2022 anchors and leaving **Σ invariant at −156,945.10**, because Σ
  is pinned by today's balance. **§10 Q2 resolved:** the 1998 anchor moves to the account's first
  transaction date, since at year-end it left Jan–Dec 1998 rendering ~904K on an account worth ~29K.
  Added from pass 2: a read-only **`--check` mode** (the ledger can still move even though the targets
  are frozen), invariant 7 (**`preserve-today` must land on the feed — hard failure**), a
  **parent-roll-up disclosure** decision, a **stop-and-check** before anchoring on prod, and a CR056
  before/after artefact. **Migration 041's CI break was fixed** (`10eb270`) — it was the hard gate on
  this CR's own migration, and CI had been red on `main` for four consecutive runs.
  Verified end-to-end on dev with the full anchor set applied: **every anchor date misses by 0.00** and
  today is unchanged at 1,157,037.74.
- **2026-07-28 (rev 4)** — Regenerated §3.1 from the **corrected** ledger under `preserve-today`.
  A net-to-zero sweep of every `is_transfer` row ≥ 1,000 (15 same-signed multi-account clusters out of
  903) found a **second sign error** of the same class on account 27 — tx **14081**, 2020-11-04,
  `+100,000.00` "ELECTRONIC FUNDS TRANSFER **PAID**", paired against a Chase Checking `+100,000.00`
  from the Quicken import. With both corrected the **2020 anchor falls to −9,331.73** (from
  −1,445,246.13 in rev 2 and −209,331.73 in rev 3) and Quicken and PocketSmith agree on 2020 to within
  2.4%. Both fixes are **applied to dev and prod** (`f99a8c6`, backup at `Backups/pre-ps-sign-fix/`),
  so §1.3 is now a record rather than a proposal and §9 step 1 is struck. Σ = **−156,945.10**,
  reversal **+156,945.10**. Only the 1998 and 2020 rows moved; the rest are byte-identical to rev 3.
  The other 13 clusters are heterogeneous — two on Fidelity Cash Mgt (out of scope), one that
  self-cancels within 2022, several legitimate — and were left alone.
- **2026-07-28 (rev 3)** — Re-check of rev 2 by the same reviewer: **5 of 9 blocking findings cleanly
  addressed** (B3/B4/B5/B6/B9), but rev 2 had introduced **two arithmetic defects in its own headline
  numbers** and regressed B8. Fixed here: the **reversal sign** was backwards (Σ is negative, so the
  row is **+114,392.39**; rev 2 would have landed 228,784.78 out), the **2022 anchor was sized from the
  12-31 ledger against a 12-28 target** (off by 781.32 — caught by invariant 1, which is the one thing
  it can genuinely catch), the **CR056 test was vacuous** on the only in-scope account (`priceReturn`
  is 0.00 there), §4.2's "root fix" was **overclaimed**, and §5's rationale for invariant 1 named the
  wrong failure class. **B8 resolved at source:** rev 2's −1,445,246.13 anchor turned out to be a
  **PocketSmith double-count** — a 617,957.20 transfer booked as a credit on *both* Fidelity Stocks and
  Fidelity Cash Mgt with no opposing leg, confirmed against the counterparty ledger and against
  Quicken's own `XOut`. Correcting the sign collapses the 2020 anchor to **−209,331.73** and leaves
  every other interior anchor byte-identical (§1.3). Prod rows: tx 14027 and 11429.
- **2026-07-28 (rev 2)** — Pass 1 (cr-technical-reviewer) returned **revise** with 9 blocking
  findings; the anchor arithmetic, the §3.2 neutrality claim and the rollback inverse all reproduced
  exactly, but five things did not survive. **The verification story was a tautology** (§5 rewritten;
  invariant 1 is now a cross-implementation check, and the fault injection perturbs the verifier, not
  the writer). **An unmentioned sentinel** voids anchors and can be reset by any Reconcile click —
  −666,727.39 reproduced on dev (§4.2, root fix + guard). **`quicken-verify` hard-fails twice** under
  the design (§4.1). **The migration pattern rev 1 committed to is already breaking CI** — CR057's
  041 hard-codes `parent_id = 200` (§4). **Rev 1 was wrong about CR056**: anchors *do* appear in
  `/investment-returns` as `flow` rows and *do* move pre-2021 MV and average capital (§3.5, owned).
  Also: the calibration mode had nowhere to live (§4 adds a column) and targets had no ingestion path
  (§3.6 adds a pinned CSV). Owner decisions: range extended **through 2022-12-28** (cutting the join
  from −987,852.34 to −115,173.71), scope narrowed to **account 27 only**, sentinel **root-fixed**,
  targets in a **CSV**.
- **2026-07-28 (rev 1)** — Drafted from a completed dev rehearsal of the Fidelity Brokerage backfill
  (batch `f1fdf550`, account 27). The rehearsal found and fixed **two importer defects** (committed
  separately as `d4bf7da`, outside this CR's scope): investment-QIF cash rows discarded their real `L`
  category (306 of 328 pre-cutoff rows), and `XOut` was staged with the wrong sign (50 rows,
  +642,391.62 booked backwards, ~$1.28M of overstatement — confirmed by `opening_balance` moving
  exactly 2× the error once fixed). `quicken-verify` on the corrected promote: **8 passed, 1 benign
  warning, 0 failures**; rollback exact.
