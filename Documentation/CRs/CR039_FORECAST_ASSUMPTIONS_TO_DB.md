# CR039 — Forecast Assumptions to Postgres (retire `FCAssump.json` dual source)

**Status:** PLANNED (scoped 2026-07-03 from the design review; not started). **Prerequisite for CR027** (multi-tenancy) — schedule before v4 schema work begins.
**Track:** v3
**Anchor in FC_NEXT_STEPS.md:** [cr039](../FC_NEXT_STEPS.md#cr039)

## Problem

Forecast assumptions live in **two places**: Postgres (per-scenario tables) and the on-disk file `components/data/FCAssump.json`, merged at read time in `routes/forecast.js:41-125` and written back to the file **synchronously inside request handlers** (`fs.readFileSync`/`writeFileSync`). Consequences, per the 2026-07-03 design review:

- **Race-prone dual source of truth** — concurrent edits to file + DB have no ordering; the merge logic is the only arbiter.
- **Blocking sync I/O on the request path** (`routes/forecast.js:41-125,1284-1424`; `fcbuilder-setup.js:6`).
- **Backups must know about the file** — a DB dump alone cannot reproduce forecast state (backup script currently grabs `components/data/` as a special case; that coupling is the symptom).
- **Hard blocker for CR027** — schema-per-tenant cannot share one disk JSON; discovering this mid-tenancy work would force an unplanned migration. Doing it now, on v3, keeps it small and independently verifiable.
- Related engine smell (same coupling family): the FC engine writes **debug CSVs synchronously mid-computation** (`services/forecast/index.js:540`, `fcbuilder-module.js:74`).

## Scope

### P1 — Schema + data migration
Next-numbered migration: a `forecast_assumptions` store (either a dedicated table keyed by assumption name with JSONB value, or rows in the existing `app_data` pattern — decide at implementation; dedicated table recommended for CR027's per-schema future). One-time idempotent import of the current `FCAssump.json` contents (script under `v2/scripts/`, `DATABASE_URL`-driven like the others). Apply prod-before-code per MIGRATIONS.md discipline.

### P2 — Read/write path cutover
- `routes/forecast.js`: assumptions GET/PUT read and write **only** the DB; delete the file-merge block (`:41-125`) and the writeback (`:125`, `:1284-1424` where file-backed).
- `services/forecast/fcbuilder-setup.js`: engine loads assumptions from the DB (it already holds a DB handle via `v2/db`), dropping `fs.readFileSync`.
- `FCSettings` frontend is unaffected (same endpoints, same shapes) — verify no shape drift.

### P3 — Decommission the file
- `FCAssump.json` removed from the live path; keep the file on disk one release as a fallback artifact, then delete + drop it from `backup-to-remote.sh`'s special-cased `components/data/` set (leave the other data files).
- Gate the engine's debug-CSV `writeFileSync` calls behind an env flag (`FC_DEBUG_CSV=1`), default off — removes blocking side-effects from generation without losing the diagnostic.

## Non-goals
- No change to assumption *semantics*, the merge precedence result, or the FC engine's math — this is a storage relocation; `GET` responses must be byte-comparable before/after (test this).
- No tenancy columns yet (CR027A adds those on its own schedule; this CR just removes the disk dependency it can't carry).
- The other `components/data/` files (`account_names.json`, `category_names.json`, `appdata.json`) stay as-is — separate question, lower stakes.

## Verification
- Byte-compare `GET /forecast/assumptions` (and the settings page payloads) before vs after cutover on a synced dev DB.
- Full forecast generate on a real scenario → identical `forecast_entries` output pre/post (the engine e2e suite plus a manual scenario run).
- Backend suite green; restore-from-dump drill on dev proves forecast state survives a DB-only restore.

## Deploy order
Migration (+ import script) on prod **first**, then code deploy — standard prod-before-code.
