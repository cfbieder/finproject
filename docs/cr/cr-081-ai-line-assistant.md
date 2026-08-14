# CR081 — Ask about this line: AI-proposed edits, previewed before they land

**Status:** **DEFERRED** (owner, 2026-08-14) after a two-pass review — pass 1 *revise*, pass 2 *defer*. **P0a was carved out and SHIPPED (v3.28.3)** as a defect fix; see §12. The successor for the value this CR was reaching for is an **editor-side consequence preview with no LLM** (§13).
**Track:** v3
**Origin:** owner request 2026-08-11, from the [CR076 §13](cr-076-forecast-model-review.md) advisory
session: *"add AI Help where I ask a specific question about a line, the local LLM proposes a few
answers, and I select one which the system implements into the scenario."*
**Supersedes:** [CR077 §4](cr-077-assumption-advisor-tab.md)'s LLM stage — that is this CR's P2,
plus actions. Two plans for one feature would be worse than one.

---

## 1. What was asked for

A question box scoped to a forecast line. The owner asks in plain English — the motivating example
was *"review whether `Retirement Home` looks reasonable, it's meant to be senior living for me and
my wife"* — the local LLM returns a few concrete candidate answers, and selecting one applies it to
the scenario.

**Owner instruction, 2026-08-11:** *auto-apply must first provide a preview.* §4 makes that
structural rather than a convention.

## 2. Three-quarters of this already exists

This was scoped expecting a new subsystem. It is mostly an extension of shipped machinery, and the
extension point is one the code has already named and deliberately declined.

| piece | where | state |
|---|---|---|
| typed action + apply | `aiReview.applyAction` | works; allowlist is `growth_rate`, `tax_rate_override` (valuation modules only), `cash_sweep_low/high`. Refuses `update_incexp` outright — a retired table |
| **stream edits** | same function | **already named "P3 scope"** and refused on purpose: *"needs the stream shape and a variant-safe write; refusing is the honest interim"* |
| scratch-scenario rebuild | [CR053](cr-053-forecast-auto-adjust.md) `forecastAutoAdjust` | deep-copies to a **standalone** scratch (a variant scratch is impossible — the 039 trigger rejects variant-of-variant, and `generateForecast` force-syncs a variant at Step 0, clobbering any direct write), runs real engine builds, reads the engine's own persisted entries **never the client warnings util**, persists via a CR050 override, verifies with a rebuild |
| gateway + chat + storage | `aiReview.js` (contract v1), `fc_ai_reviews`, `audit_log` | live |
| a legible delta | [CR079](cr-079-real-terms-view.md) | Compare in today's money — what makes a 2052 edit readable |

CR053 already keys on **stream ids** (*"a candidate line is an EXPENSE STREAM… the line `id` is the
STREAM id"*), which is exactly the entity the motivating example needs.

## 3. ⚠️ The live gap this must close FIRST

The shipped flow is *Apply Change → confirm modal → write*. The modal renders `field`,
`current_value`, `proposed_value`, `reason`. Two defects:

1. **It is a confirmation, not a preview.** It shows the INPUT (`growth_rate 0.5 → 1.0`) and never
   the CONSEQUENCE. The owner approves a change without seeing what it does to the plan.
2. **`current_value` is rendered from the MODEL, not the database.** `applyAction` destructures only
   `{ type, module_id, field, proposed_value }` — `current_value` is never read server-side. It is
   whatever the LLM asserted. A wrong "from" value means the owner approves against a false premise,
   and one click writes.

Defect 2 is **CR077 §4's rule already being violated on a shipped path**: *nothing generated may
state a number*. It is live today and worth fixing whether or not the rest of this CR proceeds —
recorded as roadmap Known Issue #22.

## 4. The invariant

> **No AI-originated change reaches a real scenario except through a preview the owner has seen —
> and the preview shows the CONSEQUENCE, not the input.**

Structural, not a UI convention a future caller could forget:

- **`POST /ai-review/preview`** applies the action bundle to a CR053-style scratch, runs a **real
  engine build**, returns before/after plus a **preview token** = hash of *(action bundle + scenario
  + the scenario's current entries fingerprint)*.
- **`POST /ai-review/apply` refuses without a matching token.** No token, or a bundle that does not
  hash to it ⇒ 400. The UI cannot skip the preview because the server will not accept the write.
- **The token expires when the scenario's fingerprint moves.** If anything regenerated in between,
  the preview described a plan that no longer exists. This is [CR074](cr-074-dismissible-cash-health-warnings.md)'s
  dismissal-expiry idiom reused rather than reinvented — a judgement expires when its figures change.

## 5. What a preview must show

| | |
|---|---|
| the input | field, **DB-read** current value → proposed. The model's claimed current value is **discarded**, never rendered |
| the consequence | net assets at PeriodEnd before → after, **nominal and in today's money** |
| the line itself | that module's own year-by-year series, before → after |
| the warnings | integrity + advisory rows gained or lost, especially any new shortfall year |
| **the blast radius** | **which other scenarios move.** A base edit propagates to four variants; silence here is the `disposal_cost_pct` class ([v3.25.2](../current/project-roadmap.md)) |

## 6. Where a proposed number may come from

Extending CR077 §4 from sentences to actions:

> **The model may choose among actions and phrase them. It may never originate a number.**

Four legitimate sources, and no fifth:

1. a figure already in the plan (*"match `Healthcare`'s multiplier"*)
2. arithmetic **our code** performs (*"the amount that holds this flat in real terms"*)
3. the owner's own answer in the conversation
4. a benchmark table the owner maintains, **with a stored source and date** (P4)

### ⚠️ Why this is the whole risk, demonstrated on the motivating example

Answering *"is 200,000 reasonable for senior living?"* well, on 2026-08-10, took three things:
reading the module's real config, **searching for current Sarasota assisted-living costs**, and
arithmetic. The local model can do the first only if fed, **cannot do the second at all**, and must
not do the third.

Asked cold it will answer from a stale prior with full confidence, and a hallucinated
*"propose 192,000"* renders as exactly the same tidy option button as a correct one. Until P4 exists
the assistant is strong on questions answerable **from the plan itself** (*"this line adds to your
living costs rather than replacing them"*, *"this escalates at general inflation"*) and must not be
asked to judge the plan against the outside world.

## 7. Phases — safety first

| | | effort |
|---|---|---|
| **P0** | **Preview gate on the EXISTING path.** No new feature. Token-gated apply, `current_value` read from the DB, scratch cleaned up on failure too, and a test asserting the apply endpoint **refuses** an untokened write. Closes §3; prerequisite for P2–P3. | ~1 day |
| **P1** | **"Explain this line" — no LLM.** Deterministic fact card: what the module is, its yearly output nominal **and** in today's money, what it adds to vs replaces, which advisories touch it. Answers most of the motivating question alone, and is the fact sheet P2 consumes. | ~0.5 day |
| **P2** | **Question → typed proposals.** Scoped to a line. Strict JSON against a **closed** action schema; anything unparseable is discarded rather than shown. 2–4 options plus *"none of these"*. Every option routes through P0's preview — there is no direct-apply button. Numbers rendered by our formatter. | ~1–2 days |
| **P3** | **Extend the action vocabulary** to streams and stream change rows — the P3 the code already names — written through base + overrides, **never** directly to variants. **Bundles are atomic**: the honest `Retirement Home` fix is three edits, and previewing one third of a change misleads. Audit row + one-click revert. | ~1–2 days |
| **P4** | **Benchmarks.** Owner-maintained reference table with stored source and date, or gateway retrieval (cross-repo ⇒ `HANDOFFS.md`). The only thing that makes *"is this reasonable?"* genuinely answerable. | open |

P0–P3 is roughly a week and useful at every stop.

## 8. Deliberately NOT in scope

Auto-apply without preview · free-text edits the schema cannot express · the model quoting outside
data from memory · any write that touches a variant directly · a whole-plan free-text box (scoping
to a line is what bounds the fact sheet and makes the action target unambiguous).

## 9. Costs accepted knowingly

- **A preview is a real engine build**, seconds per option — so preview on **selection**, not on
  every proposal rendered, or four options means four builds.
- **Scratch scenarios must be pruned on the failure path too**, including the assumptions-doc rows
  keyed by scenario name that `deleteScenario` does not touch (CR053 already handles this).
- Generate takes `pg_advisory_xact_lock(scenario_id)`; a scratch has its own id, so a preview does
  not contend with a real regenerate.

## 10. Open questions

1. **Does an accepted proposal auto-dismiss the advisory it answers?** Probably yes for tab (b), but
   CR077 §5 Q1's *"considered" vs "dismissed"* distinction may finally need to exist here.
2. **Does the preview run against the base scenario or the selected one?** Editing `2026 Downside`
   directly is a CR050 override; editing Base moves five. The UI must make which one is being
   changed unmissable.
3. **Is the fact sheet capped?** A module with 36 years of entries plus warnings may exceed a useful
   prompt size. Summarise deterministically, and say what was summarised.
4. **Revert semantics** — does undo restore the prior value, or re-run the inverse action? The
   former is safer; the latter composes. Likely store the prior value.
5. **Does P1 ship on the Review row, the module editor, or both?**

---

## 11. ⚠️ Corrections — what this document got wrong

Recorded rather than quietly edited, because the errors are the same shapes this project keeps
paying for.

| §  | claimed | actually |
|---|---|---|
| 2 | `audit_log` is "live" | it exists since migration 001 and **nothing had ever written to it**. P0a is its first writer. |
| 5 | "a base edit propagates to four variants" | **four `streams` overrides already exist on prod**, and a streams override replaces the module's stream set wholesale — so a base stream edit reaches *nothing* on Upside and Downside. The radius must be **computed per action**, and must report what does **not** move. Asserting a fixed "four" is [failure-patterns](../current/failure-patterns.md) §1 — a restatement asserted as the engine's behaviour — arriving inside the very CR that cites it. |
| 4 | the token hashes the entries fingerprint | an apply mutates **inputs**; entries are the *result of the last build*. Stale entries beside fresh inputs is this system's NORMAL state, so the token would accept an apply against an input state the preview never saw. |
| 5 | a preview shows warnings and today's-money figures | both are computed by **frontend-only** modules (`fcWarnings.js`, `fcRealTerms.js`); no server implementation exists. The endpoint would have to return raw before/after entries and let the client derive them. |
| 3 | two live defects | **four.** The two missed are worse, and are what P0a actually fixed — see §12. |
| 7 | P0 ≈ 1 day, P0–P3 ≈ a week | the scratch machinery is a *pattern inline in the bisection solver*, not a reusable primitive. Realistic P0–P3 is **2–3 weeks**. |

## 12. P0a — shipped v3.28.3 as a defect fix

Carved out on both reviewers' recommendation and shipped independently of everything above.

**The two defects §3 missed, both found by pass 1:**

1. **The write target was chosen by the model and never validated.** `POST /ai-review/apply` took
   `{ action }` with no `reviewId`, so the server had no idea which scenario the conversation was
   about. `applyAction` checked the module *existed* but never that it belonged to the reviewed
   scenario — so a review of `2026 Downside` could write a module in `2026 Base`, whose edits then
   fan out. The dialog never named a scenario, so nothing surfaced it.
2. **`update_scenario` bypassed the CR050 reconcile**, which lives in the scenarios **route**, not
   the repository. A sweep-band change applied to a variant reported success and was then erased by
   the next sync rewriting the band from base ⊕ overrides — accepted, stored, silently reverted,
   which the route's own comment calls "the one failure mode this feature must not have".
   (`updateModule` *does* intercept, which is why the module path was safe.)

**Shipped:** `reviewId` required; a shared `resolveAction` validator behind both the confirm dialog
and the write, so they cannot drift; `current_value` read from the row and the model no longer even
asked for one; the variant reconcile called; one `audit_log` row per apply; the dialog now names the
**scenario** and marks a variant.

**10 tests — the first this path has ever had.** Four are characterization of guards that already
existed, written so the refactor could not silently drop them. Both new guards were verified by
disabling them and watching the right test fail.

### ⚠️ What verifying it cost

The live check was run after a `docker compose restart` of `server-dev` — which runs a **built image
with no source mount**, so it re-ran the OLD code. The verification therefore exercised the unfixed
path, which *accepted* the write, and set `New Business`'s growth to 2.0 on dev. Recovered by
reading the value back from prod (byte-identical at the time) and the entries fingerprint never
moved (`New Business` is `exclude`). Rule now in
[guides/infrastructure.md](../guides/infrastructure.md): *verifying a fix against a stale binary can
exercise the very bug you removed.*

## 13. The successor — an editor-side consequence preview, no LLM

Both reviewers converged on this independently, and it is what P1–P3 were really reaching for:

> **When you save any edit, show what it does before you commit it** — net assets before → after in
> nominal **and** today's money, the line's own series, warnings gained or lost, and which scenarios
> actually move.

It serves **every** edit the owner makes rather than only AI-originated ones, needs no token
contract, no closed action schema and no benchmark table, and would make this CR's AI half a small
increment on top rather than a week of plumbing. It gets its own CR when started.

### Why the rest is deferred, in one line

The measured acceptance rate on AI-proposed assumption edits is **0/15, twice**
([CR076 §13](cr-076-forecast-model-review.md), [CR077 §7](cr-077-assumption-advisor-tab.md)); the AI
drawer has 8 reviews in four months and was not used during either of the two largest review
sessions this project has run; and the one phase that would deliver demonstrated value — P4's
sourced benchmarks — is the one the stated architecture **cannot** deliver, since a local model
cannot search and will fake it confidently.

**What would change the decision:** the owner is blocked wanting to use it · an advisory pass
produces a change he would have accepted from a proposal · the cheap P4 (a sourced, dated sentence
against an assumption — the Blanchett pattern from CR076 §13) gets used and he wants it structured ·
or §13's preview ships and proves the preview was the point.
