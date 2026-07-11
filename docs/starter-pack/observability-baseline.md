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
  its targets show `up` in the console.

## Tier 2 — the outside-in probe (for anything with users)

A **blackbox HTTP probe of the public (or tailnet) hostname** from a *different* machine
than the one serving it. Internal healthchecks can't see: expired certs, tunnel down, edge
misroutes, the wrong-compose-file-dropped-off-the-edge-network 502. One probe catches the
entire class. For public apps this is part of the deploy-to-public fleet step; for private
apps, a probe from `mon1` (or even a cron + `curl -f` + a notification) is the budget version.

## Tier 3 — alerts (few, and every one actionable)

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

## Cadence

- **On every new app/host/DB:** exporters up, targets green, probe added, rosters updated,
  job registry updated — as part of the CR, not after.
- **Quarterly (~30 min, pairs with the restore drill):** diff monitoring rosters against
  reality; fire a test alert end-to-end (silence → notification arrives); prune alerts
  nobody has acted on.
- **On decommission:** remove targets/probes *and* confirm the old host's jobs stopped —
  a decommissioned prod left running its crons double-loads shared backends and drifts the
  old DB (deploy-to-public §2.3).
