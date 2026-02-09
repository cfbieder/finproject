# Development Workflow Guide

---

## Architecture: Development vs Production

Both environments run on the same VM (`192.168.1.82`), accessed remotely via Tailscale.

### Production — Everything in Docker

```
docker-compose.yml runs all 3 services:

  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │  fin-postgres     │  │  fin-server       │  │  fin-frontend    │
  │  Port 5433        │◄─│  Port 3005        │◄─│  Port 5175/3006  │
  │  (PostgreSQL)     │  │  (Node.js)        │  │  (nginx)         │
  └──────────────────┘  └──────────────────┘  └──────────────────┘
```

- Code changes require: `docker compose up -d --build`
- Access: `https://fin.tail413695.ts.net` (blue browser tab)

### Development — Only Database in Docker

```
  ┌──────────────────┐     ┌───────────────────────────────────┐
  │  Docker           │     │  Local npm processes               │
  │                    │     │                                    │
  │  fin-postgres-dev  │     │  Backend: npm run dev (nodemon)   │
  │  Port 5434         │◄────│  Port 3105                        │
  │                    │     │                                    │
  └──────────────────┘     │  Frontend: npm run tail (Vite)     │
                            │  Port 5174                         │
                            └───────────────────────────────────┘
```

- Backend code changes: Nodemon auto-restarts in ~1-2 seconds
- Frontend code changes: Vite HMR updates instantly
- Access: `http://100.100.162.49:5174` (yellow browser tab, "[DEV]" title)
- Dev backend API: `http://100.100.162.49:3105`

### Port Reference

| Service | Production | Development |
|---------|-----------|-------------|
| PostgreSQL | 5433 (Docker) | 5434 (Docker) |
| API Server | 3005 (Docker) | 3105 (local npm) |
| Frontend | 5175/3006 (Docker nginx) | 5174 (local Vite) |

Production and development use different ports, so both can run simultaneously.

---

## Quick Start

### Start Development

```bash
ssh cfbieder@192.168.1.82
cd ~/Programs/fin

# Start dev environment (tmux with 4 windows)
./dev-start.sh
```

`dev-start.sh` does the following:
1. Starts `fin-postgres-dev` in Docker (port 5434)
2. Opens tmux with: database logs, backend (nodemon), frontend (Vite), shell

### Stop Development, Restore Production

```bash
# Kill tmux session
tmux kill-session -t fin-dev

# Stop dev database
docker compose -f docker-compose.dev.yml down
```

---

## Making Changes

### Frontend Changes
- Edit files in `frontend/src/`
- Save → changes appear instantly in browser (Vite HMR)
- No restart needed

### Backend Changes
- Edit files in `server/src/`
- Save → nodemon auto-restarts the server in ~1-2 seconds
- No manual restart needed (nodemon watches `src/` and `db/` directories)

### Database Changes
- Run SQL directly against the dev database:
  ```bash
  docker compose -f docker-compose.dev.yml exec fin-postgres-dev psql -U fin -d fin
  ```

---

## Syncing Data

### Copy Production Data to Development

```bash
./sync-db-prod-to-dev.sh
```

This dumps the production database and restores it to the dev database. Run this to get fresh production data for testing.

---

## Deploying to Production

When development is ready:

```bash
# Stop dev environment
tmux kill-session -t fin-dev
docker compose -f docker-compose.dev.yml down

# Deploy (backs up DB, rebuilds containers, verifies health)
./deploy-to-production.sh
```

Or for a quick deploy without git operations:
```bash
./deploy-to-production.sh --skip-git
```

---

## Frontend Environment Configurations

The frontend uses `env-cmd` with `.env-cmdrc` for different API targets:

| npm script | `VITE_APP_API` | Use Case |
|-----------|----------------|----------|
| `npm run dev` | `http://localhost:3105` | Development on the VM directly |
| `npm run tail` | `http://100.100.162.49:3105` | **Development via Tailscale (recommended)** |
| `npm run docker` | (empty — nginx proxy) | Production Docker build |
| `npm run production` | `http://192.168.1.82:3005` | Direct production API access |

All development environments point to port 3105 (the local npm backend).

---

## Troubleshooting

### Backend changes not reflected
Check that nodemon is running in the backend tmux window.

### Frontend not connecting to backend
Check that the frontend npm script matches the backend port:
- Local npm backend (port 3105) → use `npm run tail` or `npm run dev`

### Database connection refused
Ensure the dev database container is running:
```bash
docker compose -f docker-compose.dev.yml up -d fin-postgres-dev
```

---

*Last updated: 2026-02-09*
