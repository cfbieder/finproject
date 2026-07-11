# Deploy to Public — Private → Browser-Accessible (master playbook)

> **Pack role:** canonical runbook for exposing a Tailscale-private app to the public
> internet. Successor to the EspañolApp-only playbook (now in
> [`archive/deploy-to-public-espanolapp_2026-06-28.md`](archive/deploy-to-public-espanolapp_2026-06-28.md)).
> For the single-host dev/prod architecture this deploys *onto*, see
> [`infra-bootstrap.md`](infra-bootstrap.md); for the co-tenant shared-edge variant, see
> [`deploy-to-shared-edge.md`](deploy-to-shared-edge.md).
>
> **Last reviewed:** 2026-07-06.

**One reusable runbook for taking an app that runs privately on a homelab/VM behind Tailscale (or similar) and making it reachable from a browser over the public internet — safely, with no open inbound ports.**

It has a **shared foundation** (a Cloudflare Tunnel front door that works for any app) and then **two branches** for the *"who gets in"* layer — pick one:

- **Branch A — CLOSED (fixed allow-list).** A known set of users (staff, a team) log in via **Cloudflare Access** (Google SSO / email OTP) at Cloudflare's edge. No signup flow; onboarding = add an email to a policy. *Best for internal tools / admin apps.* — worked reference: **OCME** (`klinika.ocme.pl`, CR086).
- **Branch B — OPEN (public self-service).** Anyone can sign up; you gate with **in-app invite codes → email verification + bot protection**, and (recommended) migrate prod onto a dedicated VM before opening the gate. *Best for a public product/SaaS.* — worked reference: **EspañolApp** (`spanish.espanol-app.com`).

Both branches share Parts 0–1 and the cutover/rollback discipline in Part 3. They differ only in Part 2. Every app-specific value is shown as a concrete example **and** a `<placeholder>` you substitute.

> **Design rule that makes every step safe: each gate is a dormant env flag.** Invite gating, email verification, bot protection, Access itself — ship *off*, behaving byte-identically to "before," and arm each independently by flipping a flag or bringing up a connector. Roll back by flipping the flag / stopping the connector, not by reverting a deploy. Tailscale (or your existing private path) **stays on the whole time** and is your ultimate fallback.

---

# Part 0 — Primer + PICK YOUR BRANCH

## The core problem

Your app runs on a box reachable only over **Tailscale** (a private mesh VPN) — great for you, useless for someone you want to give browser access to. Going public the naive way means (1) opening ports 80/443 on your router/firewall (exposes your IP, invites attacks), (2) getting a domain + TLS cert, and (3) making sure only the right people get in. We avoid (1) entirely with a **Cloudflare Tunnel**, let Cloudflare handle (2), and pick a branch for (3).

## The pieces and how they fit

```
 visitor ──HTTPS──▶ Cloudflare edge ──encrypted tunnel──▶ cloudflared ──▶ reverse proxy ──▶ your app
                    (TLS, WAF, rate-limit,               (on your box,    (nginx/Caddy)    (frontend +
                     Access gate [Branch A],              dials OUT)                        backend API)
                     Turnstile [Branch B])
```

- **Tailscale / your private path** — stays on throughout; public exposure is added *alongside* it. Switch the public side off and you still reach the app privately. This is your rollback.
- **Domain + Cloudflare** — put a domain on Cloudflare (Cloudflare Registrar = instant, no NS migration). Cloudflare terminates **TLS** (you manage no certs), runs a **WAF + DDoS** shield, and can add **rate-limiting / bot protection**. Routes are **per-hostname**, so gating `app.example.com` never touches `www.example.com` in the same zone.
- **Cloudflare Tunnel + `cloudflared`** — a tiny connector that runs *on your box* and dials **outbound** to Cloudflare, holding an encrypted connection open. Cloudflare sends visitor traffic back down it. Because it's outbound, **you open zero inbound ports** and your real IP is never exposed. Authenticated by one secret **token** from the dashboard.
- **Reverse proxy (nginx or Caddy)** — one front door that routes each request to the right internal service (`/api/*`, `/media/*` → backend; everything else → the SPA) and stamps on security headers. Cloudflare already did TLS, so the proxy speaks plain HTTP internally.
- **The "who gets in" gate — this is where the branches split:**
  - **Branch A:** **Cloudflare Access** gates the *whole hostname* to an allow-list at the edge — the user proves identity (Google/OTP) *before the app loads*. The app keeps its own login underneath (defense-in-depth).
  - **Branch B:** the app itself gates registration — **invite codes** first, then **email verification + Turnstile** — so a stranger who finds the URL can load it but can't get an account until you open the gate.

## PICK YOUR BRANCH

| | **Branch A — CLOSED** | **Branch B — OPEN** |
|---|---|---|
| Who gets in | Fixed allow-list (staff/known emails) | Anyone (self-service, email-verified) |
| The gate | **Cloudflare Access** at the edge | **In-app** invite → email-verify + Turnstile |
| Signup flow | None (you add emails) | Full (register/verify/reset) |
| Needs email service | No | Yes (Resend + DKIM/SPF) |
| Needs a dedicated VM | Optional | Recommended before opening the gate |
| Cloudflare cost | Zero Trust Free (**card on file required**) | None required (skip Access) |
| Onboard a user | Add email to Access policy (~30 s) | They self-register |
| Reference instance | OCME `klinika.ocme.pl` | EspañolApp `spanish.espanol-app.com` |
| Go to | **Part 2A** | **Part 2B** |

**Why Branch B is staged (its own sub-strategy):** going straight to "full public on a hardened VM with email" is a lot of build before one tester logs in. So Branch B ships *"an invited person can use the app over the internet"* first (Phase 1), does the risky host-migration while traffic is still just invited testers (Phase 2), and only then opens the gate (Phase 3). Each phase is independently shippable and reversible.

---

# Part 1 — SHARED FOUNDATION (both branches)

## Prereqs
- The domain's DNS is on **Cloudflare** (any plan).
- **Branch A only:** a **payment method on file** — activating Zero Trust, *even the $0 Free tier (≤50 users)*, requires a card. No charge for allow-list Access usage, but you can't create the Access app without it.
- You can run one small container (or host service) next to the app for `cloudflared`.
- The app already has **real per-user auth**, per-user data scoping, and admin-gated mutations. Don't expose an app that trusts a single implicit user.
- Compliance: if data is sensitive, confirm the **Cloudflare DPA** and set **EU data-localization** on the zone.

## 1.1 — Acquire a domain and put it on Cloudflare
- Register via **Cloudflare Registrar** (born on CF nameservers → instantly active, no NS switch), e.g. `example.com`.
- Pick the app hostname — a subdomain like `app.example.com` (or `klinika.ocme.pl`), leaving the apex free for a landing page.
- Free plan is sufficient for everything here.

## 1.2 — Put a reverse proxy in front of the app
One front door routes by path and stamps security headers. Use whichever you already run — the role is identical.

**nginx example (OCME):** single `server` block on `:80`, `location /api/ { proxy_pass http://127.0.0.1:3022/; }`, everything else serves the SPA; security headers incl. CSP via `add_header` (⚠️ nginx does **not** inherit `add_header` into a `location` that sets its own — repeat headers in every such block).

**Caddy example (EspañolApp):**
```
(app_routes) {
    @api path /api/* /media/* /health
    handle @api { reverse_proxy backend:8000 }
    handle     { reverse_proxy frontend:8080 }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options    "nosniff"
        Referrer-Policy           "strict-origin-when-cross-origin"
        X-Frame-Options           "DENY"
    }
}
http://{$PUBLIC_HOSTNAME:disabled.invalid} { import app_routes }
```
Defaulting `PUBLIC_HOSTNAME` to `disabled.invalid` makes it safe to deploy *before* the domain/tunnel exist. ⚠️ **Caddyfile edits via a single-file bind mount are NOT picked up by `caddy reload`** — apply with `docker compose up -d --force-recreate caddy`.

⚠️ **Set the SPA cache policy in this proxy from day one** (gotcha #29): content-hashed `/assets/*` → `immutable`, `index.html` → `no-store`/`no-cache`. A code-split SPA served with no `Cache-Control` will eventually hand someone a stale `index.html` pointing at chunk hashes a redeploy replaced → "Failed to fetch dynamically imported module." Doing it here means redeploys never need a cache purge. Template: `script-library.md` §8.

## 1.3 — Create the Cloudflare Tunnel + run the connector
1. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared.** Name it (e.g. `<app>-prod`), save, and **copy the connector token** (the long string after `--token`). Don't run their install command — you run the connector yourself.
2. Add a **Public Hostname**: `app.example.com` → your origin. Two patterns depending on the connector's network:
   - **Container-network:** `http://caddy:80` (cloudflared shares the compose network, resolves the proxy by name).
   - **Host-network:** `http://127.0.0.1:80` (connector runs `network_mode: host`, reaches a host-local port).
   The proxied DNS record (orange cloud) is auto-created.
3. Run the connector as a **separate, opt-in compose overlay** so it stays inert until you bring it up and never crash-loops without a token:
   ```yaml
   # docker-compose.tunnel.yml  (keep SEPARATE from the app stack)
   services:
     cloudflared:
       image: cloudflare/cloudflared:latest@sha256:<pin>   # pin by digest — see hardening
       container_name: <app>-cloudflared
       restart: unless-stopped
       # host-network form:
       network_mode: host
       command: tunnel --no-autoupdate run
       env_file: [ cloudflared/.env.cloudflared ]          # TUNNEL_TOKEN=... (gitignored!)
   ```
   ```bash
   echo 'TUNNEL_TOKEN=<token>' > cloudflared/.env.cloudflared   # secret — never commit
   docker compose -f docker-compose.tunnel.yml up -d
   docker compose -f docker-compose.tunnel.yml logs -f          # expect "Registered tunnel connection" (×4)
   ```
   (Alternative: host service — `cloudflared service install <TOKEN>` via the pkg.cloudflare.com repo.)
4. **Verify:** `https://app.example.com/health` → `200` through the tunnel; connector shows **Healthy** (4 QUIC connections) in the dashboard.

**The tunnel is your on/off switch (rollback):**
```bash
docker compose -f docker-compose.tunnel.yml up -d cloudflared    # expose
docker compose -f docker-compose.tunnel.yml down                 # hide — app stays on Tailscale
```

## 1.4 — Shared hardening (do this on both branches)
- **Real client IP = `CF-Connecting-IP`.** Behind Cloudflare, the origin sees Cloudflare's IP on every request. Anything that rate-limits, audit-logs, or geo-gates **by IP** must resolve the true client IP from `CF-Connecting-IP` (→ `X-Forwarded-For` → socket peer), or per-IP limits become global and audit logs record the proxy. (nginx: `proxy_set_header X-Real-IP $http_cf_connecting_ip;`.)
- **Route ONLY the web origin through the tunnel.** One public-hostname route to the app's HTTP port. **Never** route a DB/Redis/admin/SSH port — a tunnel route bypasses your host firewall. Keep datastores bound to `127.0.0.1`/the private network with no `0.0.0.0` publish.
- **Pin the connector image by digest** (`…@sha256:<pin>`) so your sole public ingress can't silently auto-upgrade.
- **Close inbound web ports at the host firewall.** The connector dials out, so `80/443` need not be open inbound at all (`ufw` allow **SSH only**). SSH stays on your admin plane/VPN.
- **Token is a secret** — gitignore `.env.cloudflared`; **type it into the file over SSH, never paste it into a chat/ticket/AI session** (beware screenshots — a partial token on screen is reason enough to rotate). Rotate from **Tunnel → Configure → Refresh token** if exposed.
- **Cloudflare caches responses.** After a config/route/CSP change — especially if the origin briefly served blanks/errors — **Caching → Purge Everything** and re-test with a `?cb=1` cache-buster, or you'll keep seeing the stale response.

Now go to **Part 2A** (closed) or **Part 2B** (open).

---

# Part 2A — BRANCH A: CLOSED (Cloudflare Access allow-list)

**Outcome:** `https://app.example.com` shows a Cloudflare login (Google / email OTP); only allow-listed emails pass; then your app's own login. Onboarding a user = add their email to a policy. No signup flow.

## 2A.1 — Add an identity provider (once per Cloudflare org, reusable across apps)
`Access controls → Authentication`. **One-time PIN** (email) is on by default — zero setup. To add **Google**:
1. Google Cloud Console → new project → **OAuth consent screen** (**Audience: External**).
2. **Credentials → Create OAuth client ID → Web application**:
   - **Authorized JavaScript origins:** `https://<team>.cloudflareaccess.com`
   - **Authorized redirect URI (exact, critical):** `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
3. Paste the **Client ID + Secret** into Cloudflare's Google IdP → **Save → Test**.

Your **team domain** is under `Settings → Team domain` (e.g. `empty-disk-d6a2.cloudflareaccess.com`).

## 2A.2 — Create the Access application + allow-list policy
`Access controls → Applications → Add → Self-hosted`:
- **Destination / public hostname:** the hostname from Part 1.3.
- **Authentication:** leave **"Accept all available identity providers" On** (offers Google **and** OTP).
- **Policy (Builder):** Action **Allow**, name it (`Staff allow-list`), **Include → Emails →** add each allowed address (start with just yours). **Policies are default-deny — with no policy, nobody gets in.**
- Confirm the **Preview** shows POLICIES + DESTINATIONS populated, then **Create**.

## 2A.3 — App-side follow-ons (these cause the "works for me, not them" bugs)
- **CSP `connect-src` + `frame-src` (do this for any SPA with a Content-Security-Policy).** On a *fresh* browser's first API call, Access 302-redirects the XHR to `https://<team>.cloudflareaccess.com/...` to mint the per-app cookie. A strict `connect-src 'self'` **blocks that redirect** → the whole app fails with `TypeError: Failed to fetch`, **only for users who don't already hold the app cookie** (so the person who set it up never sees it). Add your team domain up front:
  ```
  connect-src 'self' https://<team>.cloudflareaccess.com;
  frame-src   'self' https://<team>.cloudflareaccess.com;
  ```
  This keeps the API fully gated — you're only permitting Access's own handshake. If CSP is set per-`location` in nginx, repeat it in every block.
- **CORS / allowed origins:** add `https://app.example.com` to the app's allowed origins (many apps split a comma-list) and reload.
- **App's own OAuth** (if it has Google login etc.): add the new hostname to *its* authorized origins/redirects too — separate from the Access IdP.
- **Cookies:** new hostname = fresh cookie scope; users re-login once.
- **Machine-to-machine callers** of the same hostname must **not** go through Access (interactive login breaks them) — give them a **Service Token** (header-based bypass policy) or keep them on the private (Tailscale) address.
- **⚠️ PWA / service worker behind Access — decide BEFORE shipping one (see gotchas #26–28).** A caching service worker and Cloudflare Access are mutually hostile: a SW that serves navigations from cache prevents the expired-session re-auth from ever reaching the network, the Access 302 is fatal to SW *script* downloads (so a stuck SW can't fetch its own replacement), and long-cached `sw.js` compounds it for days. If the app does **not** need offline caching (most internal/staff CRMs don't), **ship no caching SW** — it removes the entire failure class. If it registers one anyway (Vite PWA plugin defaults to this), you must, up front: (a) `registerType: 'autoUpdate'` + `navigateFallback: null` so navigations hit the network; (b) a **self-destroying stub** ready as the escape hatch for already-stuck devices; (c) a public **Bypass** Access app for `/sw.js` + `/workbox-*` so devices can always fetch the SW; and (d) exact-match, no-cache nginx headers for `sw.js`. Simplest safe default: no caching SW; keep the web-app manifest for home-screen install (that needs no SW).

## 2A.4 — Verify from a COLD browser, then operate
- ⚠️ **Test from a browser that has never authenticated to this app** (different machine, or cleared incognito). The setup operator's warm Access cookie *masks* the CSP/first-call bugs; "works on my machine" is not a valid test here.
- Cold flow: `https://app.example.com` → gate (try **both** Google and OTP) → app loads → app login succeeds → exercise a **data page** (not just the landing); DevTools Console shows **no** `Failed to fetch`/CSP-blocked messages.

| Task | How |
|---|---|
| Onboard / offboard | Access → Applications → *app* → policy → add / remove email |
| Force re-login (one app) | visit `https://app.example.com/cdn-cgi/access/logout` |
| Force re-login (org) | visit `https://<team>.cloudflareaccess.com/cdn-cgi/access/logout` |
| Cleanest repeat test | incognito window |
| Rotate connector token | Tunnel → Configure → Refresh token → update `.env.cloudflared` → `up -d` |
| Roll back the public path | `docker compose -f docker-compose.tunnel.yml down` |

→ Then **Part 3** for the cutover-with-fallback discipline.

---

# Part 2B — BRANCH B: OPEN (public self-service, three phases)

**Strategy:** ship the smallest safe thing first. Phase 1 = invite-only on your existing box; Phase 2 = migrate to a dedicated VM (still invite-only); Phase 3 = email-verified self-service, gate open.

| | Phase 1 — Closed beta | Phase 2 — Dedicated VM | Phase 3 — Full public |
|---|---|---|---|
| Who can sign up | Invite-code holders | Invite-code holders | Anyone (email-verified) |
| Runs on | Existing box | Dedicated cloud VM | Dedicated cloud VM |
| Email | Not needed | Not needed | Resend + DKIM/SPF |
| Bot protection | Edge rate-limit | Edge rate-limit | + Turnstile on signup |
| Gate flag | `INVITE_REQUIRED=true` | `INVITE_REQUIRED=true` | `EMAIL_VERIFICATION_REQUIRED=true`, invite off |

## Phase 1 — Closed beta (invite-only, on your existing box)
**Outcome:** an invited tester opens `https://app.example.com` from any network, logs in, uses the app; strangers can't register; prod stays on your box; Tailscale keeps working.

### 1.1 App prerequisites (build first if missing)
- **Real authentication** — per-user JWT (access + rotating refresh), per-user data scoping, admin-gated mutations.
- **Invite-gated registration (the Phase 1 gate).** Add an `Invite` model (`code` unique, optional `email` target, `created_by`, optional `expires_at`, `accepted_at`/`accepted_user_id`) + migration. Gate `register()` behind a dormant flag `INVITE_REQUIRED`/`_PROD`: when on, require a valid, unexpired, unused, correctly-targeted code, consumed in the **same DB transaction**. Return a **uniform 400** on any failure (no code enumeration). Admin `POST/GET/DELETE /api/auth/invites` behind `require_admin`, codes via `secrets.token_urlsafe`. Advertise `invite_required` on `/auth/config` so the frontend shows the field only when on. *Zero-code fallback for the very first tester:* skip invites, hand-create the account with an admin script.
- **CORS allowlist (not `*`).** Parse `ALLOWED_ORIGINS`; an explicit list → `allow_credentials=True` (SPA needs the refresh cookie). `*` must force credentials **off** (browsers reject `*`+credentials).
- **Rate limiting on auth**, keyed on the **real client IP** (`CF-Connecting-IP` → `X-Forwarded-For` → peer). Apply e.g. `5/minute` to `/auth/login` + `/auth/register`; 429 handler; disable under `APP_ENV=development`.
- **Secrets fail-loud in prod** — `JWT_SECRET` (& friends) hard-fail at boot if unset. `.env` gitignored.

### 1.2 Edge security + apex redirect (Cloudflare dashboard)
- **Apex/www → app redirect.** Placeholder proxied A records for `@`/`www` → `192.0.2.1` (reserved, never routes — exists only so a rule fires), then **Rules → Redirect Rules**: match `(http.host eq "example.com") or (http.host eq "www.example.com")` → URL-redirect (Dynamic) `concat("https://app.example.com", http.request.uri.path)`, **301**, preserve query.
- **Bot Fight Mode:** enable (Security → Bots).
- **Rate-limiting rule** (Security → Rate limiting): `starts_with(http.request.uri.path, "/api/auth/")`, per **IP**, e.g. **20 req / 10 s** → Block. Edge layer in front of the in-app limit.

### 1.3 (Optional) Cloudflare Access on top — or why you might skip it
Access can gate the whole hostname to invited emails at the edge (a strong extra layer — that's **Branch A**). But it **requires a card on file** even on Free. EspañolApp skipped it for the beta and relied on the **in-app invite gate + rate limiting**; trade-off = the login page is loadable by strangers (they just can't register). **Mitigations:** keep the URL unpublished; use the tunnel on/off switch to expose only while a tester is active. **Hard trigger:** before widening past a few hand-invited testers, either add Access (Branch A) **or** move to the dedicated VM (Phase 2). Don't run open self-service signup on the homelab box.

### 1.4 Release Phase 1
- Bump version/CHANGELOG; take a fresh DB backup; deploy; apply the additive invite migration.
- Set `INVITE_REQUIRED_PROD=true`; recreate backend.
- **Verify the gate via the public edge:** `/auth/config` → `{auth_enabled:true, invite_required:true}`; register with no/bad code → 400; confirm **0 users leaked**. Mint the first invite and hand it over.

**Phase 1 checklist:** CORS explicit allowlist; auth rate-limited (in-app + edge); registration invite-gated (verified via edge); DB/Redis not tunnel-routed and no `0.0.0.0` publish; per-user abuse quota if the app does expensive work; fresh DB backup; the "Access or move-to-VM before widening" trigger written down.

**Rollback:** `docker compose -f docker-compose.tunnel.yml down` (+ unset `PUBLIC_HOSTNAME`, recreate proxy) → Tailscale-only.

## Phase 2 — Migrate to a dedicated VM (still invite-only)
**Trigger:** beta validated; move prod off the homelab onto an isolated host *before* opening self-service. Doing the risky migration (new host, data, DNS cutover) while traffic is still invited testers means no public stakes. Scope = provision + harden VM, migrate data + media, cut the domain over. No account-model change.

### 2.1 Provision + harden (one-time)
Example: **Hetzner CX33** (4 vCPU/8 GB, ~$9/mo, Ubuntu LTS).
- **User + SSH:** non-root sudo user; key-only; disable root login + password auth.
- **Swap:** ~2 GB (guards OOM during the frontend build).
- **Firewall:** `ufw` allows **OpenSSH only** (tunnel is outbound → no inbound web ports). Add `fail2ban`.
- **Docker** via get.docker.com; add user to `docker` group.
- **Tailscale ringfence (important):** join the VM but **tag it** (`tag:public-ingress`) and add an ACL restricting that tag to *only* the hosts it needs (e.g. an LLM gateway) and nothing else. Verify allowed port connects; `:22`/other fleet hosts time out. Tagged nodes have no key expiry. Stops a compromised public box from pivoting into your tailnet.
- **(Multi-app) shared edge `/opt/edge`:** one `caddy` + one `cloudflared` on an external `edge` Docker network; each app joins it and is routed by hostname. Give each hostname its **own** `{ import … }` block (a combined `http://a, http://b { … }` attaches handlers to only the first host). Each app is its own Compose project that **drops** the proxy/connector and joins `frontend`+`backend` to `edge`; datastores stay private.

### 2.2 Deploy + migrate data
- `git clone` to `/opt/<app>`; author a **fresh prod `.env`**: new `POSTGRES_PASSWORD`, **rotated** `JWT_SECRET` (`openssl rand -hex 32`), Tailscale service URLs, gates on (`INVITE_REQUIRED_PROD=true`, `EMAIL_VERIFICATION_REQUIRED_PROD=false`), `RESEND_API_KEY`/`EMAIL_FROM`/`TURNSTILE_SECRET` (+ frontend `VITE_TURNSTILE_SITE_KEY` build arg); `chmod 600 .env`.
  - **Put secrets into the file on the box; never paste into a chat/AI session.** Type over SSH, or pipe a hidden prompt so the value never hits screen/history:
    ```bash
    read -rsp 'Paste API key: ' K && echo && \
      sed -i "s|^RESEND_API_KEY=.*|RESEND_API_KEY=${K}|" .env && unset K && \
      echo "set: $(grep -c '^RESEND_API_KEY=re_' .env)"   # 1=OK, without revealing it
    ```
    Set one secret per command (chained `read`s swallow the first paste). If the check reports `0`, the `KEY=` line is **missing** — append it, don't `sed`-replace.
- **Build + run** the VM compose. If the frontend build needs a gitignored generated file (e.g. `frontend/version.json`), `cp` it in **before every build**.
- **Migrate the DB — restore, don't bootstrap.** ⚠️ A long-lived Alembic chain often isn't replayable from scratch (an early "all tables" snapshot regenerated after later migrations → `alembic upgrade head` dies on "already exists"). Restore a **dump of current prod** (it carries `alembic_version`), then apply only the delta:
  ```bash
  # old box:
  Scripts/backup-db.sh prod && scp Backups/prod_backup_*.sql <user>@<vm-public-ip>:/tmp/prod_restore.sql
  # VM (DB empty — no drop):
  docker compose -f docker-compose.<vm>.yml exec -T postgres psql -U <user> -d <db> < /tmp/prod_restore.sql
  docker compose -f docker-compose.<vm>.yml exec -T backend sh -c 'cd /app && alembic upgrade head'
  ```
- **Copy media too (easy to forget).** If images/audio/uploads live on a Docker **volume**, the DB dump carries only path pointers — restore and every card 404s until a backfill. Tar the volume across:
  ```bash
  docker compose exec -T backend tar czf - -C /app/media . > /tmp/media.tgz
  scp /tmp/media.tgz <user>@<vm>:/tmp/
  cat /tmp/media.tgz | docker compose -f docker-compose.<vm>.yml exec -T backend tar xzf - -C /app/media
  ```
  (Regenerable cache? skip and let it refill.) *Transfer note:* the ringfenced VM usually can't reach the old box over Tailscale (ACL), so **push** dumps/media to the VM's public SSH from the old box.
- **VM needs read access to the private repo** — a fresh clone's throwaway token makes later `git pull` fail (`could not read Username`). Add a **read-only deploy key** (scoped to one repo, revocable, can't push):
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "<app>-vm-deploy"
  printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
  git -C /opt/<app> remote set-url origin git@github.com:<owner>/<repo>.git
  cat ~/.ssh/github_deploy.pub   # add to GitHub → repo → Settings → Deploy keys (READ-ONLY)
  ```
- **Deploy workflow:** develop on dev → commit + **push** → a `deploy-to-<vm>.sh` that SSHes in, `git pull`s **origin/main**, backs up the VM DB, rebuilds (frontend `--no-cache`), `up -d`, delta-migrates, verifies. Because it deploys from `origin/main`, have it **warn on unpushed local commits**.

### 2.3 Cut the domain over
- Add the app's routes to the edge/proxy config. **Apply with `up -d --force-recreate caddy`, NOT `caddy reload`** (reload keeps serving old routes → new host returns empty 200). Verify each host actually proxies (look for `Server: uvicorn` + `Via: 1.1 Caddy`, not `Server: Caddy`).
- **Move the public hostname** to the VM's tunnel; update `ALLOWED_ORIGINS` (+ Google authorized-origins if using OAuth) to the live domain.
- **Purge the Cloudflare cache after cutover** (empty 200s from a misconfig window get cached and persist). Verify with `…/media/x.jpg?cb=1` → `MISS` + real bytes.
- **Lock down the VM:** no app publishes web ports; Postgres binds `127.0.0.1` for tooling only; confirm DB/Redis unreachable from the internet.
- **Decommission the old prod containers** → box becomes **dev-only**. Repoint `sync-prod-to-dev` to pull from the VM over Tailscale. **Stop the old prod promptly** (keep volumes) — left running with `APP_ENV=production` its **nightly crons keep firing**, double-loading shared backends and writing to the now-orphaned old DB (drift = a worse rollback the longer it runs). ⚠️ If `cloudflared` is a separate overlay, a plain `docker compose -f docker-compose.yml stop` **misses it** — pass both `-f` files.

### 2.4 Fleet integration: backups & monitoring
On a cloud box there's **no hypervisor snapshot safety net**, so the backup legs you set up here are the *only* copy — **not optional**. This spans two privilege domains (the ringfenced box can't reach the central `pbs1`/`mon1`), so it splits with an explicit hand-off:
- **A — on the box (deploy session, sudo):** tailnet-bound `node_exporter` (unit must carry `After=tailscaled.service` + `Restart=always` or it races tailscaled at boot and dies), `postgres_exporter` (`:9187`, least-priv `pg_monitor` role), `cadvisor` (`:9101`); PBS client (⚠️ Ubuntu 26.04: install from direct bookworm `.deb`s — repo wants `libfuse3-3` but box ships `-4`); DB backup leg (`pg-backup-pbs.sh` + scoped token + **escrowed paperkey — SAVE IT or backups are unrecoverable** + `/etc/cron.d` every 6h); filesystem/uploads leg if there's on-disk user data. **Seed-run, verify `rc=0`.**
- 🛑 **HAND-OFF** to the fleet operator (they hold the fleet SSH key + root on `pbs1` + sudo on `mon1`):
- **B — fleet session:** on `pbs1` create namespace + least-priv `DatastoreBackup` token + prune job + `ufw`-allow the box's tailnet IP → `:8007`; on `mon1` add scrape targets (node/postgres/cadvisor) + a blackbox-http probe of the public hostname + the ns to the `DBBackupStale` regex + the DB to `backups.py` (`DB_MAP`/`DB_DEFS`) + the node to console topology; `promtool` check → reload → rebuild → commit.
- **C — Tailscale admin console:** ACL granting the box's **tag → `pbs1:8007`** (⚠️ **two** layers gate `:8007` — the tailnet ACL *and* `pbs1`'s ufw; both required).
- **Gotchas:** hcloud exporter auto-covers the box only if it's in the same Hetzner project; the `DBBackupStale` regex + `backups.py` rosters are **hardcoded** (a new ns is unmonitored until added by hand — looks "green" because nothing watches it); if the old box stays as dev, repoint its backup leg's `PG_CONTAINERS` at the dev container or it goes stale.

**Phase 2 checklist:** VM hardened (key-only SSH, root/pw off, ufw SSH-only, fail2ban, swap); Tailscale node tagged + ACL-restricted; fresh `POSTGRES_PASSWORD` + rotated `JWT_SECRET`, `.env` `chmod 600`; DB/Redis internet-unreachable; no web ports published; data+media migrated & verified, CF cache purged; security headers present; gate still `INVITE_REQUIRED_PROD=true`; old prod **stopped**; box in fleet monitoring+backups (legs `rc=0`, `mon1` green, no `DBBackupStale`).

**Rollback:** `up -d` the old stack **+** move the DNS/tunnel hostname back (~2 min).

## Phase 3 — Full public (email verification, open the gate)
**Trigger:** widen beyond invited testers. Prod is already on the hardened VM, so opening up is purely an account-model change.

### 3.1 Build the account lifecycle (dormant flags, test in dev first)
- **Email verification via 6-digit OTP.** `EmailToken` model (`code_hash`=sha256, `expires_at`~15 min, `attempts` cap) + a `services/email.py` sending via **Resend** — and **logging the code instead of sending when `RESEND_API_KEY` is unset** (whole flow testable in dev, no email). Endpoints `/verify-email`, `/resend-code` (cooldown), `/forgot-password`, `/reset-password` (uniform 200, hashed single-use codes, reset revokes all sessions). Login returns `403 email_unverified` when the flag is on and unverified. Dormant flag `EMAIL_VERIFICATION_REQUIRED`/`_PROD`.
- **Bot protection — Cloudflare Turnstile on signup.** `services/turnstile.py` (siteverify; **fail-open** if Cloudflare unreachable so an outage doesn't block all signups), accept `turnstile_token` on register, dormant when `TURNSTILE_SECRET` empty. Get both keys (list **both** staging + real hostname on the widget). ⚠️ **The site key is a frontend build arg** — Vite only inlines vars present **at build time**: add `ARG`+`ENV VITE_TURNSTILE_SITE_KEY` to the frontend Dockerfile **and** pass the compose build arg, then **rebuild** (a backend recreate won't do it); grep the built bundle to confirm. Site key is public (ships in HTML); only the **secret** needs protecting.
- **Frontend lifecycle pages** (`VerifyEmail`/`ForgotPassword`/`ResetPassword` + routes + i18n) and an **admin users/invites page** (create/revoke invites; disable/enable, promote/demote, with self-lockout + last-admin guards).

### 3.2 Go public (flip the gates)
- **Verify the Resend sender domain first:** add the DKIM + SPF records into Cloudflare DNS, wait for "verified" (Resend "Auto configure" writes them straight into Cloudflare). Email won't deliver / lands in spam until green. **Smoke-test delivery without flipping any gate** via the **forgot-password** flow (sends a real code independent of the verify flag; watch for `email.sent status=200`). ⚠️ *New-domain deliverability:* the first emails often land in **spam** even with DKIM/SPF passing — add a "check spam" hint and mind free-tier caps (Resend 100/day) so a bot flood can't exhaust quota (another reason Turnstile is on first).
- Set `EMAIL_VERIFICATION_REQUIRED_PROD=true` and `INVITE_REQUIRED_PROD=false`; recreate the backend (⚠️ **with the explicit `-f docker-compose.<vm>.yml`** — a bare `up -d backend` picks the default/homelab file and drops the backend off `edge` → 502). Verify `{"auth_enabled":true,"invite_required":false}` via the public edge.
- Re-confirm rate limits + abuse quotas are sized for **unauthenticated** traffic; test signup → email code → verify → login, and forgot-password → reset → old sessions revoked.

### 3.3 Capacity (if the app does heavy backend work)
If expensive work (e.g. LLM jobs) routes **by task name through a gateway** (impl chosen server-side), scaling is an infra/routing change with **no app redeploy**: raise local throughput, outsource the interactive path to a commercial API, or hybrid. Measure interactive volume during beta to pick the crossover. Commercial APIs send user content to a third party — use a no-training tier and disclose it.

### 3.4 Decommission the old prod (don't skip)
Stop **every** old compose project incl. the tunnel overlay + worker; **keep containers + volumes** as a warm rollback through week one (don't `down -v` until the VM is proven); repoint `sync-prod-to-dev` to pull over SSH from the VM; confirm the public hostname resolves through the **new** box's tunnel.

**Phase 3 checklist:** Resend DKIM/SPF verified before flipping; delivery smoke-tested (forgot-password); Turnstile live (site key confirmed in the built bundle); gates flipped + full signup path tested on prod; limits re-sized for unauth traffic; CSP considered (test in browser — strict `script-src` can collide with Bot Fight Mode's injected inline script; start Report-Only).

→ Then **Part 3**.

---

# Part 3 — SHARED cutover-with-fallback + rollback

Applies to both branches — the discipline that makes this safe:

- **Run the new path in parallel with the old private path (Tailscale) during a soak.** Both work at once. Cut users over, keep the old path as fallback for a soak window (1–2 weeks), retire the old path only after the new one is proven **from cold browsers/other machines**.
- **Keep an out-of-band admin path (SSH over Tailscale) that does NOT depend on the new gate** — your anti-lock-out. Never retire it.
- **Every retirement is one reversible command.** Branch A: `docker compose -f docker-compose.tunnel.yml down` (or re-enable the old front door). Branch B: `up -d` the old stack + move the DNS/tunnel hostname back (~2 min).
- **Retiring a legacy front door ≠ uninstalling the private mesh.** e.g. OCME Phase 3 drops only `tailscale serve --https=443`; Tailscale stays installed for SSH + service-to-service calls. Drop the *web door*, keep the *admin plane*.

---

# Part 4 — COMBINED gotchas catalog

Tagged **[A]** closed/Access · **[B]** open/self-service · **[both]**.

1. **[A] Strict CSP breaks the Access auth handshake.** Fresh browsers get `TypeError: Failed to fetch` on the first API call (operator with a warm app cookie is unaffected). Access 302-redirects the XHR to `<team>.cloudflareaccess.com` to mint the per-app cookie; `connect-src 'self'` blocks it. **Fix:** add the team domain to `connect-src` **and** `frame-src` (repeat in every nginx `location` that sets CSP). *(OCME 2026-07-06.)*
2. **[A] `Error 400: redirect_uri_mismatch`** on Google → the OAuth client is missing the **exact** `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`. Copy-paste (no trailing slash), wait ~2–5 min, retry in incognito; click "error details" to see the exact URI expected.
3. **[A] Default-deny** — an Access app with **no policy** locks everyone out. Attach the Allow policy before relying on it.
4. **[A] Zero Trust Free still needs a card** on file to activate (the "$0 for ≤50 users" plan). Budget for it or use Branch B's in-app gate.
5. **[both] Never `--remove-orphans`** when recreating the app stack if the connector lives in a separate compose file/overlay under the same project — it kills the connector. And a plain `stop` on the main file **misses** an overlay connector; pass both `-f` files.
6. **[both] Token is a secret** — gitignore `.env.cloudflared`, type it over SSH (never paste/screenshot), rotate if exposed.
7. **[both] Frozen deploy trees.** If the origin's checkout is updated by rsync/`git archive` (HEAD stays old), `git pull` on the box won't fetch new files — copy via `scp`/the deploy script. *(OCME hit this: prod `~/ocme` was frozen at a Feb commit.)*
8. **[both] Rate-limit / log on the real client IP, not the proxy's.** Behind Cloudflare every request appears to come from Cloudflare. Resolve `CF-Connecting-IP` → `X-Forwarded-For` → peer, or per-IP limits become global.
9. **[both] Only the web origin through the tunnel** — never a DB/admin/SSH route; a tunnel route bypasses the host firewall.
10. **[both] Cloudflare caches empty/200s.** Blanks served during a misconfig window get cached (`HIT`, `content-length: 0`) and persist after you fix the origin. **Purge Everything**; verify with `?cb=N`.
11. **[B] `caddy reload` doesn't reliably apply new site blocks via bind mount** — reports success, serves old routes. Always `up -d --force-recreate caddy`.
12. **[B] Combined Caddy address line drops handlers** — `http://a, http://b { … }` attaches to only the first host (second returns empty 200). One `{ import … }` block per hostname.
13. **[B] `docker compose exec -T` reads stdin** — inside a script piped over SSH, an `exec -T` without `< /dev/null` swallows the rest of the script.
14. **[B] Gitignored build inputs** (e.g. `frontend/version.json`) — `cp` in before every build or it uses stale data; bake into the deploy script.
15. **[B] Alembic chain not replayable from scratch** — don't bootstrap a fresh DB with `alembic upgrade head` if migration 001 is a regenerated "all tables" snapshot; restore a dump (carries `alembic_version`) and apply the delta.
16. **[B] Media is on a volume, not in the DB** — the dump carries only path pointers; copy the volume separately or every image 404s.
17. **[B] `*` + credentials CORS is invalid** — browsers reject wildcard origin with credentials; use an explicit allowlist in prod.
18. **[B] Shared org-level keys + non-admin users** — if some service keys (image/email) are org-level, make settings resolution fall back to an admin's row before `.env`, or those features silently no-op for non-admin users.
19. **[B] DKIM/SPF before flipping email on** — verification emails won't deliver until the Resend sender domain is DNS-verified; keep the flag off (codes logged) until green.
20. **[B] Rotate secrets that sat in a group-readable `.env`** — if `.env` was `0664` even briefly, rotate `JWT_SECRET` + the tunnel token. The Phase 2 VM migration is a natural rotation point.
21. **[B] The VM can't `git pull` a private repo** — add a read-only SSH deploy key and switch the remote to `git@github.com:…` (new deploy keys can take a beat; first-fail-then-succeed is normal).
22. **[B] `VITE_*` key missing from the built bundle** — Vite only inlines build-time vars; thread through the Dockerfile (`ARG`+`ENV`) *and* the compose build arg, then rebuild the frontend; grep the bundle to confirm.
23. **[B] Env var reads as "(empty)" when actually absent** — `grep VAR= .env` returning nothing looks identical to `VAR=`; a `sed -i "s|^VAR=.*|…|"` then silently no-ops. If a set-check reports `0`, the line is missing — append it, don't `sed`-replace.
24. **[B] Wrong compose file drops a service off the shared `edge` network → instant 502.** A bare `docker compose up -d <svc>` picks the default compose file, which may not join the service to the external `edge` network; the reverse proxy then can't reach it. Always pass the explicit `-f docker-compose.<vm>.yml` on every up/recreate.
25. **[A] Access session expiry mid-session bricks a SPA silently.** When the Access session (default ~24 h) lapses while the app is open, every API call 302s to the team domain — which an XHR/`fetch` can't follow — so the shell renders but all data calls fail ("Failed to fetch"), and close/reopen doesn't help. **Fix:** an `apiFetch` guard that detects the Access-redirect failure signature and forces **one top-level reload, rate-limited (~1/min)** — the browser navigation re-auths SSO silently. Consider raising the Access session duration (app → Session Duration) to make re-auth weekly, not daily. *(OCME 2026-07-06.)*
26. **[A] PWA caching service worker + Access = deadlock. Do NOT ship a caching SW behind Access without solving this first.** Three interlocking failures: a SW that precaches `index.html` and serves **every navigation from cache** means an expired session never reaches the network to re-auth; the Access 302 is **fatal for SW script downloads**, so the stuck SW can't even fetch its own replacement; and `registerType: 'prompt'` leaves stuck devices on the old SW forever. **Escape hatch:** ship a **self-destroying stub SW** (`selfDestroying: true`) — it unregisters, deletes all caches, and reloads tabs over the network; manifest/home-screen install keeps working with no caching SW at all. If you later want real offline caching behind Access, it's a design project (network-first navigations + bypassed SW scripts, #27), not a config flag. *(OCME 2026-07-06, v1.35.3→4.)*
27. **[A] SW scripts must be fetchable WITHOUT an Access session** — or stuck devices can never download the fix. Pattern: a second Access application ("<app> SW bypass", Self-hosted) with destinations `<host>/sw.js` + `<host>/workbox-*` and a policy of action **Bypass**, include Everyone. Safe: these are generic static JS with no secrets. **Verify both directions:** `sw.js`/`workbox-*` return 200 publicly; `/`, `/login`, `/api` still 302 → Access. *(OCME 2026-07-06.)*
28. **[both] `sw.js` must never be long-cached — and nginx location precedence will do it to you silently.** A prefix `location /sw.js` **loses** to a regex `~* \.js$` block, so the SW gets the assets' `1y/immutable` headers, and Cloudflare's edge then serves the stale SW for days after every origin fix. **Fix:** exact-match `location = /sw.js` (exact beats regex) with no-cache headers — same for `workbox-*.js` — plus a one-time Cloudflare **Purge by URL** for both. Applies to any file that must always be fresh (SW scripts above all, since they control all other caching). *(OCME 2026-07-06.)*
29. **[both] A code-split SPA with NO cache headers is a stale-chunk time bomb — set the policy at the origin, not with reactive purges.** Vite (and every hashed-bundle builder) content-hashes assets **and** lazy-loads route chunks via dynamic `import()`. If the origin sends **no `Cache-Control`** (nginx/Caddy default: only `Etag`/`Last-Modified`), a browser will heuristically cache `index.html`, or one "Cache Everything" rule will edge-cache it — and that stale `index.html` references chunk hashes a later deploy has **already replaced** → `TypeError: Failed to fetch dynamically imported module`, and the app shell loads but a route blanks. "Purge Everything" (#10) only clears it *after* it breaks, every single deploy. **Durable fix — two headers, shipped from day one:** the hashed bundle (`/assets/*`) → `Cache-Control: public, max-age=31536000, immutable` (a redeploy mints new filenames, so old ones just go unreferenced); the **`index.html` entry document → `no-store`/`no-cache`** so it always revalidates and can never pin obsolete hashes. Then **redeploys need no purge** — the class is structurally impossible. Config template in `script-library.md` §8 (nginx + Caddy). *(Staritsky 2026-07-07; distinct from #28, which is the SW-script special case.)*

> *(This catalog merges OCME's Access gotchas with the EspañolApp deploy memo (#1–24); #25–28 are from the OCME service-worker/Access-expiry incident, 2026-07-06; #29 is the code-split-SPA cache-header standard, Staritsky 2026-07-07. Append new entries here — this is the single home for public-deploy gotchas.)*

---

# Appendix — Reference instances

**Branch A — OCME (closed / Access):**

| Item | Value |
|---|---|
| App / hostname | OCME staff app · `https://klinika.ocme.pl` (CR086) |
| Zone / account | `ocme.pl` / `Itsystems.ocme@gmail.com` |
| Zero Trust team | `empty-disk-d6a2.cloudflareaccess.com` |
| Tunnel | `ocme-prod` → `127.0.0.1:80` (nginx, host network); connector `ocme-cloudflared-prod` |
| Login / policy | Google SSO + OTP · app `OCME Staff` / policy `Staff allow-list` |
| CSP directive | `connect-src 'self' https://empty-disk-d6a2.cloudflareaccess.com; frame-src 'self' blob: https://empty-disk-d6a2.cloudflareaccess.com;` |
| Status | Live + verified (Google+OTP+app login); CSP handshake fix 2026-07-06; Tailscale Serve parallel until Phase-3 retire |
| Detail runbook | OCME project repo: `SETUP_CLOUDFLARE_ACCESS_PROD.md` |

**Branch B — EspañolApp (open / self-service):**

| Item | Value |
|---|---|
| App / hostname | EspañolApp · `https://spanish.espanol-app.com` |
| Registrar / zone | Cloudflare Registrar · `espanol-app.com` |
| Prod host | dedicated Hetzner CX33 (homelab decommissioned to dev-only) |
| Edge | shared `/opt/edge` (one Caddy + one cloudflared, `edge` network); tunnel `apps-prod-hz` |
| Gates | invite → email-verify (Resend + DKIM/SPF) + Turnstile; both dormant-flag driven |
| Status | Phases 1–3 complete 2026-06-28 — public self-service signup live |
| Source detail | project's `CLOUDFLARE_SETUP.md`, `HETZNER_DEPLOY.md`, `CR-012_PHASE_CD_PLAN.md` |

**Reusable across apps:** once the Cloudflare **org + IdP (Branch A) or the invite/email/Turnstile code (Branch B)** exists, a *new* app is just: Part 1 (tunnel route + connector) + the branch's per-app step (Access app+policy, or the phase flags). Copy this file into the new project's docs and substitute the placeholders.
