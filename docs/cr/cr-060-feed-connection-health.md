# CR060 — Feed connection health (read-only) — IN-PROGRESS (bank-feed side **built AND deployed**; fin recon page to do)

Surface what fintable already tells us about the *health* of each bank connection, so a dead feed is
visible the day it dies instead of the week someone notices the numbers stopped moving.

Roadmap anchor: [project-roadmap.md#cr060](../current/project-roadmap.md#cr060). **Track: v3.**
**Split out of [CR059](cr-059-fintable-api-ingestion.md) §15A** by its pass-2 sign-off (M5 + R3): the
*read* half needs nothing but the read-scope token CR059 already has and works regardless of
`FINTABLE_SOURCE`, while the *write* half (minting a reconnect link) needs a write-capable credential
and belongs in its own decision.

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

Minting reconnect links (`POST /connections/{id}/link`), forcing an upstream sync (`POST /sync`), and
anything else needing a **write-scope token**. Those are a separate decision — see CR059 §10 on why a
write-capable credential in an unattended service is not free.

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
- Decide whether `needs_reconnect` should reach the owner rather than waiting to be looked at (a push
  notification path already exists from CR006).

## Depends on

[CR059](cr-059-fintable-api-ingestion.md) P1's `fintableApi` adapter (built, dormant). Does **not**
depend on the cutover: the health read works while `FINTABLE_SOURCE=sheets`.
