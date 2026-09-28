# CLAUDE.md — Fin Project Instructions

<!-- Keep this file LEAN — it loads on every turn. Collaboration + git-discipline rules
     load from .claude/rules/; migration/compose/env/data-import safety rules load when
     matching files are touched. Project STATE lives in docs/, read on demand. -->

## Project facts
- **What:** Fin — self-hosted personal-finance manager (accounts, transactions, budget, forecast, bank-feed integration).
- **Stack:** Express 5 + pg (`server/`) · React 19 + Vite (`frontend/`) · PostgreSQL 16 · nginx — Docker Compose. Node 20.
- **Separate repos with their own git histories:** `bank-feed/` (feed microservice, :3007) **is worked on from this session** — commit in its own repo (a worktree outside `psproject/`, since `bank-feed/` sits inside it), and record each cross-repo change in bank-feed's `HANDOFFS.md`. `ocr-llm/` (LLM gateway) is **never modified from here**. Cross-repo links keep their own naming.
- **Hosts:** dev and prod are the **same machine** (`192.168.1.87` LAN / `100.94.46.62` Tailscale) — the agent can run prod docker/psql/deploy directly. Prod: `docker-compose.yml` (project `psproject`, API :3005, DB :5433, volume pinned `fin_postgres_data`); dev: `docker-compose.dev.yml` (:3105/:5434). Single track — the v4/CR027 multi-tenancy line was retired 2026-09-28 (CR044: stay personal); changes verify on dev.
- **Ops:** version in `VERSION` (`./Scripts/bump-version.sh`); deploy `./Scripts/deploy-to-production.sh` (backs up prod DB first). Skim `ls Scripts/` before recommending build/deploy/restart commands.

## Required reading at session start
Always read first: `docs/current/status.md` (session snapshot — links onward).
Read on demand: `docs/current/project-description.md` (full current state),
`docs/current/project-roadmap.md` (plan / open items), `docs/cr/README.md` (CR index —
canonical CR statuses), `docs/current/migrations.md` (migration registry).
If the task touches an active CR, read its `docs/cr/cr-NNN-*.md` file.

## After completing any task — doc sync (before committing)
Update only what the change touches (rules: `docs/documentation-standard.md`):
1. `docs/current/status.md` — refresh the snapshot; keep ≤ ~60 lines, link onward.
2. `docs/current/project-description.md` — structural facts (routes, endpoints, schema, scripts).
3. `docs/current/project-roadmap.md` — mark items done, add newly discovered issues.
4. `docs/cr/README.md` + the CR file — update status rows; substantive new work gets the next-numbered `docs/cr/cr-NNN-<topic>.md`. Trivial fixes stay as roadmap bullets.
5. New migration ⇒ row in `docs/current/migrations.md`. New secret ⇒ row in `docs/current/secrets-inventory.md` (names/locations only, never values).

## Integration with ocr-llm
AI Review uses the local LLM gateway (pinned contract **v1**, base URL
`http://100.66.213.40:8080` via Tailscale). Before non-trivial gateway API work, follow
`docs/guides/ocr-llm-integration.md` (pull ocr-llm, fetch live spec). **A `SessionStart` hook asks
their server what we owe** (`.claude/hooks/handoff-inbox.sh`, installed 2026-09-08) — read what it
printed before starting; silence means the inbox was empty *and* their checkout was current, and
nothing else prints nothing. It replaces reading the `HANDOFFS.md` tail by hand.
