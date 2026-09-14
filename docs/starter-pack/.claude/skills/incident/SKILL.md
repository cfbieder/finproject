---
name: incident
description: Triage a production incident — prod is down, wrong, or serving errors right now. Walks the outside-in triage order (probe → edge → tunnel → proxy → containers → logs → DB → host), makes the rollback-vs-investigate decision explicit, and closes the loop so the incident class gets harder. Use when the user says prod is down/broken, the site is 502ing, users can't log in, a probe or alert fired, or "we need to roll back".
---

# /incident — the 2 a.m. path

Condensed from `docs/guides/incident-runbook.md` (copy it in if absent — the full doc
carries the failure-class table with pointers to the catalog that owns each one).
**Read the runbook before improvising; this skill is the order of operations, not the detail.**

## Two standing rules

1. **Red smoke ⇒ rollback, not debugging-in-prod.** Every cutover in this pack is one
   reversible command — use that property.
2. **"What changed last?" beats cleverness.** Deploy, migration, flag flip, edge/route
   edit, cert, full disk. Check the change log *before* reading application code.

## 0. Don't lock yourself out

Confirm the out-of-band admin path (SSH over Tailscale) works **before** touching the edge.
If the incident is edge-side, the private path is both the diagnostic vantage and the
rollback lever.

## 1. Triage outside-in — stop at the first layer actually broken

At each layer the question is the same: **what exactly returned that response?**

1. **Probe / user report** — probe red, or only the user? `probe_http_redirects > 0` means
   you are looking at a login page, not the app.
2. **Edge / DNS** — `curl -sv https://<host>/health` from *outside*; connector Healthy in
   the tunnel dashboard?
3. **Tunnel connector** — `docker compose -f docker-compose.tunnel.yml logs`, expect
   "Registered tunnel connection".
4. **Reverse proxy** — does it answer on the box, and does each host block actually proxy
   (`Via:` header)? A `caddy reload` can silently serve old routes.
5. **Containers** — `docker ps`: all up, restart counts flat? A service dropped off the
   `edge` network 502s while in-container localhost still answers.
6. **App logs** — `docker logs <app>-api --since 30m`. "column does not exist" = a
   migration never applied; every authed call 401ing while `/health` passes = a build arg
   didn't thread.
7. **DB** — `pg_isready`, connections, `df -h`. A `/health` that doesn't touch the DB hides
   a dead DB.
8. **Host** — load, memory, `dmesg` OOM kills, clock.

Then correlate with what changed: `git log --oneline -5` on the deploy source, the migration
ledger head, flag-file mtimes, the edge audit log. **On a shared-edge box the blast radius is
every co-hosted app** — if the neighbours are down too, it's layers 2–4, not your app.

## 2. Decide restore vs. understand — say it out loud, default to restore

- **Deploy landed in the window** → roll it back now (`git checkout <prev-tag>` + re-run the
  deploy script), diagnose after. The pre-deploy backup exists for this moment.
- **Flag was flipped** → flip it back; that is why gates ship as dormant env flags.
- **Edge change landed** → revert the route/site block, or take the public path down
  (`docker compose -f docker-compose.tunnel.yml down`) — the app stays reachable privately.
- **DB restore loses data** — it is for *corruption*, not "the new code has a bug". State
  which write window you are discarding before running `pg_restore`.
- **Migration involved** → never edit or hand-revert an applied one; forward-fix
  (`.claude/rules/migrations.md`). Done expand→migrate→contract, the flag flip is the revert.

## 3. Capture while fresh, verify honestly

Note timestamps, the failing layer, and **which signal lied** (green probe, passing
healthcheck, "successful" deploy banner) — the lying signal is usually the durable fix.
Verify the fix from a cold browser on another machine, through the public edge. Reachable ≠ done.

## 4. Close the loop — this is the part that compounds

Do not stand down until:
1. The gotcha is written into the catalog that owns it, dated.
2. Anything a machine can check is graduated into `scripts/ci-guards.sh`.
3. If a probe or alert should have caught it and didn't, **the monitoring is fixed in the
   same sitting** — a missed alert is a bug of the same severity as the outage.
4. The lesson is upstreamed to the starter pack, not left in this project only.
