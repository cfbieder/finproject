# CR077 — Splitting the Cash Health panel: integrity vs. assumption advice

**Status:** PROPOSED — not started. **Deliberately sequenced AFTER [CR076](cr-076-forecast-model-review.md)
§8 step 6 (D2–D6)** at the owner's instruction, 2026-08-09.
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
