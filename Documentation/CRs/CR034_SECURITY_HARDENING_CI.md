# CR034 — Security Hardening & CI Baseline

**Status: COMPLETED — Released v3.0.34 (2026-06-12), deployed to prod. Open follow-ups in §6.** — [Plan link](../FC_NEXT_STEPS.md#cr034)

## 1. Why

A full project review (2026-06-12) found live secrets tracked in git and a set of cheap, high-value hardening gaps:

- `.env`, `frontend/.env`, `server/.env-cmdrc`, `frontend/.env-cmdrc` were **git-tracked** with real values across history: `BANK_FEED_API_KEY`, the PocketSmith API key + user id, and the `findev123` Postgres password (also the compose default and a hardcoded fallback in 15+ admin scripts and 2 test files).
- The backup endpoint built a `pg_dump` **shell string** with the DB password interpolated (`util.js`) — not remotely exploitable (env-derived input) but fragile and an injection surface the moment the URL is ever per-tenant.
- `cors({ origin: true, credentials: true })` — any origin.
- Postgres published on `0.0.0.0` (LAN-reachable with a guessable password).
- No CI of any kind; 226 backend tests existed but nothing ran them.
- The migration chain could not initialize an **empty** database (022 aborted without a data-bearing COA) — fresh installs and CI were both broken.

## 2. What shipped

### Secrets (the core)

- `git rm --cached` on all four env files (they were already gitignored — ignored-but-tracked since before the rules). Templates added: `.env.example` (rewritten), `server/.env-cmdrc.example`, `frontend/.env-cmdrc.example`.
- **Postgres password rotated** on dev + prod: `ALTER USER fin`, `.env`/`.env-cmdrc` updated, stacks recreated, health + data verified (36,332 transactions intact), full suite 226/226 against the rotated dev DB.
- All `findev123` defaults removed: compose files now use `${POSTGRES_PASSWORD:?…}` (fail-fast, no default); 15 admin scripts' URL fallbacks replaced with a fail-loud guard; 2 test files now read `DATABASE_URL` from the environment; `GUIDE_RESTORE.md` updated; `deploy-on-vm.sh` echo fixed.
- Dead `PS_API_KEY`/`PS_USER_ID` env removed everywhere (CR030 follow-up — zero code references).

### Hardening

- `util.js` backup: `exec` → **`execFile`** with an args array and `PGPASSWORD` via env (no shell; handles percent-encoded passwords).
- CORS pinned to an allowlist (dev/prod/Tailscale origins; `CORS_ORIGINS` env override; no-Origin requests pass) — `server/src/app.js`.
- Postgres published ports bound to **`127.0.0.1` + the Tailscale IP** (never the LAN) in all three compose files. Note: the Tailscale-IP bind requires tailscaled up when the container starts; `restart: unless-stopped` retries until it is.
- Prod compose volume pinned to `name: fin_postgres_data` — the prod stack previously straddled two compose project names (`fin` for postgres, `psproject` for server/frontend); it is now unified under `psproject` (the deploy script's `COMPOSE_PROJECT_NAME`) while keeping the original data volume.

### Fresh-install / CI correctness

- **Migration 022 fix:** on an *empty* `accounts` table it now creates the `Transfers` root instead of aborting (the abort is preserved for data-bearing DBs, where a missing root means corruption). The full 001–032 chain now applies cleanly to an empty database — fresh-volume initdb works again.
- **`server/db/ci-seed.sql`** (not a migration): seeds the COA rows engines reference by hardcoded id/name (`accounts.id=88` Unrealized G/L; `Transfer - Securities Trades`; `Financial Income - Dividend`; `Option Trade`). Validated: 226/226 on a scratch migrations+seed database.
- **`.github/workflows/ci.yml`** — three jobs on push/PR to `main`:
  1. `backend-tests`: postgres:16 service → migrations → ci-seed → `npx jest --ci`.
  2. `frontend-build`: `npm ci` → lint (**advisory** until the 160-error debt clears) → `vite build` (hard gate).
  3. `secret-scan`: blocks the leaked key prefixes anywhere, `findev123` outside `Documentation/`, and any tracked `.env`/`.env-cmdrc`.

### Docs restructure (single-source rule)

- New **[MIGRATIONS.md](../MIGRATIONS.md)** registry (the structure doc's single 3,300-char migrations cell had already drifted — it omitted 017/020).
- `FC_PROJECT_STRUCTURE.md` (889 → ~290 lines) and `FC_NEXT_STEPS.md` (365 → ~190) slimmed to snapshot/plan roles; CR files are the sole spec location; `CR_INDEX.md` rows reduced to true one-liners. Originals preserved verbatim at `Archive/FC_PROJECT_STRUCTURE_FULL_2026-06-12.md` / `Archive/FC_NEXT_STEPS_FULL_2026-06-12.md`.

## 3. Verification

- Dev + prod: `GET /api/v2/health` OK after rotation; prod transaction count + max date intact; `docker port` confirms localhost+Tailscale-only binds.
- `npx jest`: 226/226 against rotated dev DB **and** against a scratch fresh-DB (the CI recipe, validated locally end-to-end).
- `vite build` green; secret-scan gate logic dry-run exit 0; `node --check` on every edited script.

## 4. Threat-model note

Single-user LAN+Tailscale app: the unauthenticated destructive endpoints (`/clearall`, deletes, backup download) remain acceptable for v3 and are CR027B scope (auth, helmet, rate limiting, audit logging). This CR deliberately did not duplicate that work — it closed what was cheap now and what CR027's release gates already demanded (secrets, CORS, CI secret-scan).

## 5. Files touched (main)

`.gitignore`-effective untracking of 4 env files · `.env.example` + 2 new `.env-cmdrc.example` · `docker-compose{,.dev,.v4}.yml` · `server/src/app.js` · `server/src/v2/routes/util.js` · 15 scripts under `server/src/{scripts,v2/scripts}/` · 2 test files · `server/db/migrations/022_quicken_import.sql` · `server/db/ci-seed.sql` (new) · `.github/workflows/ci.yml` (new) · `Scripts/deploy-on-vm.sh` · `Documentation/{MIGRATIONS.md,FC_PROJECT_STRUCTURE.md,FC_NEXT_STEPS.md,CRs/CR_INDEX.md,Guides/GUIDE_RESTORE.md,Archive/*_FULL_2026-06-12.md}`.

## 6. Open follow-ups

1. **Rotate `BANK_FEED_API_KEY`** — the old value is in git history. Requires updating the bank-feed service `.env` **and the OCME consumer** (shared key) — coordinate, don't break OCME.
2. **Revoke the leaked PocketSmith API key** at pocketsmith.com (integration retired; the key may still be live upstream).
3. Optional: `git filter-repo` history scrub once both keys are rotated (private repo, so rotation is the real fix).
4. Flip CI lint to blocking when the 160-error frontend lint debt is cleared (tracked in FC_NEXT_STEPS §2).
5. CR027B still owns: auth, helmet, rate limiting, body-size tightening, audit logging, validation layer.
