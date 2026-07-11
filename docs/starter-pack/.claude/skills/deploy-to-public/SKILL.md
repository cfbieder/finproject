---
name: deploy-to-public
description: Expose a Tailscale-private app to the public internet safely (Cloudflare Tunnel, no open inbound ports). Use when asked to make an app public, reachable from a browser/the internet, set up Cloudflare Tunnel or Access, add a public domain/hostname, or open self-service signup. Covers both the closed allow-list branch and the open self-service branch.
---

# Take a private app public (condensed)

Canonical playbook: `deploy-to-public.md` (find in repo or the starter pack) — **read it
for any step you haven't done before**; this file is the decision tree + checklists.

## Step 0 — pick the branch (ask the user if ambiguous)

- **Branch A — CLOSED:** fixed set of known users (staff/internal tool) → **Cloudflare
  Access** allow-list at the edge. Needs a card on file for Zero Trust (even Free tier).
- **Branch B — OPEN:** anyone can sign up (product/SaaS) → in-app **invite codes → email
  verification + Turnstile**, staged over three phases, dedicated VM before opening the gate.

**Non-negotiable design rule:** every gate ships **OFF as a dormant env flag**, byte-identical
to "before" until armed; rollback = flip the flag / stop the connector. Tailscale stays on
throughout and is the ultimate fallback.

## Shared foundation (both branches)

1. App prerequisites: real per-user auth, per-user data scoping, admin-gated mutations,
   fail-loud prod secrets. **Do not expose an app that trusts a single implicit user.**
2. Domain on Cloudflare; reverse proxy (Caddy/nginx) routing `/api|/media` → backend,
   rest → SPA, security headers on.
3. Tunnel: create in Zero Trust, run `cloudflared` as a **separate opt-in compose overlay**,
   token gitignored + typed over SSH. Public hostname → the proxy. Verify `/health` 200
   through the edge; connector Healthy.
4. Hardening: real client IP from `CF-Connecting-IP` for rate-limits/logs; **only the web
   origin through the tunnel** (never DB/SSH); pin the connector image by digest; host
   firewall inbound = SSH only; purge Cloudflare cache after any misconfig window.

## Branch A checklist

IdP (Google OAuth: exact `…cloudflareaccess.com/cdn-cgi/access/callback` redirect URI) →
Access app + **Allow policy** (default-deny: no policy = nobody in) → app-side: add the
team domain to CSP `connect-src` **and** `frame-src` (repeat in every nginx location that
sets CSP), CORS origins, app's own OAuth origins → **verify from a COLD browser** (the
operator's warm cookie masks the first-call CSP bug) → machine callers bypass Access via
Service Token or stay on Tailscale.

**Before shipping a PWA/service worker behind Access** (gotchas #26–28): default to **no
caching SW** for internal apps — it removes the whole deadlock class (expired-session
re-auth can't reach the network; Access 302 blocks the SW from updating itself). If one
ships anyway: `autoUpdate` + `navigateFallback: null`, a self-destroying stub as escape
hatch, a public **Bypass** Access app for `/sw.js`+`/workbox-*`, and exact-match no-cache
headers on `sw.js`. Also add an `apiFetch` guard that forces one rate-limited reload on the
Access-redirect failure signature (#25), so a mid-session expiry self-heals.

## Branch B phase gates

- **P1 (existing box, invite-only):** invite model + dormant `INVITE_REQUIRED`; CORS
  explicit allowlist; auth rate-limited in-app + edge; verify gate via the public edge.
  Hard trigger written down: Access or dedicated VM **before** widening.
- **P2 (dedicated VM, still invite-only):** harden (key-only SSH, ufw SSH-only, fail2ban,
  swap); **Tailscale-ringfence the box** (tag + ACL); fresh secrets, `chmod 600`;
  **restore-don't-bootstrap** the DB (dump carries `alembic_version`); copy media volumes
  separately; read-only git deploy key; fleet backups + monitoring (both legs verified,
  rosters updated); stop old prod promptly (crons keep firing) but keep volumes as warm
  rollback.
- **P3 (open the gate):** DKIM/SPF verified BEFORE flipping; smoke email via
  forgot-password; Turnstile site key confirmed **in the built bundle**; flip
  `EMAIL_VERIFICATION_REQUIRED_PROD=true` + `INVITE_REQUIRED_PROD=false` **with the
  explicit VM `-f` file**; re-size limits for unauthenticated traffic.

## After any cutover

Soak old + new paths in parallel 1–2 weeks; keep the out-of-band admin path (SSH over
Tailscale) forever; every retirement must be one reversible command; purge CF cache and
verify with `?cb=1` from a cold browser/machine. Consult the playbook's **24-item gotchas
catalog** before debugging anything that looks weird — it is probably in there.
