#!/usr/bin/env bash
# ci-guards.sh — mechanical enforcement of pack conventions. Fail loud, explain why.
#
# The rule (testing-and-ci.md): if a violation would block a merge, enforce it here; if it
# would merely raise a reviewer's eyebrow, it can stay a written convention. Extend per
# project — every "learned the hard way" a machine can check belongs here, not only in prose.
set -euo pipefail
fail() { echo "CI-GUARD FAIL: $*" >&2; exit 1; }

# 1. No weak-default secrets in any non-dev compose file (infra-bootstrap §8).
#    Note the ':-[^}]' — an EMPTY default (${VAR:-}) is legitimate and must not fail the
#    build: it is the idiom for "this integration stays off until a key is configured".
#    Matching a bare ':-' flags that deliberate pattern and trains people to skip the guard.
for f in docker-compose*.yml; do
  [ "$f" = docker-compose.dev.yml ] && continue
  [ -e "$f" ] || continue
  grep -E '\$\{[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z_]*:-[^}]' "$f" \
    && fail "$f gives a secret a non-empty default — use \${VAR:?msg}" || true
done
#    Blind spot worth stating: a BARE ${JWT_SECRET} is not fail-loud either — compose
#    substitutes the empty string and the app boots with an empty secret. This guard cannot
#    distinguish "not yet migrated to :?" from "intentional", so promoting it to a hard fail
#    is a per-project decision made once, deliberately.

# 2. Compose project names pinned + distinct (infra-bootstrap trap #12):
grep -q '^name:' docker-compose.prod.yml || fail 'docker-compose.prod.yml missing top-level name:'
grep -q '^name:' docker-compose.dev.yml  || fail 'docker-compose.dev.yml missing top-level name:'
[ "$(grep '^name:' docker-compose.prod.yml)" != "$(grep '^name:' docker-compose.dev.yml)" ] \
  || fail 'dev and prod compose share the same project name'

# 3. Applied migrations are append-only (infra-bootstrap §5): any commit that MODIFIES an
#    existing migration file (rather than adding one) fails.
if git rev-parse origin/main >/dev/null 2>&1; then
  git diff --diff-filter=M --name-only origin/main...HEAD -- '*migrations/*' '*alembic/*' \
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

# 7. Backup dumps never reach git: Backups/ is ignored and no dump is tracked
#    (a committed pg_dump is PII in git history forever — security-baseline §1).
git check-ignore -q 'Backups/x.dump' \
  || fail 'Backups/ is not gitignored — add it (see templates/.gitignore)'
git ls-files | grep -E '(^|/)Backups/|\.dump$' \
  && fail 'a backup dump is tracked in git' || true

# 8. Personal agent config stays out of the tree (open-source-release Phase 1). Uncomment
#    when the repo is public — before then, .claude/ is deliberately tracked.
# git ls-files | grep -E '^\.claude/' \
#   && fail '.claude/ is tracked — untrack it before publishing (git rm -r --cached .claude)' || true

echo "ci-guards: all green"
