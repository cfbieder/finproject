# CR060 — Feed connection health, and the reconnect it exists to trigger — IN-PROGRESS (bank-feed health side **built AND deployed**; fin recon page + link minting to do)

Surface what fintable already tells us about the *health* of each bank connection, so a dead feed is
visible the day it dies instead of the week someone notices the numbers stopped moving.

Roadmap anchor: [project-roadmap.md#cr060](../current/project-roadmap.md#cr060). **Track: v3.**
**Split out of [CR059](cr-059-fintable-api-ingestion.md) §15A** by its pass-2 sign-off (M5 + R3): the
*read* half needs nothing but the read-scope token CR059 already has and works regardless of
`FINTABLE_SOURCE`, while the *write* half (minting a reconnect link) needs a write-capable credential
and belongs in its own decision.

⚠️ **That last clause is FALSE, and was the only thing keeping the reconnect out of this CR
(re-measured against the live API docs, 2026-09-01 — see [§Minting is a `read` operation](#minting-is-a-read-operation-and-that-unblocks-the-half-this-cr-fenced-off)).**
Fintable's API says the opposite in two places. It is recorded here rather than edited away because
the fence is *why* this CR shipped half-built, and anyone reading the old sentence today would fence
it off again.

## Why

Two incidents inside two months, neither of which the Google-Sheet path could express:

- **Bank Pekao has reported `healthy: false` since 2026-07-24** and nothing in the stack could say so.
  It was found by calling `GET /connections` by hand during CR059's spike.
- **A GoCardless re-consent on 2026-06-06 silently reduced the Revolut connection from three wallets to
  one.** The EUR and PLN wallets stopped feeding and it went unnoticed for **seven weeks** — found only
  because the API listed accounts differently than the Sheet did.

PSD2 consents expire roughly every 90 days, so this is a recurring event, not an accident.

### ⚠️ Both incidents are STALE, and the first was never a fin problem (measured 2026-08-23)

Found while sequencing [CR086](cr-086-ui-visual-system.md)/[CR087](cr-087-money-legibility.md), when a
PM sign-off used "Pekao unhealthy for a month" to rank this CR ahead of both. **The owner corrected the
premise and the data agrees.**

- **Bank Pekao is OCME's bank, and fin deliberately ignores it.** Its single upstream feed account is
  `OC MEDYCYNY ESTETYCZNEJ (PLN) (8781)` — i.e. **OCME**, which [status.md](../current/status.md)
  records as *a deliberate write-off at −30*. Fin's mapping row (`account_source_mappings` id 440,
  `source='bank-feed'`) carries **`account_id = NULL` and `ignored = true`**. There is **no account
  matching `%pekao%` in fin at all**, and `OCME Sp. z o.o.` (id 45) reaches fin via **`pocketsmith`**,
  not the feed. **No fin figure has ever depended on that connection.**
- **Every connection carrying feed accounts is `active` and was synced 2026-08-23** — Pekao included,
  Capital One included, and **Revolut is back to 3 accounts**. All three motivating observations are
  now historical.

**The design rationale survives; the urgency does not.** "Nothing in the stack could say so" is still
true and is still the reason to build this. But this CR must not be ranked on a live outage.

**⚠️ And it changes the design.** This CR never mentions `ignored` or unmapped feeds anywhere. As
scoped, the health surface would alert on **every** upstream connection — so it would report OCME's
bank at fin forever, for a feed switched off on purpose. **Alerts must scope to feed accounts that are
mapped (`account_id IS NOT NULL`) and not `ignored`.** Today that is **27 of 31** bank-feed mappings;
the other **4 are ignored** and must stay silent.

## Scope (read-only)

- bank-feed: fold `healthy`, `needs_reconnect`, `status_text` and `sync_status` from `GET /connections`
  into `/v1/health/feeds` (additive — the contract's existing shape is unchanged).
- fin: show it where a stale feed already hurts — the reconcile page's per-feed row and the admin
  routing page.
- An explicit "unreported for N days" signal, since the failure mode is silence, not an error.

## Not in scope

Forcing an upstream sync (`POST /sync`), renaming, disabling, and `DELETE /connections/{id}`. Those
genuinely need a **write-scope token** — see CR059 §10 on why a write-capable credential in an
unattended service is not free.

⚠️ **`DELETE /connections/{id}` disconnects the bank AND PURGES its data.** It sits one path segment
from the reconnect endpoint and the owner's word for what they want is *"reset"*. Nothing in this CR
may route there, and the word `reset` should not appear on the button.

~~Minting reconnect links (`POST /connections/{id}/link`)~~ — **now IN scope**, see below: it needs
`read`, not `write`.

## Built 2026-07-29 (bank-feed `cc6a9bb`) — **DEPLOYED, live since 2026-08-10** (see §Still to do)

`src/services/upstreamHealth.js` + an additive `upstream` block on
`/v1/health/feeds`, rendered on bank-feed's own `/admin/routing` page. 18 new tests, 164 green,
contract doc bumped. **Not deployed** — activating it needs a `docker compose up -d --build` on the
bank-feed stack, which is a separate, explicit step.

Two properties, both tested rather than asserted:
- **independent of `FINTABLE_SOURCE`** — it works while ingest is still the Sheet;
- **it never throws.** This is the endpoint monitoring polls, so an upstream outage degrades to
  `upstream:{ok:false,reason}` inside the payload rather than 500-ing the thing that is supposed to
  report breakage.

**Running it against the live API found what it was built to find, immediately:**

| connection | state | |
|---|---|---|
| Revolut | `needs_reconnect` | still, after the 2026-07-28 re-link — `PROCESSING` |
| Bank Pekao | `needs_reconnect` | `ERROR`, last synced 1d ago |
| **Capital One** | `stale` | **beyond the 26h threshold, and nobody knew** |
| Wise ×2 | ok, with a notice | *"Your bank is temporarily unavailable (provider outage)"* while `healthy: true` |

Those two Wise rows are why `provider_notices` is reported **separately** from `needs_attention`: the
provider is saying something real, but it is not actionable and fintable retries — folding it into the
alarm would train the owner to ignore the alarm. Equally, the admin page states explicitly when
everything is fine, because blank space is an ambiguous signal rather than a reassuring one.

*Design note:* accounts-without-upstream matching is on **name+currency**, not id — the Sheet-era ids
and the API ids are different namespaces until [CR059](cr-059-fintable-api-ingestion.md) P3a, and this
had to work *before* that migration. A name collision under-reports (we think an account is fine) and
never over-reports, which is the right direction for a signal that triggers manual work.

## Minting is a `read` operation, and that unblocks the half this CR fenced off

Measured 2026-09-01 against the live spec (`GET /api/v2/openapi.json`, **API v2.2.0**) and the public
markdown docs (`GET /api/v2/docs`), not against CR059's July snapshot. Fintable states it twice:

- **Scopes table** — `read` = *"Read all data on the account, **mint connection links**, and move a
  sync start date earlier"*. `write` is *"rename, categorize, enable/disable, delete, sync"*.
- **`POST /connections/link`** — *"**A read-only (`read`) token may mint links.** Minting by itself
  changes nothing — the connection is created only when the destination Workspace user opens the URL
  and authenticates — so a read-only integration can offer 'connect a bank' without ever holding
  write access."*

So the credential objection this CR was split on does not apply to the reconnect. **The endpoints:**

| Want | Endpoint | Returns |
|---|---|---|
| Re-authorise an existing connection (the recurring case) | `POST /api/v2/connections/{id}/link` | `{url, expires_at}` — single-use, 30-min TTL, **exempt** from the new-connection plan checks |
| Connect a NEW bank | `POST /api/v2/connections/link`, optional `institution` slug from `GET /institutions` | same shape; subject to plan/connection/volume limits (422 with an explanation) |

⚠️ **Neither completes headlessly.** A bank login needs a real browser, so the whole integration is
*mint the URL, open it in a tab*. There is no unattended reconnect to build and none to fear.

### Why this is worth building — and it is not urgency

**Live state, 2026-09-01: 13 connections, all `healthy`, 0 `needs_reconnect`.** There is no outage to
point at, and per the correction above this CR must not be ranked on one again. The argument is
structural: **7 of the 13 connections are NORDIGEN/GoCardless**, whose PSD2 consent expires about
every 90 days, so the reconnect is a *scheduled* chore that today requires leaving fin for Fintable's
dashboard. Build it before it is needed, not during.

⚠️ **[CR059 §15F](cr-059-fintable-api-ingestion.md) assessed connect-a-new-bank as SKIP** — *"for a
single-user setup the dashboard already does this well"*. **The owner has overridden that (2026-09-01),
wanting one place for everything.** The asymmetry is worth keeping in view: reconnect is recurring,
adding a bank has happened 13 times ever. Connect-a-bank rides along because it is the same plumbing
plus one optional parameter — it would not justify the work alone.

### ⚠️ The risk is not the credential — it is what a reconnect does to our mappings

**[CR059 §25.3](cr-059-fintable-api-ingestion.md) already measured this and it is the reason the
button is the cheap half.** A reconnect can mint **new fintable account ids**. Since P3a, fin's
`account_source_mappings.external_name` **is** that id, so if it changes the mapping goes dead and the
account **silently stops feeding** — a stale balance, no promotes, and no error anywhere. Not
hypothetical: the 2026-06-06 Revolut re-consent dropped two wallets and it went **seven weeks**
unnoticed (§Why).

**A Reconnect button without a post-reconnect check automates the click and not the check** — it makes
a known silent failure easier to trigger. So the guard ships with it, or instead of it:

> After a reconnect, re-read the connection's feed accounts and diff their ids against fin's
> non-ignored, mapped `account_source_mappings` rows. Report **still mapped / newly appeared /
> vanished**.

**The guard needs no bank-feed change and no upstream call** — fin already holds both sides. Measured
on prod 2026-09-01, running exactly that diff: **29 feed accounts · 31 bank-feed mappings · 27 mapped
and not ignored · 0 ORPHANED.** Every live mapping resolves, so this is **preventive, not a live
defect** — which is the honest reason to build it now rather than a scare to build it on. It also
reports the other direction: **2 feed accounts carry no active fin mapping** (`Individual`,
`Christopher Biedermann (USD) (8325)`) — expected, they are the deliberately unmapped ones.

*Resolved while building (2026-09-01):* the upstream serves **31** accounts where fin sees **29** —
it is the **`?app=fin` routing filter**, not disabled accounts. `GET /v1/accounts` returns 31
unfiltered and 29 with `app=fin`; the other two are routed to the OCME consumer. So the guard's
denominator is right and nothing is missing.

### Where each piece lives

- **bank-feed** owns `FINTABLE_API_TOKEN`, so link minting goes there. `src/routes/connections.js`
  already reserves the shape: `POST /v1/connections` is a **501 stub** whose contract note reads
  *"Start a new connection flow"*. ⚠️ **Do not repurpose it** — its contract line also promises
  excel/manual-source creation. Add endpoints that name what they do (`/v1/connections/link`,
  `/v1/connections/:id/link`) and keep the 501 honest.
- **fin** owns the COA mapping, so the diff guard and the UI are fin's — the reconcile page's per-feed
  row, beside the health signal this CR already delivers. fin's `/v1/health/feeds` proxy **already
  carries `connection_id`, `provider`, `institution_name`, `healthy` and `needs_reconnect` per
  connection** (verified live), so the read side needs nothing new.
- Cross-repo request goes through `bank-feed/HANDOFFS.md` as `[Finance → bank-feed]`, per the
  established pattern.

## Built 2026-09-01 — the guard, then the button

**The mapping diff shipped first, deliberately: it stands alone, needs no bank-feed change, and is
what makes the button safe rather than merely convenient.**

- **fin — `findOrphanedMappings`** (`server/src/v2/routes/bankFeed.js`, pure and exported for test).
  `GET /account-mappings` gains `orphaned_mappings`. ⚠️ **The bug it closes is that the page could not
  express this at all:** those rows are built by walking the FEED, so a mapping whose feed account has
  vanished was absent from the one page whose job is to show what needs action. ⚠️ **Returns `null`,
  not `[]`, on an empty feed list** — could-not-ask is not asked-and-absent, the same distinction
  `attachFeedHealth` already pins, and reporting 27 orphans on an upstream blip is how an alarm gets
  trained away. 4 tests.
- **bank-feed — `POST /v1/connections/link` and `/v1/connections/:id/link`** (`07363c7`), minting via
  a new `mintConnectionLink` adapter call. The adapter gained its **first POST**, so `request()` took a
  method/body and ⚠️ **the 429 retry had to replay them** — a retry that silently downgraded a POST to
  a GET is the CR059 P0 shape twice over (both defects were in the request, both returned something
  plausible). Its read-only header claim was rewritten rather than quietly broken. 7 tests, 217 green.
- **fin — the UI** on `/bank-feed-diagnostic`: a **Bank connections** section listing all 13 with
  health pills, a **Re-authorise** button per row, and **Connect a new bank**. The minted URL is
  **shown as a link, never `window.open`** — this page is routinely read from another device over
  Tailscale, and a popup a blocker eats looks exactly like a failure.
- **Upstream 4xx passes through verbatim** rather than flattening to 502: `422` is the documented *no
  plan headroom* answer, and reporting fintable's clear refusal as our outage is a lie about whose
  fault it is.

**Verified:** 1112 backend on a from-scratch DB (+4), 586 frontend, eslint + the hex gate clean, and
the page **rendered in both themes**. ⚠️ **The render earned its keep, as it keeps doing** — it caught
the alert reading *"1 mapping point at…"*, which no test asserted and no gate looks at.
**The orphan path was exercised by breaking a mapping on dev** (`external_name` → a bogus id, then
restored) rather than by trusting an empty list: on real data the check returns `[]`, which proves
only that nothing is wrong, not that the alarm works.

**Verified end-to-end 2026-09-01, against the live upstream.** bank-feed rebuilt (reads unaffected: 31
accounts unfiltered, 29 for `app=fin`, health `ok`), then **one reconnect link minted through fin's own
proxy** — fin route → `bankFeedClient` → bank-feed route → adapter → fintable — returning **HTTP 201**
with a real single-use URL and a 30-minute expiry. **Deliberately a *reconnect* mint, and deliberately
Bank Pekao:** the reconnect form is exempt from the plan checks the new-connection form is subject to
(which consume a monthly connection attempt), and Pekao is OCME's bank, where fin's mapping is
`ignored` with `account_id NULL` — so even the worst case had nothing of fin's behind it. **The URL was
not opened**; it expired unused, which is the whole point of testing the mint rather than the consent.

### On the reconcile page, and the button it disarms (2026-09-01)

**The guard only guards if it is on the path you walk.** It shipped on `/bank-feed-diagnostic`, a page
you open when you already suspect something; the weekly loop happens on `/balance-calibration`.

⚠️ **Two structural facts made this worse than "a signal in the wrong place".**

1. **An orphaned account is already IN the recon table, looking normal.** `balanceReconcile` builds its
   rows from `account_source_mappings` and never joins the feed, and fin's `bankfeed_balances` cache
   still holds the OLD id's rows — so the row does not go blank, it **FREEZES**. Reproduced on dev: a
   re-keyed `Wise - USD` renders `computed 4,048.37 · bank 4,046.87 · drift 1.50`, an ordinary-looking
   DRIFT row whose bank figure is a fossil.
2. **The health badge structurally cannot see it.** `attachFeedHealth` sets `feed_health = null` for an
   account with no upstream counterpart, and the badge counts
   `.filter(a => a.feed_health && a.feed_health.attention)` — a null is excluded. So the page said
   **`ALL FEEDS HEALTHY`** beside it. **That is the sentence the seven-week Revolut gap would have
   displayed, every day, for seven weeks.**

**Shipped, all three at once** (owner decisions, `/question`):

- **A header pill** — `N mapping(s) point at a missing feed account`, counted over **all** rows rather
  than the filtered view (a filter hiding a dead account does not revive it), plus a distinct
  `mapping check unavailable` for could-not-ask.
- **A row badge, `feed gone`, which OUTRANKS every other status** — including `reconciled`. Every other
  status on that row is computed from the frozen figure, so *"reconciled"* is the most misleading thing
  the table can say.
- **`reconcileToFeed` REFUSES an orphaned mapping** (`refused: true`, `feed_orphaned: true`), and the
  row's Reconcile button is disabled. Reconciling would re-anchor `opening_balance` (calibrate) or book
  a yield (accrue) from a number the bank has not reported since the reconnect — CR080's fabricated
  −32.56 loss in a new costume, and that took three migrations to undo. `force` overrides, as everywhere.

⚠️ **The live account list is fetched in the ROUTE, not the engine:** `reconcileToFeed` runs inside a
`db.transaction`, and a network call in that path would hold a transaction open on an upstream timeout.
The engine keeps the rule and is handed the fact. ⚠️ **A null or empty set means could-not-ask and
skips the check** — refusing every reconcile in the app because bank-feed blipped is a worse failure
than the one being guarded. 4 tests pin exactly that, including `force`.

**The orphan signal costs no extra upstream call:** `buildExternalIdToInstitution()` was already being
built on this route, and its KEYS are the live feed account ids, so *"does this mapping still resolve"*
is a `.has()` on data in hand.

*Deliberate, not an oversight:* the red pill sits **beside** `ALL FEEDS HEALTHY` rather than replacing
it. Both are true and they are about different things — the **connection** is healthy, the **mapping**
is not — and suppressing a true signal to avoid an apparent contradiction is how a page starts lying in
the other direction.

**Verified:** 1116 backend on a from-scratch DB (+4), 586 frontend, eslint + hex gate clean, and
rendered in **both themes** against a re-keyed mapping on dev — ⚠️ **and the first probe was not
faithful.** Pointing the mapping at a bogus id left no cached balances, so the row fell to `no feed`
and never exercised the case that matters. Seeding the frozen balance reproduced the real shape: a
plausible DRIFT row, which is the whole reason the badge outranks `reconciled`.

### The Feed health cards were reporting 31 feeds for 13 connections, all STALE (2026-09-01)

**Owner-found by reading the page**, against fintable's own dashboard: *"PKO Bank Polski — STALE, last
sync 893h ago"* while fintable showed everything synced within a day. ⚠️ **Fintable was right. Nothing
was wrong with any feed** — and the card contradicted itself before it contradicted fintable, reading
*"7-day syncs: 165 ok"* directly above *"last sync 893h ago"*.

Two defects in `/v1/health/feeds`, both bank-feed's (`fda1bd8`):

1. **Ghost generations.** 31 `bank_connections` rows for 13 live connections — see
   [roadmap §3](../current/project-roadmap.md#3-known-issues) for the id-drift root cause. All 18
   ghosts carry **zero** accounts, so they were inert; they simply rendered as 18 permanent `STALE`
   cards. `feeds[]` now lists only connections that carry accounts, and the excluded count is published
   as `service.connections_without_accounts` — **stated, not silently dropped**.
2. **Service-wide numbers worn as per-feed.** `sync_health_7d` and the last error were computed inside
   the per-connection loop with no `connection_id` filter (`sync_jobs` has none), so all 13 cards
   carried the same counts and the **same error with the same timestamp**. Moved to a top-level
   `service` block; fin renders it **once**, above the cards. ⚠️ **Breaking within v1** — the only such
   change so far, and it removes a field that was lying.

⚠️ **This CR's own surface was the one telling the untruth.** The `upstream` block it added — read live
from fintable — was correct throughout, which is why `/balance-calibration` kept saying `all feeds
healthy` **correctly** while this page screamed. **The page you open when you suspect something was the
one that could not be trusted.**

**Verified after:** 13 feeds, 0 stale, matching fintable's 13 healthy connections exactly. 217
bank-feed tests, 1116 backend, 586 frontend, rendered in both themes.

## Still to do

- ~~**Deploy** (rebuild the bank-feed stack).~~ **DONE** — it shipped with CR059's cutover rebuilds; the
  `upstream` block has been live on `/v1/health/feeds` since 2026-08-10. This line said "not deployed"
  for six days after it was.
- **The threshold was guessed, and is now measured — 26h → 48h (2026-08-16, bank-feed).** The constant
  justified itself with *"fintable syncs each bank every 6-23h"*, which is wrong: over **1,457 upstream
  timestamps / 605 real gaps**, the median is 22-25h and the tail is the **weekend** (Friday-started
  gaps average 25.3h vs 17-21h; Capital One and Fidelity reach p95 ~46h). At 26h it flagged **18.3% of
  all normal gaps, every one of the 11 institutions at some point, and 8 of 13 connections at once —
  all reporting `READY` with nothing wrong.** 48h is the first threshold above a skipped day: 0.5% of
  gaps, 2 institutions, and Bank Pekao's genuine outage still caught. **Live now: 13 connections, 0
  needing attention.** This had to land *before* the fin page: shipping the display against a threshold
  that paints 8 permanent red rows would have burned the signal on its first day — the same argument
  this CR already makes for keeping `provider_notices` out of `needs_attention`.
- **fin side:** surface it on the reconcile page's per-feed row — the place a stale feed actually hurts.
- ~~**Reconnect / connect-a-bank (unblocked 2026-09-01)**~~ — **BUILT, see above.** Remaining:
  **deploy the bank-feed stack** (shared with prod) and mint one *reconnect* link to prove the path
  end-to-end.
- ~~**Surface the orphan check where the reconcile loop runs**~~ — **DONE, see below.**
- ~~**The orphan pill does not link to the page that fixes it**~~ — **DONE 2026-09-01.** The re-mapping
  lives on another page, so the pill is now a link, and every string naming that page says
  **`Settings → Bank Feed Setup`** — what the MENU calls it, not what the URL does. ⚠️ **The route is
  deliberately NOT renamed to match:** [CR088 §P5](cr-088-budget-vs-actual-le-table.md) settled this
  exact question for `/budget-vs-actual` → *Budget Analysis* (owner decision) — a redirect for a string
  nobody reads is debt on debt. The discoverability problem was the missing link, not the URL.
- **`GET /institutions` passthrough**, so *Connect a new bank* can pre-select the bank instead of
  opening a generic search. Optional: the flow works without it.
- Decide whether `needs_reconnect` should reach the owner rather than waiting to be looked at (a push
  notification path already exists from CR006).

## Depends on

[CR059](cr-059-fintable-api-ingestion.md) P1's `fintableApi` adapter (built, dormant). Does **not**
depend on the cutover: the health read works while `FINTABLE_SOURCE=sheets`.
