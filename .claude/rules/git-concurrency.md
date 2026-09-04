# Git discipline — shared tree, multiple agent threads (always loaded)

This repo has a single shared working tree, index, and branch, and more than one agent
thread may be active at once. To avoid one thread absorbing or wiping another's work:

## 0. A session that will COMMIT works in its own worktree (owner decision, 2026-09-04)

**On one working tree there is no safe commit primitive**, which is why rules 1–2 below
failed three times (2026-08-12 ×2, 2026-09-04) and why documentation alone cannot fix
this. Both mechanisms are shared mutable state:

- `git commit -- <paths>` commits the **worktree** state of those paths, so another
  thread's edit to a file you also touched rides along under your message.
- `git add <paths>` + bare `git commit` uses the **index**, which is equally shared.

Rule 1 sends you to the first; rule 2 forces you onto the second for deletions. Each
incident's victim had followed the rule correctly. The third took a **source file**
(`Scripts/extract-statements-llm.js`) into an unrelated thread's commit, which was then
pushed — the earlier two only misattributed prose.

**So: if this session will commit, get off the shared tree first.** Use `EnterWorktree`,
or `git worktree add ../psproject-<topic> -b <topic>`. Commit there, then merge to `main`
as one unit. Symlink `server/node_modules` (and `frontend/node_modules` if needed) from
the main tree rather than reinstalling.

**The one escape, and check it rather than assume it:** you may work directly on `main`
when you are demonstrably the only writer — `git status` clean at session start, `git
worktree list` shows only the main tree, and the user has not mentioned another session.
**Re-check immediately before committing**; if files you did not edit have appeared, stop
and move to a worktree. State which branch you took, so the choice is visible.

⚠️ **A worktree isolates git, NOT the test rig.** jest runs `maxWorkers: 1` because the
DB-backed suites share dev Postgres on `:5434`; `Scripts/test-fresh-db.sh` uses a fixed
container name; only one stack can hold ports 3105/5434. Parallel sessions edit and
commit freely but must still take turns running tests and the dev stack.

**Never commit a file you did not edit in this session** — that single check would have
caught all three incidents.

## The rest still applies (inside a worktree too)

1. **Always stage AND commit with explicit pathspecs.** A bare `git commit` after
   `git add <files>` still commits the **entire index**, including another thread's
   pre-staged changes. Correct forms: `git commit -m "msg" -- <files>` (`-m` and its
   message come **before** the `-- <paths>`, or git parses the message as a pathspec) —
   or `git add <files>` then **verify** `git diff --cached --name-status` before a bare
   commit. **Never** `git add -A`, `git add .`, or `git commit -a`. After committing, run
   `git show HEAD --name-status` to confirm only your files landed; if a stray file rode
   along and the commit isn't pushed: `git reset --soft HEAD~1`, `git restore --staged
   <stray>`, re-commit.
2. **Exception — staged deletions:** `git commit -- <paths>` commits the **worktree**
   state of those paths, resurrecting `git rm --cached` deletions (this caused CR034's
   double key rotation). Commit deletions via a verified index (check
   `git diff --cached --name-status`, then bare `git commit`), not via pathspec.
3. **Do not run `git stash`, `git checkout <paths>`, `git reset`, or branch switches
   while other uncommitted work may exist** — these can move or destroy it. If unsure,
   run `git status` first.
4. **Expect the branch to move under you.** Another thread may add commits or cut a
   release between your reads; re-check `git log`/`git status` before committing.
   Before pushing: `git pull --ff-only`, then push. **Never force-push** the shared
   branch. **Do not push without explicit user confirmation** — local commits are fine.
   **Exception — `/close`:** invoking `/close` IS the confirmation, for every step it
   covers (docs, version bump, commit, tag, **push**, **deploy to prod**, including the
   migrations `deploy-to-production.sh` applies at Step 2b). Do not stop midway to
   re-ask. Everything else in this file still applies: pathspec commits, verify what
   landed, `pull --ff-only`, never force-push. Stop only for something `/close` does not
   cover — a force-push, tagging over an existing tag, or a script warning that needs a
   judgement call.
5. **Never commit `.env`** — it carries local-only values (real DB password, API keys).
6. **`main` is the single trunk and the prod deploy source.** Apply DB migrations to
   **prod before** deploying code that references the new objects, or the deploy breaks
   the running app.
