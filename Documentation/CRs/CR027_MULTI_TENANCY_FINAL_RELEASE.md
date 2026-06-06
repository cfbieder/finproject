# CR027 `[v4]` — Multi-Tenancy & Final-Release Readiness

**Status:** PLANNED — **umbrella / program doc.** Direction approved; **not approved for implementation as a single CR.** Per engineering review (2026-06-06) the work is split into independently-shippable sub-CRs **CR027A–E** (see §"Sub-CR breakdown"). Each sub-CR gets its own file when picked up; no code starts on the DB layer until the §"DB-access audit" and §"Migration strategy" gates below are satisfied.
**Anchor in FC_NEXT_STEPS.md:** [cr027](../FC_NEXT_STEPS.md#cr027)
**Supersedes the "future CR027" placeholder** referenced in [CR026](CR026_UI_REVAMP.md) (auth / multi-tenancy / de-personalisation).

## Summary

Turn the single-user personal-finance app into a **shared multi-user SaaS** that other people can be invited to use, and clean it up into a **shippable "final release"** in the same effort. Five threads:

1. **Multi-tenancy** — isolate each user's data with a **schema-per-tenant** model (`tenant_<id>` Postgres schemas + a `shared` schema for market reference data + a `public` control plane).
2. **Authentication** — email + password, **admin-invite only** (no public signup), httpOnly cookie sessions, locked-down CORS.
3. **Demo starting database** — a **synthetic, fictional** dataset (`tenant_demo`) generated from scratch — never a copy of the owner's real finances.
4. **Help & instructions on every section** — extend the CR026-P3 `HelpPanel` into real per-page/per-section guidance, including setup instructions for each data source.
5. **Data-source IA cleanup + legacy retirement** — reframe ingestion as **ongoing** (Fintable feed, Excel upload, manual entry) vs **one-time migration** (Quicken, PocketSmith, "other service"). **Hide PocketSmith as a live feed** — it was an intermediary, demote it to a one-time import. Remove dead/intermediary artifacts.

This is a **multi-session, architectural CR**. It depends on no other open CR but interacts with CR023 (PS removal), CR025 (manual entry), and CR026 (sidebar/help). It should land **after** CR025 ships (manual entry is the primary ongoing-entry path for new users without feeds).

---

## Owner decisions (settled 2026-06-06)

| # | Question | Decision |
|---|----------|----------|
| 1 | Tenancy model | **Shared SaaS, schema-per-tenant.** One running instance; each user gets a `tenant_<id>` Postgres schema. Existing SQL runs unchanged via per-request `search_path`. |
| 2 | Auth model | **Email + password, admin-invite only.** No public signup. bcrypt + httpOnly cookie session. TOTP 2FA deferred to a later phase. |
| 3 | Demo data | **Synthetic fictional dataset** built by a seeded generator — not a de-personalized copy of real data. |
| 4 | Data sources | Final release distinguishes **ongoing** (Fintable / Excel / manual) from **one-time migration** (Quicken / PocketSmith / other). **PocketSmith is hidden as a live feed** and demoted to a one-time importer. |
| 5 | Help | **Per-section help + setup instructions** on every page, built on the existing `HelpPanel`. |
| 6 | Legacy | Audit and retire intermediary/dead code as part of the release. |

---

## Design / style reference (living)

The single canonical visual reference for the commercial UI is the standalone mockup **[CR026_UI_PREVIEW.html](CR026_UI_PREVIEW.html)** — one self-contained HTML file (design tokens + components + interactive sidebar/theme/⌘K). **It is a living document: keep it updated as the style refines, and treat it as the source of truth for tokens, spacing, type hierarchy, and component shells.** When a UI decision is made here, reflect it in that file in the same change so design and spec never drift.

> **Note the conflict this resolves:** the *in-app* `/ui-preview` React route (`pages/UIPreview.jsx`) is still removed from the shipped product (end users shouldn't see a non-functional mockup — see Legacy retirement), but **the HTML file itself is kept and maintained** as the design reference. Delete the route, keep the artifact.

### Commercial / multi-user UI surfaces (from design review)

The mockup already carries (Revision 3) the structural pieces a multi-tenant SaaS needs; CR027 commits them to scope:

- **Workspace switcher** — the static brand becomes a clickable workspace selector. **Open design decision (important):** the chosen data model is `users.tenant_schema` (**one schema per user**), but a switcher labelled "Personal / Joint / Business" implies **one user → many workspaces**. To honor that we need a `user_tenants` **many-to-many** join and the auth/ALS layer must carry the *active* tenant (not a fixed one). *Recommendation:* keep the 1:1 model for the first release and render the switcher as **single-workspace / "+ add workspace (coming soon)"**, then promote to many-to-many in a follow-up — don't build M:N now unless joint/business profiles are a launch requirement.
- **Account menu** (top-right) — exposes **Manage access**, **Invite a member**, **Switch workspace**, **Sign out**. "Invite a member" is the user-facing surface of the admin-invite provisioning flow (Phase 2).
- **Tier / billing real estate** — *deferred, reserved space only.* **Critical note:** the auth model is **admin-invite, no public signup → there is no billing system in this CR.** The mockup's "Pro Plan" label is a placeholder for a *future* monetization decision; do **not** build subscription tiers, usage meters, or upgrade CTAs now. Reserve the slot, ship at most a static/neutral tier label.

### Help embedding (design review → folded into Phase 5)

Three contextual-help patterns, in addition to the global `HelpPanel`:
- **Inline definition tooltips** — a subtle `(i)` next to financial jargon (Savings Rate, Liabilities, Net Cash Flow, Neutralize, Yield Spread). The mockup ships a CSS-only `.uiprev-tooltip` pattern; productionize it as the `<FieldHelp>` component (with `aria-describedby`) named in Phase 5.
- **Empty states as onboarding** — empty cards carry a friendly graphic + a primary CTA ("Connect a bank", "Add your first transaction") instead of blank space. Ties directly to the first-run wizard.
- **Command palette as help center** — seed ⌘K with "How do I…" entries that route to the relevant page/setting, not just navigation.

---

## Why schema-per-tenant (and not a `tenant_id` column)

The app has **34 tables, zero existing tenancy**, and **hand-written SQL across ~12 repositories and ~15 route files**, none of which filters by owner. Two viable models were weighed:

| | Schema-per-tenant (**chosen**) | `tenant_id` column + RLS |
|---|---|---|
| Query-layer churn | **~None** — repos keep calling `db.query(sql, params)`; isolation via `SET search_path` | Touch every query; set session var per request |
| Unique constraints | **Unchanged** (`unique(source, external_name)` is naturally per-schema) | Must rewrite ~10 constraints to include `tenant_id` |
| Leak risk | **A forgotten `WHERE` can't leak** — other schemas aren't on the path | One bad RLS policy / missing filter leaks money data |
| Per-user backup/delete | `pg_dump -n tenant_x` / `DROP SCHEMA … CASCADE` | Filtered dump; careful delete |
| Migrations | **Must fan out to every schema** (needs a runner — the main cost) | Single migration |
| Scale ceiling | Thousands of schemas (fine here) | Millions (overkill here) |

For a **finance app at family/friends/beta scale**, isolation strength + minimal query churn outweigh the migration-fan-out cost. The fan-out is a one-time tooling investment we **need anyway** — today migrations only run via `docker-entrypoint-initdb.d` on first DB init; there is no real runner.

---

## Target architecture

```
PostgreSQL "fin" database
├── public                ← control plane (NEW, tiny)
│   ├── users             (id, email, bcrypt_hash, role, tenant_schema, status, invited_at, …)
│   ├── tenants           (schema_name, display_name, status, created_at)
│   └── schema_migrations (schema_name, version, applied_at)   ← per-schema migration tracking
├── shared                ← read-only market data; written ONLY by the FX cron
│   └── exchange_rates    (the ONLY genuinely cross-user table — has no FKs)
├── tenant_owner          ← the current owner's data, relocated here at cutover
├── tenant_demo           ← synthetic showcase dataset
└── tenant_<id>           ← one per invited user; cloned from the template at provisioning
```

**Key design choices:**

- **Only `exchange_rates` goes in `shared`.** `securities` / `security_prices` / `security_source_mappings` stay **per-tenant** despite being "market-ish" — duplicating an `AAPL` row across a handful of schemas is irrelevant at this scale and **eliminates all cross-schema foreign keys** (a tenant's `security_lots → securities` FK stays inside the tenant schema). This avoids cross-schema-write and `DROP SCHEMA` complications entirely.
- **The 17 per-user tables + their staging/config tables all live in `tenant_<id>`** — `accounts`, `transactions`, `budget_*`, `forecast_*`, `transfer_match_*`, `security_*`, `fc_ai_*`, `account_source_mappings`, `bankfeed_balances`, `*_staging`, `quicken_*`, `sync_metadata`, `app_data`, the two views. (`app_data` and `sync_metadata` are per-tenant because each user's last-refresh / sync state is their own.)
- **`search_path = tenant_<id>, shared`** per request → existing queries resolve their tables in the tenant schema and `exchange_rates` from `shared`, with **no SQL changes**.

---

## Current state (what already exists — verified)

| Area | State |
|---|---|
| Tenancy columns | **None.** No `user_id`/`tenant_id`/`owner` anywhere ([all 29 migrations](../../server/db/migrations/)). |
| Auth | **None.** No passport/jwt/bcrypt/session deps; CORS is `origin: true, credentials: true` ([app.js:11](../../server/src/app.js#L11)); frontend sends no auth header ([rest.js](../../frontend/src/js/rest.js)). |
| DB access | Single shared `pg.Pool` ([postgres.js](../../server/src/v2/db/postgres.js)); repos call `db.query()` directly with no scoping. No `AsyncLocalStorage`, no `req.user`. |
| Migration runner | **None** — `.sql` files auto-run once via `docker-entrypoint-initdb.d` on first init. |
| Seed infra | Idempotent: `seedAccounts.js` (COA), `seed-cr019-coa.js` (historical/income leaves), `populate-exchange-rates.js` (FX). Good building blocks. |
| Help infra (CR026 P3) | `components/HelpPanel/` (static glossary + shortcuts), `components/CommandPalette/` (⌘K over routes), all 39 routes carry a `description`. Mounted **only in the sidebar layout**. No per-page/per-section help yet. |
| Data-source surfaces | See IA table below. |

### Data-ingestion surfaces today

| Surface | Path | Kind | Final-release disposition |
|---|---|---|---|
| Upload PS (CSV) | `/upload-ps` | **One-time** | Move under **Migrate from another service**; relabel. |
| Refresh Feeds (PS API + bank-feed) | `/refresh-ps` | Ongoing | **Split** — keep bank-feed (Fintable) as ongoing; **remove the PS-API refresh** path/button from the UI. |
| Bank Feed Setup | `/bank-feed-diagnostic` | Ongoing | Keep; rename to **"Bank Feed (Fintable)"**; add setup instructions. |
| Quicken Import | `/quicken-import` | **One-time** | Keep under **Migrate from another service**; mark one-time. |
| Excel/CSV upload | — | Ongoing+one-time | **Build** (CR021 Phase 4 never landed; UI mockup only). |
| Manual entry | `/manual-entry` | Ongoing | **CR025** delivers it; this CR assumes it shipped. |

---

## Proposed final-release data-source IA

Reorganize the sidebar "Data Sources" group into two clearly-labelled buckets:

```
Data Sources
├── Ongoing
│   ├── Bank Feed (Fintable)      ← /bank-feed-diagnostic  + "How to set up Fintable" help
│   ├── Excel / CSV Upload        ← NEW
│   └── Manual Entry              ← /manual-entry (CR025)
└── Migrate from another service  (one-time)
    ├── PocketSmith (CSV)         ← /upload-ps, relabelled
    ├── Quicken (QIF)             ← /quicken-import
    └── Other (CSV/Excel)         ← reuses the Excel/CSV importer with a generic mapping step
```

- **PocketSmith is no longer a "feed."** The live PS-API refresh disappears from the UI; PS survives only as a one-time CSV importer for users migrating off it. (Backend PS-API code is retired per CR023's data-preserving runbook — see Legacy section.)
- Each ongoing source gets an **in-page setup/instructions panel** (Fintable especially: how to connect a bank, share the Google Sheet, get the API key).

---

## Step 0 — Dual-track development workflow & v4 runtime (do this first)

CR027 ("v4") is a multi-month effort that must **not** reach production until far ahead, while **v3.x tweaks keep shipping in parallel** and must flow into v4. The naïve approach — a long-lived `v4` branch — is the wrong default here: CR027A rewrites the exact DB-layer files v3 also touches (`db/postgres.js`, the migration system), so a long branch diverges and forward-merges become a permanent tax. **The strategy is to diverge the *runtime*, not the *code*.**

### Code: trunk-based on `main`, flag-gated + backward-compatible
- v4 lives on `main` behind flags, shipping **dormant** to prod — the same pattern CR026 used (`VITE_NAV_LAYOUT`). Because v3 and v4 are then the **same branch**, v3 tweaks carry into v4 automatically — there is nothing to merge.
- **CR027A must be a no-op in single-tenant mode:** with no auth/tenant context, `search_path = public` ⇒ byte-for-byte today's behavior. The ALS wrapper, the `db.transaction()`/`getClient()` fix, and the migration runner all behave as today when the flags are off.
- New flags, **default OFF**, committed off: `FIN_MULTI_TENANT`, `AUTH_ENABLED`. The "v4 ON" values live **only** in the v4 runtime env (below) — never in the prod compose file. `deploy-to-production.sh` keeps deploying `main` with flags off, so prod is unaffected by in-flight v4 code.
- **Merge discipline:** only land an increment on `main` once it is **dormant-safe + tested**. Keep genuinely-unstable work on a short throwaway branch until dormant-safe, then merge. (Standard repo rules still apply: explicit pathspecs, no `git add -A`, never force-push `main`.)

### Runtime: a third, fully-isolated v4 stack
Prod and dev (v3) already coexist on this host. v4 adds a **third** stack. The non-negotiable isolation is the **Postgres volume** — CR027A reorganizes the database (creates `shared`, `control_plane`, `tenant_*` schemas), which must never touch `postgres_data` or `postgres_data_dev`.

| | Prod | Dev (v3) | **v4 (new)** |
|---|---|---|---|
| Postgres | `5433` / `postgres_data` | `5434` / `postgres_data_dev` | **`5435` / `postgres_data_v4`** |
| Server | `3005` | `3105` | **`3205`** |
| Frontend | `5175` / `3006` | — | **`5275` / `3206`** |
| Flags | OFF | OFF | **`FIN_MULTI_TENANT=1 AUTH_ENABLED=1`** |

**Deliverables of Step 0:**
1. **`docker-compose.v4.yml`** — mirrors `docker-compose.dev.yml` with the ports/volume/flags above (own `COMPOSE_PROJECT_NAME=finv4`).
2. **`Scripts/v4-up.sh`** — wrapper to bring the v4 stack up/down.
3. **`Scripts/sync-db-prod-to-v4.sh`** — analog of `sync-db-prod-to-dev.sh` that seeds the isolated `postgres_data_v4` from a prod snapshot, after which CR027A's reorg runs on it → realistic `tenant_owner` (your real data) + `tenant_demo` for testing.
4. **git worktree (on-demand, not always needed).** Because the v4 code lives on `main`, you **run the v4 stack straight from the main tree** — `./Scripts/v4-up.sh` builds the image from current source; no separate checkout required. A worktree is only for when you cut a **separate branch** (the short-lived CR027C/E work, or staging an unstable increment a thread doesn't want on `main` yet): `git worktree add -b cr027c ../psproject-cr027c main`. Note git **won't** let two worktrees check out `main` simultaneously, so a worktree always implies its own branch — which is exactly why it's reserved for branch work, not for the day-to-day trunk-based runtime.

### When a short-lived branch *is* warranted
Two pieces genuinely can't be dormant: **CR027C** (owner cutover — physically relocates prod tables) and **CR027E** (PS-API UI removal). Cut these as **short-lived** branches right before flipping the switch — not a long-lived v4 line. If one lives more than a few days, forward-merge `main → branch`; merge (don't rebase) a shared branch; never force-push.

### Go-live is a flag flip, not a big-bang merge
Because the code already lives on `main`, releasing v4.0 = **enable the flags in prod config + run the one-time cutover (CR027C)** — not merging a giant divergent branch. This is the core payoff of the trunk-based + dormant approach.

---

## Sub-CR breakdown (CR027A–E)

Per engineering review, this is a **program**, not one CR. Split into independently-reviewable, independently-shippable sub-CRs. Each gets its own file when started.

| Sub-CR | Scope | Maps to | Depends on | Gated by |
|---|---|---|---|---|
| **CR027A — Tenancy foundation** | Schema template tooling + migration runner + per-request DB scoping (ALS, `db.query`/`transaction`/`getClient`). **No auth, no user-visible change.** | Phases 0–1 | — | §DB-access audit, §Migration strategy |
| **CR027B — Auth & provisioning** | `users`/`tenants`, login/session, security hardening, admin-invite + schema provisioning. | Phase 2 | CR027A | §Auth & session security |
| **CR027C — Owner cutover** | One-time relocation of current data → `tenant_owner`; `exchange_rates` → `shared`. | Phase 3 | CR027A, CR027B | §Migration strategy (rollback rehearsal) |
| **CR027D — Onboarding, demo & importers** | Synthetic `tenant_demo`, help/`FieldHelp`, first-run wizard, Excel/CSV importer. | Phases 4–5 | CR027B | — |
| **CR027E — Release cleanup** | Data-source IA, PS-API UI removal, legacy retirement, **secrets gate**. | Phase 6 | CR027B | §Release gates |

The remainder of this doc is the shared design; the phase blocks below carry a `→ CR027x` tag.

---

## DB-access audit (required before any cutover — CR027A acceptance)

Schema-per-tenant only holds if **every** DB access flows through a request-scoped, `search_path`-correct client. A grep of the codebase shows it does **not** today. Closing this is a hard precondition.

**Known bypass sites (must each be handled):**
- **`routes/quickenImport.js:30-31`** — builds its own `pool = { query: db.getPool().query, connect: db.getPool().connect }` and queries it directly. Bypasses ALS entirely. → Route through the request-scoped wrapper (or, since Quicken import is admin/one-time, run it explicitly bound to the target tenant schema).
- **`db.transaction()` / `db.getClient()`** (`postgres.js`) — acquire a fresh `getPool().connect()` with no `search_path`. Call sites: `repositories/transactions.js` (×5), `budget.js`, `forecast.js`, `transferMatchGroups.js`, `services/refreshBankFeedV2.js`, `reconcileToFeed.js`. → Made request-aware centrally (Phase 1).
- **Standalone scripts** (`seed-*.js`, `quicken-*.js`, `ps-anchor.js`, `retire-handoff.js`, `copy-quicken-to-prod.js`, `load-bank-statement.js`, `rebuild-db.js`, `seedAccounts.js`) — each does its own `new Pool()`. These run **outside** any request, so they must take an explicit **`--tenant <schema>`** argument (or `search_path`) and refuse to run unscoped. Operational, not request-path, but they can corrupt the wrong schema if left ambient.

**Acceptance criteria for CR027A:**
1. A CI/grep gate fails the build on any **new** `getPool()` / `new Pool(` / `.connect(` outside `postgres.js` and the audited script list.
2. A test proves a `db.transaction()` opened inside a request runs on the **request's tenant** `search_path` (not `public`, not a stale tenant).
3. A test proves an admin Quicken-import request writes only into the caller's tenant schema.
4. A machine-generated **object inventory** (`pg_dump --schema-only`) is committed and diffed against the template, covering tables **+ types + sequences + views + functions + triggers + constraints** — not the hand list in this doc.

---

## Migration strategy: fresh install vs existing DB (CR027A / CR027C gate)

Today migrations run **only** via `docker-compose.yml`'s `/docker-entrypoint-initdb.d` mount — i.e. **only when the data volume is empty** — and `deploy-to-production.sh` has **no migration-apply step**. A naïve "squash 001–029" breaks the existing prod DB (which already has 001–029 applied, plus the `021` drop). The runner must handle **both** worlds:

- **Fresh install:** create `public` control plane + `shared`; provision schemas from the generated template (already at the latest version — record that baseline in `schema_migrations`).
- **Existing prod DB:** **baseline** it — record `029` as already-applied for the (soon-to-be) `tenant_owner` schema without re-running it; **current-state detection** (probe for known objects / a version marker) decides baseline vs replay. Never re-run a migration that's already physically applied.
- **Deploy step:** add an explicit, idempotent `migrate` invocation to `deploy-to-production.sh` **before** the container swap (the CLAUDE.md rule "apply DB migrations to prod before deploying code that references new objects" currently has no tooling behind it).
- **Rehearsed rollback:** every cutover/migration step has a tested down-path or a `pg_dump` taken immediately before; CR027C (owner cutover) specifically rehearses restore on a dev clone before touching prod.

---

## Auth & session security requirements (CR027B acceptance spec)

"Add bcrypt + a cookie" is not a security design. CR027B must decide and implement:

- **Password storage:** `bcrypt` (cost ≥ 12) or `argon2id`. No plaintext, no fast hashes.
- **Session cookie:** `httpOnly`, `Secure`, `SameSite=Lax` (or `Strict` if no cross-site flows); short-lived access token + server-side session record so sessions are **revocable** (logout, password change, admin disable all invalidate immediately). A stateless-JWT-only design that can't be revoked is rejected.
- **CSRF:** with cookie auth, mutating routes need protection — `SameSite` + an **origin/referer check** or a double-submit CSRF token. Decide one; document it.
- **Invite flow:** invite tokens are single-use, **expiring** (e.g. 72h), and provisioning the tenant schema happens on **accept**, not on invite-send.
- **Password reset:** expiring single-use token; reset **revokes existing sessions**.
- **Brute-force:** per-account + per-IP **failed-login lockout / backoff** on top of global rate-limiting.
- **Authorization:** explicit **admin vs member** role boundary; admin-only routes (user CRUD, provisioning, cross-tenant tools) enforced server-side, not just hidden in UI.
- **Route coverage:** **all `/api/v2/*` require a valid session except an explicit allowlist** (`/health`, auth endpoints). Default-deny, not default-open. (Today CORS is `origin:true, credentials:true` and nothing is protected.)

---

## Release gates (hard blockers for any public/non-owner release — CR027E)

- **Secrets:** `docker-compose.yml` ships default credentials (`POSTGRES_PASSWORD:-findev123`) and `.env-cmdrc` carries real `PS_API_KEY`/`PS_USER_ID`; `.env` carries `BANK_FEED_API_KEY`. **None may ship.** Add `.env.example` (placeholders only), require real secrets via injected env at deploy, and add a **CI secret-scan + grep gate** (block known tokens: `findev123`, PS keys, feed UUIDs, `Caixa/PKO/Fidelity/OCME`).
- **De-personalization:** no real institution names / account numbers / addresses / feed UUIDs in seed code, fixtures, or UI placeholder copy (see Legacy retirement + Phase 5).
- **Feed honesty:** the UI must not say "connect your bank" to a tenant who can't (see callout) until per-tenant feeds exist.

---

## Implementation phases

### Phase 0 — Schema tooling (no behavior change) → **CR027A**
- **Machine-generate** the canonical template — do **not** hand-squash 001–029. Run `pg_dump --schema-only --no-owner` against a **migrated current DB** to capture the *actual current state* (e.g. `categories` was created in 001 but **dropped by 021**, so a hand-squash would wrongly re-create it). Split the dump into **`tenant_template.sql`** (per-tenant objects), **`shared.sql`** (just `exchange_rates`), **`control_plane.sql`** (`users`/`tenants`/`schema_migrations`). The template must include **all object types, not just tables** — `enum`/composite **types** (e.g. `security_tx_type`, account-type/section enums), **sequences**, **views** (`v_balance_sheet`, `v_budget_vs_actual`), **functions/triggers**, indexes, and constraints. See §"DB-access audit" for the required object inventory.
- Build a **Node migration runner**: ensure `public` control tables + `shared`; for each tenant schema apply pending migrations from a numbered `migrations/tenant/` dir; record in `public.schema_migrations(schema_name, version)`. Wire into server startup **and add an explicit migration-apply step to `deploy-to-production.sh`** (today it has none — see §"Migration strategy").
- **Runner robustness (per review):** each schema's migration step runs in its **own transaction** (`BEGIN … COMMIT`) and the ledger is updated in the same transaction, so a failure rolls that schema back cleanly. The runner **halts on the first failed schema**, reports which schema/version failed, and is **resumable** (re-running skips already-applied schemas via the ledger — never partial-applies). A `--dry-run` lists the per-schema plan without writing. *Caveat:* a few DDL statements can't run inside a transaction (e.g. `CREATE INDEX CONCURRENTLY`) — none are needed today; if one is ever added, that migration is flagged non-transactional and handled explicitly.
- **Acceptance:** on a dev DB, create one tenant schema, `SET search_path` manually, and confirm **every report/forecast/budget page works with zero query changes**; a deliberately-failing migration on the 2nd of 3 schemas halts cleanly and resumes correctly on re-run.

### Phase 1 — Per-request DB scoping → **CR027A**
- `AsyncLocalStorage` request store. Middleware checks out a pooled client, `SET search_path = $tenant, shared`, stashes it in the ALS store; a thin `db.query` wrapper prefers the request client. Repos that go through `db.query` are untouched.
- **`db.transaction()` and `db.getClient()` MUST be made request-aware (per review — this is the leak gap).** Both today call `getPool().connect()`, which returns a **fresh pooled client with no `search_path`** — under naïve request scoping a transaction would silently run against the **default/`public`** schema or a *stale* tenant. Fix in `postgres.js`: when an ALS request context exists, `getClient()`/`transaction()` either **reuse the request's client** (preferred — keeps the whole request on one connection/path) or **`SET search_path` on the freshly-acquired client before yielding it**. This is centralized so the ~10 call sites (`repositories/transactions.js` ×5, `budget.js`, `forecast.js`, `transferMatchGroups.js`, `services/refreshBankFeedV2.js`, `reconcileToFeed.js`) need no change. See §"DB-access audit" for the enumerated sites and acceptance criteria.
- **Release is tied to the response lifecycle, not the handler (per review):** register the release on `res` **`finish` AND `close`** events (the latter fires on client aborts / upstream crashes that bypass a handler-level `finally`), plus an idempotent release guard so double-fire is safe. This is what prevents connection leaks when an error escapes the middleware chain.
- **Defense against pool poisoning (per review):** the **primary** guarantee is that the wrapper **always issues `SET search_path` on checkout before the first query** — a pooled client carrying a stale path from a prior request is always overwritten, so it can never serve the wrong tenant. As **belt-and-suspenders**, reset the path to a safe non-tenant default on release. (We deliberately avoid `DISCARD ALL` as the routine reset — it also drops prepared statements/cursors and is heavier than needed; a plain `SET search_path` reset suffices. `DISCARD ALL` is reserved for an error-path "return to clean state".)
- Raise pool `max`; load-test concurrent-request behavior against the dedicated-client-per-request model.
- **Acceptance:** run with a hard-coded tenant; app behaves identically to today; a forced mid-request error and a forced client-abort both release the connection (pool count returns to baseline); a stale-path client re-checked-out never leaks the prior tenant.

### Phase 2 — Auth + provisioning → **CR027B**
- Add `bcrypt`, a JWT/`cookie` signer, `helmet`, `express-rate-limit`. **Lock CORS** to the known frontend origin(s). **The full security contract (CSRF, cookie flags, invite-token expiry, reset, revocation, lockout, role boundary, route coverage) is specified in §"Auth & session security requirements" — that section is the acceptance spec for CR027B.**
- `public.users` / `public.tenants`; `/auth/login`, `/auth/logout`, `/auth/me`; auth middleware resolves `user → tenant_schema` and seeds the ALS store.
- **Admin user management** (lives in the TopStrip tenant-switcher slot reserved by CR026): create/invite user → provision: `CREATE SCHEMA tenant_<id>` → apply template → seed COA (`seedAccounts.js`) + `seed-cr019-coa.js` + a default forecast scenario. (FX is already in `shared`.)
- Frontend: login page; `fetch(..., { credentials: 'include' })`; current-user display + logout; route guard.
- **Acceptance:** two real users see entirely separate data; logged-out requests are rejected; login is rate-limited.

### Phase 3 — Owner-data cutover (one-time, scripted, idempotent) → **CR027C**
- `ALTER TABLE exchange_rates SET SCHEMA shared;`
- `CREATE SCHEMA tenant_owner;` then `ALTER TABLE <each per-tenant table> SET SCHEMA tenant_owner;` recreate the two views in-schema.
- Register the owner in `public.users`/`tenants`. Data + intra-schema FKs preserved. Short downtime window (prod = this host).
- **Acceptance:** owner logs in, sees all existing data; backup/restore of `tenant_owner` round-trips.

### Phase 4 — Synthetic demo dataset → **CR027D**
- Seeded generator (deterministic RNG → reproducible) populating `tenant_demo`: ~4–5 accounts (checking/savings/card/brokerage, 1–2 currencies), ~18 months of categorized transactions (salary, rent, groceries, dining, utilities, inter-account transfers), one budget version + entries, one forecast scenario + a module or two. Drop-and-regenerate for a clean demo. **Fictional persona — no real financial data.**
- **Acceptance:** `tenant_demo` renders non-trivial balance sheet, cash flow, budget realization, and a forecast.

### Phase 5 — Help, onboarding & instructions on every section → **CR027D**
- Extend `HelpPanel` from a static global glossary into **per-route/per-section** content. Add a `help` field (or `helpSections[]`) to `routes.jsx` entries and/or an external help-content config; a `useHelp()` hook surfaces the current page's help.
- A reusable **`<FieldHelp>`** (info icon + popover) replacing scattered `title=` attributes; `aria-describedby` for accessibility.
- **Setup instructions** for each ongoing data source (Fintable connection walkthrough is the priority).
- **First-run onboarding wizard (per review).** Help text ≠ onboarding. A new `tenant_<id>` starts empty (COA template only) — dumping the user on a $0 dashboard causes "blank-slate bounce." On first login, land them in an opinionated checklist instead: **(1) Get your data in** (connect Fintable / upload Excel / add a manual transaction), **(2) categorize a few transactions**, **(3) view your Net Worth / first report**. Dismissible, progress-tracked (a `tenant.onboarding_state` or `app_data` key), resumable. This is the "demo → first real value" bridge the synthetic `tenant_demo` sets up. (Realizes the "flag-gated onboarding hook" CR026 reserved.)
- **De-personalized UX copy (per review).** Audit placeholder/example text (search bars, account-creation examples, empty states) for owner-specific Polish/US examples; replace with generic, currency-aware defaults ("Checking Account", "Groceries", "Salary") derived from the tenant's base currency rather than hard-coded.
- **Acceptance:** every page header has a "?" that opens contextual help; each data source has step-by-step setup; a brand-new tenant is guided through first-data-in → first-report without touching the empty dashboard cold; no owner-specific example strings remain in the UI.

### Phase 6 — Data-source IA cleanup + legacy retirement → **CR027E**
- Implement the **Ongoing vs Migrate** IA above; **remove the PS-API refresh** from the UI; build the **Excel/CSV importer**.
- Execute the legacy retirement list below.
- **Acceptance:** a fresh invited user can onboard end-to-end (connect Fintable *or* upload Excel *or* manual entry) with no PocketSmith/intermediary surfaces visible.

### Phase 7 — Later (out of this CR's critical path)
- **Per-tenant bank feeds (large, see callout below).** The current bank-feed/Fintable model is **single-owner** — true multi-user ongoing feeds need per-tenant bank connections + per-tenant feed health/reconnect UX. This is its own future CR, not a Phase-7 bullet.
- Per-tenant cron fan-out for the *fin-side* ingest (loop over tenants setting `search_path`); FX is shared and unaffected.
- TOTP 2FA. Per-tenant audit log. Email verification / public self-signup (if the SaaS opens up beyond invite).

> **⚠️ Critical scoping reality — ongoing feeds are single-owner today.**
> The bank-feed microservice reads **one** owner's Fintable Google Sheet; it has **no concept of per-user bank connections**. So within CR027's scope, the only *ongoing* data paths a new invited user actually has are **Excel/CSV upload and Manual entry** — the **Fintable feed is effectively owner-only** until a separate "per-tenant feed connection" CR builds: (a) each tenant authorizing their own bank/Fintable source, (b) routing feed data to the right `tenant_<id>` schema, and (c) friendly per-tenant **"reconnect needed" / feed-stale** states so users self-serve breakages (Design review #2) without emailing the admin. **Consequence for sequencing:** CR025 (manual entry) + the Excel importer are the real day-one onboarding paths; the new IA must not present "Bank Feed (Fintable)" as available to a tenant who has no way to connect one. Surface it as "coming soon / admin-managed" for non-owner tenants until that CR lands.

---

## Legacy retirement (final-release cleanup)

**Delete now:**
- `Scripts/backup-mongo.sh`, `Scripts/restore-mongo.sh` (Mongo fully gone).
- `frontend/src/pages/UIPreview.jsx` + `.css` + the `/ui-preview` route — remove the **in-app** mockup page from the shipped product. **Keep** `Documentation/CRs/CR026_UI_PREVIEW.html` — it is promoted to the **living style reference** (see §"Design / style reference"), not deleted.
- Dead Mongo mounts in `docker-compose*.yml`; `MONGO_URI` from `server/.env-cmdrc`.

**Secrets out of the repo (HARD release gate — see §"Release gates"):**
- Strip `PS_API_KEY`, `PS_USER_ID` from `server/.env-cmdrc`; `BANK_FEED_API_KEY` from `.env`; remove the `POSTGRES_PASSWORD:-findev123` default from `docker-compose.yml`. Add `.env.example` with placeholders + a CI secret-scan/grep gate. (`.env` is gitignored per CLAUDE.md, but `.env-cmdrc` and `docker-compose.yml` are tracked.)

**Retire with PS sunset (coordinate with CR023 exit gate):**
- `services/retrieval/pocketsmith.js`, `services/retrieval/psdataConverter.js`, `v2/services/refreshPsApiV2.js`, the **PS-API refresh** half of `v2/routes/ingestPs.js`, `psAPI/` OpenAPI folder, `BANK_FEED_DEDUP_ENABLED` flag.
- **Keep** the PS **CSV** importer path (one-time migration) and the **frozen `psdata_staging`** data (CR023 §5).

**Reorganize, don't delete (one-time migration tooling):**
- Move `ps-anchor.js`, `ps-exit-monitor.js`, `retire-handoff.js`, `copy-quicken-to-prod.js`, `quicken-import.js`, `quicken-promote.js`, `load-bank-statement.js`, `seed-*cutoffs*.js` into a `server/src/migrations-tools/` (or similar) folder so the release signals "use-once, then archive."

**De-personalize:**
- `rebuild-db.js` and seed scripts hard-code real institutions (Caixa, PKO, Fidelity, OCME, real property addresses) and real feed UUIDs. For a shipped product these must be replaced with the **template COA** / fictional names, or excluded from the release image. (The owner's real COA moves into `tenant_owner` data, not into seed code.)

---

## Risks & mitigations

1. **Migration fan-out is mandatory.** No runner exists today. Phase 0 is the critical path; the runner must be solid and wired into deploy. *Mitigate:* numbered, idempotent migrations + `schema_migrations` ledger + a `--dry-run`; **per-schema transaction wrapping with halt-on-first-failure + resumable re-run** (Phase 0).
2. **Connection-pool pressure & leaks on crash.** A dedicated client per request holds a connection for the request's life; >`max` concurrent requests block, and an error that escapes the handler can leak the client. *Mitigate:* raise pool size; **release on `res` `finish` AND `close`** (survives aborts/crashes) via one centralized wrapper with an idempotent release guard; load-test.
3. **`search_path` discipline = the security boundary.** A pooled client reused with a stale path leaks across tenants. *Mitigate (primary):* **always `SET search_path` on checkout before the first query**, centralized in the wrapper so no route can forget — this alone defeats stale-path leakage. *Defense-in-depth:* reset to a safe non-tenant default on release (plain `SET`, not routine `DISCARD ALL`).
4. **CORS + cookies.** `origin: true, credentials: true` is unsafe once auth cookies exist. *Mitigate:* pin origin in Phase 2 before login ships.
5. **Cutover correctness (Phase 3).** Moving live tables between schemas must preserve FKs/views. *Mitigate:* scripted + idempotent + tested on a dev clone first; take a `pg_dump` immediately before.
6. **De-personalization leaks.** Any real name/UUID/example string left in seed code, `.env-cmdrc`, or UI placeholder text ships to other users. *Mitigate:* the legacy audit + UX-copy audit (Phase 5); a grep gate in CI for known personal tokens (Caixa/PKO/Fidelity/OCME/feed UUIDs).
7. **Ongoing feeds are single-owner (scope honesty).** Per-tenant bank feeds don't exist yet (see Phase 7 callout). *Mitigate:* ship Excel-upload + manual entry as the real day-one onboarding paths; do not advertise Fintable as self-serve to non-owner tenants until the per-tenant-feed CR lands.

---

## Non-goals

- Public self-signup, email verification, social/OAuth login (admin-invite only this CR).
- TOTP/2FA, per-tenant audit log, per-tenant cron fan-out (Phase 7 / later CRs).
- `tenant_id`-column multitenancy or row-level security (explicitly rejected in favor of schema-per-tenant).
- De-personalized copy of real data as the demo (rejected in favor of synthetic).
- Re-architecting reports/forecast SQL (the whole point of schema-per-tenant is leaving them untouched).
- Lot/cost-basis (CR020), Cash Sweep Phase C (CR017) — unrelated.

## Dependencies & sequencing

- **After CR025** (manual entry) — it's the primary ongoing-entry path for feed-less new users and is referenced in the new IA.
- **Coordinates with CR023** — PS-API retirement (UI removal here; backend removal per CR023's exit gate + data-preserving runbook).
- **Builds on CR026** — sidebar/TopStrip, `HelpPanel`, `CommandPalette`, reserved tenant-switcher slot.
- **No new app-feature migration** in the usual sense, but a **structural schema reorg** (template/shared/control-plane split) and a **migration runner** — the largest single piece of work.
