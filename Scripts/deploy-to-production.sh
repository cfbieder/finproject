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
# Usage: ./deploy-to-production.sh [--skip-git] [--no-backup]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

SKIP_GIT=true  # Skip git by default - handle manually
NO_BACKUP=false
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
        --help|-h)
            echo "Usage: $0 [--with-git] [--no-backup]"
            echo ""
            echo "Options:"
            echo "  --with-git    Enable git commit and push (skipped by default)"
            echo "  --no-backup   Skip database backup (not recommended)"
            echo "  --help        Show this help message"
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

# Step 1: Backup production database
if [ "$NO_BACKUP" = false ]; then
    echo "Step 1: Backing up production database..."
    echo "----------------------------------------"
    docker exec fin-postgres pg_dump -U fin -d fin -Fc > "$BACKUP_FILE"
    echo "✓ Production database backed up to: $BACKUP_FILE"
    echo "  Size: $(du -h "$BACKUP_FILE" | cut -f1)"
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

# Step 3: Rebuild and restart production
echo "Step 3: Deploying to production..."
echo "----------------------------------------"
echo "This will rebuild and restart production containers."
read -p "Continue with deployment? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    if [ "$NO_BACKUP" = false ]; then
        echo "Backup preserved at: $BACKUP_FILE"
    fi
    exit 0
fi

echo ""
echo "Building new images..."
# Read VERSION file and pass to Docker build
VERSION=$(cat VERSION)
echo "Building with version: $VERSION"
docker compose build --no-cache \
  --build-arg VITE_APP_VERSION="$VERSION" \
  --build-arg VITE_APP_MODE="prod" \
  --build-arg VITE_APP_API=""

echo ""
echo "Restarting production services..."
docker compose up -d

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
