#!/bin/bash
# MongoDB Restore Script for Docker Container
# Usage: ./restore-mongo.sh <backup_directory>

set -e

# Configuration
CONTAINER_NAME="mongofin"

# Check if backup directory is provided
if [ -z "$1" ]; then
    echo "Error: Backup directory not specified"
    echo ""
    echo "Usage: $0 <backup_directory>"
    echo ""
    echo "Available backups:"
    ls -1dt /home/cfbieder/Programs/fin/mongo_backups/backup_* 2>/dev/null | head -5 | nl -w2 -s'. '
    exit 1
fi

BACKUP_DIR="$1"

# Check if backup directory exists
if [ ! -d "${BACKUP_DIR}" ]; then
    echo "Error: Backup directory '${BACKUP_DIR}' does not exist"
    exit 1
fi

echo "WARNING: This will DROP all existing data and restore from backup!"
echo "Backup: ${BACKUP_DIR}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "${CONFIRM}" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

TEMP_RESTORE_PATH="/tmp/restore_$(date +%Y%m%d_%H%M%S)"

echo ""
echo "Starting MongoDB restore..."

# Copy backup to container
echo "Copying backup to container..."
docker cp "${BACKUP_DIR}" ${CONTAINER_NAME}:${TEMP_RESTORE_PATH}

# Restore backup
echo "Restoring database..."
docker exec ${CONTAINER_NAME} mongorestore --port 27018 --drop ${TEMP_RESTORE_PATH}

# Clean up container
echo "Cleaning up container..."
docker exec ${CONTAINER_NAME} rm -rf ${TEMP_RESTORE_PATH}

echo ""
echo "✓ Restore completed successfully!"
echo ""

# Display document counts
echo "Document counts after restore:"
docker exec ${CONTAINER_NAME} mongosh --port 27018 fin --quiet --eval "
  db.getCollectionNames().forEach(function(col) {
    var count = db.getCollection(col).countDocuments({});
    if (count > 0) {
      print('  - ' + col + ': ' + count);
    }
  });
"
