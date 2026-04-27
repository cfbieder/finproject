# CLAUDE.md — Fin Project Instructions

## Before Starting Any Task

Read `Documentation/PROJECT_DESCRIPTION.md` to understand the full project architecture, tech stack, file structure, API endpoints, database schema, and development workflow. This is the single source of truth for the project.

## After Completing Any Task

Update both of the following files to reflect the changes made:

1. **`Documentation/PROJECT_DESCRIPTION.md`** — Update any affected sections (project structure, routes, API endpoints, database tables, scripts, etc.)
2. **`Documentation/PROJECT_ROADMAP.md`** — Mark completed backlog items as done, add new known issues if discovered, or add new backlog items if the work reveals them

## When promption for questions

1.  Always ask the questions one by one, one after the other
2.  Always propose  series of options with your recomendations and rationale.


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
