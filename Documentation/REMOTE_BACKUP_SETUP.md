# Remote Backup Setup Guide

Reusable guide for setting up automated backups of a Docker/PostgreSQL project to a remote Linux host via SSH + cron.

---

## Prerequisites

- Source machine: Linux with Docker, bash, ssh, scp, tar
- Remote machine: Linux with SSH key-only auth
- Both machines on the same network (or reachable via SSH)

---

## 1. SSH Key Setup

On the **source machine** (where the project runs):

```bash
# Generate key pair (skip if you already have one)
ssh-keygen -t ed25519 -N ""

# Trust the remote host
ssh-keyscan -H <REMOTE_IP> >> ~/.ssh/known_hosts

# Show your public key
cat ~/.ssh/id_ed25519.pub
```

On the **remote machine**, append the public key:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<PASTE_PUBLIC_KEY_HERE>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

If the remote only allows key auth (no password login), you'll need console access or another SSH session to paste the key.

Verify from the source machine:

```bash
ssh <REMOTE_USER>@<REMOTE_IP> "echo 'SSH OK'"
```

---

## 2. Create the Backup Script

Save as `Scripts/backup-to-remote.sh` in your project. Customize the configuration block at the top.

```bash
#!/bin/bash
# ============================================================================
# backup-to-remote.sh — Backup database + config to remote host
#
# Usage:
#   ./Scripts/backup-to-remote.sh           # normal run
#   ./Scripts/backup-to-remote.sh --dry-run # show what would be done
# ============================================================================

set -euo pipefail

# --- Configuration (EDIT THESE) ---
PROJECT_DIR="/home/<USER>/<PROJECT>"        # e.g. /home/cfbieder/psproject
REMOTE_HOST="<REMOTE_IP>"                   # e.g. 192.168.1.252
REMOTE_USER="<REMOTE_USER>"                 # e.g. cfbieder
REMOTE_DIR="/home/<REMOTE_USER>/backups/<PROJECT_NAME>"  # e.g. /home/cfbieder/backups/fin
DB_CONTAINER_PROD="<PROD_DB_CONTAINER>"     # e.g. fin-postgres
DB_CONTAINER_DEV="<DEV_DB_CONTAINER>"       # e.g. fin-postgres-dev
DB_USER="<DB_USER>"                         # e.g. fin
DB_NAME="<DB_NAME>"                         # e.g. fin
RETENTION_DAYS=30
# --- End Configuration ---

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="${DB_NAME}_backup_${TIMESTAMP}"
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

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER_PROD}$"; then
    if docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER_DEV}$"; then
        DB_CONTAINER="$DB_CONTAINER_DEV"
        log "WARN: Using dev database (${DB_CONTAINER_DEV}) — production container not running"
    else
        log "ERROR: No PostgreSQL container running"
        exit 1
    fi
else
    DB_CONTAINER="$DB_CONTAINER_PROD"
fi

if $DRY_RUN; then
    log "DRY RUN — would back up to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/${BACKUP_NAME}/"
    log "  Database from container: ${DB_CONTAINER}"
    log "  Retention: ${RETENTION_DAYS} days"
    exit 0
fi

# --- Create staging directory ---
mkdir -p "$LOCAL_TMP/$BACKUP_NAME"
mkdir -p "$(dirname "$LOG_FILE")"

log "Starting backup: ${BACKUP_NAME}"

# --- 1. Database dump ---
log "Dumping PostgreSQL from ${DB_CONTAINER}..."
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc \
    > "$LOCAL_TMP/$BACKUP_NAME/database.dump" 2>> "$LOG_FILE"
log "  Database dump: $(du -h "$LOCAL_TMP/$BACKUP_NAME/database.dump" | cut -f1)"

# --- 2. Environment files ---
log "Copying environment files..."
for f in .env frontend/.env-cmdrc server/.env-cmdrc; do
    if [[ -f "$PROJECT_DIR/$f" ]]; then
        DEST_NAME=$(echo "$f" | tr '/' '-' | sed 's/^\./-dot-/' | sed 's/^-//')
        cp "$PROJECT_DIR/$f" "$LOCAL_TMP/$BACKUP_NAME/$DEST_NAME"
    fi
done

# --- 3. Additional directories (customize as needed) ---
# Add any non-git directories that contain important data.
# Comment out or add lines as needed for your project.
for dir in components/data certs; do
    if [[ -d "$PROJECT_DIR/$dir" ]]; then
        DEST_NAME=$(echo "$dir" | tr '/' '-')
        log "Copying ${dir}/..."
        cp -r "$PROJECT_DIR/$dir" "$LOCAL_TMP/$BACKUP_NAME/$DEST_NAME"
    fi
done

# --- 4. Create tarball ---
log "Creating tarball..."
tar -czf "$LOCAL_TMP/${BACKUP_NAME}.tar.gz" -C "$LOCAL_TMP" "$BACKUP_NAME"
TARBALL_SIZE=$(du -h "$LOCAL_TMP/${BACKUP_NAME}.tar.gz" | cut -f1)
log "  Tarball size: ${TARBALL_SIZE}"

# --- 5. Transfer to remote ---
log "Transferring to ${REMOTE_HOST}..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR}"
scp -q "$LOCAL_TMP/${BACKUP_NAME}.tar.gz" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
log "  Transfer complete"

# --- 6. Clean up old backups on remote ---
log "Cleaning backups older than ${RETENTION_DAYS} days on remote..."
DELETED=$(ssh "${REMOTE_USER}@${REMOTE_HOST}" \
    "find ${REMOTE_DIR} -name '${DB_NAME}_backup_*.tar.gz' -mtime +${RETENTION_DAYS} -delete -print | wc -l")
log "  Removed ${DELETED} old backup(s)"

# --- 7. Verify ---
REMOTE_COUNT=$(ssh "${REMOTE_USER}@${REMOTE_HOST}" \
    "ls -1 ${REMOTE_DIR}/${DB_NAME}_backup_*.tar.gz 2>/dev/null | wc -l")
log "Backup complete. ${REMOTE_COUNT} backup(s) on remote. Size: ${TARBALL_SIZE}"
log "---"
```

Make it executable:

```bash
chmod +x Scripts/backup-to-remote.sh
```

---

## 3. Test

```bash
# Dry run first
./Scripts/backup-to-remote.sh --dry-run

# Real run
./Scripts/backup-to-remote.sh

# Verify on remote
ssh <REMOTE_USER>@<REMOTE_IP> "ls -lh /home/<REMOTE_USER>/backups/<PROJECT_NAME>/"
```

---

## 4. Schedule with Crontab

```bash
# Edit crontab
crontab -e

# Add one of these lines:
# Every 2 days at 2 AM:
0 2 */2 * * /home/<USER>/<PROJECT>/Scripts/backup-to-remote.sh >> /home/<USER>/<PROJECT>/Backups/backup-remote.log 2>&1

# Daily at 2 AM:
0 2 * * * /home/<USER>/<PROJECT>/Scripts/backup-to-remote.sh >> /home/<USER>/<PROJECT>/Backups/backup-remote.log 2>&1

# Weekly on Sunday at 2 AM:
0 2 * * 0 /home/<USER>/<PROJECT>/Scripts/backup-to-remote.sh >> /home/<USER>/<PROJECT>/Backups/backup-remote.log 2>&1
```

Verify:

```bash
crontab -l
```

---

## 5. Restore from Remote Backup

```bash
# List available backups
ssh <REMOTE_USER>@<REMOTE_IP> "ls -lh /home/<REMOTE_USER>/backups/<PROJECT_NAME>/"

# Download a specific backup
scp <REMOTE_USER>@<REMOTE_IP>:/home/<REMOTE_USER>/backups/<PROJECT_NAME>/<BACKUP_FILE>.tar.gz .

# Extract
tar xzf <BACKUP_FILE>.tar.gz

# Restore database
docker exec -i <DB_CONTAINER> pg_restore -U <DB_USER> -d <DB_NAME> --clean --if-exists < <BACKUP_DIR>/database.dump

# Restore env and data files (adjust paths for your project)
cp <BACKUP_DIR>/dot-env /path/to/project/.env
cp -r <BACKUP_DIR>/components-data/* /path/to/project/components/data/
cp -r <BACKUP_DIR>/certs/* /path/to/project/certs/
```

---

## 6. Customization Checklist

When adapting for a new project, update these in the script's configuration block:

- [ ] `PROJECT_DIR` — absolute path to the project
- [ ] `REMOTE_HOST` / `REMOTE_USER` / `REMOTE_DIR` — remote target
- [ ] `DB_CONTAINER_PROD` / `DB_CONTAINER_DEV` — Docker container names
- [ ] `DB_USER` / `DB_NAME` — PostgreSQL credentials
- [ ] `RETENTION_DAYS` — how long to keep backups
- [ ] Additional directories section — add/remove dirs to back up
- [ ] Crontab schedule — adjust frequency

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot SSH` | Run `ssh -v <user>@<host>` to debug. Check `~/.ssh/authorized_keys` on remote |
| `No PostgreSQL container` | Check `docker ps`. Ensure container name matches config |
| `Permission denied (scp)` | Check remote directory permissions: `chmod 755 /home/<user>/backups` |
| `Cron not running` | Check `systemctl status cron`. View syslog: `grep CRON /var/log/syslog` |
| `Old backups not cleaning` | Verify `find` works: `ssh <host> "find <dir> -name '*.tar.gz' -mtime +30"` |
