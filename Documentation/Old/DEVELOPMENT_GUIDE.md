# Development Guide

This guide explains how to set up and use the development environment.

---

## How Development Works

Development runs on the VM (`192.168.1.82`), accessed remotely via Tailscale (`100.100.162.49`).

**Only the database runs in Docker.** The backend and frontend run locally via npm for instant code reload:

| Component | Runs via | Port | Auto-reload |
|-----------|----------|------|-------------|
| Database | Docker `fin-postgres-dev` | 5434 | N/A |
| Backend | `npm run dev` (nodemon) | 3105 | Yes, ~1-2s on file save |
| Frontend | `npm run tail` (Vite) | 5174 | Yes, instant HMR |

Development and production use different ports, so both can run simultaneously.

---

## Quick Start

```bash
ssh cfbieder@192.168.1.82
cd ~/Programs/fin

# Start dev environment
./dev-start.sh
```

`dev-start.sh` creates a tmux session (`fin-dev`) with 4 windows:
1. **database** — Starts `fin-postgres-dev` Docker container, shows logs
2. **backend** — Runs `cd server && npm run dev` (nodemon auto-restart)
3. **frontend** — Runs `cd frontend && npm run tail` (Vite hot reload)
4. **shell** — Command shell for running scripts

### Access from Remote Machine

Open browser to: `http://100.100.162.49:5174`

Yellow browser tab and "[DEV]" in the page title confirm you're in the development environment.

---

## Making Changes

### Frontend
- Edit any file in `frontend/src/`
- Save the file
- Changes appear instantly in the browser (Vite HMR)

### Backend
- Edit any file in `server/src/`
- Save the file
- Nodemon detects the change and restarts the server (~1-2 seconds)
- See `server/nodemon.json` for watch configuration

### Database
```bash
# Access dev database
docker compose -f docker-compose.dev.yml exec fin-postgres-dev psql -U fin -d fin
```

---

## Syncing Production Data

To test with real production data:

```bash
./sync-db-prod-to-dev.sh
```

This copies the production database to the development database. Safe to run anytime — only affects the dev database.

---

## Stopping Development

```bash
# Detach from tmux (keeps running)
Ctrl+b d

# Or kill the session entirely
tmux kill-session -t fin-dev

# Stop dev database
docker compose -f docker-compose.dev.yml down
```

---

## Deploying to Production

```bash
./deploy-to-production.sh
```

This script:
1. Backs up the production database
2. Optionally commits and pushes to git
3. Rebuilds production Docker containers
4. Verifies container health

---

## Tmux Quick Reference

| Key | Action |
|-----|--------|
| `Ctrl+b n` | Next window |
| `Ctrl+b p` | Previous window |
| `Ctrl+b 1-4` | Jump to window number |
| `Ctrl+b d` | Detach (session keeps running) |
| `Ctrl+b [` | Scroll mode (q to exit) |

Reattach to an existing session:
```bash
tmux attach -t fin-dev
```

---

## Frontend npm Scripts and API Targets

| npm script | API Target | When to Use |
|-----------|------------|-------------|
| `npm run tail` | `100.100.162.49:3105` | **Development via Tailscale (recommended)** |
| `npm run dev` | `localhost:3105` | Development on the VM directly |
| `npm run docker` | (nginx proxy) | Production Docker build |
| `npm run production` | `192.168.1.82:3005` | Direct production API access |

All development environments point to port 3105 (the local npm backend).

---

*Last updated: 2026-02-09*
