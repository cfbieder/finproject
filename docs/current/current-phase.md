# Current phase — the forecast model, and the defect class it keeps producing

> Lifted out of [status.md](status.md) on 2026-09-23 to keep that file inside its own budget.
> It belongs here because **it changes on a regenerate, not on a release** — status.md turns over
> every release, this does not. status.md links here; read it when the work touches the forecast
> engine, a rendered surface, or a rule you are about to write down.

**The model, since [CR069](../cr/cr-069-forecast-streams.md):** a module is *identity + optional
valuation + N first-class **streams***. Shipped since 2026-08-05 and not restated here —
[CR070](../cr/cr-070-module-inputs-by-type.md)+[CR071](../cr/cr-071-forecast-numbers-vs-intent.md)
· [CR072](../cr/cr-072-valuation-module-inputs.md) (**the balance-sheet form is CLOSED**) ·
[CR073](../cr/cr-073-two-recurrence-guards.md) ·
[CR074](../cr/cr-074-dismissible-cash-health-warnings.md) (migration 061 — a dismissal **expires
when the warning's figures change**) · [CR075](../cr/cr-075-base-year-is-the-budget.md) (**year −2
is ACTUAL, year −1 is the BUDGET**, read from `budget_entries`; one budget ⇒ one base year).


⚠️ **Its durable lesson is a DEFECT CLASS, not a feature: state that exists, renders, and produces
no visible effect, so it reads as absent.** In the engine that is a knob which writes, builds and
moves nothing, drawing a zero-length bar that says *"this assumption does not matter"* in a chart
whose whole claim is that the bars are ranked. In the UI it is a control too subtle to find, a
picker that cannot say what is selected, a marker painted the colour of its own fill, or six
measurements built and two drawn. **ELEVEN instances. TEN were found by a person looking at the
page; ONE by a gate.** The engine half now HAS a gate —
`Scripts/sweep-sensitivity-knobs.js` ([§22](../cr/cr-085-forecast-sensitivity.md)) applies every
offered knob, rebuilds for real and hashes the entries, so a dead knob is measured rather than
argued about; it caught two of its own author's fixes hiding working knobs. ⚠️ **The DISPLAY half
still has none** — nothing checks that a chart draws everything it was handed — and that is where
the owner found all but one of their instances. **It keeps recurring, and the count is not the point — the
method is.** v3.41.0 found one this way in [CR054](../cr/cr-054-cash-flow-by-account.md) (a
`Net Cash Flow` row in `<tfoot>` that missed the frozen-column selector and scrolled its label away
from its figures; its fix was got wrong twice by reasoning about the cascade and settled by a DOM
probe). [CR092](../cr/cr-092-net-worth-bridge.md) then found **five** at P0, more at P2, and
**three more at P1** — including prose that read back the prompt's own tag words instead of any
figure, which was schema-valid and passed every test. **Every one of those was found by opening the
page, and none by a suite.** Until a display-side gate exists, rendering the change in both themes
is not polish; it is the only instrument that has ever detected this class.

🔴 **[CR076](../cr/cr-076-forecast-model-review.md) — the five-reviewer model review; §8 COMPLETE
across v3.20.0–v3.22.0.** It corrected **our own published figures** and moved numbers eight times.
**§1 records what is SOUND and is the larger half.** §7 + §11 still hold open owner decisions.
Shipped since, all detailed in the [CR index](../cr/README.md) and the
[roadmap](project-roadmap.md): [CR077](../cr/cr-077-assumption-advisor-tab.md) (v3.23.0 — Cash
Health splits into **Integrity** vs **Assumptions to consider**, counted and dismissed separately)
· [CR078](../cr/cr-078-disposal-selling-costs.md) (v3.24.0, migration 062 — a per-row selling cost
off the cash **and** the gain; rates live since 2026-08-09) ·
[CR079](../cr/cr-079-real-terms-view.md) (v3.25.0 the Review, **v3.26.0 Compare** — the plan in
**today's money** on both; the export stays nominal).

**Net assets at 2062 (as of 2026-08-10 — ⚠️ stale since the v3.61.6 regenerate, which set 2% on three
business disposals; re-read from Compare):** Base **4,071,160** · Buy Business **9,102,335** · Downside
**1,893,368** · Upside **7,404,138** · SRQ **−476,930**. Owner decisions applied 2026-08-09:
selling costs by jurisdiction (**US 7 · Spain 6 · Poland 4 · business 2%**, CVC capital returns
exempt — **−603K to −796K per scenario**, the plan had been keeping 100% of every sale);
`Social Security` → **full CPI**; `OCME` at −30 a **deliberate write-off**. **2026-08-10:
`Sarasota House` growth **0 → 1.0**** — the only US property not at full CPI, and an unset field
rather than a belief (owner); only SRQ moved, **−1,392,889 → −476,930**, the other four
**byte-identical** ([v3.26.1](project-roadmap.md)).

⚠️ **SRQ is still −476,930.** It is bought **entirely for cash** (`House Morgage` is `exclude`
everywhere), earns **no rent** against 45,000/yr, and sells at 7%. Financing is the untested lever,
and testing it is **DECLINED** (owner, 2026-08-23) — not needed.

### The recurring failure
**[failure-patterns.md](failure-patterns.md) is the canonical list** — seven shapes, each found
more than once, each having passed the gates meant to catch it. Read it before writing a rule, a
warning sentence, or any figure that asserts what the engine does. The one that has cost most:
**a restatement asserted as the engine's behaviour, found TEN times** — the ninth
([CR059 §22](../cr/cr-059-fintable-api-ingestion.md)) is the first to reach the **ledger**, and the
tenth (§22.9) is the first where the restatement is of a **measurement**, not the engine.
