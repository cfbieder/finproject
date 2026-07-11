# Script & Pattern Library — concrete sources to crib from

> **Pack role:** the *implementation* companion to [`infra-bootstrap.md`](infra-bootstrap.md).
> That doc is the architecture and the reasoning; this one is copy-pasteable **script sources,
> Dockerfiles, and UI patterns** distilled from an earlier Express + plain-JS + nginx project.
>
> ⚠️ **Port the principle, not the library.** These snippets are Express/CommonJS/nginx-era.
> Where they disagree with [`infra-bootstrap.md`](infra-bootstrap.md), **infra-bootstrap wins** —
> the important corrections are called out inline in ⚠️ boxes below. Use this as a checklist and
> a starting skeleton, not a blueprint to copy verbatim.
>
> **Last reviewed:** 2026-07-06.

## Corrections already applied vs the original legacy doc

| Legacy said | This pack uses | Why |
|---|---|---|
| Migrations idempotent (`IF NOT EXISTS`) | Schema migrations **append-only, NOT idempotent**; only *seeds* are idempotent | infra-bootstrap §5 |
| Version in `frontend/.env` (`VITE_APP_VERSION`) | One root **`version.json`**, copied into builds | infra-bootstrap §3 |
| nginx + self-managed certs, publish `443/80` | **Cloudflare Tunnel + Caddy** where going public; TLS at the edge, zero published web ports | [`deploy-to-public.md`](deploy-to-public.md), infra-bootstrap trap #5 |
| `git add -A && git commit` | Stage **explicit paths** only | infra-bootstrap §9 |
| (no compose project name) | Pin `COMPOSE_PROJECT_NAME`; **distinct** dev vs prod names | infra-bootstrap trap #12 |

**Best to extract as-is (stack-agnostic, keep):** the ops-script set below (setup-dev / deploy /
backup-db / backup-to-remote / sync-prod-to-dev), the **dev-vs-prod visual differentiation**, the
non-root container user, the `/health` endpoint, JWT-refresh rotation, backup tiers + cron,
multi-stage Dockerfiles, `depends_on: service_healthy`, and the `engines` pin.

---

## 1. Script conventions

All scripts live in `scripts/` and follow these:
- `set -euo pipefail` for safety.
- Color-coded output (RED / GREEN / YELLOW / BLUE).
- `--help` flag on every script.
- Auto-detect project root: `PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`.

> Substitute your own container/DB names for the `myapp-*` / `myappuser` / `myapp_prod` literals
> throughout — these are the pack's **seed-time substitution targets in script files**
> (equivalent to `<<APP>>` in the prose docs; see README → "Placeholder convention"). On a
> single host, remember the distinct-project-name rule (infra-bootstrap trap #12).

---

## 2. `setup-dev.sh` — one-command dev setup

Run once after a fresh clone: installs runtime + Docker (idempotent), generates `.env.dev`
secrets, installs deps, starts the dev DB, runs migrations.

```bash
#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log()  { echo -e "${BLUE}[setup]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
die()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

# 1. Install Node.js 20
install_node() {
  if command -v node &>/dev/null && [[ "$(node --version)" == v20* ]]; then
    ok "Node.js $(node --version) already installed"; return
  fi
  log "Installing Node.js 20.x ..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ok "Node.js $(node --version) installed"
}

# 2. Install Docker
install_docker() {
  if command -v docker &>/dev/null; then
    ok "Docker already installed"; return
  fi
  log "Installing Docker ..."
  sudo apt-get update -qq
  sudo apt-get install -y ca-certificates curl gnupg lsb-release
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -qq
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  if ! groups "$USER" | grep -q docker; then
    sudo usermod -aG docker "$USER"
    warn "Log out and back in for docker group to take effect"
  fi
  ok "Docker installed"
}

# 3. Create .env.dev from template (auto-generated secrets)
create_env() {
  local env_file="$PROJECT_ROOT/backend/.env.dev"
  if [[ -f "$env_file" ]]; then ok ".env.dev already exists"; return; fi
  log "Creating backend/.env.dev from .env.example ..."
  cp "$PROJECT_ROOT/backend/.env.example" "$env_file"
  sed -i "s|JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" "$env_file"
  sed -i "s|JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -hex 32)|" "$env_file"
  sed -i "s|ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 16)|" "$env_file"
  ok ".env.dev created with auto-generated secrets"
}

install_deps() {
  (cd "$PROJECT_ROOT/backend" && npm install)
  (cd "$PROJECT_ROOT/frontend" && npm install)
  ok "Dependencies installed"
}

start_db() {
  docker compose -f "$PROJECT_ROOT/docker-compose.dev.yml" up -d
  local retries=30
  until docker exec myapp-db-dev pg_isready -U myappuser -d myapp_dev &>/dev/null; do
    retries=$((retries - 1))
    [[ $retries -eq 0 ]] && die "PostgreSQL did not become ready"
    sleep 1
  done
  ok "PostgreSQL is ready"
}

run_migrations() {
  (cd "$PROJECT_ROOT/backend" && npm run migrate:dev)
  ok "Migrations applied"
}

main() {
  install_node; install_docker; create_env; install_deps; start_db; run_migrations
  echo ""; ok "Setup complete!"
  echo "Start dev servers:"
  echo "  Terminal 1: cd backend && npm run dev"
  echo "  Terminal 2: cd frontend && npm run dev"
}
main "$@"
```

---

## 3. `deploy-to-production.sh`

Single-host deploy: preflight → optional git pull → backup → build `--no-cache` → up →
wait-for-DB → migrate → verify.

> ⚠️ **Reconcile with infra-bootstrap §2 before use.** The evolved version: resolves the version
> from **`version.json`** (not `frontend/.env`); runs migrations via **`exec` inside the container**
> and then **asserts the migration is recorded in the ledger** before calling the deploy healthy;
> and curls the **public** `/health` from outside, not just container status. The skeleton below
> is the structure — layer those three in.

```bash
#!/bin/bash
# deploy-to-production.sh — Deploy to production
# Usage: ./scripts/deploy-to-production.sh [--with-git] [--no-backup] [--help]
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"
BACKUP_DIR="$PROJECT_DIR/Backups"
PROD_URL="https://your-domain.example.com"

WITH_GIT=false; NO_BACKUP=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --with-git)  WITH_GIT=true; shift ;;
        --no-backup) NO_BACKUP=true; shift ;;
        --help) echo "Usage: $0 [--with-git] [--no-backup] [--help]"; exit 0 ;;
        *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
    esac
done

cd "$PROJECT_DIR"

# Pre-flight
[ ! -f "$COMPOSE_FILE" ] && echo -e "${RED}ERROR: docker-compose.prod.yml not found${NC}" && exit 1
[ ! -f "$PROJECT_DIR/backend/.env" ] && echo -e "${RED}ERROR: backend/.env not found${NC}" && exit 1
echo -e "${GREEN}✓ Config files verified${NC}"

[ "$WITH_GIT" = true ] && git pull && echo -e "${GREEN}✓ Git pull complete${NC}"

# Backup existing DB (skip gracefully on first deploy)
if [ "$NO_BACKUP" = false ]; then
    if docker ps --format '{{.Names}}' | grep -q '^myapp-db$'; then
        mkdir -p "$BACKUP_DIR"
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        BACKUP_FILE="$BACKUP_DIR/backup_${TIMESTAMP}.dump"
        docker exec myapp-db pg_dump -U myappuser -d myapp_prod -Fc > "$BACKUP_FILE"
        echo -e "${GREEN}✓ DB backed up: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))${NC}"
    fi
fi

# Version + secret → build args
# ⚠️ Evolved: read APP_VERSION from version.json, not frontend/.env (infra-bootstrap §3).
APP_VERSION="dev"
[ -f "$PROJECT_DIR/version.json" ] && APP_VERSION=$(grep -oE '"version"[^,]*' "$PROJECT_DIR/version.json" | cut -d'"' -f4)
export APP_VERSION
[ -f "$PROJECT_DIR/backend/.env" ] && export DB_PASSWORD=$(grep '^DB_PASSWORD=' "$PROJECT_DIR/backend/.env" | sed 's/^DB_PASSWORD=//')

echo -e "${YELLOW}Building images (version: $APP_VERSION)...${NC}"
docker compose -f "$COMPOSE_FILE" build --no-cache
docker compose -f "$COMPOSE_FILE" up -d

# Wait for DB
for i in $(seq 1 30); do
    docker exec myapp-db pg_isready -U myappuser -d myapp_prod > /dev/null 2>&1 && break
    [ $i -eq 30 ] && echo -e "${RED}ERROR: DB not ready${NC}" && exit 1
    sleep 2
done
echo -e "${GREEN}✓ Database ready${NC}"

# Migrate INSIDE the container (⚠️ mandatory + verify the ledger afterward — infra-bootstrap §5)
docker compose -f "$COMPOSE_FILE" exec -T backend <migrate-tool> upgrade head
echo -e "${GREEN}✓ Migrations complete${NC}"

# Verify
CONTAINERS=("myapp-db" "myapp-api" "myapp-web"); ALL_RUNNING=true
for c in "${CONTAINERS[@]}"; do
    docker ps --format '{{.Names}}' | grep -q "^${c}$" || ALL_RUNNING=false
done
curl -fsS "$PROD_URL/health" >/dev/null 2>&1 || ALL_RUNNING=false
[ "$ALL_RUNNING" = true ] && echo -e "${GREEN}Deploy OK — $PROD_URL${NC}" \
    || echo -e "${RED}Issues — check: docker logs myapp-api${NC}"
```

---

## 4. `update_version.sh` — semver + date

> ⚠️ **Evolved to `version.json`.** The legacy version stored the string in `frontend/.env`
> (`VITE_APP_VERSION`), which drifts and invites a `cat > .env` rewrite that wipes other vars
> (infra-bootstrap §3/§8). Prefer writing to a single root **`version.json`** and `cp`-ing it into
> each build context. The mode/flag interface below (`--show`, `--auto`, `--bump-*`, exact string,
> git tag) is worth keeping; just retarget the write.

```bash
#!/bin/bash
# update_version.sh — Usage: … --bump-patch | --bump-minor | --bump-major | --auto | --show | "VERSION"
set -euo pipefail

ENV_FILE="frontend/.env"          # ⚠️ retarget to version.json per infra-bootstrap §3
VERSION_KEY="VITE_APP_VERSION"

if [ ! -f "$ENV_FILE" ]; then
  [ -f "../$ENV_FILE" ] && cd .. || { echo "Error: Cannot find $ENV_FILE"; exit 1; }
fi

get_current_version() { grep "^${VERSION_KEY}=" "$ENV_FILE" | cut -d'=' -f2-; }
extract_version_number() { echo "$1" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1; }
get_date_string() { date +"%d.%-m.%Y"; }

update_version() {
  if grep -q "^${VERSION_KEY}=" "$ENV_FILE"; then
    sed -i "s/^${VERSION_KEY}=.*/${VERSION_KEY}=${1}/" "$ENV_FILE"
  else
    echo "${VERSION_KEY}=${1}" >> "$ENV_FILE"
  fi
}

CURRENT_VERSION=$(get_current_version)
CURRENT_NUM=$(extract_version_number "$CURRENT_VERSION")
DATE_STR=$(get_date_string)

case "${1:---help}" in
  --show)   echo "Current version: $CURRENT_VERSION"; exit 0 ;;
  --auto)   NEW_VERSION="${CURRENT_NUM} (${DATE_STR})" ;;
  --bump-patch) IFS='.' read -r M m p <<< "$CURRENT_NUM"; NEW_VERSION="${M}.${m}.$((p+1)) (${DATE_STR})" ;;
  --bump-minor) IFS='.' read -r M m p <<< "$CURRENT_NUM"; NEW_VERSION="${M}.$((m+1)).0 (${DATE_STR})" ;;
  --bump-major) IFS='.' read -r M m p <<< "$CURRENT_NUM"; NEW_VERSION="$((M+1)).0.0 (${DATE_STR})" ;;
  --help|-h) echo "Usage: $0 --bump-patch|--bump-minor|--bump-major|--auto|--show|\"VERSION\""; exit 0 ;;
  --*) echo "Unknown option: $1"; exit 1 ;;
  *)   NEW_VERSION="$1" ;;
esac

echo "Updating version: $CURRENT_VERSION -> $NEW_VERSION"
update_version "$NEW_VERSION"

TAG_NAME="v${NEW_VERSION%% *}"
if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
  echo "Git tag '$TAG_NAME' already exists, skipping."
else
  git tag -a "$TAG_NAME" -m "Version ${NEW_VERSION}"
  echo "Git tag created: $TAG_NAME (push with: git push origin $TAG_NAME)"
fi
echo "Rebuild frontend for changes to take effect."
```

> Gotcha: this tags at *current* HEAD. If you bump before the release commit,
> `git tag -f vX.Y.Z <release-sha>` to move the tag.

---

## 5. `backup-db.sh` — local DB backup with retention

```bash
#!/bin/bash
# backup-db.sh — Usage: ./scripts/backup-db.sh [--keep N]
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/Backups"
CONTAINER="myapp-db"; DB_NAME="myapp_prod"; DB_USER="myappuser"; KEEP_BACKUPS=0

while [[ $# -gt 0 ]]; do
    case $1 in
        --keep) KEEP_BACKUPS="$2"; shift 2 ;;
        --help) echo "Usage: $0 [--keep N]"; exit 0 ;;
        *) echo -e "${RED}Unknown: $1${NC}"; exit 1 ;;
    esac
done

docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$" \
    || { echo -e "${RED}ERROR: '${CONTAINER}' not running${NC}"; exit 1; }

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_${TIMESTAMP}.dump"
echo -e "${YELLOW}Backing up ${DB_NAME}...${NC}"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$BACKUP_FILE"
echo -e "${GREEN}✓ Backup: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))${NC}"

if [ "$KEEP_BACKUPS" -gt 0 ]; then
    COUNT=$(ls -1 "$BACKUP_DIR"/backup_*.dump 2>/dev/null | wc -l)
    if [ "$COUNT" -gt "$KEEP_BACKUPS" ]; then
        REMOVE=$((COUNT - KEEP_BACKUPS))
        ls -1t "$BACKUP_DIR"/backup_*.dump | tail -n "$REMOVE" | xargs rm -f
        echo -e "${YELLOW}Pruned $REMOVE old backup(s)${NC}"
    fi
fi
```

---

## 6. `backup-to-remote.sh` — off-host backup via SSH (spec)

Off-host copy = real disaster recovery. This one is described by its config + behavior rather
than reproduced in full; build it to:
1. Check SSH connectivity to the remote host.
2. Detect the running DB container (prod, fall back to dev).
3. Dump with `pg_dump -Fc`; copy env files + data dirs.
4. Tar + `scp` across; clean remote backups older than the retention window.
5. Verify the transfer with a remote file count. Support `--dry-run`; log to stdout + a file.

```bash
# Config block at the top of the script:
REMOTE_HOST="192.168.1.252"
REMOTE_USER="youruser"
REMOTE_DIR="~/backups/myapp"
DB_CONTAINER_PROD="myapp-db"
DB_CONTAINER_DEV="myapp-db-dev"
DB_USER="myappuser"
DB_NAME="myapp_prod"
RETENTION_DAYS=30
BACKUP_DIRS=("backend/uploads" "Backups")
ENV_FILES=("backend/.env" "backend/.env.dev")
```

---

## 7. `sync-db-prod-to-dev.sh` — copy prod data into dev

Prints row counts before clobbering, confirms destructively, restores with `--clean`.

> ⚠️ **PII scrub is MANDATORY (GDPR — clinic/client data especially).** Raw production
> personal data must not sit on a dev box with weak dev credentials. After the restore, the
> sync **must** run a scrub step (below) before declaring success, and per infra-bootstrap
> §4 also **reset the dev login password** and offer `--with-uploads` (scrubbing/excluding
> uploads that are themselves personal data). The only exception is a project whose data
> demonstrably contains no personal data — and that exception is decided once and written
> into the project's docs, not assumed per-run.

**`scripts/scrub-dev-data.sql`** — pseudonymize in place, preserving row counts, FK
integrity, and value shapes (so the app still behaves realistically):

```sql
-- scrub-dev-data.sql — run against the DEV database only, immediately after a prod restore.
-- Deterministic per-row fakes: unique, stable within a sync, obviously fake.
BEGIN;
UPDATE users SET
  email       = 'user' || id || '@scrubbed.local',
  full_name   = 'Scrubbed User ' || id,
  phone       = '+00 000 ' || lpad(id::text, 6, '0');
-- Repeat for every table holding personal data: patient/client records, addresses,
-- free-text notes (SET note = '[scrubbed]'), external IDs, DOBs (jitter or fixed date).
-- Keep this file EXHAUSTIVE as the schema grows: pair it with a schema-introspection CI
-- guard (testing-and-ci.md) that lists person-linked columns (*name*, *email*, *phone*,
-- *address*, note/text columns on person tables) and asserts each is covered here.
COMMIT;
```

Wire into the sync script after the restore:

```bash
docker exec -i "$DEV_CONTAINER" psql -U "$DB_USER" -d "$DEV_DB" < scripts/scrub-dev-data.sql
echo -e "${GREEN}✓ PII scrubbed${NC}"
# then: reset the dev login password (reset-dev-password.sh) — prod hashes lock you out
```

The sync script proper:

```bash
#!/bin/bash
# sync-db-prod-to-dev.sh — Usage: ./scripts/sync-db-prod-to-dev.sh [--with-uploads]
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_CONTAINER="myapp-db"; DEV_CONTAINER="myapp-db-dev"
PROD_DB="myapp_prod"; DEV_DB="myapp_dev"; DB_USER="myappuser"
TEMP_DUMP="/tmp/myapp_prod_dump.dump"

docker ps --format '{{.Names}}' | grep -q "^${PROD_CONTAINER}$" \
    || { echo -e "${RED}ERROR: '${PROD_CONTAINER}' not running${NC}"; exit 1; }

if ! docker ps --format '{{.Names}}' | grep -q "^${DEV_CONTAINER}$"; then
    docker compose -f "$PROJECT_DIR/docker-compose.dev.yml" up -d postgres
    for i in $(seq 1 15); do
        docker exec "$DEV_CONTAINER" pg_isready -U "$DB_USER" -d "$DEV_DB" > /dev/null 2>&1 && break
        sleep 2
    done
fi

echo -e "${BLUE}Production database contents:${NC}"
for table in users documents; do
    COUNT=$(docker exec "$PROD_CONTAINER" psql -U "$DB_USER" -d "$PROD_DB" -t -c \
        "SELECT COUNT(*) FROM $table;" 2>/dev/null | tr -d ' ' || echo "N/A")
    echo "  $table: $COUNT rows"
done

echo -e "${RED}WARNING: This will REPLACE all data in dev!${NC}"
read -p "Continue? (y/N): " CONFIRM
[[ ! "$CONFIRM" =~ ^[Yy]$ ]] && exit 0

docker exec "$PROD_CONTAINER" pg_dump -U "$DB_USER" -d "$PROD_DB" -Fc > "$TEMP_DUMP"
cat "$TEMP_DUMP" | docker exec -i "$DEV_CONTAINER" pg_restore \
    -U "$DB_USER" -d "$DEV_DB" --clean --if-exists --no-owner 2>/dev/null || true
rm -f "$TEMP_DUMP"
echo -e "${GREEN}✓ Sync complete!  (remember to reset the dev password)${NC}"
```

---

## 8. Multi-stage Dockerfiles + non-root user

> ⚠️ The nginx stage is legacy — where you're going public, TLS terminates at the **Cloudflare +
> Caddy** edge (infra-bootstrap trap #5), so the frontend image just serves static files and
> publishes no `443`. Keep the **multi-stage build**, the **non-root `appuser`**, the baked
> `HEALTHCHECK`, and the `ARG`+`ENV` version threading.

**backend/Dockerfile:**
```dockerfile
# Stage 1: production deps
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Stage 2: production image
FROM node:20-alpine
RUN apk add --no-cache curl
WORKDIR /app
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -D appuser
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p uploads logs && chown -R appuser:appgroup uploads logs
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
```

> **Compiled-TS + Prisma variant (NestJS et al.).** The `server.js` image above is the
> plain-JS shape. A compiled-TypeScript backend with Prisma differs in three load-bearing
> ways, each of which has bitten a real deploy — all fail *only at container start or
> deploy time*, so a green CI build doesn't catch them:
> - **Add a build stage:** `npm ci` (all deps) → `npx prisma generate` → `npm run build`,
>   then copy `dist/`, `node_modules/`, and `prisma/` into the runtime stage.
> - **Point `CMD` at the compiled entrypoint** — `CMD ["node", "dist/main.js"]`, not
>   `server.js`. A wrong path crashes the container on boot with the image otherwise valid.
> - **Keep the `prisma` CLI in `dependencies`, not `devDependencies`.** §5's hard rule runs
>   `npx prisma migrate deploy` *inside* the prod container; if `prisma` was pruned by
>   `npm ci --omit=dev`, the CLI is absent and the in-container migrate fails at deploy time.

**frontend/Dockerfile:**
```dockerfile
# Stage 1: build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_APP_VERSION=dev
ENV VITE_APP_VERSION=$VITE_APP_VERSION
# VITE_ENV_LABEL intentionally NOT set — production has no dev label
RUN npm run build

# Stage 2: serve (static; edge terminates TLS)
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/app.conf   # SPA routing + cache policy (below)
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**frontend/nginx.conf** — SPA routing **and the cache policy that prevents the
stale-chunk "Failed to fetch dynamically imported module" class** (see gotcha
#29). The entry document must always revalidate; content-hashed bundles are
immutable. Ship this from day one — retrofitting it after the bug appears is the
2-hour incident:
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;

    # API + health → backend. On a shared-edge box, proxy to the app's UNIQUE
    # CONTAINER name, not the generic service name `backend` (which collides on
    # the shared network — see deploy-to-shared-edge.md).
    location /api/    { proxy_pass http://backend:3000; }
    location = /health { proxy_pass http://backend:3000; }

    # Content-hashed build assets (Vite /assets/*, hashed filenames): a redeploy
    # mints NEW filenames, so old ones simply go unreferenced — safe forever.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # SPA entry document + client-routes: MUST always revalidate. A browser- or
    # edge-cached index.html that points at chunk hashes a later deploy replaced
    # is the whole failure mode. no-store also defeats heuristic browser caching.
    location / {
        add_header Cache-Control "no-store";
        try_files $uri /index.html;
    }
}
```
> **Caddy equivalent** (when the frontend serves via Caddy): mutually-exclusive
> matchers so exactly one `Cache-Control` wins per response —
> ```
> @assets path /assets/*
> @doc    not path /assets/*
> header @assets Cache-Control "public, max-age=31536000, immutable"
> header @doc    Cache-Control "no-cache"
> ```
> Worked instance: Staritsky `frontend/Caddyfile` (shared-edge co-host).

---

## 9. Dev-vs-prod visual differentiation + version display (keep — high value, low cost)

**The standard (two rules, both mandatory):**
1. **The version string — number *and* date, `"X.Y.Z (D.M.YYYY)"` — is displayed in the UI
   of BOTH environments** (header toolbar or sidebar/footer). Dev must show the *real*
   current version, never a `'dev'` fallback — "which version am I looking at" is the first
   question in every bug report and every wrong-environment near-miss.
2. **Dev is visually unmistakable:** distinct banner/primary color, `[DEV]` tab-title
   prefix, distinct favicon, DEV badge — all absent from the prod bundle (infra-bootstrap
   trap #14).

**Version display — one mechanism for both environments.** Since `update_version.sh`
already copies `version.json` into the frontend build context (infra-bootstrap §3), import
it directly — dev and prod then read the identical source, and no build arg can silently
fall back:

```jsx
// version.js — single source for the UI
import versionData from '../version.json';   // copied in by update_version.sh
export const APP_VERSION = versionData.version;  // "0.4.2 (6.7.2026)"

// In the Layout header/footer (both envs render this):
<Typography variant="caption" sx={{ opacity: 0.7 }}>v{APP_VERSION}</Typography>
```

(If a project instead bakes the version via a `VITE_APP_VERSION` build arg, dev must set it
too — but the import approach above is preferred precisely because it can't diverge.)

Prevents acting on the wrong environment when dev and prod render the same SPA. All of the
dev styling below is **dead-code-eliminated from the prod bundle** because the label var is
simply absent in the prod build.

**Detect** (`VITE_ENV_LABEL` present in the committed dev `.env`, never passed in the prod build):
```jsx
const isDev = Boolean(import.meta.env.VITE_ENV_LABEL);

if (isDev) {
  document.title = '[DEV] My App';
  let meta = document.querySelector('meta[name="theme-color"]')
          || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
  meta.setAttribute('content', '#e65100');            // orange
  const link = document.querySelector("link[rel~='icon']") || document.createElement('link');
  link.rel = 'icon'; link.href = '/favicon-dev.ico';  // distinct dev favicon
  document.head.appendChild(link);
}
```

**Theme + badge** (example with MUI; the idea ports to any UI kit):
```jsx
const theme = createTheme({ palette: { primary: { main: isDev ? '#e65100' : '#1976d2' } } });

// In the AppBar, next to the title:
{import.meta.env.VITE_ENV_LABEL && (
  <Chip label={import.meta.env.VITE_ENV_LABEL} size="small"
        sx={{ ml: 1, color: 'white', backgroundColor: 'rgba(255,255,255,0.25)', fontWeight: 'bold' }} />
)}
```

| Element | Development | Production |
|---|---|---|
| **Version + date (`vX.Y.Z (D.M.YYYY)`)** | **Shown — real version** | **Shown — real version** |
| Navbar / primary color | Deep orange (`#e65100`) | Blue (`#1976d2`) |
| Tab title | `[DEV] My App` | `My App` |
| Favicon | Orange variant | Normal |
| Env badge | "DEV" chip | Not shown |
| Mobile theme-color | Orange | Default |

---

## 10. Small backend patterns worth keeping

**Health endpoint** (Docker healthcheck + monitoring depend on it):
```javascript
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
```

**JWT auth with refresh rotation:** short-lived access token (~30 min); longer refresh (~7 d) in
an httpOnly cookie; **rotate the refresh token on use**.

**User-partitioned uploads** (avoids collisions, simplifies cleanup):
```
uploads/<user_id>/2026/01/file1.pdf
```

**Engine pin** (catches version mismatches early):
```json
{ "engines": { "node": ">=18.0.0", "npm": ">=9.0.0" } }
```

**Port-conflict rescue** when a dev server orphans a process:
```bash
sudo kill -9 $(sudo lsof -t -i:3000)
sudo kill -9 $(sudo lsof -t -i:5173)
```

> For **rate limiting, input validation, security headers, and structured logging**, use your
> framework's idioms rather than the legacy Express libs — e.g. NestJS: `@nestjs/throttler`,
> `ValidationPipe` + `class-validator`, `helmet`, `nestjs-pino`. The principle (limit auth
> endpoints on the *real* client IP, validate at the boundary, log structured) is what carries over.

---

## 11. Backup tiers + cron + restore drill (reference)

Three tiers: (1) automatic **pre-deploy** backup, (2) **local on-demand** (`backup-db.sh`),
(3) **off-host automated** (`backup-to-remote.sh`) on a schedule. Example crontab:

```cron
# Off-host backup every 2 days at 02:00
0 2 */2 * * /path/to/project/scripts/backup-to-remote.sh >> /path/to/project/Backups/backup-remote.log 2>&1
# Docker disk cleanup, weekly (keeps N tagged images for rollback — see infra-bootstrap §6/§11)
0 3 * * 0 docker builder prune --force --filter until=48h && docker image prune --force --filter until=48h
```

> ⚠️ Timezone: a prod host is often UTC while you reason in local time — set `CRON_TZ=` or convert
> deliberately and note the intended local time in a comment (infra-bootstrap §6).

### The quarterly restore drill — an untested backup is a hypothesis

Every backup leg above is only proven when a restore from it has succeeded. Quarterly
(calendar it; pairs well with the observability review):

**`scripts/verify-restore.sh`** — spec:
1. Take the **latest** off-host (or local) `-Fc` dump.
2. Create a scratch DB `myapp_restoretest` on the dev stack (never touch dev/prod DBs).
3. `pg_restore --no-owner` into it; fail loud on errors.
4. **Assert:** the expected core tables exist; row counts for 2–3 key tables are within a
   plausible band (e.g. ≥ 90% of prod's counts printed by the last sync); the
   `schema_migrations` ledger's head matches prod's.
5. Optional deeper check: boot a throwaway backend container against the scratch DB and
   curl `/health`.
6. **Drop the scratch DB**, print a one-line result, and record the drill date + outcome in
   `docs/current/status.md`.

A failed drill is a P1 on the backup pipeline, not a curiosity — you have just learned your
DR plan doesn't work, at the cheapest possible moment.

---

## Quick reference — script commands

| Command | Purpose |
|---|---|
| `bash scripts/setup-dev.sh` | One-time dev environment setup |
| `./scripts/deploy-to-production.sh` | Deploy to production |
| `./scripts/deploy-to-production.sh --with-git` | Pull + deploy |
| `./scripts/update_version.sh --bump-patch` | Bump patch version |
| `./scripts/update_version.sh --show` | Show current version |
| `./scripts/backup-db.sh [--keep N]` | Local DB backup (+ retention) |
| `./scripts/backup-to-remote.sh [--dry-run]` | Off-host backup via SSH |
| `./scripts/sync-db-prod-to-dev.sh [--with-uploads]` | Copy prod DB into dev |
