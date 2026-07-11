---
name: deploy-shared-edge
description: Deploy this app as an additional tenant on a box that already runs one shared cloudflared + Caddy edge (/opt/edge) fronting other apps. Use when asked to co-host, add the app to the shared edge / edge network, or deploy to a box where other public apps already live. Not for a dedicated box where the app owns its own tunnel (use deploy-to-public).
---

# Co-host on an existing shared edge (condensed)

Canonical runbook: `deploy-to-shared-edge.md`. Pattern rationale: `deploy-to-public.md`
Part 2 "shared /opt/edge".

## Shape

The app brings **only its app stack** (db + api + web); the box's existing tunnel + Caddy
are its ingress. **Never** deploy the app's own tunnel overlay here — a second cloudflared
on a shared box is always wrong.

## One-time setup on the box

1. Clone + `.env`: strong `DB_PASSWORD` (new DB — you pick it), `JWT_SECRET`
   (`openssl rand -hex 32`), `EDGE_NETWORK` (find it: `docker network ls` + inspect the
   box's Caddy container), `PUBLIC_HOSTNAME`.
2. Run the deploy script (backup → build → up → migrate → seed → health). It must fail
   fast if the edge network is missing or secrets unset. After it, the web container is
   reachable ON the edge network but not yet public.
3. Wire ingress ONCE:
   a. Caddy site block in `/opt/edge/Caddyfile` → `reverse_proxy <<APP>>-web:80`; apply
      with `up -d --force-recreate caddy` (**never** trust `caddy reload` on a bind mount).
   b. Tunnel Public Hostname: `<<APP>>.<domain>` → `http://caddy:80` (the SHARED Caddy
      host-routes onward).
   c. Cloudflare Access policy (email allowlist) while invite-only.
4. Verify: in-container `/health` ok; protected route 401s from the internet; **the
   neighbour apps still resolve** (the shared edge was touched only by the added block).

## Rules that keep co-tenants safe

- Address this app's containers by their unique `<<APP>>-*` names on the edge network —
  generic service names (`backend`, `web`) collide across tenants → cross-wired 502s.
- The DB port stays unpublished; manual queries via `docker exec … psql`.
- Every ad-hoc compose command on the box passes the explicit `-f` file, or a recreate
  drops the service off the edge network (502 while localhost-in-container still answers —
  that's the tell).

## Re-deploys / rollback

Re-deploy: `git pull && ./scripts/deploy-to-<host>.sh` (backs up DB first). Take it
offline fast: remove the Caddy site block (or tunnel hostname) + force-recreate Caddy —
the app keeps running privately. DB rollback: `pg_restore --clean` from the pre-deploy dump.
