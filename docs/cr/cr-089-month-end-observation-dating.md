**Status:** PROPOSED — not started. **Track: v3.**

# CR089 — Dating the month-end observation: which snapshot holds the close

Make the month-end MTM run pick the right feed observation **by evidence**, and stop requiring the
owner to know a poll date.

Roadmap anchor: to be added (see §Housekeeping). Split out of the [CR061](cr-061-holdings-and-prices.md)
discussion **deliberately, so the two can be worked in parallel** — CR061 is owned by another thread
and is about filling `securities` / market prices; this is about the **reconcile loop** and only
borrows CR061's two endpoints.

## Problem — the date on a feed row is a POLL date, and nothing says otherwise

Measured on prod, 2026-09-02, while booking August's MTM on five Fidelity accounts.

**The owner asked a reasonable question — *"can I just click Reconcile?"* — and the correct answer
required knowing which day fintable happened to poll.** That is a design failure, not a fact of life.

`bankfeed_balances.balance_date` is the date the row was **synced**, and it stores whatever the
custodian was reporting at that moment. Fidelity (via SnapTrade) posts closing values with a lag, so
the label and the day the figure describes are two different dates:

| Feed row | Synced at | Fidelity Stocks | What it actually contains |
|---|---|---|---|
| **2026-08-31** Mon | 04:59 UTC = **00:59 ET** | 1,187,764.08 | Friday 08-28's close — the market had not opened |
| **2026-09-01** Tue | 04:04 UTC | 1,187,764.08 | still Friday 08-28's close |
| **2026-09-02** Wed | 03:16 UTC | 1,185,594.38 | **Monday 08-31's close** ← the August month-end |

⚠️ **fintable's own `snapshot_date` is a poll date too** — the discovery that rules out the obvious
fix. Asking for the holdings snapshot *dated* 2026-08-31 returns positions priced at **Friday's**
close:

```
GET /accounts/{id}/holdings?date=2026-08-31  → snapshot_date 2026-08-31, Σ = 1,187,764.09
GET /accounts/{id}/holdings                  → snapshot_date 2026-09-02, Σ = 1,185,594.39
```

**So no field anywhere states the valuation date.** The only ground truth is the **position prices**.

### A lag constant will not do, and this repo has the scar

The tempting fix is "month-end + N". Both months observed happen to be +2 — but the rule that
*looks* equivalent, *"take the first observation whose value changes"*, gets **July wrong**:

| | month-end | first change after | correct observation |
|---|---|---|---|
| July | 07-31 Fri | 08-01 = 1,157,779.86 | **08-02 = 1,165,523.25** ✅ (what was booked) |
| August | 08-31 Mon | 09-02 = 1,185,594.38 | **09-02** ✅ |

July's 08-01 figure is an intermediate the custodian later restated. A constant would also go stale
silently — the shape [CR060](cr-060-feed-connection-health.md) already paid for with a stale
threshold *"guessed at 26h and made the alarm useless — measured, now 48h"*.

## The evidence that does work

Cross-check the snapshot's **position prices** against dated market closes
(`GET /prices/{symbol}/history?start=&end=`, public, no auth):

| Ticker | Holding price in the 09-02 snapshot | 08-31 close | 09-01 close |
|---|---|---|---|
| DIA | 531.57 | **531.39** ✅ | 527.63 |
| CSCO | 110.49 | **110.46** ✅ | 109.73 |
| JEPI | 57.50 | **57.50** ✅ | 56.975 |

Σ of all 31 positions at those prices = **1,185,594.39** against the feed's **1,185,594.38** — a
one-cent rounding gap. The dating is not an inference; it is arithmetic.

⚠️ **The price history also supplies the TRADING CALENDAR** — its bars skip 08-29/08-30 — so *"the
last trading day of the month"* stops being a guess when month-end falls on a weekend or a holiday.

## Design

### D1 — the page-level date field MOVES into the dialog (owner-proposed)

Today `mark against balance dated` sits **above the table and applies to every row reconciled while
it is set**. That is a footgun: the owner has to remember to clear it, or a later accrual gets pinned
to a brokerage's observation.

- **Remove it from the page.**
- The dialog gains a date, **pre-filled with the detected proposal**, per row.
- ⚠️ **"Confirm" must also mean "change".** Deleting the field outright with no dialog-side override
  turns a failed detection into a dead end. The control is not deleted — it is **relocated and
  pre-answered**.

`Book MTM entry as of` (the entry date, with the month/quarter/year-end presets) **stays** — it is a
real choice and a different question.

### D2 — date the CONNECTION, not the account

Only accounts holding price-feed tickers can be dated. Measured on the five live MTM accounts:

| Account | Positions | Datable? |
|---|---|---|
| Fidelity Stocks | 31 — JEPI, CSCO, DIA, SPCX… | ✅ tickers |
| Fidelity IRA | 19 — QQQ, AGG, DLN, DIA… | ✅ tickers |
| Fidelity Bond | 31 — `097023CJ2`, `963320BC9`… | ❌ all CUSIPs |
| Fidelity Cash Mgt | 12 — `949764WD2`…, FZDXX | ❌ CUSIPs + MMF |
| Fidelity Options | 1 — SPAXX | ❌ cash sweep only |

**Per-account dating fails on 3 of 5.** But all five sit on one connection and are polled together —
they held the identical flat run 08-30/08-31/09-01 and moved together on 09-02. So: date the
connection from whichever of its accounts *is* datable, and apply the result to all of them. One
detection covers five rows.

### D3 — nearest match with a tolerance, and a third outcome

IEX is one exchange, not the consolidated tape, so matches are approximate (531.57 vs 531.39 =
**0.03%**). Adjacent trading days here differ by **0.7%**, comfortably separable — but on a quiet day
they may not be. The rule needs:

- a confidence threshold on the match, and a **minimum separation** between the two best candidate
  days;
- a third outcome — **"cannot distinguish"** — that proposes nothing and asks, rather than guessing;
- ⚠️ **fail-open, never fail-wrong**: no datable account, no price coverage, upstream down ⇒ fall back
  to today's behaviour (the guard's candidate list) with the date entry in the dialog.

### D4 — where it runs, and the preview it must not break

⚠️ [CR087](cr-087-money-legibility.md) P0c made a `dryRun` **genuinely read-only** — it no longer syncs
upstream or upserts balances, because a preview that writes is not a preview. This adds holdings +
price lookups **to a preview**, which is a change in character:

- hard timeout, and fail-open to D3's third outcome;
- **cache one detection per (connection, month-end)** and reuse it across that connection's rows —
  five rows must not mean five detections;
- reads only. Nothing about this may write.

bank-feed owns the upstream, so the holdings passthrough belongs there (`/v1/accounts/:id/holdings`);
`/prices` is public and can be read from either side.

## Non-goals

- **Filling `securities` / `quicken_price_staging`** — that is [CR061](cr-061-holdings-and-prices.md),
  owned by another thread. This CR reads holdings; it stores none of them.
- **Changing `accrue`.** Since [CR080 §B2.1](cr-080-feed-accrual-reconcile-mode.md) it already picks
  its own observation and refuses when it cannot. Different mechanism — accrue **avoids** ambiguity by
  stepping back to a clean window, this **resolves** it with price evidence — but the same contract:
  the engine decides and says why.
- **A lag constant**, per §Problem.
- **Auto-applying.** The write stays confirm-gated; this changes what the owner is asked to confirm,
  not whether they are asked.

## What the dialog should say

> **Bank value 1,185,594.38**
> from the **2026-09-02** snapshot, priced at the **2026-08-31 close** — the last trading day of August.
> Matched on DIA 531.57≈531.39 · CSCO 110.49≈110.46 · JEPI 57.50=57.50.
> `[ Confirm ]  [ Use a different observation ▾ ]`

The owner confirms **a date they can see the evidence for**, instead of knowing a poll date.

## Verification

- The two months already measured are the fixtures: **August ⇒ 09-02**, **July ⇒ 08-02** (and the
  rule must reject July's 08-01, which is what kills "first change wins").
- A **falsification** pass, per this repo's habit: widen the match tolerance until July picks 08-01,
  and confirm the test fails.
- The five August figures this would produce, already dry-run against prod:
  Stocks **+19,082.64** · IRA **+5,516.95** · Options **+1,115.00** · Cash Mgt **−119.00** ·
  Bond **−940.10** (net **+24,655.49**).
- Both themes, and the dialog rendered — every display defect this project found in the last three
  days was found by a person looking at a page, none by a gate.

## Depends on

A holdings passthrough on bank-feed (shared with [CR061](cr-061-holdings-and-prices.md) — coordinate,
do not duplicate). `/prices` needs nothing: public, unauthenticated, and the parameters are
`start`/`end` (**not** `from`/`to`, which 404s with a misleading *"No price history for that ticker
and range"*).

## Housekeeping

⚠️ **The CR index row and the roadmap anchor are NOT yet added.** At the time of writing another
session held uncommitted edits to `docs/cr/README.md`, `docs/current/project-roadmap.md` and
`docs/current/status.md`, and a pathspec commit takes the **worktree** state of a path — so adding
the rows here would have swept that thread's in-progress work into this commit
([git-concurrency.md](../../.claude/rules/git-concurrency.md), Known Issue #23). Add once their work
lands:

- `docs/cr/README.md` — a CR089 row.
- `docs/current/project-roadmap.md` — a `<a id="cr089"></a>` bullet under §1.1.
