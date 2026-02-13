# Docker Setup for Fin Application

This document explains how to run the Fin application (frontend + backend + database) using Docker containers. All development and production runs on the VM at `192.168.1.82`.

## Prerequisites

- Docker Engine 29+ (installed via cloud-init during VM provisioning)
- Docker Compose v5+ (included with Docker)
- Production VM: `192.168.1.82` (Ubuntu 24.04 LTS, KVM guest on `192.168.1.61`)

## Quick Start

### 1. Build and Start Services

From the project root directory on the VM:

```bash
docker compose up -d --build
```

This will:
- Pull the PostgreSQL 16 Alpine image
- Build the server Docker image (Node.js Express API)
- Build the frontend Docker image (React app with nginx)
- Start PostgreSQL on port 5433
- Start the API server on port 3005
- Start the frontend on ports 3006 (HTTP) and 5175 (HTTPS)
- Create a persistent volume for PostgreSQL data
- Auto-apply database migrations on first run

### 2. View Logs

```bash
# View all logs
docker compose logs -f

# View only server logs
docker compose logs -f server

# View only database logs
docker compose logs -f fin-postgres

# View only frontend logs
docker compose logs -f frontend
```

### 3. Check Service Status

```bash
docker compose ps
```

### 4. Stop Services

```bash
docker compose down
```

To also remove volumes (this will delete all PostgreSQL data):

```bash
docker compose down -v
```

### 5. Access the Application

Once all services are running:

- **Frontend (HTTPS)**: https://192.168.1.82:5175
- **Frontend (HTTP)**: http://192.168.1.82:3006
- **Backend API**: http://192.168.1.82:3005/api/health
- **PostgreSQL**: `192.168.1.82:5433` (user: `fin`, password: `findev123`, db: `fin`)

The frontend nginx server proxies all `/api/*` requests to the backend server and rewrites legacy paths to `/api/v2/*`.

## Architecture

The application consists of three Docker services:

1. **fin-postgres** (Port 5433:5432)
   - PostgreSQL 16 Alpine
   - Data persisted in `postgres_data` Docker volume
   - Migrations auto-applied from `server/db/migrations/` on first run
   - Health check: `pg_isready -U fin -d fin`

2. **server** (Port 3005:3005)
   - Node.js 20 Express API server
   - Waits for PostgreSQL to be healthy before starting
   - Built from `server/Dockerfile`
   - Health check: HTTP GET to `/api/health`

3. **frontend** (Ports 3006:80, 5175:443)
   - Multi-stage build: Vite → nginx:alpine
   - SSL termination with mkcert certificates
   - SPA routing + API reverse proxy
   - Built from `frontend/Dockerfile`
   - Health check: curl to port 80

All services communicate over the `fin-network` bridge network.

## Configuration

### Environment Variables

The server uses the following environment variables (configured in `docker-compose.yml`):

- `NODE_ENV`: Set to `production` in Docker
- `PORT`: Server port (default: 3005)
- `DATABASE_URL`: PostgreSQL connection string
- `POSTGRES_PASSWORD`: Database password (default: `findev123`)
- `ACCOUNT_NAMES_PATH`: Path to account names JSON
- `CATEGORY_NAMES_PATH`: Path to category names JSON
- `COA_PATH`: Path to chart of accounts JSON
- `PS_API_KEY`: PocketSmith API key (required)
- `PS_USER_ID`: PocketSmith user ID (required)

No `.env` file is used — all defaults are in `docker-compose.yml`.

### Data Persistence

The following directories are mounted as volumes:

- `postgres_data` volume → PostgreSQL database files
- `./components/data` → `/app/components/data` (shared JSON data files)
- `./components/reports` → `/app/components/reports` (generated reports)
- `./certs` → `/etc/nginx/certs` (TLS certificates, read-only)
- `./frontend/nginx.conf` → nginx config (read-only)

## Backup and Restore

All backups are saved to the `Backups/` directory (git-ignored).

### Creating a Backup

```bash
# SSH to VM
ssh cfbieder@192.168.1.82

# Export database as custom format dump
mkdir -p Backups
docker exec fin-postgres pg_dump -U fin -d fin -Fc > Backups/fin_backup.dump
```

The deploy script (`deploy-to-production.sh`) automatically creates a timestamped backup in `Backups/` before deploying.

### Restoring a Backup

```bash
# Restore (drops and recreates objects)
docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists < Backups/fin_backup.dump
```

### Backup Best Practices

1. **Regular Backups**: Create backups before:
   - Making significant changes
   - Upgrading Docker containers
   - Testing new features

2. **Off-VM Storage**: Copy backups to the dev machine or KVM host:
   ```bash
   scp cfbieder@192.168.1.82:~/Programs/fin/Backups/fin_backup.dump ./
   ```

3. **Automated Backups**: Add a cron job for daily backups:
   ```bash
   # Add to crontab (crontab -e) on the VM
   0 2 * * * docker exec fin-postgres pg_dump -U fin -d fin -Fc > /home/cfbieder/Programs/fin/Backups/fin_backup_$(date +\%Y\%m\%d).dump
   ```

## Health Checks

### Application Health Check

```bash
curl http://192.168.1.82:3005/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-02-08T..."
}
```

### Container Health Checks

Docker automatically monitors the health of all containers:

```bash
docker compose ps
```

Look for "healthy" status in the output. All three services include health checks.

## Development vs Production

Both modes run on the VM (`ssh cfbieder@192.168.1.82`). See [DEV_WORKFLOW.md](DEV_WORKFLOW.md) for the full development guide.

### Development

Only the database runs in Docker. Backend and frontend run locally via npm:

```bash
cd ~/Programs/fin

# Start dev environment (database + backend + frontend in tmux)
./dev-start.sh
```

Development backend runs on port 3105 (separate from production on 3005), so both can run simultaneously.

### Production (Docker)

All three services run in Docker:

```bash
cd ~/Programs/fin
docker compose up -d --build
```

## Troubleshooting

### Frontend won't start or shows errors

1. Check if frontend container is running:
   ```bash
   docker compose logs frontend
   ```

2. Verify the build completed successfully:
   ```bash
   docker compose build frontend
   ```

3. Check nginx configuration:
   ```bash
   docker exec fin-frontend cat /etc/nginx/conf.d/default.conf
   ```

4. If seeing 502 Bad Gateway errors, ensure the server is running:
   ```bash
   docker compose ps server
   ```

### Server won't start

1. Check if PostgreSQL is ready:
   ```bash
   docker compose logs fin-postgres
   ```

2. Verify network connectivity:
   ```bash
   docker network ls
   docker network inspect fin_fin-network
   ```

3. Check server logs for errors:
   ```bash
   docker compose logs server
   ```

### PostgreSQL connection issues

The server depends on PostgreSQL health check (`service_healthy` condition). If PostgreSQL isn't starting:

1. Check PostgreSQL is running:
   ```bash
   docker compose ps fin-postgres
   ```

2. Test PostgreSQL connection:
   ```bash
   docker compose exec fin-postgres psql -U fin -d fin -c "SELECT 1"
   ```

3. Check migration errors:
   ```bash
   docker compose logs fin-postgres | grep ERROR
   ```

### Rebuild after changes

If you've made changes to the frontend or server code:

```bash
# Rebuild specific service and restart
docker compose up -d --build frontend
docker compose up -d --build server

# Rebuild all services
docker compose up -d --build

# Or rebuild without cache (for major changes)
docker compose build --no-cache
docker compose up -d
```

## Advanced Usage

### Access container shell

```bash
# Frontend container
docker exec -it fin-frontend sh

# Server container
docker exec -it fin-server sh

# PostgreSQL shell
docker compose exec fin-postgres psql -U fin -d fin
```

### View resource usage

```bash
docker stats
```

### Run database migrations manually

Migrations run automatically on first PostgreSQL start. To re-run on an existing database:

```bash
docker compose exec fin-postgres psql -U fin -d fin -f /docker-entrypoint-initdb.d/001_initial_schema.sql
docker compose exec fin-postgres psql -U fin -d fin -f /docker-entrypoint-initdb.d/002_psdata_staging.sql
```

## VM Provisioning

If the VM needs to be recreated, use the provisioning scripts from any machine with SSH access to the KVM host:

```bash
# Create the VM on the KVM host
ssh cfbieder@192.168.1.61 'bash -s' < provision-vm.sh

# Wait ~3-5 min for cloud-init to complete, then deploy
ssh cfbieder@192.168.1.82 'bash -s' < deploy-on-vm.sh

# Restore database from backup
scp fin_backup.dump cfbieder@192.168.1.82:~/Programs/fin/Backups/
ssh cfbieder@192.168.1.82 "docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists < ~/Programs/fin/Backups/fin_backup.dump"
```

See `provision-vm.sh` and `deploy-on-vm.sh` for details. All VM images are stored in `/mnt/vm-ssd/` via the `vm-ssd` libvirt storage pool.
