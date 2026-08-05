# CR071 — where the forecast's numbers disagree with the owner's intent — 🟡 PLANNED

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
| **R5** | **Basis equals market value on 5 of 8 Real Estate modules**, so their Full disposals realize **zero gain and zero tax**. `PL - Niemena` sells for 4,287,465 PLN in 2052, tax-free. | the tax on a 4.29M sale | *"Basis equals market value — this disposal realizes no gain."* Same invariant CR070 §5 checks on liabilities, from the other direction. |
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

## 4. Open questions for the owner

1. **CVC Fund VIII** — is the 3.75% NAV growth *net* of distributions, or gross? One of the yield and
   the distribution schedule is double-counting ≈158K over seven years, and which one depends
   entirely on this answer.
2. **Should a yield-mode stream's typed amount keep generating base-year deferred tax?** ≈$33.5K per
   scenario. It is invisible in the UI and live in the engine, preserved deliberately by CR069 so the
   equivalence gate would pass. Changing it moves forecast numbers.
3. ~~**`House Morgage`** — is it supposed to carry an interest rate?~~ **ANSWERED 2026-08-05: yes,
   6%.** Set across all five scenarios together with the `derived` interest line the loan model
   needs. The owner then chose to leave `setup_status='new'`, so it is **parked, not broken** —
   R8 above carries the measured cost of activating it whenever that decision is revisited.
