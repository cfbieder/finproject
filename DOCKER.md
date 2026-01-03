# Docker Setup for Fin Application

This document explains how to run the complete Fin application (frontend + backend + database) using Docker containers.

## Prerequisites

- Docker Engine 20.10 or higher
- Docker Compose 2.0 or higher

## Quick Start

### 1. Build and Start Services

From the project root directory:

```bash
docker-compose up -d
```

This will:
- Build the frontend Docker image (React app with nginx)
- Build the server Docker image (Node.js API)
- Start MongoDB on port 27018
- Start the Fin server on internal port 3005
- Start the frontend on port 3000
- Create a persistent volume for MongoDB data

### 2. View Logs

```bash
# View all logs
docker-compose logs -f

# View only server logs
docker-compose logs -f server

# View only MongoDB logs
docker-compose logs -f mongo

# View only frontend logs
docker-compose logs -f frontend
```

### 3. Check Service Status

```bash
docker-compose ps
```

### 4. Stop Services

```bash
docker-compose down
```

To also remove volumes (⚠️ this will delete all MongoDB data):

```bash
docker-compose down -v
```

### 5. Access the Application

Once all services are running:

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3000/api (proxied through nginx)
- **MongoDB**: localhost:27018 (for direct database access)

The frontend nginx server automatically proxies all `/api/*` requests to the backend server.

## Architecture

The application consists of three Docker services:

1. **frontend** (Port 3000)
   - Nginx serving the built React application
   - Proxies API requests to the backend server
   - Built from `frontend/Dockerfile` using multi-stage build

2. **server** (Internal Port 3005)
   - Node.js Express API server
   - Not directly exposed to host (only accessible via frontend proxy)
   - Built from `server/Dockerfile`

3. **mongo** (Port 27018)
   - MongoDB database
   - Data persisted in `mongo_data` Docker volume
   - Exposed to host for development/backup access

## Configuration

### Environment Variables

The server uses the following environment variables (configured in docker-compose.yml):

- `NODE_ENV`: Set to `production` in Docker
- `PORT`: Server port (default: 3005)
- `MONGO_URI`: MongoDB connection string
- `ACCOUNT_NAMES_PATH`: Path to account names JSON
- `CATEGORY_NAMES_PATH`: Path to category names JSON
- `COA_PATH`: Path to chart of accounts JSON
- `PS_API_KEY`: PocketSmith API key (required)
- `PS_USER_ID`: PocketSmith user ID (required)

### Custom Environment Variables

To customize environment variables:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your values:
   ```bash
   PS_API_KEY=your_actual_api_key
   PS_USER_ID=your_actual_user_id
   ```

3. Docker Compose will automatically use these values

**Note:** Default values are provided in `docker-compose.yml`, but it's recommended to use a `.env` file for sensitive data like API keys.

### Data Persistence

The following directories are mounted as volumes:

- `./components/data` → `/app/components/data` (application data)
- `./components/reports` → `/app/components/reports` (generated reports)
- `mongo_data` volume → MongoDB database files

## Backup and Restore

### Creating a Backup

Use the provided backup script to create a full MongoDB backup:

```bash
./backup-mongo.sh
```

This will:
- Create a timestamped backup in `mongo_backups/`
- Include all databases and collections
- Show backup size and contents

**Manual backup:**
```bash
# Create backup inside container
docker exec mongofin mongodump --port 27018 --out /tmp/backup

# Copy to host
docker cp mongofin:/tmp/backup ./mongo_backups/backup_$(date +%Y%m%d_%H%M%S)

# Clean up container
docker exec mongofin rm -rf /tmp/backup
```

### Restoring a Backup

Use the provided restore script:

```bash
./restore-mongo.sh /path/to/backup_directory
```

The script will:
- Ask for confirmation (restore drops all existing data)
- Copy backup to container
- Restore all collections
- Display document counts after restore

**Manual restore:**
```bash
# Copy backup to container
docker cp /path/to/backup mongofin:/tmp/restore

# Restore (--drop removes existing data first)
docker exec mongofin mongorestore --port 27018 --drop /tmp/restore

# Clean up
docker exec mongofin rm -rf /tmp/restore
```

### Backup Best Practices

1. **Regular Backups**: Create backups before:
   - Making significant changes
   - Upgrading Docker containers
   - Testing new features

2. **Backup Storage**: Keep backups in `mongo_backups/` directory (already in `.gitignore`)

3. **Verify Backups**: After creating a backup, check the file sizes to ensure data was captured

4. **Automated Backups**: Add a cron job for daily backups:
   ```bash
   # Add to crontab (crontab -e)
   0 2 * * * /home/cfbieder/Programs/fin/backup-mongo.sh
   ```

## Health Checks

### Application Health Check

The server includes a built-in health check:

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-12-29T..."
}
```

### Container Health Checks

Docker automatically monitors the health of all containers:

```bash
docker-compose ps
```

Look for "healthy" status in the output. All three services (frontend, server, mongo) include health checks.

## Development vs Production

### Development (Local)

```bash
# In server directory
npm run dev
```

Uses:
- `nodemon` for auto-reload
- Local MongoDB connection
- Development environment variables from `.env-cmdrc`

### Docker (Production-like)

```bash
# From project root
docker-compose up -d
```

Uses:
- `node` (no auto-reload)
- Containerized MongoDB
- Production environment variables from `docker-compose.yml`

## Troubleshooting

### Frontend won't start or shows errors

1. Check if frontend container is running:
   ```bash
   docker-compose logs frontend
   ```

2. Verify the build completed successfully:
   ```bash
   docker-compose build frontend
   ```

3. Check nginx configuration:
   ```bash
   docker exec fin-frontend cat /etc/nginx/conf.d/default.conf
   ```

4. If seeing 502 Bad Gateway errors, ensure the server is running:
   ```bash
   docker-compose ps server
   ```

### Server won't start

1. Check if MongoDB is ready:
   ```bash
   docker-compose logs mongo
   ```

2. Verify network connectivity:
   ```bash
   docker network ls
   docker network inspect fin-network
   ```

3. Check server logs for errors:
   ```bash
   docker-compose logs server
   ```

### MongoDB connection issues

The server automatically retries MongoDB connections every 5 seconds. Wait up to 40 seconds for the initial connection.

If issues persist:

1. Check MongoDB is running:
   ```bash
   docker-compose ps mongo
   ```

2. Test MongoDB connection:
   ```bash
   docker exec -it mongofin mongosh --port 27018
   ```

### Rebuild after changes

If you've made changes to the frontend or server code:

```bash
# Rebuild specific service and restart
docker-compose up -d --build frontend
docker-compose up -d --build server

# Rebuild all services
docker-compose up -d --build

# Or rebuild without cache (for major changes)
docker-compose build --no-cache
docker-compose up -d
```

## Advanced Usage

### Run server only (use external MongoDB)

```bash
docker build -t fin-server -f server/Dockerfile .
docker run -p 3005:3005 \
  -e MONGO_URI=mongodb://your-mongo-host:27018/fin \
  -v $(pwd)/components/data:/app/components/data \
  -v $(pwd)/components/reports:/app/components/reports \
  fin-server
```

### Access container shell

```bash
# Frontend container
docker exec -it fin-frontend sh

# Server container
docker exec -it fin-server sh

# MongoDB container
docker exec -it mongofin sh
```

### View resource usage

```bash
docker stats
```

## API Endpoints

Once running, the application exposes these endpoints through the frontend (http://localhost:3000):

- `GET /` - Frontend React application
- `GET /api/` - Service info and available routes
- `GET /api/health` - Health check
- `GET /api/balance` - Balance sheet data
- `GET /api/cash-flow` - Cash flow data
- `GET /api/forecast` - Forecast data
- `POST /api/forecast/scenarios/:scenario/copy` - Copy scenario
- And more... (see [server/src/routes/](server/src/routes/))

All `/api/*` requests are automatically proxied from the frontend nginx server to the backend.

## Notes

- The frontend is accessible at http://localhost:3000
- The backend server is NOT directly exposed to the host (only accessible via nginx proxy)
- The MongoDB port (27018) is exposed on the host for development access
- Data volumes persist across container restarts
- The server includes automatic MongoDB connection retry logic
- Health checks ensure services are ready before accepting traffic
- Nginx handles gzip compression and caching for optimal performance
