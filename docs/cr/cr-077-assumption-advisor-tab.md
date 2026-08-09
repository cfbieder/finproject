# CR077 — Splitting the Cash Health panel: integrity vs. assumption advice

**Status:** IN-PROGRESS — **increment 1 SHIPPED in v3.23.0 (2026-08-09)**; the LLM stage (§4) and
§5's open questions remain. No migration; **no forecast number moves** — a reading surface over the
existing derivation, and the only release in this sequence that needed no regenerate. Its
prerequisite (CR076 §8 step 6) is complete.
**Track:** v3
**Origin:** owner, 2026-08-09 — *"can we split the comments section on the forecast page into two
tabs (a) the types of warnings we show not related to model integrity and (b) a new 2nd tab with
suggestions when we see actual model assumptions to consider (e.g. social security, other sub-1
multipliers) — e.g. more value added comments that can be dismissed, maybe we use our local llm
model."*

---

## 1. Why the panel needs splitting

The Cash Health panel currently mixes two different kinds of statement under one heading and one
severity scale. On prod today it reads **16 issues · 3 dismissed**, and those 16 include:

| what it says | what kind of statement it is |
|---|---|
| *"`Business Loan` is configured but excluded from the forecast"* | **integrity** — the model does not do what its data says |
| *"`Tax Liabilities` is sold in the base year 2026"* | **explanation** — the model is fine, the timing is surprising |
| *"`CVC Fund IX` both pays a yield and returns capital"* | **a question only the owner can answer** |
| *"`OCME` is sold at a loss…"* | **integrity + a data-quality doubt** |

They demand different things. An integrity finding is a **defect to fix**; an assumption question is
**a judgement to record**. Putting them on one list means the owner must re-triage the same
judgement calls every time the panel renders — which is precisely what CR074's dismissals were
built to relieve, and why the panel already carries a *"Dismiss all 13"* button.

**The new tab is the missing half.** CR076 §11 produced a set of findings with no home: `Social
Security` escalating at 0.25 × inflation against a statutory full-CPI COLA; `Purchases` at 0.5
shedding ~36% of purchasing power over the horizon; `OCME` at −20 × inflation. None of these is a
defect — the engine does exactly what it was told — and none belongs in a list headed *Cash
Health*. They are the advice a planner would give.

## 2. Shape

Two tabs on the existing panel, counted separately:

- **(a) Integrity** — the current rules, minus the advisory ones. "The model is not doing what your
  data says." Errors and warnings.
- **(b) Assumptions to consider** — advice about inputs the engine is faithfully applying.
  Informational by nature; **dismissible**, and dismissals must survive a regenerate.

CR074's machinery is reused wholesale and is the reason this is cheap: `warningFingerprint`,
`partitionDismissed`, `forecast_warning_dismissals` and the three routes already exist and are
already per-scenario. **The three load-bearing properties from CR074 §1 carry over unchanged** —
dismissed is never invisible, all-dismissed is not all-clear, and a dismissal **expires when the
figures change**. That last one matters more here, not less: an assumption accepted at 0.25 must
come back if the multiplier moves.

## 3. What goes in tab (b) on day one — no LLM required

Every item below is already computable from data in hand, and each was found by the CR076 review:

| advice | trigger | evidence |
|---|---|---|
| escalation below inflation on a **statutory-COLA** income | `growth_mult < 1` on an income stream | `Social Security` 0.25 |
| a long-horizon expense shrinking in real terms | `growth_mult < 1` on an expense over N years | `Purchases` 0.5, `Travel` 0.8 |
| a growth multiplier that is really a percent | R10 — already shipped in v3.21.0 | `OCME` −20 |
| total return worth stating | growth + yield on one module | `Fidelity Stocks` 2.5% + 2.0% = 4.5% nominal |
| an unpriced cash position | idle cash at 0% while the sweep sells a yielding asset | CR076 §7 Q1 |
| gross proceeds with no selling cost | a disposal with no cost input | CR076 §7 Q2 |

**Build these first.** They are deterministic, cite a number, and can be falsified. A rule that
says *"`Social Security` rises at 0.625%/yr; statutory COLA is full CPI"* is worth more than a
paragraph of generated prose, and it cannot hallucinate.

## 4. On using the local LLM

The gateway (`docs/guides/ocr-llm-integration.md`, contract v1) is a reasonable **second** stage,
not the first, and the constraint is this CR's whole risk:

> **Nothing generated may state a number, or assert what the engine does.**

CR076 found *seven* instances of a claim about the engine derived from a restatement rather than
the formula — five of them in rules a human wrote and reviewed. A generator writing sentences about
the model is that failure mode with the brakes off, and the panel is exactly where a confident
wrong sentence does damage: [CR045](cr-045-forecast-cash-warnings-liquidation.md) §1 exists because
a $20M shortfall sat here unremarked.

So the safe division is: **deterministic rules compute and state the facts; the LLM may only
prioritise, group, or phrase them**, over figures passed to it, with the numbers rendered by our
own formatter and never by the model. If a generated item cannot be traced to a rule that produced
its number, it does not render. Worth checking against `AI Review` (CR040), which already has a
working pattern for this and its own drawer.

## 5. Open questions for the design pass

1. Does tab (b) need its own severity, or is everything `info` with a **"considered"** state
   distinct from "dismissed"? Accepting advice is not the same as hiding it.
2. Should the tab badge count un-reviewed items only, so it reaches zero and stays there?
3. Do advisory dismissals belong in the same table with a `kind` column, or their own? (One table
   plus a column is likely right — the fingerprint logic is identical.)
4. Is there a per-scenario vs per-plan distinction? `Social Security` at 0.25 is wrong in all five
   scenarios at once, so re-deciding it five times would be a regression in usability.

## 6. Prerequisite

**Do not start before CR076 §8 step 6 (D2–D6) is done.** Three of those five change what the
numbers ARE, and an advisory panel built over figures that are about to move would need
re-verifying immediately — and would risk teaching the owner to trust advice derived from a value
under repair.

---

## 7. Increment 1 — built 2026-08-09

### The split, and where each rule landed

Classification is **central**, not at each `push` site: an unlisted id defaults to **integrity**,
the louder of the two, so a new rule that forgets to classify itself lands in the tab that gets
read rather than the one that gets accepted. Every exported producer
(`computeForecastWarnings`, `computeModuleIntegrityWarnings`, `computeLoanWarnings`) returns
classified warnings, so no consumer can receive one without a `kind`.

**Advisory** — `disposal-in-base-year` (explains where the money went) · `disposal-no-gain` (is the
basis a placeholder?) · `yield-and-dispose` (is growth net of distributions?) ·
`foreign-income-no-tax-override` · `growth-multiplier-outlier` · the new
`escalation-below-inflation`. **Everything else is integrity.**

The test is not severity. It is: *if this is true, is something WRONG — or merely worth DECIDING?*

**Measured on prod's `2026 Base`: 4 integrity, 12 advisory.** The integrity tab now holds four
rows, all genuine (`configured-but-excluded` × 4), where the single list was heading past twenty.

### The one new rule: `escalation-below-inflation`

`growth_mult` is a multiplier of inflation, so anything below 1 shrinks in real terms — and the
form's hint said the opposite until v3.21.0, while **70 of 110** streams carry an explicit
multiplier. Direction changes the meaning, so it changes the sentence: an income below inflation is
a risk the owner carries, while **an expense below inflation makes the plan LOOK BETTER**, which is
the more dangerous of the two because nothing else on the page flags optimism.

Blank never fires (blank means 1, and firing on the default would report most of the plan).

### ⚠️ A rule that was written and then DELETED

`idle-cash-unpriced` was built — the sweep sells a return-earning asset to hold a 0% balance, and a
shortfall costs nothing either (§7 Q1). It fired on **every scenario that has a sweep, which is all
of them, always**. A rule that cannot *not* fire carries no information: it is documentation
wearing a warning's clothes, and it is precisely the noise CR074 exists to remove. It also
permanently suppressed the all-clear, which is gated on `warnings.length === 0` — **a unit test
caught that**, not review.

The underlying point is real and stays a decision in CR076 §7 Q1. **The test for any new advisory:
could this be absent on a plausible plan? If not, it is not a finding.**

### CR074's three properties, preserved PER TAB

1. **Dismissed is never invisible** — both tab counts are always on screen, so switching to advice
   can never hide that a defect is waiting.
2. **All-dismissed is not all-clear** — and the empty states are worded differently on purpose. An
   empty **integrity** tab is a claim about the PLAN (CR045 §1's all-clear, correctly scoped); an
   empty **advisory** tab is only a claim about the list, and says so: *"That is not a statement
   that your assumptions are right — only that none tripped a rule."* Saying "cash stays funded"
   from the advisory tab would be CR074's property-2 mistake in a new place.
3. **Expiry on change** — untouched; dismissals still key on `warningFingerprint`.

The section-level all-clear still requires **both** tabs empty.

### Deliberately not in this increment

The **LLM stage** (§4). The deterministic rules are the foundation it would prioritise or phrase,
and shipping the generator first would put a confident sentence about the engine on the one panel
where a wrong one does most damage. A "considered" state distinct from "dismissed" (§5 Q1) is also
deferred — dismissal already carries the meaning, and a second state needs a reason to exist.

**Gate:** 870 backend · 475 frontend (7 new) · 8/8 e2e · lint 0 errors · six ratchets. The
dead-token ratchet caught a `--text` that does not exist in this codebase (`--ink` does).