#!/usr/bin/env bash
#
# deploy-on-vm.sh — Clone and deploy the fin application on the VM
#
# Run this ON the VM (192.168.1.82) after cloud-init has completed.
#
# Usage:  ssh cfbieder@192.168.1.82 'bash -s' < deploy-on-vm.sh
#
set -euo pipefail

REPO_URL="https://github.com/cfbieder/finproject.git"
PROJECT_DIR="$HOME/Programs/fin"

echo "==> Verifying Docker is available"
if ! docker info &>/dev/null; then
    echo "ERROR: Docker is not running or current user not in docker group."
    echo "Try: newgrp docker   (or log out and back in)"
    exit 1
fi

echo "==> Docker version: $(docker --version)"
echo "==> Docker Compose version: $(docker compose version)"

# ── Clone repository ──────────────────────────────────────────────────
if [ -d "$PROJECT_DIR" ]; then
    echo "==> Project directory already exists, pulling latest"
    cd "$PROJECT_DIR"
    git pull
else
    echo "==> Cloning repository"
    mkdir -p "$(dirname "$PROJECT_DIR")"
    git clone "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
fi

# ── Generate SSL certificates ─────────────────────────────────────────
echo "==> Setting up SSL certificates"
mkdir -p certs
if [ ! -f certs/localhost.pem ]; then
    # Install mkcert
    if ! command -v mkcert &>/dev/null; then
        echo "==> Installing mkcert"
        sudo apt-get install -y libnss3-tools
        curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
        chmod +x mkcert-v*-linux-amd64
        sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
        mkcert -install
    fi
    echo "==> Generating certificates for localhost + 192.168.1.82"
    cd certs
    mkcert localhost 192.168.1.82
    mv localhost+1.pem localhost.pem
    mv localhost+1-key.pem localhost-key.pem
    cd ..
else
    echo "==> SSL certificates already exist"
fi

# ── Update nginx server_name for this VM's IP ─────────────────────────
echo "==> Patching nginx.conf server_name for VM IP"
if grep -q "server_name" frontend/nginx.conf; then
    sed -i 's/server_name .*/server_name localhost 192.168.1.82 _;/' frontend/nginx.conf
fi

# ── Build and start services ──────────────────────────────────────────
echo "==> Building and starting Docker services"
docker compose up -d --build

# ── Wait for services to be healthy ───────────────────────────────────
echo "==> Waiting for services to become healthy..."
for i in $(seq 1 60); do
    if docker compose ps --format json 2>/dev/null | grep -q '"Health":"healthy"' || \
       docker compose ps 2>/dev/null | grep -q "(healthy)"; then
        HEALTHY_COUNT=$(docker compose ps 2>/dev/null | grep -c "(healthy)" || true)
        if [ "$HEALTHY_COUNT" -ge 2 ]; then
            echo "==> All services healthy after ~${i}s"
            break
        fi
    fi
    sleep 1
    if [ $((i % 10)) -eq 0 ]; then
        echo "    ...still waiting (${i}s)"
    fi
done

# ── Show status ───────────────────────────────────────────────────────
echo ""
echo "==> Final status:"
docker compose ps
echo ""
echo "=========================================="
echo "  Fin application deployed!"
echo "=========================================="
echo ""
echo "  Access URLs:"
echo "    https://192.168.1.82:5175  (HTTPS)"
echo "    http://192.168.1.82:3006   (HTTP)"
echo "    http://192.168.1.82:3005   (API direct)"
echo ""
echo "  Database:"
echo "    Host: 192.168.1.82:5433"
echo "    User: fin / Password: \$POSTGRES_PASSWORD (from .env)"
echo ""
echo "  Useful commands:"
echo "    docker compose logs -f          # all logs"
echo "    docker compose restart          # restart all"
echo "    docker compose up -d --build    # rebuild & restart"
echo "=========================================="
