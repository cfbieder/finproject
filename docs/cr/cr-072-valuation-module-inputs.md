# CR072 — the balance-sheet module: form, and the budget year the engine skips — 🟡 IN PROGRESS

Owner-requested restructure of the module editor for **asset and liability (valuation) modules**.
CR070 decided *which* fields a module may show; this decides **how the ones it keeps are arranged,
and what they are worth next to reality**. Income/expense modules get the same treatment in a
follow-up ("when we finish balance sheet inputs we will go back to income and expense for similar").

[Roadmap](../current/project-roadmap.md#cr072) · **Opened:** 2026-08-05 · **Track:** v3 ·
**Migrations:** none · **Targets:** P0+P1 → **v3.16.1 patch** (v3.16.0 regressions, ship first);
P2–P6 → **v3.17.0 minor** · **Depends on:**
[CR070](cr-070-module-inputs-by-type.md) (capabilities; and §3 below is where its residue detector
turns out **not** to apply), [CR069](cr-069-forecast-streams.md) (streams as rows),
[CR064](cr-064-forecast-annual-close-and-assumptions.md) (P9's PeriodStart anchor, which §5/§6
extend), [CR051](cr-051-multi-currency.md) (the Matched ↔ currency coupling §3 trips over).

**Review status: two-pass reviewed 2026-08-05 → REVISE, both passes, and both were right.** Pass 1
killed the safety argument outright (§3); pass 2 carved P0+P1 out as a hotfix. Everything marked ⓘ
below changed as a result.

---

## 1. The organising finding: `is_matched` splits the population perfectly

Measured on prod 2026-08-05, all 110 valuation modules:

| `is_matched` | modules | market ≠ 0 | basis ≠ 0 | base date in the future | has an Invest row |
|---|--:|--:|--:|--:|--:|
| **false** | 20 | **0** | **0** | **20** | 10 |
| **true** | 90 | **90** | **90** | **0** | 19 |

**110 of 110.** Every unmatched module has zero value *and* a base date that has not happened;
every matched one has both values and a valid date. The owner stated the rule and the data is a
clean confirmation of it:

> If Balance Sheet module is not matched (e.g. new item after base year) then this is all not
> relevant (base period, valuation) as these are all 0, value only arises through adding an
> investment below in a future period — only relevant point from the top section is growth and tax
> override.

This is **CR070's rule applied one level deeper**: gate on data the engine and reality already
separate (`is_matched`), never on the type string. It also makes §4's base-date cap free — the 20
modules that would have violated it are exactly the 20 that stop showing a base date at all. **No
migration and no forecast number moves.**

`New Business`, `Business Loan`, `House Morgage` and `Sarasota House` are the four (×5 scenarios).

---

## 2. The target shape

```
BASIC CONFIGURATION      status · notes · name · matched · type · currency · account

VALUATION                                        [matched modules only, except Assumptions]
  ├── Reference value    what the books say at the base date  — READ ONLY
  │      base date (≤ last completed year-end) · balance in LC and USD
  │      [→ Market Value]  [→ Cost Basis]
  ├── Assigned value     what the forecast will use — INPUT, in LC
  │      cost basis · market value      (USD derived, read-only)
  └── Forecast assumptions
         growth (× inflation) · capital-gains tax override      [equal-width]

INCOME & EXPENSES        stream cards
  each card: line · mode · amount · growth · window · tax override
  reference: actual (PeriodStart−2) · budget (PeriodStart−1)
```

An **unmatched** module shows only **Forecast assumptions** under Valuation. Reference and Assigned
disappear, because both are provably zero and the base date is meaningless. Its value arrives
through the **Invest** schedule.

---

## 3. Reference value — one balance, not a 2×2 ⓘ

The request was *"US and LC Market and Cost Basis for the base date"*. **There is no cost-basis data
anywhere in Fin**, which was checked rather than assumed:

- `GET /reports/balance` returns `{name, total, totalUSD, currency}` — **one figure per account**.
- `security_lots` — the lot table CR019 landed the schema for — is **empty (0 rows)**.
- `quicken_securities_staging` holds **7,304 rows and 0 non-null `quicken_cost_basis`**.

So Reference shows the one observed number, in LC and USD, and both copy buttons target it — which
is what the two buttons already do today. The form stops implying there are two figures when there
is one. **Owner decision 2026-08-05.**

A derived "cost basis = sum of historical purchases" was rejected: it is net cash in, not a tax
basis, and partial disposals, returns of capital and transfers all break it. It would look
authoritative while being wrong — the failure mode CR071 exists to prevent.

*If lot-level tracking is ever populated, this block gains a second row and nothing else changes.*

---

## 4. Base date — capped at the last completed year-end

Always 31 December, and never later than the last **completed** one (2025 as of this writing).

The reason is Reference value, not tidiness: `fetchBalanceReportV2('2026-12-31')` returns balances
from the transactions that exist *today* and labels them 2026. A future base date therefore shows
today's balance under a future year's heading — a figure that is wrong and looks precise.

**All 90 matched modules already comply**, so this is forward-looking only: no migration, no
regenerate, nothing moves. The 20 non-compliant modules are the unmatched ones, which no longer
render the control.

---

## 5. Income & expenses — the reference re-anchors on the FORECAST, not the base date

v3.16.0 shipped a three-year reference on each stream card anchored on the module's **base year**.
That is wrong here, and the owner's spec says what it should be: *"for reference we should show the
forecast year 0 (e.g. 2027) − 2 (e.g. 2025) actual value for the Income or Expense line selected as
well as budget for the following year."*

| row | year | why |
|---|---|---|
| actual | **PeriodStart − 2** (2025) | the last **complete** actual year |
| budget | **PeriodStart − 1** (2026) | the current year's plan |
| actual | PeriodStart − 1 (2026), YTD | *retained from v3.16.0* — partial, and labelled so |

Anchoring on the base year gave `Barkeria` (base 2025) *actual 2024 / budget 2025*, which is a year
stale, while a base-2026 module got the right pair by luck. The forecast's own start is the correct
anchor because it is what the first typed amount has to be right for.

**The line-not-module caveat stays** (v3.16.0): the totals belong to the FC line, so any line shared
by more than one module says how many share it. `Property Costs` carries six.

---

## 6. Start year — a LABEL fix, and v3.16.0's label is wrong ⓘ

The owner asked that a stream's start year *"always be the first year of forecast (2027)"*.

**Numerically it already is**, and `fcbuilder-stream.js` says so in its own comment: a valuation
module's axis starts at its `base_date` — 2025 on 90 of 110 — while `computeStreamSeries` skips
every year with `idx = year − periodStart < 0`. Nothing is produced before PeriodStart on any
module.

So this must **not** be implemented by defaulting the control to 2027: a start date is stored as
July 1 and `applyStreamWindow` does `series[i] /= 2` on the first year, which would silently halve
every new stream's opening year. That refusal was already argued and shipped in v3.16.0.

**But v3.16.0's replacement label is itself wrong.** It reads *"— from 2025, this module's first
year —"* on a valuation module, naming the axis start rather than the first year that produces
anything. It should name **PeriodStart on every module**: *"— from 2027, the first forecast year —"*.
Same behaviour, and the label finally agrees with the engine.

---

## 7. ⓘ Why the `is_matched` gate became COLLAPSE, not HIDE — pass 1's blocking finding

§2 originally said Reference and Assigned are *hidden* on an unmatched module, resting on CR070's
residue detector to make that safe. **Pass 1 proved it is not**, on three counts, each verified:

1. **`is_matched` is not an engine branch.** Nothing in `fcbuilder-*` reads it — it is only mapped
   through at `services/forecast/index.js:137`, and `market_value` is booked off `has_valuation`
   alone (`fcbuilder-module.js:143`). CR070's rule is *"a field may disappear only if a VALUE in it
   cannot"* (`fcModulesEditSections.js:278`), and every capability there keys on something the
   engine branches on. `is_matched` does not qualify.
2. **The residue panel would therefore lie, and its Clear button would destroy a live figure.** The
   panel asserts *"the forecast ignores them"* (`FCModulesEdit.jsx:825-828`) and Clear writes `null`
   (`:838-843`). On a module toggled matched → unmatched while holding a market value, both are
   false — one click would zero a number the engine is still reading.
3. **`BaseDate` is invisible to the detector twice over.** It is absent from `FIELD_CAPABILITY`
   (`:358-381`) *and* listed in `RESIDUE_EXEMPT` (`:424-427`) — an exemption justified because
   base_date is unread **on flow modules**, whereas a valuation module's whole axis anchors on it
   (`fcbuilder-module.js:131`).

**So the mechanism is CR064 §4.1's collapse-when-empty, not hiding.** An unmatched module renders
Reference and Assigned **collapsed**, with the section header stating why, and one click expands
them. A collapsed section *cannot conceal a live value* — the value is one click away and no
detector is required. This delivers §2's screen with none of the hazard, and it is why §2 now says
"collapsed" rather than "hidden".

ⓘ **And two things pass 1 found that would have moved money silently:**

- **`is_matched` already switches the USD conversion rate** (`utils/fcModuleFx.js:92-98`: the
  balance-sheet implied ratio when matched, the FX assumption otherwise), and the effect at
  `FCModulesEdit.jsx:507-533` **writes the recomputed USD back into the form on open, with no user
  action**. Had P3 hidden those fields, opening and saving an unmatched valued module would have
  persisted a different number through a control nobody could see — and the regenerate-and-diff gate
  would not catch it, because it only fires when a human opens and saves. **P3 must suspend the
  derivation when the block is collapsed, with a test that open→save leaves the USD byte-identical.**
- **`FIELD_CAPABILITY` maps `Account`, `Growth` and the four value fields to ONE `valuation`
  capability** (`:358-381`). §2 keeps Growth and Account while dropping the values, so the capability
  must be **decomposed** — `valuationValue` (the four figures + base date) split from
  `valuationAssumptions` (growth, gains tax) — with both predicates staying `has_valuation`-only for
  flow modules so CR070's shipped behaviour is unchanged.

---

## 8. ⓘ NEW — the budget year the engine skips (owner-requested, and it MOVES NUMBERS)

> Market value for 2026 (e.g. budget year) should also be calculated as we do not have budgets for
> balance sheet items. This is calculated same as for forecast.

**Confirmed against the engine and the data.** `growthValues[i] = idx >= 0 ? growthPct ×
inflationSeries[idx] : 0` (`fcbuilder-module.js:234`), with `idx = year − PeriodStart`. For
`Barkeria` — base date 2025, PeriodStart 2027 — 2026 has `idx = −1` and therefore **zero growth**.
The Module Output panel shows it plainly: 2025 and 2026 both sit at 3,918,992 and 2027 is
**3,918,992 × 1.02 exactly**. The asset grows **once** across a two-year gap.

The sharpest evidence that this is an off-by-one rather than a policy: **the inflation assumption is
declared for `Year: 2026` at 2.5%**, and the engine applies it first in **2027**. The rate for the
skipped year already exists.

**Rule:** every year after the module's base year grows, including those before PeriodStart. Years
before PeriodStart use `inflationSeries[0]`, since the series begins there and no historical rate is
carried. The base year itself never grows — it is the observed value.

⚠️ **This is the first item in this CR that MOVES FORECAST NUMBERS, so §9's gate INVERTS for it.**
Every matched valuation module gains one compounding year, so market values rise ~2% from 2026
onward and carry through all 36 years. It must be measured on a prod copy with a line-by-line delta
and the owner's sign-off before prod — the CR071 §6 procedure, which is written down and worked.

**Also in scope, and display-only:** the Module Output table shows `—` for the module's P&L line in
2025 and 2026. It should show the **actual** for PeriodStart−2 and the **budget** for PeriodStart−1,
from the same two endpoints §5 uses. That fills the gap the owner is pointing at without inventing a
number: those years are history and plan, not forecast, and the table should say which.

---

## 9. Gate


Every item here is presentation, arrangement or a read-only comparison. **No forecast number may
move**: regenerate all five scenarios before and after on a prod copy and diff the
per-(scenario, account, year) `forecast_entries` sums **to the cent** — the CR069 gate. Anything
that moves a number is a bug in this CR.

Hiding is only safe because of **CR070's residue detector**: any field the form stops rendering
that still holds a value is reported with a Clear button. Unmatched modules hide Reference and
Assigned, so if one ever *does* hold a market value the panel says so rather than the value going
quiet. Confirm the detector covers `BaseValue`/`MarketValue`/`BaseDate` under the new gating before
the gating ships.

---

## 10. Phases

| P | ships as | what | risk |
|---|---|---|---|
| **P0** | v3.16.1 | Start-year label → real PeriodStart, on every module (§6) | fixes a LIVE bug: flow modules read *"from 2023"* today |
| **P1** | v3.16.1 | Re-anchor the stream reference on PeriodStart−2 / −1 (§5) | read-only |
| **P2** | v3.17.0 | `Valuation` section, three sub-blocks; Base Date + Reference move in (§2) | layout |
| **P3** | v3.17.0 | Decompose the `valuation` capability; COLLAPSE (never hide) on unmatched; suspend the USD derivation while collapsed (§7) | **the one with teeth** |
| **P4** | v3.17.0 | Cap the base-date picker at the last completed year-end (§4) | 90/90 already comply |
| **P5** | v3.17.0 | **The budget year grows** (§8) | ⚠️ **MOVES NUMBERS** — inverted gate, prod-copy delta, owner sign-off |
| **P6** | v3.17.0 | Module Output shows actual (PS−2) / budget (PS−1) for the module's P&L line (§8) | display-only |

**P0 and P1 ship first and alone**, as pass 2 required: both are v3.16.0 regressions, one of them
visible on the owner's screen right now, and neither depends on the restructure.

ⓘ **PeriodStart has a silent fallback and P0/P1 both put it on a label.** It is resolved by scenario
**name match** with a fall back to the current year (`FCModulesEdit.jsx:542-551`) — the CR064 P1
failure class, which prod has already paid for once with five dead scenario names. A miss would make
P0 read *"from 2026, the first forecast year"* and P1 fetch *actual 2024 / budget 2025*: wrong, and
confidently labelled. **When PeriodStart does not resolve, render the generic string and fetch
nothing.** Saying nothing beats guessing a year — CR071's own thesis, applied to this CR.

---

## 11. Out of scope / not delivered

- **A cost-basis reference figure** — no data exists anywhere (§3). Revisit if lot tracking is ever
  populated.
- **Income and expense modules** — the owner's stated successor: *"when we finish balance sheet
  inputs we will go back to income and expense for similar."*
- **Unifying the LIST and DETAIL projections** — the defect class behind three bugs in three days
  (`HasValuation`, the sweep fields, `fc_line_name`). Both reviewers asked for it to be numbered; it
  is the recurrence guard for P3 and for the income/expense follow-up, and it is **not** done here.
- **Any number movement other than P5's**, which is deliberate and gated.

---

## 12. Open


- **Point 4's parenthetical** — *"(only applies to assets and liabilities which have no budget)"* is
  read as describing *why* balance-sheet modules need a manually assigned value (they have no budget
  to derive one from), not as a filter selecting a subset. If a narrower set was meant, §2 changes.
- **USD on the Assigned block** — the spec says inputs in LC. USD is kept as a read-only derived
  figure beside each, as today.
- **Income/expense modules** — deliberately out of scope; the owner has said they follow.
