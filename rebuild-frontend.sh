#!/bin/bash
# Rebuild and restart the frontend container

set -e

echo "Rebuilding frontend..."
docker compose build frontend

echo "Restarting frontend container..."
docker compose up -d frontend

echo "Done! Frontend is now running with latest changes."
echo ""
docker compose ps frontend
