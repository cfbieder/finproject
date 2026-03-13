#!/bin/bash
# ============================================================================
# backup-to-remote.sh — Backup database + config to remote host
#
# Backs up:
#   - PostgreSQL database (pg_dump)
#   - .env file (API keys, secrets)
#   - components/data/ (runtime data, forecast assumptions)
#   - certs/ (TLS certificates)
#
# Also prunes Docker resources older than 48h:
#   - Build cache, dangling images, stopped containers, unused networks
#
# Runs every 2 days via crontab. Retains 30 days of backups on remote.
#
# Usage:
#   ./Scripts/backup-to-remote.sh           # normal run
#   ./Scripts/backup-to-remote.sh --dry-run # show what would be done
# ============================================================================

set -euo pipefail

# --- Configuration ---
PROJECT_DIR="/home/cfbieder/psproject"
REMOTE_HOST="192.168.1.252"
REMOTE_USER="cfbieder"
REMOTE_DIR="/home/cfbieder/backups/fin"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="fin_backup_${TIMESTAMP}"
LOCAL_TMP="${PROJECT_DIR}/Backups/.remote_staging"
LOG_FILE="${PROJECT_DIR}/Backups/backup-remote.log"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# --- Functions ---
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE"
}

cleanup() {
    rm -rf "$LOCAL_TMP"
}
trap cleanup EXIT

# --- Pre-flight checks ---
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "${REMOTE_USER}@${REMOTE_HOST}" true 2>/dev/null; then
    log "ERROR: Cannot SSH to ${REMOTE_USER}@${REMOTE_HOST} — check key auth"
    exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q '^fin-postgres$'; then
    # Production container not running, try dev
    if docker ps --format '{{.Names}}' | grep -q '^fin-postgres-dev$'; then
        DB_CONTAINER="fin-postgres-dev"
        log "WARN: Using dev database (fin-postgres-dev) — production container not running"
    else
        log "ERROR: No PostgreSQL container running"
        exit 1
    fi
else
    DB_CONTAINER="fin-postgres"
fi

if $DRY_RUN; then
    log "DRY RUN — would back up to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/${BACKUP_NAME}/"
    log "  Database from container: ${DB_CONTAINER}"
    log "  Files: .env, components/data/, certs/"
    log "  Retention: ${RETENTION_DAYS} days"
    exit 0
fi

# --- Create staging directory ---
mkdir -p "$LOCAL_TMP/$BACKUP_NAME"
mkdir -p "$(dirname "$LOG_FILE")"

log "Starting backup: ${BACKUP_NAME}"

# --- 1. Database dump ---
log "Dumping PostgreSQL from ${DB_CONTAINER}..."
docker exec "$DB_CONTAINER" pg_dump -U fin -d fin -Fc \
    > "$LOCAL_TMP/$BACKUP_NAME/database.dump" 2>> "$LOG_FILE"
log "  Database dump: $(du -h "$LOCAL_TMP/$BACKUP_NAME/database.dump" | cut -f1)"

# --- 2. Environment files ---
log "Copying environment files..."
if [[ -f "$PROJECT_DIR/.env" ]]; then
    cp "$PROJECT_DIR/.env" "$LOCAL_TMP/$BACKUP_NAME/dot-env"
fi
if [[ -f "$PROJECT_DIR/frontend/.env-cmdrc" ]]; then
    cp "$PROJECT_DIR/frontend/.env-cmdrc" "$LOCAL_TMP/$BACKUP_NAME/frontend-env-cmdrc.json"
fi
if [[ -f "$PROJECT_DIR/server/.env-cmdrc" ]]; then
    cp "$PROJECT_DIR/server/.env-cmdrc" "$LOCAL_TMP/$BACKUP_NAME/server-env-cmdrc.json"
fi

# --- 3. Runtime data files ---
log "Copying components/data/..."
if [[ -d "$PROJECT_DIR/components/data" ]]; then
    cp -r "$PROJECT_DIR/components/data" "$LOCAL_TMP/$BACKUP_NAME/components-data"
fi

# --- 4. TLS certificates ---
log "Copying certs/..."
if [[ -d "$PROJECT_DIR/certs" ]]; then
    cp -r "$PROJECT_DIR/certs" "$LOCAL_TMP/$BACKUP_NAME/certs"
fi

# --- 5. Create tarball ---
log "Creating tarball..."
tar -czf "$LOCAL_TMP/${BACKUP_NAME}.tar.gz" -C "$LOCAL_TMP" "$BACKUP_NAME"
TARBALL_SIZE=$(du -h "$LOCAL_TMP/${BACKUP_NAME}.tar.gz" | cut -f1)
log "  Tarball size: ${TARBALL_SIZE}"

# --- 6. Transfer to remote ---
log "Transferring to ${REMOTE_HOST}..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR}"
scp -q "$LOCAL_TMP/${BACKUP_NAME}.tar.gz" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
log "  Transfer complete"

# --- 7. Clean up old backups on remote ---
log "Cleaning backups older than ${RETENTION_DAYS} days on remote..."
DELETED=$(ssh "${REMOTE_USER}@${REMOTE_HOST}" \
    "find ${REMOTE_DIR} -name 'fin_backup_*.tar.gz' -mtime +${RETENTION_DAYS} -delete -print | wc -l")
log "  Removed ${DELETED} old backup(s)"

# --- 8. Docker cleanup (items older than 48h) ---
log "Pruning Docker build cache older than 48h..."
docker builder prune --filter "until=48h" -f >> "$LOG_FILE" 2>&1
log "Pruning dangling images older than 48h..."
docker image prune --filter "until=48h" -f >> "$LOG_FILE" 2>&1
log "Pruning stopped containers older than 48h..."
docker container prune --filter "until=48h" -f >> "$LOG_FILE" 2>&1
log "Pruning unused networks older than 48h..."
docker network prune --filter "until=48h" -f >> "$LOG_FILE" 2>&1
log "  Docker cleanup complete"

# --- 9. Verify ---
REMOTE_COUNT=$(ssh "${REMOTE_USER}@${REMOTE_HOST}" \
    "ls -1 ${REMOTE_DIR}/fin_backup_*.tar.gz 2>/dev/null | wc -l")
log "Backup complete. ${REMOTE_COUNT} backup(s) on remote. Size: ${TARBALL_SIZE}"
log "---"
