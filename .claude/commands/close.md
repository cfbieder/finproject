---
description: Finalize release — docs, version bump, commit, push, deploy
allowed-tools: Bash(git *), Bash(./Scripts/*), Bash(Scripts/*), Bash(cat *), Bash(ls *), Edit, Read, Write
---

## Context
- Current branch: !`git branch --show-current`
- Status: !`git status --short`
- Current VERSION: !`cat VERSION`
- Last tag: !`git describe --tags --abbrev=0 2>/dev/null || echo "none"`
- Recent commits (find the last `release:`/tag entry to see what's new since): !`git log --oneline -30`

## Task
Finalize this release end-to-end for **psproject** (Fin). Follow the project conventions in `CLAUDE.md` — there is no README.md / CHANGELOG.md at the repo root; release notes live in `docs/`.

1. **Update documentation** — Review the commits listed above and update:
   - `docs/current/status.md` — refresh the session snapshot (current phase, shipped headlines as links, what's next). Keep ≤ ~60 lines; it links onward, never restates.
   - `docs/current/project-description.md` — any changed routes, API endpoints, DB tables, scripts, or architecture.
   - `docs/current/project-roadmap.md` — mark completed CRs/items as done, add a "Released vX.Y.Z (YYYY-MM-DD)" entry summarising what shipped, and capture any new known issues discovered.
   - `docs/cr/` — update the status header/body of any CR that was completed or advanced; if the release warrants a new CR (substantive feature, multi-session work, architectural impact), create the next-numbered `cr-NNN-<topic>.md` and add a row to `docs/cr/README.md` (the CR index). Trivial fixes stay as bullets in `docs/current/project-roadmap.md`.
   - `docs/current/migrations.md` / `docs/current/secrets-inventory.md` — if the release added a migration or a secret (names/locations only).

2. **Bump version** — Decide patch/minor/major from the diff (semver). Run:
   - `./Scripts/bump-version.sh patch` (or `minor` / `major` / explicit `X.Y.Z`).
   This updates `VERSION` and `frontend/.env`. Confirm the new version with `cat VERSION`.

3. **Commit, tag, push** — Stage the release files with explicit pathspecs (never `git add -A` / `git add .` — see `.claude/rules/git-concurrency.md`), commit with `release: vX.Y.Z (summary)`, tag `vX.Y.Z`, push commits and tags to origin:
   ```
   git add VERSION frontend/.env docs/ <other files you changed>
   git commit -m "release: vX.Y.Z (summary)" -- VERSION frontend/.env docs/ <other files>
   git tag vX.Y.Z
   git push origin HEAD
   git push origin vX.Y.Z
   ```
   Verify with `git show HEAD --name-status` that only your files landed before pushing.

4. **Deploy to prod** — Run `./Scripts/deploy-to-production.sh` from the repo root. This backs up the prod DB, rebuilds + restarts production containers, and verifies health. Watch the output and report success/failure.

## Guardrails
- Stop and ask before any destructive or irreversible step: force-push, deploying a **major** version bump, tagging over an existing tag, or anything `deploy-to-production.sh` warns about.
- Never use `--no-verify` or skip hooks.
- Report what was done at each step (file paths changed, version chosen + why, tag pushed, deploy outcome).
- If `git status` shows unrelated uncommitted work at the start, ask before staging — don't sweep it into the release commit.
