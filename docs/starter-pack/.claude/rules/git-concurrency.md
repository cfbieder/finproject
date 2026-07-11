# Git discipline — shared tree, multiple agent threads (always loaded)

When more than one agent session can be active on the same working tree, index, and
branch, these rules keep one thread from absorbing or wiping another's uncommitted work.
(Every rule below comes from a real incident.)

1. **Always stage AND commit with explicit pathspecs.** A bare `git commit` after
   `git add <files>` still commits the **entire index**, including another thread's
   pre-staged changes. Correct forms: `git commit -m "msg" -- <files>` (`-m` and its
   message come **before** the `-- <paths>`, or git parses the message as a pathspec) —
   or `git add <files>` then **verify** `git diff --cached --name-status` before a bare
   commit. **Never** `git add -A`, `git add .`, or `git commit -a`. After committing,
   `git show HEAD --name-status` to confirm only your files landed; if a stray file rode
   along and the commit isn't pushed: `git reset --soft HEAD~1`, `git restore --staged
   <stray>`, re-commit.
2. **Exception — staged deletions:** `git commit -- <paths>` commits the **worktree**
   state of those paths, resurrecting `git rm --cached` deletions. Commit deletions via
   a verified index (check `git diff --cached --name-status`, then bare commit), not via
   pathspec.
3. **Do not run `git stash`, `git checkout <paths>`, `git reset`, or branch switches
   while other uncommitted work may exist** — these can move or destroy it. If unsure,
   run `git status` first; run destructive git commands alone, never inside a chained
   command line.
4. **Expect the branch to move under you.** Another thread may add commits or cut a
   release between your reads; re-check `git log`/`git status` before committing.
   Before pushing: `git pull --ff-only`, then push. **Never force-push** the shared
   branch; do not push without explicit user confirmation — local commits are fine.
5. **Never sweep another session's in-flight files** into your commit — if files you
   didn't touch are dirty, flag them instead of staging them.
