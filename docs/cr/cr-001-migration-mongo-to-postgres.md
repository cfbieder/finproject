**Status:** COMPLETED — [Plan](../current/project-roadmap.md#cr001)

# CR001 — MongoDB → PostgreSQL Migration

Migrated all persistent storage from MongoDB to PostgreSQL 16. The application is now fully PostgreSQL-backed; the legacy `routes/` (V1) and the MongoDB `coa.json`/`coa_traits.json` files have been removed.

## Outcome

- Single-source-of-truth COA in the `accounts` table (recursive CTE for hierarchy).
- All transaction, budget, and forecast data lives in normalized PostgreSQL tables.
- V2 API surface (`/api/v2/*`) is the only API. V1 routes deleted.
- Migration files numbered 001–021 in `server/db/migrations/`.

## Key references

- Schema: `server/db/migrations/001_initial_schema.sql`
- Repositories: `server/src/v2/repositories/`
- Routes: `server/src/v2/routes/`
- Original migration plan: archived at `docs/archive/MIGRATION_PLAN.md` and `docs/archive/MIGRATION_STATUS.md`.

## Closed items folded in

Phase 1, Phase 2, Phase 3 completion reports — see `docs/archive/PHASE1_COMPLETE.md` etc. for historical detail.
