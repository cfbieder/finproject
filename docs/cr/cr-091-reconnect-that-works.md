# CR091 — The reconnect button, and the three things its first live use found — **COMPLETED 2026-09-15** · P1 BUILT (fin side) · P2 U1 + U1b + P3 SHIPPED (U1/P3 v3.61.5) · U2 SHIPPED in bank-feed `615b2bb` · P4 SHIPPED in bank-feed `04815bd`

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

**P1 — make the button work.** *(fin)* ✅ **SHIPPED v3.53.1 (2026-09-05).**
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
  fintable account id. Institution name alone is not an identifier. ✅ **SHIPPED v3.61.5
  (2026-09-14).** Each Bank connections row lists the accounts it carries under the institution —
  `WISE - PLN (PLN), unmapped: Christopher Biedermann (USD) (1446) (USD)` / `Wise - USD (USD)` /
  `WISE - EUR (EUR)` for the three Wise connections on dev — joined on bank-feed's `accounts_health`
  (feed account id → connection id; all 30 mappings join on dev and prod). Logic in
  `frontend/src/utils/feedMappings.js`.
- **U1b — the account-mapping table is not grouped by institution.** ✅ **BUILT 2026-09-05.** It
  rendered in mapping-id order, i.e. the order rows were first created, which scattered one bank's
  accounts down the whole table: the Wise USD account sat **eleven rows above** the other three Wise
  rows. That is the table's main job when a reconnect has just re-keyed one account of several at a
  bank — comparing a bank's accounts *to each other* — and it required hunting. Grouped by
  institution, then by name; rows whose institution is unknown (bank-feed unreachable — observed
  once during this work, so the null path is real, not defensive) sort last rather than under an
  invented heading. **It also makes the U3 duplicate self-evident:** the two identical
  `Christopher Biedermann (USD) (1446)` rows now sit adjacent, one MAPPED and one IGNORED, where
  before the pair could not be seen on one screen. Sorted in the page, not in SQL — nothing else
  consumes the endpoint's order.
- U2: rank connection-level truth above job-derived text; a connection with `needs_reconnect: false`
  and a fresh `last_successful_update` is not `unhealthy` because yesterday's job failed.
  ✅ **SHIPPED in bank-feed `615b2bb`, deployed 2026-09-15 — fin changed nothing.** The five cases below
  are bank-feed tests. Two existing tests asserted the old rule and were changed. ⚠️ Trade-off: a
  connection whose syncs keep failing now turns `unhealthy` once the bank has gone unreached for 48h,
  not the moment the flag flips. (Handed over by the owner 2026-09-14.) v3.61.4 set the rule that
  health is classified once, at source, so fin does not reinterpret it. Not reproducible today: all 13
  prod connections read `ok`. **The rule for `classifyUpstreamConnection`
  (`src/services/upstreamHealth.js`):** `healthy === false` yields `unhealthy` **only if the bank was
  NOT reached inside `staleHours`** (`last_bank_sync_at`, from `connectionSyncTime.js`); otherwise the
  state is `ok` and Fintable's text travels as `notice`. `needs_reconnect === true` still outranks
  everything. **Cases:** (1) `healthy:false`, `needs_reconnect:false`, reached 10 min ago → `ok` with
  notice; (2) same, reached 60 h ago → `unhealthy`; (3) `healthy:false`, never reached → `unhealthy`;
  (4) `needs_reconnect:true` with a fresh reach → `needs_reconnect`; (5) `healthy:true`, reached 60 h
  ago → `stale` (unchanged). ⚠️ This file is fin's copy of the spec; the entry belongs in bank-feed's
  `HANDOFFS.md`, written from a bank-feed session.

- **U4 — the page contradicted the one that links to it.** ✅ **SHIPPED v3.61.2 (2026-09-13).**
  Balance Calibration's *feeds need attention* panel links here, and this page showed nothing wrong:
  the connections table painted its pill from `healthy`, which is **true** for a consent that is
  valid but has not synced from the bank in weeks, so it read **HEALTHY** beside Erste Bank Polska at
  **64 days silent**; and the per-feed cards said **FRESH**, which measures bank-feed's poll of
  Fintable (minutes ago) rather than the bank. Three measures on two pages, one of them right. Now:
  both pages read bank-feed's classified `state` through one module (`frontend/src/utils/feedHealth.js`
  — labels, pill kind, per-state remedy); the page opens on a **Needs attention** section (each
  connection fin depends on, its fin accounts, what the state means, and **Re-authorise** beside it;
  the orphaned-mapping alert moved in here too); then Account mapping; then Bank connections sorted
  attention-first; Service, per-feed detail and recent transactions collapse into one
  **Diagnostics** disclosure (6,887px → 3,073px). Scoped like Balance Calibration's count — a
  connection is listed only if one of its accounts is mapped and not ignored, joined on the feed
  account id (institution names are ambiguous: three Wise connections) — so OCME's ignored Bank Pekao
  (8d silent) is named in a footnote, not counted. ⚠️ **Not fixed, only made legible:** Wise and PKO
  Bank Polski carry Fintable status text *"Bank access has expired. Please reconnect this bank."*
  while syncing from the bank inside 48h; bank-feed reports that as a notice (CR060), and the row now
  says so rather than showing the text under a bare HEALTHY. Whether that text predicts an imminent
  expiry is unmeasured.

- **U5 — a QUIET account was reported as a SILENT feed, and U4 told the owner to re-authorise it.**
  ✅ **SHIPPED v3.61.3 (2026-09-14), fin-side.** The owner opened Fintable after v3.61.2 and it showed
  Bank Pekao, Revolut and Erste as fine — and it was right. **Measured on all 13 live connections:**
  bank-feed's `stale` reads Fintable's `last_successful_update` as the last successful bank sync, but on
  GoCardless (NORDIGEN) connections that field is the **newest transaction's date stamped
  `T23:59:59Z`** whenever a sync brings nothing new — Erste `2026-07-10T23:59:59Z` vs last transaction
  2026-07-10, Revolut 09-07/09-07, Pekao 09-04/09-04 — while each connection's `sync_status` showed a
  sync with the bank **finished that afternoon** (Erste's own log: *"Retrieved 1 transactions … Date
  range 2026-06-01 to 2026-09-13"*). The other ten connections carry a real timestamp there. So
  *"Fintable has not pulled from the bank for 64 days"* — U4's panel text — was **false**, and its
  advice to press Re-authorise risked exactly the re-key U3 records. The same field reached four more
  surfaces: Balance Calibration's red *"synced N days ago"*, the Home strip's *"feed data stale on 3
  accounts (oldest 64d)"*, mobile Reconcile, and Bank Feed Setup.
  **Fix (fin, one place):** `server/src/v2/services/feedSyncHealth.js` re-reads the verdict for
  `/balance-recon`, `/diagnostic` and `/util/attention-summary`: `stale` + a `sync_status` of
  `finished` inside bank-feed's own `stale_threshold_hours` → **`quiet`** (attention false, shown as
  *"no new transactions for Nd"*); `feed_synced_at` moves forward to that sync, never backwards;
  Fintable's notice text is dropped once the bank answered inside the window (PKO's *"Bank access has
  expired"* was stale text). `needs_reconnect` / `unhealthy` / `never_synced` are never touched, an
  unknown `sync_status` changes nothing, and a connection with **no** finished sync inside the window
  stays `stale` — the alarm for the seven-week Revolut gap still fires. 12 unit tests, **falsified**
  by disabling the reclassification (they fail) before being kept.
  ⚠️ **Also found, not fixed:** `reconcileToFeed` dates MTM/accrue observations from the stored
  `source_synced_at`. Today only Fidelity (SNAPTRADE) and Wise use those modes, and both carry real
  timestamps, so nothing is mis-dated now — but a GoCardless account switched to `accrue` would date
  from its last transaction.

### Handoff to bank-feed — ✅ both SHIPPED in bank-feed `04815bd`, deployed 2026-09-14

**Owner decision 2026-09-14:** fix both from this session inside bank-feed's own repo (its own commit,
tests and contract), pausing before the rebuild of the shared `bank-feed-app` for a go — rather than
waiting for a bank-feed session. Shipped as bank-feed **`04815bd`**: `connectionSyncTime.lastReachedAt`
(the later of `last_successful_update` and a `finished` `sync_status`) now drives the classifier,
`source_synced_at` and the holdings snapshot; `upstream` gains `last_bank_sync_at` and
`days_since_new_data`, and `days_since_upstream_sync` counts from bank contact. The mint makes **one**
attempt and returns `retry_after_seconds`; `Retry-After: 0` waits the 5s fallback. Suite 269 (264
pass, 5 skipped, 0 fail), 13 new tests, each fix falsified. Rebuilt `app` only (db untouched) at
06:56 UTC; verified live: all 13 connections `ok`, Pekao / Revolut / Erste `days_since_new_data`
9 / 6 / 65, `needs_attention` empty.
**fin v3.61.4 follows:** the v3.61.3 re-read (`reclassifyUpstream`) is removed as dead code;
`feedSyncHealth.js` keeps only the `feed_synced_at` correction, now reading bank-feed's
`last_bank_sync_at`, because rows stored before the rebuild still carry the old value (measured:
Santandar's latest stored `source_synced_at` was `2026-07-10 23:59:59` at 06:39). Bank Feed Setup's
*no new transactions for Nd* line reads `days_since_new_data`, and Fintable's notice text is no longer
shown on the connections table (PKO's stale *"Bank access has expired"*; still in Diagnostics).
⚠️ **fin deliberately keeps `MINT_TIMEOUT_MS` at the old retry-derived ceiling** although bank-feed's
handoff suggested following it down: a call that returns in milliseconds loses nothing to a long
ceiling, and a short one would recreate the CR091 timeout the moment bank-feed were rolled back.

*Original handoff text, kept as written:*

1. **The classifier conflates "no new data" with "no bank sync".** `classifyUpstreamConnection`
   (`src/services/upstreamHealth.js`) should classify staleness on `sync_status.finished_at` (state
   `finished`), not `last_successful_update`, and could expose the latter as data age. The evidence is
   U5 above. ⚠️ **CR060's 48h threshold was measured on 1,457 `last_successful_update` gaps** — on the
   six NORDIGEN connections those are transaction gaps, not sync gaps, so the measurement is worth
   re-running on sync times. Fin's `feedSyncHealth.js` can be deleted once this ships.
2. **P4, reproduced 2026-09-13.** A Re-authorise on `conn_nordigen_4985054057502688250` (Bank Pekao):
   one mint returned 201, then fintable 429'd and bank-feed waited 40s, 26s, then **0s, 0s** — the
   `Retry-After: 0` retries D3 describes — and fin showed *"Fintable is rate-limiting link creation"*.
   Unchanged from P4 above: do not retry an interactive mint; return the 429 and its wait.

**P3 — close U3 with the diff CR060 promised.** *(fin)*
- Snapshot each connection's account ids when a link is minted; on the next load, diff and show
  what changed — **appeared / disappeared / re-keyed** — against the mappings.
- Flag the case row 708 is the specimen of: **a new upstream account whose name matches an already
  mapped account**. Offer *ignore* as the one-click answer, since that is the correct answer and
  the one taken by hand this time.

  ✅ **SHIPPED v3.61.5 (2026-09-14) — STATELESS, by owner decision**, not the snapshot-at-mint above:
  every case is read off live data on each load, whichever device finished the reconnect, with no
  table and no migration. In Bank Feed Setup's **Needs attention**: *disappeared* stays the orphaned-
  mapping alert (CR060); *appeared* lists feed accounts that are neither mapped nor ignored (never
  imported); *duplicated* flags an unmapped feed account with the **same name and currency as a mapped
  one** — the row-708 shape — with a one-click **Ignore it**. An **ignored** row is resolved and never
  flagged, so prod (708 ignored) shows nothing while dev (the same account still unmapped) shows the
  item — which is how it was verified, without clicking. ⚠️ **Not detectable this way:** pairing an
  orphaned mapping with the new feed account that replaced it, because fin stores only the old feed id,
  not its name. Tests falsified by dropping currency from the match and by counting ignored rows as
  mapped.

**P4 — hand D3 to bank-feed.** *(cross-repo — write it into `HANDOFFS.md`, do not patch from here.)* ✅ **SHIPPED in bank-feed `04815bd`, deployed 2026-09-14.**
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
