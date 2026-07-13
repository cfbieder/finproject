**Status:** 🟢 OPEN — [Roadmap](../current/project-roadmap.md)

# CR048 — Forecast Model Review: Engine Fixes + Ratified Assumptions

**Opened:** 2026-07-12 · **Track:** v3 · **Migration:** none

Outcome of a full conceptual review of the forecast model (owner-requested, decisions taken
via `/question` the same day). Three internal inconsistencies fixed (A1–A3); five economic
assumptions explicitly ratified or scheduled (B-list); two policy items deliberately left
as-is (A4, A5).

## 1. Fixed — the model contradicting itself

### A1 — Assets the sweep drained kept paying dividends

Yield income is a % of market value, and the sweep changes market value; the income↔sweep
convergence loop solved this fixed point **for the primary module only**. A *backup* the
sweep drained kept paying dividends on its full pre-sweep balance. Fidelity Stocks (backup,
yield = inflation − 0.5%) is fully liquidated by the sweep in "2026 with House Purchase" —
and kept yielding ~$25K/yr on money that was gone, in exactly the years the plan is short.

**Fix:** Step 7b generalized to every ranked module with a yield schedule. Also closed while
in there: sweep adjustments (USD entries) were added to the module's **LC** market value raw
— harmless while every sweep module is USD, wrong the day one isn't (now converted at the
module's FX first); and the recompute ignored the **CR046 income window** (it would have
resurrected windowed-off income — now applied, including boundary-year halving).

**Deliberately NOT scaled:** amount-based income (`income_amount`, no yield schedule) on a
drained module. It is contractual (a dividend policy, a rent), not a % of value — scaling it
by drains would need proportionality rules nobody has chosen. Modelling choice, recorded.

### A2 — Cost basis was spent twice

The sweep realizes gains against the module's basis (CR045 P2a), but the builder's
*scheduled* disposals compute their gains from a basis series that cannot see what the sweep
sold — the same basis offset two different sales, understating tax. **Fix:** the same
backward-pass pattern as P2c's solvency floor, applied to basis: the sweep may only claim
basis that survives every future year (`basisFloor[Y] = min over t ≥ Y of basis[t]`). Where
they overlap, the scheduled sale keeps its assumed basis and the forced sale carries the
higher gain — conservative by design. Flat basis series (no scheduled sales) ⇒ identity.

### A3 — CR047 never reached the convergence loop

Income recomputed in the loop was re-taxed at the **gains** chain
(`tax_rate_override ?? scenario`), silently overriding CR047's income rate on every rebuild.
Latent (no yield-bearing sweep module carries an income override today). **Fix:** the loop
uses `income_tax_rate_override ?? tax_rate_override ?? scenario`, matching the builder.

### Effect on prod (measured on a restored prod copy before deploying)

| scenario | pre-CR048 | CR048 |
|---|---|---|
| 2026 Base | — | **byte-identical** (its Stocks is never drained — the A1 parity case) |
| 2026 Downside | 1 yr / −$766K | **byte-identical** (only yield module is the primary) |
| 2026 with House Purchase | 3 yrs / −$732K, sweep tax −$56K | 3 yrs / **−$966K**, sweep tax **−$106K** |

Fidelity Stocks dividend income in House Purchase: 2027 unchanged ($27,724 — undrained);
2055 $26,693 → $6,760; 2062 $24,182 → **$488**. The tail phantom income is gone; the
shortfall is larger and honest.

**Tests:** A1 — full `generateForecast` integration test (drained backup's income collapses;
pre-fix it read a flat $35,000). A2 — declining-basis sweep test (only surviving basis
claimable; flat series unchanged). 350 backend green.

## 2. Ratified / scheduled — the B-list (owner decisions, 2026-07-12)

| # | Assumption | Decision |
|---|---|---|
| B1 | Cash earns 0% forever (~$500K over the horizon) | **Ratified** — deliberate conservatism |
| B2 | Sweep band nominal & frozen | Self-resolving given B1 — the real idle balance shrinks yearly |
| B3 | All growth = multiple of inflation (stocks 1.0× ⇒ 0% real) | **Test before deciding**: copy Base, stocks 2.0× in the copy, read `/forecast-compare` (after CR048) |
| B4 | Flat tax world; no estate tax / basis step-up / IRA character | **Decision record**: Fidelity = taxable brokerage (confirmed), so current treatment is right. 2062 net assets are a *living*, pre-estate figure; late-life forced-sale tax modestly overstated vs holding to death |
| B5 | FX paths (PLN/EUR ≈ half of assets) hand-set, unstressed | **Fold FX stress into Downside** — owner to supply magnitudes |

## 3. Left as-is — policy, not defects

- **A4 — losses give no tax relief** (no netting, no carry-forward). Conservative direction;
  building it means inventing netting rules nobody has chosen. Revisit if a loss-making
  disposal is ever actually planned.
- **A5 — final-year tax bunching**: 2062 carries its own tax and 2061's deferred tax.
  **⚠️ Partly superseded by [CR049](cr-049-forecast-base-year-seed-and-final-year-tax.md).** The
  *bunching* stands (the last year does carry both charges). What was wrong was accepting that the
  bunched tax could push the final year **under the band**: it left 2062 at −$60,521 cash beside
  $4.3M of sellable stock, with no `Cash Shortfall` entry, because the tax landed after the band
  check. The final-year sale now funds its own tax.
- **Amount-based income on drained modules** (see A1).
- **UPDATE-only convergence writes**: a year whose income was exactly 0 in the builder gets
  no entry row, so the loop cannot raise it later (pre-existing; affects nothing live).

## 4. Data flags for the owner

- ~~**Possible double-count of investment-income tax**~~ — **withdrawn, this was a false
  alarm (2026-07-12).** The budget Tax item carries a `-100%` change dated 2027, so it is
  **zero from 2027 onward**: it covers 2025–2026 only and the engine's computed tax takes
  over from 2027. The two never overlap. The owner had already handled it; the review
  flagged it without checking `forecast_incexp_changes`.

- **Tax / Taxes merged onto one row (v3.0.91).** Because they are complementary in time, the
  budget's historical tax and the engine's projected tax belong on the same line. The FC Line
  `Tax` is renamed **`Taxes`** (data), so the base-year value and the engine's hardcoded
  `Taxes` account share a label. `useFCLineStructure` hardcodes a `Taxes` row unconditionally,
  so it now only pushes it when no FC Line already supplies one — otherwise the row would
  double. Verified: the renamed item still contributes nothing to the forecast years.
- "New House" (Base) and "Sarasota House" (House Purchase) still carry the lowercase `asset`
  module type from the pre-v3.0.87 dropdown bug — re-type via the editor.

## 4b. The copy path was split-brain — fixed (v3.0.93)

Found while building the B3 experiment: the **API** scenario-copy endpoint copied the scenario row,
its modules and its inc/exp items — but **not the per-scenario assumptions** (period, inflation, FX,
tax rate), which live in the `forecast_assumptions` document keyed by scenario *name*. The UI did
that half **client-side**, so UI copies worked and an API copy silently produced a scenario with
**0% inflation and no period** — which the engine would then build anyway. Same split-brain shape as
the CR045 §1 copy bug: *a copy that silently drops a field is a scenario that silently computes
something else.*

**Fix:** the assumptions copy moves **into `copyScenario`**, inside the same transaction, and the
client-side half is deleted — one copy path, server-side. Idempotent: a re-copy onto an existing
scenario replaces the target's entries rather than appending (the document is round-tripped through
JS, not SQL operators, because `value` is `json` not `jsonb` — CR039 byte-parity). The UI now
re-reads what the server wrote instead of mirroring it; mirroring is how the halves drifted apart.

Verified on dev: an **API-only** copy (no UI) now generates **1,445 entries totalling $780,835,162 —
identical to its source**. Pre-fix the same call produced a scenario the engine could not build.
+1 route test, verified to fail pre-fix (the copy had no period entry at all).

## 5. Status

| Item | State |
|---|---|
| A1 generalized convergence (+ FX units, + CR046 window in loop) | ✅ +1 integration test |
| A2 basis floor | ✅ +2 sweep tests |
| A3 income-rate chain in the loop | ✅ (exercised by A1 path) |
| Restore-and-diff preview vs prod copy | ✅ Base/Downside byte-identical; House honest |
| Deploy + prod regenerate | ✅ v3.0.90 (Tax/Taxes row merge v3.0.91; server-side copy fix v3.0.93) |
| B3 growth experiment (scenario copy + compare) | 🟡 **"2026 Base - Market Returns" generated on prod** (stocks 2.0× vs 1.0× inflation ⇒ Fidelity Stocks $5.05M vs $1.20M in 2062, no shortfall in either) — owner to read on `/forecast-compare` and decide |
| B5 FX-stress Downside | ⚪ awaiting owner magnitudes |
