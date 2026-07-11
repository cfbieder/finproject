# Project Description — <<APP>>

> The full "what's built" record — read on demand, not at session start. Bullet-per-fact,
> date as a leading tag, link to CR docs for detail. De-densify when a section becomes a
> wall of prose.

## What this is
<2–4 bullets: the product, its users, its deployment shape. Deeper why: the project brief
(archived at [project-brief](../archive/project-brief_v0.1.md) once frozen).>

## Architecture at a glance
- [YYYY-MM-DD] Stack: <<BACKEND>> · <<FRONTEND>> · <<DB>> · <<WEB>> ([CR-001](../cr/cr-001-architecture-foundation.md))
- [YYYY-MM-DD] Topology: <3-tier / +worker>; dev = <shape>, prod = <shape> on <<HOST>>

## Capabilities (by area)
### <area>
- [YYYY-MM-DD] <fact> ([CR-00X](../cr/README.md))

## Data model headline
<core entities in one paragraph; schema detail lives in migrations + CR docs>

## Cross-environment migration matrix
| Migration | dev | staging | prod | Notes |
|---|---|---|---|---|
| 001_initial | ✓ YYYY-MM-DD | — | ✓ YYYY-MM-DD | |

## Scheduled-job registry
| Job | Layer (host cron / app worker / aux host) | Schedule | Lives at | Success observed via |
|---|---|---|---|---|

## Secrets inventory
See [secrets-inventory.md](secrets-inventory.md) — names/locations only, never values.
