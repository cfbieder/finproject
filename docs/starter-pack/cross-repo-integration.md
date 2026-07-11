# Cross-Repo Integration — the handoff-ledger protocol

> **Pack role:** how two independently-developed repos (an app and a sibling service it
> consumes) stay coordinated **without** a shared tracker, shared CI, or synchronous
> meetings — an append-only handoff ledger + a pinned contract version + a fetch-the-live-
> spec habit. Proven on the Fin ↔ ocr-llm (LLM gateway) and Fin ↔ bank-feed integrations.
> Complements the repository-boundaries rule in
> [`documentation-standard.md`](documentation-standard.md) (never modify a sibling repo
> from this one).
>
> **Last reviewed:** 2026-07-11.

## The problem

Two repos, each with its own agent sessions and release cadence, integrate over an API.
Requests, breaking-change notices, and "done, please verify" messages have no home: chat
history evaporates, and neither repo's docs are authoritative for the *seam* between them.

## The protocol (three pieces)

### 1. `HANDOFFS.md` — one append-only ledger, in the **provider's** repo

All cross-repo communication lands as dated, addressed entries in a single file:

```markdown
## YYYY-MM-DD [Consumer → Provider] subject
<what is needed / what changed / what to verify — a few lines, link to specs or commits>

## YYYY-MM-DD [Provider → Consumer] subject
## YYYY-MM-DD [Provider → *] subject          # broadcast to all consumers
```

- **Append-only, never edited** — it's a ledger, not a wiki. Replies are new entries.
- Sessions working in the consumer read the **tail** for entries addressed to them (or
  `→ *`) before any non-trivial API work; sessions in the provider do the same in reverse.
- Writing an entry in the *other* repo's `HANDOFFS.md` is the **one sanctioned exception**
  to "never modify a sibling repo" — it's the mailbox.

### 2. Pinned contract version

The consumer records which API contract version it is built against (in `CLAUDE.md` or
the integration guide): *"Pinned contract version: v1. Base URL: `<url>`."* The provider
versions its contract paths (`/contracts/v1/...`, `/v1/...`) and never breaks a published
version — breaking changes mean `v2` plus a `→ *` ledger entry.

### 3. Fetch the live spec before non-trivial work

A three-step preflight, spelled out in the consumer's integration guide:

1. `git pull --ff-only` the provider repo (read-only checkout is fine).
2. Read the `HANDOFFS.md` tail for entries addressed to you.
3. `curl` the provider's **live** contract/spec endpoint — the running service, not the
   checkout, is the truth for what's deployed.

## Adopting

- Provider repo: create `HANDOFFS.md` (empty ledger + the format above at the top);
  version the contract paths.
- Consumer repo: add a `docs/guides/<provider>-integration.md` with the pinned version,
  base URL, the three-step preflight, and where the seam's code lives; one pointer line
  in `CLAUDE.md`.
- Deploy-order notes for coupled changes ("service migration first, then app") belong in
  the CR that spans the seam, plus a ledger entry.
