> **ARCHIVED 2026-06-28 — superseded by [`deploy-to-public.md`](../deploy-to-public.md).**
> This is the original EspañolApp-only, three-phase (Branch B) playbook. Its successor
> restructures this content as "Branch B — OPEN," adds the OCME "Branch A — CLOSED"
> (Cloudflare Access) path, and merges both gotchas catalogs. Kept only for the
> app-specific EspañolApp detail and history; **for any new project, use the successor.**

---

# Tailscale → Public Deploy Playbook

**A reusable, three-phase runbook for taking an app that currently runs privately on a
homelab/VM behind Tailscale and exposing it safely to the public internet.**

This memo generalizes the exact steps we took to move EspañolApp from a Tailscale-only
deploy to a public site at `https://spanish.espanol-app.com`. It is written so you can
follow it for *another* app: every app-specific value is shown as a concrete example
(`espanol-app.com`, ports, container names) **and** as a placeholder you substitute.

It is deliberately split into three phases so you ship the smallest safe thing first:

- **Phase 1 — Closed beta, invite-only.** Public URL, HTTPS, no open ports, but only
  people holding an invite code can register. Runs on your *existing* box.
- **Phase 2 — Migrate to a dedicated VM.** Move prod off the homelab onto a hardened,
  isolated cloud VM — still invite-only. Host isolation *before* you face the public.
- **Phase 3 — Full public, self-service.** Email-verified signup, bot protection, and the
  invite gate dropped so anyone can sign up.

> **Status for EspañolApp:** all three phases **complete** as of **2026-06-28** — live,
> public, self-service signup at `https://spanish.espanol-app.com` (email-verified +
> Turnstile, invite gate off), prod on a dedicated Hetzner VM, homelab decommissioned to
> dev-only. This document stays a **reusable template**: checkboxes are left unchecked as a
> blank runbook for the next app, with EspañolApp-specific outcomes/dates called out inline.

> Source material this was distilled from (read these for app-specific detail):
> [`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md), [`HETZNER_DEPLOY.md`](HETZNER_DEPLOY.md),
> [`CR-012_PHASE_CD_PLAN.md`](../CR/CR-012_PHASE_CD_PLAN.md), `Scripts/deploy-to-hetzner.sh`,
> `docker-compose.tunnel.yml`, `docker-compose.hetzner.yml`.

---

# Part 0 — Plain-English primer (read this first)

If you already know what a Cloudflare Tunnel, Caddy, and DKIM are, skip to Part 1.
Otherwise this section explains every moving part in simple terms and how they connect.

## The core problem

Your app runs on a box (a homelab machine or a VM). Today it's only reachable over
**Tailscale** — a private mesh VPN. That's great for you, useless for a stranger you want
to invite. To go public you normally have to:

1. Open ports 80/443 on your router/firewall (exposes your home IP, invites attacks), and
2. Get a domain + TLS certificate, and
3. Make sure only the *right* people get in.

We avoid step 1 entirely using a **Cloudflare Tunnel**, and stage step 3 (first invite
codes, later email verification).

## The pieces and how they fit

```
  visitor ──HTTPS──▶  Cloudflare edge  ──encrypted tunnel──▶  cloudflared  ──▶  Caddy  ──▶  your app
                      (TLS, WAF,                              (on your box,    (reverse   (frontend +
                       rate-limit,                             dials OUT)       proxy)     backend API)
                       Turnstile)
```

- **Tailscale** — the private VPN you use today. It *stays on* the whole time. Public
  exposure is added *alongside* it, and you can switch the public side off and still reach
  the app privately. This is your rollback.

- **Domain + Cloudflare** — you register a domain (we used **Cloudflare Registrar**, which
  puts the domain on Cloudflare's nameservers instantly with no DNS migration). Cloudflare
  sits in front of your app as a smart, free CDN/security edge: it terminates **TLS**
  (the `https://` padlock — you don't manage certs), runs a **WAF** (web application
  firewall) and **DDoS** protection, lets you add **rate limiting** and **bot protection**,
  and only forwards clean traffic onward.

- **Cloudflare Tunnel + `cloudflared`** — this is the trick that avoids open ports.
  `cloudflared` is a tiny container that runs *on your box* and dials **outbound** to
  Cloudflare, holding a persistent encrypted connection open. Cloudflare sends visitor
  traffic back down that connection. Because the connection is outbound, **you open zero
  inbound ports** and your real IP is never exposed. The tunnel is authenticated by a
  single secret **token** you copy from the Cloudflare dashboard.

- **Caddy** — a **reverse proxy**. A reverse proxy is one front door that receives every
  request and routes it to the right internal service based on the URL path. Caddy looks
  at the request: `/api/*` and `/media/*` go to the **backend** container; everything else
  goes to the **frontend** (the single-page app). It also stamps on **security headers**.
  In this setup Cloudflare already did TLS, so Caddy just speaks plain HTTP internally —
  simpler and no certs to manage on the box. (Caddy *can* do its own TLS; we let Cloudflare
  do it.)

- **The two gates (staged).** Network reach and identity are separate concerns:
  - *Phase 1 gate = invite codes (in-app).* Registration requires a valid code. This is a
    one-flag feature in your backend; strangers who find the URL can load it but can't make
    an account.
  - *Phase 3 gate = email verification.* New accounts must confirm a 6-digit code emailed
    to them before they can log in, plus **Turnstile** (Cloudflare's privacy-friendly
    CAPTCHA) blocks bots at signup. Once these exist you can safely *drop* the invite
    requirement and let anyone sign up.

- **Resend + DKIM/SPF** — to email those verification codes you need a transactional email
  service. We used **Resend**. For email to actually arrive (not land in spam), you prove
  you own the domain by adding **DKIM** and **SPF** DNS records (Resend gives you the exact
  records; you paste them into Cloudflare DNS). Until that domain is verified, the app
  *logs* the code instead of sending it — so the whole flow is testable with no email at all.

- **The dedicated VM (Phase 2).** In Phase 1 the public site runs on your existing homelab
  box, which is fine while only a handful of invited people can get in. The moment you open
  self-service signup, a stranger-facing app on your home network is a real risk. So Phase 2
  moves prod onto a cheap **dedicated cloud VM** (we used a **Hetzner CX33**, ~$9/mo) that
  has nothing of yours on it — *while still invite-only*, so you do the risky migration
  before there's any public traffic. The homelab box then becomes dev-only, and Phase 3
  opens the gate on the VM.

- **Shared edge (a Phase 2 refinement).** On the dedicated VM we run *one* `cloudflared`
  and *one* Caddy in `/opt/edge`, and let multiple apps sit behind them, each routed by its
  hostname. This means the *next* app you move is just "add a site block + a tunnel
  hostname," not a whole new edge. Optional, but cheap and worth it.

## Why three phases (the strategy)

Going straight to "full public on a hardened VM with email + OAuth" is a lot of build
before a single tester can log in. The staged approach front-loads *"an invited person can
use the app over the internet"* with the least work (Phase 1), then does the risky
host-migration while traffic is still just invited testers (Phase 2), and only then opens
the gate to the public (Phase 3). Each phase is independently shippable and independently
reversible, and each is a smaller, safer step than the one big-bang move.

| | Phase 1 — Closed beta | Phase 2 — Dedicated VM | Phase 3 — Full public |
|---|---|---|---|
| Who can sign up | Invite-code holders | Invite-code holders | Anyone (email-verified) |
| Runs on | Existing homelab box | Dedicated cloud VM | Dedicated cloud VM |
| Email | Not needed | Not needed | Resend + DKIM/SPF |
| Bot protection | Edge rate-limit only | Edge rate-limit only | + Turnstile on signup |
| Gate flag | `INVITE_REQUIRED=true` | `INVITE_REQUIRED=true` | `EMAIL_VERIFICATION_REQUIRED=true`, invite off |

**Design rule that makes both phases safe: every gate is a dormant env flag.** Invite
gating, email verification, Turnstile, and bot protection each ship *off* and behave
byte-identically to "before" until you flip the flag. So you can deploy the code, test it,
and arm it independently — and roll back by flipping the flag, not reverting a deploy.

---

# Part 1 — Phase 1: Closed beta (invite-only, on your existing box)

**Outcome:** an invited tester opens `https://<app>.<yourdomain>` from any network, logs
in, and uses the app. Strangers can't register. Prod stays on your existing box. Tailscale
keeps working throughout.

Do all backend/frontend work on a branch (`git checkout -b stageN-public-beta`) and merge
when verified.

## 1.1 — App prerequisites (must exist before exposing anything)

Public exposure is only safe if the app already has real auth and a few hardening basics.
If your app lacks these, build them first:

- [ ] **Real authentication** — per-user login (JWT access + rotating refresh worked well),
      per-user data scoping, and admin-gated mutations. Don't expose an app that trusts a
      single implicit user.
- [ ] **Invite-gated registration (the Phase 1 gate).** Add an `Invite` model
      (`code` unique, optional `email` target, `created_by`, optional `expires_at`,
      `accepted_at`/`accepted_user_id`) + a migration. Gate `register()` behind a dormant
      flag `INVITE_REQUIRED` / `INVITE_REQUIRED_PROD`: when on, require a valid, unexpired,
      unused, correctly-targeted code, consumed in the **same DB transaction**. Return a
      **uniform 400** on any failure (no enumeration of which codes exist). Add admin
      `POST`/`GET`/`DELETE /api/auth/invites` behind `require_admin`, generating codes with
      `secrets.token_urlsafe`. Advertise `invite_required` on your `/auth/config` endpoint
      so the frontend shows the invite field only when the gate is on.
      - *Zero-code fallback for the very first tester:* skip the invite feature entirely and
        hand-create the account with an admin script. Build invites when you want self-signup.
- [ ] **CORS allowlist (not `*`).** Parse an `ALLOWED_ORIGINS` env list. An explicit list →
      `allow_credentials=True` (the SPA needs the refresh cookie). A wildcard `*` must force
      credentials **off** (browsers reject `*`+credentials) and warn in prod. `*` +
      credentials is both invalid and unsafe once public.
- [ ] **Rate limiting on auth.** Add `slowapi` (or equivalent), keyed on the **real client
      IP** resolved as `CF-Connecting-IP` → `X-Forwarded-For` → socket peer. This is
      critical behind Cloudflare/Caddy — without it every request looks like it comes from
      the proxy and the limit becomes global. Apply e.g. `5/minute` to `/auth/login` and
      `/auth/register`; wire a 429 handler. Disable it under `APP_ENV=development` so your
      test suite isn't throttled.
- [ ] **Secrets fail-loud in prod.** `JWT_SECRET` (and friends) must hard-fail at boot if
      unset in prod. Keep `.env` gitignored.

## 1.2 — Acquire a domain and put it on Cloudflare

- [ ] Register the domain via **Cloudflare Registrar** (born on CF nameservers → instantly
      active, no NS switch). Example: `espanol-app.com`.
- [ ] Pick the app hostname: a subdomain like `spanish.espanol-app.com`, leaving the bare
      apex free for a future landing page.
- [ ] Account/zone is Free plan — sufficient for everything here.

## 1.3 — Add the reverse proxy (Caddy) config to the app

- [ ] Add a `caddy/Caddyfile` with a shared routes snippet and a public site block:
      ```
      (app_routes) {
          @api    path /api/* /media/* /health
          handle @api { reverse_proxy backend:8000 }
          handle    { reverse_proxy frontend:8080 }
          # security headers on the SPA document:
          header {
              Strict-Transport-Security "max-age=31536000; includeSubDomains"
              X-Content-Type-Options    "nosniff"
              Referrer-Policy           "strict-origin-when-cross-origin"
              X-Frame-Options           "DENY"
              Permissions-Policy        "camera=(), geolocation=()"
          }
      }
      http://{$PUBLIC_HOSTNAME:disabled.invalid} {
          import app_routes
      }
      ```
      Defaulting `PUBLIC_HOSTNAME` to `disabled.invalid` makes the config safe to deploy
      *before* the domain/tunnel exist. Validate both states with `caddy validate`.
- [ ] **Gotcha:** Caddyfile changes via a single-file bind mount are **not** picked up by
      `caddy reload`. Apply them with `docker compose up -d --force-recreate caddy`.

## 1.4 — Create the Cloudflare Tunnel + the cloudflared overlay

- [ ] Add an opt-in compose overlay `docker-compose.tunnel.yml` with just the `cloudflared`
      connector (pin the image by digest so the sole public ingress can't silently
      auto-upgrade):
      ```yaml
      services:
        cloudflared:
          image: cloudflare/cloudflared:latest@sha256:<pin>
          command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
          restart: unless-stopped
          depends_on:
            caddy: { condition: service_healthy }
      ```
- [ ] In **Cloudflare Zero Trust → Networks → Tunnels**, create a tunnel (Cloudflared type,
      remotely-managed/token). Example name: `espanol-prod`. Copy the connector **token**.
- [ ] Add a **Public Hostname**: `spanish.espanol-app.com` → service **`http://caddy:80`**
      (cloudflared shares the compose network, so `caddy` resolves by name). The CNAME DNS
      record is auto-created and **Proxied** (orange cloud).
- [ ] Put `CLOUDFLARE_TUNNEL_TOKEN=` and `PUBLIC_HOSTNAME=spanish.espanol-app.com` in the
      prod `.env` (token is secret — never commit; rotate from the dashboard if leaked).
      Append the public origin to `ALLOWED_ORIGINS`.
- [ ] Bring it up alongside prod:
      ```bash
      docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d caddy cloudflared
      ```
      (Recreate caddy so it picks up `PUBLIC_HOSTNAME` + the new Caddyfile.)
- [ ] **Verify:** `https://<app>.<yourdomain>/api/health` → `200` and `/` → `200` through
      the tunnel. The connector should show Healthy (4 QUIC connections) in the dashboard.

**Operate the tunnel (this is your on/off switch):**
```bash
# expose
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d cloudflared
# hide again — app stays on Tailscale
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml stop cloudflared
```

## 1.5 — Edge security + apex redirect (Cloudflare dashboard)

- [ ] **Apex/www → app redirect.** Add placeholder proxied A records for `@` and `www`
      pointing at `192.0.2.1` (a reserved address that never routes — it exists only so a
      redirect rule can fire at the edge). Then **Rules → Redirect Rules**: match
      `(http.host eq "<yourdomain>") or (http.host eq "www.<yourdomain>")`, action
      URL-redirect (Dynamic) → `concat("https://<app>.<yourdomain>", http.request.uri.path)`,
      **301**, preserve query string.
- [ ] **Bot Fight Mode:** enable (Security → Bots).
- [ ] **Rate limiting rule** (Security → Rate limiting): match
      `starts_with(http.request.uri.path, "/api/auth/")`, per **IP**, e.g. **20 req / 10 s**
      → Block. This is the edge layer in front of your in-app slowapi limit.
- [ ] Leave **Under Attack Mode** off (emergency only). WAF managed rules run by default on
      Free.

## 1.6 — A note on Cloudflare Access (and why we skipped it)

Cloudflare **Access** can gate the *whole hostname* to an allow-list of invited emails at
the edge — a strong extra layer. **But:** activating any Zero Trust plan (even the $0
Free tier for ≤50 users) **requires a payment method on file**. We chose not to add a card
for the initial beta and relied on the **in-app invite gate + rate limiting** instead.

**Trade-off you're accepting:** without Access, the app *surface* is internet-facing — a
stranger can load the login page (they just can't register). That's fine for a tiny
hand-invited beta. **Mitigations:** keep the URL unpublished, and use the tunnel on/off
switch (§1.4) to expose only while a tester is actively online. **Hard trigger:** before
widening past a few hand-invited testers, either add Cloudflare Access (card) **or** move
to the dedicated VM (Phase 2). Don't run open self-service signup on the homelab box.

If you *do* add Access later: Zero Trust → Access → create an application covering the
hostname; policy allows the specific invited emails (or a one-time-PIN / restricted Google
IdP); everyone else is bounced *before* the app loads. Keep both Access and the app's own
login on — Access decides *who can load the site*, the app decides *who they are*.

## 1.7 — Release Phase 1

- [ ] Bump version + CHANGELOG; merge the branch to `main`.
- [ ] Take a fresh DB backup; deploy; apply the additive invite migration.
- [ ] Set `INVITE_REQUIRED_PROD=true`; recreate the backend.
- [ ] **Verify the gate end-to-end via the public edge:** `/auth/config` shows
      `{auth_enabled:true, invite_required:true}`; register with no code / bad code → 400;
      confirm **0 users leaked**.
- [ ] Mint the first invite (admin `POST /api/auth/invites`) and hand it to your tester.

### Phase 1 security checklist
- [ ] CORS is an explicit allowlist (not `*`) in prod.
- [ ] `/auth/login` + `/auth/register` rate-limited (in-app + Cloudflare edge rule).
- [ ] Registration requires a valid invite (`INVITE_REQUIRED_PROD=true`, verified via edge).
- [ ] Postgres/Redis are **not** routed by the tunnel (only `caddy:80` is) and have no
      `0.0.0.0` host port-forward — bind to localhost or the Tailscale IP only.
- [ ] Per-user resource/abuse quota in place if your app does expensive work (e.g. an
      LLM-job daily limit) — every tester can otherwise trigger unbounded backend cost.
- [ ] Fresh DB backup taken; restore path known.
- [ ] Either Cloudflare Access **or** the "move to dedicated VM before widening" trigger is
      written down and understood.

**Rollback for all of Phase 1:** `docker compose -f docker-compose.tunnel.yml down`
(+ unset `PUBLIC_HOSTNAME`, recreate caddy) → back to Tailscale-only. The app never stopped
working privately.

---

# Part 2 — Phase 2: Migrate to a dedicated VM (still invite-only)

**Trigger:** you've validated the closed beta and want prod off the homelab box onto an
isolated host — *before* you open self-service signup. Doing the migration while traffic is
still just invited testers means the risky move (new host, data migration, DNS cutover)
happens with no public stakes. The app stays invite-gated throughout; nothing about *who*
can sign up changes here — only *where* it runs.

**Phase 2 scope = provision + harden the VM, migrate data + media, cut the domain over.**
No account-model change (email/Turnstile is Phase 3).

**Exit state:** the same invite-only beta, now running on a hardened, internet-isolated
dedicated VM (key-only SSH, ufw, fail2ban, Tailscale-ringfenced); data + media migrated;
domain cut over to the VM's tunnel; Cloudflare cache purged; DB/Redis unreachable from the
internet; the box wired into the fleet's central monitoring + backups (§2.4). The homelab
box is decommissioned to **dev-only**.

## 2.1 — Provision the dedicated prod VM (one-time host setup)

We used a **Hetzner CX33** (4 vCPU / 8 GB / 80 GB, ~$9/mo, Ubuntu LTS). Anything similar
works. Do the base setup once:

- [ ] **User + SSH:** non-root sudo user; key-only; disable root login + password auth
      (`/etc/ssh/sshd_config.d/00-hardening.conf`).
- [ ] **Swap:** add ~2 GB swapfile (guards against OOM during the frontend/Vite build).
- [ ] **Firewall:** `ufw` allows **OpenSSH only** — the tunnel is outbound, so you need
      **no inbound web ports**. Add `fail2ban` for SSH.
- [ ] **Docker** via `get.docker.com`; add your user to the `docker` group.
- [ ] **Tailscale ringfence (important):** join the VM to your tailnet but **tag it**
      (e.g. `tag:public-ingress`) and add a tailnet ACL rule that restricts that tag to
      *only* the hosts it actually needs (for us: the LLM gateway at `vmhost:8080`) and
      nothing else. Verify: the allowed port connects; `:22` and other fleet hosts time out.
      A tagged node also has no key expiry. This stops a compromised public box from being a
      pivot into the rest of your tailnet.

### Shared edge (`/opt/edge`) — optional but recommended for multi-app
- [ ] `docker network create edge` (an external Docker network both the edge and each app
      join).
- [ ] `/opt/edge/docker-compose.yml` = one `caddy` + one `cloudflared` on the `edge`
      network. `/opt/edge/.env` holds `TUNNEL_TOKEN=` (`chmod 600`).
- [ ] `/opt/edge/Caddyfile` = one site block per app hostname, each importing a shared
      routes snippet. **Give each hostname its OWN `{ import … }` block** — a combined
      `http://a, http://b { … }` address line was observed to attach handlers to only the
      first host (the second returned an empty 200).
- [ ] Create a new tunnel (e.g. `apps-prod-hz`) with a Public Hostname → `http://caddy:80`.
      Use a staging hostname first (e.g. `hz.<yourdomain>`), swap to the real one at cutover.
- [ ] Each app becomes its own Compose project (`/opt/<app>`) with a `docker-compose.<vm>.yml`
      that **drops** Caddy/cloudflared and instead joins its `frontend`+`backend` to the
      external `edge` network. Postgres/Redis/worker stay on the app's private network and
      are never published.

## 2.2 — Deploy the app to the VM + migrate the data

- [ ] `git clone` the repo to `/opt/<app>`; author a **fresh prod `.env`**:
      - new strong `POSTGRES_PASSWORD` (DB is re-initialized here),
      - **rotated** `JWT_SECRET` (`openssl rand -hex 32`) — rotates any briefly-exposed value,
      - service URLs over Tailscale (for us `LLM_VM_URL=http://100.66.213.40:8080`),
      - keep the gates on during migration (`INVITE_REQUIRED_PROD=true`,
        `EMAIL_VERIFICATION_REQUIRED_PROD=false` until the Resend domain is verified),
      - `RESEND_API_KEY`, `EMAIL_FROM`, `TURNSTILE_SECRET` (+ frontend `VITE_TURNSTILE_SITE_KEY`
        build arg).
      - `chmod 600 .env` immediately.
      - **Put secrets into the file on the box, never paste them into a chat/ticket/AI
        session.** Type them straight into `.env` over SSH, or pipe a hidden prompt into a
        `sed` so the value never appears on screen or in shell history:
        ```bash
        read -rsp 'Paste API key: ' K && echo && \
          sed -i "s|^RESEND_API_KEY=.*|RESEND_API_KEY=${K}|" .env && unset K && \
          echo "set: $(grep -c '^RESEND_API_KEY=re_' .env)"   # 1 = OK, without revealing it
        ```
        (If you must verify a value, print only a length + prefix, never the whole secret.
        Public values like a Turnstile **site** key are fine to set directly — only protect
        actual secrets.) *Set one secret per command* — chaining several `read` prompts on one
        line can let the first paste get swallowed by the next `read`. If `sed` reports `0`,
        the `KEY=` line may be **missing** (not just empty); append it instead of replacing.
- [ ] **Build + run** the VM compose. If your frontend build needs a generated file that's
      gitignored (we have `frontend/version.json`), sync it in *before every build*:
      ```bash
      cp version.json frontend/version.json
      docker compose -f docker-compose.<vm>.yml up -d --build
      ```
- [ ] **Migrate the database — restore, don't bootstrap.** ⚠️ A long-lived app's Alembic
      chain often is **not** replayable from scratch (e.g. an early "all tables" snapshot
      migration that was regenerated after later ones landed → a from-scratch
      `alembic upgrade head` dies on "table already exists"). Establish schema by
      **restoring a dump of the current prod DB**, then applying only the *delta* on top:
      ```bash
      # on the old box:
      Scripts/backup-db.sh prod        # → Backups/prod_backup_*.sql
      scp Backups/prod_backup_*.sql <user>@<vm-public-ip>:/tmp/prod_restore.sql
      # on the VM (DB starts empty — no drop needed):
      docker compose -f docker-compose.<vm>.yml exec -T postgres \
        psql -U <user> -d <db> < /tmp/prod_restore.sql
      docker compose -f docker-compose.<vm>.yml exec -T backend \
        sh -c 'cd /app && alembic upgrade head'   # restored DB is stamped; applies only new migrations
      ```
      The plain dump carries the `alembic_version` row, so the delta applies cleanly.
- [ ] **Copy media files too (easy to forget).** If vocab images / TTS audio / uploads live
      on a Docker **volume** on disk, the DB dump only carries *pointers* (`image_path`,
      `audio_path`) — restore the DB and every card shows a broken image until a nightly job
      backfills. Tar the volume across:
      ```bash
      # old box → tarball → VM
      docker compose exec -T backend tar czf - -C /app/media . > /tmp/media.tgz
      scp /tmp/media.tgz <user>@<vm>:/tmp/
      cat /tmp/media.tgz | docker compose -f docker-compose.<vm>.yml exec -T backend tar xzf - -C /app/media
      ```
      (If your media is a disposable/regenerable cache, you can skip this and let it refill.)
      - *Transfer note:* the ringfenced VM (§2.1) usually **can't** reach the old box over
        Tailscale (the ACL only allows the few hosts it needs), so push dumps/media to the
        VM's **public SSH** from the old box, not over the tailnet.

### Ongoing deploys (dev → VM) + the git deploy key
- [ ] **The VM needs read access to your private repo.** A fresh `git clone` may have used a
      throwaway token; a later `git pull` then fails with `could not read Username for
      'https://github.com'`. Give the VM a **read-only deploy key** (cleaner than a PAT —
      scoped to one repo, revocable, can't push):
      ```bash
      # on the VM:
      ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "<app>-vm-deploy"
      printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' \
        >> ~/.ssh/config
      git -C /opt/<app> remote set-url origin git@github.com:<owner>/<repo>.git
      cat ~/.ssh/github_deploy.pub   # add to GitHub → repo → Settings → Deploy keys (READ-ONLY)
      ```
      Verify: `ssh -T git@github.com` → "successfully authenticated". (Deploy keys can take a
      moment to register; a first failure then success is normal.)
- [ ] **Workflow: develop on dev → commit + **push** → run a deploy script that the VM pulls
      from.** A `Scripts/deploy-to-<vm>.sh` that SSHes in, `git pull`s **origin/main**, backs
      up the VM DB, rebuilds (frontend `--no-cache`), `up -d`, optional delta-migrate, and
      verifies. Because the VM deploys from `origin/main`, the script should **warn on
      unpushed local commits** (else "I deployed" silently ships nothing). The old
      `deploy-to-production.sh` now targets only the retiring homelab stack — relabel it so
      nobody runs the wrong one.

## 2.3 — Cut over the domain to the VM

- [ ] Add the app's routes to `/opt/edge/Caddyfile` (its own site block importing the
      shared snippet). **Apply with `docker compose up -d --force-recreate caddy`, NOT
      `caddy reload`** — reload reports success but keeps serving old routes (new host →
      empty 200). Verify each host actually proxies (look for `Server: uvicorn` +
      `Via: 1.1 Caddy`, not `Server: Caddy`):
      ```bash
      docker run --rm --network edge curlimages/curl -s -i \
        -H 'Host: spanish.espanol-app.com' http://caddy/api/health   # → {"status":"ok"}
      ```
- [ ] **Move the public hostname** to the new tunnel (move the Public Hostname / DNS to the
      VM's `apps-prod-hz` tunnel). Update `ALLOWED_ORIGINS` (and Google authorized-origins
      if using OAuth) to the live domain.
- [ ] **Purge the Cloudflare cache after cutover.** If the edge served any empty 200s during
      a misconfig window, Cloudflare caches them (`cf-cache-status: HIT`, `content-length: 0`)
      and keeps serving blanks after you fix the origin. Zone → Caching → **Purge Everything**
      (or by hostname). Confirm with a cache-buster: `…/media/<f>.jpg?cb=1` → `MISS` + real
      bytes.
- [ ] **Lock down the VM:** no app publishes web ports (only outbound cloudflared + SSH).
      Postgres binds `127.0.0.1` for DB tooling only. Confirm DB/Redis are unreachable from
      the internet.
- [ ] **Verify** the full app over the public domain from off-network; security headers
      present (`curl -I`); `/auth/config` correct.
- [ ] **Decommission** the prod containers on the old homelab box — it becomes **dev-only**.
      Repoint your `sync-db-prod-to-dev.sh` (or equivalent) to pull from the new VM over
      Tailscale.
      - **Stop the old prod promptly — don't leave it running "as backup."** If it keeps
        `APP_ENV=production`, its **nightly crons keep firing**: double-loading any shared
        backend (for us the LLM VM) and **writing to the now-orphaned old DB**, so it drifts
        from the live one and becomes a *worse* rollback the longer it runs. `stop` it (keep
        the volumes) the moment the VM is verified; full-delete later once stable.
      - **Rollback while stopped** = `up -d` the old stack **+** move the DNS/tunnel hostname
        back. Reversible, ~2 min; you just lose the instant flip.
      - **Gotcha:** if `cloudflared` lives in a separate compose **overlay**
        (`docker-compose.tunnel.yml`), a plain `docker compose -f docker-compose.yml stop`
        **misses it** — the old connector keeps running. Stop it explicitly with both files:
        `docker compose -f docker-compose.yml -f docker-compose.tunnel.yml stop cloudflared`.

## 2.4 — Fleet integration: backups & system monitoring

Once the box is live, bring it into the fleet's central **monitoring (`mon1`)** and
**backup (`pbs1`)** systems. On a cloud box this is **not optional**: unlike a homelab VM
there is **no hypervisor image/snapshot safety net**, so the backup legs you set up here are
the *only* copy of the data.

**This work spans two privilege domains and the new box cannot do the central half itself.**
The box is tailnet-ringfenced (§2.1) and has no access to `pbs1`/`mon1`, so the steps are
split by **where they run / what access they need**, with an explicit hand-off in the
middle. Do them in order — the box's backup/scrape legs will sit broken until the fleet-side
registration (B) and the ACL (C) exist.

> **Exact commands live in the fleet ops docs — reference, don't re-derive:**
> `documentation/Guides/BACKUP_PLAN.md` (the **"Hetzner-prod DB leg"** note) and
> `documentation/Core/CURRENT_STATE.md` **§5/§6**. **Worked precedent:** box `fsn1-prod`,
> namespace `espanol-prod`. Substitute your box/ns throughout.

### A — On the new box  *(deploy session; sudo on the box)*

- [ ] **Tailscale up + tag the node** (`tag:public-ingress`) — already done in the §2.1
      ringfence; re-confirm it's up and tagged (everything below binds to the tailnet IP).
- [ ] **`node_exporter`, tailnet-bound.** The systemd unit **must** carry
      `After=tailscaled.service` **and** `Restart=always` — on cold boot the exporter races
      tailscaled and tries to bind the tailnet IP before it exists; without the ordering +
      restart it dies at boot and never comes back.
- [ ] **`postgres_exporter` (`:9187`, tailnet-bound).** Create a **least-privilege**
      `pg_monitor` role in the prod DB; point the exporter DSN at the prod DB **container**.
- [ ] **`cadvisor` (`:9101`, tailnet-bound).**
- [ ] **PBS client install. ⚠️ GOTCHA (Ubuntu 26.04):** the apt repo can't resolve
      `proxmox-backup-client` — it wants `libfuse3-3` but the box ships `libfuse3-4`. Install
      from **direct bookworm `.deb`s** (the client + `libfuse3-3`) plus `qrencode`.
- [ ] **DB backup leg:** `pg-backup-pbs.sh` + `/etc/pbs-db-backup.env` (scoped token,
      `PBS_NS`, `BACKUP_ID`, `METRIC_JOB=pbs-pg-<ns>`) + the **escrowed encryption key**
      — **SAVE THE PAPERKEY** (print via `qrencode`, store in escrow; lose it and every
      backup is unrecoverable) — + `/etc/cron.d/pg-backup-pbs` (**every 6h**) + the
      backup-status helper under `/opt/mon1/textfile/`. **Seed-run it and verify `rc=0`.**
- [ ] **Filesystem/uploads leg — if the app stores uploads or binaries on disk.** A cloud
      box has **no VM-image fallback**, so the DB leg + the uploads leg together are the
      *only* copy. This is **mandatory** whenever there's on-disk user data (not just the
      regenerable media cache).

> 🛑 **HAND-OFF — stop here.** The box is ringfenced and **cannot reach `pbs1` or `mon1` to
> register itself**: its DB leg can't push and its metrics can't be scraped until the
> fleet-side work exists. **Hand to the fleet operator** for B and C (they need the fleet SSH
> key, root on `pbs1`, and passwordless sudo on `mon1` — none of which the box has). Resume
> the box-side verification only after B + C are done.

### B — From the vmhost / fleet-operator session  *(fleet SSH key; root on `pbs1`; passwordless sudo on `mon1`)*

**On `pbs1`:**
- [ ] Create the **namespace** `<ns>`.
- [ ] Create a **least-privilege scoped token** — `DatastoreBackup` on
      `/datastore/store1/<ns>` **only** (no broader datastore access).
- [ ] Create prune job **`pj-<ns>`**: keep-last **24 / 14d / 8w**.
- [ ] **`ufw`-allow the box's tailnet IP → `:8007`** (backup push).

**On `mon1`:**
- [ ] Add scrape targets: **node**, **postgres**, **cadvisor**.
- [ ] Add a **blackbox-http probe** of the **public hostname**.
- [ ] Add the ns to the **`DBBackupStale` alert regex**.
- [ ] Add the DB to the console **`backups.py`** roster (**`DB_MAP` + `DB_DEFS`**).
- [ ] Add the node to the **console topology**.
- [ ] **`promtool` check → reload Prometheus → rebuild console → commit + push.**

**Docs:**
- [ ] Update `CURRENT_STATE.md` **§1/§2/§5/§6**, `OPEN_TASKS`, the **`BACKUP_PLAN` DB-leg
      row**, and the CR.

### C — Tailscale admin console  *(operator, browser)*

- [ ] ACL rule granting the box's **tag → `pbs1:8007`** (backup push). **Note: TWO layers
      gate `pbs1:8007` — the tailnet ACL *and* `pbs1`'s `ufw` (B above) — both are required;**
      one without the other silently blocks the push.
- [ ] Confirm the app's other tailnet needs are granted (e.g. **tag → `vmhost:8080`** for the
      LLM gateway).

### Fleet-integration gotchas (checklist)

- [ ] **hcloud exporter** auto-covers the box **only if it's in the same Hetzner project** —
      otherwise its host-level metrics are missing.
- [ ] **The `DBBackupStale` regex and `backups.py` rosters are HARDCODED** — a new ns is
      *not* picked up automatically; add it by hand or the backup is unmonitored (looks
      "green" because nothing is watching it).
- [ ] **Dev/prod split:** if the old box stays on as the **dev** tier, repoint its existing
      backup leg's `PG_CONTAINERS` at the **dev** container — its name changes
      (e.g. `espanol-postgres` → `espanol-postgres-dev`) — or that leg silently goes stale.
- [ ] **End-to-end verify from `mon1`:** scrape `up=1`, `probe_success=1`, the ns shows
      **fresh** in `pbs_group_last_backup_seconds`, and **no `DBBackupStale`** firing.

### Phase 2 security checklist
- [ ] Dedicated VM hardened (key-only SSH, root/password off, ufw SSH-only, fail2ban, swap).
- [ ] Tailscale node tagged + ACL-restricted to only the hosts it needs.
- [ ] Fresh `POSTGRES_PASSWORD` + rotated `JWT_SECRET`; `.env` is `chmod 600`.
- [ ] DB/Redis bound to localhost/Docker-network — unreachable from the internet.
- [ ] No app publishes web ports; only outbound cloudflared + SSH on the host firewall.
- [ ] Data + media migrated and verified loading; Cloudflare cache purged post-cutover.
- [ ] Security headers present on the public document (HSTS, nosniff, Referrer-Policy,
      X-Frame-Options).
- [ ] Gate unchanged — `INVITE_REQUIRED_PROD=true` still enforced on the VM.
- [ ] Old homelab prod **stopped** (not left running) to avoid cron/DB drift.
- [ ] Box integrated into fleet monitoring + backups (§2.4): DB (and uploads, if any) backup
      legs seeded `rc=0`; `mon1` scrapes/probe green; no `DBBackupStale` firing.

**Rollback for Phase 2:** `up -d` the old homelab stack **+** move the DNS/tunnel hostname
back to it (reversible, ~2 min). Until you decommission the old box, that's your instant
fallback; the app also still works on Tailscale throughout.

---

# Part 3 — Phase 3: Full public (email verification, open the gate)

**Trigger:** you want to widen beyond hand-invited testers — drop the invite gate so people
self-register. Because prod is already on the hardened VM (Phase 2), opening up no longer
exposes your home network; this phase is purely an account-model change.

**Phase 3 scope = account lifecycle (email verify + Turnstile), flip the gates, then size
capacity for the wider cohort.**

**Exit state:** anyone can sign up (email-verified); bots hit Turnstile at signup; the
invite gate is off. This is the end of "get it public" — monetization/SaaS is a separate,
later effort.

## 3.1 — Build the account lifecycle (dormant flags, test in dev first)

- [ ] **Email verification via 6-digit OTP.** Add an `EmailToken` model + migration
      (`code_hash` = sha256, `expires_at` ~15 min, `attempts` cap). Add a `services/email.py`
      that sends via **Resend** over HTTPS — and **logs the code instead of sending when
      `RESEND_API_KEY` is unset**, so the whole flow is testable in dev with no email.
      Endpoints: `/verify-email`, `/resend-code` (with cooldown), `/forgot-password`,
      `/reset-password` (uniform 200, hashed single-use codes; reset revokes all sessions).
      Login returns `403 email_unverified` when `EMAIL_VERIFICATION_REQUIRED` is on and the
      account is unverified. Dormant flag `EMAIL_VERIFICATION_REQUIRED` / `_PROD`
      (byte-identical when off).
- [ ] **Bot protection — Cloudflare Turnstile on signup.** Add `services/turnstile.py`
      (siteverify; **fail-open** if Cloudflare is unreachable so an outage doesn't block all
      signups), accept a `turnstile_token` on register, dormant when `TURNSTILE_SECRET`
      empty. Frontend widget dormant when `VITE_TURNSTILE_SITE_KEY` unset. Get both keys
      (site + secret) from Cloudflare → Turnstile (list **both** the staging and the real
      hostname on the widget so it works pre- and post-cutover); the **site key is a frontend
      build arg**, the **secret is a backend env var**.
      - **Wire the site key all the way through the build, or it never reaches the bundle.**
        It's not enough for the JS to read `import.meta.env.VITE_TURNSTILE_SITE_KEY` — Vite
        only bakes in vars present **at build time**. Add `ARG VITE_TURNSTILE_SITE_KEY` +
        `ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY` to the frontend Dockerfile
        **and** pass it as a compose build arg (`VITE_TURNSTILE_SITE_KEY: ${VITE_TURNSTILE_SITE_KEY:-}`,
        sourced from `.env`). The site key is **public** (it ships in the HTML), so committing
        the wiring is fine — only the value lives in `.env`. Changing it requires a frontend
        **rebuild** (not just a backend recreate); verify by grepping the built bundle for the
        key. Bumping the site key needs no secret handling; bumping the secret needs a backend
        recreate.
- [ ] **Frontend lifecycle pages:** `VerifyEmail`, `ForgotPassword`, `ResetPassword` +
      routes + "Forgot password?" on login + Signup→verify redirect + i18n.
- [ ] **Admin invites + users page** (`/admin/users`): create/copy/revoke invites;
      disable/enable, promote/demote users, with self-lockout + last-admin guards.
- [ ] *(Optional / as-needed)* Google OAuth, an onboarding wizard with a starter pack,
      and an admin usage/login analytics dashboard. We deferred OAuth (email+OTP covered the
      ask) and reused an existing onboarding flow.

## 3.2 — Go public (flip the gates)

- [ ] **Verify the Resend sender domain** first: add the DKIM + SPF DNS records Resend gives
      you into Cloudflare DNS and wait for Resend to show "verified." Email won't deliver
      (or will land in spam) until this is green. (Resend's **"Auto configure"** writes the
      records straight into Cloudflare — easiest when the long DKIM key is truncated in the UI.
      With Cloudflare these are all TXT/MX, so the proxied-CNAME grey-cloud caveat doesn't
      apply.) **Smoke-test delivery without flipping any gate** via the **forgot-password**
      flow — it sends a real code to an existing user independent of the verify flag; watch
      the backend log for `email.sent status=200`.
      - **New-domain deliverability:** the *first* emails from a brand-new sending domain often
        land in **spam** even with DKIM/SPF passing — reputation builds with volume. Mitigate:
        add a **"check your spam folder"** hint on the verify-email screen, and know the **free
        tier caps** (Resend: 100/day) so a bot signup flood can't both exhaust your quota and
        rack up cost — another reason Turnstile is on before opening the gate.
- [x] Set `EMAIL_VERIFICATION_REQUIRED_PROD=true` and `INVITE_REQUIRED_PROD=false`; recreate
      the backend. Now anyone can sign up, but must verify their email; bots hit Turnstile.
      **Done 2026-06-28** — verified `{"auth_enabled":true,"invite_required":false}` via the
      public edge. **Recreate ONLY with `-f docker-compose.hetzner.yml`** (a stray
      `docker compose up -d backend` defaulted to the homelab file and dropped the backend off
      `edge` → 502 until recreated under the right file; now gotcha #18).
- [ ] Re-confirm rate limits + abuse quotas are sized for *unauthenticated* traffic.
- [ ] Test the full path on prod: signup → receive code by email → verify → log in; and
      forgot-password → reset → old sessions revoked.

## 3.3 — Capacity for higher volume (if your app does heavy backend work)

More users → more concurrent expensive work (for us, LLM jobs) than one local GPU/box can
serve. If your app routes such work **by task name through a gateway** (model/impl chosen
server-side), scaling is an infra/routing change with **no app redeploy**. Options:
keep local but raise throughput (e.g. continuous batching / add hardware); outsource the
*interactive* path to a commercial API (cheap per-call, high concurrency); or hybrid
(commercial for interactive/peak, local for heavy shared batch). Measure interactive volume
during beta to pick the crossover. Note: commercial APIs send user content to a third party
— use a no-training tier and disclose it in your privacy policy.

## 3.4 — After go-public: decommission the old prod (don't skip this)

Once the dedicated VM is serving the public and you've smoke-tested signup, retire the old
homelab prod stack — but **gradually**, keeping it as a warm fallback through the first weeks.

- [ ] **Stop the old prod stack** (it becomes dev-only). Stop *every* compose project,
      including any separate tunnel/cloudflared overlay (see gotcha #16) and the worker (so
      its nightly crons stop firing and stop drifting a now-dead DB). Stopped containers with
      `restart: unless-stopped` stay down across reboots — no teardown required to be "off."
- [ ] **Keep the old containers AND their volumes** for now — a stopped stack costs nothing
      and is your instant rollback if the new box misbehaves in week one. Do **not** `down -v`
      the old prod DB until the VM is proven (we kept ours; full teardown is a one-liner later:
      `docker compose -f <prod> -f <tunnel-overlay> down` keeps volumes, add `-v` to discard).
- [ ] **Repoint your prod→dev DB sync at the new box.** If you have a `sync-prod-to-dev`
      script, it almost certainly dumped a *local* prod container (`docker compose exec
      postgres pg_dump`, `docker cp prod-backend …`). Prod now lives on the VM, so rewrite it
      to pull over SSH: `ssh user@box 'docker exec <prod-postgres> pg_dump -U… …' > dump.sql`
      and `ssh user@box 'docker exec <prod-backend> tar czf - -C /app/media/<imgs> .' | …`.
      Make the host an overridable env var. **Validate the SSH-sourced dump/media stream
      before** wiring in the destructive local-dev rebuild (dump to a temp file, grep for an
      expected table) so a bad path doesn't wipe dev for nothing.
- [ ] **Confirm DNS + tunnel really moved.** The public hostname should resolve through the
      *new* box's tunnel; the old tunnel being stopped must not 5xx the live site. (You already
      cut this over in Phase 2/3 — this is the "is the old box truly load-bearing-free?" check.)

### Phase 3 security checklist
- [ ] Resend domain DKIM/SPF verified before `EMAIL_VERIFICATION_REQUIRED_PROD=true`.
- [ ] Email delivery smoke-tested (forgot-password path) before flipping any gate.
- [ ] Turnstile live on signup (`TURNSTILE_SECRET` + `VITE_TURNSTILE_SITE_KEY` set,
      site key confirmed present in the built bundle).
- [ ] `EMAIL_VERIFICATION_REQUIRED_PROD=true` and `INVITE_REQUIRED_PROD=false` set; full
      signup → email code → verify → login path tested on prod.
- [ ] Rate limits + abuse quotas re-sized for *unauthenticated* traffic.
- [ ] CSP considered (worth adding but test it in browser — strict `script-src` can collide
      with Cloudflare Bot Fight Mode's injected inline script; start Report-Only).

---

# Part 4 — The gotchas catalog (hard-won, save yourself the debugging)

These bit us; they'll bite you too if your stack is similar.

1. **`caddy reload` does not reliably apply new site blocks / Caddyfile edits via bind
   mount.** It reports success but keeps serving old routes. Always
   `docker compose up -d --force-recreate caddy`.

2. **Combined Caddy address line drops handlers.** `http://a, http://b { … }` attached
   handlers to only the *first* host (second returned empty 200). Give each hostname its
   own `{ import … }` block.

3. **Cloudflare caches empty 200s.** Any blank responses served during a misconfig window
   get cached (`HIT`, `content-length: 0`) and persist after you fix the origin. **Purge
   Everything** after cutover; verify with a `?cb=N` cache-buster.

4. **`docker compose exec -T` reads stdin.** Inside a script piped over SSH (heredoc),
   an `exec -T` without `< /dev/null` swallows the rest of the script. Add `< /dev/null`
   to every `exec -T` that isn't intentionally being fed input.

5. **Gitignored build inputs.** If the frontend Vite build context needs a gitignored file
   (e.g. `frontend/version.json`), `cp` it in *before every build* or the build uses stale
   data. Bake this into the deploy script.

6. **Alembic chain not replayable from scratch.** Don't bootstrap a fresh prod DB with
   `alembic upgrade head` if migration 001 is a regenerated "all tables" snapshot — it dies
   on "already exists." Restore a dump (which carries `alembic_version`) and apply only the
   delta. (See §2.2.)

7. **Media is on a volume, not in the DB.** The DB dump carries only path pointers. Copy the
   media volume separately or every image 404s until a backfill job runs. (See §2.2.)

8. **Rate-limit on the proxy's IP, not the client's.** Behind Cloudflare+Caddy every request
   appears to come from the proxy. Resolve the real IP via `CF-Connecting-IP` →
   `X-Forwarded-For` → socket peer, or your per-IP limit becomes a global limit.

9. **Cloudflare Access needs a card even on the Free tier.** The "$0 for ≤50 users" plan
   still requires a payment method to activate. Budget for this or use the in-app invite
   gate (and the move-to-VM trigger) instead. (See §1.6.)

10. **`*` + credentials CORS is invalid.** Browsers reject wildcard origin with credentials.
    Use an explicit allowlist in prod; only then can you keep `allow_credentials=True`.

11. **Shared org-level keys + non-admin users.** If some service keys (image/email provider)
    are org-level, make settings resolution fall back to an admin's row before `.env`, or
    those features silently no-op for non-admin users once you have multiple users.

12. **DKIM/SPF before flipping email on.** Verification emails won't deliver until the Resend
    sender domain is DNS-verified. Keep `EMAIL_VERIFICATION_REQUIRED` off (codes are logged)
    until the domain is green.

13. **Rotate secrets that sat in a group-readable `.env`.** If `.env` was `0664` even briefly,
    rotate `JWT_SECRET` and the tunnel token. The Phase 2 VM migration is a natural rotation
    point (fresh `.env`, new tunnel).

14. **The VM can't `git pull` a private repo.** `could not read Username for
    'https://github.com'` on deploy — the clone had no persistent creds. Add a **read-only
    SSH deploy key** on the VM and switch the remote to `git@github.com:…` (§2.2). New deploy
    keys can take a beat to register (first-fail-then-succeed is normal).

15. **Turnstile (or any `VITE_*`) key missing from the built bundle.** Reading
    `import.meta.env.VITE_…` in JS isn't enough — Vite only inlines vars present **at build
    time**. Thread it through the Dockerfile (`ARG`+`ENV`) *and* the compose build arg, then
    **rebuild** the frontend (a backend recreate won't do it). Grep the built bundle for the
    value to confirm. (See §3.1.)

16. **Stopping the old prod can miss the tunnel + leave crons running.** If `cloudflared` is
    in a separate compose overlay, `docker compose -f docker-compose.yml stop` won't stop it —
    pass both `-f` files. And an old prod left running keeps firing nightly crons (double
    backend load + DB drift) — `stop` it promptly, don't let it linger. (See §2.3.)

17. **Env var reads as "(empty)" when it's actually absent.** `grep VAR= .env` returning
    nothing looks identical to `VAR=` with an empty value, so a `sed -i "s|^VAR=.*|…|"` finds
    nothing to replace and silently no-ops. If a "set" check reports `0`, the line is missing —
    append it (`echo "VAR=…" >> .env`) rather than `sed`-replacing.

18. **Wrong compose file knocks a service off the shared `edge` network → instant 502.**
    The repo ships two prod compose files (homelab `docker-compose.yml` *and* VM
    `docker-compose.hetzner.yml`) with the **same `container_name`**, but only the VM file
    declares the external `edge` network + `networks: [default, edge]`. An ad-hoc
    `docker compose up -d backend` (no `-f`, so it defaults to `docker-compose.yml`) recreates
    the *same-named* container with only the private network — it silently drops off `edge`,
    and the Cloudflare edge returns **502** for the proxied paths while `localhost:8000`
    *inside* the container still answers (the tell). Recover by recreating under the correct
    file (`-f docker-compose.hetzner.yml up -d backend`, re-attaches `edge` natively).
    **Always pass the explicit `-f <vm-compose>` for every ad-hoc command on the box** (the
    deploy script already does); after any backend recreate, assert `edge` is present:
    `docker inspect <c> --format '{{range $k,$_ := .NetworkSettings.Networks}}{{$k}} {{end}}'`.

---

# Part 5 — What's portable vs. app-specific

**Fully portable (the method):** the Cloudflare Tunnel + cloudflared + Caddy edge pattern;
the dormant-env-flag approach to every gate; the three-phase strategy; the dedicated-VM
hardening + Tailscale ringfence; the restore-don't-bootstrap DB migration; the shared-edge
multi-app layout; and the entire gotchas catalog.

**App-specific (you re-implement per app):** the actual `Invite` / `EmailToken` models and
auth endpoints; the exact env-flag names; which paths the reverse proxy routes (`/api`,
`/media`, …); the heavy-work capacity strategy (only if your app has expensive backend
work); and concrete values (domain, container names, ports, IPs).

**The one principle that made all of it safe:** *every gate ships off as a dormant flag and
behaves identically to "before" until armed.* Deploy the code dark, test it, arm it with a
flag flip, roll back with a flag flip. Combined with Tailscale staying up the whole time,
there is no point in any of the three phases where a mistake takes the app down for your
existing use.
