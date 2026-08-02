---
paths:
  - "**/migrations/**"
  - "**/alembic/**"
  - "**/prisma/migrations/**"
  - "**/models/**"
  - "**/db/**"
  - "**/*.sql"
---
# Tenant-scoping rules (multi-tenant projects only)

> Applies only if this project isolates data per tenant/account. Full reasoning +
> the gotchas catalog: `multi-tenancy-baseline.md`. If the project is single-tenant, ignore.
>
> **Which half applies depends on the model the project chose** (baseline §0). The rules below
> are for the **pool model** (`tenant_id` + RLS). If the project is **schema-per-tenant**,
> ignore them entirely — there is no scope column and no policy — and apply these instead:
> **`SET search_path` on every connection checkout before the first query**, centrally, and
> reset on release · every path that hands out a raw client (`transaction()`, `getClient()`,
> `pool.connect()`) is request-aware, or it runs on `public`/a stale tenant · scripts and cron
> jobs take an explicit `--tenant` and **refuse to run unscoped** · migrations fan out over all
> schemas, resumably, and never hardcode one · with tenancy flags off, behavior is
> byte-for-byte single-tenant. (Baseline §10.)

- **Every tenant-owned table carries the scope column `NOT NULL` + RLS, in the SAME
  migration that creates it.** A table shipped without its policy is invisible-until-breach.
  Policy shape: `USING (tenant_id = current_setting('app.current_tenant')::uuid OR
  current_setting('app.platform_admin', true) = 'on')`.
- **Uniqueness is scoped, not global.** `UNIQUE(tenant_id, email)`, never `UNIQUE(email)` —
  a global unique on owned data leaks existence across tenants.
- **Every query runs inside tenant context** — the per-request transaction that
  `SET LOCAL app.current_tenant = $1` on the pooled connection, reset on release. No query
  on the shared pool outside that context, except the explicit platform-admin surface.
- **`app.platform_admin = 'on'` is set ONLY by the platform-admin surface.** No tenant-app
  code path may set it. Cross-tenant admin work is audit-logged **impersonation**, not an
  RLS bypass.
- **The enforced check is the token/session tenant claim, not the routing host.** Subdomain
  = routing; the JWT/session claim = authority.
- **Index gotcha:** functional/expression indexes can be unusable under RLS (leakproofness) —
  index a **generated/stored column** instead.
- **New gating/config table ⇒ backfill existing tenants** (and seed it in provisioning), or
  current tenants silently lose access.
