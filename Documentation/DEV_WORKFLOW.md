# Development Workflow Guide

This guide explains how to use the development environment alongside production.

---

## Overview

You now have **two separate environments**:

| Environment | Compose File | Ports | Database | Purpose |
|-------------|--------------|-------|----------|---------|
| **Production** | `docker-compose.yml` | 3005, 3006, 5175, 5433 | `fin-postgres` | Live application |
| **Development** | `docker-compose.dev.yml` | 3105, 3106, 5176, 5434 | `fin-postgres-dev` | Testing & development |

Both environments run **on the same VM** but with separate containers, databases, and ports.

---

## Quick Start

### 1. Start Development Environment

```bash
cd ~/Programs/fin

# Start all dev services
docker compose -f docker-compose.dev.yml up -d

# View logs
docker compose -f docker-compose.dev.yml logs -f
```

### 2. Copy Production Data to Development

```bash
# This gives you real data to test with
./sync-db-prod-to-dev.sh
```

### 3. Make Your Changes

Work on the code as needed. The development environment uses the same codebase but separate containers.

### 4. Test Your Changes

Rebuild development after code changes:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Access development:
- Frontend: `https://localhost:5176` or `http://localhost:3106`
- API: `http://localhost:3105`
- Database: `localhost:5434`

### 5. Deploy to Production

When ready to deploy:

```bash
# Full deployment with backup and git
./deploy-to-production.sh

# Quick deployment (skip git operations)
./deploy-to-production.sh --skip-git

# Risky: deploy without backup (not recommended)
./deploy-to-production.sh --no-backup
```

---

## Access URLs

### Production

| Service | Local Network | Tailscale |
|---------|---------------|-----------|
| Frontend (HTTPS) | `https://192.168.1.82:5175` | `https://fin.tail413695.ts.net` |
| Frontend (HTTP) | `http://192.168.1.82:3006` | - |
| API | `http://192.168.1.82:3005` | - |
| Database | `192.168.1.82:5433` | - |

### Development

| Service | Local |
|---------|-------|
| Frontend (HTTPS) | `https://localhost:5176` |
| Frontend (HTTP) | `http://localhost:3106` |
| API | `http://localhost:3105` |
| Database | `localhost:5434` |

---

## Common Operations

### Development

```bash
# Start development
docker compose -f docker-compose.dev.yml up -d

# Stop development
docker compose -f docker-compose.dev.yml down

# Rebuild after code changes
docker compose -f docker-compose.dev.yml up -d --build

# View logs
docker compose -f docker-compose.dev.yml logs -f server-dev

# Access development database
docker compose -f docker-compose.dev.yml exec fin-postgres-dev psql -U fin -d fin

# Restart specific service
docker compose -f docker-compose.dev.yml restart server-dev
```

### Production

```bash
# Start production
docker compose up -d

# Stop production
docker compose down

# Rebuild production
docker compose up -d --build

# View logs
docker compose logs -f server

# Access production database
docker compose exec fin-postgres psql -U fin -d fin
```

### Database Operations

```bash
# Sync production data to development
./sync-db-prod-to-dev.sh

# Backup production database manually
docker exec fin-postgres pg_dump -U fin -d fin -Fc > backup_$(date +%Y%m%d).dump

# Restore backup to development
docker exec -i fin-postgres-dev pg_restore -U fin -d fin --clean --if-exists < backup_20260208.dump
```

---

## Development Workflow

### Standard Workflow

1. **Start with fresh production data**
   ```bash
   ./sync-db-prod-to-dev.sh
   ```

2. **Make code changes**
   - Edit files in your IDE
   - Changes are in the same directory for both environments

3. **Test in development**
   ```bash
   docker compose -f docker-compose.dev.yml up -d --build
   # Test at https://localhost:5176
   ```

4. **Iterate until satisfied**
   - Make more changes
   - Rebuild development
   - Test again

5. **Deploy to production**
   ```bash
   ./deploy-to-production.sh
   ```

### Working with Git

```bash
# Check status
git status

# Commit changes
git add .
git commit -m "Description of changes"

# Push to GitHub
git push origin main

# Deploy (script will offer to commit & push)
./deploy-to-production.sh
```

---

## Script Reference

### sync-db-prod-to-dev.sh

**Purpose:** Copy production database to development for testing with real data.

**What it does:**
1. Dumps production database
2. Restores to development database
3. Verifies transaction counts match
4. Cleans up temporary backup file

**Usage:**
```bash
./sync-db-prod-to-dev.sh
```

**Safety:**
- Prompts for confirmation before overwriting dev database
- Verifies data after restore
- Only affects development (production untouched)

---

### deploy-to-production.sh

**Purpose:** Deploy tested changes from development to production.

**What it does:**
1. Backs up production database (safety!)
2. Optionally commits and pushes to git
3. Rebuilds production containers
4. Verifies deployment health

**Usage:**
```bash
# Full deployment with all safety checks
./deploy-to-production.sh

# Skip git operations (deploy current code)
./deploy-to-production.sh --skip-git

# Skip database backup (NOT recommended)
./deploy-to-production.sh --no-backup
```

**Options:**
- `--skip-git` - Don't commit or push to GitHub
- `--no-backup` - Skip database backup (risky!)
- `--help` - Show help message

**Safety features:**
- Backs up production database before deployment
- Prompts for confirmation at each step
- Verifies container health after deployment
- Provides rollback instructions if issues occur

---

## Troubleshooting

### Development won't start

```bash
# Check if ports are in use
netstat -tlnp | grep -E ':(3105|3106|5176|5434)'

# Stop development and remove volumes
docker compose -f docker-compose.dev.yml down -v

# Start fresh
docker compose -f docker-compose.dev.yml up -d
```

### Database sync fails

```bash
# Ensure both databases are running
docker ps | grep postgres

# Check production database
docker exec fin-postgres psql -U fin -d fin -c "SELECT COUNT(*) FROM transactions"

# Check development database
docker exec fin-postgres-dev psql -U fin -d fin -c "SELECT COUNT(*) FROM transactions"
```

### Deployment fails

```bash
# Check production health
docker compose ps

# View logs for errors
docker compose logs --tail=50

# Rollback if needed (if you have a backup)
docker compose down
docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists < fin_backup_YYYYMMDD_HHMMSS.dump
docker compose up -d
```

### Both environments running out of memory

```bash
# Check resource usage
docker stats

# Stop development when not in use
docker compose -f docker-compose.dev.yml down
```

---

## Best Practices

1. **Always sync data before major testing**
   - Get fresh production data: `./sync-db-prod-to-dev.sh`
   - Ensures you're testing with realistic data

2. **Test thoroughly in development**
   - Don't rush to production
   - Test all features affected by your changes

3. **Keep backups**
   - The deploy script creates automatic backups
   - Keep these for at least a week
   - Store critical backups off the VM

4. **Commit often**
   - Small, focused commits
   - Clear commit messages
   - Push to GitHub regularly

5. **Stop development when not in use**
   - Saves resources: `docker compose -f docker-compose.dev.yml down`
   - Production keeps running

6. **Review logs after deployment**
   - Check for errors: `docker compose logs -f`
   - Monitor for a few minutes after deployment

---

## Port Reference

| Service | Production | Development | Protocol |
|---------|-----------|-------------|----------|
| Frontend HTTPS | 5175 | 5176 | HTTPS |
| Frontend HTTP | 3006 | 3106 | HTTP |
| API Server | 3005 | 3105 | HTTP |
| PostgreSQL | 5433 | 5434 | PostgreSQL |

---

## Environment Variables

Both environments use the same environment variables from `docker-compose.yml` / `docker-compose.dev.yml`.

To override for development, create a `.env.dev` file:

```bash
PS_API_KEY=your_dev_key_here
PS_USER_ID=your_dev_user_id
```

Then start with:
```bash
docker compose -f docker-compose.dev.yml --env-file .env.dev up -d
```

---

## Questions?

- View production status: `docker compose ps`
- View development status: `docker compose -f docker-compose.dev.yml ps`
- View all containers: `docker ps -a`
- Clean up everything: `docker system prune -a` (WARNING: removes all unused images)

---

*Last updated: 2026-02-08*
