# Development Guide - Hot Reload Setup

This guide shows you how to develop with instant hot reload for the fastest development experience.

---

## Quick Start: Hot Reload Development

### 1. Start Backend Services

```bash
cd ~/Programs/fin

# Start development database and API
docker compose -f docker-compose.dev.yml up -d server fin-postgres-dev
```

### 2. Run Frontend with Hot Reload

```bash
cd frontend
npm install  # First time only
npm run dev
```

The frontend dev server will start on **`http://localhost:5173`**

### 3. Make Changes

- Edit any file in `frontend/src/`
- Save the file
- **Changes appear instantly in your browser!** ✨
- No rebuild needed!

---

## Environment Modes

The frontend has different API endpoint configurations:

| Command | API Backend | Use Case |
|---------|-------------|----------|
| `npm run dev` | `localhost:3105` | **Local development** (connects to dev backend) |
| `npm run dev-prod` | `localhost:3005` | Test with production backend locally |
| `npm run tail` | `100.100.162.49:3105` | Access dev backend via Tailscale |
| `npm run tail-prod` | `100.100.162.49:3005` | Access prod backend via Tailscale |

To add these commands, update `frontend/package.json`:

```json
"scripts": {
  "dev": "env-cmd -e development -- vite",
  "dev-prod": "env-cmd -e dev-prod -- vite",
  "tail": "env-cmd -e tail -- vite",
  "tail-prod": "env-cmd -e tail-prod -- vite",
  "build": "vite build",
  "preview": "vite preview"
}
```

---

## Development Workflows

### Workflow 1: Full Hot Reload (Recommended)

**Best for:** Active UI development, testing changes quickly

```bash
# Terminal 1: Start backend services
docker compose -f docker-compose.dev.yml up -d server fin-postgres-dev

# Terminal 2: Run frontend dev server
cd frontend && npm run dev

# Access at: http://localhost:5173
```

**Benefits:**
- ✅ Instant hot reload
- ✅ Changes appear in < 1 second
- ✅ No rebuilding needed
- ✅ Full React DevTools support
- ✅ Source maps for debugging

---

### Workflow 2: Docker Development

**Best for:** Testing production build, nginx configuration

```bash
# Start all services
docker compose -f docker-compose.dev.yml up -d

# After making changes, rebuild frontend
docker compose -f docker-compose.dev.yml up -d --build frontend

# Access at: https://localhost:5176
```

**When to use:**
- Testing nginx configuration
- Testing HTTPS setup
- Verifying production build
- Testing Docker-specific behavior

---

### Workflow 3: Hybrid (Backend in Docker, Frontend Local)

**Best for:** Full-stack development

```bash
# Terminal 1: Backend services only
docker compose -f docker-compose.dev.yml up -d server fin-postgres-dev
docker compose -f docker-compose.dev.yml logs -f server

# Terminal 2: Frontend with hot reload
cd frontend && npm run dev

# Terminal 3: Make backend changes
cd server/src && vim some-file.js

# Restart backend to see changes
docker compose -f docker-compose.dev.yml restart server
```

---

## Common Development Tasks

### Sync Production Data

```bash
./sync-db-prod-to-dev.sh
```

This gives you real production data to test with.

### View Backend Logs

```bash
docker compose -f docker-compose.dev.yml logs -f server
```

### Restart Backend After Code Changes

```bash
# Backend changes require rebuild
docker compose -f docker-compose.dev.yml up -d --build server

# Or restart if no dependency changes
docker compose -f docker-compose.dev.yml restart server
```

### Access Development Database

```bash
docker exec -it fin-postgres-dev psql -U fin -d fin
```

### Test API Directly

```bash
# Development API
curl http://localhost:3105/api/health

# Production API
curl http://localhost:3005/api/health
```

---

## Debugging

### Frontend Not Connecting to Backend

Check that:
1. Backend is running: `docker compose -f docker-compose.dev.yml ps`
2. Backend is healthy: `curl http://localhost:3105/api/health`
3. CORS is configured correctly (should be already)

### Backend Changes Not Appearing

Backend is not watched for changes. You need to restart:

```bash
docker compose -f docker-compose.dev.yml restart server
```

### Hot Reload Not Working

Check that:
1. Vite dev server is running (should see "Local: http://localhost:5173")
2. You're accessing `localhost:5173`, not `localhost:5176`
3. Browser DevTools are open (F12) to see errors

---

## Performance Tips

### Keep Development Lightweight

When not actively developing:
```bash
# Stop dev frontend (use Docker version)
# Ctrl+C in the npm run dev terminal

# Or stop all dev services
docker compose -f docker-compose.dev.yml down
```

### Frontend-Only Changes

If you're only changing frontend code:
```bash
# Just run frontend dev server
cd frontend && npm run dev

# No need to run Docker at all if using production API
npm run dev-prod  # Uses production backend
```

---

## Port Reference

| Service | Development | Production |
|---------|-------------|------------|
| **Frontend (Hot Reload)** | `http://localhost:5173` | - |
| **Frontend (Docker HTTPS)** | `https://localhost:5176` | `https://192.168.1.82:5175` |
| **Frontend (Docker HTTP)** | `http://localhost:3106` | `http://192.168.1.82:3006` |
| **API** | `http://localhost:3105` | `http://192.168.1.82:3005` |
| **Database** | `localhost:5434` | `192.168.1.82:5433` |

---

## Quick Reference

```bash
# Start development with hot reload
docker compose -f docker-compose.dev.yml up -d server fin-postgres-dev
cd frontend && npm run dev

# Sync production data
./sync-db-prod-to-dev.sh

# View backend logs
docker compose -f docker-compose.dev.yml logs -f server

# Restart backend after changes
docker compose -f docker-compose.dev.yml restart server

# Deploy to production
./deploy-to-production.sh
```

---

## Recommended VSCode Extensions

For the best development experience:

- **ES7+ React/Redux/React-Native snippets** - Code snippets
- **ESLint** - JavaScript linting
- **Prettier** - Code formatting
- **Auto Rename Tag** - Rename paired HTML/JSX tags
- **Path Intellisense** - Autocomplete filenames
- **GitLens** - Git integration

---

**Happy coding!** Changes to frontend code now appear instantly with hot reload! 🚀
