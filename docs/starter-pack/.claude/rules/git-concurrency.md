# Git discipline — shared tree, multiple agent threads (always loaded)

When more than one agent session can be active on the same working tree, index, and
branch, these rules keep one thread from absorbing or wiping another's uncommitted work.
(Every rule below comes from a real incident.)

## 0. A session that will COMMIT gets its own worktree

On one shared working tree there is **no safe commit primitive**, which is why rules 1–2
below are necessary but not sufficient. Both commit forms read shared mutable state:
`git commit -- <paths>` takes the **worktree** copy of those paths (another thread's edit to a
file you also touched rides along under your message), and `git add` + bare `git commit` takes
the **index**, which is equally shared. Rule 1 sends you to the first; rule 2 forces you onto
the second for deletions. *Measured in one project: three incidents in which the victim had
followed rules 1–2 correctly — the third carried an unrelated **source file** into another
thread's commit, which was then pushed.*

- **If this session will commit, get off the shared tree first:** `git worktree add
  ../<repo>-<topic> -b <topic>` (or the agent's worktree tool), commit there, merge to `main`
  as one unit. Symlink `node_modules`/venvs from the main tree rather than reinstalling.
- **The one escape — checked, not assumed:** work on `main` directly only when you are
  demonstrably the sole writer (`git status` clean at start, `git worktree list` shows one
  tree, no other session mentioned). **Re-check immediately before committing**, and say which
  branch you took so the choice is visible.
- ⚠️ **A worktree isolates git, not the test rig.** Suites sharing one dev database, fixed
  container names and fixed ports still serialise: parallel sessions edit and commit freely but
  take turns running tests and the dev stack.
- **Never commit a file you did not edit in this session** — the one check that would have
  caught all three incidents.

## The rest still applies (inside a worktree too)

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
6. **Sequential identifiers are allocated concurrently.** Any "next number = highest on disk
   + 1" scheme — CR/ADR/RFC docs, migration revisions, fixture ids — hands two sessions the
   same number when both look before either writes. Claim the number by **writing the file
   and its index row immediately**, before doing the work it names; re-check for a collision
   at commit time. A `git status` from session start is a snapshot, not the current state:
   another session's files can appear, change, and be committed underneath you mid-task.
7. **Re-read a file before editing it if you did not write it this turn.** On a shared tree,
   the copy you read ten minutes ago may already be someone else's edit. This is what makes
   "verify what landed" (rule 1) a check rather than a formality.
