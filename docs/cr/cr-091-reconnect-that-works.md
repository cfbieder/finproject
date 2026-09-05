# CR091 — The reconnect button, and the three things its first live use found — **P1 BUILT (fin side)** · P2/P3 PROPOSED · P4 handed to bank-feed

**Track: v3. No schema change, no migration.**

Roadmap anchor: [project-roadmap.md#cr091](../current/project-roadmap.md#cr091).

[CR060](cr-060-feed-connection-health.md) built a **Re-authorise** button so a dead bank consent
could be fixed from inside fin. On **2026-09-04** three Wise consents expired, which is the exact
event that CR060 exists for, and the button was used in anger for the first time.

**It failed, and every one of the three reconnects was completed by hand against bank-feed's API.**

The failure is not the one the error message names. Nothing hung, nothing was slow, and the
8000 ms in the error text is a symptom of a client ceiling set below a server's own retry budget —
the same shape as [CR059](cr-059-fintable-api-ingestion.md)'s floor lesson, where a rolling
protection window was narrower than the fixed fetch window it was protecting.

## What actually happened, from the logs

The owner clicked **Re-authorise**. fin reported:

```
bank-feed request timed out after 8000ms
(http://host.docker.internal:3007/v1/connections/conn_nordigen_533862072105943922/link)
```

`bank-feed-app`, over the same interval:

```
2026-09-04T20:26:37Z  429 on /connections/conn_nordigen_533862072105943922/link; waiting 58s (attempt 1)
2026-09-04T20:27:35Z  429 on /connections/conn_nordigen_533862072105943922/link; waiting 0s  (attempt 2)
2026-09-04T20:27:35Z  429 on /connections/conn_nordigen_533862072105943922/link; waiting 0s  (attempt 3)
```

Fintable **rate-limited the mint** and asked for a 58-second wait. bank-feed obeyed. fin aborted
**8 seconds in**, while bank-feed was still correctly waiting.

⚠️ **The first draft of this CR blamed the container network hop.** That is FALSE and is recorded
rather than deleted, because it is the plausible reading and the next person will reach for it too.
Measured on prod 2026-09-05: `host.docker.internal` resolves inside `fin-server` (172.17.0.1); a
`GET` from inside the container returns in **37 ms**; a `POST` with the identical body shape
returns in **36 ms**; and the same mint called directly against bank-feed returned **201 in 54 ms**.
The transport is fine. The 8000 ms was never elapsed work — it was a ceiling.

### Three defects, not one

**D1 — fin's mint timeout is below bank-feed's own retry budget.**
`mintConnectionLink` is the only upstream call in `bankFeedClient.js` that passes no `timeoutMs`,
so it inherits `DEFAULT_TIMEOUT_MS = 8000`. Its neighbours all set their own: sync 30 s, the manual
routes 20 s. Meanwhile bank-feed retries a 429 up to 4 attempts honoring `Retry-After`, observed at
**58 s on the first wait alone**. A client ceiling under the server's worst-case backoff can never
succeed — it does not make failure *likely*, it makes success *impossible*.

**D2 — a 429 reaches the owner as "bank-feed request timed out".**
That reads as *the service is broken*, and it sent this session looking at Docker networking for
twenty minutes. CR060's own code already makes this exact argument one layer down, for 422:

> *"Passing it through as a 502 would read as 'bank-feed is broken' when the upstream is in fact
> answering clearly."* — `bank-feed/src/routes/connections.js`

429 is the same case and did not get the same treatment. "Fintable is rate-limiting link creation,
retrying — try again in a minute" is the true sentence, and it is actionable.

**D3 — `Retry-After: 0` is honored literally, which burns the retry budget in 26 ms.** *(bank-feed
repo — separate git history, handoff not a change from here.)*
`parseInt` of `0` is finite, so `waitMs` is `0` and the fallback 5 s never applies. Attempts 2 and 3
fired **26 ms apart** and the chain threw. **Nine seconds later a manual mint of the same link
returned 201.** So even had fin waited the full 60 s it would have received an error, not a link:
both layers had to be wrong for the button to fail, and both were.

## What the live reconnect found in the UI

Three more, all discovered by doing the task rather than by reading the code:

**U1 — the three Wise rows are indistinguishable.** The table renders Institution / Provider /
Accounts / State, so a consent expiry on three Wise connections shows as three identical
`Wise · NORDIGEN · 1 · NEEDS RECONNECT` rows. Deciding *which one you just fixed* is not possible
from the page. This session had to build a decoder from `accounts_health` + `account_source_mappings`
to tell them apart, and that decoder is the thing the column should be.

**U2 — `status_text` reports a stale sync job as current health.** After a successful reconnect the
page shows a red `unhealthy` pill reading *"Last sync failed."*, because `status_text` derives from
the last `sync_jobs` row — still the previous day's failure — while `needs_reconnect` is already
`false` and `last_successful_update` is minutes old. **The owner's reward for a successful reconnect
is a red pill.** The health layer already knows better: it ranks `needs_reconnect` above staleness
for exactly this reason. Job-derived text must not outrank the connection's own fields.

**U3 — a reconnect can silently re-point a connection at a different account.** GoCardless's Wise
consent is a **single-select dropdown of balances** (USD / EUR / CHF / GBP / PLN). The connection
being re-authorised carried the PLN balance; USD was selected; GoCardless attached **USD (1446)**
to it under a **new** id `acc_01M1R5KN…`. The same real-world account then existed **twice
upstream**, on two connections, under two ids, **with identical names** — the precondition for the
name-join reroute this project has already been bitten by once.

It was caught only because a pre-state snapshot had been taken by hand. **CR060 promised a mapping
diff and this is the case it was promised for.** The duplicate now sits on prod as
`account_source_mappings` **id 708**, `ignored = true`, `account_id = NULL` — fenced by hand so it
can never be mapped by accident.

**The page's own instructions are already right and were already insufficient:** *"After
re-authorising, reload this page and check the account mapping section above — a reconnect can
re-key accounts, which leaves the fin mapping pointing at nothing."* Correct, and it puts the
diff in the owner's head instead of on the screen. It also under-describes the failure: the mapping
did not point at nothing, it pointed at something **real, live, and wrong**.

## Scope

### ⚠️ P1 and P4 are ONE fix, and the first draft split them as if either helped alone

Replaying the logged sequence against a larger fin timeout: attempt 1 waits 58 s, attempts 2 and 3
fire instantly on `Retry-After: 0`, attempt 4 is not retried (`attempt < maxAttempts` is false) and
the chain **throws a 429 at ~58 s**. So P1 alone buys a 58-second spinner ending in the same
failure, and P4 alone is a fix nothing is waiting long enough to collect. **Neither is shippable as
a fix on its own** — P1 makes the error TRUE, P4 makes the call SUCCEED.

### ⚠️ There were THREE ceilings under that budget, not one

Found while building P1. The 8000 ms was merely the tightest:

| ceiling | value | where |
|---|---|---|
| fin's bank-feed client | **8000 ms** ← fired first | `bankFeedClient.js` `DEFAULT_TIMEOUT_MS` |
| the browser helper | **30 s** | `frontend/src/js/rest.js` `DEFAULT_TIMEOUT_MS` |
| nginx | **60 s** (its default — the `/api/v2/` block sets no `proxy_read_timeout`) | `frontend/nginx.conf` |

Against a chain that runs ~58 s, nginx's default sat **two seconds** above it. **Raising only the
server-side ceiling would have moved the cut from fin to the browser and changed nothing the owner
could see** — the same failure with a different number in it. All three are raised together, and
the nginx block is a dedicated regex location so a POST is not turned into a GET by a
trailing-slash redirect (the reason the AI Review block is shaped that way too).

**P1 — make the button work.** *(fin)* ✅ **BUILT 2026-09-05, not yet deployed.**
- Give `mintConnectionLink` an explicit timeout **above bank-feed's worst-case retry chain**, not a
  round number that feels generous. Derive it: `maxAttempts × max(Retry-After)` + margin.
  **The gate is a stated relationship, not a value** — a test asserting fin's mint timeout exceeds
  bank-feed's documented backoff ceiling, so the next person to tune either side is told.
  Built as `MINT_TIMEOUT_MS = (attempts − 1) × max Retry-After + 15 s` = **195 s**, derived from two
  exported constants rather than typed, with nginx at 240 s and the browser at 210 s above it.
  ⚠️ **The first four tests were worth little and are kept as the lesson:** they assert the exported
  constant, so a regression that deleted `timeoutMs: MINT_TIMEOUT_MS` from the call — leaving the
  constant sitting there, correct and unused — passed all four. Only the fifth, which drives a
  never-settling fetch under fake timers and asserts the request is still in flight at 60 s, fails
  against the unfixed code. **Falsified exactly that way before being kept.**
- Surface upstream 429 as itself (D2), with the retry-in-progress fact and the wait remaining.
- The button spins for up to a minute on a rate limit, so it needs a real pending state saying what
  it is waiting for.

**P2 — make the page legible.** *(fin)*
- U1: a column identifying each connection — mapped fin account and currency, falling back to the
  fintable account id. Institution name alone is not an identifier.
- U2: rank connection-level truth above job-derived text; a connection with `needs_reconnect: false`
  and a fresh `last_successful_update` is not `unhealthy` because yesterday's job failed.

**P3 — close U3 with the diff CR060 promised.** *(fin)*
- Snapshot each connection's account ids when a link is minted; on the next load, diff and show
  what changed — **appeared / disappeared / re-keyed** — against the mappings.
- Flag the case row 708 is the specimen of: **a new upstream account whose name matches an already
  mapped account**. Offer *ignore* as the one-click answer, since that is the correct answer and
  the one taken by hand this time.

**P4 — hand D3 to bank-feed.** *(cross-repo — write it into `HANDOFFS.md`, do not patch from here.)*
Treat `Retry-After: 0` as the documented fallback rather than as an instruction to retry instantly,
**and do not retry the mint at all**: a human is standing at a button, so the interactive call
should return fintable's 429 and its `Retry-After` immediately and let fin say *"try again in 58s"*.
Retrying is right for the nightly sync and wrong here. **⚠️ Until this lands the button still cannot
succeed during a rate limit** — P1 only makes the failure legible. Not yet written into
`HANDOFFS.md`; that repo has its own git history and is not edited from fin.

## What this CR deliberately does not do

**Consolidate the three Wise connections onto one.** Revolut carries 3 accounts on one connection
and PKO carries 7, so one Wise connection carrying USD + EUR + PLN is the tidier topology and is
tempting to fold in here. It means deliberately re-pointing all three mappings onto new ids, and
`promote_from_date` on those rows (2026-04-10 / 2026-05-15 / 2026-06-04) is what stands between a
re-point and a duplicate back-fill — the failure mode that put 31 duplicate rows on the Black Card
for a net **+$267**, small enough that a balance check missed it. That is its own CR with its own
gate, not a rider on a usability fix.

**Nothing here changes the reconnect flow itself.** Minting stays a `read`-scope operation that
produces a URL a human opens. There is still no unattended reconnect to build or fear.

## Evidence

All measured against **prod** on 2026-09-04/05 (v3.50.0).

| Claim | Measurement |
|---|---|
| Transport is healthy | `getent hosts host.docker.internal` → 172.17.0.1; GET 37 ms, POST 36 ms from inside `fin-server` |
| The mint itself is fast | `POST /v1/connections/:id/link` direct to bank-feed → **201 in 54 ms** |
| The real cause is a 429 | 3 log lines, 2026-09-04T20:26:37Z–20:27:35Z, `waiting 58s` then `0s`, `0s` |
| The retry chain is self-defeating | attempts 2 and 3 **26 ms apart**; a manual mint **9 s later** returned 201 |
| Only the mint lacks a timeout | `bankFeedClient.js` — sync 30000, manual routes 20000, mint inherits 8000 |
| U3 is real, not theoretical | `accounts_upstream` 31 → 32; `acc_01M1R5KN…` = `Christopher Biedermann (USD) (1446)`, same name as `6521708934254164984` on another connection |
| The other two did NOT re-key | mappings 449 and 450 byte-identical to the pre-snapshot; **0 orphaned mapped rows** of 31 |
| The reconnects worked | all three `needs_reconnect: false`; `attention-summary` 3 → **0** |

## Housekeeping

- Roadmap anchor to add under the bank-feed section.
- CR060 stays IN-PROGRESS; this CR takes the reconnect-usability half rather than reopening it.
- Prod carries one hand-made artifact from the incident: `account_source_mappings` id **708**,
  ignored. P3 should recognise it, not delete it — it is the regression fixture for U3.
