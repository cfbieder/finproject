#!/usr/bin/env bash
# Boot-time reconcile for the fin docker stacks.
#
# Why: dockerd has a startup race — on reboot it can remove container network
# sandboxes as "stale" while restart policies are restoring containers, leaving
# containers (seen 2026-07-04: fin-postgres, fin-postgres-dev) running but
# detached from their networks. `docker compose up -d` is idempotent and
# recreates any missing network endpoints.
#
# Invoked by fin-docker-reconcile.service (After=docker.service). Safe to run
# manually at any time.
set -u

# Wait for the docker daemon (belt-and-braces; systemd already orders us after it)
for i in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
done
if ! docker info >/dev/null 2>&1; then
    echo "docker daemon not reachable after 120s, giving up" >&2
    exit 1
fi

rc=0

echo "[reconcile] psproject prod stack"
(cd /home/cfbieder/psproject && docker compose -f docker-compose.yml up -d) || rc=1

echo "[reconcile] psproject dev stack"
(cd /home/cfbieder/psproject && docker compose -f docker-compose.dev.yml up -d) || rc=1

echo "[reconcile] bank-feed stack"
(cd /home/cfbieder/Programs/fin/bank-feed && docker compose up -d) || rc=1

exit $rc
