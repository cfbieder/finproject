# CLAUDE.md — Fin Project Instructions

## Before Starting Any Task

1. Read `Documentation/FC_PROJECT_STRUCTURE.md` for the current state — architecture, tech stack, file structure, API endpoints, database schema, and development workflow. Single source of truth for what *is*.
2. Read `Documentation/FC_NEXT_STEPS.md` for the development plan — open / in-progress / known issues. Single source of truth for what *should happen next*.
3. If the task touches an active Change Request, read the matching CR file under `Documentation/CRs/` (see `Documentation/CRs/CR_INDEX.md` for the index).

## Version track — v3 (current) vs v4 / CR027 (dual-path)

This repo is **trunk-based**: the current version (v3) and the in-progress major version (v4 = **CR027**, multi-tenancy) both live on `main`. v4 is **flag-gated** (`FIN_MULTI_TENANT` / `AUTH_ENABLED`, default OFF) and ships **dormant**. Full pattern: `Documentation/DEV_WORKFLOW.md`; setup: CR027 §"Step 0".

- The user signals the track with a prefix like **"v3 tweak"** or **"v4 / CR027x"**. **If a request doesn't say which, ASK before editing** — especially DB-layer files (`server/src/v2/db/`), auth, migrations, or anything flag-related.
- **v3** changes must not depend on the v4 flags; verify against dev (`:3105`).
- **v4** changes must be **flag-gated and dormant-safe** (flags OFF ⇒ byte-for-byte v3 behavior, e.g. no tenant context ⇒ `search_path = public`); verify against the isolated v4 stack (`docker-compose.v4.yml`, `:3205`). Only merge to `main` once dormant-safe.
- Commit scope reflects the track (`feat(cr027a): …` for v4; a normal scope for v3). Prod deploys `main` with flags OFF — never put flag-ON values in the prod compose.

## After Completing Any Task

Update the following files to reflect the changes made:

1. **`Documentation/FC_PROJECT_STRUCTURE.md`** — Update any affected sections (project structure, routes, API endpoints, database tables, scripts, etc.).
2. **`Documentation/FC_NEXT_STEPS.md`** — Mark completed CRs/items as done, add new known issues if discovered, or add new entries if the work reveals them.
3. **`Documentation/CRs/`** — If the work matches an existing CR, update its status header and body. If the work warrants a new CR (substantive feature, multi-session work, architectural impact), create the next-numbered CR file and add a row to `CR_INDEX.md`. Trivial fixes do not need a CR — leave them as bullets in `FC_NEXT_STEPS.md`.

## Git discipline

This repo has a single shared working tree, index, and branch, and more than one agent thread may be active at once. To avoid one thread absorbing or wiping another's uncommitted work:

1. **Always stage AND commit with explicit pathspecs.** Scope the *commit* to your files, not just the `git add` — a bare `git commit` after `git add <files>` still commits the **entire index**, including another thread's pre-staged changes (e.g. a file they deleted). Correct forms: `git commit -m "msg" -- <files>` (note: `-m` and its message must come **before** the `-- <paths>`, or git parses the message as a pathspec) — or `git add <files>` then **verify** with `git diff --cached --name-status` before a bare commit. **Never** `git add -A`, `git add .`, or `git commit -a` (they sweep up the other thread's changes). After committing, run `git show HEAD --name-status` to confirm only your files landed; if a stray file rode along and the commit isn't pushed, `git reset --soft HEAD~1` then `git restore --staged <stray>` and re-commit.
2. **Do not run `git stash`, `git checkout <paths>`, `git reset`, or branch switches while other uncommitted work may exist** — these can move or destroy it. If unsure, run `git status` first.
3. **Before pushing:** `git pull --ff-only`, then push. **Never force-push** a shared branch.
4. **`bank-feed/` is a separate, gitignored repo** with its own git history — it is not tracked by this repo and needs no coordination with it.
5. **Commit `.env` never** — it carries local-only changes; leave it out of every commit.
6. **`main` is the single trunk and the prod deploy source** (`Scripts/deploy-to-production.sh` pushes/deploys `main`). Apply DB migrations to **prod before** deploying code that references the new objects, or the deploy breaks the running app.
7. **Expect the branch to move under you.** Another thread may add commits or cut a release between your reads; before committing or pushing, re-check `git log`/`git status`. **Do not push without explicit user confirmation** — local commits are fine.

## When promption for questions

1.  Always ask the questions one by one, one after the other
2.  Always propose  series of options with your recomendations and rationale.

## Critical thinking — no flattery

Be a skeptical collaborator, not a yes-man. When the user proposes an idea, design, or fix:

1. **Stress-test it before agreeing.** Look for flaws, edge cases, hidden costs, simpler alternatives, and unstated assumptions. Say what could go wrong.
2. **Disagree when warranted.** If the user's plan is suboptimal, say so directly and explain why. Offer a concrete better option.
3. **No empty validation.** Do not open replies with "Great idea", "You're right", "Excellent point", or similar. Skip the compliment and go straight to the substance.
4. **Agreement must be earned.** If you do agree, state the specific reason ("this works because X handles the Y case") — not a vague endorsement.
5. **Push back on vague requests.** If the user's request is ambiguous or based on a faulty premise, surface that rather than guessing and proceeding.


## Integration with ocr-llm

- **First-read primer:** `~/Programs/fin/ocr-llm/Documentation/Guides/AI_IMPLEMENTATION_GUIDE.md`
- **Pinned contract version:** v1
- **Base URL:** `http://100.66.213.40:8080` (Tailscale)

Before non-trivial API work:
1. `(cd ~/Programs/fin/ocr-llm && git pull --ff-only)`
2. Read the tail of `~/Programs/fin/ocr-llm/HANDOFFS.md` for `[ocr-llm → Finance]` or `[ocr-llm → *]`.
3. Fetch the live spec: `curl -s http://100.66.213.40:8080/contracts/v1/gateway`.

When Finance needs the server to change something, append an entry to
`~/Programs/fin/ocr-llm/HANDOFFS.md` with `## YYYY-MM-DD [Finance → ocr-llm] subject`.
