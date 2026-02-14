#!/usr/bin/env bash
#
# dev-start.sh — Start development environment in tmux
#
# This script creates a tmux session with:
# - Window 1: Database (docker-compose logs)
# - Window 2: Backend (npm run dev with nodemon)
# - Window 3: Frontend (npm run dev with hot reload)
#
set -euo pipefail

SESSION_NAME="fin-dev"
PROJECT_DIR="$HOME/Programs/fin"

# Check if session already exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Session '$SESSION_NAME' already exists."
    echo "Attaching to existing session..."
    tmux attach-session -t "$SESSION_NAME"
    exit 0
fi

echo "Starting Fin development environment in tmux..."
echo ""

# Start database first
cd "$PROJECT_DIR"
echo "Starting development database..."
docker compose -f docker-compose.dev.yml up -d fin-postgres-dev
sleep 2

# Create new tmux session
tmux new-session -d -s "$SESSION_NAME" -n "database" -c "$PROJECT_DIR"

# Window 1: Database logs
tmux send-keys -t "$SESSION_NAME:database" "docker compose -f docker-compose.dev.yml logs -f fin-postgres-dev" C-m

# Window 2: Backend
tmux new-window -t "$SESSION_NAME" -n "backend" -c "$PROJECT_DIR/server"
tmux send-keys -t "$SESSION_NAME:backend" "# Backend with nodemon (auto-restart)" C-m
tmux send-keys -t "$SESSION_NAME:backend" "npm run dev" C-m

# Window 3: Frontend
tmux new-window -t "$SESSION_NAME" -n "frontend" -c "$PROJECT_DIR/frontend"
tmux send-keys -t "$SESSION_NAME:frontend" "# Frontend with hot reload (Tailscale → local backend on port 3105)" C-m
tmux send-keys -t "$SESSION_NAME:frontend" "npm run tail" C-m

# Window 4: Shell for commands
tmux new-window -t "$SESSION_NAME" -n "shell" -c "$PROJECT_DIR"
tmux send-keys -t "$SESSION_NAME:shell" "# Development shell" C-m
tmux send-keys -t "$SESSION_NAME:shell" "echo 'Quick commands:'" C-m
tmux send-keys -t "$SESSION_NAME:shell" "echo '  ./Scripts/sync-db-prod-to-dev.sh  - Sync production data'" C-m
tmux send-keys -t "$SESSION_NAME:shell" "echo '  ./Scripts/bump-version.sh patch   - Increment version'" C-m
tmux send-keys -t "$SESSION_NAME:shell" "echo '  ./Scripts/deploy-to-production.sh - Deploy when ready'" C-m
tmux send-keys -t "$SESSION_NAME:shell" "echo ''" C-m

# Select frontend window
tmux select-window -t "$SESSION_NAME:frontend"

# Attach to session
echo ""
echo "✓ Development environment started!"
echo ""
echo "Tmux session: $SESSION_NAME"
echo "Windows:"
echo "  1. database  - Database logs"
echo "  2. backend   - Backend (nodemon)"
echo "  3. frontend  - Frontend (hot reload)"
echo "  4. shell     - Command shell"
echo ""
echo "Tmux commands:"
echo "  Ctrl+b n     - Next window"
echo "  Ctrl+b p     - Previous window"
echo "  Ctrl+b 1-4   - Switch to window number"
echo "  Ctrl+b d     - Detach (keeps running)"
echo "  Ctrl+b [     - Scroll mode (q to exit)"
echo ""
echo "Access application at: http://100.100.162.49:5174 (via Tailscale)"
echo ""
echo "Attaching to session..."
sleep 2
tmux attach-session -t "$SESSION_NAME"
