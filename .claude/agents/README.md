# Review agents — Fin roster

On-demand **reviewers**. They are the third leaf of the Claude Code layer: `.claude/rules/`
enforce conventions every turn, `.claude/skills` + `.claude/commands` run procedures on
trigger (`/close`, `/question`), and these review work when you ask. All are **read-only**
(`Read, Grep, Glob, Bash`) and report rather than edit.

Source: starter pack v1.6.3 `.claude/agents/` — the generic bodies have been **replaced with
Fin's own facts** (schema-per-tenant rather than RLS, the real defect classes, the actual
gates). Keep them that way: when a standard changes, change the doc it points at.

| Agent | Lens | Reach for it when… |
|---|---|---|
| `security-reviewer` | secrets, PII escape, injection, v4 `search_path` boundary | a diff touches SQL, compose/env, a new endpoint, or v4/CR027 db-layer code |
| `migration-reviewer` | append-only, fresh-DB safety, dev→prod→deploy order | any file under `server/db/migrations/` is added or changed |
| `code-quality-reviewer` | correctness, simplicity, Fin's repeat defect classes | after a non-trivial change, before committing |
| `ui-design-reviewer` | frontend code quality **and** product design | any change under `frontend/src` |
| `cr-technical-reviewer` | **CR pass 1** — senior engineer, technical soundness | a CR is drafted or substantially revised |
| `cr-signoff-pm` | **CR pass 2** — senior PM, scope/value → go / revise / defer | after pass 1 clears the design |
| `docs-currency-reviewer` | docs-vs-code drift, one-source-of-truth | before `/close`, or after shipping a CR increment |
| `reference-lift-scout` | which side of the `bank-feed` / `ocr-llm` boundary work belongs on | starting feed-, ingest-, contract- or gateway-adjacent work |

**Invoking:** by intent — *"security-review this migration"*, *"run code-quality and migration
review on this branch"* (they fan out in parallel), or *"review CR-0NN"* → technical pass
first, then the PM sign-off, which assumes pass 1 is done and will not repeat it.

**What they give back:** a severity-ranked **Severity · `file:line` · Issue · Why · Fix** list,
with an explicit "nothing found" when the work is clean, and an offer to write
`docs/reviews/<topic>_YYYY-MM-DD.md` on a substantial pass. The CR pair returns grouped
comments plus a one-line verdict instead.

**Deliberately not agents:** anything a `git grep` can decide — retired-secret scans, tracked
`.env` files, the six design/lint ratchets — stays a mechanical CI guard. An agent is for
judgement.
