# CR078 — Selling costs on a disposal

**Status:** PROPOSED — not started. Needs a design decision (§6) before code.
**Track:** v3
**Origin:** [CR076 §7 Q2](cr-076-forecast-model-review.md) — *"there is no selling-cost / disposal-cost
field… For a plan with six property disposals this is the one balance-sheet input I would add."*
Raised independently by the balance-sheet reviewer and the cash-sweep reviewer.

---

## 1. The gap

Every disposal in the model books **gross** proceeds. There is no agent fee, no transfer tax, no
legal or broker cost, no Spanish *plusvalía* — the whole sale price lands in cash and the whole
gain is taxed.

`2026 Base` books this much through `Transfer - Bank`:

| year | module | proceeds (USD) | kind |
|---|---|--:|---|
| 2026 | `SP - Panorama Mar 4` | 453,488 | property |
| 2026 | `SP - Sea Senses` | 391,390 | property |
| 2026 | `US - Nokomis` | 394,875 | property |
| 2036 | `United Beverages` | **4,106,205** | business |
| 2040 | `Barkeria Sp. z o.o.` | 1,339,163 | business |
| 2040 | `SP - Panorama Mar 6` | 587,546 | property |
| 2040 | `PL - Muszlowa` | 60,437 | property |
| 2047 | `US - Casarina` | 1,563,818 | property |
| 2052 | `PL - Niemena` | **2,115,201** | property |
| 2030–37 | `CVC Fund VIII` / `IX` | 2,033,048 | **capital returns, not sales** |

**Property sales total 5,566,755.** At a realistic 3–6% all-in that is **167,000–334,000** the plan
has and would not. **Business sales total 5,445,368**; at 1–3% legal and broker that is a further
54,000–163,000.

**The base year is the sharpest case.** Its 1,239,753 of property proceeds is folded straight into
the sweep's **opening cash** ([CR075 §2](cr-075-base-year-is-the-budget.md)), which the sweep then
pins to its band every year — so a 4% error there does not wash out, it rides all 36 years. That is
the CR049 §1 failure mode, and it is why this is worth more than its headline percentage.

## 2. Why a per-ROW input, not per-module or per-scenario

The table above is the argument. The three kinds of disposal have genuinely different costs:

- a **property** sale carries agent commission plus transfer tax — the largest, 3–6%;
- a **business** sale carries legal and broker fees — smaller, and negotiated;
- a **capital return** from `CVC Fund VIII`/`IX` carries **nothing at all**. It is a distribution
  modelled as a disposal, not a sale.

A per-module or per-scenario rate would apply a selling cost to the CVC distributions, which is
simply wrong — and would do it silently, on 2,033,048 of proceeds. Per-row is the only granularity
that can express "this one is free".

## 3. The accounting, which decides the code

A selling cost **reduces the amount realized**. It is not an operating expense, so it must NOT be
booked to the P&L beside `Property Costs`:

```
netProceeds = grossProceeds × (1 − cost%)
realizedGain = netProceeds − basisReleased        ← the gain falls too
cashIn       = netProceeds
```

Both halves matter, and missing the second is the likely implementation error: if the cost came off
cash but not off the gain, the plan would pay tax on money it never received. The engine already
carries the shape this must slot into — CR076 D3 made the gain USD-functional
(`proceeds at the sale rate − basis at the acquisition rate`), and the cost applies to the proceeds
term before that subtraction.

**Currency:** a percentage is currency-neutral, so it applies in local currency before the USD
conversion, and no new FX handling is needed. That is most of why a percentage beats an amount.

## 4. Shape

**Migration** (next number, additive): `ALTER TABLE forecast_module_disposals ADD COLUMN
disposal_cost_pct numeric(6,4)`. **Nullable, defaulting to NULL**, so every existing row means "no
cost modelled" and the engine is byte-identical until a value is typed — the CR050/CR062 dormancy
pattern.

**Form:** one field on the disposal row in `FCModulesEdit`, labelled with its unit and an example
(`% of sale price — agent fee, transfer tax, legal`), per the lesson in
[CR076 §11](cr-076-forecast-model-review.md): a field whose unit is not obvious states it, and the
example is checked against the formula.

**Engine:** `fcbuilder-module.js`, in the partial and Full disposal branches and in `index.js`'s
convergence mirror — **all three**, because [CR076 D1](cr-076-forecast-model-review.md) is the
standing lesson that the mirror writes last. Ideally via one shared helper so they cannot drift.

**Warning:** a disposal with no cost on a **property** module is worth an *advisory*
([CR077](cr-077-assumption-advisor-tab.md) tab b), not an integrity error — gross proceeds are a
choice until the owner says otherwise. It must NOT fire on a capital return, or it becomes the
always-on noise CR077 §7 deleted.

## 5. Gate

Number-moving, so: measured before/after on a prod copy with the engine first proven idempotent,
one change at a time, plus the bank line landing on the sweep's band (CR076 §18's cheap
engine-vs-app check). Expect **every scenario to fall**, and the base year to move most.

## 6. ⚠️ Decide before building

1. **Is the cost visible, or only netted?** Netting is accounting-correct but silent — the Review
   would show 4% less cash with nothing saying why. A `Disposal Costs` row costs an FC line
   ([CR066](cr-066-fc-line-mapping-completeness.md) territory) and would double-count if also
   netted off the gain. *Leaning: net it, and show the gross → net bridge in the module's output
   panel, where the drill-down already exists.*
2. **One rate, or rate + fixed amount?** Some costs are flat (legal, notary). A percentage alone is
   simpler and probably enough at this horizon.
3. **Does it apply to a partial disposal's tranche?** It should — but confirm, since CVC's
   `OneTime` rows are partials that must stay at zero.
4. **Are the Polish and Spanish transfer taxes really a selling cost, or a separate line the owner
   already models elsewhere?** This is the question that decides whether the default is 0 or a
   sensible starting rate per country.

## 7. Related, and deliberately separate

The **money basis of `Fixed $` / `One-Off $`** (CR076 §7 Q2's other half): those rows are added
**raw, in the money of their own year**, so `Social Security`'s 20,000 at 2035 is 2035 dollars
(~13,300 today) and `Retirement Home`'s 200,000 at 2052 is worth ~105,000 in 2026 money. That is a
real ambiguity in a live input and deserves its own decision — but it is a different field and a
different fix, and bundling the two would make both harder to measure.
