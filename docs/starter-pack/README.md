# Project Starter Pack

> **Pack version:** 1.5.1 · **Last reviewed:** 2026-07-11 · see [`CHANGELOG.md`](CHANGELOG.md)

A consolidated set of standards, playbooks, rules, and script sources to drop into any new
project (especially Claude Code projects). Each file is self-contained enough to copy on its
own, but they cross-reference each other, so the whole pack travels well together.

## Scope — what this pack is (and isn't) for

Tuned for **solo/small-team, single-host-first projects**: homelab or one cloud VM, Docker
Compose, PostgreSQL, a SPA + API, Tailscale as the private plane, Cloudflare as the public
edge. It deliberately **excludes** Kubernetes/orchestrators, multi-region, large-team
process (code review boards, RFC processes), and compliance frameworks beyond baseline
GDPR hygiene. If a project outgrows this scope, treat the pack as the floor, not the ceiling.

## Layout

```
starter-pack/
  README.md                     # this file — index, conventions, seeding, maintenance
  CHANGELOG.md                  # the pack's own version history
  claude-collaboration.md       # CLAUDE.md collaboration rules (explained)
  documentation-standard.md     # canonical docs convention
  infra-bootstrap.md            # dev/prod architecture + reasoning
  script-library.md             # concrete script/Dockerfile sources
  testing-and-ci.md             # test strategy + CI gates + graduating rules into CI
  security-baseline.md          # secrets lifecycle, rotation, dependency/patching policy
  observability-baseline.md     # logging/metrics/alerting baseline for any app
  data-ingestion-baseline.md    # import/replace + derived-data safety (validate, fail-loud, reconcile)
  dual-track-development.md     # ship-current + build-vNext on one trunk (flags, isolated stack)
  cross-repo-integration.md     # sibling-repo coordination: HANDOFFS.md ledger + pinned contract
  claude-code-permissions.md    # permission-prompt diagnosis + safe near-zero-prompt config
  deploy-to-public.md           # two-branch public-deploy master playbook
  deploy-to-shared-edge.md      # "one more app on a shared edge" runbook
  guides/fileshare-access.md    # homelab Samba runbook (live, environment-specific)
  templates/CLAUDE.md           # starter project CLAUDE.md (facts + pointers only)
  templates/project-brief.md    # the brief skeleton — the WHAT/WHY companion to this pack
  templates/docs/               # docs/ seed set: status, description, roadmap,
                                #   secrets-inventory, CR index, CR template
  .claude/                      # Claude Code native layer — copy into the project root
    rules/                      #   always-on + path-scoped rules (auto-loaded)
      collaboration.md          #     the collaboration rules, operational copy (unscoped)
      migrations.md             #     append-only / exec-inside-container (scoped)
      compose-safety.md         #     explicit -f, pinned names, fail-loud secrets (scoped)
      env-secrets.md            #     edit-in-place, never paste secrets (scoped)
      data-import.md            #     validate-before-destroy, fail-loud parse, reconcile (scoped)
      git-concurrency.md        #     multi-thread shared-tree git discipline (unscoped)
    skills/                     #   procedures — load only when triggered
      deploy-single-host/       #     the infra-bootstrap deploy flow
      deploy-to-public/         #     private → public (both branches, condensed)
      deploy-shared-edge/       #     co-host on an existing edge
      db-ops/                   #     migrations, backup/restore, prod→dev sync + PII scrub
      question/                 #     /question — resolve open decisions one at a time
      close/                    #     /close — doc-sync → commit → push → (gated) deploy
      kickoff/                  #     /kickoff — brief → seeded repo → decisions → CR-001
  archive/                      # superseded originals, kept for history
```

Skills are both auto-triggered by intent and directly invocable as slash commands
(`/deploy-to-public`, `/db-ops`, `/question`, `/close`). `/question` and `/close` are
*workflow* skills — they orchestrate the pack's protocols rather than a single procedure.

**Rules vs. skills vs. docs — the split:** conventions that apply to *all* work live in
`.claude/rules/` (and stay tiny); *procedures* (deploys, DB ops) live in `.claude/skills/`,
which cost ~2 lines of context until actually triggered; the **full reasoning and detail**
lives in the root `.md` playbooks, which the skills point to. The docs are canonical; the
`.claude/` layer is the operational distillation. When you change a practice, change the
doc first, then sync the rule/skill.

## When to reach for what

| File | Use it when… |
|---|---|
| [`templates/CLAUDE.md`](templates/CLAUDE.md) + [`.claude/`](.claude/) | Seeding **any** new Claude Code project — copy both in, fill the placeholders (or just run `/kickoff`). |
| [`templates/project-brief.md`](templates/project-brief.md) | Starting to think about a new project — the brief is the *what/why* input `/kickoff` consumes. |
| [`templates/docs/`](templates/docs/) | The `docs/` seed set — `/kickoff` copies these; also usable standalone. |
| [`claude-collaboration.md`](claude-collaboration.md) | Understanding/adjusting the collaboration rules (the operational copy is `.claude/rules/collaboration.md`). |
| [`documentation-standard.md`](documentation-standard.md) | Setting up a project's `docs/` — layout, naming, agent-memory conventions. |
| [`infra-bootstrap.md`](infra-bootstrap.md) | Building the app's **dev + prod architecture** — compose stacks, migrations, ops scripts, the single-host traps. |
| [`script-library.md`](script-library.md) | You want **concrete script/Dockerfile sources** while implementing infra-bootstrap. |
| [`testing-and-ci.md`](testing-and-ci.md) | Deciding what must pass before a deploy is allowed, and wiring CI. |
| [`security-baseline.md`](security-baseline.md) | Secrets storage/rotation, dependency & image update policy, the security floor. |
| [`observability-baseline.md`](observability-baseline.md) | Giving a new app (even a private one) logs, metrics, and alerts from day one. |
| [`data-ingestion-baseline.md`](data-ingestion-baseline.md) | Building any import/replace or reconstruct-from-source feature (CSV/API imports, transaction rebuilds) — validate before destroy, fail loud on bad input, reconcile. |
| [`dual-track-development.md`](dual-track-development.md) | Building a **large vNext in parallel** with a shipping current version — flags on one trunk, isolated stack, no merge tax. |
| [`cross-repo-integration.md`](cross-repo-integration.md) | The app consumes (or provides) a **sibling repo's API** — handoff ledger, pinned contract, live-spec preflight. |
| [`claude-code-permissions.md`](claude-code-permissions.md) | Agent sessions **prompt for permission constantly** — diagnosis checks + the near-zero-prompt baseline config. |
| [`deploy-to-public.md`](deploy-to-public.md) | Taking a Tailscale-private app **public** — closed (Access) or open (self-service). |
| [`deploy-to-shared-edge.md`](deploy-to-shared-edge.md) | Adding one more app to a box that already runs a shared `/opt/edge`. |
| [`guides/fileshare-access.md`](guides/fileshare-access.md) | Connecting to the homelab Samba fileshare over Tailscale. |

## Seeding a new project (step 0 → done)

**The one-command version:** write a brief on [`templates/project-brief.md`](templates/project-brief.md),
open Claude Code in the new repo with the pack available, and run **`/kickoff`** — it
performs steps 1–3 below, runs `/question` over the brief's open points, and produces
CR-001 + the first real `status.md`, stopping for confirmation before building.

Manual steps (what /kickoff automates):

1. **Copy in:** `.claude/` and `templates/CLAUDE.md` (→ project root as `CLAUDE.md`), plus
   whichever root docs the project needs into `docs/guides/` (at minimum: none — the skills
   carry condensed procedures; copy the full playbooks when you want the reasoning on hand).
2. **Scaffold docs:** follow [`documentation-standard.md`](documentation-standard.md) —
   create `docs/current/status.md`, `docs/current/project-description.md`,
   `docs/current/project-roadmap.md`, `docs/cr/README.md`.
3. **Substitute placeholders** (see convention below): find-replace `<<APP>>`, `<<HOST>>`,
   `<<TS_IP>>`, `<<PROD_URL>>`, `<<DB>>` across the copied files; in script sources,
   substitute the literals `myapp` / `myappuser` / `myapp_prod|_dev`.
4. **Answer infra-bootstrap §12's questions** (topology, async tier, Tailscale-only vs
   public) and have Claude implement the architecture, cribbing from
   [`script-library.md`](script-library.md).
5. **Wire the CI gates** from [`testing-and-ci.md`](testing-and-ci.md) before the first
   deploy, and the day-one items from [`security-baseline.md`](security-baseline.md) and
   [`observability-baseline.md`](observability-baseline.md).
6. When it's time to expose it: the `deploy-to-public` skill (or `deploy-shared-edge`).

Steps 1–3 can be delegated: open Claude Code in the new repo with this pack available and
say *"seed this project from the starter pack"* — the collaboration rules make it confirm
the placeholder values before substituting.

## Placeholder convention (two tiers — both are intentional)

- **`<<DOUBLE_ANGLE>>`** — *seed-time* substitution: replaced once, project-wide, when the
  pack is copied in (`<<APP>>`, `<<HOST>>`, `<<TS_IP>>`, `<<PROD_URL>>`, `<<DB>>`,
  `<<BROKER>>`, `<<WEB>>`).
- **`<single-angle>`** — *runtime / per-operation* fill-ins inside commands and dashboards
  (`<team>`, `<your-domain>`, `<vm-public-ip>`, `<prev-tag>`): you supply these when
  executing the step, not when seeding.
- **Script literals** — runnable scripts in [`script-library.md`](script-library.md) use
  `myapp` / `myappuser` / `myapp_prod` as concrete, working defaults; these are the
  seed-time substitution targets in script files (equivalent to `<<APP>>` in prose).

## Maintenance loop (how the pack stays deduped)

- **This repo is upstream; per-project copies are downstream forks.** A gotcha learned or a
  correction made inside a project gets committed **here first**, then synced outward —
  never left to live only in one project's copy. (Same single-source-of-truth rule the pack
  applies to ship dates, applied to itself.)
- **Version + changelog:** bump [`CHANGELOG.md`](CHANGELOG.md) on any substantive change;
  the version in this README's header is the pack's identity when comparing a project's
  copy against upstream.
- **Review cadence:** each root doc carries a `Last reviewed` date. Re-review anything
  older than ~6 months before seeding a new project from it — the gotchas catalogs
  especially (UI paths, OS package workarounds, and provider behaviors go stale).
- **Docs → rules/skills sync:** the root docs are canonical. If a doc and a
  `.claude/rules|skills` file disagree, the doc wins and the rule/skill gets fixed.

## How the pieces relate

```
.claude/rules/ + templates/CLAUDE.md    always-on layer (tiny, loads every session)
.claude/skills/                         procedures (load on trigger) ──┐
                                                                       │ distilled from
claude-collaboration.md ─┐                                             │
documentation-standard.md ┼─ "how we work + how docs are organized"    │
testing-and-ci.md         │                                            │
security-baseline.md      ┼─ cross-cutting baselines                   │
observability-baseline.md │                                            │
data-ingestion-baseline.md│                                            │
dual-track-development.md │                                            │
cross-repo-integration.md │                                            │
claude-code-permissions.md┘                                            │
infra-bootstrap.md ──── architecture + reasoning  ◀────────────────────┘
   └─ script-library.md  concrete sources
deploy-to-public.md ─── private → public
   └─ deploy-to-shared-edge.md  the shared-edge special case
guides/fileshare-access.md   standalone ops runbook
archive/                     superseded originals
```

## What changed when this pack was assembled (v1.0.0 notes)

Consolidated from nine loose memos. The non-obvious moves:
- **`deploy-to-public.md`** is the former `REF_..._MASTER` playbook (two-branch). The earlier
  EspañolApp-only three-phase version is in [`archive/`](archive/), superseded.
- **`script-library.md`** distills the legacy Express/nginx `development-practices.md`: script
  and Dockerfile sources kept, with each place it diverges from current practice corrected inline.
- **`claude-collaboration.md`** merges the standalone 4-rules memo with `infra-bootstrap` §9's
  collaboration rules (deduped).
- The old `Project_Documentation/` docs scheme (ALL-CAPS, status-in-filename) was **dropped** in
  favor of `documentation-standard.md`; `infra-bootstrap` §10 now points to it.
- The Samba guide + the separate Windows CIFS/SSH-key snippet were merged into one
  `guides/fileshare-access.md`.

See [`CHANGELOG.md`](CHANGELOG.md) for v1.1.0 (the best-practices review implementation).
