# Multi-Tenancy Baseline

> **Pack role:** the isolation floor for any project that serves **many tenants (clinics,
> orgs, workspaces) from one database** — the pool model. The pack's default single-host
> guidance assumes one owner's data; this doc adds the guarantees that keep tenant A from
> ever seeing tenant B. Application-layer auth/CORS/CSP stay in `infra-bootstrap.md` and
> `security-baseline.md`; migration mechanics stay in `.claude/rules/migrations.md`. The
> always-on distillation is `.claude/rules/tenant-scoping.md`.
>
> **Applies when:** one DB holds multiple tenants' data. Single-tenant projects skip this doc.
> **Database-per-tenant** projects skip it too — isolation is the DB boundary and there is
> nothing to enforce. **Schema-per-tenant** projects read §0 and §10; §§1–8 are pool-model
> mechanics that do not apply to them.
>
> **Last reviewed:** 2026-08-02.

## 0. Choosing the model — pool vs schema-per-tenant

Decide this **before** the first tenant, and write the decision down: it is close to
irreversible, and every later argument about isolation is really an argument about this choice.

| | **Pool** — `tenant_id` + RLS (§§1–8) | **Schema-per-tenant** — `tenant_<id>` + `search_path` (§10) |
|---|---|---|
| Retrofitting an existing single-tenant app | **Expensive** — a column, a policy and a rewrite on every owned table and every query | **Cheap** — existing SQL runs unchanged; isolation moves to connection setup |
| Where a mistake leaks | A forgotten `WHERE` or a wrong policy → cross-tenant read | A wrong/stale `search_path` on a checked-out connection → the whole request hits the wrong tenant |
| Unique constraints | Must be rewritten to include `tenant_id` | Naturally per-schema, unchanged |
| Cross-tenant analytics | Trivial — one query with the bypass | Awkward — union across schemas |
| Migrations | One chain, applied once | One chain **fanned out** over N schemas, resumable mid-fan |
| Per-tenant restore / export / erase | A filtered dump; correctness depends on your enumeration being exhaustive | `pg_dump -n tenant_<id>` — the boundary does the work |
| Scale ceiling | Thousands of tenants fine | Hundreds are fine; thousands of schemas strain catalogs, connection setup and tooling |

**Choose pool** for a many-small-tenants SaaS built multi-tenant from day one, or when
cross-tenant reporting is a product feature. **Choose schema-per-tenant** when you are adding
tenancy to a mature single-tenant codebase, when tenant count is bounded and per-tenant
export/restore matters, or when "a forgotten `WHERE` clause must not be able to leak" is worth
more than easy cross-tenant queries.

What does **not** vary: the enforced check is the token claim, not the routing host; the
privileged bypass is a separate, audited surface; and isolation is proven by a test that tries
to cross the boundary and fails, not by reading the code.

## 1. The pool model & the two-layer guarantee

- **One database, one schema family; every tenant-owned table carries `tenant_id`** and an
  RLS policy. A shared pool is cheap and operationally simple — the cost is that **isolation
  is now a property you enforce, not a property of separate databases**.
- **Enforce at both layers, and mean it:**
  - **RLS** is the *guarantee* — a DB-level backstop that holds even when app code is wrong.
  - **App-layer scoping** is the *clarity* — explicit `WHERE tenant_id = …` and per-request
    context, so the code reads correctly and doesn't lean on RLS as the only fence.
  Cross-tenant PII leakage is a catastrophic, often-unrecoverable blast radius. Belt **and**
  braces is the correct amount of paranoia here.

## 2. The RLS policy shape

Every tenant-owned table:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
-- optionally FORCE, so even the table owner is subject to the policy (see §7):
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY <t>_isolation ON <t>
  USING ( tenant_id = current_setting('app.current_tenant')::uuid
          OR current_setting('app.platform_admin', true) = 'on' );
```

- `current_setting('app.platform_admin', true)` — the `true` = *missing_ok*, so an unset GUC
  returns NULL instead of erroring on a normal tenant request.
- The `OR platform_admin` branch is the **only** sanctioned cross-tenant path, and it is
  reachable **only** from the platform-admin surface (§5).

## 3. Request-time tenant context

- A per-request middleware opens a transaction and sets the tenant GUC on the pooled
  connection: `SET LOCAL app.current_tenant = $1`. `SET LOCAL` scopes it to the transaction,
  so it cannot bleed into the next checkout.
- **Reset on release.** A connection returned to the pool with a lingering GUC will scope the
  *next* request to the *wrong* tenant — a silent cross-tenant read. Use `SET LOCAL` inside a
  tx (auto-cleared on commit/rollback) and/or a `DISCARD`/reset on release; never a bare
  session `SET`.
- **No query on the shared pool outside a tenant context** — except the platform surface.
  A raw `pool.query()` in request code with no tenant GUC set runs with whatever the last
  checkout left behind. Treat that as a bug.

## 4. Tenant resolution vs. enforcement

- **Resolution (routing):** the subdomain (`<tenant>.example.com`) or a header picks which
  tenant a request is *for*. This is convenience, not security.
- **Enforcement (authority):** the **JWT / session tenant claim is the enforced check.** The
  host is routing; the token is authority. Never authorize off the subdomain alone — a
  mismatch between host and claim is a request to reject, not reconcile.

## 5. The platform-admin surface

Two distinct access modes, never one blurry "god query":

- **Tenant context (normal):** every request sets `app.current_tenant`; RLS scopes to it.
- **Platform context (rare, cross-tenant):** a **separate** admin surface (provisioning,
  fleet health, cross-tenant billing) that sets `app.platform_admin = 'on'`. **The tenant
  apps have no code path that can set this flag.**
- **Super-admin "logs into" a tenant by impersonation** — sets that tenant's id, **audit-
  logged** — and sees exactly what the tenant sees with RLS still on. Not by bypassing RLS.
- **Host-bind the admin surface.** The admin login + admin routes answer only on the admin
  host; off-surface (a tenant host, the apex, a bare IP) they return **404, not 401** — so
  the door isn't even confirmed to exist. Reserve the `admin`/`platform` slugs so no tenant
  can shadow them.

## 6. Schema conventions

- **`tenant_id` + RLS live in the same migration that creates the table** — never "add the
  policy later." (Enforce mechanically; see §8.)
- **Uniqueness is tenant-scoped:** `UNIQUE(tenant_id, email)`, not `UNIQUE(email)`. A global
  unique on tenant data is an existence oracle across tenants.
- **New per-tenant gating/config table ⇒ backfill every existing tenant** in the same
  migration, and seed it in the provisioning path for new tenants — or current tenants
  silently lose the capability the day the table lands.
- **Provisioning is one path** (`provision-tenant`): creates the tenant row + seeds its
  required per-tenant rows, idempotently.

## 7. Gotchas catalog (each from a real incident)

- **Expression/functional indexes are unusable under RLS (leakproofness).** Postgres won't
  use a functional index inside an RLS-filtered query unless the function is `LEAKPROOF`, so
  the index silently doesn't apply and the query seq-scans at scale. **Fix: index a
  generated/stored column** (e.g. a `phone_last9 GENERATED ALWAYS AS (…) STORED`) and index
  that plain column.
- **The table owner bypasses RLS by default.** RLS does not apply to a table's owner unless
  `FORCE ROW LEVEL SECURITY` is set. If migrations or the app connect as the owner, policies
  you *think* protect a table do nothing. Decide deliberately: app connects as a non-owner
  role, or `FORCE` the policy.
- **A leaked GUC on a pooled connection** scopes the next request to the wrong tenant (see
  §3). This is the classic pool-model cross-tenant bug — always `SET LOCAL` in a tx + reset.
- **A tenant table shipped without RLS is invisible-until-breach** — nothing fails in dev
  (one tenant), everything leaks in prod (many). Only a same-migration policy + a CI guard
  catches it.
- **Global `UNIQUE` / sequences / defaults** that ignore `tenant_id` leak or collide across
  tenants — audit every constraint for the scope column.

## 8. Testing & guards

- **Tier-2 RLS isolation test (must-have):** in a transaction set `app.current_tenant` to
  tenant A, insert a row; switch the GUC to tenant B; assert the read returns **zero rows**.
  One such test per sensitive table class proves the fence holds.
- **CI guard:** a `git grep`-style check that every `CREATE TABLE` in a migration touching a
  tenant-owned table is accompanied by `ENABLE ROW LEVEL SECURITY` + a policy — graduate this
  from review into `ci-guards.sh` (see `testing-and-ci.md`), because "reviewer remembers" is
  not a control.
- The `security-reviewer`, `migration-reviewer`, and CR agents (`.claude/agents/`) apply this
  doc on demand; the always-on distillation is `.claude/rules/tenant-scoping.md`.

## 9. Offboarding — the mirror of provisioning (design it before the first tenant leaves)

Provisioning is one path (§6); **deprovisioning is its mirror and deserves the same
discipline** — a departing clinic/org will ask for its data, and GDPR gives it the right to
both a copy and erasure. Bolting this on under a deadline is how cross-tenant mistakes happen.

- **Export (portability):** one scripted `export-tenant <id>` that walks **every tenant-owned
  table** (enumerate tables carrying `tenant_id` from `information_schema` — never a
  hand-maintained list) plus the tenant's uploads, into per-table CSV/JSON. This is the same
  "must stay exhaustive as the schema grows" shape as the merge/anonymize guard
  (infra-bootstrap §11) — pair it with the same schema-introspection CI test so a new tenant
  table can't silently fall out of the export.
- **Suspend ≠ delete.** Offboarding is staged: **suspend** (logins cut, data intact) →
  **export** handed over → **erase** after a stated cooling-off window. Suspension is
  reversible; erasure is not — never one button for both.
- **Erasure (right to be forgotten):** delete or anonymize across every referencing table —
  the FK-introspection guard proves coverage, exactly as for a record merge. Erasure runs
  from the **platform-admin surface only**, audit-logged like impersonation (§5).
- **Be honest about backups.** An erased tenant persists in every dump taken before the
  erasure until retention expires. The truthful promise is "gone from live now, gone from
  backups after N days" — state N (your backup retention) in the offboarding record; don't
  promise instant oblivion the backup tier can't deliver.
- **`tenant_id` in every structured log line** (the id, never tenant PII). Without it you
  cannot scope an incident — "which tenants did this touch?" is the first question in any
  breach assessment, and grep-ability then is decided by log shape now
  ([`observability-baseline.md`](observability-baseline.md) tier 0).

## 10. Schema-per-tenant — the other model's invariants

If §0 sent you here: each tenant gets a `tenant_<id>` Postgres schema, plus `shared` for
reference data every tenant reads (FX rates, catalogs) and `public` for the control plane
(tenant registry, users, sessions). Application SQL is **unchanged** — isolation comes from
`search_path = tenant_<id>, shared` on the connection. Nothing in §§1–8 applies: there is no
`tenant_id` column, no RLS policy, and asking for scoped uniqueness is asking for the rejected
design.

**The boundary is now connection setup, so the whole risk concentrates there.**

- **`SET search_path` on checkout, before the first query — always, centrally.** This one
  rule is the guarantee: a pooled connection carrying a previous request's path is
  unconditionally overwritten, so it can never serve the wrong tenant. Put it in the pool
  wrapper where no route can forget it. As defence in depth, reset to a safe non-tenant
  default on release. (Prefer a plain `SET` for the routine reset; `DISCARD ALL` also drops
  prepared statements and cursors — keep it for an error-path return-to-clean-state.)
- **Every path that hands out a raw connection must be request-aware.** The leak is not in the
  ORM/query helper everyone remembers — it is in `transaction()` / `getClient()` /
  `pool.connect()`, which return a *fresh* client with **no** path set and would silently run
  the transaction against `public` or a stale tenant. Enumerate those call sites explicitly
  when adopting the model; fixing them centrally means the call sites need no change.
- **Anything running outside a request must refuse to run unscoped.** Cron jobs, importers,
  seeders and one-off scripts each open their own pool: require an explicit `--tenant`
  argument and exit non-zero without it. An ambient script is how the right code corrupts the
  wrong schema.
- **Migrations fan out.** One chain, applied to every tenant schema plus `shared`/`public`,
  and the runner must be **resumable**: a failure on tenant 2 of 3 halts cleanly and re-runs
  from there. A migration that hardcodes a schema name is a bug. Provisioning a new tenant =
  create schema + replay the whole chain, so the chain must stay replayable forever.
- **Test the negative.** One test sets tenant A's path, queries, and asserts tenant B's rows
  are *not* returned; one asserts a transaction opened inside a request runs on the request's
  path, not `public` and not a stale one. Without the second, the leak above is invisible.
- **Dormant-safe adoption.** Retrofitting via [`dual-track-development.md`](dual-track-development.md):
  with tenancy flags off, `search_path = public` must give byte-for-byte the single-tenant
  behavior. That property is what lets the wrapper ship to production long before the first
  tenant exists — and it is a *security* property, so a change that alters the flags-off path
  is a finding, not a refactor.
