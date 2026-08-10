# CR078 — Selling costs on a disposal

**Status:** SHIPPED **v3.24.0 (2026-08-09)**, migration 062. **LIVE since 2026-08-09** — rates set (§9); no longer dormant — no disposal carries a
cost, so the engine is byte-identical until the owner types a rate. §6 Q1 answered by the owner;
Q2–Q4 taken as routine calls and recorded in §8. **Open:** §4's advisory rule, and the rates
themselves.
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


---

## 8. Built 2026-08-09 — dormant until a rate is typed

### Owner decision (§6 Q1) and the three routine calls

**Q1 — net it, and show the gross → net bridge in the module output.** Accounting-correct, no new
FC line, and the number stays traceable to its parts, which is the reconcile rule CR076 asks of
every surface. The bridge is exposed as `DisposalCost` on the module's returned series.

Q2–Q4 were routine and are recorded rather than asked: **percentage only** (a flat fee is
expressible as a percentage at this horizon, and a percentage is currency-neutral so it needs no FX
handling); **it applies to a partial disposal's tranche** (`CVC`'s `OneTime` rows stay at zero
because their rate is NULL, not because partials are exempt); and **the default is NULL, not a
per-country rate** — verified first that transfer taxes are **not** modelled anywhere else, so this
is a gap rather than a duplicate (the property modules' only expense streams are recurring
`Property Costs` carry, with no window).

### Migration 062

`disposal_cost_pct numeric(6,4)`, **nullable with no default**, plus a CHECK keeping it in
`[0, 100)`. NULL means "no cost modelled" — deliberately not the same as a typed 0, which means
"considered, and free". A `DEFAULT 0` would read identically to the engine but would assert that
the owner had considered and chosen zero for 20 existing disposals, which is untrue.

Applied to **dev through `migrate.js`** (never `psql -f` — migration 057's row is the standing
warning). Probed with real writes: `−1` rejected by the CHECK, `100` rejected by the numeric
precision, `5.7500` round-trips losslessly. **Inert: all five scenarios regenerate byte-identical.**

### ⚠️ The ordering bug, which is this project's signature failure

The first implementation computed the cost **before** the Full-disposal branch, and its comment
claimed it ran after. For a Full disposal `disposeValues` is only final once that branch replaces
it with `−prevMV − halfYearGrowth`, so the cost read zero — **the gain moved and the cash did
not.** That is precisely the half of the accounting §3 warns about, and it is
[failure-patterns.md](../current/failure-patterns.md) §1 again: *a comment describing intent rather
than behaviour*. I wrote the warning and then committed the error it warns about, in the same file.

Caught by measuring on real data rather than by reading. A test now pins the Full case.

### Verified on prod data, both halves, to the cent

`SP - Panorama Mar 4` with a 5% cost:

| | before | after | delta |
|---|--:|--:|--:|
| cash (`Transfer - Bank`) | 453,488.37 | **430,813.95** | −22,674.42 = **exactly 5%** |
| tax (2027) | 12,670.99 | **5,868.66** | −6,802.33 = **exactly 30% of the cost** |

Then reverted; dev regenerates byte-identical again.

### Write path — both sites

`replaceModuleSchedules` **and** the create path in `routes/forecast.js`. A field added to one and
not the other is exactly the projection drift [CR073](cr-073-two-recurrence-guards.md) closed after
it happened three times in three days. NULL survives the round trip in both directions, verified
through the live API: 4.5 saved and reopened, then cleared back to NULL.

`normalizeTransfers` carries `CostPct` **only when set**, so an Invest row is unchanged on the wire
and an empty field never becomes 0.

### Gate

876 backend (6 new) · 475 frontend · 8/8 e2e · lint 0 errors · six ratchets · **migration 062 on
dev only — it reaches prod through `deploy-to-production.sh` Step 2b at release.** Dormant, so the
release moves nothing; the numbers move when the owner types a rate, and that edit deserves its own
before/after measurement.

---

## 9. Rates set, 2026-08-09 — and the variant-sync bug it exposed

### The rates (owner decision, by jurisdiction)

| kind | rate | modules |
|---|--:|---|
| Real Estate · USD | **7%** | `US - Nokomis`, `US - Casarina`, `Sarasota House` |
| Real Estate · EUR (Spain) | **6%** | `SP - Panorama Mar 4`, `SP - Panorama Mar 6`, `SP - Sea Senses` |
| Real Estate · PLN (Poland) | **4%** | `PL - Muszlowa`, `PL - Niemena` |
| Business | **2%** | `United Beverages`, `Barkeria`, `New Business` |
| Private Equity · Liability | **NULL** | both CVC funds, `PLN Credit Cards`, `Tax Liabilities` |

The CVC rows are the reason the field is per-row: 2,033,048 of **capital returns**, which are
distributions modelled as disposals and carry no selling cost. Verified untouched after the change.

### ⚠️ The variant sync silently dropped the new column

The first measurement moved **only `2026 Base`**. The four variants were byte-identical — and that
was the finding, not the result.

`syncVariant` reads a module's own COLUMNS from `information_schema` — CR050's deliberate fix for
this exact class, after `copyScenario`'s hand-maintained list omitted `has_valuation`. But a child
TABLE's columns are still **hand-listed** in `SCHEDULE_TABLES`, and migration 062's
`disposal_cost_pct` was not added to them. So the rates were set on Base, all five regenerated, and
**four scenarios silently kept GROSS proceeds on 5.5M of property sales**. Nothing errored.

Fixed in both places it is named — the schedule column list and `interceptSchedules`' patch
builder — and guarded by `variantSchedules.test.js`, which asserts every `SCHEDULE_TABLES` list
against the **live schema** and names the offending column when it drifts. It fails on the
pre-fix code.

**This is migration 057's own warning coming true two years' worth of CRs later.** The lesson it
recorded — *the module columns ride along free, a child table does not* — was written down and
still not enough, because nothing enforced it. Now something does.

### Measured, engine proven idempotent

| scenario | before | after | delta |
|---|--:|--:|--:|
| Base | 4,674,650.12 | **4,071,160.44** | −603,489.68 |
| Buy Business | 9,750,208.47 | **9,102,334.66** | −647,873.81 |
| Downside | 2,574,048.63 | **1,893,368.23** | −680,680.40 |
| Upside | 8,047,179.99 | **7,404,137.78** | −643,042.21 |
| SRQ House Purchase | −596,918.54 | **−1,392,888.55** | −795,970.01 |

**Every scenario falls, which is the whole point** — the plan had been assuming it kept 100% of
every sale. The figures exceed §1's 220,000–500,000 estimate because that counted only the fees:
money not received in 2026 also does not earn for the following 36 years. **SRQ falls most**,
which is coherent — it is the scenario already in shortfall, so cash it never receives is cash the
sweep cannot use.

Mechanism verified per jurisdiction, to the cent: `SP - Panorama Mar 4` 453,488.37 → **426,279.07**
(×0.94), `US - Nokomis` 394,875.00 → **367,233.75** (×0.93), `PL - Niemena` 2,115,200.58 →
**2,030,592.56** (×0.96), `United Beverages` 4,106,205.12 → **4,024,081.01** (×0.98), and both CVC
funds **unchanged**.
---

## 10. The COPY path dropped the same column (2026-08-10, fixed)

§9 fixed `disposal_cost_pct` going missing through the **variant sync**. `copyScenario` enumerates
the same child table's columns in its own hand-maintained list, and never carried it either — so
**every scenario made by COPY silently lost its selling costs and reported the full sale proceeds**.
Two lists, one column added, one list updated.

**It presents as a copy reading *better* than its original**, which is the worst way for this to
show up. It was found only because a scratch copy of `2026 SRQ House Purchase` measured **~890K
better** than the source for no modelled reason — *while being used to measure something else
entirely* (whether `Sarasota House`'s growth rate was an unset field). Trusted, that number would
have argued for a house purchase on the strength of a cost that had quietly gone missing. The
measurement was re-run against prod, where the 7% survives, and the real improvement was **+915,959,
not the ~1.8M the copy implied**.

**The guard does not enumerate columns, because enumerating is what failed twice.**
`repositories/__tests__/copyScenario.columns.test.js` reads each child table's real columns from
`information_schema` and asserts a copy round-trips every one of them — disposals, investments and
amortization — so a column added tomorrow is covered without anyone remembering the file exists.
Every seeded value is distinctive and non-null on purpose: a null fixture passes whether or not the
column is copied, which is precisely how the original omission hid. Falsified against the unfixed
code (`disposal_cost_pct=null` against an expected `7.0000`).

*Same family as [CR064](cr-064-forecast-annual-close-and-assumptions.md) P6's sweep of hand-kept
column lists, and one more instance for [failure-patterns.md](../current/failure-patterns.md).*
