#!/usr/bin/env bash
#
# bump-version.sh — Increment version number for Fin application
#
# Usage:
#   ./bump-version.sh patch    # 2.0.0 → 2.0.1
#   ./bump-version.sh minor    # 2.0.0 → 2.1.0
#   ./bump-version.sh major    # 2.0.0 → 3.0.0
#   ./bump-version.sh 2.1.5    # Set specific version
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

VERSION_FILE="VERSION"
FRONTEND_ENV="frontend/.env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Read current version
if [ ! -f "$VERSION_FILE" ]; then
    echo -e "${RED}Error: VERSION file not found${NC}"
    exit 1
fi

CURRENT_VERSION=$(cat "$VERSION_FILE")
echo -e "${YELLOW}Current version: ${CURRENT_VERSION}${NC}"

# Parse version
if [[ ! $CURRENT_VERSION =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    echo -e "${RED}Error: Invalid version format in VERSION file${NC}"
    echo "Expected format: X.Y.Z (e.g., 2.0.0)"
    exit 1
fi

MAJOR="${BASH_REMATCH[1]}"
MINOR="${BASH_REMATCH[2]}"
PATCH="${BASH_REMATCH[3]}"

# Determine new version
if [ $# -eq 0 ]; then
    echo "Usage: $0 <major|minor|patch|X.Y.Z>"
    echo ""
    echo "Examples:"
    echo "  $0 patch    # $CURRENT_VERSION → $MAJOR.$MINOR.$((PATCH + 1))"
    echo "  $0 minor    # $CURRENT_VERSION → $MAJOR.$((MINOR + 1)).0"
    echo "  $0 major    # $CURRENT_VERSION → $((MAJOR + 1)).0.0"
    echo "  $0 2.1.5    # Set specific version"
    exit 0
fi

case "$1" in
    major)
        NEW_VERSION="$((MAJOR + 1)).0.0"
        ;;
    minor)
        NEW_VERSION="$MAJOR.$((MINOR + 1)).0"
        ;;
    patch)
        NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
        ;;
    *)
        # Check if it's a valid version number
        if [[ $1 =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
            NEW_VERSION="$1"
        else
            echo -e "${RED}Error: Invalid argument '$1'${NC}"
            echo "Use: major, minor, patch, or a version number (e.g., 2.1.0)"
            exit 1
        fi
        ;;
esac

echo -e "${GREEN}New version: ${NEW_VERSION}${NC}"
echo ""
echo "This will:"
echo "  1. Update version files (VERSION, .env, frontend/.env)"
#echo "  2. Create git commit: \"chore: bump version to $NEW_VERSION\""
#echo "  3. Create git tag: v${NEW_VERSION}"
echo ""

echo "Proceeding..."

# Update VERSION file
echo "$NEW_VERSION" > "$VERSION_FILE"
echo "✓ Updated VERSION file"

# Update root .env (used by docker-compose for build args).
# Edit the VITE_APP_VERSION line in place so manually-added vars
# (e.g. BANK_FEED_URL / BANK_FEED_API_KEY) survive a version bump.
if [ -f "$PROJECT_DIR/.env" ] && grep -q '^VITE_APP_VERSION=' "$PROJECT_DIR/.env"; then
    sed -i.bak "s/^VITE_APP_VERSION=.*/VITE_APP_VERSION=$NEW_VERSION/" "$PROJECT_DIR/.env"
    rm -f "$PROJECT_DIR/.env.bak"
elif [ -f "$PROJECT_DIR/.env" ]; then
    printf 'VITE_APP_VERSION=%s\n' "$NEW_VERSION" >> "$PROJECT_DIR/.env"
else
    printf '# Managed by bump-version.sh — VITE_APP_VERSION auto-updated; other vars preserved\nVITE_APP_VERSION=%s\n' "$NEW_VERSION" > "$PROJECT_DIR/.env"
fi
echo "✓ Updated .env (VITE_APP_VERSION; other vars preserved)"

# Update frontend/.env (Vite watches this file and auto-restarts dev server)
cat > "$PROJECT_DIR/$FRONTEND_ENV" << EOF
# Auto-updated by bump-version.sh — Vite watches this file and auto-restarts
VITE_APP_VERSION=$NEW_VERSION
EOF
echo "✓ Updated $FRONTEND_ENV (Vite auto-restarts)"

# Update package.json files if they exist
for pkg in package.json frontend/package.json server/package.json; do
    if [ -f "$pkg" ]; then
        sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/g" "$pkg"
        echo "✓ Updated $pkg"
    fi
done

# Git commit and tag
# git add VERSION "$FRONTEND_ENV" package.json frontend/package.json server/package.json 2>/dev/null || true
# git commit -m "chore: bump version to $NEW_VERSION" || echo "Note: Some files may not exist or already committed"
# echo -e "${GREEN}✓ Git commit created${NC}"

# git tag -a "v${NEW_VERSION}" -m "Version ${NEW_VERSION}"
# echo -e "${GREEN}✓ Git tag created: v${NEW_VERSION}${NC}"

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Dev: Version updates automatically (Vite watches frontend/.env)"
echo "2. Production: ./Scripts/deploy-to-production.sh"
echo ""
