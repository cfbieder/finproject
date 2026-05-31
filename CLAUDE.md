# CLAUDE.md — Fin Project Instructions

## Before Starting Any Task

1. Read `Documentation/FC_PROJECT_STRUCTURE.md` for the current state — architecture, tech stack, file structure, API endpoints, database schema, and development workflow. Single source of truth for what *is*.
2. Read `Documentation/FC_NEXT_STEPS.md` for the development plan — open / in-progress / known issues. Single source of truth for what *should happen next*.
3. If the task touches an active Change Request, read the matching CR file under `Documentation/CRs/` (see `Documentation/CRs/CR_INDEX.md` for the index).

## After Completing Any Task

Update the following files to reflect the changes made:

1. **`Documentation/FC_PROJECT_STRUCTURE.md`** — Update any affected sections (project structure, routes, API endpoints, database tables, scripts, etc.).
2. **`Documentation/FC_NEXT_STEPS.md`** — Mark completed CRs/items as done, add new known issues if discovered, or add new entries if the work reveals them.
3. **`Documentation/CRs/`** — If the work matches an existing CR, update its status header and body. If the work warrants a new CR (substantive feature, multi-session work, architectural impact), create the next-numbered CR file and add a row to `CR_INDEX.md`. Trivial fixes do not need a CR — leave them as bullets in `FC_NEXT_STEPS.md`.

## Git discipline

This repo has a single shared working tree, index, and branch, and more than one agent thread may be active at once. To avoid one thread absorbing or wiping another's uncommitted work:

1. **Always stage and commit with explicit pathspecs** — `git add <specific files>` / `git commit -- <specific files>`. **Never** `git add -A`, `git add .`, or `git commit -a` (they sweep up the other thread's changes).
2. **Do not run `git stash`, `git checkout <paths>`, `git reset`, or branch switches while other uncommitted work may exist** — these can move or destroy it. If unsure, run `git status` first.
3. **Before pushing:** `git pull --ff-only`, then push. **Never force-push** a shared branch.
4. **`bank-feed/` is a separate, gitignored repo** with its own git history — it is not tracked by this repo and needs no coordination with it.
5. **Commit `.env` never** — it carries local-only changes; leave it out of every commit.

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
