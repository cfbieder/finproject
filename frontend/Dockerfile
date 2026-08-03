# Stage 1: Build the application
FROM node:20 AS builder

# Accept version as build argument
ARG VITE_APP_VERSION=2.0.0
ARG VITE_APP_MODE=prod
ARG VITE_APP_API=""
ARG VITE_NAV_LAYOUT=legacy

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
    VITE_NAV_LAYOUT=$VITE_NAV_LAYOUT \
    npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration from frontend directory
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Provenance — Known Issue #17. This image is built from the working tree, so "what commit
# is prod running?" was previously answerable only by archaeology (grepping the bundle for a
# route, comparing container timestamps against git log). That is exactly what the 2026-08-03
# incident cost. Stamp it instead:
#   docker inspect fin-frontend --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
# `dirty=true` means the tree carried uncommitted build-path changes at build time, i.e. this
# image corresponds to NO commit — deploy-to-production.sh refuses that unless --allow-dirty.
#
# Deliberately the LAST layers before EXPOSE: these values change on every commit, and placed
# any earlier they would invalidate the npm ci / npm run build cache on every local build.
ARG GIT_SHA=unknown
ARG GIT_DIRTY=unknown
LABEL org.opencontainers.image.revision="$GIT_SHA" \
      com.fin.build.dirty="$GIT_DIRTY"

# Expose ports 80 and 443
EXPOSE 80 443

# Health check (check HTTP endpoint on port 80)
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl --fail --silent http://localhost:80/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
