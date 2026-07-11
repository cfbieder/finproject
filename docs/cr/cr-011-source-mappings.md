**Status:** COMPLETED — [Plan](../current/project-roadmap.md#cr011)

# CR011 — Source Mappings (Category + Account)

Decouple external system names (PocketSmith, future Quicken) from internal app names. Renaming an account or category in the app no longer breaks sync.

## Outcome

- New tables (migrations 018, 019):
  - `category_source_mappings(category_id, source, external_name)` UNIQUE(source, external_name) — *folded into `account_source_mappings` after CR013.*
  - `account_source_mappings(account_id, source, external_name)` UNIQUE(source, external_name).
- One-to-many: multiple external names can map to one app entity.
- Sync JOINs (PS staging → transactions) resolve via the mapping table instead of `accounts.name` / `categories.name`.
- Auto-creates a `pocketsmith` mapping when a new account/category is added (`POST /api/v2/util/coa/add`, `POST /api/v2/accounts`).
- COA Management edit modal shows a "Source Mappings" section (PocketSmith Name + Quicken Name fields).
- API: `GET /lookup`, `GET/PUT/DELETE /:id/mappings` under both `/api/v2/categories` and `/api/v2/accounts`.

## Key references

- Migrations: `018_category_source_mappings.sql`, `019_account_source_mappings.sql`.
- Repos: `server/src/v2/repositories/accountSourceMappings.js` (categorySourceMappings.js was deleted in CR013).
- Routes: source-mapping endpoints in `routes/accounts.js` and `routes/categories.js`.

## Successor

CR013 collapsed `category_source_mappings` into `account_source_mappings` — there's now a single mapping table covering both.
