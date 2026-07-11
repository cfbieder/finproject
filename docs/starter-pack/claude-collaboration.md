# Claude Collaboration Rules — `CLAUDE.md` starter block

> **Pack role:** the durable, stack-agnostic agent-collaboration rules and their rationale.
> **The operational copy is [`.claude/rules/collaboration.md`](.claude/rules/collaboration.md)** —
> an unscoped rule that Claude Code auto-loads every session, so nothing needs pasting into
> `CLAUDE.md` anymore (the [`templates/CLAUDE.md`](templates/CLAUDE.md) starter holds only
> project facts). This doc remains the human-readable source: if the rules change, change
> them here first, then sync the rules file (README → "Maintenance loop").
>
> Keep `CLAUDE.md` lean: it's injected on *every* turn (see
> [`documentation-standard.md`](documentation-standard.md) → "Keep the agent-instruction file
> lean"). Project *state* lives in `docs/`, loaded on demand — never paste it into `CLAUDE.md`.
>
> **Last reviewed:** 2026-07-06.

---

## The rules (mirrored in `.claude/rules/collaboration.md`)

```markdown
## How to work with me

### Core rules
- **Challenge what I request — don't patronize me.** If a request is wrong, risky, or
  there's a better way, say so before doing it.
- **Think before coding:** state your assumptions, ask when genuinely unsure, never guess.
- **Simplicity first:** write the minimum code that solves the problem, nothing extra.
- **Surgical changes:** every changed line must trace back to what I asked for.
- **Goal-driven:** turn a vague instruction into verifiable success criteria *before* you
  start, and confirm them with me if they're not obvious.

### When you ask me questions
1. Go through questions **one at a time**.
2. Each time, present a **series of options, plus your recommendation and the rationale** —
   not an open-ended "what do you want?".

(The invocable form of this protocol is the `/question` skill —
`.claude/skills/question/` — which batches all open decisions into this sequence.)

### Required reading at session start
Always read first: `docs/current/status.md` (session snapshot — links onward).
Read on demand: `docs/current/project-description.md` (full state),
`docs/current/project-roadmap.md` (planning), `docs/cr/README.md` (canonical ship
dates/versions). Ship dates/versions live ONLY in the CR index — link, don't restate.
```

---

## Notes on the rules (context, not for pasting)

- **Why "challenge me" is rule #1.** The failure mode with an eager agent is confident
  execution of a flawed request. Making dissent the first rule gives explicit permission to
  push back, which is the single highest-leverage behavior.
- **"Surgical changes" pairs with the concurrency protocol** in [`infra-bootstrap.md`](infra-bootstrap.md)
  §9 (stage explicit paths, never `git add -A`; verify what landed with `git show --stat HEAD`).
  On a shared tree those two rules are what keep one session from sweeping another's work
  into a commit or release. The full multi-thread discipline — including the two traps
  that survive careful staging (a bare commit ships the *entire index*; a pathspec commit
  ships *worktree state*, resurrecting staged deletions) — is now an always-on rule:
  [`.claude/rules/git-concurrency.md`](.claude/rules/git-concurrency.md).
- **The required-reading block is the docs standard's**, reproduced here so everything is
  in one place. If you change the docs layout, change it in
  [`documentation-standard.md`](documentation-standard.md), then mirror it here and in
  `.claude/rules/collaboration.md`.
- **On surfaces without `.claude/rules/` support** (other agents, plain AGENTS.md setups),
  fall back to pasting the block above directly into the agent-instruction file — the
  content is identical; only the loading mechanism differs.
- **Keep project-specific instructions out of this block.** Anything that's true only for
  *this* app (its stack, its gotchas, its deploy command) belongs in `docs/`, not in the
  portable collaboration rules.
