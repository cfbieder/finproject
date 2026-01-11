FROM node:20

# Install MongoDB Database Tools
RUN apt-get update && apt-get install -y wget gnupg && \
    wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/mongodb-archive-keyring.gpg] https://repo.mongodb.org/apt/debian bullseye/mongodb-org/7.0 main" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list && \
    apt-get update && \
    apt-get install -y mongodb-database-tools && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

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
    MONGO_URI=mongodb://mongo:27018/fin \
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
