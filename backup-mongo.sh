#!/bin/bash
# MongoDB Backup Script for Docker Container
# Usage: ./backup-mongo.sh

set -e

# Configuration
CONTAINER_NAME="mongofin"
BACKUP_DIR="/home/cfbieder/Programs/fin/mongo_backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="backup_${TIMESTAMP}"
TEMP_BACKUP_PATH="/tmp/${BACKUP_NAME}"

echo "Starting MongoDB backup..."

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

# Create backup inside container
echo "Creating backup in container..."
docker exec ${CONTAINER_NAME} mongodump --port 27018 --out ${TEMP_BACKUP_PATH}

# Copy backup to host
echo "Copying backup to host..."
docker cp ${CONTAINER_NAME}:${TEMP_BACKUP_PATH} ${BACKUP_DIR}/${BACKUP_NAME}

# Clean up container backup
echo "Cleaning up container..."
docker exec ${CONTAINER_NAME} rm -rf ${TEMP_BACKUP_PATH}

# Display results
echo ""
echo "✓ Backup completed successfully!"
echo "  Location: ${BACKUP_DIR}/${BACKUP_NAME}"
echo "  Size: $(du -sh ${BACKUP_DIR}/${BACKUP_NAME} | cut -f1)"
echo ""

# List backup contents
echo "Backup contents:"
ls -lh ${BACKUP_DIR}/${BACKUP_NAME}/fin/ | grep -E '\.bson$' | awk '{printf "  - %-20s %8s\n", $9, $5}'

echo ""
echo "To restore this backup, run:"
echo "  docker exec -i ${CONTAINER_NAME} mongorestore --port 27018 --drop /path/to/backup"
