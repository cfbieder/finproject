# Infra Bootstrap Prompt — Dev/Prod Docker + Ops Scripts

> **Pack role:** the foundational single-host architecture (dev + prod stacks side-by-side
> via Docker Compose) plus the ops scripts that tie it together. Paste into a new project
> and ask Claude to implement it. Going public later? → [`deploy-to-public.md`](deploy-to-public.md).
> Concrete script sources + Dockerfiles to crib from → [`script-library.md`](script-library.md).
> Test/CI gates that guard this architecture → [`testing-and-ci.md`](testing-and-ci.md);
> secrets & patching policy → [`security-baseline.md`](security-baseline.md); monitoring →
> [`observability-baseline.md`](observability-baseline.md). Docs/`CLAUDE.md` conventions this
> assumes → [`documentation-standard.md`](documentation-standard.md) and
> [`claude-collaboration.md`](claude-collaboration.md).
>
> **Last reviewed:** 2026-07-06.

## Contents

- **⚠️ Top traps** — the five silent prod-killers (index)
- **§0** Context to fill in first (placeholders + the future-split design decision)
- **§0.5** Pick your topology (async tier? Tailscale-only?)
- **§1** Two Docker Compose stacks (+ stack registry, staging tier) · **§1.5** Dormant feature-flag track
- **§2** `deploy-to-production.sh` · **§2.5** Remote pull-based deploy after the host split
- **§3** `update_version.sh` (one `version.json`)
- **§4** `sync-db-prod-to-dev.sh` (+ mandatory PII scrub)
- **§5** Migrations & seed data (the hard rule; expand→migrate→contract; cross-env matrix)
- **§6** Supporting scripts (setup, tmux dev session, backups, cleanup, certs; three-layer jobs)
- **§7** Single-host traps #1–16 · post-split traps #17–21
- **§8** Conventions to carry over
- **§9** Working rules — starter `CLAUDE.md` (URLs, concurrency protocol, cross-repo contracts)
- **§10** Documentation system (pointer to the canonical standard)
- **§11** Other best practices to carry over
- **§12** What to ask me before building


> Paste this into a new project and ask Claude to implement it. It describes a
> proven single-host architecture for running a **development** and a
> **production** stack of the same app side-by-side via Docker Compose, plus the
> operational scripts (deploy, version bump, prod→dev data copy, backups,
> migrations, certs) that tie it together.
>
> It is deliberately stack-agnostic where it can be. Fill in the
> **`<<PLACEHOLDERS>>`** for your project before starting, and challenge any
> choice that doesn't fit — don't copy decisions that don't apply.

---

## ⚠️ Top traps — read these even if you read nothing else

The five below are **silent** and can take prod down. Full detail in the linked
sections; this is an index, not a substitute.

1. **`initdb.d` is NOT a migration runner.** It runs only on an empty volume; on
   a live DB it's a no-op, so migrations added after the volume was created
   silently never apply and code hits "column does not exist." → §5, §7 #11
2. **Compose project name comes from the directory by default.** A
   symlink/clone/rename changes it, and a wrong name targets a different (or no)
   set of containers — a `docker compose down` run from the wrong path can
   orphan/remove the prod stack. Pin `COMPOSE_PROJECT_NAME`. → §1, §7 #12
3. **`${VAR:-weakdefault}` in a prod compose silently ships the weak default**
   when the var is unset. Use fail-loud `${VAR:?msg}` for secrets. → §8
4. **Ops scripts that `cat > .env` wipe manually-added vars.** Edit in place. → §3, §8
5. **Deploy builds from the working tree, not git.** Uncommitted WIP gets baked
   into the prod image. → §2, §7 #10

---

## 0. Context to fill in first

| Placeholder | Meaning | Example |
|---|---|---|
| `<<APP>>` | short app slug, used in container names | `myapp` |
| `<<BACKEND>>` | backend runtime + framework | Node/Express, Python/FastAPI, Go |
| `<<FRONTEND>>` | frontend framework + build tool | React/Vite, SvelteKit, none |
| `<<DB>>` | database image | `postgres:16-alpine` |
| `<<BROKER>>` | message broker (only if async work) | `redis:7-alpine`, none |
| `<<WEB>>` | reverse proxy / TLS terminator | Caddy, nginx, none |
| `<<HOST>>` | the single host that runs both stacks | hostname / Tailscale name |
| `<<PROD_URL>>` | public HTTPS URL of prod | `https://app.example.ts.net` |
| `<<TS_IP>>` | host LAN/Tailscale IP for plain-HTTP dev access | `100.x.y.z` |

**Design decision:** dev and prod run on the **same physical host for now**, but
a **future split to a separate prod host is expected**. Build the single-host
setup (simple, cheap), but keep the split seam clean so the move is a config
change, not a rewrite:

- Never hardcode `localhost`/`127.0.0.1` for cross-service reach — use the
  compose **service name** (`postgres`, `backend`) inside Docker and a single
  configurable host var everywhere else.
- Put every host/URL/port/credential in `.env`, never inline in scripts.
- Make scripts target containers/DBs **by name via variables** at the top of the
  file (they already are below) so pointing them at a remote host = editing those
  vars (or adding an SSH prefix), not rewriting the logic.
- The migration indirection (§5) and the prod-DB-not-published rule (§7 trap #1)
  are *single-host* workarounds — leave a comment marking them as such so a
  future-you knows they can be simplified after the split.

---

## 0.5 Pick your topology first (two questions that drive everything below)

Several prescriptions in this doc branch on two facts about your app. Answer
these before you start; they decide which variant of §1, §3, §5, and §6 you
implement.

**Q1 — Does the app have async/background work** (LLM calls, image processing,
email, report generation, scheduled jobs)? The trigger for a broker is NOT "is
there async" — it's **"must the job survive a restart, be retried, or scale
across workers."** Three outcomes:
- **No async** → 3-tier model (db → backend → web). Dev can run "DB-only" (§1).
- **Async, but fire-and-forget** — single instance, loss-on-restart acceptable,
  no retry needed → keep the 3-tier model and run the job **in-process**,
  exposing a **status-poll endpoint** the client polls for completion. No broker,
  no worker. This is the right, proportionate choice for single-user / homelab
  apps (a long-running LLM review is a fine fit). Cost to accept consciously: an
  in-process job **dies on container restart or mid-deploy and is not retried**.
- **Async that must be durable, retryable, or multi-worker** → add a 4th tier: a
  **broker + worker** (§1, §6). Dev must containerize the backend + worker +
  broker for parity (§1).

**Q2 — Is the host Tailscale-only** (no public domain)?
- **Yes** → **Caddy + Tailscale auto-TLS** (§1/§6), and publishing the DB on a
  distinct host port is acceptable (§5/§7).
- **No** (public domain) → nginx + Let's Encrypt / `setup-certs.sh`, and keep
  the prod DB port unpublished (§5/§7).

---

## 1. Two Docker Compose stacks

Create two compose files at the repo root.

> **Pin the compose project name.** Compose derives the project name from the
> directory basename by default, so a symlink, clone, or rename silently changes
> which container namespace your commands hit (see §7 #12 — this can remove a
> running prod stack). Set `COMPOSE_PROJECT_NAME=<<APP>>` in `.env` (or a
> top-level `name: <<APP>>` in each compose file) so the namespace is fixed
> regardless of the path you run from.

> **Naming — name prod `docker-compose.prod.yml`, not the default
> `docker-compose.yml`.** Giving prod the default filename means a bare
> `docker compose up/down/exec/logs` in the repo root silently targets
> **production** — `docker compose down`, typed expecting to stop dev, takes prod
> offline. Naming *both* files explicitly forces every command to name its env
> (`-f docker-compose.prod.yml` / `-f docker-compose.dev.yml`), so there is no
> dangerous default. If you inherit a default-file-is-prod layout, see §7 trap
> #8 for mitigations.

### `docker-compose.dev.yml` — topology depends on §0.5 Q1

**If there is NO async tier (3-tier app):** run **only the database** in Docker
(`<<APP>>-db-dev`); the backend and frontend run as **host processes**
(`npm run dev` / hot-reload) for fast iteration.

**If there IS a durable async tier:** run everything with prod-parity behavior in
Docker — `postgres-dev`, `<<BROKER>>-dev`, `backend-dev`, **and** `worker-dev` —
and run **only the frontend (Vite/host dev server) on the host**. Running the
backend on the host while prod runs it in a container creates a parity gap
exactly where async bugs hide (broker URLs, job serialization, worker env), so
containerize the backend+worker+broker and keep just the presentation layer on
the host where hot-reload actually matters. (An *in-process* fire-and-forget
async app — the middle Q1 outcome — has no broker/worker and stays on the 3-tier
dev topology above.)

> **Carve-out for a Node.js backend:** even when you'd otherwise containerize the
> backend, run it on the **host under `nodemon` / `tsx watch`** for sub-second
> reload and trivial debugger attach — Node's runtime doesn't differ
> meaningfully between host and container, so the parity risk is low. (You *can*
> get the same live-reload inside a container via a bind-mount + nodemon; prefer
> that only when native deps build cleanly only in the image.)

Common to both variants:
- **Publish the DB port to the host** (`5434:5432`) so host dev processes can
  reach it. Use a **distinct port from prod** (see §5).
- Mounts migrations into `/docker-entrypoint-initdb.d` to **bootstrap a fresh
  (empty) volume only**. This is NOT your migration runner — on any existing
  volume it is a silent no-op (§5, §7 #11). It just saves you hand-loading the
  schema into a brand-new dev clone.
- Weak, hardcoded dev password is fine (it's local only) — but make it
  *obviously* a dev password.
- Named volume `<<APP>>_dev_data`. Separate network from prod.

> **Keep a stack registry.** On a single host you accumulate stacks (dev, prod, a
> prototype, a sibling service). Maintain a one-row-per-stack table — `stack → DB
> port · API port · volume · project name` — in the README, and treat **"every
> stack gets a distinct published DB port"** as a hard rule the moment a **3rd**
> stack appears. Reused ports collide (two stacks can't both publish `5435`) and
> an unregistered port becomes tribal knowledge.

> **Give the 3rd stack a job: rehearse the cutover.** When the registry grows a
> 3rd stack, prefer making it a **staging/UAT tier cloned from the prod pattern**
> (distinct DB + published port, same compose shape) whose explicit purpose is to
> **dry-run the deploy and the migration cutover, and exercise flag-ON (vNext)
> code (§1.5), before prod.** A staging tier that mirrors prod's topology is what
> makes expand→migrate→contract (§5) and a flag flip safe to attempt for real —
> you've already run them once. Don't let it become "a random prototype"; its
> value is being a faithful prod rehearsal.

### `docker-compose.prod.yml` — full stack

Core services:
- `postgres` → container `<<APP>>-db`, DB `<<APP>>_prod`, password from
  `${DB_PASSWORD}` env (NOT hardcoded, and **NOT** `:-weakdefault` — §8). Publish
  on a **distinct host port** (`5433:5432`) on a Tailscale-only host, OR keep it
  unpublished on an exposed host (see §5 / §7 trap #1 for the trade-off).
- `backend` → container `<<APP>>-api`, `build: ./backend`,
  `env_file: ./backend/.env`, `APP_ENV=production`, `DB_HOST=postgres` (compose
  service name, not localhost). Mount `uploads/`, `logs/`, and any media dirs as
  bind/named volumes so user data survives image rebuilds.
- `<<WEB>>` → container `<<APP>>-web`, builds the frontend with a
  `VITE_APP_MODE`-style **mode flag** build arg (see §7 trap #7 — do *not* pass a
  URL that can be empty), serves it, terminates TLS, publishes `443:443` and
  `80:80`.

**Optional 4th tier — add only if §0.5 Q1 is "durable async":**
- `<<BROKER>>` → e.g. `redis:7-alpine`, container `<<APP>>-broker`, with a ping
  healthcheck.
- `worker` → container `<<APP>>-worker`. **Reuse the backend image** (`build:
  ./backend`) and differ only by `command:` (e.g.
  `python -m arq app.worker.tasks.WorkerSettings`) and its **healthcheck** (a
  broker ping). It must share the backend's **env and secrets** and the same
  `depends_on: {postgres, <<BROKER>>: service_healthy}`. Reusing the image is the
  key rule — a separate worker Dockerfile drifts from the API code.

**TLS — pick per §0.5 Q2:**
- **Caddy (default, Tailscale-only host):** image `caddy:2-alpine`, mount the
  Tailscale socket (`- /var/run/tailscale:/var/run/tailscale`) and a `Caddyfile`.
  TLS is **fully automatic via MagicDNS** — no `certs/` dir, no `setup-certs.sh`,
  no reissue cron. Caddy obtains and renews the cert itself.
- **nginx (fallback, public domain / Let's Encrypt / nginx-specific needs):**
  mount `nginx.conf` and `certs/` read-only; provision certs via
  `setup-certs.sh` (§6) and reissue on expiry.

Every service: `restart: unless-stopped`, a **healthcheck**, and
`depends_on: { condition: service_healthy }` chaining
`postgres (+ <<BROKER>>) → backend (+ worker) → <<WEB>>`.
Named volume `<<APP>>_prod_data`. Its own bridge network.

**Version injection pattern:** see §3 — a single `version.json` is copied into
the frontend build context and mounted read-only into the backend. A bare
`docker compose build` then bakes the real version.

---

## 1.5 Shipping unfinished work to prod: the dormant feature-flag track

> Use this instead of a long-lived feature branch when you must keep one
> always-shippable `main` but are building a larger vNext effort in parallel.
> Diverge the *runtime*, not the *code*.

The in-progress vNext code sits on `main` and deploys to prod **dormant**, gated
by feature flags. Four rules make this prod-safe; violating any one ships vNext
hot:

1. **Flags default OFF *and* are committed OFF.** Read them as
   `process.env.X === "true"` so absence = OFF. Never commit an ON value.
2. **Flag-ON values live ONLY in a gitignored env file** (`.env.vnext`) — never
   in `.env.prod`, the default `.env`, or `docker-compose.prod.yml`.
3. **Every flag's OFF path must be a byte-identical no-op** vs today. This is the
   invariant — and the only thing — that makes vNext code safe to sit on `main`
   and deploy to prod. If OFF isn't a true no-op, it isn't dormant.
4. **Only commit a vNext increment once it's dormant-safe.** Anything not yet a
   clean no-op stays on a short throwaway branch/worktree until it is.

**Go-live = flip the flags in prod config + a one-time cutover migration**, not a
big-bang merge. Shared design *foundations* (a new util, design tokens, a schema
seam) can land **un-flagged** as long as they're inert until the flagged code
calls them — flag only the behavior change, not its prerequisites. Maintain a
single source of truth for *which CR/feature maps to which track and flag* so a
shared file's two consumers don't collide.

---

## 2. `scripts/deploy-to-production.sh`

One command, idempotent, fail-fast (`set -e`), colorized output. Steps:

1. **Preflight checks** — abort with a clear message if any are missing:
   `docker-compose.prod.yml`, `backend/.env`, TLS certs (if using nginx).
2. `--with-git` flag → optional `git pull` before building.
3. **Backup the prod DB first** (unless `--no-backup`): `pg_dump -Fc` into
   `Backups/<<APP>>_backup_<timestamp>.dump`. Skip gracefully if no prod DB
   container is running (first deploy).
4. Resolve `APP_VERSION` (from `version.json`) and `DB_PASSWORD` (from
   `backend/.env`) and export them for compose. Copy `version.json` into the
   frontend build context.
5. `docker compose -f docker-compose.prod.yml build --no-cache <frontend>` then
   `up -d`. (Frontend is built `--no-cache` to avoid stale bundle layers; the
   backend may use cache.)
6. **Wait for DB ready** (`pg_isready` loop, ~30 tries).
7. **Run migrations + seeds** against prod, *inside the container* (see §5):
   `docker compose exec -T backend <migrate-tool> upgrade head`, then run the
   idempotent seed scripts. **This step is mandatory and must be verified** —
   nothing else applies migrations (`initdb.d` does not; §5). After it, assert the
   expected migration is recorded in the `schema_migrations` ledger before
   declaring the deploy healthy.
8. **Wait for backend healthy** (curl the in-container `/health`).
9. **Verify**: assert all containers running + report health status, then curl
   `<<PROD_URL>>/health` from outside.
10. Print a clear success/failure banner with log commands on failure.

> **Concurrency / safety rule:** the build uses the **working tree**, so only
> deploy a **clean tree at `origin/main`**. Re-check `git status` in the same
> step that launches the build — uncommitted WIP (yours or anyone's) gets baked
> into the prod image otherwise.

> **Disk note:** `--no-cache` builds generate dangling images + build cache on
> every deploy. Do **not** auto-prune here (it can delete the image you'd roll
> back to) — run `docker-cleanup.sh` separately (§6, §11).

### 2.5 After the split: deploying to a REMOTE prod host (pull-based over SSH)

Once prod moves off the dev host (§0's expected split), the deploy stops being a
local build and becomes **SSH in → `git pull origin/<main>` on the box → build →
`up -d` there**. Two invariants from §2 **invert or change** — encode the new
shape:

- **"Clean working tree" becomes "pushed to `origin/<main>`."** The box builds
  from *its* git checkout, not your working tree (§7 #10 was the single-host
  rule). So the failure mode flips: **uncommitted WIP no longer leaks into the
  image, but unpushed commits silently don't ship.** The deploy script must
  **warn on unpushed commits** before it SSHes.
- **A `git pull` does NOT carry gitignored files.** Anything prod needs that
  lives only in a gitignored file (the `APP_VERSION`/version string, secrets in
  `.env`) will **not** travel with the code. The deploy must **sync those
  out-of-band** (e.g. read `APP_VERSION` locally, `sed` it into the box's `.env`
  after the pull, before the build). Otherwise prod ships new code with the old
  version/secret. (§7 #19.)
- **SSH flattens argv into one re-parsed string.** Passing args to the remote
  (a version like `"0.27.0 (30.6.2026)"` with spaces/parens) loses local quoting
  across the boundary — `printf '%q '` each arg. (§7 #21.)
- **Don't duplicate a shared edge.** If the target is a shared box with ONE
  reverse-proxy + tunnel serving several apps (`/opt/edge`), the app deploy
  touches only the app stack; each app *adds a site block + a tunnel hostname*
  pointing at its own web container — it does not stand up its own proxy. This is
  where §7 #18's service-name collisions bite.

Everything else from §2 still holds (backup-before-deploy, verified migrate step,
health-check the public URL). Mark these as *post-split* concerns so a later
consolidation knows why they exist.

---

## 3. `scripts/update_version.sh`

Single source of truth for the app version string, format `"X.Y.Z (D.M.YYYY)"`,
stored in **one root `version.json`**.

- Modes: `"<exact string>"`, `--auto` (refresh date, keep number),
  `--bump-patch|--bump-minor|--bump-major`, `--show`, `--help`.
- Writes the version to **`version.json` only**, then **copies it into the
  frontend build context** (`cp version.json frontend/version.json`, which the
  Dockerfile `COPY`s) and the backend mounts it read-only
  (`./version.json:/app/version.json:ro`).
- **Why one JSON file, not synced env vars:** a value that must be *kept in sync*
  across `root/.env` + `frontend/.env` eventually drifts. One file that's
  *copied* (not re-typed) into each consumer removes the sync problem and is
  language-neutral (JSON parses everywhere; `.env` semantics differ between Vite,
  compose, and shell). The moment a second consumer appears (backend `/health`,
  an API banner), the single file clearly wins. The failure mode isn't only
  drift: syncing a version into multiple `.env` files invites a script that
  *regenerates the whole file* (`cat > .env`), which silently wipes unrelated
  manually-added vars — a real outage when a version bump erased a service's API
  URL (§8).
- Creates an annotated git tag `vX.Y.Z` at current HEAD; skips if it exists.
- Reminds the user to rebuild the frontend / redeploy for the change to land.
- **Display standard:** the full version string — number *and* date — is rendered in the
  UI of **both** dev and prod (header/footer). Both read the same copied `version.json`
  (import it directly; a build-arg-only wiring lets dev silently show a fallback). Dev is
  additionally visually differentiated per §7 trap #14 — distinct banner color, `[DEV]`
  tab title, favicon. Implementation snippets: [`script-library.md`](script-library.md) §9.
- **Bump policy (`/close` applies this automatically):** any code change shipping →
  `--bump-patch` for fixes/internal, `--bump-minor` for new user-facing capability;
  docs-only changes don't bump.

> Gotcha: this tags at *current* HEAD. If you bump before committing the release
> commit, `git tag -f vX.Y.Z <release-sha>` to move the tag.

---

## 4. `scripts/sync-db-prod-to-dev.sh` — copy prod data into dev

Lets you debug against real data. Steps:

1. Assert prod DB container running; start the dev DB stack if needed and wait
   for it.
2. Print **row counts** for key tables in prod (sanity check before you clobber
   dev).
3. **Confirm destructively** — `read -p` "this REPLACES dev data, continue?".
4. `pg_dump -Fc` prod → temp file → `pg_restore --clean --if-exists --no-owner`
   into dev.
5. Print dev row counts after restore (verify it worked).
6. **Run the PII scrub — MANDATORY when prod holds any personal data** (GDPR; for
   clinic/client projects this is non-negotiable): apply
   `scripts/scrub-dev-data.sql`, which pseudonymizes names/emails/phones/addresses/
   free-text notes in place while preserving row counts, FK integrity, and value
   shapes. Keep the scrub exhaustive as the schema grows via a schema-introspection
   CI guard (§11, [`testing-and-ci.md`](testing-and-ci.md)); full spec + SQL skeleton in
   [`script-library.md`](script-library.md) §7. A project may opt out only by recording
   "contains no personal data" in its docs — never per-run.
7. **Reset the dev login password** (call `reset-dev-password.sh`) so prod's
   password hash doesn't lock you out of dev. ← easy to forget; bake it in.
8. `--with-uploads` flag → also call `sync-files-prod-to-dev.sh` (rsync/`docker
   cp` the uploads dir) — scrub or exclude uploads that are themselves personal
   data (documents, photos, exports).
9. Clean up the temp dump.

Companion: **`scripts/reset-dev-password.sh`** — idempotent, sets a known
dev password on the primary user; safe to run anytime; auto-invoked by the sync.

Companion: **`scripts/sync-files-prod-to-dev.sh`** — copies prod upload files
into the dev uploads dir.

---

## 5. Migrations & seed data

### The one hard rule
**Run migrations via `exec` inside the running backend container** — e.g.
`docker compose exec -T backend <migrate-tool> upgrade head`. Inside the
container the tool inherits the compose-set `APP_ENV=production`,
`DB_HOST=postgres`, `DB_NAME=<<APP>>_prod`, so it **physically cannot fall
through to the wrong DB**. This rule holds regardless of how the DB port is
published, so do it on both single-host strategies below.

> **The migrate tool must actually exist in the prod image.** Running it *inside*
> the container only works if the CLI wasn't pruned as a dev dependency — e.g. a
> Prisma image built with `npm ci --omit=dev` needs `prisma` in `dependencies`,
> not `devDependencies`, or `npx prisma migrate deploy` fails at deploy time
> (script-library §8, "compiled-TS + Prisma variant").

### The silent no-op to never trust
**`docker-entrypoint-initdb.d` runs ONLY on a fresh, empty volume.** On any
populated DB it does nothing — no error, no log line. So a Postgres image with
your migrations mounted there bootstraps a brand-new clone correctly and then
**never applies another migration for the life of that volume**. If your deploy
has no explicit migrate step, every migration added *after* the volume was
created is silently absent in prod, and the first request to a new column fails
with "column does not exist." This is the #1 schema footgun (§7 #11). Durable
fix: the hard rule above + a verified migrate step on deploy (§2 step 7) + a
`schema_migrations` ledger so you can answer "what's applied here?".

**Single host, many volumes:** the same migration files feed several independent
volumes (dev, prod, any prototype). Applying to one is **not** applying to the
others — the lagging stack throws "column does not exist" at runtime. A ledger
table per volume plus a per-stack migrate step is what keeps them honest.

### Two strategies for reaching prod safely (pick one)
- **(A) Distinct host ports per env + exec migrations (default on a
  Tailscale-only host).** Publish prod on `5433` and dev on `5434`. The migration
  *files* ship in the image, but **shipping them is not applying them** — the
  deploy MUST still run the tool via `exec` (§2 step 7). There is no mechanism
  that auto-applies migrations on `up` (do **not** rely on `initdb.d` — see
  above), so a deploy without an explicit, verified migrate step leaves prod's
  schema behind its code. Simpler than (B); accept the (small, VPN-only) exposure
  of a published DB port.
- **(B) Unpublished prod DB port + `migrate-prod.sh` (safety belt for exposed /
  non-VPN hosts).** Keep the prod DB internal to the compose network so a host
  migration tool can't reach it at all. `migrate-prod.sh` then: (1) asserts the
  `<<APP>>-api` container is running, (2) syncs current migration files into it
  (`rm` old + `docker cp` the dir) so you don't depend on a stale baked image,
  (3) runs the tool inside the container. This belt still earns its keep even on
  strategy (A) for the one case it covers: a **hotfix migration applied without a
  full image rebuild**.

> These are *single-host* concerns — mark them as such; after a prod-host split
> they simplify.

### Schema migrations — conventions
- Sequential numbered files in `backend/migrations/` (`001_*.sql`, `002_*.sql`)
  with a `schema_migrations` ledger table.
- Migrations are **append-only and NOT idempotent** — never edit or renumber an
  applied migration.
- Provide `migrate:dev` (host → dev DB) and `migrate:prod` (→ exec inside
  container). The migrate tool should **refuse to run against prod from the
  host** as a guardrail.

### Evolving a LIVE schema: expand → migrate → contract
Append-only/non-idempotent covers *adding*. To *change* an existing structure
(retype, rename, replace) with **zero downtime** on an always-shippable `main`,
split it across three deploys:

- **Expand** — add the new column/table as **additive and "dark."** Deploy this
  migration to prod *ahead of the consuming code* — safe precisely because
  nothing reads it yet. (A dark migration can sit in prod for days before its
  code ships.)
- **Migrate** — backfill, optionally dual-write, then **flip reads behind an env
  flag** (`X_CANONICAL_READS=true`) so the cutover is a config change you can
  revert instantly. (Same dormant-flag mechanism as §1.5.)
- **Contract** — drop the old structure **last**, as a separate later migration,
  once the new path has proven out.

> The **destructive / view-flip step is applied LAST and IS the cutover** — order
> your migration files so the mutating flip is the final one in the deploy, not
> interleaved with the additive ones.

### Track a cross-environment migration matrix
The `schema_migrations` ledger answers "applied *on this volume*?" — it **cannot**
answer "applied *everywhere*?" across dev / staging / prod. Keep a
human-readable matrix in `docs/current/project-description.md` (or a dedicated
`docs/current/migrations-matrix.md`): one
row per migration with its applied status + date per environment, e.g.

    202_add_hivis   applied: dev+staging+prod (2026-06-06, additive/dark)
    201_loc_seam    applied: dev only — prod deferred to go-live

This is the only at-a-glance view of cross-env drift; the per-volume ledgers
can't show it, and "additive/dark, applied to prod ahead of code" is exactly the
state you most need to track during an expand→migrate→contract rollout.

### Seed / reference data — a SEPARATE lifecycle
Schema and reference data have different lifecycles; don't cram them together.
- **Migrations = schema:** append-only, non-idempotent.
- **Seeds = reference data** (catalogs, lookup tables, default config rows):
  **idempotent / upsert, re-runnable**, so you can correct them as they evolve
  without a new migration. If you stuff seed data into migrations you can never
  fix it cleanly; if you forget seeds, a fresh prod DB comes up structurally
  valid but functionally empty.
- **Run seeds right after migrations in the same gated deploy step** (§2 step 7).
- *Exception:* truly static, one-time reference data is fine to seed via a
  migration on a small project.

---

## 6. Supporting scripts (round out the set)

- **`scripts/setup-dev.sh`** — one-shot fresh-clone / disk-recovery setup:
  install runtime + Docker, install deps, start dev stack, run migrations + seeds.
  Print the manual follow-ups (e.g. add API keys to `backend/.env.dev`).
- **Dev session — prefer a `tmux` launcher (`dev-start.sh`) for remote dev.**
  Start a tmux session with panes for the Docker services, the host frontend
  (and host backend if Node/nodemon per §1), and a shell. It survives SSH
  disconnects and you **reattach to live logs + a ready shell** (`tmux attach`),
  which beats fire-and-forget for interactive remote-over-VPN work. Use
  **nohup / pm2 / systemd-user** instead when you want auto-restart-on-crash or
  boot-persistence (a bare tmux session gives neither). Foreground `npm run dev`
  dies with the tab — don't rely on it.
- **`scripts/backup-db.sh`** — manual prod DB dump with `--keep N` retention.
- **`scripts/backup-to-remote.sh`** — push DB + files to a remote host over SSH
  (`--dry-run`). Off-host copy = real disaster recovery.
- **`scripts/docker-cleanup.sh`** — reclaim disk: prune dangling images + build
  cache, **keep the last N tagged images for rollback**. Needed *because* the
  mandated `--no-cache` builds (§2) guarantee disk growth; on a finite homelab
  disk this otherwise fails a future deploy mid-build with "no space left on
  device." Keep it **manual / cron, not auto-on-deploy** (auto-pruning can delete
  a rollback image).
- **`scripts/setup-certs.sh`** *(nginx fallback only)* — provision HTTPS certs
  (e.g. `tailscale cert` / Let's Encrypt) into `certs/`, reissue + reload on
  expiry. **Not needed with Caddy + Tailscale auto-TLS** (§1).

### Scheduled jobs are THREE layers, not two
The host-crontab-vs-app-scheduler split is incomplete the moment a job lives off
the prod host. There are really **three** layers:

1. **Ops / infra schedules → the prod HOST crontab** (`crontab -e`): backups,
   cert reissue, prod→dev sync. They operate *on* the stack from outside and must
   survive any single container's lifecycle. A host cron entry `cd`s into the
   repo and calls the script. **Avoid cron *inside* containers** — it dies on
   restart/redeploy, is invisible to `crontab -l` (so the operator forgets it
   exists), and forces a cron daemon into an app image.
2. **Application-domain schedules → the app's own worker/scheduler**, gated on
   `APP_ENV=production` (e.g. nightly data generation). These are app behavior,
   not ops, and belong with the code.
3. **Auxiliary-host / pipeline schedules → a `systemd --user` timer or a cron on
   a *different* host** (data-ingest pipelines, third-party exporters that aren't
   part of the app and don't belong on the prod host).

> **Rule: keep ONE job registry** (a single table: job · layer · schedule · where
> it lives) and, when a schedule seems missing, **check all three layers.** The
> recurring failure is an operator grepping `crontab -l` for a job that's
> actually a `systemd --user` timer on another box — invisible, so it's presumed
> not to exist. A `systemd --user` timer also needs lingering enabled to survive
> logout (`loginctl enable-linger <user>`); without it the timer stops when the
> session ends.

Example host crontab entry:

    # Daily off-host backup at 4:00 AM
    0 4 * * * cd /home/<user>/<<APP>> && ./Scripts/backup-to-remote.sh >> ./Backups/remote-backup.log 2>&1

> **Timezone gotcha:** a prod host is often UTC while you reason in local time.
> Either set `CRON_TZ=` on the entry or convert deliberately, and write the
> intended local time in a comment — otherwise "07:00 business hours" silently
> fires at the wrong hour.

---

## 7. Single-host traps to encode (learned the hard way)

1. **Unpublished prod DB port ⇒ host migration hits dev.** The reason for
   strategy (B)'s `migrate-prod.sh` indirection (§5). The *durable* fix is the
   hard rule — run migrations via `exec` inside the container — after which
   unpublished-port is an optional extra belt, not a requirement.
2. **Ad-hoc scripts default to the wrong DB.** One-off `node -e` / psql scripts
   that don't load env fall through to the dev DB. Always set the DB name
   explicitly in throwaway scripts; consider a `<<APP>>_test` DB for experiments.
3. **`docker restart` does NOT reload `env_file`.** To pick up new env vars:
   `docker compose -f docker-compose.prod.yml up -d <service>` (recreates it).
4. **Frontend is baked into the web image, not bind-mounted.** After frontend
   or build-config changes you must rebuild the web image (`--no-cache`), not
   just restart it. *(This is a **build-cache** problem — distinct from trap #9.)*
5. **Reverse-proxy / tunnel vs Docker port publishing.** A host tunnel
   (Tailscale Funnel, etc.) and Docker publishing `:443` fight over the port —
   Docker's iptables wins. Pick one.
6. **Plain-HTTP dev access over a mesh VPN:** use the bare IP
   (`http://<<TS_IP>>:<port>`), not the HTTPS hostname — HSTS from prod will
   force the browser to HTTPS and break plain-HTTP dev servers.
7. **Empty-string Docker ARGs are treated as UNSET.** If prod's API base is
   legitimately empty (same-origin relative `/api/...`), passing
   `VITE_API_URL=""` as a build arg makes the frontend fall through to its dev
   default → doubled `/api/api/...` paths or stale `localhost:<port>` calls. Fix:
   pass a **non-empty mode flag** (`VITE_APP_MODE=production`) and **derive the
   empty case in code**. (General rule in §8.)
8. **Default-filename compose targets PROD.** If prod is `docker-compose.yml`
   (the default), a bare `docker compose down/up/exec` hits production. Prefer
   `docker-compose.prod.yml` so every command must name its env (§1). If you're
   stuck on the default layout, mitigate with a shell alias, a `COMPOSE_FILE` env
   guard, or a wrapper script.
9. **Service-worker (PWA) client cache serves stale JS.** Distinct from trap #4:
   here the deploy is *already correct* and you rebuilt with `--no-cache`, but the
   browser's **service worker** keeps serving the old bundle (symptoms: stale
   `localhost` calls, "0 data" on a page that's fine server-side). Recovery is
   client-side only — DevTools → Clear site data, or incognito. **Proactive fix:**
   a service-worker `skipWaiting`/update-prompt strategy or content-hashed bundle
   filenames so clients auto-pick-up new builds.
10. **Deploy builds from the working tree.** Only deploy a clean tree at
    `origin/main`; uncommitted WIP gets baked into the image. *(This flips after a
    prod-host split to a pull-based remote deploy — the box builds from its own
    `origin/main`, so unpushed commits, not uncommitted WIP, become the failure
    mode. See §2.5.)*
11. **`initdb.d` is a bootstrap, not a migration runner.** It executes only on an
    *empty* volume; on an existing DB it's a silent no-op, so migrations added
    after volume creation never apply and code hits "column does not exist."
    Don't read the mounted-migrations-in-`initdb.d` setup as "migrations are
    handled" — it only seeds a fresh clone. Durable fix: an explicit, verified
    `exec` migrate step on deploy + a `schema_migrations` ledger (§5).
12. **Compose project name defaults to the directory basename.** A symlink (e.g.
    `~/Programs/app` → `~/appsrc`), a clone, or a rename changes it, splitting
    your containers across two namespaces that can't see each other — so a
    `docker compose down`/`up` run from the "wrong" path can orphan or **remove
    the running prod stack**. Fix: pin `COMPOSE_PROJECT_NAME=<<APP>>` (or `name:`
    in each file) so the path no longer decides the namespace (§1). Same family
    as #8 — both are "compose silently targets the wrong stack."
    **Corollary (learned the hard way):** if dev and prod run on the *same* host,
    give them **DISTINCT** project names (`<<APP>>` vs `<<APP>>_prod`) — pinning the
    *same* name for both makes a shared service (e.g. `postgres`) collide: a prod
    `up`/backup resolves the service to the **dev** container and can recreate/replace
    it. Pin per-stack via each file's `name:`, and have the deploy **export**
    `COMPOSE_PROJECT_NAME=<<APP>>_prod` (an env var overrides a file's `name:`, and a
    shared root `.env` can't differ per stack).
13. **First deploy-SSH over a cold mesh-VPN path can time out.** The host is up
    (`tailscale ping` pongs), but the first direct-path SSH attempt after idle
    times out while the path warms. Not an outage — retry / warm the path, then
    re-run the deploy. Don't roll anything back on this symptom alone.
14. **Co-located dev + prod look IDENTICAL in the browser → you act on the wrong
    one.** When the dev server and the prod deploy render the same SPA, it's easy to
    test (or delete data) on the wrong environment. Make DEV unmistakable: a
    build-time-guarded **banner** (`import.meta.env.DEV`), a `[DEV]` **tab-title**
    prefix, and a tinted page frame — all dead-code-eliminated from the prod bundle
    (prod shows nothing). A few lines; prevents "oops, that was prod."
15. **A token baked into the SPA must be (a) injected at build AND (b) equal to the
    backend's.** Single-user apps often bake an auth token into the bundle
    (`VITE_AUTH_TOKEN`). Two traps: if the build arg isn't wired all the way through
    (Dockerfile `ARG`+`ENV` *and* compose `build.args`), the SPA silently falls back
    to its dev default and **every authed call 401s while unauthenticated `/health`
    still passes** — so the deploy "succeeds" but the UI is dead. And the baked token
    must match the backend's: **single-source one secret** in the root `.env` → both
    the backend `environment:` and the web `build.args`.
16. **Caddy's `{$SITE_ADDRESS}` reads the WEB container's OWN env.** Compose
    interpolating `${SITE_ADDRESS}` in the file is not enough — the var must be in the
    web service's `environment:`. If it's empty, the Caddyfile's site block parses as a
    *global-options* block and Caddy crash-loops ("unrecognized global option: encode").
    Pass it through `environment:` with the fail-loud `${SITE_ADDRESS:?...}` form.

**Traps #17–21 first appear AFTER the prod-host split (§2.5) — they don't exist on
a single host, so they surface exactly when the box changes underneath you.**

17. **App server bound IPv6-only → new host's `bindv6only` refuses the proxy's
    IPv4 connect (502).** `app.listen(port)` that binds `:::<port>` works on a host
    with dual-stack default but fails on a host where the IPv4-mapped path is off —
    the reverse proxy connects to `127.0.0.1` and gets "connection refused," so a
    healthy backend 502s. **Bind `0.0.0.0` explicitly.** The app "worked in dev" and
    only broke on the new prod host — a classic split-only regression.
18. **Shared reverse-proxy host: generic compose service names collide across
    apps.** When two apps share one docker network (a shared edge), both define a
    `backend`/`web` service, and one app's web container resolves `http://backend:…`
    to the **other app's** container → cross-wired 502s. **Address peers by their
    unique `<<APP>>-*` container name, never the generic service name**, on any
    network shared with a co-tenant. (Same family as #2/#8/#12: something silently
    targets the wrong stack.)
19. **A git-pull deploy does NOT carry gitignored files.** A remote box that
    deploys by `git pull` gets the code but not `.env` / version files that are
    gitignored — so a value living only there (the baked `APP_VERSION`, a secret)
    stays stale while the code advances. The deploy must **sync those out-of-band**
    (§2.5). Single-host builds never hit this because they read the same working-tree
    files the code sits in.
20. **Bind-mount ownership differs across hosts.** The uid that owned `uploads/`
    (or any bind-mounted state) on the old host is not the uid the container runs as
    on the new host, so the app gets write-denied on files it "owns." Fix the mount's
    ownership to the container user (`chown -R <uid>:<gid>`) on the new host — don't
    reach for `chmod 0777`.
21. **SSH flattens argv into one string the remote shell re-parses.** A deploy that
    SSHes args to the box loses local quoting at the boundary; an arg with spaces or
    parens (`"0.27.0 (30.6.2026)"`) breaks remote parsing. `printf '%q '` each arg
    before handing it to `ssh … bash -s --`. (§2.5.)

---

## 8. Conventions to carry over

- All ops scripts: `set -e` (or `set -euo pipefail`), colorized output, a
  `--help`, preflight checks that fail fast with actionable messages, and
  destructive actions gated behind a confirm prompt or an explicit flag.
- Container naming: `<<APP>>-db` / `<<APP>>-api` / `<<APP>>-web`
  (+ `<<APP>>-broker` / `<<APP>>-worker` if async) for prod, `<<APP>>-db-dev`
  for dev.
- DB naming: `<<APP>>_prod` / `<<APP>>_dev` (/ `<<APP>>_test`).
- Secrets in gitignored `.env` files; commit a `.env.example` template.
- **Prod secrets must FAIL LOUD if unset — never `:-weakdefault`.** In a prod
  compose, `${DB_PASSWORD:-findev123}` *looks* compliant ("it uses a var") but
  silently ships the weak dev password whenever the var isn't set (stripped cron
  env, unloaded `.env`, fresh shell) — with no error. Use
  `${DB_PASSWORD:?DB_PASSWORD must be set}` so a missing secret aborts the
  command. (`:-` defaults are fine in a purely-local dev compose.)
- **Ops scripts must edit `.env` in place, never regenerate it.** A `cat > .env`
  / rewrite-the-whole-file pattern (common in version-bump and deploy scripts)
  silently destroys unrelated manually-added vars. Use a targeted `sed`/replace
  on the single line you own. (Root cause of a real outage — see §3.)
- **Feature flags default OFF and committed OFF** (`X === "true"`); flag-ON
  values live only in a gitignored env file; every OFF path is a byte-identical
  no-op (§1.5). This is what lets unfinished vNext code ride `main` to prod
  dormant instead of festering on a long-lived branch.
- **Keep a stack registry** (§1) — one row per stack (`DB port · API port ·
  volume · project name`); distinct published DB port per stack once a 3rd appears.
- **Never pass a build-time config value whose valid value can be empty.** Pass a
  non-empty mode/enum and derive the empty case in code (the root cause of §7
  trap #7).
- A short `CLAUDE.md`/README section documenting: how to start dev, how to
  deploy, the URL scheme (LAN-IP vs HTTPS hostname), and the traps in §7.

---

## 9. Working rules — starter `CLAUDE.md`

Put these in the new project's `CLAUDE.md` (the agent reads it every session).

### Collaboration rules + question protocol
The durable agent-collaboration rules (challenge-me, think-before-coding,
simplicity-first, surgical-changes, goal-driven) and the one-question-at-a-time /
options-plus-recommendation protocol live in
**[`claude-collaboration.md`](claude-collaboration.md)** — the single source for the
`CLAUDE.md` starter block. Paste that block in; don't restate it here. The
subsections below are the *infra-specific* working rules that belong with this
architecture.

### Serving URLs (mesh-VPN / multi-device convention)
- Give URLs on the host's network address (`<<HOST>>` / `<<TS_IP>>`), never
  `localhost`/`127.0.0.1` — the user views from other devices.
- Ad-hoc plain-HTTP servers: use the **bare IP** (`http://<<TS_IP>>:<port>`), not
  the HTTPS hostname (HSTS forces HTTPS → `ERR_SSL_PROTOCOL_ERROR`). See §7 #6.
- Prod (real HTTPS) is `<<PROD_URL>>`.

### Concurrency protocol (multiple agents/devs share the repo)
Treat the working tree as shared, mutable state owned by no one. Before any
**commit / release / deploy**, and again right before **push / build**:
1. **Verify stability:** `git status` (whose changes are these?),
   `git fetch origin <main> && git log --oneline -1 origin/<main>` (has HEAD
   moved?), and check for other live sessions.
2. **Stage only your own files** — explicit paths, never `git add -A` / `.`.
   Never `stash`/`restore`/`checkout` files another session is editing.
3. **Verify what actually landed:** after a path-limited `git commit -- <files>`,
   run **`git show --stat HEAD`** to confirm only your files are in the commit. On
   a shared tree a concurrent session can sweep its staged files into your commit
   (or yours into its release) despite careful staging — this check is what
   catches it.
4. **Migrations — never assume a number is free.** Take the next after the last
   on disk; on collision, yield to the committed/lower owner and renumber yours
   higher. Commit + push promptly to claim the number.
5. **Deploy builds from the working tree — only deploy a clean tree** at
   `origin/<main>`. Re-check `git status` in the same step you launch the build.
6. **One release at a time;** `git fetch` right before pushing.
7. **Don't ship or close another session's in-flight work** without explicit OK
   — a deploy bundles all of `<main>`.

### Cross-repo / external-service contracts (if any)
When integrating with another repo or service you control: **pin a contract
version**, pull + read its latest spec before non-trivial work, and keep a
`HANDOFFS.md` log of `[A → B]` change requests between the repos.

---

## 10. Documentation system

**Use the canonical [`documentation-standard.md`](documentation-standard.md)** — the
portable `docs/` convention (`current/status.md` as the one mandatory read, `cr/README.md`
as the single source of truth for ship dates, kebab-case naming, lean `CLAUDE.md`). It
supersedes the earlier `Project_Documentation/` + ALL-CAPS + status-in-filename scheme this
doc originally described.

The infra-specific catalogs this architecture wants are just optional living docs under
that standard's `current/` (or a dedicated file), one per cross-cutting concern that's easy
to let drift:
- a **cross-environment migration matrix** (§5) — the per-volume ledger can't show dev/staging/prod drift;
- a **scheduled-job registry** (§6) — one row per job across all three layers;
- a **feature-flag → track map** (§1.5);
- and, as needed, an integrations catalog, an external-API/LLM-usage catalog, or a security/secrets inventory.

Add the equivalents your domain needs, or none.

---

## 11. Other best practices to carry over

- **Numbered, append-only schema migrations + a ledger table** (§5). Never edit
  or renumber an applied migration; they are not idempotent. The ledger is also
  what lets you verify "is this migration applied *on this volume*?" — without it,
  `initdb.d` gives you a fresh-clone illusion and nothing else (§5, §7 #11).
- **Expand → migrate → contract for evolving a live schema** (§5): additive/dark
  first (deploy ahead of code), read-flip behind an env flag, destructive
  contract step last and as the cutover.
- **Track a cross-environment migration matrix** (§5) — the per-volume ledger
  can't show dev/staging/prod drift; a human-readable matrix in the docs can.
- **Seed / reference data is a separate, idempotent lifecycle** from schema
  migrations (§5) — upsert, re-runnable, run right after migrations on deploy.
- **Dormant feature-flag track on one `main`** (§1.5) — vNext rides to prod
  flag-OFF (byte-identical no-op) instead of diverging on a long-lived branch.
- **Schema-introspection CI guard for exhaustive operations.** When one
  operation must touch **every** table referencing entity X (a record merge, a
  GDPR anonymize, a cascade delete), add a CI test that queries
  `information_schema.constraint_column_usage` for all FKs targeting X and
  **asserts each is covered** by the operation's allow-list. A future migration
  that adds a referencing table without updating the handler then fails CI
  instead of silently orphaning rows in prod. Generalizes to any "must stay
  exhaustive as the schema grows" invariant (UNIQUE constraints, triggers, etc.).
- **One `version.json` as the single version source of truth** (§3) — copied
  into the frontend build, mounted read-only into the backend. No synced env
  vars to drift, and nothing that tempts a `cat > .env` rewrite (§8).
- **Version + date visible in the UI of BOTH environments; dev visually
  unmistakable** (§3, §7 #14) — real version string in dev and prod alike, plus
  dev's distinct banner/tab/favicon. "Which version, which environment" must
  never require a terminal.
- **Secrets in gitignored `.env`; commit a `.env.example` template.** One config
  surface, no secrets in scripts or compose; prod secrets fail loud if unset (§8).
- **Backup before destructive ops:** `pg_dump` the prod DB before every deploy
  (§2) and before any prod-data sync; keep an **off-host** copy for real DR (§6).
- **Quarterly restore drill** — an untested backup is a hypothesis. Restore the
  latest dump into a scratch DB, assert tables/row-counts/ledger head, drop it,
  record the date (`verify-restore.sh` spec in [`script-library.md`](script-library.md) §11).
- **PII scrub on every prod→dev data sync** (§4) — raw personal data never sits on
  a dev box; the scrub script stays exhaustive via a CI guard.
- **Reclaim Docker disk on a schedule** (§6 `docker-cleanup.sh`) — mandatory
  `--no-cache` builds guarantee growth; keep last N images for rollback.
- **Healthchecks + `depends_on: service_healthy` ordering** so the stack comes up
  in the right order and deploy can *verify* health, not just "it started" (§1).
- **Reattachable dev session (tmux) or detached process manager** so dev servers
  survive a closed terminal/SSH session (§6).
- **Worker reuses the backend image** — differ only by `command` + healthcheck,
  share env + `depends_on` (§1). No separate worker Dockerfile to drift.
- **Scheduled jobs span three layers** (prod host cron / app worker / auxiliary
  host) — keep one registry and check all three when one seems missing (§6).
- **Separate `<<APP>>_test` DB for ad-hoc/throwaway scripts** so a stray
  `node -e` or psql one-liner can't clobber dev data (§7 #2).
- **A staging/UAT tier that mirrors prod topology** to rehearse the deploy +
  migration cutover and exercise flag-ON code before prod (§1).
- **A stack registry + distinct DB port per stack** once a 3rd stack appears (§1,
  §8) — reused ports collide; an unregistered port becomes tribal knowledge.
- **Security defaults** (adapt to your auth model): short-lived access token +
  longer refresh token, rate-limiting on auth endpoints, per-user data isolation
  enforced server-side.
- **A decisions/notes log** (`NOTES.md` or the agent's persistent memory) for
  non-obvious gotchas that aren't derivable from the code — the kind of thing
  that bites you twice otherwise.

---

## 12. What to ask me before building

Go through these one at a time, each with options + your recommendation:
1. Confirmed: **single host now, plan for a future split** — keep the seam clean
   per §0. Anything that should be split-ready from day one?
2. **§0.5 Q1 — is there async/background work, and must it be durable?** (decides
   3-tier vs in-process-async vs +broker/worker, and the dev topology).
3. **§0.5 Q2 — Tailscale-only or public domain?** (decides Caddy-auto-TLS vs
   nginx+certs, and DB-port strategy).
4. Backend/frontend/DB stack choices (and: is the backend Node, for the
   host-nodemon dev carve-out?).
5. Is there user-uploaded/file state to bind-mount and back up?
6. Off-host backup target (or skip `backup-to-remote.sh` for now)?
7. Will there be a **vNext / parallel track** that needs the dormant feature-flag
   model (§1.5), and a **staging tier** to rehearse cutovers (§1)?
8. Which optional Core Documents catalogs (§10) does this domain need?
