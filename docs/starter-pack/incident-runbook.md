# Incident Runbook — the 2 a.m. path

> **Pack role:** the *reactive* companion to everything else. The rest of the pack is
> prevention — probes, gates, guards, backups; this doc is what you actually do, in order,
> when prod is down or wrong **right now**. It deliberately contains no new policy: every
> step points back at the playbook that owns it. Rollback mechanics live in the deploy
> runbooks; this doc owns the *triage order* and the *rollback-vs-investigate decision*.
>
> **Last reviewed:** 2026-07-16.

## The two standing rules

1. **Red smoke ⇒ rollback, not debugging-in-prod.** The pack's deploy gates already say
   this ([`testing-and-ci.md`](testing-and-ci.md)); it applies doubly at 2 a.m. Every
   cutover in this pack was designed to be **one reversible command** — use that property.
2. **"What changed last?" beats cleverness.** Most incidents are the most recent change:
   a deploy, a migration, a flag flip, an edge/route edit, a cert, a full disk. Check the
   change log *before* reading application code.

## 0. Don't lock yourself out

Your **out-of-band admin path (SSH over Tailscale) must not depend on the public gate**
([`deploy-to-public.md`](deploy-to-public.md) Part 3). Confirm you have it *before* touching
the edge — if the incident is edge-side, the private path is both your diagnostic vantage
and your rollback lever.

## 1. Triage — outside-in, one layer at a time

Work from the visitor inward; stop at the first layer that's actually broken. At each
layer, the question is the same: **what exactly returned that response?**
([`public-edge-baseline.md`](public-edge-baseline.md))

| # | Layer | Check | Known failure classes (where documented) |
|---|---|---|---|
| 1 | **Probe / user report** | Is the probe red, or only the user? `probe_http_redirects` > 0 = you're looking at a login page, not the app | fake-green gated probe (public-edge §1); stale probe target (public-edge §6) |
| 2 | **Edge / DNS** | `curl -sv https://<host>/health` from *outside*; check the tunnel dashboard — connector Healthy? | orphan/dangling routes (public-edge §3); cached empty 200s — purge + `?cb=1` (deploy-to-public #10) |
| 3 | **Tunnel connector** | `docker compose -f docker-compose.tunnel.yml logs` — "Registered tunnel connection"? | overlay killed by `--remove-orphans` or a partial `stop` (deploy-to-public #5) |
| 4 | **Reverse proxy** | Does the proxy answer on the box? Does each host block actually proxy (`Via:` header)? | `caddy reload` silently serving old routes (deploy-to-public #11); generic service-name collision on a shared edge → cross-wired 502 (infra-bootstrap #18) |
| 5 | **Containers** | `docker ps` — all up? Restart counts climbing? | restart loop under `unless-stopped` (observability tier 1); service dropped off the `edge` network by a bare `up -d` — 502 while in-container localhost answers (deploy-to-public #24) |
| 6 | **App logs** | `docker logs <<APP>>-api --since 30m` — errors at the failure time? | "column does not exist" = a migration never applied (infra-bootstrap §5/#11); every authed call 401s while `/health` passes = a `VITE_*` build arg didn't thread (infra-bootstrap #15) |
| 7 | **DB** | `pg_isready`; connections maxed? `df -h` — disk? | disk full from `--no-cache` build growth (infra-bootstrap §6); a "healthy" `/health` that doesn't touch the DB hides a dead DB (observability tier 0) |
| 8 | **Host** | load, memory, `dmesg` OOM kills, clock | OOM during frontend build on a small VM (deploy-to-public §2.1 — swap) |

Then correlate with **what changed**: `git log --oneline -5` on the deploy source, the
migration ledger head, flag files' mtimes, the edge dashboard's audit log. On a shared-edge
box, remember the blast radius: one connector down = **every** co-hosted app down together
(public-edge §4) — if the neighbours are down too, the incident is layers 2–4, not your app.

## 2. The rollback decision

Decide **restore service vs. understand the bug** explicitly — default to restore:

- **A deploy landed within the incident window → roll it back now, diagnose after.**
  App rollback is `git checkout <prev-tag>` + re-run the deploy script
  ([`deploy-single-host`](.claude/skills/deploy-single-host/SKILL.md)); the pre-deploy
  backup exists *because* of this moment.
- **A flag was flipped → flip it back.** Every gate in this pack ships as a dormant env
  flag precisely so rollback is a config change, not a deploy (infra-bootstrap §1.5).
- **An edge change landed → revert the route/site block**, or take the public path down
  entirely (`docker compose -f docker-compose.tunnel.yml down`) — the app stays reachable
  on the private path while you work.
- **DB restore is the one rollback that loses data** — everything written since the dump
  is gone. It is for *corruption*, not for "the new code has a bug." Say out loud what
  window you're discarding before you run `pg_restore`.
- **A migration is involved:** never edit or hand-revert an applied migration — forward-fix
  with a new one ([`.claude/rules/migrations.md`](.claude/rules/migrations.md)). If the
  deploy used expand→migrate→contract properly, the destructive step was last and the flag
  flip is your revert (infra-bootstrap §5).

## 3. While it's fresh — capture, then verify the fix honestly

- Note timestamps, the failing layer, and **which signal lied** (a green probe, a passing
  healthcheck, a "successful" deploy banner) — the lying signal is usually the durable fix.
- After the fix: verify from a **cold browser / different machine**, through the public
  edge, not just in-container (deploy-to-public 2A.4). Reachable ≠ done.

## 4. Close the loop (this is the part that compounds)

The pack's standing rule: **every incident ends by making its class of incident harder**
([`security-baseline.md`](security-baseline.md) §7). Before you stand down:

1. **Write the gotcha into the catalog that owns it** — deploy-to-public Part 4,
   infra-bootstrap §7, or the relevant baseline. New class → new entry, dated.
2. **If a machine can check it, graduate it into `ci-guards.sh`** or a pre-commit guard
   ([`testing-and-ci.md`](testing-and-ci.md)) — prose warns, guards prevent.
3. **If a probe or alert should have caught it and didn't, fix the monitoring in the same
   sitting** — a missed alert is a monitoring bug with the same severity as the outage
   ([`observability-baseline.md`](observability-baseline.md)).
4. **Upstream it** — a lesson learned in one project gets committed to the pack first
   (README → maintenance loop), or the next project relearns it the same way.
