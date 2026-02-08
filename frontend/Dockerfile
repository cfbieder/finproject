# Stage 1: Build the application
FROM node:20 AS builder

# Accept version as build argument
ARG VITE_APP_VERSION=2.0.0
ARG VITE_APP_MODE=prod
ARG VITE_APP_API=""

# Set working directory
WORKDIR /app

# Copy package files from frontend directory
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy data files from parent directory first (needed for imports)
COPY components/data/ ../components/data/

# Copy frontend source code
COPY frontend/ ./

# Build the application for production
# Environment variables are passed to Vite during build
RUN VITE_APP_VERSION=$VITE_APP_VERSION \
    VITE_APP_MODE=$VITE_APP_MODE \
    VITE_APP_API=$VITE_APP_API \
    npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration from frontend directory
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Expose ports 80 and 443
EXPOSE 80 443

# Health check (check HTTP endpoint on port 80)
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl --fail --silent http://localhost:80/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
