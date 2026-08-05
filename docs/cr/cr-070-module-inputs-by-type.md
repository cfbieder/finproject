# CR070 — inputs that fit the module: capability-gated forms, type-led templates — ✅ COMPLETE (v3.15.0)

Every module type asks the same questions today. An Expense module — 50 of prod's 170 — presents
Cost Basis, Cost Basis (USD), Market Value, Market Value (USD), Growth (× inflation), a Capital
Gains Tax Override, a Base Date, Invest, Dispose and a Cash Sweep Priority. The engine reads
**none** of them on that module. The owner's request, verbatim:

> inputs should better match type (e.g. income, expense, real estate, investment, business…).
> This includes all input lines including sweep priority which is only valid for assets, valuation
> and all the input lines, in other words a fully customized input for each type of module.

Plus one interaction change: double-clicking a module should open the edit form directly, not the
read-only drawer that stands between.

[Roadmap](../current/project-roadmap.md#cr070)  <!-- anchor added to the roadmap in the same commit --> · **Opened:** 2026-08-05 · **Track:** v3 ·
**Migrations:** none for P0–P4; see §11 · **Depends on:**
[CR069](cr-069-forecast-streams.md) (streams as rows — this CR finishes what P3 started),
[CR064 §4.1/§5](cr-064-forecast-annual-close-and-assumptions.md) (the decision this CR reopens),
[CR062](cr-062-forecast-loan-module.md) (the existing per-type carve-out and its retype discipline),
[CR041](cr-041-module-ownership-gating.md), [CR045](cr-045-cash-sweep-cascade.md),
[CR050](cr-050-forecast-scenario-variants.md).

**Review status:** **pass 1 (technical) → REVISE**, ten blocking findings, all addressed and marked ⓘ
where a claim changed. Three were claims that were **wrong** — §6's sweep mechanism, §4's "the panel
ships empty", §3's loan predicate — corrected in place with evidence, because a design doc that
quietly deletes its errors teaches nothing.

**Pass 2 (PM sign-off) → REVISE**, on scope rather than engineering: *"this is a live-prod hotfix, a
forms CR, and a wrong-numbers CR bundled behind one design debate."* Acted on:

- **D1 + D2 leave this CR** — they are CR069 P3 regressions in a release less than a day old and are
  recommended as a **v3.14.2 hotfix**, not queued behind a design debate (§8).
- **§9's modelling risks and two of the open questions leave this CR** → **[CR071](cr-071-forecast-numbers-vs-intent.md)**.
  Different payoff (wrong numbers vs. wrong form), different urgency, different owner questions.
- **P6 is cut** to the roadmap. **§14 Q3 and Q4 are cut** — Q4 was never the owner's question; it is
  decided here (§6).
- **A question the owner must actually answer is added as Q0**, because pass 2 was right that this CR
  buried its central trade in an out-of-scope bullet.

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

ⓘ **And the trade must be stated here, not buried in §13.** "Fully customized" is delivered for
**four types of nine — 85 modules of 170**. Expense, Income, Liability and Loan get genuinely
different field sets. Real Estate, Business, Stocks, Fixed Income and Private Equity keep a
**byte-identical form to each other**; what they get is seeded stream cards, per-type labels and
warnings. §3 gives the engineering reason. **§14 Q0 asks the owner to accept it** — because an
owner who opens a Real Estate module and finds the same nine fields as a Stocks module will say
this was not done, and on the words they will be right.

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

### ⓘ OWNER DECISION 2026-08-05 — Tier B hides too, once the detector can see it

Asked to accept "four types of nine" (§14 Q0), the owner chose to **customize all nine**. That is
buildable, and the reason is that this CR's own §4 changes the premise CR064 §5 was decided under:

> §5 refused per-type forms because *a hidden field is not a cleared one*. A **data-keyed residue
> detector** answers that for **any** hiding rule — including one keyed on the free-text type.
> A renamed type would hide fields, and the detector would report them as still-set. The risk
> stops being **silent**, which is the only property that made it unacceptable.

**What changes, precisely:**

1. **P2's detector must be generalized.** As first drafted it flags a field the *engine* does not
   read for this module (capability-based). Tier-B hiding needs the broader rule: **any field the
   FORM does not render for this module, holding a value** — which is literally what CR064 §5
   demanded. Engine-unread is then a subset.
2. **Tier B hides only what a type DEMONSTRABLY never uses**, measured on real data, never
   assumed. The evidence exists: Stocks uses `Invest`/`Dispose` on **0 of 10**; Business has an
   expense stream on **0 of 20** (CR064 §5 measured 0 of 18 independently); Real Estate has an
   income stream on **0 of 40**. A field with any live use anywhere is not hidden.
3. **Tier C is withdrawn.** Tier B may hide, subject to (1) and (2).
4. **Order is now load-bearing:** P2 (generalized detector) **must** ship before P3, and P3 before
   any Tier-B hiding. Hiding without the detector is the CR064 §5 failure, exactly.

**What does NOT change:** the *gate* still keys on `type ∪ data` and the type may only ever
**widen** what is shown (§3's `House Morgage` case is unaffected). Nothing is cleared without an
explicit Clear. The five Tier-B types get no *data* signal — they never will — so their hiding is
justified by **measured non-use plus a detector**, not by a claim the engine can distinguish them.

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

ⓘ **Pass 2 correctly deflated the urgency of this, and the correction matters.** That residue is
**inert to the engine**: `fcbuilder-module.js:142-143, 230` reads `hasValuation ? (module.X ?? 0)
  : 0` for base value, market value and growth, so a flow module's stored values are never read.
It is a **latent** hazard, not a wrong number — and it detonates only if `has_valuation` is later
flipped ON, which is a capability **this CR introduces**. So the detector is still required, and
it is required *by P3*, not by the calendar. ⓘ **The one-line `has_valuation` filter on
`refreshModulesFromActuals` moves to CR064 P2**, which owns that `UPDATE` and has the deadline —
two threads editing one statement on a shared trunk is the collision this project has paid for
four times (Known Issue #17).

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

ⓘ **Clear needs a preview and an undo (pass 2 blocker 7).** It writes into engine-read columns and
there is a **Clear all**. Before writing, it shows exactly which fields and values will be cleared
on which scenario; after writing, Cancel still reverts, and once saved the audit trail records the
prior values. CR062 required preview-and-confirm for a smaller destructive act.

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

ⓘ **Where it lives — DECIDED HERE, not asked of the owner.** Pass 2 was right that arbitrating a
route validator against a DB CHECK is not the owner's job. Pass 1 showed both naive placements fail: Route-level validation is bypassed by every writer §9 R2 names
(`syncVariant` writes raw SQL, `copyScenario` derives its columns from `information_schema`,
`refreshModulesFromActuals` is one `UPDATE`, AI Review calls the repository directly). A DB CHECK
constraint needs a migration — contradicting §11 — and would **throw mid-build** during variant
sync, because `has_valuation`, `market_value` and `cash_sweep_priority` are all overridable and
sync runs unconditionally at the top of a variant's build. That is exactly the outcome
`resolveSweepFlags` was written to avoid for the unique index: *"Derive it, rather than letting the
index throw mid-build."*

**Decision: route validator + a derivation arm in `resolveSweepFlags`** that resolves
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
| **D8** | ⓘ **New 2026-08-05, found while setting a loan's rate.** `clearForLoanRetype` **returns early when there is nothing to clear** (`if (before.total === 0) return before;`), so giving a module a `loan_interest_rate` does **not** normalize its stream to `derived` — the normalization lives *after* that guard. `House Morgage` therefore sat typed Loan, with a rate once set, and an `expense`/**`amount`** stream that the loan's derived interest could never post to. The form and the engine disagreeing about what a module *is* — this CR's own subject, inside the one carve-out that already exists. Fix: normalize the stream whenever a module becomes a loan, whether or not anything needed clearing. | Medium |
| **D9** | ⓘ **New 2026-08-05.** A module carrying complete, valid loan assumptions can be **silently absent from every forecast** because `setup_status = 'new'` excludes it (`COALESCE(m.setup_status,'new') NOT IN ('new','exclude')`, four query sites). Nothing on the modules table distinguishes "configured and excluded" from "configured and live" — the SWEEP badge has an equivalent, a status column does not. Measured: activating `House Morgage` adds **−500,000 of debt from the 2028 draw and −315,000 of interest** (−437,500 in Buy Business) to a plan that currently finances the purchase with cash. **Belongs to [CR071](cr-071-forecast-numbers-vs-intent.md)** as a warning (*"configured but excluded from the forecast"*), not to CR070 — it is a wrong number, not a wrong form. | Medium |
| **D7** | ⓘ **New (§1).** `POST /modules` accepts `CashSweepPriority`, `CashSweepTarget`, `TaxRateOverride` and `SetupStatus` and **silently drops all four** — no 400, no write. The CR046/CR047 class, on the route whose allow-list exists to prevent it. | Medium |

ⓘ **D1 and D2 LEAVE this CR (pass 2 blocker 1).** They are CR069 P3 regressions in a release less
than a day old — a button that silently does nothing, and no UI path that can create the two
commonest module types. They are recommended as a **v3.14.2 hotfix, shipped on its own**, not
queued behind this design debate. CR069 is COMPLETED so they cannot go back into it; they ship
under its tail and are recorded in its as-built.

**D3, D4, D5 and D7 remain here as P0** — route hygiene, not urgent, but D5 in particular must
land before anything is hidden.

---

## 9. Modelling risks — MOVED TO [CR071](cr-071-forecast-numbers-vs-intent.md)

ⓘ **Pass 2 blocker 2.** R1–R7 and the two questions about the owner's own numbers are about the
**data being wrong**, not the input surface being wrong. Different payoff, different urgency,
different owner questions — and sharing `fcWarnings.js` is not a scope argument. They are now
[CR071](cr-071-forecast-numbers-vs-intent.md), which pass 2 ranks **above this CR** for owner value:
`House Morgage`'s invisible 500,000 of debt, CVC Fund VIII's ≈158K double-count, and
`Sarasota House`'s −45,000 × 21 years off the P&L all decay with time, and none of them is a form.

What stays here is only what the *form* must do: the §4 residue rule (which is this CR's own
mechanism), and the `base_value = market_value` invariant check §5 requires on liabilities.

**One writer-hazard stays too, because it constrains this design:** `copyScenario` derives its
column list from `information_schema`, so it replicates faithfully whatever the form leaves behind —
including into the annual close (§4).

## 10. Phasing

ⓘ **Reordered twice.** Pass 1 found P3's own justification contradicted its position. Pass 2 found
P1 sitting behind a phase it does not depend on: the double-click is frontend-only, zero data risk,
explicitly requested, and the fastest owner-visible win in the document. It goes first.

**Shipped separately, first: the v3.14.2 hotfix — D1 + D2.** Not a phase of this CR.

| phase | contents | why here |
|---|---|---|
| **P1** | Double-click → edit; delete the stale drawer; row keyboard access; `stopPropagation` on the status cell. | Owner-requested, frontend-only, depends on nothing. |
| **P0** | D3, D7; delete `bulk-update` (D4); constrain AI Review's writable fields (D5); correct the false comment at `forecast.js:167`. | Route hygiene. D5 must precede any hiding, or one LLM click writes an invisible value. |
| **P2** | The `fcWarnings` residue rule + the liability `base_value = market_value` invariant. | The detector must exist **before** anything is hidden. |
| **P3** | The capability map + the form residue panel (with preview/undo) + payload symmetry + the `has_valuation` flip confirm. | Where the owner sees valuation and sweep leave their Expense modules — **the request**. |
| **P5** | Tier-B creation defaults and labels per type. | Cheap, low risk, and the only thing the five Tier-B types get. |
| **P4** | Sweep eligibility (§6) — route validator + `resolveSweepFlags` derivation. | Hazard-closing; fires on nothing in today's data. |

ⓘ **P6 is CUT** to [the roadmap](../current/project-roadmap.md#cr070) — the disposal selling cost and
the PE commitment are two new fields and a migration with no user story, and asking "are they worth
it?" as an open question invites a yes. Deferred and tracked, not silently dropped.

**Deploy plan:** each phase is separately shippable, no migration in any of them, so each is
`./Scripts/bump-version.sh patch` + `./Scripts/deploy-to-production.sh`. **Gate 0 (§12) runs on every
phase that touches the write path** — P2, P3, P4.

**Sequencing against what else is open (pass 2):** CR070 sits **behind** CR064 P2 and CR071. CR064 P2
has a calendar deadline (the 2026→2027 boundary) and owns the `refreshModulesFromActuals` filter;
CR071 carries the wrong numbers. Neither blocks this CR and this CR blocks neither — but the residue
being inert (§4) means nothing here is urgent, and the numbers are.

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

**Q0 — the one that decides whether this CR is what you asked for.** Five of the nine types keep a
form identical to each other. Do you accept that?

| type | modules | today | after CR070 |
|---|--:|---|---|
| Expense | 50 | 10 fields + valuation + sweep + tax | identity + stream cards **only** |
| Income | 10 | same | identity + stream cards **only** |
| Liability | 15 | full form | Market Value, no growth, no cap-gains, no sweep (Cost Basis stays — §5) |
| Loan | 10 | loan carve-out | loan carve-out, minus the unused cap-gains override |
| Real Estate | 40 | full form | **unchanged fields** + seeded carry/rent cards + labels |
| Business | 20 | full form | **unchanged fields** + seeded income card + tax-override prompt |
| Stocks | 10 | full form | **unchanged fields** + seeded yield card |
| Fixed Income | 5 | full form | **unchanged fields** + seeded yield card |
| Private Equity | 10 | full form | **unchanged fields** + labels (+ commitment, if P6 is revived) |

The engineering reason is §3: the engine treats those five identically, so there is no data signal to
gate on, and gating on the free-text type instead would let a rename hide a live value — the failure
CR064 §5 refused this work over. **If a visibly different form per type matters more than that
guarantee, say so and the CR needs rethinking, not patching.**

**Q1 — is `House Morgage` supposed to carry an interest rate?** Typed Loan, 500,000 principal, 19
amortization rows, secured against the house, **rate NULL in all five scenarios** — so the engine
books no debt and no interest for it. One answer fixes 500,000 of debt the model cannot see. *(Also
tracked in [CR071](cr-071-forecast-numbers-vs-intent.md), which owns the warning.)*

ⓘ **Moved to [CR071](cr-071-forecast-numbers-vs-intent.md):** the yield-mode base-year tax decision
(~$33.5K per scenario, deferred by CR069 §6.1) and the CVC Fund VIII double-count (≈158K over seven
years). Both are about numbers, not inputs.

ⓘ **Cut:** "is P6 worth a migration" (P6 is cut) and "where does the sweep rule live" (decided in §6
— it was never the owner's question).

---

## 15. As built (2026-08-05, `3120b10`…`bb0c60c`) — SHIPPED in v3.15.0

No migration. QA script retained at [qa-cr070-cr071.md](../current/qa-cr070-cr071.md).

**Gates at release:** 811 backend · 421 frontend · 8 e2e · lint 0 errors · six ratchets at
baseline · clean build · **per-(scenario, account, year) `forecast_entries` sums identical to the
cent on a prod copy, 4,030 rows.** Nothing in either CR moves a number.

| phase | what shipped |
|---|---|
| **P1** | Double-click opens the editor; the read-only drawer **deleted** (174 lines) with the five helpers that died with it; rows keyboard-reachable (Enter, focus ring); the status `<select>` now stops `dblclick` as well as `click`. |
| **P0** | D7 — POST persists the four fields it used to accept and discard. D5 — AI Review refuses `growth_rate`/`tax_rate_override` on a module with no valuation, keyed on `has_valuation`. D4 — `bulk-update` deleted. D3 — the type vocabulary is derived from the scenario's own modules. Plus: `GET /modules/:id` now projects the two sweep fields, and the false sweep comment is corrected in place. |
| **P4** | `assertSweepEligible` on the route **and** a derivation arm in `resolveSweepFlags`. Derived, not thrown, because `syncIfStale` runs at the top of every variant build. |
| **P2+P3** | `capabilitiesFor` / `residueFor` / `fieldSectionsFor`, the residue panel, and the sweep control gated on the `sweep` capability. |
| **P5** | `templateForType` seeds a new module from its type; `streamIsUntouched` drops a seeded card the owner never answered. |
| **P6** ⓘ | *Added during QA, not the cut P6 (which was the disposal selling cost and stays cut).* A flow module's **`Account`** named one of the four accounts its line covers — `Car Expenses` showed `Car - Insurance`. Gated on the `valuation` capability, and the read it was standing in for replaced: **`PY Actual` was looking the module up in the BALANCE-SHEET report**, so on a `profit_loss` account it was permanently blank, not merely wrong. New **`GET /fc-lines/actual-totals`**, built as the exact sibling of the existing budget query, backs `Actual <year> — <line>` instead. |

### What QA found after the build

Six findings, and **five of them were dead or lying CR069 leftovers** rather than anything this CR
introduced — which is its own argument for having looked:

- **Two retired schedules were still on the form.** `Yield Spread` and `Yield Spread Entries` were
  rendered, accepted input, and were **not in `MODULE_WRITE_FIELDS`** — typed, saved, silently
  dropped, on every module type since v3.14.1. Exactly the CR046/CR047 class the write allow-list
  exists to prevent, surviving in the UI after the contract moved on.
- **The schedule sections were a second visual language** on the same form: filled CTA buttons,
  numbered circular badges, an SVG empty state, an icon-only delete, ALL-CAPS labels, and inputs a
  measurable step chunkier than the stream cards (0.9rem/0.7rem against 0.875rem/0.35rem). Restyled
  onto the existing classes — a new button class would have tripped `check-button-css` — with the
  metrics **copied** from `.fc-stream-card`, not approximated.
- **The left edge was the piece worth arguing about.** It is the one part of the stream-card idiom
  that carries meaning rather than polish, so `directionForSchedule` reads it off the engine:
  Invest and Amortization are cash **out** (`fcbuilder-module.js:534`, `fcbuilder-loan.js:18`),
  Dispose is cash **in**. Keyed on the FIELD, never the label, because `labelForType` renames these
  per type and a "Capital Call" is still cash out.

**Follow-on, v3.15.1:** the module **type filter** now groups by what the module is — Assets /
Debt / Flows, the same `has_valuation` split this CR gates the form on — with a count per option.
It reuses this CR's rule for type-keyed lookups exactly: cosmetic only, and an unrecognised type
falls into a trailing "Other" group rather than vanishing, because a filter that drops an option
hides modules.

The owner's first pass also caught that a fix of mine was **cosmetic when the problem was
structural** — the sections had been re-skinned but still had two different shapes (a full-width
toggle when empty, a compact pill when not). One structure, whether or not the schedule has rows.

### What the build itself taught

**A page-crashing regression that only e2e caught.** The derived type vocabulary read `modules`
fifteen lines before `useModules` declared it — a temporal dead zone, so `/forecast-modules` threw
on load. **The unit suite was fully green while the page was dead**, and four e2e specs went red.
That is the argument for the browser gate in one sentence.

**Two projections kept by hand had drifted the same way twice in two days.** `HasValuation`
(v3.14.2) and now `CashSweepPriority`/`CashSweepTarget`: present in the LIST, absent from the
DETAIL the editor loads from. Both times the symptom was a form guessing at state it should have
been told. Deriving the two projections from one source is the obvious follow-up and is **not**
done here.

ⓘ **It bit a THIRD time within hours, in this CR's own P6 field** (fixed 2026-08-05). The Actual
comparison read `fc_line_name` off the stream — a denormalised label the **LIST** join supplies and
the **DETAIL** query does not — so it resolved `undefined` and reported *"Actual (no line set)"* on
every flow module, including `Children`, which plainly carries `fc_line_id` 13. Found by the owner
on the first screen they opened.

The fix is not to add the label to the second projection. It is to **key on `fc_line_id`** — the
column both projections do carry, and the one the engine branches on — and resolve the label from
the already-loaded `fcLines` for display only. The row lookup matches on the id too, since matching
two display strings is how a rename silently becomes "no transactions". A projection can now drop
the denormalised name without breaking the field.

**The same TDZ trap as the type vocabulary reappeared in the fix and was caught before commit:**
`fcLines` was declared eighty lines *below* the `useMemo` that now reads it. Moved above its
consumer. Twice in one CR is the argument for reading declaration order whenever a derived value
gains a new dependency. **It then happened a third time** in v3.16.0's follow-up — a second
`baseYear` declared below the one the new fetch needed — caught by the parser rather than by
review, which is the honest version of how that class gets found.

### v3.16.0 — the field grew into a three-year reference, on the stream card

Owner-requested: *"how can we see what actual costs was for the prior actual year and budget amount
for current year"*. Both endpoints already existed — `/fc-lines/actual-totals` (this CR's P6) and
`/fc-lines/budget-totals` — and nothing on the form had asked the budget one for a line.

Actual (base−1, the last **complete** year) · budget (base) · actual (base, **YTD**, labelled so it
is not read as a full year. **On the stream card, not the header**, because the FC line is a
property of the *stream*: P6's module-level field was the same figure a scroll from the Amount it
checks, and a module with two expense streams on different lines made one header figure ambiguous.
It is removed rather than kept alongside.

**The caveat is the feature.** The totals belong to the LINE. `Property Costs` carries **six**
modules, so 76,656 against one card's 34,717 is not a comparison — every line shared by more than
one module now says how many share it. That is the *identical* error the old `Account` field made
(§P6 above), and repeating it one screen over would have been the worse mistake for having just
fixed it. A zero budget is omitted rather than rendered, because 2025 keeps none and a displayed
`0` reads as a deliberate plan of zero.

**A request declined, on measurement.** The owner asked that a stream's Start year default to the
period start. It does not, for two reasons: a flow module **already** anchors at `PeriodStart`
([fcbuilder-module.js:131](../../server/src/services/forecast/fcbuilder-module.js#L131)), so blank
already means that year there; and a start date is stored as July 1, so `applyStreamWindow` does
`series[i] /= 2` on the first year — defaulting the control would have turned a 34,717 expense into
**17,358** in its first year, silently, on every new stream. What was actually wrong is the label:
*"from the base year"* is inaccurate on a flow module and unspecific on a valuation one. It now
names the module's own first year and states the half-year rule, so choosing a year is a real
choice rather than a restatement of where the plan starts.

**The residue panel ships empty**, on every prod module. That is the intended state — the QA script
says how to make it appear on purpose, because a safety net nobody has watched work is not yet
trusted.

### Deliberately not done

- **Payload symmetry for Clear beyond the null write.** Clear sends an explicit `null`/`[]`, which
  the route applies; there is no preview dialog. The panel *is* the preview — it names the field
  and the value before anything is written, and Cancel still reverts.
- **The `has_valuation` flip confirm.** The capability map reads the flag but no UI toggles it yet,
  so there is nothing to confirm. It arrives with whatever first offers the toggle, and §4's
  refusal conditions (Invest/Dispose rows, a sweep rank, being another module's secured asset, and
  a missing Base Date) stand as written.
- **P6** — the disposal selling cost and the PE commitment. Cut to the roadmap; they need a
  migration.
