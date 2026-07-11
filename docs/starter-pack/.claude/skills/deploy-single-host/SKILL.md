---
name: deploy-single-host
description: Deploy this app to production on the single-host dev/prod Docker Compose setup. Use when asked to deploy, release, ship to prod, or run the production deploy — for the standard (non-shared-edge) single-host or dedicated-VM layout. Not for first-time public exposure (use deploy-to-public) or co-hosting on a shared edge (use deploy-shared-edge).
---

# Deploy to production (single host / dedicated VM)

Full reasoning: `infra-bootstrap.md` §2 (and §2.5 for remote pull-based) — find it in the
repo (`docs/guides/` or the starter pack). This is the condensed operational sequence.

## Gates — refuse to deploy unless ALL are true

1. Working tree **clean at `origin/main`** (single host builds from the working tree) —
   or, for a remote pull-based deploy, **no unpushed commits** (the box builds from *its*
   `origin/main`; unpushed work silently doesn't ship).
2. **Tests green** (suite + `scripts/ci-guards.sh`, or the latest commit's CI status).
3. Any migration in this release has already been **applied to dev** (and staging if it
   exists) and is recorded in the cross-env matrix.
4. No other session's in-flight work rides along: `git fetch`, check `git log -1
   origin/main`, confirm with the user if HEAD moved unexpectedly.

## Sequence

1. Preflight: `docker-compose.prod.yml`, `backend/.env`, certs (nginx layouts) exist.
2. **Backup prod DB first** (`pg_dump -Fc` → `Backups/`), unless `--no-backup` first deploy.
3. Resolve `APP_VERSION` from **`version.json`**; copy it into the frontend build context
   (gitignored build inputs do NOT travel via git pull — sync out-of-band on remote deploys).
4. Build (frontend `--no-cache`) → `up -d` with the **explicit `-f`** prod file and the
   prod `COMPOSE_PROJECT_NAME` exported.
5. Wait for DB (`pg_isready` loop).
6. **Migrate via `exec` inside the backend container**, then **assert the new migration is
   recorded in the `schema_migrations` ledger** — no other mechanism applies migrations.
   Run idempotent seeds after.
7. Wait for backend health; then curl the **public URL's** `/health` from outside.
8. **Smoke tests** (login + one data round-trip). Red smoke ⇒ go to Rollback, don't debug
   in prod.
9. Print success banner with the live version; remind about `docker-cleanup.sh` (never
   auto-prune — it can delete the rollback image).

## Rollback

- App: `git checkout <prev-tag>` → re-run the deploy script.
- DB: restore the pre-deploy dump (`pg_restore --clean` into the prod DB).
- Remote/SSH deploys: `printf '%q '` every arg crossing the SSH boundary.

## Known traps in play (verbatim from the catalog)

- A deploy that "succeeds" but every authed call 401s = a `VITE_*` token/build-arg didn't
  thread through Dockerfile `ARG`+`ENV` **and** compose `build.args` — rebuild the
  frontend, grep the bundle to confirm.
- Stale UI after a correct deploy = the **service worker**, not the build; client-side
  recovery (clear site data) + content-hashed bundles proactively.
- First SSH over a cold Tailscale path can time out — retry; don't roll back on this alone.
