---
name: update-docs
description: "Review all documentation and code, ensure all documentation is updated — CRs, roadmap, actual state — and fully aligned with both the code and each other; fix the drift, then confirm the session can be closed and picked up in a new session with /next-steps. Use when the user types /update-docs, or asks to align / reconcile / bring the docs up to date before ending a session."
---

# /update-docs — align the docs, then hand over

Ends a working session cleanly: the docs say what the code and production actually are, the docs
agree with each other, and a fresh session can start from `/next-steps` without this conversation.

It **orchestrates** the checks the project already has rather than re-implementing them — two
copies of one rule are how they start disagreeing:

| check | owned by |
|---|---|
| mechanical doc checks (links, CR-filename references, counts) | none — Fin has no docs guard script (CI's guards and `Scripts/check-*.sh` are code ratchets, not doc checks) |
| status / roadmap / CR index vs the code | the **`docs-currency-reviewer`** agent (read-only) |
| each open CR vs the code + roadmap reconcile | `/cr-open` Phases 1–3b |
| what the next session will read | `/next-steps` Phase 1 sources |

Unlike `/next-steps` (read-only) this skill **edits docs**. It never edits code, deploys, migrates,
or rebuilds the operator brief (`/brief` has its own triggers).

## Phase 0 — is the tree stable? (shared checkout)

Run, and re-run before committing: `git status --short` · `git fetch origin && git log --oneline -1
origin/<main>` · a process check for other agent sessions and for a deploy in progress.

- Dirty files you did not write this session belong to **another session** — list them; never
  stage, stash, restore or "fix" them (`.claude/rules/git-concurrency.md`).
- A release or deploy in progress elsewhere: wait for it to finish before reading "actual state".

## Phase 1 — ground truth (derive this run; memory is not a source)

- **Production version**: from the running prod container, never the local `VERSION` file or tag —
  `docker exec fin-server node -p "require('./package.json').version"` for the release, and
  `docker inspect fin-server --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`
  for the deployed commit (compare with the tag's commit). `/api/v2/health`'s `version` is the API
  version (`v2`), not the release.
- **Repo**: latest tag, `git log --oneline <latest-tag>..origin/<main>` (pushed but unreleased),
  unpushed local commits, highest migration number.
- **CRs**: count `docs/cr/` files by their status token, and compare with the index's summary.
- **Guard script**: none in this repo — skip.
- Production DB / host readings only if access is permitted; otherwise write "not verified", never
  a remembered value.

## Phase 2 — audit (parallel where independent)

1. Launch `docs-currency-reviewer` with the Phase-1 facts and the session's releases; ask for
   file:line, what it says, what is true (with evidence), and the exact fix — must-fix vs nice-to-have.
2. Meanwhile, for each **open / in-progress CR**: apply `/cr-open` Phases 1–3b (its status line, its
   index row, its roadmap entries and the code must agree).
3. Any other living doc `CLAUDE.md` lists (an AI-call catalogue, a routing registry, a secrets
   inventory…): check it followed any change since the last tag.
4. **Cross-doc pass**: the prod version, each CR's status and each "next step" must read the same in
   `status.md`, the roadmap, the CR index, the CR file itself, and any agent memory index the project
   keeps (pointer + prod version only). A fact stated in several places is where drift starts — prefer
   one home plus links.

## Phase 3 — fix

- Re-read each file immediately before editing it (another session may have changed it).
- Follow the project's `documentation-standard.md`: `status.md` stays a thin index (edit sections in
  place); dated narrative goes to the archive/changelog, newest first.
- CR status: correct drifted *text*, but a CR's rename or close belongs to its owner — do not close
  another thread's in-flight CR without the user's OK; report it instead.
- Structural moves (archiving old hand-over sections, shrinking an oversized index) are reported as
  proposals, not done silently.
- Re-run the guard script after the edits.

## Phase 4 — commit (docs only)

Explicit pathspecs only; `git diff -U0 -- <paths>` right before committing and confirm every hunk is
yours; `git show HEAD --name-status` after. Message: `docs: align documentation with code and prod
(YYYY-MM-DD)`. **Do not push without the user's confirmation** — ask in the report.

## Phase 5 — the handover verdict

Print a short report:

1. **Ground truth** — prod version, HEAD vs origin vs latest tag, highest migration, CR counts.
2. **Fixed** — one line per correction (file → what changed).
3. **Not fixed** — drift left for the user or another session's owner, and proposals, with why.
4. **Verdict** — exactly one of:
   - ✅ **Safe to close — pick up in a new session with `/next-steps`.** Requires: no uncommitted
     work of this session, nothing of this session unpushed (or the user declined the push), prod =
     latest tag (or the gap is named in `status.md`), no background job or deploy of this session
     still running, guard script clean, every `/next-steps` source readable.
   - ⚠️ **Not yet** — the specific blockers, each with the action that clears it.

## Hard rules

- ⛔ Never edit code, deploy, migrate, or touch another session's files.
- ⛔ Never write a figure you did not derive this run; "not verified" beats a stale number.
- ⛔ Never declare "safe to close" with this session's work uncommitted or a check failing.
