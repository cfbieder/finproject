# CR071 — where the forecast's numbers disagree with the owner's intent — ✅ COMPLETE (detections v3.15.0; the §4 data edits APPLIED TO PROD 2026-08-06)

Eight places where Fin's forecast produces a number the owner did not intend and nothing says so.
None is a code defect: every one is a *valid* configuration the engine models faithfully. They are
invisible because no surface asks the question or reports the disagreement.

Split out of [CR070](cr-070-module-inputs-by-type.md) at PM sign-off, which put it plainly: CR070 is
about the input *surface* being wrong; this is about the *numbers* being wrong. Different payoff,
different urgency, different owner questions — and sharing `fcWarnings.js` is not a reason to share
a CR. **Pass 2 ranked these above CR070 for owner value**, because a form that asks nine irrelevant
questions is irritating, while 500,000 of debt the model cannot see is wrong. *(That instance is now fixed — the rate is set — but it is parked rather than active, which is R8.)*

[Roadmap](../current/project-roadmap.md#cr071) · **Opened:** 2026-08-05 · **Track:** v3 ·
**Migrations:** none · **Depends on:** [CR069](cr-069-forecast-streams.md) (streams as rows — three
of these live on stream rows), [CR062](cr-062-forecast-loan-module.md) (`computeLoanWarnings`, the
per-type data-keyed warning precedent this CR extends).

---

## 1. Why a warning and not a fix

Every item here is a number the owner *could* have meant. `Sarasota House` may genuinely have no P&L
line; a business may genuinely be worth nothing at exit. **Fin must not silently correct a figure the
owner may have chosen** — CR058 established that with the calibration modes, and CR051 with the
fail-loud 400 on an unconvertible currency.

So the deliverable is not a set of corrections. It is a set of **detections**, in `fcWarnings.js`,
where the existing `computeLoanWarnings` already proves the shape: data-keyed, per-module, visible on
the table without opening anything, and incapable of hiding a value.

One item — R3 — needs the warning *because* the existing warning cannot see it, which is the sharpest
argument in this CR for the whole approach.

---

## 2. The eight, ranked by money

| # | What | Measured on prod 2026-08-05 | Detection |
|---|---|---|---|
| **R3** | **A loan the engine does not treat as a loan.** ⓘ **The instance is FIXED (2026-08-05: `House Morgage` now carries 6%), but the CLASS is not, and it is the sharpest argument in this CR.** It was typed `Loan` with 500,000 principal, 19 amortization rows, secured against the house, and `loan_interest_rate` **NULL in all five scenarios** — the engine's loan branch is `loanRate != null`, so it booked no debt and no interest, **and `computeLoanWarnings` bails on the same condition, so the one guard that would catch it was switched off by the very NULL that caused it.** Nothing announced it; it was found by reading. ⓘ **A second lock was found in the same pass:** the stream was `expense`/`amount`, so even with a rate the derived interest had nowhere to post — `clearForLoanRetype` returns early when there is nothing to clear, so acquiring a rate never normalizes the stream (CR070 D8). | was 500,000 of debt absent ×5 scenarios; now 0 | *"Typed Loan and carrying loan assumptions, but no interest rate — the engine is not treating this as a loan."* The general form is **type says X, data says not-X**, and it is what makes CR070's Tier B tolerable. |
| **R1** | **Income already taxed at source is taxed again.** A foreign-currency income stream with no tax override is taxed at the scenario's flat rate. The project's own code comment records that United Beverages' dividend is *net of Polish tax* and the incremental US tax is ~3%. The override is **unset on all 145 streams**. | ≈150,000 PLN/yr ≈ $38K/yr for the nine years to the 2036 exit | Warn on a foreign-currency income stream with no override. **The form should also prompt rather than leave it blank** — that half belongs to CR070 P5. |
| **Q2** | **CVC Fund VIII double-counts, and the form cannot say which way.** 3.75% NAV appreciation **and** a 4.0% yield **and** 300K of scheduled distributions. If the appreciation is net of distributions, the yield double-counts ≈22,650/yr; if gross, the schedule does. | ≈158K over seven years, sign depends on intent | Warn when a module both distributes on a schedule and pays a yield. **This one needs an owner answer before any rule can be written** (§4 Q1). |
| **R5** ⚠️ | **Basis equals market value on 5 of 8 Real Estate modules.** ⚠️ **This row's PREMISE was wrong and shipped wrong — see [§8](#8-r5-was-wrong--owner-found-2026-08-06-fixed-in-v3181).** "Zero gain and zero tax" reads the equality at the BASE DATE; the engine reads it at the DISPOSAL YEAR, and the basis is flat while the market value compounds. `PL - Niemena` does **not** sell tax-free — it is taxed on the growth from 2026 to 2052. | the tax on the gain since PURCHASE, if the basis is a placeholder | *Corrected in v3.18.1:* the warning now branches on growth — flat ⇒ *"realizes no gain"*, growing ⇒ *"taxed only on growth since the base date"*, shrinking ⇒ *"sold at a loss against its cost basis"*. |
| **R6** | **Orphaned flows.** `fc_line_id` NULL on `Sarasota House` (−45,000/yr × 21 years), `Retirement Home`, `Car Purchase Chris`, `Social Security`: cash moves, no P&L line. Found by CR069 §13 and still open. | −1,203,432 off the P&L for Sarasota alone | Warn on any stream with no line. **Requiring a line at stream creation** belongs to CR070. |
| **Q1** | **A yield-mode stream's typed `amount` is invisible and live.** The card hides Amount in yield mode; the base-year deferred-tax block reads it. Prod: CVC Fund VIII 25,800, Fidelity Fixed Income 46,000, Fidelity Stocks 40,000. **Pre-existing and preserved deliberately** — the old builder taxed them and CR069's equivalence gate required matching it, which `fcbuilder-module.js:450-461` states in writing. CR069 §6.1 deferred whether it is *right*. | ≈$33.5K of Period-1 tax per scenario | **A decision, not a detection** (§4 Q2). Changing it moves forecast numbers and needs the sums gate. |
| **R8** | ⓘ **New 2026-08-05 — a module can be fully configured and silently absent.** `setup_status='new'` excludes a module from generation at four query sites, and nothing on the modules table distinguishes *configured and excluded* from *configured and live*. **`House Morgage` is the live instance and is now DELIBERATE:** the owner set 6% and a derived interest line on 2026-08-05 and chose to leave it inactive, so the plan still finances the 2028 purchase with cash. Measured on a prod copy: activating it adds **−500,000 of debt at the 2028 draw** and **−315,000 of total interest** (−437,500 in Buy Business), repaid by 2048, with the correct July-1 half-year first period. | *"configured but excluded from the forecast"* — and it must be **dismissible**, because this one is a choice. A warning that cannot distinguish a parked module from a broken one is the R3 mistake in reverse. |
| **R7** | **`Tax Liabilities` carries a Full disposal dated in the base year** (2026-07-01), which is not a forecast year — so the payoff never happens and nothing says so. | the liability never clears | *"Disposal before PeriodStart does nothing."* |
| **R4** | **Disposals book gross proceeds.** No selling-cost input on any of prod's 21 disposals; US agent + closing ≈ 6%, Spain ≈ 10-13% with plusvalía and notary. | 6–13% of every disposal | **Needs a new field and a migration** — deferred with CR070's cut P6; the warning alone would fire on all 21 and say nothing actionable. |

---

## 3. Scope

**In:** the `fcWarnings.js` rules for R3, R1, R5, R6, R7, and — once the owner answers §4 Q1 — Q2.
Warnings surface on the modules table and in the Review page's existing warning channel.

**Out:** R4 (needs a field + migration; tracked on the roadmap with CR070's P6). Any automatic
correction of a number. The *form* halves of R1 and R6 — prompting the tax override and requiring an
fc_line at creation — which are CR070 P5.

**Gate:** these are detections, so `forecast_entries` must not move. **Regenerate all five scenarios
before and after on a prod copy and diff the per-(scenario, account, year) sums to the cent** — the
CR069 gate. Any rule that changes a number is a bug in this CR.

**A rule must not fire on a deliberate choice without saying so.** Each warning names the module, the
field, and what the engine consequently does — never "this is wrong".

---

## 4. Owner decisions — ANSWERED 2026-08-05

Both moved forecast numbers, which is why they were questions and not fixes. **Both are held and
applied WITH the CR070/CR071 production release** (owner's choice), so there is one change event
rather than a data edit landing mid-QA and being mistaken for a code effect.

### Q1 — CVC Fund VIII: the YIELD is the error. Remove it. ✅

The fund draws three ways at once: NAV compounding at 1.5 × inflation (≈3.75%/yr), a `Spread %`
yield of 1.5 paying out from 2027, and `OneTime` disposals of 100,000 in each of 2030, 2031 and
2032 before the 2033 Full exit. About **158K over seven years** is counted twice.

**The yield goes; growth and the disposals stay.** A PE fund distributes lumpy realizations, not a
recurring yield — and the disposal schedule already models exactly that, *correctly*: a `Dispose`
row reduces NAV and consumes proportional basis at the gains rate. A `yield` stream does neither;
it pays cash out of thin air and leaves the NAV compounding as though nothing had been
distributed. So the 2030–32 rows **are** the distributions, and the yield was a second, phantom
one.

*Consequence for §2:* CVC's typed amount of 25,800 goes with the stream, so Q2 below applies only
to the two Fidelity holdings.

### Q2 — the typed amount on a yield stream is vestigial. Clear it. ✅

`Fidelity Fixed Income` (46,000) and `Fidelity Stocks` (40,000) carry an amount their own card
hides in yield mode and the projection ignores — but the base-year deferred-tax block reads it,
charging **≈25,800 of Period-1 tax per scenario** on income the plan never books as income.

**Cleared.** A yield stream's income is NAV × rate; a separate typed figure is a leftover from
when these were amount-mode streams. **This was pre-existing and deliberately preserved** —
`fcbuilder-module.js:450-461` records that the old builder taxed these and CR069's equivalence
gate therefore required matching it, with §6.1 deferring whether it was *right*. This is that
deferral, discharged.

### How both land

1. Applied on a **throwaway copy of prod first**, all five scenarios regenerated, and the delta
   reported line-by-line — these are the first changes in this CR that are *expected* to move the
   sums, so the gate inverts: an unchanged number would be the bug.
2. Then applied to prod inside the release, after the code deploy, with a backup first.
3. Expected direction: 2027 tax **down** ≈25,800 per scenario from Q2; CVC income **down** ≈22,650
   in each year from 2027 to 2033 from Q1, with no change to NAV, the disposals, or the exit.

### Still open

3. **`House Morgage`** — answered separately: it carries 6% and a derived interest line, and the
   owner chose to leave `setup_status='new'`, so it is **parked, not broken** (R8).

---

## 5. As built (2026-08-05, `3120b10`) — SHIPPED in v3.15.0

> ✅ **The two §4 data edits were APPLIED TO PROD on 2026-08-06**, after owner sign-off on the
> measured effect. Result below in §7. The text that follows described the position before that.
>
> ⚠️ **The two §4 data edits did NOT ship with the code.** They move numbers, so they need their own
> change event: applied to a prod copy first with a line-by-line delta report, then to prod, then a
> regenerate. **For those two the gate INVERTS — an unchanged sum would be the bug.** Still
> outstanding after v3.15.0; tracked on the [roadmap](../current/project-roadmap.md).


`computeModuleIntegrityWarnings` in `fcWarnings.js`, called from `computeForecastWarnings`, with
12 tests. Every rule is keyed on DATA, never on `module_type`. **Detections only — the gate proves
it: 4,030 sum rows identical to the cent on a prod copy.** No migration.

**Measured against real prod modules: 13 warnings across 34 modules** — 5 foreign-currency income
without a tax override, 4 streams with no P&L line, 4 configured-but-excluded. **The four orphaned
lines match CR069 §13's four exactly**, which is the calibration signal worth having.

The list query gained three disposal **scalars** (`dispose_count`, `dispose_full_count`,
`dispose_first_year`) rather than the schedules: three rules need to know whether a module disposes
and when, and shipping every row to every consumer to answer a yes/no question is the wrong trade.

**R3's test asserts `computeLoanWarnings` finds nothing** on the shape R3 catches — so the gap this
CR exists to close is pinned by a test rather than described in prose.

**Silent on today's data, by design:** R3 (fixed when the owner set 6%), R5, R7 and the CVC rule.
They are written for the next instance, not this one.

### Not built

- **R4** — the disposal selling cost. Needs a field and a migration; deferred with CR070's P6.
- **The form halves of R1 and R6** — prompting the tax override and requiring an fc_line at stream
  creation. CR070 P5 territory; the warnings report both meanwhile.

---

## 6. The §4 data edits — MEASURED on a prod copy 2026-08-05, NOT YET APPLIED

Dry run on a `pg_dump` of prod restored to a scratch database, with the edits made through
**`PUT /modules/:id`** (the app's own write path — validation, `replaceModuleStreams`, CR050 variant
interception) rather than by SQL. Prod was not touched.

**Only the three BASE modules are edited** — 80 `CVC Fund VIII`, 93 `Fidelity Stocks`,
94 `Fidelity Fixed Income`. Verified first that **no variant carries an override on any of them**,
so `syncIfStale` propagates the change to all four variants on the next build. Three writes, not
fifteen.

### The UI cannot make half of this edit

The stream card gates the Amount input on `mode !== "yield"`
([FCModulesStreams.jsx:166](../../frontend/src/features/Forecast/FCModulesStreams.jsx#L166)), so on
a yield card the field is not rendered — but the stream object still carries the value and
`buildModulePayload` sends it straight back
([fcModulePayload.js:101](../../frontend/src/features/Forecast/utils/fcModulePayload.js#L101)).
**Opening `Fidelity Fixed Income` and re-saving preserves the 46,000.** There is no click that
clears it. That is §2 Q1's "invisible and live" arriving as a practical obstacle, and it is why
these edits are scripted rather than hand-made.

### Method — two controls that mattered

1. **A baseline regenerate BEFORE any edit.** Prod's stored entries are not a valid baseline (see
   below), so the delta is measured regenerated-vs-regenerated. This isolates the edit.
2. **An idempotency control.** A fresh prod copy regenerated **twice with no edit** produced
   byte-identical sums — so a difference is attributable to the edit and not to engine noise.
   Worth having: without it, every number here would have been unfalsifiable.

⚠️ **A measurement error worth recording, because it was nearly reported.** The first delta came out
at **−60.7 million**, which is not a real number: it summed `Fidelity Fixed Income` — a **balance** —
across thirty years, counting the same missing ~200K thirty times. **Flows may be summed across
years; stocks must be read at the horizon.** Same class as the discarded "net worth delta" earlier in
the same session.

### What the edits do — confirmed exactly as §4 predicted

| §4 prediction | measured |
|---|---|
| 2027 tax down ≈25,800 per scenario (Q2) | **+25,800.00 in all five scenarios, to the cent** |
| CVC income down ≈22,650/yr 2027–2033 (Q1) | −27,898 in 2027 tapering to −5,232 in 2033 |
| NAV, the disposals and the 2033 exit unmoved | **0.00 delta every year through the exit** |

The CVC check is the one that mattered: the yield goes, and the thing it was double-counting — the
2030/31/32 `OneTime` disposals and the 2033 `Full` exit — is untouched.

### ⓘ But the CASCADE is ~20× what §4 described, and §4 did not mention it

Removing income means less cash swept into the sweep targets, compounding for thirty years.
Across all five scenarios: **P&L −2,866,707; net worth at 2062 −1,992,856** (≈ −400K to −640K per
scenario). `2026 SRQ House Purchase` shows no net-worth change because **that scenario is already
insolvent from 2035** — a −6.2M cash shortfall in the baseline, −8.7M after.

This is almost certainly **correct rather than a defect** — the plan was compounding money that does
not exist, so the wealth was never there — but §4 quoted ≈158K + ≈33.5K, two orders of magnitude
smaller, and the owner decided on those figures. **Re-confirmation on the real numbers is the open
item**, not the mechanics, which work.

### ⓘ A SEPARATE change will land with ANY regenerate

Prod's `forecast_entries` were generated **2026-08-04 23:09**; the four variants were **synced
2026-08-05 02:01** and nothing has regenerated since. Prod is therefore holding an un-materialised
change, and it is **[Known Issue #2](../current/project-roadmap.md#3-known-issues) resolving itself**:

`syncIfStale` runs at the top of every variant build, so a regenerate re-syncs
`2026 SRQ House Purchase` from Base — replacing its `Sarasota House` stream (prod's copy has
`fc_line_id` NULL, one of R6's orphans) with Base's, which carries **line 18, Property Costs**. The
scenario's override marks the module `in_progress` where Base says `exclude`, so it builds. Result:
**−1,203,432 across 2028–2048**, exactly the figure R6 and Known Issue #2 both quote.

**Nothing to do with these edits.** It fires the moment anyone presses Generate, for any reason.
Bundling the two would make them indistinguishable, so they should land separately.


---

## 7. The §4 data edits — APPLIED TO PROD 2026-08-06

Applied through `PUT /modules/:id` (the app's own write path, never SQL) to the three BASE modules
only — 80, 93, 94 — with prod backed up first. No variant overrides any of them, so the sync
carried it to all four variants. All five scenarios regenerated.

**The correctness checks that mattered, all passed:**

| check | result |
|---|---|
| CVC's NAV and 2033 exit unmoved | **762,071 → 762,071** (2027), 734,781 (2030), 0 at the exit |
| CVC's growth and 4 disposals intact | 1.5000, 4 rows |
| The Fidelity spread rows kept | both, amounts cleared to 0 |
| 2027 tax falls | **−34,800** in Base |

**Effect on 2062 net worth**, measured on prod before and after:

| scenario | before | after | |
|---|--:|--:|--:|
| Base | 2,089,637 | 1,434,849 | **−31.3%** |
| Upside | 5,456,386 | 4,933,766 | −9.6% |
| Buy Business | 7,366,552 | 6,845,456 | −7.1% |
| Downside | −311,638 | −706,118 | deeper |
| SRQ House Purchase | −744,428 | −744,428 | already insolvent from 2035 |

Across all five: P&L **−3,106,980**, net worth at 2062 **−2,092,985**.

**This is a correction, not damage.** The plan had been compounding income that does not exist —
CVC's yield was a second, phantom distribution beside the disposal schedule that already models its
realizations, and the Fidelity typed amounts were taxed while never being booked as income. The
smaller number is the true one.

*Measured against a baseline that already included v3.17.0's P5, which is why Base moves −31.3%
here against the −34% measured on the pre-P5 copy: the two changes push in opposite directions.*

---

## 8. R5 was WRONG — owner-found 2026-08-06, fixed in v3.18.1

The owner opened `Barkeria Sp. z o.o.`'s Module Output beside its warning and asked the obvious
question: *"why this warning, when it does have capital gain?"*

The warning said:

> **"Barkeria Sp. z o.o." is sold without realizing any gain** — Cost basis and market value are
> both $3.9M, so the sale realizes no gain and pays no tax.

The Module Output for the same module said, in 2040: **REALIZEDGAIN 334,294**.

### The mistake

R5's own comment carried it: *"The gain is dispose × (1 − basis/market), so it is zero exactly
while basis equals market."* True — but it read the equality at the **base date**, and the engine
reads it at the **disposal year**.

The cost basis is flat; nothing but an Invest moves it. The market value compounds at the module's
growth every year. So by the time a disposal lands, the two have separated, and
`fcbuilder-module.js`'s Full-disposal branch books:

```
realizedGain = market(disposal) − basis
```

For Barkeria: **1,339,163 − 1,004,870 = 334,293**, which is the screenshot to the dollar.

### How wrong, measured

Every module the rule fires on, on prod:

| what the module does | modules | the old wording |
|---|--:|---|
| **grows** — a gain IS realized | **25** | wrong |
| **shrinks** — a capital LOSS is realized | **5** | wrong, differently |
| flat — no gain | 5 | the only case it was ever right |

**30 of 35.** And it was wrong in a direction that matters: it told the owner a taxable sale was
tax-free, which is the CR071 failure class — *a number that looks authoritative while being wrong*
— committed by the very feature built to catch it.

### The fix

The finding stays; only the claim changes. Basis identical to market value on the base date is
still worth reporting — it is usually a placeholder typed from today's value rather than the real
purchase price, and then the gain since **purchase** is understated however the module grows. So
R5 now branches on growth and says what the engine will actually do:

| growth | title | claim |
|---|---|---|
| `0` | *is sold without realizing any gain* | the original wording, now true by construction |
| `> 0` | *is taxed only on growth since the base date* | taxed on the growth and nothing before it — right only if it was acquired at today's value |
| `< 0` | *is sold at a loss against its cost basis* | books a capital LOSS that may offset gains elsewhere |

Verified in a browser against the real panel: all seven basis-equals-market modules now carry the
wording that matches their growth, and **zero rows still claim "realizes no gain and pays no tax"
on a module that grows**. Falsified before keeping: restoring the unconditional claim fails the
new test.

### What it cost, and the lesson

Nothing in the plan's numbers — R5 is a reporting rule and the engine was right all along. What it
cost was trust in the panel, which is the whole asset.

**A rule that asserts what the engine does must be derived from the engine's own formula, not from
a restatement of it.** The comment was a paraphrase, the paraphrase dropped which year the ratio is
read at, and nothing downstream could catch it: 8 detection rules, a full test suite and a browser
QA all passed, because every one of them checked that the warning FIRED, and none checked that what
it said was true.
