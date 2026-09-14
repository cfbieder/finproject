# Starter Pack — Changelog

## v1.8.2 — 2026-09-14

**Upstreamed from Fin — its third sync (after v1.5.0 and v1.6.4).** No new files. Every addition
is something that went wrong more than once in that project *and* had passed the gate meant to
catch it; two came from adopting v1.8.1's own `/brief` there.

### Changed
- **`.claude/rules/git-concurrency.md` — rule 0: a session that will commit gets its own
  worktree.** On one shared tree there is no safe commit primitive: `git commit -- <paths>` reads
  the worktree, a bare commit reads the index, and both are shared. Three incidents in which the
  victim had followed rules 1–2 correctly; the third pushed an unrelated **source file** under
  another thread's message. With the one escape (demonstrably sole writer, re-checked right
  before committing) and the caveat that a worktree isolates git, **not** the test rig.
- **`.claude/rules/env-secrets.md` — there is no safe redaction of a multi-secret file.** Two
  exposures in three days by two different mechanisms: a `sed` whose `&` re-inserts the match
  it claims to mask, and a mask narrower than the region printed. The first incident's note held
  the rule that would have stopped the second; it had been remembered as an idiom to avoid
  rather than as *do not print `.env` lines*. Verify by count or name; `docker compose config`
  counts as printing.
- **`testing-and-ci.md` — "Checks that cannot fail"** (new subsection): a fixture that cannot
  exhibit the bug (run the new test against the unfixed code first); warnings tested for
  *firing* rather than *truth* (5 of 8 wrong in one audit); a restatement asserted as behaviour
  (found ten times, the last reaching the ledger); a before/after gate that compares a number to
  itself; proof of absence from a search that did not cover the file.
- **`testing-and-ci.md` — a `SessionStart` hook is the cheapest way for a red gate to reach a
  human**, with the three rules that keep one from being deleted: ask about the newest run on
  `main`, not HEAD; never block or fail a session; full detail only on red. ⚠️ *A cron job
  writing to a log is not an alert* — an off-host backup failed every run for 74 days into one.
- **`data-ingestion-baseline.md` §7 (new) — an upstream id is a promise, not a key**, plus a rule
  bullet in `.claude/rules/data-import.md`: an id-format change re-books the whole range, and
  only value matching catches every class (a suffix query found 0 of 28 real duplicates); one
  entity under two labels mints a twin; id width is a cross-repo contract (110-char ids against
  a `VARCHAR(100)` consumer); a protection window must cover the fetch window — verified on the
  one day the two coincided, it re-inserted 23 rows the next; and a human in the loop is not a
  check unless the promote step runs one.
- **`documentation-standard.md` — how to hold `status.md`'s budget** (move what changes on a
  different clock, never delete what is true; one snapshot reached 405 lines against 60), and an
  optional **`failure-patterns.md`** living catalog: the *shapes* bugs take, admitted only when
  found twice and having passed a gate.
- **`ui-design-reviewer` — rendered, in both themes, or say it was not.** The defect class no
  suite sees: state that exists, renders and has no visible effect. Eleven instances in one
  project, ten found by a person opening the page. Cascade losses are settled by a DOM probe,
  not by reading CSS.
- **`.claude/rules/collaboration.md` + `claude-collaboration.md` — check an objection before it
  steers.** A reason given against an option must be verified; the reader cannot tell a guess
  from a check.
- **`brief` skill — two additions from its first adoption.** *A hand-kept roll-up is a copied
  number too*: count the rows, not the index's summary table, and report a disagreement as an
  action. And *decide what may appear on the page* before the first build: in a personal-finance
  project the most natural tiles (balances, an uninsured deposit) are exactly the numbers that
  must not leave the host.

## v1.8.1 — 2026-09-10

One new skill and the one-line change that keeps it honest. The pack could seed a project,
drive its decisions and close its sessions, but had no way to *show* where a project stood —
so status lived in terminal scrollback, which nobody can open on a phone and nobody outside
the session can read at all.

### Added
- **`brief` skill (`/brief`)** — the **operator** brief: a single-page status artifact with
  live tiles, owned next actions, progress against the tracker, and what shipped recently.
  ⚠️ **Distinct from [`templates/project-brief.md`](templates/project-brief.md)**, which is the
  *founding* brief — written once at kickoff, then frozen and fed to `/kickoff`. One is an input
  to building; the other is a view of it. The names are close and the collision is called out in
  both files rather than left to be discovered.

  Two rules carry the skill, and both come from real defects:

  - ⛔ **Every number is re-derived at build time; none is ever carried forward.** A figure
    copied from the previous edition stops being derived from anything and goes wrong silently.
    This was found the hard way in the source project on 2026-09-10: a tracker's own summary
    table read `59 done · 7 partial · 25 to go` against its own checkboxes giving `60 · 9 · 27`,
    while its note claimed the numbers had been *"re-derived, not typed"*. They had been — four
    days earlier. The skill therefore requires a command per figure and says to **omit a tile**
    rather than estimate one.
  - ⛔ **It is a roadmap, not a diary.** No "what happened today". A status page exists to say
    *done · open · next* and **who owns each** — an action with no owner is scheduled by nobody,
    so every action card carries an owner chip (`you` / `me` / `needs hands` / `blocked`).

  It also ships a validation phase that runs **before** publishing (re-derive the headline
  figures a second time, cross-check the tracker with the project's own tool, balance the tags,
  confirm no action card is already done, check links resolve), and a self-contained,
  theme-aware HTML skeleton. ⚠️ The skeleton's dark-mode block is `@media` **outside**, selector
  inside — the reverse is CSS nesting and fails silently on the viewer's default "system" theme,
  which is where most readers are.

### Changed
- **`close` skill — new Phase 5b: refresh the operator brief.** A brief nobody refreshes is
  *worse* than no brief, because it still reads as current; the close is exactly where its
  inputs just changed. ⚠️ It says re-derive, not hand-patch the figures that moved — otherwise
  `/close` becomes the mechanism by which the numbers start being copied forward, which is the
  defect `/brief` exists to prevent. Skips silently when the project has no brief, and never
  creates one as a side effect of closing.

## v1.8.0 — 2026-09-02

A completeness audit of the pack itself: every element the pack *prescribes* is now a file
the pack *ships*, and every file it ships is now something the seeding path actually copies.
No practice changed — the gaps were between the prose and the operational layer.

### Added
- **`.claude/settings.json` + `.claude/hooks/rm-guard.sh`** — the permission baseline from
  [`claude-code-permissions.md`](claude-code-permissions.md) as **files**, not only prose:
  bare-tool allowlist, a narrow `ask` net (`rm`, `sudo rm`), and the PreToolUse hook wired to
  the guard that catches `rm` anywhere in a command line (prefix rules miss `cd x && rm y`).
  The hook carries its three pipe-tests (ask / allow / false-positive) in its header — that
  doc's own gotcha is that a broken hook fails *invisibly*, so `/kickoff` now tests it at
  seed time. `additionalDirectories` stays out: it is per-machine user settings.
- **`incident` skill (`/incident`)** — the 2 a.m. path as a triggerable procedure: triage
  order outside-in, the explicit restore-vs-understand decision, and the close-the-loop
  steps. [`incident-runbook.md`](incident-runbook.md) stays canonical for the failure-class
  table. A runbook you have to remember to open is not a runbook at 2 a.m.
- **`release-oss` skill (`/release-oss`)** — the publication path, gated on the irreversible
  history scan running **first**. This is a one-way door, which is exactly the kind of
  procedure that should trigger on intent ("make the repo public") rather than wait to be
  looked up.
- **`templates/project-readme.md`** — seeded projects had no `README.md` at all, while
  [`open-source-release.md`](open-source-release.md) Phase 2 names it one of the four files a
  public repo owes its readers.
- **`templates/oss/`** — `LICENSE-MIT.txt`, `CONTRIBUTING.md` (with the PR no-secrets
  checklist), `SECURITY.md`, and a README explaining that these are seeded at **publication**,
  not at kickoff — an unfilled `SECURITY.md` is worse than none.
- **`templates/scripts/ci-guards.sh` + `templates/.github/workflows/ci.yml`** — runnable
  copies of what were previously only fenced blocks inside
  [`testing-and-ci.md`](testing-and-ci.md), which `templates/CLAUDE.md` already advertised as
  a project command. The doc stays canonical for the reasoning; both sides say "change them
  together". Two fixes came out of extracting them: `fetch-depth: 0` (guard #3 diffs
  `origin/main` and a shallow clone cannot), and a commented **guard #8** for tracked
  `.claude/` config, to be enabled at publication.

- **A host-toolchain prerequisite in `infra-bootstrap.md` §0** — `git`, `docker` + compose,
  **`gh` (authenticated)**, `jq`, `tailscale`, with install lines and, for each, the failure
  mode when it is absent. `gh` was an undeclared dependency: deploy gate #2 checks CI status
  with `gh run list`, and without `gh` that gate is **skipped rather than failed** — it
  degrades to "tests ran on my machine" while still printing a success banner. `jq` became
  load-bearing the moment the `rm` guard hook shipped. `/kickoff` Phase 0.3 now checks all
  five plus `gh auth status` before seeding.

### Changed
- **`/kickoff` Phase 1 now seeds `.gitignore`** (and the README, `settings.json` and the
  hook). The pack shipped a seed `.gitignore` whose whole point is being right from the first
  commit, and no seeding path — neither the skill nor README step 1 — ever copied it. It now
  lands explicitly *before* the Phase 1.4 commit.
- **`templates/.gitignore`** ignores `.claude/settings.local.json` and `CLAUDE.local.md`
  (per-machine), with a comment stating that `.claude/` itself stays tracked — it is team
  state until publication, when `release-oss` untracks it.
- **The review agents no longer point at `docs/current/architecture.md`.** Five agents plus
  their README deferred to a file the documentation standard never defined, the templates
  never seeded, and `/kickoff` never created — it dangled in every project. They now read
  `docs/current/project-description.md`, which gains an explicit **isolation model** line in
  the template. One source of truth, and one that exists.
- **`/kickoff` also creates `docs/reviews/`** — the review agents write there, and the
  documentation standard lists it among the core dirs.
- **Phase 0.2 placeholder confirmation** names `<<BROKER>>`; `<<PACK_VERSION>>` is called out
  as filled from the pack README, not asked of the user.

### Fixed
- `public-edge-baseline.md` had no `Last reviewed` date — the one root doc missing the field
  the pack's own maintenance loop depends on.
- `deploy-to-shared-edge.md` used a one-off `<<HOST_IP>>` where the pack's token is
  `<<TS_IP>>`; a seed-time find-replace would have left it unsubstituted.
- README's placeholder list omitted `<<BACKEND>>`, `<<FRONTEND>>` and `<<PACK_VERSION>>`,
  all of which are used in the templates and substituted by `/kickoff`.

## v1.7.0 — 2026-08-30

Upstreamed from **Noted** (Vue 3 + Fastify + Postgres, single-host, taken open-source
2026-08-30) — the pack's first sync from that project.

### Added
- **`open-source-release.md`** — new playbook: taking a private repo's **source** public, as
  distinct from exposing the running service (`deploy-to-public.md`). Covers the irreversible
  **git-history scan** that projects skip (genericizing the working tree changes HEAD and
  nothing about `git log -p`), a severity table for what history turns up (rotate vs rewrite
  vs accept), genericizing hosts/IPs/companion clients, untracking personal agent config, the
  four files a public repo owes its readers, and CI as the contributor contract. Indexed in
  README's layout, the when-to-reach-for-what table, and the relationship diagram.

### Changed
- **`infra-bootstrap.md` §7** — three new single-host traps:
  - **#22 Alpine healthchecks must use `127.0.0.1`, not `localhost`** — Alpine resolves to
    `::1` first, the check fails against an IPv4 listener, and behind
    `depends_on: service_healthy` that silently blocks the whole stack from starting.
  - **#23 A `.env` in the frontend build context beats the Dockerfile's `ENV`/`ARG`** — Vite
    loads it at build time and it wins, so a developer's local `.env` copied in by `COPY . .`
    bakes dev settings into the production image. `RUN rm -f .env .env.*` before the build,
    plus `.dockerignore`.
  - **#24 A "mode" flag read for truthiness must be UNSET in prod** — the mirror image of
    trap #7: any non-empty string is truthy, so `VITE_ENV_LABEL=false` still trips the dev
    banner. Decide per variable whether presence or value is the signal, and say so in
    `.env.example`.
- **`testing-and-ci.md`** — two corrections to `ci-guards.sh` and the CI skeleton:
  - The weak-secret-default guard now matches `:-[^}]`, not a bare `:-`. An **empty** default
    (`${VAR:-}`) is the legitimate idiom for "integration off until a key is configured";
    flagging it trains people to skip the guard. Also documents the blind spot beside it: a
    bare `${JWT_SECRET}` is not fail-loud either — compose substitutes empty and the app boots
    with an empty secret.
  - **When the suite is end-to-end, mirror the dev setup script rather than inventing a CI
    path** — plenty of real projects have no unit tests, only scripts that hit a running API.
    Point a `services:` postgres at the credentials the dev config hardcodes and run the
    project's own migrate/seed/start commands. Plus: exclude suites needing an unreachable
    sibling service **by name in a `test:ci` manifest script**, not in a comment.
- **`.claude/skills/close/SKILL.md`** — the version-bump step no longer prescribes
  "bump before committing" unconditionally. **Who owns the commit and tag decides the
  order:** a script that only writes files → bump first; a script that also commits and tags
  itself (the shape in `script-library.md` §4) → commit the session's work first and let the
  script create its own commit + tag last. The old advice produced a doubled commit or a tag
  on the wrong HEAD against the more common script shape.
- **`.claude/agents/ui-design-reviewer.md`** — added the **never native
  `confirm()`/`alert()`/`prompt()`** rule: unstyleable, unlocalisable, main-thread-blocking,
  and *suppressed outright* in some embedded and installed-PWA contexts — where a suppressed
  `confirm()` returns `false` and the guarded action silently does nothing. Worth a CI guard
  as well as a review, added as a **ratchet** where violations already exist. (Found live in a
  project whose `CLAUDE.md` forbade it in bold: three had accumulated, two guarding
  unsaved-work loss — the evidence for the pack's own "guidance is not enforcement" line.)
- **`documentation-standard.md`** — resolved a contradiction the pack shipped with. A CR body
  **may** carry its own `**Status:**` line (a design doc opened on its own that doesn't say
  whether it shipped is a trap); what stays index-only is the **ship date and version**, which
  is what actually drifts. Projects following the pack correctly were reading as violations.
- **`cross-repo-integration.md`** — cites **Noted ↔ ocr-llm** as a second, independent
  production instance of the handoff-ledger protocol: the provider gained a consumer without
  gaining a coordination channel, and the `[provider → *]` broadcast form is what made it
  cheap.

## v1.6.5 — 2026-08-24

**Upstreamed from the options project — what a second upload path exposed about the first
one.** A feature that only added a page (drop both vendor exports at once, route each by its
header) surfaced three defects that had been live for months in code the pack already had
rules for. All three were invisible in the diff and invisible to tests; all three were caught
by review asking what a number *claims*. Plus the concurrency case the pack described but
under-specified: two agent sessions in one working tree, at the same time.

**`data-ingestion-baseline.md` — two new sections and a corollary.**
- **§4 corollary — a tie-out never ships without its exception count.** The pack already said
  to assert a reconciliation invariant and surface it. It did not say that the control total
  and the unresolved-record count measure different things: a reconstruction can balance
  *while* records sit unattributed. Shown alone, "✓ balances" is read as "the import was
  clean" — a stronger claim than the invariant makes. *Incident:* a receipt rendered
  `✓ Tie-out balances` for an import with a non-empty `needs_review`; both values were in the
  same response object and the page displayed one of them.
- **§5 (new) — import time is not the data's date.** An ingest stamps when it *ran*; a human
  in the loop makes that drift from when the data was true. Parse the vintage out of the
  source into a **separate** field; where the format carries none, name the field
  `imported_at` rather than `as_of` and have the UI say "imported". Every staleness check that
  reads the ingest stamp is measuring when someone clicked upload. *Incident:* a positions
  snapshot rendered *"as of 4:02pm"* for a file downloaded the day before — wrong since the
  first import, noticed only when a second upload path made the stale file more likely.
- **§6 (new) — undecodable and misrouted input is ordinary input.** An `accept=".csv"` filters
  the picker dialog only; drag-and-drop and the API both bypass it, so a decode ahead of
  validation turns a PDF or a spreadsheet's cp1252 export into a 500. Where two importable
  formats exist, sniff and route **server-side, once** — the wrong-file error is a class you
  can delete outright, and a client that re-implements the sniff duplicates rules that drift
  the next time the vendor renames a column. Reject per-file, not per-batch.
- **`.claude/rules/data-import.md`** carries all three as always-on bullets.

**`.claude/rules/git-concurrency.md` — two rules for same-tree concurrency.**
- **Sequential identifiers are allocated concurrently.** Any "next number = highest + 1"
  scheme (CR/ADR/RFC docs, migration revisions) hands two sessions the same number when both
  look before either writes. Claim the number by writing the file and its index row *first*,
  before the work it names. Two sessions dodged a collision here by timing alone.
- **A `git status` from session start is a snapshot, not the current state**, and a file you
  did not write this turn may already be someone else's edit — re-read before editing.

**`.claude/skills/close/SKILL.md` — two authoring traps.**
- **Never pin a model name in a committed instruction file.** A project's copy of this skill
  hard-coded a `Co-Authored-By:` model that had since changed; its git history now carries two
  different names for the same author. Take the trailer as the environment supplies it.
- **Don't add a branch-first step without checking the deploy phase.** A deploy script that
  refuses to run from anything but `main` makes "branch, then deploy" impossible; a close
  instructing both stalls on a contradiction the operator resolves by hand.

**Reviewer agents.**
- **`code-quality-reviewer`** — flag widening a shared component for a new caller by making a
  required parameter optional. It compiles, every existing caller still passes, and the type
  system stops enforcing what made the component work: a version with *neither* option now
  typechecks and does nothing. Use a discriminated union, not two optionals and a docstring.
- **`ui-design-reviewer`** — uploads and async results: client-side file filters are not
  guards, batch operations report per item with a per-item retry, and asynchronous results
  belong in a live region.

## v1.6.4 — 2026-08-02

**Upstreamed from the Fin project — the second tenancy model, and five lessons from a
two-day CI blackout.** v1.6.2 added the multi-tenancy baseline assuming one model (pool +
RLS); a project that retrofitted tenancy onto a mature single-tenant codebase chose the other
one, on written grounds, and the pack had no vocabulary for it. Separately, a run where CI
stayed red for 30 pushes — three releases and a prod deploy shipped over a failing gate —
produced four rules the pack was missing, each mechanical enough to state plainly.

**Multi-tenancy — the model is now a choice, not an assumption.**
- **`multi-tenancy-baseline.md` §0 — pool vs schema-per-tenant**, with the comparison that
  actually decides it: retrofit cost, where a mistake leaks, unique constraints, cross-tenant
  analytics, migration fan-out, per-tenant restore/export, and the scale ceiling. Pool for a
  many-small-tenants SaaS built multi-tenant from day one; schema-per-tenant when adding
  tenancy to a mature single-tenant app, when tenant count is bounded, or when "a forgotten
  `WHERE` must not be able to leak" outweighs easy cross-tenant queries.
- **§10 — the schema-per-tenant invariants**, because the risk moves rather than disappears:
  `SET search_path` on **every checkout before the first query**, centrally (this one rule is
  the guarantee — a pooled connection can never carry a stale path); every path that hands out
  a raw client (`transaction()`/`getClient()`/`pool.connect()`) must be request-aware or it
  silently runs on `public`; scripts and cron **refuse to run unscoped**; migrations fan out
  over all schemas, resumably; test the *negative*; and flags-off must be byte-for-byte
  single-tenant — a security property, not a refactor detail.
- **`.claude/rules/tenant-scoping.md`** now branches on the model, so the always-on rule stops
  demanding a scope column and an RLS policy from projects that deliberately have neither.

**`.claude/rules/migrations.md` — four rules from real damage.**
- **A migration may not assert a production data fact.** One that `RAISE`s on a row count
  aborts the chain on an empty database, so it kills CI *before the tests run* and buries
  whatever else was failing. Data checks need an explicit zero-rows skip branch.
- **Order-independence** — no dependence on a higher-numbered file, or on which of two
  concurrently-minted numbers landed first.
- **The deploy runner applies every *pending* file** — a migration merged for a feature that
  hasn't cut over will be applied by the next unrelated deploy. Either it's safe to apply
  early or it doesn't get merged yet; the CR says which.
- **The unavoidable edit has a defined resolution** — prove the applied state matches, then
  accept the drift **per file** (`--accept-drift=<file>`), never blanket. A warning nobody can
  clear is a warning everybody learns to scroll past.

**`testing-and-ci.md` — four additions.**
- **A DB-backed test may not read ambient data.** `SELECT … LIMIT 1` for a fixture passes
  locally forever and dies in `beforeAll` on a fresh CI database. Tests create and clean up
  their own rows; the only assumable rows are `ci-seed.sql`'s.
- **Write down what a guard *cannot* see.** A lint rule banning `.toISOString()` covers the
  *format* side of a date bug; `new Date("2025-12-01")` is UTC midnight, matches no rule, and
  shipped the same defect twice more on the *parse* side. Plus the corollary that found it:
  where two implementations compute the same number, assert they agree — disagreement is often
  the only observable symptom.
- **Ratchets** (new section) — the guard you can ship against debt you already have: baseline
  the count, fail on a rise, lower it on a drop. With the two ways it goes wrong: a ratchet
  that omits one rule of its class manufactures confidence, and one that aborts under
  `set -e -o pipefail` reads as a debt failure with no output.
- **A red gate must reach a human.** The deploy gate stops a deploy on red; nothing tells
  anyone the branch *went* red. A gate nobody is told about is a log file — wire branch
  protection or a notification, and test the pipe with a deliberate failure.

**`cross-repo-integration.md` §4 — a fix on one side does not flow to the other.** Seam
defects usually need fixing twice, differently, and the side you're sitting in looks complete
from there. Name the owning side, record consumer-side workarounds in the ledger (or the
provider's eventual root-cause fix double-corrects), and state which side shipped. Plus the
trap that motivated it: a provider joining on a **display name** reroutes an entire
integration the day two records share one — and an id guard reading the wrong key
(`accountId` vs `account_id`) is not a guard.

## v1.6.3 — 2026-07-16

**Full-pack review: two new baselines, the reactive half of the loop, backup-encryption
posture, and a drift-fix pass.** A cover-to-cover review found the pack strong on
prevention but missing the *reactive* path, missing an auth floor, inconsistent on backup
handling vs. its own GDPR posture, and carrying several stale cross-references from the
v1.5–1.6 growth spurt.

**New docs.**
- **`incident-runbook.md` (new root doc)** — the 2 a.m. path the pack never had: an
  outside-in triage table (probe → edge → tunnel → proxy → containers → app → DB → host,
  each row pointing at the catalog entry that owns its failure class), the explicit
  **rollback-vs-investigate decision** (deploy in window ⇒ roll back first; flags flip
  back; DB restore is for corruption, not bugs — it discards a stated data window), the
  anti-lockout reminder, and the close-the-loop steps (gotcha → catalog, machine-checkable
  → `ci-guards.sh`, missed alert = monitoring bug, upstream to the pack).
- **`auth-baseline.md` (new root doc)** — the standing choices the deploy-to-public flows
  assume, consolidated: argon2id/bcrypt≥12 (+ the 72-byte truncation trap), access+rotating-
  refresh shape with **family revocation on refresh reuse**, revocation on password change
  *and* deactivation, per-IP **and per-account** limits with escalating delays over hard
  lockout (a hard lockout is a DoS button), uniform no-enumeration errors, hashed
  single-use codes, and a proportionate 2FA posture (admin/platform surfaces first; Access
  = 2FA you don't build). Flows stay in deploy-to-public 2B; this doc owns the invariants.

**Baselines extended.**
- **`multi-tenancy-baseline.md` §9 — offboarding is the mirror of provisioning:** scripted
  per-tenant export enumerated from `information_schema` (never a hand list, same
  exhaustiveness-guard pattern as merge/anonymize); staged suspend → export → erase;
  erasure platform-admin-only + audit-logged; **honest backup semantics** ("gone from live
  now, gone from backups after N days"); `tenant_id` in every structured log line (breach
  scoping).
- **`observability-baseline.md`** — tier 0 gains **frontend error capture** (client crashes
  are invisible to every server layer; floor = `window.onerror` → rate-limited backend log
  endpoint); tier 3 gains the **named-delivery-channel rule** (an alert with no tested
  route to a human is decoration); new **"No fleet? The standalone floor"** section so a
  project seeded outside the homelab still has the layer (self-contained Prometheus stack
  + external box-down check, or Uptime Kuma + healthchecks.io dead-man's-switch pings —
  the "alert on missing" rule with no fleet).
- **`security-baseline.md` + `script-library.md` §6 — backups are secrets too:** `Backups/`
  gitignored and never tracked (new `ci-guards.sh` #7), off-host PII dumps **encrypted at
  rest** (`age`/`gpg`) with the key escrowed day one (the PBS-paperkey rule generalized);
  the quarterly restore drill decrypts as its first step.

**New seeds & scripts.**
- **`templates/.gitignore`** — the seed the discipline was assuming: env family (+
  `!.env.example`), `.env.cloudflared`, `.env.vnext`, `Backups/` + `*.dump`, the generated
  `frontend/version.json` copy (root stays tracked), build/runtime dirs.
- **`script-library.md` §12 — `smoke-test.sh` skeleton.** Tier-1 was mandated by
  testing-and-ci, `/close`, and the deploy gates but had no source: health-that-touches-DB,
  version-vs-`version.json` assert, auth-enforced check, one login + data round-trip with a
  namespaced least-privilege smoke user; Access-gated apps use the service-token headers.

**Drift fixed (found by diffing the pack against itself).**
- `deploy-to-public` skill: "24-item gotchas catalog" (it has 29) → uncounted reference.
- `templates/CLAUDE.md`: hardcoded "(v1.1.0)" → `<<PACK_VERSION>>` token; `/kickoff` now
  stamps it (and always copies `security-baseline.md` so the seeded secrets-inventory link
  can't dangle).
- `ci-guards.sh`: weak-default-secret guard now covers **all non-dev compose files** (the
  tunnel overlay and VM files it previously missed); append-only guard's pathspec widened
  from `backend/migrations/*` to `*migrations/*` + `*alembic/*` (matching the layouts
  `.claude/rules/migrations.md` already globs).
- Node major unified on 20 (`engines >=18` example bumped; §1 notes the major is a
  seed-time substitution target).
- CR template impact checklist gains the public-edge definition-of-done row (exposure
  inventory + explicit gate decision + probe through the gate).
- README scope now states the pack **embeds live homelab identifiers and is itself
  private** — never publish it or copy the live-value appendices into client-visible repos.

## v1.6.2 — 2026-07-16

**Review-agents layer (new) + the multi-tenancy baseline it assumes — upstreamed from the
KlinikaOS build.** The pack had rules (always-on) and skills (procedures) but no **reviewers**:
read-only agents you invoke on demand to review a diff, a CR, or the docs against the pack's
own standards. And it had no guidance at all for the **multi-tenant pool model**, despite that
being the defining risk of any many-tenants-one-DB product — so the new agents' *"if the
project uses RLS…"* branches had nothing canonical to point at. This release adds both, plus a
home for their dated output.

- **`.claude/agents/` (new layer) — 8 generic, read-only reviewers + a user guide
  (`README.md`).** Each reads `docs/current/status.md` first and defers to the *project's* own
  `CLAUDE.md`/architecture for specifics, so one generic file adapts per project instead of
  hardcoding one project's rules. Output is a severity-ranked `Severity · file:line · Issue ·
  Why · Fix` list with an offer to write a dated review doc.
  - `security-reviewer` (data isolation, auth, injection, secrets — applies `security-baseline.md`),
    `migration-reviewer` (isolation-in-same-migration, append-only, fresh-DB safety —
    `.claude/rules/migrations.md`), `code-quality-reviewer` (the collaboration rules +
    `testing-and-ci.md` tiers), `ui-design-reviewer` (**two passes**: design-system + WCAG-AA
    accessibility, *and* product/conversion UX), `docs-currency-reviewer` (docs-vs-code drift +
    one-source-of-truth), `reference-lift-scout` (mine a declared reference/parts-bin repo for
    logic to lift; no-op if none).
  - **CR review is a two-pass pair:** `cr-technical-reviewer` (pass 1 — senior engineer,
    technical soundness) → `cr-signoff-pm` (pass 2 — senior PM, scope/priority/value →
    GO/REVISE/DEFER, without re-doing the technical review).
  - **Deliberately not agents:** i18n string-parity and secret-in-code scans stay mechanical CI
    guards (`testing-and-ci.md`), not judgement agents.
- **`multi-tenancy-baseline.md` (new root doc) + `.claude/rules/tenant-scoping.md` (new scoped
  rule).** The pool-model isolation floor: `tenant_id` + RLS on every owned table (policy shape
  incl. the `platform_admin` bypass), per-request `SET LOCAL app.current_tenant` in a tx (reset
  on release), **subdomain routes but the JWT claim enforces**, a separate **host-bound**
  platform-admin surface (off-surface ⇒ 404) with audit-logged impersonation instead of a god
  query, tenant-scoped (not global) uniqueness, and a gotchas catalog from real incidents —
  **expression indexes unusable under RLS (leakproofness) → generated columns**, table-owner
  RLS bypass without `FORCE`, and leaked-GUC cross-tenant reads. Applies only to
  many-tenants-one-DB projects; single-tenant projects ignore it.
- **`documentation-standard.md` — `reviews/` is now a defined (optional) dir** for *dated
  review output that is still active input* (security/UX/CR/structural reviews, incl. the new
  agents' output), distinct from `archive/` (superseded). A `reviews/` doc graduates to
  `archive/` once fully actioned. README layout, when-to-reach table, and pieces diagram updated
  for the agents layer + the multi-tenancy baseline.

## v1.6.1 — 2026-07-12

**Public-edge baseline (new) — from a Cloudflare exposure audit that found a live, unwatched
production app.** The pack could take an app from private to public (`deploy-to-public.md`,
`deploy-to-shared-edge.md`) but said nothing about the failure modes *of the edge itself* — the ones
that leave a **green dashboard over a broken or wide-open app**. The audit that prompted this found,
in one pass: a production app published through an **undocumented second tunnel with no probe**; a
**dangling *and ungated*** route that would have come up open to the internet if its zone were ever
re-pointed; two **orphan tunnels** (one still listing a route for a *live* hostname); two "staging"
hostnames serving the **same live prod containers**; and a probe **firing on a perfectly healthy app**
whose endpoint had moved. None of it was visible anywhere, and none of it would ever have paged.

- **`public-edge-baseline.md` (new root doc).** Principle: **your public edge is the one layer you
  cannot audit from your boxes** — a remotely-managed tunnel keeps the hostname→origin map in the
  provider's dashboard, so anyone can publish a public hostname with zero commits and zero
  notification, and any hand-maintained list of "our public hostnames" is fiction. Read it from the
  API, on a schedule.
  - **§1 — the headline: an Access-gated app FAKES a green probe.** Access `302`s *every*
    unauthenticated request (incl. `/api/health`); the default blackbox module follows redirects, gets
    a **200 from Cloudflare's login page**, and reports the app **UP while every container is dead**.
    Measured: `probe_success=1`, `probe_http_redirects=1`, 35 KB of login HTML. Fix: probe *through*
    the gate with an Access **service token**, `follow_redirects: false`, 2xx-only — and assert
    **`probe_http_redirects == 0`**, which is the honest signal, not `probe_success`. Generalizes to
    any SSO proxy / WAF interstitial: **always ask what exactly returned that 200.**
  - **§2 exposure inventory** (per hostname: origin, box, how it's gated, probe state) with the states
    that hide: no Access app (open), a `bypass`/`everyone` policy (looks gated, isn't), unprobed,
    dangling route, orphan tunnel. Use a **read-only** API token — it forces every deletion to be a
    deliberate human act.
  - **§3 safe teardown**: a tunnel's route list is **not** evidence it serves those hostnames — check
    what **DNS** actually points at before deleting a tunnel. And a DNS record in a **non-`active`
    zone** resolves nowhere, so "does a record exist" is the wrong test.
  - **§4** one connector = one **shared blast radius**; a "staging" hostname pointed at prod containers
    **is prod**; **names lie, routes don't** (a `*-uat` host was production).
  - **§5 the deploy is not done when it's reachable** — and **§6** changing what an app serves is a
    **monitoring change** (a stale probe target trains you to ignore alerts).

**Runbooks hardened at the exact point they failed.**

- **`deploy-to-shared-edge.md`** — the runbook used to end at *"the neighbours still resolve"*, which is
  precisely how an app went live **unprobed and with no database backup** while every step passed. New
  **step 5, "The deploy is NOT done until it's watched and backed up"**: probe it (through the gate if
  gated), confirm the probe's alert rule **actually matches its job**, back the DB up and **restore it
  once**, alert on **missing** (not just stale — a backup that never ran has **no metric**, so a
  staleness rule fires **nothing**; *silence is not safety*), and register it in the exposure inventory.
  Step 3c now warns that gating changes how you must probe; Verify asserts `probe_http_redirects == 0`
  and that the first backup **exists on the target** (don't trust an exit code); Rollback gains the
  delete-route-before-DNS and check-DNS-before-deleting-a-tunnel rules.
- **`deploy-to-public.md`** — Branch A (Access) now points at the fake-green trap before you monitor it.
  Corrected the Branch-A worked reference to the hostname that is actually live (`klinika.ocme-it.org`).
- **`observability-baseline.md`** — Tier 2 (the outside-in probe) gains **"a probe behind an auth gate
  lies to you"**.
- **`security-baseline.md`** — new **§6 "Know your public surface (it is not in your repo)"**: audit the
  edge from the API, make every gate decision explicit, hunt dangling/orphan config, and treat a
  staging hostname on prod containers as prod.
- **Skills** `deploy-shared-edge` + `deploy-to-public` carry the same two rules in condensed form, so
  the agent applies them without loading a full runbook.

## v1.6.0 — 2026-07-11

**RAG / vector-library baseline (new) — from the ocr-llm curated-corpus incidents.** The pack
covered *tabular* import safety (`data-ingestion-baseline.md`) but nothing on standing up an
**embedding + vector store** an LLM retrieves from — a distinct, quieter class of failure where a
broken ingest returns fewer/wrong neighbours (or poisons a whole index) and the model answers
plausibly on top, with nothing throwing.

- **`rag-library-baseline.md` (new root doc):** seven rules, provider-agnostic (ChromaDB/pgvector/
  Qdrant). (1) **One embedder, one vector space** — same model/endpoint/dimension/task-prefix for
  every write *and* every query; embedder gets its own env var; never fall back to the vector DB's
  default embedder. (2) **One canonical write path per store** — a managed collection has exactly
  one writer; other surfaces are read-only or refuse it; an auth key is defense-in-depth, not the
  safeguard. (3) **Stable source-derived id upsert** (`<entity>-<chunk>`), idempotent, with a
  separate `--reset` for purge/repair — not chunk-position or text-hash ids that orphan vectors.
  (4) **Chunking is contract** — a re-chunk is a schema change (full re-embed), never two chunkers
  on one collection. (5) **Structured facts vs. semantic recall are different stores** — exact
  lookups go in a table (UNIQUE-key upsert, no embeddings), not behind approximate search.
  (6) **Published catalog is derived** — regenerate after every ingest, gate drift in pre-commit.
  (7) **One reproducible self-service ingest script** per corpus (sync→render→upsert→regenerate)
  with `--dry-run`.
- **`.claude/rules/rag-ingest.md` (new scoped rule):** the always-on distillation, path-scoped to
  `*embed* / *retriev* / *ingest* / *vector* / *chroma* / *rag*` files.
- **Anchor incident:** a curated ChromaDB collection embedded by the gateway's own Ollama pipeline
  also had an admin HTTP ingest endpoint that re-chunked + embedded differently; docs written that
  way poisoned the collection's HNSW index and retrieval returned nothing for any query whose
  metadata filter touched a bad doc (ocr-llm, 2026-07-04). Note: the multi-client *contract*
  discipline this touches (never break a published version; `vN+1` + broadcast) was already covered
  in `cross-repo-integration.md` §2 — this doc is only the store-shape/ingest-correctness half.

## v1.5.1 — 2026-07-11

**CI hardening (testing-and-ci.md) — three gaps found by diffing the skeleton against a
mature project's live workflow.**
- **Frontend tests are a blocking CI step**, not just `npm run build` — the build-only
  frontend job is a standing trap (a real project ran months of Vitest tests locally
  while CI never executed them; ~5-line fix once noticed).
- **Retired-secrets guard** in `ci-guards.sh`: literal secret values rotated out of the
  codebase go on a permanent banned-strings list (`git grep` gate, docs excluded), so a
  rotated password can never quietly reappear in compose files or scripts.
- **`ci-seed.sql` convention:** a small non-migration seed applied after the migration
  chain for reference rows the suite assumes exist (hardcoded ids/names) — migrations
  stay pure schema, the fresh-DB CI path stays runnable. Skeleton gains the seed step.

## v1.5.0 — 2026-07-11

**Upstreamed from the Fin project (dual-track, multi-agent, importer-heavy) — six
additions, each from lived practice.**

- **`dual-track-development.md` (new root doc):** ship-current + build-vNext on one trunk
  — feature flags default-OFF ("dormant-safe": flags off ⇒ byte-for-byte current
  behavior), an isolated vNext compose stack (own ports + own volume), go-live = config
  flip. Includes the AI-agent corollaries: every request declares its track (ask if
  unstated, especially DB/auth/migrations), commit scopes carry the track, verify against
  the matching stack. Proven over months of parallel v3/v4 work with zero forward-merges.
- **`cross-repo-integration.md` (new root doc):** sibling-repo coordination without a
  shared tracker — append-only `HANDOFFS.md` ledger in the provider repo (dated,
  addressed entries; the one sanctioned write into a sibling repo), pinned contract
  version in the consumer, and a fetch-the-live-spec preflight before non-trivial seam
  work.
- **`claude-code-permissions.md` (new root doc):** permission-prompt *diagnosis* (diff +
  mtime the settings; pipe-test the hook the settings reference — a missing hook errors
  invisibly on every call; check all settings layers) and the baseline config: bare-tool
  allowlist (Write and Edit are separate tools), narrow `rm` ask-net, a PreToolUse hook
  closing the prefix-rule gap (`cd x && rm y`), `additionalDirectories` for sibling
  repos, plus hook pipe-test + `jq -e` verification discipline.
- **`.claude/rules/git-concurrency.md` (new unscoped rule):** multi-thread shared-tree
  git discipline — a bare commit ships the ENTIRE index (another thread's staged work
  included); a pathspec commit ships WORKTREE state (resurrecting staged deletions —
  caused a real double key-rotation); verify `git show HEAD --name-status` after every
  commit; expect the branch to move under you; never sweep another session's dirty files.
  `claude-collaboration.md` cross-references it.
- **Migration backfill rule** (`.claude/rules/migrations.md` + `testing-and-ci.md`
  migration-chain note): any schema object that reached a live DB outside a migration is
  captured immediately in an `IF NOT EXISTS` migration, or CI's fresh-from-migrations DB
  silently diverges and unrelated tests fail much later (real incident: a column live on
  dev+prod for months broke CI only when a new test first touched it).
- **Pinned volume names** (`.claude/rules/compose-safety.md`): data volumes carry an
  explicit `name:` so their identity survives a compose-project/directory rename — an
  unpinned volume is silently abandoned (fresh empty DB) when the project name changes.
- **CR-index extensions** (`templates/docs/cr/README.md` + `documentation-standard.md`):
  optional summary-by-status roll-up past ~20 CRs; a Track column on dual-track repos.


## v1.4.0 — 2026-07-11

**Data-ingestion baseline (new) — from the Options-tool import/reconstruction incidents.**
The pack covered schema-migration safety but nothing on *importing external data and
deriving state from it*, where the failures are quiet (200 OK + healthy UI + corrupt
numbers). Four rules, each from a real incident:
- `data-ingestion-baseline.md` (new root doc): **(1) validate before you destroy** — a
  replacing import parses/validates to a non-empty result *before* deleting; a zero-row parse
  is a 4xx, not a 200 over a wiped table. **(2) External exports are unstable** — match
  headers case-insensitively, treat a missing required column as a hard error, never a silent
  `0`/`null` default on a money column; pin real exports as fixtures. **(3) Raw append-only +
  idempotent; derived rebuilt from ALL raw, never the delta** — a delta-rebuild orphans
  records whose lifecycle spans two imports. **(4) Assert a reconciliation invariant** on
  every import for quantitative reconstruction (tie out to $0.00 or a known residual; fail
  the import otherwise).
- `.claude/rules/data-import.md` (new path-scoped rule): the always-on distillation, scoped
  to parser/importer/loader files.
- README layout, when-to-reach table, and pieces diagram updated to include the new baseline.

## v1.3.4 — 2026-07-07

**Proactive SPA cache-header standard (from the Staritsky stale-chunk incident).**
- `deploy-to-public.md` — new gotcha **#29**: a code-split SPA served with **no
  `Cache-Control`** is a stale-`index.html` / lazy-chunk time bomb (`Failed to
  fetch dynamically imported module` — the shell loads, a route blanks). The
  durable fix is set at the **origin**, not via reactive "Purge Everything" (#10)
  on every deploy: content-hashed `/assets/*` → `immutable`; the `index.html`
  entry document → `no-store`/`no-cache` so it always revalidates and can never
  pin obsolete chunk hashes. Redeploys then need **no** cache purge. Part 1.2
  gains a "set this from day one" pointer.
- `script-library.md` §8 — **completed the frontend serving template**: the nginx
  image now `COPY`s a real `nginx.conf` (SPA routing **+** the #29 cache policy),
  with the Caddy equivalent alongside. Previously the template `rm`'d the default
  conf and shipped no replacement — neither routing nor a cache policy, which is
  the root reason the stale-chunk bug kept being discovered reactively.

## v1.3.3 — 2026-07-07

**Compiled-TS + Prisma Dockerfile traps (from the Staritsky prod bring-up).**
- `script-library.md` §8 — added a "compiled-TS + Prisma variant" callout to the backend
  Dockerfile: add a build stage (`prisma generate` + `npm run build`), point `CMD` at the
  compiled entrypoint (`dist/main.js`, not `server.js`), and keep the **`prisma` CLI in
  `dependencies`** so the in-container migrate isn't pruned by `npm ci --omit=dev`. All
  three fail only at container start / deploy time, so a green CI build doesn't catch them.
- `infra-bootstrap.md` §5 — cross-ref note on the hard rule: the migrate tool must exist in
  the prod image (a devDependency-pruned CLI can't run inside the container).

## v1.3.2 — 2026-07-06

**Public-deploy gotchas from the OCME service-worker / Access-expiry incident.**
- `deploy-to-public.md` catalog: added gotchas **#25–28** — Access session expiry bricking
  a SPA mid-session (apiFetch reload guard); the PWA-service-worker-vs-Access deadlock +
  self-destroying-stub escape hatch; the public Bypass Access app for `/sw.js`+`/workbox-*`;
  and the `sw.js` cache-header/nginx-location-precedence trap (exact-match + edge purge).
- Added a build-time design rule in Part 2A.3 and the `deploy-to-public` skill's Branch A
  checklist so the SW-vs-Access decision is made *before* shipping, not diagnosed after.
  Safe default stated: internal/staff apps ship **no caching SW** (manifest-only install).

## v1.3.1 — 2026-07-06

**/close version policy + version-display standard made explicit.**
- `/close` now **auto-bumps the version** on any code-shipping close — patch for
  fixes/internal, minor for new user-facing capability (Claude decides, states the choice,
  user can override); date refreshes with the bump; docs-only closes don't bump.
- Explicit standard added (infra-bootstrap §3 + §8/§11, script-library §9): the full
  version string — number **and** date — is displayed in the UI of **both** dev and prod,
  reading the same copied `version.json` (import, not build-arg-only, so dev can't fall
  back to a fake value); dev remains visually unmistakable (banner color, [DEV] tab,
  favicon). Version row added to the differentiation table.

## v1.3.0 — 2026-07-06

**Project-kickoff completion — brief + templates + orchestration.**
- `templates/project-brief.md` — the brief skeleton (problem/users/scope, the 30-day
  Phase 1 success criterion + kill criteria, PII inventory, regulatory/competitive
  landscape, infra-bootstrap §12 answers, risks/open questions, phase plan).
- `templates/docs/` — seed set for the documentation standard: `current/status.md`,
  `project-description.md` (with migration-matrix / job-registry / secrets-inventory
  tables built in), `project-roadmap.md`, `secrets-inventory.md`, `cr/README.md` index,
  and `cr/cr-000-template.md` (CR skeleton with an impact checklist tying CRs to the
  matrix/registry/rosters/tests rules).
- `.claude/skills/kickoff/` — `/kickoff`: brief → seeded repo (placeholders substituted,
  pack version recorded) → `/question` over unanswered decisions → CR-001 + first real
  status.md → confirm-gated handoff to building.

## v1.2.0 — 2026-07-06

**Workflow skills (new).**
- `.claude/skills/question/` — `/question`: walk all open questions/decisions one at a
  time (options + recommendation + rationale, discussion before advancing, decisions
  summary recorded per the documentation standard). The invocable form of the
  collaboration rules' question protocol.
- `.claude/skills/close/` — `/close`: session close-out — doc-sync per the documentation
  standard → explicit-paths commit + verified push (concurrency protocol) → confirm-gated
  production deploy via the deploy-single-host gates → close report.

## v1.1.0 — 2026-07-06

Implemented the best-practices review:

**Claude Code native layer (new).**
- `.claude/rules/` — `collaboration.md` (unscoped, always loads; replaces pasting the block
  into `CLAUDE.md`), plus path-scoped `migrations.md`, `compose-safety.md`, `env-secrets.md`.
- `.claude/skills/` — `deploy-single-host`, `deploy-to-public`, `deploy-shared-edge`,
  `db-ops`: condensed procedures with trigger descriptions; full playbooks remain canonical.
- `templates/CLAUDE.md` — starter project file: facts + pointers only.

**New baseline docs.**
- `testing-and-ci.md` — test strategy, deploy gates, pre-commit, and the rule for graduating
  mechanically-checkable conventions from CLAUDE.md into CI.
- `security-baseline.md` — secrets storage + rotation cadence + per-project inventory;
  dependency & image update/patching policy.
- `observability-baseline.md` — day-one logging/metrics/alerting for any app (extracted and
  generalized from deploy-to-public Phase 2.4).

**Safety fixes to existing content.**
- Prod→dev DB sync now **requires a PII scrub step** (GDPR; clinic/client data) — added to
  `infra-bootstrap.md` §4 and `script-library.md` §7, with a scrub-script spec.
- **Restore drills** added to the backup strategy (quarterly restore verification +
  `verify-restore.sh` spec) — untested backups are a hypothesis.

**Pack mechanics.**
- Pack versioning + this changelog; upstream/downstream maintenance rule in README.
- Two-tier placeholder convention documented (`<<seed-time>>` vs `<runtime>` vs script literals).
- `Last reviewed` dates on all root docs; scope statement; seeding steps incl. step 0;
  table of contents added to `infra-bootstrap.md`.

## v1.0.0 — 2026-07-06

Initial consolidation of nine loose memos into the deduped pack. See README §"What changed
when this pack was assembled".
