# Documentation Standards

> A portable convention + memo for project documentation: structure, naming, AI-agent integration, and memory.
> Copy this file into any repo to bootstrap best-practice docs; adapt only the project-specific bits (the
> optional extension dir, the nested/sibling-repo example). EspañolApp is the reference implementation this
> was distilled from.
>
> **Pack role:** the canonical documentation convention for every new project. [`infra-bootstrap.md`](infra-bootstrap.md)
> §10 and [`claude-collaboration.md`](claude-collaboration.md) both defer to this file for docs layout and the
> required-reading block.
>
> **Last reviewed:** 2026-07-06.

## Why

Documentation rots when there's no rule for *where a thing goes* and *what it's called*. This standard fixes both so any human or agent can find the current state in seconds and add new docs without bikeshedding.

Three load-bearing ideas:

1. **One small entry point.** A single `status.md` is the mandatory read; everything else is read on demand. Keeps per-session context cost low.
2. **One source of truth per fact.** Ship dates/versions live only in the CR index. Other docs *link*, never restate — so changelogs can't drift.
3. **Consistent names.** Lowercase kebab-case everywhere, with a tiny set of ALL-CAPS ecosystem exceptions. No "junk drawer" directory.

## Directory layout

```
docs/
  documentation-standard.md   # this file (portable)
  current/                    # living state — what's true now
    status.md                 # session snapshot; THE mandatory first read
    project-description.md     # full current state (what's built)
    project-roadmap.md         # planned / in-progress work
    <domain>-guide.md          # optional living reference (e.g. rag-data-guide.md)
  cr/                         # change requests = per-feature design records
    README.md                 # the index — CANONICAL ship dates/versions
    cr-001-<topic>.md
    cr-001-<topic>-<subdoc>.md # sub-docs share the parent number
  guides/                     # operational runbooks + stable how-tos
    <topic>.md
  archive/                    # superseded / historical / completed threads
    <topic>_YYYY-MM-DD.md
  rag/                        # OPTIONAL project-specific extension dir
```

Root is `docs/` (lowercase, the near-universal convention). Add project-specific top-level dirs under `docs/` sparingly (e.g. `rag/`); the four core dirs above should exist in every project.

**What goes where:**

| Need to write… | Put it in |
|---|---|
| "What is true / built right now" | `current/` |
| A design for a non-trivial feature/change | `cr/cr-NNN-topic.md` + a row in `cr/README.md` |
| A repeatable operational procedure (deploy, setup, recovery) | `guides/` |
| Something superseded, finished, or point-in-time (dated reviews, old correspondence) | `archive/` |

There is **no `other/` / `misc/` directory.** If you can't classify it, it's almost always a guide (repeatable) or archive (point-in-time).

## File & directory naming

- **kebab-case, lowercase**, `.md` extension: `project-description.md`, `cr-016-admin-observability.md`, `hetzner-deploy.md`. Directories too: `current/`, `cr/`, `guides/`.
- **Words come from the title**, hyphen-separated. No `snake_case`, no `TitleCase`, no spaces.
- **No project name in filenames.** You're already in the repo. `migration-plan.md`, not `myapp-migration-plan.md`. (Pre-existing archived files may keep their historical names — don't rewrite identity to chase the rule.)
- **Dates: ISO `YYYY-MM-DD`, always last, joined with an underscore** to separate the date from the kebab name: `llm-server-reply_2026-04-21.md`, `security-review_2026-06-11.md`. A qualifier goes *before* the date: `llm-server-reply-confirm_2026-04-21.md`.
- **Numbered series** (change requests): `cr-NNN-topic.md`, zero-padded to 3 digits. Sub-documents reuse the parent number: `cr-012-phase-a-plan.md`.
- **ALL-CAPS exceptions** (ecosystem conventions — keep as-is): `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `NOTES.md`, `LICENSE`. Everything else is kebab-case.

## Links

Use **workspace-root-relative** paths in links: `[CR-016](docs/cr/cr-016-admin-observability.md)`. They render in editors/GitHub and survive moving the *referring* file. Never link with absolute filesystem paths. Never restate a fact you could link to.

## Repository boundaries — nested & sibling repos

**Never modify a nested or sibling repository while working in this one.** (For how two
sibling repos *coordinate* — the handoff ledger + pinned contract — see
[`cross-repo-integration.md`](cross-repo-integration.md).) Only edit a repo when you are actually operating *inside* that system. A directory with its own `.git`, its own `CLAUDE.md`/docs, or its own deploy lifecycle is a separate project: renames, link rewrites, and reorg passes (like migrating to this standard) must skip it entirely. Cross-repo *references* — links that point into the other repo's paths — stay spelled the way that repo names them; do **not** "fix" them to match this standard.

- **Example (replace per project):** in the reference implementation, `ocr-llm/` is a separate integrated repo (its own git + `Documentation/`). Do **not** touch anything under `ocr-llm/` unless the task is explicitly inside the ocr-llm system; links to `ocr-llm/Documentation/...` are correct as-is and must be left alone. When adapting this memo to another project, replace this bullet with that project's nested/sibling repos, or delete it if there are none.

## The `current/` tier

- **`status.md`** — the only doc loaded every session. ≤ ~60 lines: current phase, live infrastructure, recently-shipped headlines (linked, not restated), what's next, and a pointer to conventions. It links onward; it does not duplicate.
- **`project-description.md`** — the full "what's built" record. Read on demand. Keep prose scannable: bullet-per-fact, date as a leading tag, link to CR docs for detail.
- **`project-roadmap.md`** — planned/in-progress work. Read when planning.

## The `cr/` tier (design records)

Every non-trivial feature gets a numbered design doc and a row in `cr/README.md`. The index table (`CR | Title | Date | Status`) is the **single source of truth for what shipped when** — `status.md` and `project-description.md` link to it. Shipped CRs stay in `cr/` as historical records (not moved to archive); the README marks them ✓. Large projects may add a summary-by-status roll-up and (dual-track repos) a Track column — see the template's notes.

## Working with an AI coding agent (Claude Code)

When a project is developed with an AI agent (Claude Code, etc.), the documentation *is* the agent's working memory. These practices — the ones this standard was built from — keep it cheap and reliable to load:

**Keep the agent-instruction file (`CLAUDE.md` / `AGENTS.md`) lean.** It is injected into context on *every* turn, so it should hold only durable conventions + pointers — not project state. Aim well under ~150 lines. State lives in `docs/`, loaded on demand. A bloated instruction file taxes every single message; cramming the whole project into `CLAUDE.md` is the most common anti-pattern.

**One mandatory read, everything else on demand.** Force-loading large living docs at session start can burn tens of thousands of tokens before any work begins. Make `status.md` the *only* required read and demote the big docs to "read when the task needs the detail" — and spell out *when* to read each. (In this repo, this cut the mandatory session-start footprint from ~220 KB to ~4.5 KB.)

**Required-reading block — paste into `CLAUDE.md` / `AGENTS.md`:**
```markdown
## Required Reading at Session Start
Always read first: `docs/current/status.md` (session snapshot — links onward).
Read on demand: `docs/current/project-description.md` (full state),
`docs/current/project-roadmap.md` (planning), `docs/cr/README.md`
(canonical ship dates/versions). Ship dates/versions live ONLY in the CR
index — link, don't restate.
```

**Keep living-doc prose scannable.** The big docs are read by both humans and a model under token pressure. Prefer **bullet-per-fact with the date as a leading tag** over multi-line run-on paragraphs with nested parentheticals — easier to scan, cheaper to load, and "what is true now" extracts cleanly. De-densify when a section grows into a wall of prose.

**Avoid drifting changelogs.** "What shipped when" is easy to accidentally record in three places (a status doc, a per-feature doc, and an agent memory). Pick one home — the `cr/` index — and have the others link to it.

**Agent memory (`memory/`, usually outside the repo).** For agents with file-based memory:
- Keep memory for **durable, cross-cutting facts**: who the user is, how they want you to work, and gotchas/policies *not derivable from the repo*.
- **Don't** mint per-session changelog memories — git history + CR docs + `status.md` already record what changed. Once a fact lives in a CR doc, link to it; don't duplicate it into memory.
- One fact per file; a one-line pointer per file in `MEMORY.md`; categorize (user / feedback / policy / gotcha / reference).
- Memory paths point into the repo, so when docs are renamed (e.g. adopting this standard), update the memory references too.

## Adapting to a new project

1. Copy `docs/` skeleton (the four core dirs + this file).
2. Seed `current/status.md`, `current/project-description.md`, `current/project-roadmap.md`, `cr/README.md`.
3. Paste the required-reading block (above) into `CLAUDE.md`/`AGENTS.md`, and keep that file lean.
4. Replace the `ocr-llm` example under [Repository boundaries](#repository-boundaries--nested--sibling-repos) with this project's nested/sibling repos (or delete it if none).
5. Add project-specific dirs (`rag/`, `data/`, …) only if needed.
