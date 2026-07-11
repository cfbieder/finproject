# Dual-Track Development Workflow (ship-current + build-vNext in parallel)

> **Pack role:** how to keep the current version shipping while building a large,
> not-ready-for-prod version in parallel — without a merge tax. Proven on the Fin
> project's v3 → v4 multi-tenancy track (months of parallel work, zero forward-merges).
> Companion to [`infra-bootstrap.md`](infra-bootstrap.md) (stacks/ports) and the
> concurrency rules in [`claude-collaboration.md`](claude-collaboration.md).
>
> **Last reviewed:** 2026-07-11.

## When to use this
You need to keep shipping small changes to the **current** version while building a
**large, not-ready-for-prod** version over weeks/months — and you want the small
changes to flow into the big work automatically, with no ongoing merge tax.

## Core idea
**Diverge the *runtime*, not the *code*.** A long-lived feature branch is the wrong
default for big work: it rewrites the same files your current-version tweaks touch,
so it diverges and forward-merges become a permanent cost. Instead:

- All code lives on **one branch** (`main`), with the big work **switched off by
  feature flags** and built to be **backward-compatible** (flags off ⇒ identical to
  today). Current-version tweaks and vNext are then literally the same branch —
  nothing to "carry forward."
- To *test* vNext with flags on, run a **separate, fully-isolated copy** of the app
  (its own ports + its own database volume), not a separate branch.

## The model: one codebase, multiple running copies

```
        main branch (one source of truth)
                 │
   ┌─────────────┼─────────────┐
  PROD          STAGING/DEV    VNEXT
  flags OFF     flags OFF      flags ON
  real data     test data      its OWN isolated DB volume
```

## Setup checklist (one-time)
1. **Feature flags**, default OFF, committed OFF (e.g. `FEATURE_X=0`). The "ON"
   values live ONLY in the vNext runtime config — never in prod config.
2. **Backward-compatibility:** the foundational/most-invasive change must be a
   no-op when its flag is off (behaves exactly as today). This is what lets vNext
   code sit safely on `main` and even deploy to prod dormant.
3. **Isolated vNext runtime:** a second compose file / deploy config with:
   - distinct **ports** (so it runs alongside prod + dev), and
   - its **own data volume** (non-negotiable if vNext changes DB structure — it must
     never touch prod/dev data).
4. **Seed script:** copy a prod/staging snapshot into the isolated vNext DB for
   realistic testing (`dump | restore` into the vNext volume only).
5. **(Optional) wrapper script:** `vnext up|down|logs|db` for convenience.

## Day-to-day
- **Current-version tweaks:** work on `main` as usual.
- **vNext work:** also on `main`, behind the flags. Tweaks carry in automatically —
  same branch.
- **Run/test vNext:** bring up the isolated stack with flags ON; seed its DB; point a
  local frontend at the vNext API.
- **Golden rule:** only merge a vNext increment to `main` once it's **"dormant-safe"**
  (flags off ⇒ behaves exactly like current). Anything not yet dormant-safe stays on a
  short throwaway branch until it is.

## Working with an AI agent on a dual-track repo

- **Every request declares its track** (e.g. a "current tweak" / "vNext" prefix). If a
  request doesn't say which, the agent must **ask before editing** — especially DB-layer
  files, auth, migrations, or anything flag-related, where the two tracks diverge.
- **Commit scope reflects the track** (`feat(vnext-x): …` vs a normal scope), so history
  separates cleanly even though both live on one branch.
- **Verify against the right stack:** current changes against dev; vNext changes against
  the isolated flags-ON stack. "Dormant-safe" means flags OFF ⇒ byte-for-byte current
  behavior — state that invariant in the CR and test it before merging.

## When you DO need a branch / worktree (rarely)
Only for changes that **can't** be made dormant (e.g. an irreversible data migration
or removing an old UI). Cut those as **short-lived** branches right before go-live —
not a long-lived vNext line. A `git worktree` is handy here (separate on-disk checkout,
one history):

```
git worktree add -b <branch> ../proj-<branch> main
```

(Git won't let two worktrees share `main`, so a worktree always implies its own branch.)

## Go-live (much later)
Not a big-bang merge. Because the code already lives on `main`, releasing vNext =
**flip the flags ON in prod config + run any one-time migration/cutover.**

## Anti-patterns to avoid
- ❌ Long-lived `vnext` branch you periodically merge `main` into — divergence + merge tax.
- ❌ Flag-ON values in the prod/default config — risks shipping vNext hot by accident.
- ❌ vNext sharing the dev/prod database — a destructive migration corrupts real data.
- ❌ Merging a not-yet-dormant-safe commit to `main` — breaks current version on next deploy.

## Why it works
- "Carry tweaks forward" becomes a non-problem (same branch).
- No multi-month merge debt on the files both tracks touch.
- Prod is always shippable from `main` (vNext is dormant).
- vNext is fully exercisable in isolation before it ever affects production.
- Release is a config flip, not a high-risk merge event.

## Worked example (from the reference project)
| Element | This repo |
|---|---|
| Branch | `main` (trunk; prod deploy source) |
| vNext flags | e.g. `<<APP>>_FEATURE_X`, `AUTH_ENABLED` (default OFF, committed OFF) |
| Backward-compat invariant | flag absent ⇒ code path identical to current (state the invariant explicitly) |
| Prod runtime | prod compose file — its own ports + volume |
| Dev runtime | dev compose file — its own ports + volume |
| vNext runtime | `docker-compose.vnext.yml` — distinct ports + its OWN volume, flags ON |
| Wrapper | `scripts/vnext-up.sh` (`up`/`down`/`logs`/`psql`/`status`) |
| Seed script | `scripts/sync-db-prod-to-vnext.sh` (**run the PII scrub** — script-library §7) |
| Short-lived branches | only the irreversible steps (data cutover, legacy-UI removal) |
