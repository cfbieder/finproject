# tmux Development Guide

## Quick Start

```bash
# Start development environment (creates tmux session automatically)
./Scripts/dev-start.sh
```

This creates a tmux session with 4 windows:
1. **database** - Database logs
2. **backend** - Backend with nodemon (auto-restart)
3. **frontend** - Frontend with hot reload
4. **shell** - Command shell

Access your app at: **http://localhost:5174**

---

## tmux Basics

### Navigation

| Command | Action |
|---------|--------|
| `Ctrl+b n` | Next window |
| `Ctrl+b p` | Previous window |
| `Ctrl+b 1` | Go to window 1 (database) |
| `Ctrl+b 2` | Go to window 2 (backend) |
| `Ctrl+b 3` | Go to window 3 (frontend) |
| `Ctrl+b 4` | Go to window 4 (shell) |
| `Ctrl+b d` | Detach (keeps running in background) |
| `Ctrl+b [` | Scroll mode (press `q` to exit) |

### Session Management

```bash
# List sessions
tmux ls

# Attach to existing session
tmux attach -t fin-dev

# Kill session (stop everything)
tmux kill-session -t fin-dev
```

---

## Workflow

### Starting Development

```bash
# Option 1: Use tmux (recommended)
./Scripts/dev-start.sh

# Option 2: Manual (if you prefer separate terminals)
docker compose -f docker-compose.dev.yml up -d fin-postgres-dev
cd server && npm run dev &
cd frontend && npm run dev
```

### Working in tmux

1. **Frontend changes** (Window 3)
   - Edit files in `frontend/src/`
   - Save → Changes appear instantly
   - No action needed

2. **Backend changes** (Window 2)
   - Edit files in `server/src/`
   - Save → nodemon auto-restarts (~2-3 seconds)
   - Watch window for restart confirmation

3. **View logs** (Windows 1-3)
   - Switch between windows to see different logs
   - Use `Ctrl+b [` to scroll through logs

4. **Run commands** (Window 4)
   - Sync database: `./Scripts/sync-db-prod-to-dev.sh`
   - Bump version: `./Scripts/bump-version.sh patch`
   - Deploy: `./Scripts/deploy-to-production.sh`

### Stopping Development

```bash
# Option 1: Detach and leave running
Ctrl+b d

# Option 2: Stop all services
tmux kill-session -t fin-dev
docker compose -f docker-compose.dev.yml down
```

---

## Version Management in tmux

From the shell window (Window 4):

```bash
# View current version
cat VERSION

# Increment version
./Scripts/bump-version.sh patch

# Changes will appear after frontend hot reload
```

---

## Tips & Tricks

### Keep Session Running

Detach from tmux without stopping:
```bash
Ctrl+b d
```

Your development environment keeps running in the background. Reattach anytime:
```bash
tmux attach -t fin-dev
```

### View Multiple Windows at Once

Split a window:
```bash
Ctrl+b %      # Split vertically
Ctrl+b "      # Split horizontally
Ctrl+b o      # Switch between panes
Ctrl+b x      # Close current pane
```

### Scroll Through Logs

```bash
Ctrl+b [      # Enter scroll mode
↑↓            # Scroll with arrow keys
PgUp/PgDn     # Page up/down
q             # Exit scroll mode
```

### Rename Windows

```bash
Ctrl+b ,      # Rename current window
```

### Create New Window

```bash
Ctrl+b c      # Create new window
Ctrl+b &      # Kill current window
```

---

## Common Scenarios

### "I closed my terminal but tmux is still running"

```bash
# Just reattach
tmux attach -t fin-dev
```

### "I want to restart just the backend"

```bash
# Switch to backend window (Window 2)
Ctrl+b 2

# Stop nodemon
Ctrl+c

# Restart
npm run dev
```

### "I want to see backend and frontend logs together"

```bash
# In any window, split it
Ctrl+b %

# In the new pane, switch to different window's content
# Or run: docker compose -f docker-compose.dev.yml logs -f server
```

### "I need to run a quick command"

```bash
# Switch to shell window
Ctrl+b 4

# Run your command
./Scripts/sync-db-prod-to-dev.sh

# Switch back to frontend
Ctrl+b 3
```

---

## Customizing Your Session

Edit `Scripts/dev-start.sh` to:
- Change window names
- Add more windows
- Customize startup commands
- Change default directory

---

## Alternative: Screen-Style Usage

If you prefer `screen` commands, add to `~/.tmux.conf`:

```bash
# Use Ctrl+a instead of Ctrl+b
unbind C-b
set -g prefix C-a
bind C-a send-prefix
```

---

**Pro tip:** Keep your tmux session running 24/7. Detach when not coding, reattach when ready to work!
