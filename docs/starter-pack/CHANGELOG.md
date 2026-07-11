# Starter Pack — Changelog

## v1.5.0 — 2026-07-11

**Upstreamed from the Fin project (dual-track, multi-agent, importer-heavy) — six
additions, each from lived practice.**

- **`dual-track-development.md` (new root doc):** ship-current + build-vNext on one trunk
  — feature flags default-OFF ("dormant-safe": flags off ⇒ byte-for-byte current
  behavior), an isolated vNext compose stack (own ports + own volume), go-live = config
  flip. Includes the AI-agent corollaries: every request declares its track (ask if
  unstated, especially DB/auth/migrations), commit scopes carry the track, verify against
  the matching stack. Proven over months of parallel v3/v4 work with zero forward-merges.
- **`cross-repo-integration.md` (new root doc):** sibling-repo coordination without a
  shared tracker — append-only `HANDOFFS.md` ledger in the provider repo (dated,
  addressed entries; the one sanctioned write into a sibling repo), pinned contract
  version in the consumer, and a fetch-the-live-spec preflight before non-trivial seam
  work.
- **`claude-code-permissions.md` (new root doc):** permission-prompt *diagnosis* (diff +
  mtime the settings; pipe-test the hook the settings reference — a missing hook errors
  invisibly on every call; check all settings layers) and the baseline config: bare-tool
  allowlist (Write and Edit are separate tools), narrow `rm` ask-net, a PreToolUse hook
  closing the prefix-rule gap (`cd x && rm y`), `additionalDirectories` for sibling
  repos, plus hook pipe-test + `jq -e` verification discipline.
- **`.claude/rules/git-concurrency.md` (new unscoped rule):** multi-thread shared-tree
  git discipline — a bare commit ships the ENTIRE index (another thread's staged work
  included); a pathspec commit ships WORKTREE state (resurrecting staged deletions —
  caused a real double key-rotation); verify `git show HEAD --name-status` after every
  commit; expect the branch to move under you; never sweep another session's dirty files.
  `claude-collaboration.md` cross-references it.
- **Migration backfill rule** (`.claude/rules/migrations.md` + `testing-and-ci.md`
  migration-chain note): any schema object that reached a live DB outside a migration is
  captured immediately in an `IF NOT EXISTS` migration, or CI's fresh-from-migrations DB
  silently diverges and unrelated tests fail much later (real incident: a column live on
  dev+prod for months broke CI only when a new test first touched it).
- **Pinned volume names** (`.claude/rules/compose-safety.md`): data volumes carry an
  explicit `name:` so their identity survives a compose-project/directory rename — an
  unpinned volume is silently abandoned (fresh empty DB) when the project name changes.
- **CR-index extensions** (`templates/docs/cr/README.md` + `documentation-standard.md`):
  optional summary-by-status roll-up past ~20 CRs; a Track column on dual-track repos.


## v1.4.0 — 2026-07-11

**Data-ingestion baseline (new) — from the Options-tool import/reconstruction incidents.**
The pack covered schema-migration safety but nothing on *importing external data and
deriving state from it*, where the failures are quiet (200 OK + healthy UI + corrupt
numbers). Four rules, each from a real incident:
- `data-ingestion-baseline.md` (new root doc): **(1) validate before you destroy** — a
  replacing import parses/validates to a non-empty result *before* deleting; a zero-row parse
  is a 4xx, not a 200 over a wiped table. **(2) External exports are unstable** — match
  headers case-insensitively, treat a missing required column as a hard error, never a silent
  `0`/`null` default on a money column; pin real exports as fixtures. **(3) Raw append-only +
  idempotent; derived rebuilt from ALL raw, never the delta** — a delta-rebuild orphans
  records whose lifecycle spans two imports. **(4) Assert a reconciliation invariant** on
  every import for quantitative reconstruction (tie out to $0.00 or a known residual; fail
  the import otherwise).
- `.claude/rules/data-import.md` (new path-scoped rule): the always-on distillation, scoped
  to parser/importer/loader files.
- README layout, when-to-reach table, and pieces diagram updated to include the new baseline.

## v1.3.4 — 2026-07-07

**Proactive SPA cache-header standard (from the Staritsky stale-chunk incident).**
- `deploy-to-public.md` — new gotcha **#29**: a code-split SPA served with **no
  `Cache-Control`** is a stale-`index.html` / lazy-chunk time bomb (`Failed to
  fetch dynamically imported module` — the shell loads, a route blanks). The
  durable fix is set at the **origin**, not via reactive "Purge Everything" (#10)
  on every deploy: content-hashed `/assets/*` → `immutable`; the `index.html`
  entry document → `no-store`/`no-cache` so it always revalidates and can never
  pin obsolete chunk hashes. Redeploys then need **no** cache purge. Part 1.2
  gains a "set this from day one" pointer.
- `script-library.md` §8 — **completed the frontend serving template**: the nginx
  image now `COPY`s a real `nginx.conf` (SPA routing **+** the #29 cache policy),
  with the Caddy equivalent alongside. Previously the template `rm`'d the default
  conf and shipped no replacement — neither routing nor a cache policy, which is
  the root reason the stale-chunk bug kept being discovered reactively.

## v1.3.3 — 2026-07-07

**Compiled-TS + Prisma Dockerfile traps (from the Staritsky prod bring-up).**
- `script-library.md` §8 — added a "compiled-TS + Prisma variant" callout to the backend
  Dockerfile: add a build stage (`prisma generate` + `npm run build`), point `CMD` at the
  compiled entrypoint (`dist/main.js`, not `server.js`), and keep the **`prisma` CLI in
  `dependencies`** so the in-container migrate isn't pruned by `npm ci --omit=dev`. All
  three fail only at container start / deploy time, so a green CI build doesn't catch them.
- `infra-bootstrap.md` §5 — cross-ref note on the hard rule: the migrate tool must exist in
  the prod image (a devDependency-pruned CLI can't run inside the container).

## v1.3.2 — 2026-07-06

**Public-deploy gotchas from the OCME service-worker / Access-expiry incident.**
- `deploy-to-public.md` catalog: added gotchas **#25–28** — Access session expiry bricking
  a SPA mid-session (apiFetch reload guard); the PWA-service-worker-vs-Access deadlock +
  self-destroying-stub escape hatch; the public Bypass Access app for `/sw.js`+`/workbox-*`;
  and the `sw.js` cache-header/nginx-location-precedence trap (exact-match + edge purge).
- Added a build-time design rule in Part 2A.3 and the `deploy-to-public` skill's Branch A
  checklist so the SW-vs-Access decision is made *before* shipping, not diagnosed after.
  Safe default stated: internal/staff apps ship **no caching SW** (manifest-only install).

## v1.3.1 — 2026-07-06

**/close version policy + version-display standard made explicit.**
- `/close` now **auto-bumps the version** on any code-shipping close — patch for
  fixes/internal, minor for new user-facing capability (Claude decides, states the choice,
  user can override); date refreshes with the bump; docs-only closes don't bump.
- Explicit standard added (infra-bootstrap §3 + §8/§11, script-library §9): the full
  version string — number **and** date — is displayed in the UI of **both** dev and prod,
  reading the same copied `version.json` (import, not build-arg-only, so dev can't fall
  back to a fake value); dev remains visually unmistakable (banner color, [DEV] tab,
  favicon). Version row added to the differentiation table.

## v1.3.0 — 2026-07-06

**Project-kickoff completion — brief + templates + orchestration.**
- `templates/project-brief.md` — the brief skeleton (problem/users/scope, the 30-day
  Phase 1 success criterion + kill criteria, PII inventory, regulatory/competitive
  landscape, infra-bootstrap §12 answers, risks/open questions, phase plan).
- `templates/docs/` — seed set for the documentation standard: `current/status.md`,
  `project-description.md` (with migration-matrix / job-registry / secrets-inventory
  tables built in), `project-roadmap.md`, `secrets-inventory.md`, `cr/README.md` index,
  and `cr/cr-000-template.md` (CR skeleton with an impact checklist tying CRs to the
  matrix/registry/rosters/tests rules).
- `.claude/skills/kickoff/` — `/kickoff`: brief → seeded repo (placeholders substituted,
  pack version recorded) → `/question` over unanswered decisions → CR-001 + first real
  status.md → confirm-gated handoff to building.

## v1.2.0 — 2026-07-06

**Workflow skills (new).**
- `.claude/skills/question/` — `/question`: walk all open questions/decisions one at a
  time (options + recommendation + rationale, discussion before advancing, decisions
  summary recorded per the documentation standard). The invocable form of the
  collaboration rules' question protocol.
- `.claude/skills/close/` — `/close`: session close-out — doc-sync per the documentation
  standard → explicit-paths commit + verified push (concurrency protocol) → confirm-gated
  production deploy via the deploy-single-host gates → close report.

## v1.1.0 — 2026-07-06

Implemented the best-practices review:

**Claude Code native layer (new).**
- `.claude/rules/` — `collaboration.md` (unscoped, always loads; replaces pasting the block
  into `CLAUDE.md`), plus path-scoped `migrations.md`, `compose-safety.md`, `env-secrets.md`.
- `.claude/skills/` — `deploy-single-host`, `deploy-to-public`, `deploy-shared-edge`,
  `db-ops`: condensed procedures with trigger descriptions; full playbooks remain canonical.
- `templates/CLAUDE.md` — starter project file: facts + pointers only.

**New baseline docs.**
- `testing-and-ci.md` — test strategy, deploy gates, pre-commit, and the rule for graduating
  mechanically-checkable conventions from CLAUDE.md into CI.
- `security-baseline.md` — secrets storage + rotation cadence + per-project inventory;
  dependency & image update/patching policy.
- `observability-baseline.md` — day-one logging/metrics/alerting for any app (extracted and
  generalized from deploy-to-public Phase 2.4).

**Safety fixes to existing content.**
- Prod→dev DB sync now **requires a PII scrub step** (GDPR; clinic/client data) — added to
  `infra-bootstrap.md` §4 and `script-library.md` §7, with a scrub-script spec.
- **Restore drills** added to the backup strategy (quarterly restore verification +
  `verify-restore.sh` spec) — untested backups are a hypothesis.

**Pack mechanics.**
- Pack versioning + this changelog; upstream/downstream maintenance rule in README.
- Two-tier placeholder convention documented (`<<seed-time>>` vs `<runtime>` vs script literals).
- `Last reviewed` dates on all root docs; scope statement; seeding steps incl. step 0;
  table of contents added to `infra-bootstrap.md`.

## v1.0.0 — 2026-07-06

Initial consolidation of nine loose memos into the deduped pack. See README §"What changed
when this pack was assembled".
