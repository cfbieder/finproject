# Testing & CI Baseline

> **Pack role:** the layer between "code written" and "deploy allowed." Companion to
> [`infra-bootstrap.md`](infra-bootstrap.md) (which covers build→deploy→backup) — this doc
> covers what must be true *before* the deploy script is allowed to run, and how to enforce
> it mechanically instead of by convention.
>
> **Last reviewed:** 2026-07-11.

## The stance (proportionate to this pack's scope)

Solo/small-team, one prod host. The goal is not coverage theater; it's that **a deploy
cannot ship a regression you already knew how to catch.** Three tiers, in priority order:

1. **Smoke tests (non-negotiable, from day one).** A handful of end-to-end checks against a
   running stack: app boots, `/health` 200s, login works, one real data path round-trips
   (create → read back). These run **inside the deploy script** after `up -d` and gate the
   success banner — infra-bootstrap §2 step 9 is the hook point. If you write nothing else,
   write these.
2. **Unit/integration tests on the logic that loses money or data.** Auth flows, permission
   scoping, anything that mutates records across tables (merges, cascade deletes,
   anonymization), migration up-paths, and money/date arithmetic. Don't chase coverage % —
   chase the functions whose failure you'd notice in prod.
3. **Contract/regression tests where two things must stay in lockstep.** The
   schema-introspection exhaustiveness guard (infra-bootstrap §11) is the pattern: query
   `information_schema` for every FK targeting entity X and assert the merge/anonymize
   handler covers each. Generalize it to any "must stay exhaustive as the schema grows"
   invariant.

**AI-assisted development corollary:** when Claude Code writes a feature, the *tests are
part of the feature* — require tier-2 tests in the same CR for anything matching the list
above. An agent that can run the test suite catches its own regressions; one that can't is
guessing.

## Deploy gates (wire these into the pipeline / deploy script)

A deploy is allowed only when, in order:

1. **Working tree clean at `origin/main`** (single host) or **pushed to `origin/main`**
   (remote pull-based) — already in infra-bootstrap §2/§2.5; restated here because it's a
   gate, not a step.
2. **Test suite green** — run before the image build, not after. On a single host:
   `npm test` / `pytest` locally in the deploy script's preflight. With CI (below): the
   deploy script checks the latest commit's CI status
   (`gh run list --commit $(git rev-parse HEAD)` or the API) and refuses on red.
3. **Migrations rehearsed** — for any deploy carrying a migration: it has been applied to
   dev (and staging, if the 3rd stack exists — infra-bootstrap §1) and shows in the
   cross-env matrix as dev-green before prod.
4. **Post-deploy smoke green** — tier-1 checks pass against the live stack; a red smoke
   after a deploy triggers the rollback procedure, not debugging-in-prod.

## Minimal CI pipeline (GitHub Actions or equivalent)

One workflow, on push + PR to `main`:

```yaml
# .github/workflows/ci.yml — skeleton; adapt runners/commands to the stack
name: ci
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_PASSWORD: ci, POSTGRES_DB: <<APP>>_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready" --health-interval 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - name: Install deps
        run: cd backend && npm ci        # or: pip install -r requirements.txt
      - name: Migrations apply cleanly to an empty DB (or restore-then-delta — see note)
        run: cd backend && npm run migrate:ci
      - name: Seed CI reference rows            # ci-seed.sql — see the seed note below
        run: cd backend && npm run seed:ci
      - name: Unit + integration tests
        run: cd backend && npm test
      - name: Convention guards
        run: bash scripts/ci-guards.sh
      - name: Frontend tests                    # BLOCKING — a build-only frontend job is a trap (see below)
        run: cd frontend && npm ci && npm test
      - name: Frontend build compiles
        run: cd frontend && npm run build
```

> **CI-seed convention:** keep a small `ci-seed.sql` (explicitly *not* a migration) for
> the handful of reference rows the suite assumes exist — hardcoded ids/names the code
> looks up (a special account, a fixed category). Apply it *after* the migration chain.
> Migrations stay pure schema; the fresh-DB path stays actually runnable.
>
> **Frontend tests are a blocking step, not just the build.** A frontend job that only
> compiles is a standing trap: the test suite exists, everyone assumes CI runs it, and it
> never does — regressions ship green until someone runs it by hand. (Found live in a
> mature project: months of Vitest tests, zero CI executions, a ~5-line fix.)
>
> **Migration-chain note:** if the chain is not replayable from scratch (the Alembic
> regenerated-snapshot trap — deploy-to-public gotcha #15), the CI migration step should
> restore a sanitized seed dump and apply the delta, mirroring how prod actually migrates.
> Testing a path prod will never take is a false green. The inverse trap: a column added
> to live DBs **outside** a migration passes everywhere except CI's fresh-from-migrations
> DB — and fails only when a later test first touches it. Backfill an `IF NOT EXISTS`
> migration the moment such drift is found (`.claude/rules/migrations.md`).

## Graduating rules from CLAUDE.md into CI (`scripts/ci-guards.sh`)

**The rule:** if a violation would block a merge, enforce it in CI; if it would merely
raise a reviewer's eyebrow, it can stay a written convention. Instructions to an agent are
guidance, not enforcement — several of this pack's conventions are mechanically checkable
and should be *both* written down *and* guarded:

```bash
#!/usr/bin/env bash
# ci-guards.sh — mechanical enforcement of pack conventions. Fail loud, explain why.
set -euo pipefail
fail() { echo "CI-GUARD FAIL: $*" >&2; exit 1; }

# 1. No weak-default secrets in the prod compose (infra-bootstrap §8):
grep -E '\$\{[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*:-' docker-compose.prod.yml \
  && fail 'prod compose uses ${VAR:-default} for a secret — use ${VAR:?msg}' || true

# 2. Compose project names pinned + distinct (traps #12):
grep -q '^name:' docker-compose.prod.yml || fail 'docker-compose.prod.yml missing top-level name:'
grep -q '^name:' docker-compose.dev.yml  || fail 'docker-compose.dev.yml missing top-level name:'
[ "$(grep '^name:' docker-compose.prod.yml)" != "$(grep '^name:' docker-compose.dev.yml)" ] \
  || fail 'dev and prod compose share the same project name'

# 3. Applied migrations are append-only (infra-bootstrap §5): any commit that MODIFIES an
#    existing migration file (rather than adding one) fails.
if git rev-parse origin/main >/dev/null 2>&1; then
  git diff --diff-filter=M --name-only origin/main...HEAD -- 'backend/migrations/*' \
    | grep -q . && fail 'an existing migration file was modified — migrations are append-only' || true
fi

# 4. No secrets committed: gitignore covers .env family; nothing matching a key pattern tracked.
git ls-files | grep -E '(^|/)\.env(\.|$)' | grep -v '\.env\.example' \
  && fail 'a .env file is tracked in git' || true

# 5. Retired secrets never reappear: literal values that were rotated OUT stay banned
#    forever (extend the list at every rotation; exclude the docs that record the incident).
BANNED='CHANGE_ME_retired_password|CHANGE_ME_old_api_key'
git grep -nIE "$BANNED" -- . ':!docs/' \
  && fail 'a retired secret value reappeared in the codebase' || true

# 6. (project-specific) schema-introspection exhaustiveness guard — see infra-bootstrap §11.
echo "ci-guards: all green"
```

Extend per project; every new "learned the hard way" that a machine can check belongs here,
not only in prose.

## Pre-commit (lightweight, optional but cheap)

Lint + format + guard #4 above as a local pre-commit hook (`pre-commit` framework or a
plain `.git/hooks/pre-commit`). Keep it under ~5 seconds — anything slower gets bypassed
with `--no-verify` and the discipline dies. Heavy checks belong in CI, not the hook.

## What this doc deliberately doesn't mandate

Coverage thresholds, E2E browser-automation suites, and mutation testing — all fine
additions when a project earns them, all disproportionate as a *baseline* for this pack's
scope. Add per project via a CR when the pain justifies it.
