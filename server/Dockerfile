FROM node:20

# Install PostgreSQL client tools (needed for pg_dump in backup endpoint)
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
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
  CMD node -e "require('http').get('http://localhost:3005/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the application
CMD ["npm", "run", "dok"]
