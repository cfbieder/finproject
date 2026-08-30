#!/usr/bin/env bash
#
# deploy-to-production.sh — Deploy changes from development to production
#
# This script:
# 1. Backs up the production database (safety first!)
# 2. Commits and pushes changes to git (optional)
# 3. Rebuilds and restarts production containers
# 4. Verifies deployment health
#
# Usage: ./deploy-to-production.sh [--with-git] [--no-backup] [--allow-dirty]
#                                  [--allow-unverified-migrations] [--allow-red-ci]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Always use canonical path to avoid Docker project name mismatches from symlinks
export COMPOSE_PROJECT_NAME="psproject"

SKIP_GIT=true  # Skip git by default - handle manually
NO_BACKUP=false
ALLOW_DIRTY=false
ALLOW_UNVERIFIED_MIGRATIONS=false
ALLOW_RED_CI=false
BACKUP_DIR="$PROJECT_DIR/Backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/fin_backup_$(date +%Y%m%d_%H%M%S).dump"

# Parse arguments
for arg in "$@"; do
    case $arg in
        --with-git)
            SKIP_GIT=false
            shift
            ;;
        --no-backup)
            NO_BACKUP=true
            shift
            ;;
        --allow-dirty)
            ALLOW_DIRTY=true
            shift
            ;;
        --allow-unverified-migrations)
            ALLOW_UNVERIFIED_MIGRATIONS=true
            shift
            ;;
        --allow-red-ci)
            ALLOW_RED_CI=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--with-git] [--no-backup] [--allow-dirty] [--allow-unverified-migrations] [--allow-red-ci]"
            echo ""
            echo "Options:"
            echo "  --with-git     Enable git commit and push (skipped by default)"
            echo "  --no-backup    Skip database backup (not recommended)"
            echo "  --allow-dirty  Deploy build-affecting changes that are not committed"
            echo "  --allow-unverified-migrations"
            echo "                 Apply a migration to prod that has never run on dev"
            echo "  --allow-red-ci Deploy a commit whose CI is red, unfinished, or never ran"
            echo "  --help         Show this help message"
            echo ""
            echo "Default behavior: Skips git, backs up database, deploys to production"
            exit 0
            ;;
    esac
done

echo "=========================================="
echo "  Deploy to Production"
echo "=========================================="
echo ""

# Check if production is running
if ! docker ps --format '{{.Names}}' | grep -q '^fin-postgres$'; then
    echo "ERROR: Production is not running"
    echo "Please start production first: docker compose up -d"
    exit 1
fi

# Step 0: Refuse to build from a dirty working tree (Known Issue #17).
#
# This script builds the frontend image and applies migrations from WHATEVER IS ON DISK —
# not from a tag, a commit, or even the index. More than one agent thread works this single
# tree, so without this check another thread's unfinished work rides your deploy and the
# resulting prod build corresponds to no commit. That has happened four times: migration 044
# (untracked and incomplete), migration 055 + the CR064 P6 engine, and CR067 P1+P2 riding
# the v3.11.16 deploy. Harm was nil every time BECAUSE SOMEONE CHECKED AFTERWARDS, which is
# not a control.
#
# Scoped to paths that actually reach the image or the database, deliberately: docs churn
# constantly across threads, and a guard that fires on every doc edit is one people learn to
# bypass with --allow-dirty reflexively, which is worse than no guard at all.
# `git status --porcelain -- <paths>` reports untracked files in those paths too, which is
# the migration-044 case.
BUILD_PATHS=(server frontend docker-compose.yml)

if git rev-parse --git-dir >/dev/null 2>&1; then
    DIRTY="$(git status --porcelain -- "${BUILD_PATHS[@]}" 2>/dev/null || true)"
    if [ -n "$DIRTY" ]; then
        if [ "$ALLOW_DIRTY" = true ]; then
            echo "⚠ Deploying a DIRTY working tree (--allow-dirty). Prod will match no commit:"
            echo "$DIRTY" | sed 's/^/    /'
            echo ""
        else
            echo "ERROR: uncommitted changes in build-affecting paths — refusing to deploy."
            echo "----------------------------------------"
            echo "$DIRTY" | sed 's/^/    /'
            echo ""
            echo "This script builds from the working tree, so these WOULD ship — including"
            echo "another thread's unfinished work — and prod would then match no commit."
            echo ""
            echo "Commit them (explicit pathspecs — see .claude/rules/git-concurrency.md),"
            echo "or re-run with --allow-dirty if shipping them uncommitted is deliberate."
            exit 1
        fi
    fi
    echo "Deploying $(git rev-parse --short HEAD)$(git describe --tags --exact-match HEAD 2>/dev/null | sed 's/^/ (/;s/$/)/')"
    echo ""
fi

# Step 0b: Refuse to ship over a gate that is red, unfinished, or never ran (Known Issue #12).
#
# `main` has gone red and STAYED red five times with nothing announcing it — the worst run
# was 30 consecutive pushes covering three releases and a prod deploy, because a red run is
# visible only to whoever opens the Actions tab. Every instance was caught by someone
# happening to look, which is the same non-control as "harm was nil because someone checked
# afterwards" in Step 0.
#
# Step 0 has already established that the build paths match HEAD, so HEAD is what ships and
# HEAD is what this asks about. The three refusals are one idea — nothing has verified this
# code: red (verified broken), pending (not finished), and no run at all (usually an
# unpushed commit, so CI never saw it).
#
# NOT a refusal: check-ci exit 4, "could not ask GitHub". A gate that blocks a prod deploy
# during a GitHub outage gets bypassed reflexively, and a guard people bypass by habit is
# worse than no guard — the same reasoning that scopes Step 0 to build paths only.
if [ -x "$SCRIPT_DIR/check-ci.sh" ]; then
    echo "Step 0b: Checking CI for the commit being deployed..."
    CI_RC=0
    # --wait, not a bare check: /close pushes and deploys back to back, so CI is normally
    # mid-flight when we arrive here. Refusing that would refuse every release and teach
    # --allow-red-ci as a reflex. It blocks for up to 10 minutes, then reports what it has.
    "$SCRIPT_DIR/check-ci.sh" HEAD --quiet --wait || CI_RC=$?

    case "$CI_RC" in
        0) echo "✓ CI green" ;;
        4) echo "  (deploy continues — unknown is not the same as red)" ;;
        1|2|3)
            case "$CI_RC" in
                1) WHY="CI is RED on this commit" ;;
                2) WHY="CI has not finished on this commit" ;;
                3) WHY="no CI run exists for this commit" ;;
            esac
            if [ "$ALLOW_RED_CI" = true ]; then
                echo "⚠ Deploying anyway (--allow-red-ci): $WHY."
            else
                echo ""
                echo "ERROR: $WHY — refusing to deploy."
                echo "----------------------------------------"
                echo "Nothing has verified what you are about to put in front of prod."
                echo ""
                echo "Fix it, wait for the run, or push the commit so CI can see it —"
                echo "or re-run with --allow-red-ci if shipping unverified is deliberate."
                exit 1
            fi
            ;;
    esac
    echo ""
fi

# Step 1: Backup production database
if [ "$NO_BACKUP" = false ]; then
    echo "Step 1: Backing up production database..."
    echo "----------------------------------------"
    docker exec fin-postgres pg_dump -U fin -d fin -Fc > "$BACKUP_FILE"
    echo "✓ Production database backed up to: $BACKUP_FILE"
    echo "  Size: $(du -h "$BACKUP_FILE" | cut -f1)"
    # ⚠️ RETENTION ADDED 2026-08-30 — there was NONE, so every deploy left another plaintext dump of
    # the production DB here forever: 424 files, 1.5 GB, going back 177 days to 2026-03-03.
    # Found by the homelab's `check-plaintext-dumps` sweep. A pre-deploy snapshot's value EXPIRES at
    # the next successful deploy, so 422 of those could never serve the rollback they exist for --
    # they were simply old plaintext copies of production financial data.
    # Keep current + one back (the rollback path below references $BACKUP_FILE, the newest); anything
    # older restores from the encrypted, restore-tested PBS leg `fin-pg` (pbs1 ns/fin).
    ls -t "$BACKUP_DIR"/fin_backup_*.dump 2>/dev/null | tail -n +3 | xargs -r rm
    echo ""
else
    echo "Step 1: SKIPPED - Database backup disabled"
    echo "----------------------------------------"
    echo "⚠ WARNING: Proceeding without backup!"
    echo ""
fi

# Step 2: Git operations
if [ "$SKIP_GIT" = false ]; then
    echo "Step 2: Git operations..."
    echo "----------------------------------------"

    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD --; then
        echo "Uncommitted changes detected."
        git status --short
        echo ""
        read -p "Commit these changes? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            read -p "Commit message: " COMMIT_MSG
            git add .
            git commit -m "$COMMIT_MSG"
            echo "✓ Changes committed"
        else
            echo "Skipping commit. Deploying current working directory state."
        fi
    else
        echo "No uncommitted changes."
    fi

    # Push to GitHub
    read -p "Push to GitHub? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push origin main
        echo "✓ Pushed to GitHub"
    else
        echo "Skipping GitHub push."
    fi
    echo ""
else
    echo "Step 2: SKIPPED - Git operations disabled"
    echo "----------------------------------------"
    echo ""
fi

# Step 2b: Apply pending DB migrations to the running prod Postgres BEFORE the
# new code deploys (CLAUDE.md rule #6 / CR043 N11). The runner ledgers what it
# applies in schema_migrations; on first run against the already-populated prod
# DB it auto-baselines (records the existing migrations as applied, runs none),
# so this is safe to have always run.
#
# The runner runs on the HOST (node + server/node_modules + working-tree
# migrate.js), so it must use the HOST-reachable DB URL: the prod compose
# publishes Postgres on 127.0.0.1:5433. (Do NOT reuse the container's own
# DATABASE_URL — it names the docker-network host `fin-postgres`, which the
# host can't resolve.) POSTGRES_PASSWORD comes from the untracked .env.
echo "Step 2b: Applying pending database migrations..."
echo "----------------------------------------"

# Step 2b(i): refuse to apply to prod a migration that has never run on dev.
#
# CLAUDE.md's rule is "dev first, then prod before deploying the code". But THIS SCRIPT
# applies the migrations, so any file riding a release reaches prod first BY CONSTRUCTION
# unless someone remembered to run it against dev by hand. Discipline has now failed at
# that three times in one CR: 057 applied with `psql -f` (which does not write the ledger),
# 058/059 applied to dev by hand (leaving dev's ledger stale, so the runner later re-ran
# 058 and was refused by a unique index), and 060 reaching prod first today. That is
# Known Issue #15, and it is structural rather than an oversight.
#
# What dev-first actually buys is not ceremony: CR069 P2's `income_pct` override moved 504
# rows on dev and NOTHING on the prod copy, because prod carried no such override. Dev is
# the only place some data shapes exist. A migration that has not met dev has not met them.
#
# Deliberately NOT a hard failure when dev is simply down — a stopped dev stack must not
# block a production deploy, and a guard that fires for an unrelated reason is one people
# learn to bypass. It fails hard only when dev is REACHABLE and demonstrably missing the
# file, which is the case that carries the risk.
if [ -f server/db/migrate.js ] && [ -d server/db/migrations ]; then
    if docker ps --format '{{.Names}}' | grep -q '^fin-postgres-dev$'; then
        # Pending on prod = files on disk absent from prod's ledger. If prod has no ledger
        # at all the runner baselines (records, runs nothing), so there is nothing to guard.
        if docker exec fin-postgres psql -U fin -d fin -tAc \
             "SELECT to_regclass('schema_migrations')" 2>/dev/null | grep -q .; then
            PROD_APPLIED="$(docker exec fin-postgres psql -U fin -d fin -tAc \
                "SELECT filename FROM schema_migrations" 2>/dev/null || true)"
            DEV_APPLIED="$(docker exec fin-postgres-dev psql -U fin -d fin -tAc \
                "SELECT filename FROM schema_migrations" 2>/dev/null || true)"
            UNVERIFIED=""
            for f in server/db/migrations/*.sql; do
                b="$(basename "$f")"
                grep -qxF "$b" <<<"$PROD_APPLIED" && continue   # already on prod
                grep -qxF "$b" <<<"$DEV_APPLIED"  && continue   # dev has run it
                UNVERIFIED="${UNVERIFIED}${b}"$'\n'
            done
            if [ -n "$UNVERIFIED" ]; then
                if [ "$ALLOW_UNVERIFIED_MIGRATIONS" = true ]; then
                    echo "⚠ Applying migration(s) to prod that have NOT run on dev (--allow-unverified-migrations):"
                    printf '%s' "$UNVERIFIED" | sed 's/^/    /'
                    echo ""
                else
                    echo "ERROR: pending migration(s) have never been applied to dev — refusing to deploy."
                    echo "----------------------------------------"
                    printf '%s' "$UNVERIFIED" | sed 's/^/    /'
                    echo ""
                    echo "Prod would be the FIRST database these ever ran against. Dev holds data"
                    echo "shapes prod does not (CR069 P2: an override that moved 504 rows on dev and"
                    echo "zero on a prod copy), so a file that has not met dev has not been tested."
                    echo ""
                    echo "Apply to dev first, through the runner so the ledger records it:"
                    echo "    DATABASE_URL=\"postgresql://fin:\$POSTGRES_PASSWORD@127.0.0.1:5434/fin\" \\"
                    echo "        node server/db/migrate.js"
                    echo ""
                    echo "Then re-run this deploy. Use --allow-unverified-migrations only when going"
                    echo "to prod first is deliberate (and say why in the migration's registry row)."
                    exit 1
                fi
            else
                echo "✓ Every pending migration has already run on dev"
            fi
        fi
    else
        echo "⚠ dev Postgres (fin-postgres-dev) is not running — cannot confirm pending"
        echo "  migrations have been tested on dev. Continuing; verify by hand if this deploy"
        echo "  carries one."
    fi
fi

if [ -f server/db/migrate.js ]; then
    if [ -f .env ]; then set -a; . ./.env; set +a; fi
    if [ -z "${POSTGRES_PASSWORD:-}" ]; then
        echo "✗ POSTGRES_PASSWORD not set (expected in .env) — cannot reach prod DB for migrations; aborting deploy"
        exit 1
    fi
    DB_URL="postgresql://fin:${POSTGRES_PASSWORD}@127.0.0.1:5433/fin"
    if DATABASE_URL="$DB_URL" node server/db/migrate.js; then
        echo "✓ Migrations up to date"
    else
        echo "✗ Migration runner failed — aborting deploy (schema would mismatch the new code)"
        exit 1
    fi
    echo ""
fi

# Step 3: Rebuild and restart production
echo "Step 3: Deploying to production..."
echo "----------------------------------------"
echo "Rebuilding and restarting production containers..."

echo ""
echo "Building new images..."
# Version is read from .env by docker-compose.yml build args
VERSION=$(cat VERSION)
echo "Building with version: $VERSION"

# Ensure .env is in sync with VERSION file (in place, preserving other vars)
if ! grep -q "VITE_APP_VERSION=$VERSION" .env 2>/dev/null; then
    echo "Syncing .env with VERSION file..."
    if [ -f .env ] && grep -q '^VITE_APP_VERSION=' .env; then
        sed -i.bak "s/^VITE_APP_VERSION=.*/VITE_APP_VERSION=$VERSION/" .env && rm -f .env.bak
    elif [ -f .env ]; then
        printf 'VITE_APP_VERSION=%s\n' "$VERSION" >> .env
    else
        printf '# Managed by deploy/bump scripts — VITE_APP_VERSION auto-updated; other vars preserved\nVITE_APP_VERSION=%s\n' "$VERSION" > .env
    fi
fi

# Stamp the commit into both images (Known Issue #17). The guard above means GIT_DIRTY is
# "false" on a normal deploy; with --allow-dirty it records "true", which is the honest label
# for an image that corresponds to no commit.
if git rev-parse --git-dir >/dev/null 2>&1; then
    GIT_SHA="$(git rev-parse HEAD)"
    if [ -n "$(git status --porcelain -- "${BUILD_PATHS[@]}" 2>/dev/null || true)" ]; then
        GIT_DIRTY=true
    else
        GIT_DIRTY=false
    fi
else
    GIT_SHA=unknown
    GIT_DIRTY=unknown
fi
export GIT_SHA GIT_DIRTY
echo "Stamping images with commit: ${GIT_SHA:0:12} (dirty: $GIT_DIRTY)"

docker compose build --no-cache

echo ""
echo "Restarting production services..."
# Only restart server and frontend — postgres stays running
docker rm -f fin-server fin-frontend 2>/dev/null || true
docker compose up -d --no-deps server frontend

# Ensure all containers are on the same network as postgres
POSTGRES_NET=$(docker inspect fin-postgres --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null | head -1)
if [ -n "$POSTGRES_NET" ]; then
    docker network connect "$POSTGRES_NET" fin-server 2>/dev/null || true
    docker network connect "$POSTGRES_NET" fin-frontend 2>/dev/null || true
fi

echo ""
echo "Waiting for services to be healthy..."
sleep 10

# Step 4: Verify deployment
echo ""
echo "Step 4: Verifying deployment..."
echo "----------------------------------------"

# Check container health
CONTAINERS=("fin-postgres" "fin-server" "fin-frontend")
ALL_HEALTHY=true

for container in "${CONTAINERS[@]}"; do
    if docker ps --format '{{.Names}} {{.Status}}' | grep "$container" | grep -q "(healthy)"; then
        echo "✓ $container is healthy"
    else
        echo "✗ $container is NOT healthy"
        ALL_HEALTHY=false
    fi
done

echo ""

# Test API endpoint
if curl -f -s http://localhost:3005/api/v2/health > /dev/null; then
    echo "✓ API health check passed"
else
    echo "✗ API health check failed"
    ALL_HEALTHY=false
fi

# Test frontend
if curl -f -s http://localhost:3006 > /dev/null; then
    echo "✓ Frontend is accessible"
else
    echo "✗ Frontend is not accessible"
    ALL_HEALTHY=false
fi

# Read the provenance back OUT of the running containers (Known Issue #17). Reading it from
# the image rather than trusting the variable we just exported is the point: it proves what is
# actually running, which is the question the 2026-08-03 incident could not answer.
echo ""
for c in fin-server fin-frontend; do
    LBL_SHA="$(docker inspect "$c" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || echo "")"
    LBL_DIRTY="$(docker inspect "$c" --format '{{index .Config.Labels "com.fin.build.dirty"}}' 2>/dev/null || echo "")"
    if [ -z "$LBL_SHA" ] || [ "$LBL_SHA" = "unknown" ]; then
        echo "⚠ $c carries no build commit (pre-provenance image, or built outside this script)"
    elif [ "$LBL_SHA" != "$GIT_SHA" ]; then
        echo "✗ $c is running ${LBL_SHA:0:12}, not the ${GIT_SHA:0:12} just built"
        ALL_HEALTHY=false
    elif [ "$LBL_DIRTY" = "true" ]; then
        echo "⚠ $c built from a DIRTY tree at ${LBL_SHA:0:12} — it matches no commit"
    else
        echo "✓ $c is running ${LBL_SHA:0:12}"
    fi
done

echo ""

if [ "$ALL_HEALTHY" = true ]; then
    echo "=========================================="
    echo "  ✓ Deployment Successful!"
    echo "=========================================="
    echo ""
    echo "Production is now running with the latest changes."
    echo ""
    echo "Access URLs:"
    echo "  Tailscale: https://fin.tail413695.ts.net"
    echo "  Local:     https://192.168.1.82:5175"
    echo ""
    if [ "$NO_BACKUP" = false ]; then
        echo "Backup saved at: $BACKUP_FILE"
        echo "Keep this backup until you've verified everything works."
    fi
    echo "=========================================="

    # Mirror version across all version files
    echo ""
    echo "Mirroring version $VERSION across all files..."
    "$SCRIPT_DIR/bump-version.sh" "$VERSION"
else
    echo "=========================================="
    echo "  ⚠ Deployment Issues Detected!"
    echo "=========================================="
    echo ""
    echo "Some services are not healthy. Check logs:"
    echo "  docker compose logs -f"
    echo ""
    if [ "$NO_BACKUP" = false ]; then
        echo "If you need to rollback:"
        echo "  docker compose down"
        echo "  docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists < $BACKUP_FILE"
        echo "  docker compose up -d"
    fi
    echo "=========================================="
    exit 1
fi
