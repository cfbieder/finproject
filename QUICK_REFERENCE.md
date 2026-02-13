# Quick Reference Card

## ⚡ Quick Start with tmux

```bash
# Start complete dev environment in tmux
./dev-start.sh

# Access at: http://localhost:5174
```

---

## 🚀 Starting Environments (Manual)

```bash
# Start Production
docker compose up -d

# Start Development
docker compose -f docker-compose.dev.yml up -d

# Start Both
docker compose up -d && docker compose -f docker-compose.dev.yml up -d
```

## 🔗 Access URLs

| Environment | Frontend HTTPS | Frontend HTTP | API | Database |
|-------------|---------------|---------------|-----|----------|
| **Production** | `https://192.168.1.82:5175` | `http://192.168.1.82:3006` | `http://192.168.1.82:3005` | `192.168.1.82:5433` |
| **Production (Tailscale)** | `https://fin.tail413695.ts.net` | - | - | - |
| **Development** | `https://localhost:5176` | `http://localhost:3106` | `http://localhost:3105` | `localhost:5434` |

## 📋 Two Key Scripts

### 1. Copy Production Data to Dev
```bash
./sync-db-prod-to-dev.sh
```
- Use this to test with real production data
- Safe: only affects development database

### 2. Deploy to Production
```bash
./deploy-to-production.sh
```
- Backs up production first (saved to `Backups/`)
- Rebuilds and restarts production
- Verifies health after deployment

## 📊 Check Status

```bash
# Production
docker compose ps

# Development
docker compose -f docker-compose.dev.yml ps

# All containers
docker ps
```

## 🔄 Rebuild After Changes

```bash
# Rebuild Development
docker compose -f docker-compose.dev.yml up -d --build

# Rebuild Production (use deploy script instead!)
./deploy-to-production.sh
```

## 📝 View Logs

```bash
# Production logs
docker compose logs -f

# Development logs
docker compose -f docker-compose.dev.yml logs -f server-dev

# Specific service
docker compose logs -f server
docker compose -f docker-compose.dev.yml logs -f fin-postgres-dev
```

## 🛑 Stop Services

```bash
# Stop Production
docker compose down

# Stop Development
docker compose -f docker-compose.dev.yml down

# Stop Both
docker compose down && docker compose -f docker-compose.dev.yml down
```

## 🗄️ Database Access

```bash
# Production Database
docker exec -it fin-postgres psql -U fin -d fin

# Development Database
docker exec -it fin-postgres-dev psql -U fin -d fin

# Manual Backup (saved to Backups/ directory)
mkdir -p Backups
docker exec fin-postgres pg_dump -U fin -d fin -Fc > Backups/backup.dump

# Manual Restore
docker exec -i fin-postgres-dev pg_restore -U fin -d fin --clean < Backups/backup.dump
```

## 🔢 Version Management

```bash
# View current version
cat VERSION

# Increment version
./bump-version.sh patch   # 2.0.0 → 2.0.1
./bump-version.sh minor   # 2.0.0 → 2.1.0
./bump-version.sh major   # 2.0.0 → 3.0.0

# Set specific version
./bump-version.sh 2.1.5
```

---

## 📦 Typical Workflow

```bash
# 1. Start dev with fresh data
docker compose -f docker-compose.dev.yml up -d
./sync-db-prod-to-dev.sh

# 2. Make code changes
# (edit files in your IDE)

# 3. Test changes
docker compose -f docker-compose.dev.yml up -d --build
# Access: https://localhost:5176

# 4. Deploy when ready
./deploy-to-production.sh
```

## 🔍 Troubleshooting

```bash
# Container not starting?
docker compose -f docker-compose.dev.yml logs service-name

# Port already in use?
sudo netstat -tlnp | grep PORT_NUMBER

# Clean up everything (WARNING: removes all unused Docker resources)
docker system prune -a

# Restart specific service
docker compose restart server
docker compose -f docker-compose.dev.yml restart server-dev
```

## 📄 Full Documentation

- **DEV_WORKFLOW.md** - Complete development workflow guide
- **DOCKER.md** - Docker setup and operations
- **MIGRATION_STATUS.md** - Project status and architecture

---

**Quick Help:** Run `docker compose ps` and `docker compose -f docker-compose.dev.yml ps` to see what's running.
