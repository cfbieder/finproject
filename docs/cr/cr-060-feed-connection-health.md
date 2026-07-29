# CR060 — Feed connection health (read-only) — PLANNED (nothing built)

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

## Depends on

[CR059](cr-059-fintable-api-ingestion.md) P1's `fintableApi` adapter (built, dormant). Does **not**
depend on the cutover: the health read works while `FINTABLE_SOURCE=sheets`.
