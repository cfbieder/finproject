# CR070 — inputs that fit the module: capability-gated forms, type-led templates — 🟠 REVISED AFTER PASS 1

Every module type asks the same questions today. An Expense module — 50 of prod's 170 — presents
Cost Basis, Cost Basis (USD), Market Value, Market Value (USD), Growth (× inflation), a Capital
Gains Tax Override, a Base Date, Invest, Dispose and a Cash Sweep Priority. The engine reads
**none** of them on that module. The owner's request, verbatim:

> inputs should better match type (e.g. income, expense, real estate, investment, business…).
> This includes all input lines including sweep priority which is only valid for assets, valuation
> and all the input lines, in other words a fully customized input for each type of module.

Plus one interaction change: double-clicking a module should open the edit form directly, not the
read-only drawer that stands between.

[Roadmap](../current/project-roadmap.md#cr070) · **Opened:** 2026-08-05 · **Track:** v3 ·
**Migrations:** none for P0–P4; see §11 · **Depends on:**
[CR069](cr-069-forecast-streams.md) (streams as rows — this CR finishes what P3 started),
[CR064 §4.1/§5](cr-064-forecast-annual-close-and-assumptions.md) (the decision this CR reopens),
[CR062](cr-062-forecast-loan-module.md) (the existing per-type carve-out and its retype discipline),
[CR041](cr-041-module-ownership-gating.md), [CR045](cr-045-cash-sweep-cascade.md),
[CR050](cr-050-forecast-scenario-variants.md).

**Review status:** pass 1 (technical) returned **REVISE** with ten blocking findings. All ten are
addressed below and are marked ⓘ where the correction changed a claim this CR previously made.
Three of those corrections were to statements that were **wrong**, not merely incomplete — §6's
sweep mechanism, §4's "the panel ships empty", and §3's loan predicate. Each is corrected in place
with the evidence, because a design doc that quietly deletes its errors teaches nothing.

---

## 1. The crux — hiding a field does not clear it

CR064 §5 refused per-type forms because *"a hidden field is not a cleared one."* **CR069 P3 answered
that for FLOWS and nothing else.** A stream is a row; removing the card removes the row. The
valuation fields are still **columns**, sent unconditionally by `buildModulePayload`, and still read
by the engine.

Three facts decide the design, all verified in the code:

- **`PUT /modules/:id` treats a missing key as UNCHANGED** — the update object is built entirely
  from `if (body.X !== undefined)` guards
  ([forecast.js:1015-1019](../../server/src/v2/routes/forecast.js#L1015-L1019)). Production relies
  on this: the inline status dropdown PUTs a bare `{ SetupStatus }`.
- **`POST /modules` treats a missing key as ZERO** — `base_value: body.BaseValue ?? 0`,
  `market_value: … ?? 0`, `growth_rate: … ?? 0`
  ([forecast.js:849-855](../../server/src/v2/routes/forecast.js#L849-L855)).
- ⓘ **`POST` also SILENTLY DROPS four fields it accepts.** `MODULE_WRITE_FIELDS` admits
  `CashSweepPriority`, `CashSweepTarget`, `TaxRateOverride` and `SetupStatus`; the POST's
  `moduleData` object contains none of them. They are validated and thrown away with no 400 — the
  exact CR046/CR047 class the allow-list exists to prevent, on the same route. Verified by reading
  `moduleData` at [forecast.js:840-862](../../server/src/v2/routes/forecast.js#L840-L862). This is
  **D7** in §8 and lands in P0.

So a form that stops rendering a control changes nothing about the stored value on **update**, and
zeroes it on **create**. The naive reading of the request — *hide what does not apply* — is
therefore **not cosmetic-but-harmless. It is worse than today**, because `initialOpenSections`
currently collapses an empty section and *cannot* hide a live value, whereas a type gate can.

**This CR's answer is not to hide those fields. It is to make a value in them impossible to hold
silently** (§4).

---

## 2. Evidence — measured on prod 2026-08-05, 170 modules across 5 scenarios

Counts are totals; divide by 5 for per-scenario. "growth set" = non-NULL, **not** non-zero (N1).

| type | n | has_val | market≠0 | basis≠0 | growth set | cap-gains tax | sweep rank | loan rate | secured |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Expense | 50 | 0 | 0 | 0 | 50 (all 0.0000) | 0 | 0 | 0 | 0 |
| Real Estate | 40 | 40 | 35 | 35 | 40 | 0 | 0 | 0 | 0 |
| Business | 20 | 20 | 15 | 15 | 20 | 0 | 0 | 0 | 0 |
| Liability | 15 | 15 | 15 | **15** | 10 | 0 | 0 | 0 | 0 |
| Private Equity | 10 | 10 | 10 | 10 | 10 | 0 | 0 | 0 | 0 |
| Income | 10 | 0 | 0 | 0 | 10 (all 0.0000) | 0 | 0 | 0 | 0 |
| Stocks | 10 | 10 | 10 | 10 | 10 | 0 | **5** | 0 | 0 |
| Loan | 10 | 10 | **0** | 0 | 10 | 0 | 0 | **5** | 10 |
| Fixed Income | 5 | 5 | 5 | 5 | 5 | 0 | **5** | 0 | 0 |

`base_date` is **set on all 60 flow modules** (Expense 50/50, Income 10/10) — the fact §4 previously
overlooked.

Six things follow:

1. **`has_valuation` already splits the population exactly along the line the owner is describing**
   — 60 flow modules against 110 valued ones — and it is an engine branch
   ([fcbuilder-module.js:142-143, 230](../../server/src/services/forecast/fcbuilder-module.js#L142-L143)),
   not decoration.
2. **The Capital Gains Tax Override is unused on all 170 modules.**
3. **Sweep rank is held by exactly two modules per scenario**, both liquid. The control is offered
   on all 170.
4. **`growth_rate` is set on all 60 flow modules and ignored by the engine.** Harmless only because
   every value is `0.0000`.
5. **Loan carries no market value on any of the 10**, while its form asks for "Outstanding Today".
6. **`House Morgage` is typed `Loan` with `loan_interest_rate` NULL in all five scenarios** —
   500,000 principal, 19 amortization rows, secured, no rate. The engine's loan branch is
   `loanRate != null`, so it produces no debt and no interest; the loan warning set bails on the
   same condition. **A data defect in the owner's forecast** (§9 R3) — and see §3, because the
   naive form of this CR's own rule would make it unfixable.

---

## 3. What "customized per type" can and cannot mean

ⓘ **Corrected after pass 1.** This CR previously said CR062 gates *"on the data the engine branches
on, never on the type string."* Its own citation is a **union**:

```js
export const isLoanModule = (form) =>
  String(form?.Type || "").trim().toLowerCase() === "loan" ||
  form?.LoanInterestRate != null;
```

That union is load-bearing. `House Morgage` reaches `LOAN_FIELD_SECTIONS` **only through the type
string**, and that section is the only place the `LoanInterestRate` input exists. A data-only rule
would remove the one field that can repair §2 finding 6. **The rule is therefore: gate on
`type ∪ data`, never on type alone** — the type may only ever *widen* what is shown.

| type | data signal the ENGINE branches on | fields may be gated? |
|---|---|---|
| Loan | `loan_interest_rate != null` (∪ type) | **yes** — already is |
| Expense | `has_valuation = false` + all streams `expense` | **yes** |
| Income | `has_valuation = false` + all streams `income` | **yes** |
| Liability | `has_valuation = true` + `market_value < 0` | **yes**, with §5's caveat |
| Real Estate / Business / Stocks / Fixed Income / Private Equity | — | **no** |

ⓘ **Also corrected:** this CR previously claimed "no schema change *creates* one" for the last five.
That is refutable in one grep — `has_valuation` is precisely such a signal, added by migration 058.
The honest claim is a **scope decision**: no signal exists today, and inventing four more columns
whose only purpose is to let a form hide fields is not worth it, because the engine genuinely treats
those five types identically.

**Three rules:**

- **Tier A — gate on `type ∪ data`.** Loan, Expense, Income, Liability.
- **Tier B — type may ADD, never hide.** Real Estate, Business, Stocks, Fixed Income, Private
  Equity. Type supplies creation defaults, labels and warnings; a wrong or renamed type costs a
  default and a noun, never a value.
- **Tier C — nothing may hide a field for a Tier-B type.**

---

## 4. Residue: a data-keyed detector first, a form panel second

ⓘ **Rewritten after pass 1, which falsified the original claim.** This CR said the residue panel
"is empty on all 170 modules, so this ships invisible." **It is not.** §5 removes Base Date from
Expense/Income and Cost Basis from Liability, and prod carries `base_date` on all 60 flow modules
and `base_value ≠ 0` on all 15 Liability modules — so the panel would open **loud on 75 of 170
(44%) on the first render**, contradicting this CR's own §2 table.

Worse, a form panel is **the wrong shape for the hazard**. It renders only when the owner opens a
module, and every writer in §9 R2 is precisely a writer that puts a value in a field nobody typed.
The decisive case:

`refreshModulesFromActuals` ([crud.js:54-74](../../server/src/services/forecast/crud.js#L54-L74))
is one set-based `UPDATE` of `base_value`, `base_value_usd` and `base_date`, keyed on
`scenario_id` and `account_id` with **no `has_valuation` filter** (verified). `copyScenario(…,
refreshFromActuals)` is how **CR064 P2's annual close mints each January's base** — so next
January, 60 flow modules acquire exactly the three fields §5 hides, in one transaction, into a
scenario nobody has opened.

**The revised mechanism, in two parts:**

1. **Primary — a data-keyed residue rule in `fcWarnings.js`.** A module carrying a value in a field
   its capabilities do not read produces a warning on the modules **table**, without anyone opening
   anything. This is the same file §9 puts R1/R3/R5/R6/R7 in, and a warning cannot hide a value.
   **`refreshModulesFromActuals` must also gain the `has_valuation` filter it lacks** — the
   detector explains the residue; the filter stops manufacturing it.
2. **Secondary — the form panel is the remediation UI.** *"Still set — not used by this module"*,
   open by default, each field with its value and a **Clear** button. It is where the owner acts on
   what the warning told them.

**Exemptions, stated rather than assumed** (this is the "pick one" pass 1 demanded): `base_date` on
a flow module is **exempt** — it is set on all 60, the engine provably does not read it there
(CR069 Decision 6 pins every stream to `PeriodStart − 1`), and surfacing 60 warnings for a field
that cannot affect a number is how a warning channel gets ignored. It is hidden without residue,
and that exemption is recorded here so the next reader knows the rule has exactly one hole and why.
`base_value` on a Liability is **not** exempt — see §5.

**Clear semantics, which the first draft did not define (S2):** a logical module is 5 rows.
**Clear operates on the scenario being edited only.** In a variant it writes the cleared value as
an override, except where the base already holds the same value, in which case `pruneOverride`
deletes the key and the result is a visible no-op — so Clear in a variant must report *"already
clear on the base"* rather than appearing to do nothing. **Clear-all does not cascade across
scenarios.**

**`capabilitiesFor` reads the LOADED row, not `editForm` (S4)** — recomputed on save. Reading the
live form makes Cost Basis and Growth vanish from a new Liability the instant a minus sign is
typed into Market Value, and reappear when it is deleted.

**The one confirm** is flipping `has_valuation`, because it changes what the engine reads. It must
refuse while the module has Invest/Dispose rows, a sweep rank, or is another module's
`secured_asset_module_id` — and ⓘ **flipping it ON must also require a Base Date** (S6): the
valuation series takes `new Date(module.BaseDate).getFullYear()`, so a module created as a flow type
(Base Date pruned to NULL) and later flipped on yields `new Date(null)` ⇒ **1970**, a ~92-element
series starting 56 years early, silently.

**Type change alone destroys nothing, ever.** CR062's preview-and-delete stays where it is and is
not generalized: retyping *to a loan* is different because the **server** deletes rows.

---

## 5. Per-type input sets

**Tier A — fields genuinely removed:**

- **Expense / Income** — remove the Valuation section, the Capital Gains Tax Override, Base Date
  (exempt from residue per §4) and Sweep Priority. Keep identity, Matched, and the stream cards.
  Add nothing.
- **Liability** — keep Market Value (negative). Remove Growth (0 on all 15) and the Capital Gains
  Tax Override. Remove Sweep Priority (§6). **Do not add an interest rate** — a liability with a
  rate is a Loan, and adding one creates an engine-invisible second interest path.

  ⓘ **Cost Basis is NOT removed.** The first draft removed it as "0 by construction". Pass 1
  falsified the reasoning and found a money hole: **2 of 3 Liability modules per scenario carry a
  disposal** (`PLN Credit Cards`, `Tax Liabilities`), and the realized gain is
  `-dispose + dispose × prevBase / prevMarket` — zero **only while basis equals market**. Nothing
  enforces that; "by construction" is an observation. Hiding Cost Basis while Market Value stays
  editable means one keystroke books a **taxed phantom gain on a credit-card payoff**, silently,
  for 36 years. And Clear would make it worse: it writes `base_value = 0` while `base_value_usd`
  keeps `−27,186.62`, and because the section is hidden the USD re-derivation effect does not run —
  so the two columns disagree and CR064 P13's guard **throws** on the next generate. Instead:
  Cost Basis stays, and `fcWarnings` gains a **`base_value = market_value` invariant check** on
  liabilities.
- **Loan** — `LOAN_FIELD_SECTIONS` is already right. Remove the Capital Gains Tax Override it still
  renders. Warn on the type/data disagreement (§9 R3).

**Tier B — nothing hidden; type supplies defaults, labels and warnings:**

- **Real Estate** — creation seeds a `pct_of_value` carry-cost card and an `amount` rent card.
  Measured: **Real Estate has 30 expense streams and 0 income streams**, while prod's actuals carry
  `Rental - Spain` **+31,306** unmapped and the SP modules carry `Property Costs` only. Nothing
  structural is missing — the stream card already does it — but the form never asks. *(This
  corrects CR066's working assumption that `Rental - Spain` is already modelled by the SP modules.
  It is not.)*
- **Business** — creation seeds an income card only (0 of 20 has an expense stream). Prompt the
  stream's income-tax override rather than leaving it blank on a foreign-currency income stream
  (§9 R1).
- **Stocks / Fixed Income** — creation seeds one `yield` income card. Both are modelled correctly
  today; the split of appreciation from yield is the commonest double-count in personal planning
  and Fin does not commit it.
- **Private Equity** — labels already correct. One new field proposed: **total commitment**, so
  `unfunded = commitment − Σ Invest` can be shown and warned against ranked sweep capacity.

ⓘ **A seeded card the owner never fills must be DROPPED on save (S8).** `buildModulePayload` maps
every card unconditionally, so an untouched seeded card would persist as a live zero-amount stream
row with an `fc_line_id` — the present-and-zero state CR069 P3 spent a migration eliminating.

**Deliberately not proposed:** depreciation schedules, §1031, §121, land/building splits, monthly
rent, lot-level basis in an annual model, an "exit multiple" input, a nominal-vs-real spread toggle,
or a tenth type.

---

## 6. Cash sweep — corrected mechanism, and the enforcement layer

ⓘ **This section's original mechanism was FALSE and is corrected in full.** It claimed *"the cascade
reads the balance as an absolute, so a ranked credit card presents its debt as sellable assets."*
There is **no `Math.abs` on any balance** in `cash-sweep.js`, and capacity is clamped:

```js
return Math.max(0, capacityNorm * (src.growthFactorByYear[year] ?? 1));   // cash-sweep.js:196
```

A negative balance gives a negative floor and therefore **zero** capacity: a ranked liability drains
nothing. The claim came from the comment at
[forecast.js:163-168](../../server/src/v2/routes/forecast.js#L163-L168), **which is itself wrong**
and survived CR062 unchallenged. *This CR repeated a plausible comment as a verified fact; that is
the failure mode this project's own rule about verifying before recommending exists to prevent.*
**Correcting that comment is part of this CR** — a false comment is a fact CI cannot check.

**The guard is still right, on the real failure modes:**

- **As priority 1 the module is the DEPOSIT target.** `if (runningCash > cashSweepHigh && primary)`
  writes excess cash into it unconditionally — a P&L account (flow module) or a debt account
  absorbs unlimited deposits with no balance series to bound it.
- **A ranked, zero-capacity source inverts CR045 §5's semantics.** "Ranked" means "I can sell
  this"; the engine reports a shortfall while listing a source that can never contribute.

**The rule:** a module may be ranked iff `has_valuation = true` **and** `market_value > 0`.

**Where it lives — this is an open question for the owner (§14 Q4), because pass 1 showed both
naive placements fail.** Route-level validation is bypassed by every writer §9 R2 names
(`syncVariant` writes raw SQL, `copyScenario` derives its columns from `information_schema`,
`refreshModulesFromActuals` is one `UPDATE`, AI Review calls the repository directly). A DB CHECK
constraint needs a migration — contradicting §11 — and would **throw mid-build** during variant
sync, because `has_valuation`, `market_value` and `cash_sweep_priority` are all overridable and
sync runs unconditionally at the top of a variant's build. That is exactly the outcome
`resolveSweepFlags` was written to avoid for the unique index: *"Derive it, rather than letting the
index throw mid-build."*

**Recommendation: route validator + a derivation arm in `resolveSweepFlags`** that resolves
`cash_sweep_priority = null` when the resolved row fails the eligibility test — the same shape as
the displacement rule it already implements, covering sync and the annual close, with no migration.

Neither condition fires on today's data (ranks are held only by Stocks and Fixed Income), so this is
hazard-closing rather than behaviour-changing. **It must not make it harder to rank
`Fidelity Stocks` in `2026 Downside`**, which is an open owner request.

---

## 7. The small change — double-click straight to edit, and the drawer goes

Double-click currently opens a read-only drawer whose Edit button then opens the form. The owner
wants the form.

**Delete the drawer rather than re-point it**, because it is not a lesser view — it is a stale one.
Read against the list payload that feeds it, **six of its rows can never render a value**:
`Exp Category` (exists nowhere outside test helpers), `Yield Spread` and `Yield Spread Entries`
(yield is a stream *mode* since CR069), `Invest` and `Dispose` (only on `GET /modules/:id`), and
`Growth` (the list sends `GrowthRate`, and the drawer labels a *multiplier* with `%`). It shows
`Cost Basis 0.00` / `Market Value 0.00` on all 60 flow modules — readable as a real zero valuation —
and it shows **no streams**, which is most of what a module now is. The owner's own screenshot shows
exactly this: `EXP CATEGORY -`, `YIELD SPREAD -`, `COST BASIS 0.00`, `MARKET VALUE 0.00`.

Nothing is lost: **View Output** in the edit footer is the read that matters (what the module
*books*), and Cancel is already non-destructive.

Also in this change: rows are not keyboard reachable (add `tabIndex`, Enter → edit, focus ring); the
inline status `<select>` stops `click` but not `dblclick`, so a stray double-click there would
otherwise yank the owner into the edit form mid-dropdown; and the drawer's helpers must be deleted
with it or the blocking lint gate fails.

This **reverses a decision recorded in the code** — *"looking at a module no longer drops you
straight into an editable form"* — and says so: what changed is that the read view stopped being
able to describe a module.

---

## 8. Live defects — fix regardless of what else ships

| # | Defect | Severity |
|---|---|---|
| **D1** | **"Create module from unmatched item" is broken in production.** [FCModuleManage.jsx:594](../../frontend/src/pages/FCModuleManage.jsx#L594) posts `IncomePct: []`; CR069 P3 removed it from `MODULE_WRITE_FIELDS`, so the route 400s. The catch logs to `console.error` — **no user-visible error**; the button does nothing. | **High — a CR069 P3 regression shipped in v3.14.1** |
| **D2** | **No UI path can create a flow module.** `HasValuation` is accepted by both routes but `buildModulePayload` never sends it. ⓘ **The fix's DIRECTION is the risk:** `editForm.HasValuation` is `undefined` on the create path (`handleCreateNewModule` seeds 12 keys without it, and `GET /modules/:id` does not project it — only the list does). A naive `Boolean(editForm.HasValuation)` would create **every** new Real Estate/Business/Stocks module as a flow module, whose streams CR041's gate then zeroes — a new $2M property booking nothing, forever, with no error. Required: **absent ⇒ `true`**, mirroring the route; add `HasValuation` to `GET /modules/:id`; set it explicitly in `handleCreateNewModule`. | **High — blocks §5** |
| **D3** | **Nothing can be retyped TO Expense or Income**, and 3 of the 10 offered types (`Asset`, `Deposit`, `Bond`) have zero modules. `appdata.moduleTypes` does not exist on prod, so the hardcoded fallback is always used. ⓘ **Severity corrected down:** the picker *does* append the current value as an option, so the 60 existing flow modules render their own type correctly. | Medium |
| **D4** | `PATCH /modules/bulk-update` writes five valuation columns with no `assertAllowedFields`, no numeric validation, and **zero frontend callers**. Delete it. | Medium |
| **D5** | AI Review's apply path writes `growth_rate` and `tax_rate_override` to any module by id — one LLM click can place a value into a field the form would not show. | Medium |
| **D6** | ⓘ **Moved to §14 Q1** — it is a deferred decision, not a defect, and listing it here contradicted this table's own heading. | — |
| **D7** | ⓘ **New (§1).** `POST /modules` accepts `CashSweepPriority`, `CashSweepTarget`, `TaxRateOverride` and `SetupStatus` and **silently drops all four** — no 400, no write. The CR046/CR047 class, on the route whose allow-list exists to prevent it. | Medium |

**D1, D2, D3 and D7 are prerequisites, not extras.**

---

## 9. Modelling risks this surface permits

- **R1 — income already taxed at source.** A foreign-currency income stream with no tax override is
  taxed at the scenario rate inside the model, while the project's own note records that United
  Beverages' dividend is *net of Polish tax*. Unset on all 145 streams. Needs no new field — only a
  form that refuses to leave it blank.
- **R2 — writers that bypass the form.** AI Review, `bulk-update`, `refreshModulesFromActuals`, the
  loan retype path, `copyScenario` and variant sync. `copyScenario` derives its column list from
  `information_schema`, so it faithfully replicates any stale value — **including into CR064 P2's
  annual close** (§4).
- **R3 — type/data disagreement** (`House Morgage`). The remedy is a warning keyed on the
  disagreement itself; the general form (*type says X, data says not-X*) is what makes Tier B
  tolerable.
- **R4 — disposals book gross proceeds.** No selling-cost input on any of prod's 21 disposals.
- **R5 — basis equals market value on 5 of 8 Real Estate modules**, so Full disposals realize zero
  gain and zero tax. (Same invariant §5 now checks on liabilities, from the other direction.)
- **R6 — orphaned flows.** `fc_line_id` NULL on `Sarasota House` (−45,000/yr × 21 years) and three
  others: cash moves, no P&L line. CR069 §13 found this; still open.
- **R7 — `Tax Liabilities` carries a Full disposal dated in the base year**, which is not a forecast
  year, so the payoff never happens and nothing says so.

`fcWarnings.js` is the home for R1, R3, R5, R6, R7 **and the §4 residue rule**.

---

## 10. Phasing

ⓘ **Reordered after pass 1**, which found P3's own justification ("guards must land before or with
the client gating") contradicted by the table putting it after P2.

| phase | contents | why here |
|---|---|---|
| **P0** | D1, D2, D3, D7; delete `bulk-update` (D4); constrain AI Review's writable fields (D5); correct the false comment at `forecast.js:167`. | Live defects and two-line writer fixes. D5 in particular must precede any hiding, or one LLM click writes an invisible value. Independently shippable — depends on none of the contested design. |
| **P1** | Double-click → edit; delete the drawer; row keyboard access; `stopPropagation` on the status cell. | Owner-requested, no data risk. |
| **P2** | The `fcWarnings` residue rule + the `has_valuation` filter on `refreshModulesFromActuals`. | The detector must exist **before** anything is hidden. |
| **P3** | The capability map + the form residue panel + payload symmetry + the `has_valuation` flip confirm. | Where the owner sees valuation and sweep leave their Expense modules. |
| **P4** | Sweep eligibility (§6) — route validator + `resolveSweepFlags` derivation, pending §14 Q4. | |
| **P5** | Tier-B creation defaults and labels; `fcWarnings` R1/R3/R5/R6/R7. | Where per-type customization earns most and risks least. |
| **P6** *(owner call)* | R4 selling cost; PE commitment; the §14 Q1 decision. | Genuinely new inputs; needs a migration. |

---

## 11. Migrations

**None for P0–P5.** `has_valuation` exists, is written by both routes, and is in the variant
override field list. **P6's two new fields would need one** — which is part of why P6 is separated
and owner-gated. If §14 Q4 resolves to a DB CHECK constraint, P4 also needs one, plus a
fresh-DB-clean backfill of any violating row.

---

## 12. Test plan

ⓘ **Leads with the gate pass 1 found missing.** CR069 shipped four phases each gated on
**per-(scenario, account, year) `forecast_entries` sums identical to the cent** — 4,030 rows, 0
differing, on a prod copy. CR070 touches the same write path and the same columns and adds a Clear
button that writes into engine-read columns. **Gate 0: regenerate all five scenarios before and
after on a prod copy and diff the sums**, using the script CR069 already used. Round-trip row
equality does not catch §5's phantom gain, §4's annual-close residue, or the P13 throw.

The existing guard against the silently-dropped-field class iterates `FIELD_SECTIONS` flat — and
ⓘ there are already **two** such tests (`FIELD_SECTIONS` and, since CR062, `LOAN_FIELD_SECTIONS`),
so "add a set, add a test" has already been repeated once. **Parameterise it over every capability
combination before writing any form code.**

Then:

1. **Round-trip preservation** per capability combination — load a module with a value in every
   would-be-hidden field, save untouched, assert the row is byte-identical.
2. **POST/PUT asymmetry** — a pruned create must not write `0`; and D7's four fields must either be
   written or rejected, never silently dropped.
3. **Residue detection** — the `fcWarnings` rule fires **without opening the form**, and
   specifically after a `copyScenario(…, refreshFromActuals)`, which is the annual-close path.
4. **Variant override survival** — ⓘ pass 1 correctly noted prod's only module overrides sit on
   `United Beverages`, a **Tier-B** type where nothing is hidden, so no prod override is at risk
   today and this CR's earlier claim that three were is withdrawn. The test needs a **synthetic
   Tier-A fixture**, which Known Issue #12 requires anyway.
5. **Clear semantics** — on a base, and in a variant where the base already holds the value
   (the `pruneOverride` no-op), and the paired local+USD write.
6. **Type-rename resilience** — rename Type to an unknown string; the form must fall back to the
   **full** field set and clear nothing. Include the `House Morgage` shape (type says Loan, rate
   NULL) and assert the Loan form still appears.
7. **Sweep guards** — both refusals, a rank surviving a retype, and a variant sync that does **not**
   throw when the resolved row is ineligible.
8. **`has_valuation` flip ON without a Base Date** must be refused, not produce a 1970 series.
9. **USD re-derivation** — the recompute effect runs regardless of whether Valuation is rendered;
   gate it on the section and test it, because CR064 P13's guard throws when the two columns
   disagree.
10. **P0 has its own tests** — ⓘ D1's real defect is the swallowed error, so assert the button
    **surfaces a failure**, not merely that the payload shape is right.

Changing: `fcModulesEditSections.test.jsx`, `fcModulesSectionCollapse.test.js`,
`forecast.write-validation.test.js`, `forecast.loan.test.js`, `forecastVariants.test.js`,
`e2e/write-paths.spec.js`.

Six ratchets at baseline. `check-dead-tokens` has a **zero** baseline; `FCModulesEdit.jsx` and
`FCModulesTable.jsx` are both at **0** in the inline-hex baseline; `capabilitiesFor()` must be pure
derivation (`useMemo`), not an effect calling `setEditForm`, or it moves the lint-debt ratchet,
which may only shrink. P1 removes a `Modal` call site (fine — the modal ratchet may shrink); the
residue panel must not become a new one.

---

## 13. Explicitly out of scope

- **Mobile.** `/forecast-modules` has no `DESKTOP_TO_MOBILE` entry, so a phone is redirected to `/m`
  by design. The constraint that matters is a 900–1200px desktop window.
- **Per-type field hiding for the five Tier-B types** (§3).
- **A fifth stream mode.** A PE distribution is return of capital plus gain; the `Dispose` schedule
  already does both.
- **Nine preview endpoints.** The `fcWarnings` rule plus the form panel replace them.

---

## 14. Open questions for the owner

1. **Should a yield-mode stream's typed amount keep generating base-year deferred tax?** It is
   invisible in the UI (the card hides Amount in yield mode) and live in the engine. Prod carries
   three: CVC Fund VIII 25,800, Fidelity Fixed Income 46,000, Fidelity Stocks 40,000 — roughly
   $33.5K of Period-1 tax per scenario. **This is pre-existing and was preserved deliberately**:
   the old builder taxed them and CR069's equivalence gate required matching it, which
   [fcbuilder-module.js:450-461](../../server/src/services/forecast/fcbuilder-module.js#L450-L461)
   states in writing. CR069 §6.1 deferred whether it is *right*. Changing it moves forecast numbers.
2. **CVC Fund VIII** carries 3.75% NAV growth **and** a 4.0% yield **and** 300K of scheduled
   distributions. One of them double-counts ≈158K over seven years depending on which was meant.
   The form gives no way to say which — that ambiguity is the defect, not either input.
3. **P6** — are the selling cost and the PE commitment worth a migration?
4. **Where does the sweep eligibility rule live?** (a) route validator only — cheap, no migration,
   but every writer in §9 R2 bypasses it; (b) route validator **+ a derivation arm in
   `resolveSweepFlags`** — covers sync and the annual close, still no migration; (c) DB CHECK + (b)
   — strongest, needs a migration and a backfill, and risks throwing mid-build.
   **Recommendation: (b)** — the only option matching this CR's stated rationale without reopening
   §11, and it reuses the pattern CR050 already chose over a throwing constraint for the identical
   problem.
