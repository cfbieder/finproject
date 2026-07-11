# <<APP>> — project instructions

<!-- Starter from the pack (v1.1.0). Keep this file LEAN — well under 150 lines. It loads
     on every turn. Collaboration rules + required-reading load automatically from
     .claude/rules/; migration/compose/env rules load when relevant files are touched;
     deploy & DB procedures are skills. Project STATE lives in docs/, not here. -->

## Project facts
- **What:** <one sentence — what the app does and for whom>
- **Stack:** <<BACKEND>> · <<FRONTEND>> · <<DB>> · <<WEB>> (see `docs/current/project-description.md`)
- **Hosts:** dev+prod on `<<HOST>>` (Tailscale `<<TS_IP>>`); prod URL `<<PROD_URL>>`
- **Stacks:** dev = `docker-compose.dev.yml` (project `<<APP>>`), prod =
  `docker-compose.prod.yml` (project `<<APP>>_prod`) — every compose command names its `-f`

## Commands
- Dev up: `docker compose -f docker-compose.dev.yml up -d` + `cd backend && npm run dev` + `cd frontend && npm run dev`
- Tests: `cd backend && npm test` · guards: `bash scripts/ci-guards.sh`
- Deploy: `./scripts/deploy-to-production.sh` (the `deploy-single-host` skill knows the gates)
- Version bump: `./scripts/update_version.sh --bump-patch`

## Project-specific rules
<!-- ONLY rules unique to THIS project that a machine can't infer from the code and that
     apply to all work. Cross-cutting pack rules already live in .claude/rules/. -->
- <e.g. "the ocr-llm/ subdirectory is a separate repo — never modify it from here">
- <e.g. "all user-facing strings go through the i18n module">

## Where things are
- Session snapshot (read first): `docs/current/status.md`
- Full playbooks (deploy, public exposure, DB ops): `docs/guides/` — the skills summarize
  them; read the playbook before any procedure you haven't done in this project.
