# Docker Setup for Fin Server

This document explains how to run the Fin server in a Docker container.

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
- Build the server Docker image
- Start MongoDB on port 27018
- Start the Fin server on port 3005
- Create a persistent volume for MongoDB data

### 2. View Logs

```bash
# View all logs
docker-compose logs -f

# View only server logs
docker-compose logs -f server

# View only MongoDB logs
docker-compose logs -f mongo
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
curl http://localhost:3005/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-12-29T..."
}
```

### Container Health Check

Docker automatically monitors the health of both containers:

```bash
docker-compose ps
```

Look for "healthy" status in the output.

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

If you've made changes to the server code:

```bash
# Rebuild and restart
docker-compose up -d --build

# Or rebuild without cache
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

Once running, the server exposes these endpoints:

- `GET /` - Service info and available routes
- `GET /api/health` - Health check
- `GET /api/balance` - Balance sheet data
- `GET /api/cash-flow` - Cash flow data
- `GET /api/forecast` - Forecast data
- `POST /api/forecast/scenarios/:scenario/copy` - Copy scenario
- And more... (see server/src/routes/)

## Notes

- The MongoDB port (27018) is exposed on the host for development access
- Data volumes persist across container restarts
- The server includes automatic MongoDB connection retry logic
- Health checks ensure services are ready before accepting traffic
