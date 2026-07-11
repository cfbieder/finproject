# Git discipline — shared tree, multiple agent threads (always loaded)

This repo has a single shared working tree, index, and branch, and more than one agent
thread may be active at once. To avoid one thread absorbing or wiping another's work:

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
5. **Never commit `.env`** — it carries local-only values (real DB password, API keys).
6. **`main` is the single trunk and the prod deploy source.** Apply DB migrations to
   **prod before** deploying code that references the new objects, or the deploy breaks
   the running app.
