# Deploy runbook — shared-edge co-host

> **Pack role:** the concrete "add one more app to an existing shared edge" runbook —
> the operational companion to the shared-edge pattern described in
> [`deploy-to-public.md`](deploy-to-public.md) (Part 2, "shared `/opt/edge`"). Use this when
> a box **already** runs one `cloudflared` + one Caddy fronting other apps and you're
> co-hosting one more. For a *dedicated* box where the app owns its own tunnel, follow
> `deploy-to-public.md` Branch B / Phase 2 instead. Worked instance: Staritsky on a Hetzner
> shared-edge box hosting two other public apps.
>
> **Last reviewed:** 2026-07-06.

Deploy `<<APP>>` onto a box that **already** runs one `cloudflared` + one Caddy
(in `/opt/edge`) fronting other apps — the "shared edge" pattern in
[deploy-to-public.md](deploy-to-public.md). `<<APP>>` adds only
its **app stack** (db + api + web); the box's existing tunnel + Caddy become its
ingress. Target box is a Tailscale host that already hosts other public-facing apps
(substitute its Tailscale IP for `<<HOST_IP>>`).

Why this shape: no new VM to provision or pay for, and no second tunnel/Caddy —
the *next* app is "add a Caddy site block + a tunnel hostname," nothing more.

## Artifacts

- `docker-compose.<<HOST>>.yml` — app-only stack. `web` (its own Caddy on `:80`)
  joins the shared **edge** network so the box's Caddy can reach `<<APP>>-web:80`.
  No cloudflared here; DB is not published (distinct project/container names keep
  it isolated from the neighbours).
- `scripts/deploy-to-<<HOST>>.sh` — run ON the box: backup → build → up → migrate
  → seed → health-check, then prints the one-time ingress wiring.

## One-time setup (on the box)

1. **Get the code + secrets.**
   ```bash
   git clone <repo> <<APP>> && cd <<APP>>      # or git pull on an existing checkout
   cp .env.example .env
   ```
   Fill `.env`:
   - `DB_PASSWORD` — strong password (new DB, so you pick it).
   - `JWT_SECRET` — `openssl rand -hex 32`.
   - `EDGE_NETWORK` — the shared Docker network your Caddy/cloudflared use. Find it:
     ```bash
     docker network ls                 # e.g. `edge`, or `<edge-project>_default`
     docker inspect <box-caddy-container> -f '{{json .NetworkSettings.Networks}}'
     ```
   - `PUBLIC_HOSTNAME` — e.g. `<<APP>>.<your-domain>` (used only in printouts).

2. **First deploy.**
   ```bash
   ./scripts/deploy-to-<<HOST>>.sh
   ```
   It fails fast if the edge network is missing or secrets are unset. On success
   the app stack is up and `<<APP>>-web:80` is reachable on the edge network —
   but not yet public.

3. **Wire ingress once** (the script reprints these):

   a. **Caddy site block** — append to the box's `/opt/edge/Caddyfile`:
      ```
      <<APP>>.<your-domain> {
          reverse_proxy <<APP>>-web:80
      }
      ```
      Reload (a single-file bind-mount is **not** picked up by `caddy reload` —
      force-recreate):
      ```bash
      docker compose -f /opt/edge/docker-compose.yml up -d --force-recreate caddy
      ```

   b. **Cloudflare Tunnel hostname** — Zero Trust → Networks → Tunnels → the box's
      tunnel → Public Hostname: `<<APP>>.<your-domain>` → `http://caddy:80`
      (the shared Caddy; it then host-routes to `<<APP>>-web`).

   c. **Access gate** — Zero Trust → Access → add an application/policy for
      `<<APP>>.<your-domain>` (email allowlist) while it's invite-only.

      ⚠️ **Gating the app changes how you must probe it.** Access `302`s *every* unauthenticated
      request (incl. `/health`), so a default blackbox probe follows the redirect, gets a **200 from
      the Cloudflare login page**, and reports the app **UP while it is dead**. Probe it with an Access
      **service token** + `follow_redirects: false` and assert **`probe_http_redirects == 0`** —
      see [`public-edge-baseline.md`](public-edge-baseline.md) §1. Do this in step 5, not "later".

4. **Browse** `https://<<APP>>.<your-domain>` → the branded login. Sign in with
   the seeded admin (`admin@<<APP>>.local` / the seed password) and create real
   accounts in Settings → Users.

## Re-deploys

Just re-run on the box after `git pull`:
```bash
git pull && ./scripts/deploy-to-<<HOST>>.sh
```
It backs the DB up first, rebuilds the images (baking in the current
`version.json`), and re-applies migrations. Ingress stays as wired in step 3.

## 5. The deploy is NOT done until it's watched and backed up

The runbook used to end at "it resolves". That is exactly how an app went live on a shared edge and
sat there for hours **unprobed and with no database backup**, with every step passing. Reachable is
not done:

- [ ] **Probe it from outside** (through the gate if gated — step 3c). An unprobed public hostname
      **dies silently**.
- [ ] **Check the probe's alert rule actually matches its job.** Gated apps often need their own probe
      job; if your alert's job matcher doesn't include it, the probe goes red **and pages nobody**.
- [ ] **Back up its DB, and restore it once.** A new app means a new database. On a cloud box there is
      **no VM-image safety net** — the logical dump is the *only* copy.
- [ ] ⚠️ **Make its *absence* noticeable.** A "backup is stale" alert fires on a metric that has gone
      old — a backup that **never ran has no metric**, so it fires **nothing**. **Silence is not
      safety.** Alert on *missing*, not just *stale*.
- [ ] **Register it in the exposure inventory** — the live list of what is public and how it is gated.

## Verify

- `docker exec <<APP>>-api curl -sf localhost:3000/health` → `{"status":"ok"}`.
- **From the monitoring host:** `probe_success == 1` **and `probe_http_redirects == 0`** (a 200 reached
  via a redirect is the Access login page, not your app).
- The app's first backup **exists on the backup target** — don't trust the script's exit code, list it.
- Live version: the footer shows `v<X.Y.Z>`; or
  `docker exec <<APP>>-api node -e 'console.log(process.env.APP_VERSION)'`.
- `/api` smoke from the internet: a protected route returns **401** without a
  token (auth is enforced), and the login page loads.
- Neighbours unaffected: the other two apps still resolve (shared Caddy/tunnel
  untouched except the added block).

## Rollback

- App: `git checkout <prev-tag> && ./scripts/deploy-to-<<HOST>>.sh`.
- DB: restore the pre-deploy dump —
  `docker exec -i <<APP>>-db pg_restore -U <<APP>> -d <<APP>>_prod --clean < Backups/<<APP>>_<ts>.dump`.
- Take it offline fast: remove the Caddy site block (or the tunnel hostname) and
  force-recreate Caddy — the app stack keeps running privately.
- **Retiring the hostname for good?** Delete the **tunnel route first, then the DNS record** (the
  provider often removes the CNAME with the route). And **before deleting any *tunnel*, check what DNS
  actually points at** — a tunnel's route list is *not* evidence it serves those hostnames; an orphaned
  tunnel can still list a route for a **live** hostname that DNS long ago re-pointed elsewhere.
  → [`public-edge-baseline.md`](public-edge-baseline.md) §3

## Notes

- **Not** `docker-compose.tunnel.yml` — that overlay is for a *dedicated* box
  where `<<APP>>` owns the tunnel. On a shared-edge box it would stand up a second
  cloudflared; don't use it here.
- DB port is intentionally unpublished. For a stock-take or manual query:
  `docker exec -it <<APP>>-db psql -U <<APP>> -d <<APP>>_prod`.
- Backups land in `./Backups/` on the box — point your existing backup job there,
  or add this DB to the box's backup rotation.
