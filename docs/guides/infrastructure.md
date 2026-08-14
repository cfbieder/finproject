# Live infrastructure — hosts, deploy, and the rules that bite

Lifted out of [status.md](../current/status.md) on 2026-08-09, when the snapshot went 122 lines
against its own ≤60 budget for the second time in a day. This changes far less often than anything
around it, which is exactly why it does not belong in a session snapshot.

## Hosts and deploy
- **Dev and prod are the same host** (`192.168.1.87` / Tailscale `100.94.46.62`) — prod
  `psproject` :3005/:5433 (volume `fin_postgres_data`), dev :3105/:5434, v4 `finv4` :3205/:5435.
  Prod: `https://fin.tail413695.ts.net`. `bank-feed/` :3007 feeds 28 accounts; ocr-llm gateway
  `100.66.213.40:8080`. Both are separate repos.
- Deploy: `./Scripts/deploy-to-production.sh` (DB backup first). Migrations **dev first, through
  `migrate.js`** — a `psql -f` apply writes no ledger row and is invisible to the guard. Registry:
  [migrations.md](../current/migrations.md). *A deploy's Step 1 backup predates its Step 2b migration.*
- **Step 0b consults CI** (2026-08-12, [#12](../current/project-roadmap.md#3-known-issues)): a commit
  that is red, unfinished, or has no run is refused — `--allow-red-ci` overrides. It **waits** for a
  run in flight, so a deploy straight after a push pauses ~2 min rather than failing. Ask any time
  with `./Scripts/check-ci.sh` (`[ref] [--wait]`; exit 0/1/2/3/4 = green/red/pending/none/unknown).
- **An engine change moves nothing until the scenarios are REGENERATED.** Deploy, then regenerate,
  then check the fingerprint against the dev measurement.
- The prod container runs as **root** and writes root-owned audit CSVs, so a host-run generation
  fails with EACCES — generate through the container.
- **Gates:** counts live in [test-overview.md](../current/test-overview.md). Lint **blocking** (0 errors) plus
  six ratchets that may only shrink.


## Why each of these is written down

Every line above is a rule something has already broken:

- **Migrations dev-first, through `migrate.js`** — a `psql -f` apply writes no ledger row and is
  invisible to the guard (migration 057's own registry row records the incident).
- **A deploy's Step 1 backup predates its Step 2b migration**, so restoring from one lands a
  migration short — which happened, and re-created four tables migration 060 had just dropped.
- **`server-dev` runs a BUILT image with no source mount, so `restart` re-runs the OLD code.**
  Use `docker compose -f docker-compose.dev.yml up -d --build server-dev`. Written down because a
  restart-then-verify against dev on 2026-08-14 tested the pre-fix code, reported the fix "not
  working", and — since the old code was the code with the defect — **accepted a write the new code
  refuses**, changing a module on dev. Recovered by reading the value back from prod (the two were
  byte-identical) and the entries fingerprint was unaffected, but the general shape is: *verifying a
  fix against a stale binary can exercise the very bug you removed.*
- **An engine change moves nothing until the scenarios are regenerated.** Deploy, regenerate, then
  check the entries fingerprint against the dev measurement. Skipping the check is how a stale
  1,328-row prod state went unnoticed (CR075 §10).
- **The prod container runs as root** and writes root-owned audit CSVs, so a host-run generation
  fails with EACCES.
