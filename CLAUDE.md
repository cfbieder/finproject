# CLAUDE.md — Fin Project Instructions

<!-- Keep this file LEAN — it loads on every turn. Collaboration + git-discipline rules
     load from .claude/rules/; migration/compose/env/data-import safety rules load when
     matching files are touched. Project STATE lives in docs/, read on demand. -->

## Project facts
- **What:** Fin — self-hosted personal-finance manager (accounts, transactions, budget, forecast, bank-feed integration).
- **Stack:** Express 5 + pg (`server/`) · React 19 + Vite (`frontend/`) · PostgreSQL 16 · nginx — Docker Compose. Node 20.
- **Separate repos, never modify from here:** `bank-feed/` (feed microservice, :3007) and `ocr-llm/` (LLM gateway) have their own git histories; cross-repo links keep their own naming.
- **Hosts:** dev and prod are the **same machine** (`192.168.1.87` LAN / `100.94.46.62` Tailscale) — the agent can run prod docker/psql/deploy directly. Prod: `docker-compose.yml` (project `psproject`, API :3005, DB :5433, volume pinned `fin_postgres_data`); dev: `docker-compose.dev.yml` (:3105/:5434); v4: `docker-compose.v4.yml` (project `finv4`, :3205/:5435).
- **Ops:** version in `VERSION` (`./Scripts/bump-version.sh`); deploy `./Scripts/deploy-to-production.sh` (backs up prod DB first). Skim `ls Scripts/` before recommending build/deploy/restart commands.

## Required reading at session start
Always read first: `docs/current/status.md` (session snapshot — links onward).
Read on demand: `docs/current/project-description.md` (full current state),
`docs/current/project-roadmap.md` (plan / open items), `docs/cr/README.md` (CR index —
canonical CR statuses), `docs/current/migrations.md` (migration registry).
If the task touches an active CR, read its `docs/cr/cr-NNN-*.md` file.

## Version track — v3 (current) vs v4 / CR027 (dual-path)
Trunk-based: v3 (live) and v4 (= CR027 multi-tenancy) both live on `main`. v4 is
flag-gated (`FIN_MULTI_TENANT` / `AUTH_ENABLED`, default OFF) and ships dormant.
Full pattern: `docs/guides/dev-workflow.md`; setup: CR027 §"Step 0".

- The user signals the track with a prefix like **"v3 tweak"** or **"v4 / CR027x"**. **If a request doesn't say which, ASK before editing** — especially DB-layer files (`server/src/v2/db/`), auth, migrations, or anything flag-related.
- **v3** changes must not depend on the v4 flags; verify against dev (`:3105`).
- **v4** changes must be flag-gated and dormant-safe (flags OFF ⇒ byte-for-byte v3 behavior, e.g. no tenant context ⇒ `search_path = public`); verify against the isolated v4 stack (`:3205`). Only merge to `main` once dormant-safe.
- Commit scope reflects the track (`feat(cr027a): …` for v4). Prod deploys `main` with flags OFF — never put flag-ON values in the prod compose.

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
`docs/guides/ocr-llm-integration.md` (pull ocr-llm, read `HANDOFFS.md` tail, fetch live spec).
