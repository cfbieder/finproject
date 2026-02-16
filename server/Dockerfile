FROM node:20

# Install PostgreSQL 16 client tools (needed for pg_dump in backup endpoint)
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnupg \
 && echo "deb http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY components/package*.json ./components/
COPY server/package*.json ./server/

# Install dependencies (production only)
RUN npm ci --omit=dev --prefix components \
 && npm ci --omit=dev --prefix server

# Copy application code
COPY components ./components
COPY server ./server

# Set environment variables
ENV NODE_ENV=production \
    PORT=3005 \
    ACCOUNT_NAMES_PATH=../../components/data/account_names.json \
    CATEGORY_NAMES_PATH=../../components/data/category_names.json \
    COA_PATH=../../components/data/coa.json

# Create data directories if they don't exist
RUN mkdir -p /app/components/data /app/components/reports

# Set working directory to server
WORKDIR /app/server

# Expose port
EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3005/api/v2/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the application
CMD ["npm", "run", "dok"]
