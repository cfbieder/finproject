# Observability Baseline

> **Pack role:** the day-one logging/metrics/alerting floor for **any** app — including
> private, Tailscale-only ones. Previously this knowledge lived only inside
> [`deploy-to-public.md`](deploy-to-public.md) §2.4 as "fleet integration during a VM
> migration," which meant a new private app got no guidance at all. This doc generalizes it;
> the fleet-specific mechanics (pbs1/mon1 hand-off, ACL layers) stay in that playbook.
>
> **Last reviewed:** 2026-07-06.

## The principle

**Unmonitored looks identical to healthy.** The recurring failure in the fleet's history is
not "an alert fired late" — it's "nothing was watching, so it looked green": the hardcoded
`DBBackupStale` roster that silently didn't cover a new namespace, the cron on another box
nobody could see, the old prod left running its nightly jobs. Every layer below exists to
convert *invisible* into *red*.

## Tier 0 — in the app (build these into every project, day one)

- **`/health` endpoint** returning `{status, timestamp}` — Docker healthchecks, deploy
  verification, and uptime probes all key off it (script-library §10). If the app has a DB,
  make `/health` actually touch it (`SELECT 1`) so "up but can't reach postgres" reads as
  unhealthy, not healthy.
- **Structured logs to stdout/stderr** (JSON or key=value), one event per line — Docker's
  log driver captures them; `docker logs` + `grep`/`jq` is the day-one query layer. Include:
  timestamp, level, request id, user id (not PII beyond the id), route, duration, outcome.
  Log the **real client IP** behind the edge (`CF-Connecting-IP` resolution — the same rule
  as rate limiting).
- **Log levels honest:** `error` = a human should eventually look; `warn` = degraded but
  self-handled; noisy misuse of `error` trains you to ignore it. Rotate any file-based logs
  (or rely on Docker's `max-size`/`max-file` log options — set them; unbounded container
  logs fill disks).
- **A version surface:** `/health` (or footer) exposes the running version from
  `version.json` — "what is actually deployed" is the first question in every incident.
- **Frontend errors reach the server.** A SPA's client-side crashes are invisible to every
  layer on this page — the backend logs stay clean while users stare at a blank route.
  Minimum: `window.onerror` + `unhandledrejection` handlers POSTing to a rate-limited
  backend log endpoint (message, stack head, route, version — no PII), logged structured
  like any other event. A Sentry-class tool is a fine upgrade once a project earns it; the
  floor is that a client-side error produces *any* server-side line at all.

## Tier 1 — host + stack metrics (once per host)

On every VM/host that runs a stack (private or public):

- **`node_exporter`** — bound to the **tailnet address**, not `0.0.0.0`. On boot-managed
  hosts the unit needs `After=tailscaled.service` + `Restart=always` or it races tailscaled
  at boot and dies silently (learned the hard way).
- **`postgres_exporter`** (`:9187`) with a least-privilege `pg_monitor` role — never the app
  or superuser credentials.
- **`cAdvisor`** (`:9101`) for per-container CPU/mem/restart counts — restart loops are the
  most common silent failure on `restart: unless-stopped` stacks.
- Scraped by the central Prometheus (`mon1` in the homelab); a new host is **not done** until
  its targets show `up` in the console. *(No central fleet? See "No fleet?" below — the tier
  still applies, only the scraper moves.)*

## Tier 2 — the outside-in probe (for anything with users)

A **blackbox HTTP probe of the public (or tailnet) hostname** from a *different* machine
than the one serving it. Internal healthchecks can't see: expired certs, tunnel down, edge
misroutes, the wrong-compose-file-dropped-off-the-edge-network 502. One probe catches the
entire class. For public apps this is part of the deploy-to-public fleet step; for private
apps, a probe from `mon1` (or even a cron + `curl -f` + a notification) is the budget version.

> ### ⚠️ A probe behind an auth gate LIES TO YOU
>
> If the hostname sits behind **Cloudflare Access** (or any SSO proxy / WAF interstitial), the edge
> `302`s **every** unauthenticated request — *including* `/api/health`. A default probe follows that
> redirect, gets a **200 from the login page**, and reports the app **UP** — and that login page stays
> up **even if every container you own is dead**. This is worse than no probe: it manufactures
> confidence. (Measured on a real app: `probe_success=1`, `probe_http_redirects=1`, 35 KB of login HTML.)
>
> Probe **through** the gate with a service token, `follow_redirects: false`, 2xx-only — and assert
> **`probe_http_redirects == 0`**. That, not `probe_success`, is the honest signal: a 200 reached *via a
> redirect* is the login page, not your app. Full recipe → [`public-edge-baseline.md`](public-edge-baseline.md) §1.
>
> The general rule this is an instance of: **always ask what exactly returned that 200.**

## Tier 3 — alerts (few, and every one actionable)

**An alert rule without a named route to a human is decoration.** Decide and write down the
delivery channel (email, ntfy/Telegram push, whatever you actually look at) *when the rule
is created*, and test the pipe end-to-end — rule → notification arriving on your device —
before trusting it (the quarterly cadence below re-tests it). A rule that fires into an
unconfigured receiver is the monitoring version of the unprobed hostname: green because
nothing is watching the watcher.

Baseline set — resist adding more until each new alert has a defined response:

| Alert | Condition | Why this one |
|---|---|---|
| Host down | node_exporter target down > 5 min | Everything else depends on it |
| Probe failing | blackbox probe red > 5 min | Users are affected *now* |
| Container restart-looping | restarts > 3 in 15 min | The silent `unless-stopped` death spiral |
| Disk pressure | > 85% used | `--no-cache` builds guarantee growth (infra-bootstrap §6) |
| **Backup stale** | no successful backup in > expected interval | An unwatched backup job is the worst silent failure |
| Cert expiring | < 14 days (only where certs are self-managed) | Caddy/Cloudflare auto-renew; nginx+LE setups don't |

**The roster rule (the "green because nothing watches it" gotcha, promoted):** any alert
whose scope is a **hardcoded list** (the `DBBackupStale` regex, `backups.py`'s `DB_MAP`,
scrape target files) is a standing trap — a new app/DB/namespace is unmonitored until
added *by hand*, and absence of red reads as health. Therefore: **"add to monitoring
rosters" is a mandatory checklist line in every new-app/new-DB CR**, and the quarterly
review (below) diffs the rosters against reality (`docker ps`, DB list, tunnel hostnames).

## Tier 4 — scheduled-job visibility

Jobs span **three layers** (host cron / app worker / auxiliary host — infra-bootstrap §6)
and the recurring failure is grepping `crontab -l` for a job that's a `systemd --user`
timer on another box. The **single job registry** (one table: job · layer · schedule ·
where it lives · how its success is observed) is an observability artifact, not just
documentation — the last column is the point. A job whose success is observed nowhere gets
a log line + a staleness alert (the backup-stale pattern) or it will fail silently.

## No fleet? The standalone floor

The tiers above assume a central monitoring host (`mon1`/`pbs1` in the homelab). A project
seeded **outside** that fleet still owes its users the same floor — pick one of two shapes,
don't skip the layer:

- **Self-contained stack (fuller):** one small compose on the box — Prometheus +
  Alertmanager + blackbox-exporter + the tier-1 exporters — scraping itself. Accept the
  known blind spot honestly: **a box watching itself cannot report its own death.** Pair it
  with one *external* check for exactly that case (a free uptime service pinging the public
  hostname, or a dead-man's-switch heartbeat — below).
- **Budget tier (fewer moving parts):** an **Uptime Kuma** instance on a *different* box (or
  a hosted uptime service) probing the public/tailnet hostname — that's tier 2 — plus
  **healthchecks.io-style dead-man's-switch pings** from every cron job: the job curls a
  per-job URL on success, and the *service* alerts when the ping **stops arriving**. This is
  the "alert on missing, not just stale" rule (backups above all) implemented without any
  fleet — silence becomes a page instead of safety.
- Either way the gated-probe rule (tier 2) and the roster rule (tier 3) still apply
  verbatim, and the delivery channel still gets named and tested. What this section changes
  is only *where the watcher runs* — never whether one exists.

## Cadence

- **On every new app/host/DB:** exporters up, targets green, probe added, rosters updated,
  job registry updated — as part of the CR, not after.
- **Quarterly (~30 min, pairs with the restore drill):** diff monitoring rosters against
  reality; fire a test alert end-to-end (silence → notification arrives); prune alerts
  nobody has acted on.
- **On decommission:** remove targets/probes *and* confirm the old host's jobs stopped —
  a decommissioned prod left running its crons double-loads shared backends and drifts the
  old DB (deploy-to-public §2.3).
