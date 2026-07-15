# CR052 — Partial FX Exposure on an Expense Line ("20% of this line is PLN")

**Status:** PLANNED · **Track:** v3 · **Opened:** 2026-07-15
**Depends on:** [CR051](cr-051-forecast-expense-currency.md) (whole-line currency; this is its
intended completion). **Touches:** a new child table + **migration 040**, the income/expense
engine builder (`fcbuilder-incexp.js`), the Expenditures modal (`FCExpModal.jsx`), the incexp
write path, and the CR050 variant materialization/override path. **Has a migration and a gated
engine change** — byte-identical for any line with no exposure, but *not* a one-line multiply
(§4/§6): applying the factor correctly means separating the line's organic trajectory from its
discrete USD adjustments, and the **primary risk is the CR050 child-collection capture, not the
engine math** (§7). This is a bigger CR than CR051.

> **Review status (2026-07-15):** revised after an engineering review. The model (floats-with-FX,
> multiplicative factor, coexist-with-CR051) was accepted; six issues were folded in — the
> changes/one-off semantic (§4), CR050 capture elevated to the primary risk (§7), the `Σpct`
> invariant moved off the route to a shared funnel (§5.1), the F1 guard extended to exposure
> currencies (§6), a setup-table indicator (§8), and Expense-scoping + tax (§3, §8). Still PLANNED,
> pending owner sign-off before build.

---

## 1. The problem CR051 left open

CR051 lets a whole expense line be USD/EUR/PLN, entered in native — perfect for a *pure* foreign
line (Polish rent, "8,000 zł/mo"). But the owner's real case is different and more common: a
**matched, auto-loaded aggregate** like **Living Expenses** ($179,506.84, pulled from the 2026
budget) where *part* of the spend — say 20% — is really PLN.

Two walls, both hit in the UI:
- **The amount is read-only.** A matched line's base value is auto-loaded from actuals, so you
  can't carve it into an 80/20 split by editing the number.
- **CR051's currency picker is disabled while Matched** (matched lines are USD-anchored), so you
  can't tag currency there either.

The CR051 answer — *split into two lines* — means **unmatching** the aggregate (losing the
auto-load-from-actuals link and hand-maintaining both halves) and doing the 80/20 math yourself.
That is exactly the friction that motivated this CR. And it is the case where "split into lines"
is weakest: you're carving a currency slice out of a USD aggregate you can't decompose into native
amounts — you know a *proportion*, not a złoty figure.

## 2. What we want

On any expense line — **matched or not** — tag *"X% of this line is `<currency>`"*
(e.g. **20% PLN**), without touching the (auto-loaded) amount or unmatching. The engine carves
that share off, converts it to native at the base-year FX, and lets it float with the FX
assumption each year; the rest stays USD. `0%` = today's behavior.

## 3. Decisions

| Fork | Choice | Notes |
|---|---|---|
| **Behavior over the horizon** | ✅ **Starting share, floats with FX** (owner-chosen 2026-07-15) | The % fixes a *native* amount at the base year; it inflates in native and converts at each year's FX. A weaker złoty genuinely lowers the USD cost. The PLN *share drifts* away from the tagged % over time — the % is a **base-year starting point, not a constant** (this is the same caveat as CR051 F4, and it is the point of modelling FX at all). |
| **One slice or a mix** | **A small mix** — a line carries a list of `{currency, pct}` (e.g. 20% PLN + 10% EUR), residual = USD | Barely more work than a single slice and you have EUR exposure too. Constraint: `Σ pct < 100` (strictly — see next row). |
| **Relationship to CR051's `currency`** | **Coexist, and the justification is native-entry UX — not "no rework".** CR051 `currency` = the line's **denomination** ("I know the native amount", e.g. rent = 8,000 zł/mo → native entry). CR052 exposures = **partial foreign slices of a USD aggregate** ("I know a *proportion*", e.g. 20% of Living Expenses). Exposures are offered **only when `currency = USD`**, and **`Σpct` is capped at <100%** (a 100% slice IS a denomination change — use the currency picker). | The exposure model *can't* replicate native entry cleanly (you'd have to enter the USD-equivalent then tag 100%, which needs the USD value you don't have) — that is the real reason to keep both. Forbidding 100% removes the only place the two mechanisms overlap. "CR051 has ~no production data so rework is cheap" is true but is *not* the reason; a unify-now would trade permanent UX duplication for a day saved. |
| **Works on matched lines** | **Yes — the whole point.** Exposure never touches the auto-loaded base value; it tags a proportion of it. | Resolves the screenshot case directly. |
| **Line type** | **Expense only** (`Type = Expense`), like CR051's picker. | Exposure on an *income* line reopens CR051-F5: incexp income is taxed at the flat `scenario.TaxRate` and the tax base under a partial-exposure factor is undefined. Out of scope until income tax on foreign streams is designed. See §8 for the tax note. |
| **Inflation of the slice** | **Carry CR051's single scenario rate** — the native slice inflates at the scenario inflation, then converts. | Per-currency inflation stays deferred. |

## 4. The model — and the semantic the factor hides

The per-year **FX-adjustment factor** is:

```
factor[i] = (1 − Σ pct_c) + Σ_c ( pct_c × FX_c[0] / FX_c[i] )
```

where `pct_c` is the exposure fraction for currency `c`, `FX_c[0]` the base-year rate and
`FX_c[i]` the year-`i` rate (native per USD). At `i = 0` and under flat FX the factor is exactly
`1`. It **is** the "fixed native at t0" model: the implied native amount of slice `c` in year `i`
is `pct_c · organic[i] · FX_c[0]`, a base-year native figure inflating at the scenario rate, then
converted at `FX_c[i]` — exactly what §3 chose.

**The question the factor hides: what does it multiply?** The line's yearly USD value is not one
thing. The builder folds a **Fixed-$ change** into the compounding base
(`baseValues[i] = baseValues[i-1]·(1+p) + changeD[i]`) and adds a **One-Off-$ change** on top
([`fcbuilder-incexp.js:139-153`](../../server/src/services/forecast/fcbuilder-incexp.js#L139-L153)).
Those are **discrete USD amounts** — "a $10k medical bill in 2030." Multiplying the *whole*
trajectory by `factor[i]` re-denominates 20% of that $10k to PLN, which is wrong.

**Decision: the factor applies to the organic base×inflation trajectory only; discrete USD
adjustments stay USD.** Concretely the builder must compute two streams instead of one:

```
organic[i]      = base value grown by inflation × Percent-% changes   (exposable)
usdAdjust[i]    = Fixed-$ (compounded) + One-Off-$ changes            (always USD)
lineUSD[i]      = organic[i] × factor[i]  +  usdAdjust[i]
```

Consequences to be honest about:
- **This is a real restructure, not a one-line multiply.** Today the builder produces a single
  `incexpValues[]` with `changeD` already compounded into it; CR052 has to split the organic
  stream from the USD-adjustment stream and carry both. That is the bulk of the engine work.
- **Byte-parity still holds where it matters:** a line with **no exposure** never enters this path
  (`factor` unused) ⇒ **identical** output. The parity claim is about zero-exposure lines on real
  scenarios (§9), and it survives the restructure because the split only changes lines that opt in.
- **Sub-decision for implementation:** a Fixed-$ added in year 3 then inflates in later years — it
  is treated as USD (not exposed). If the owner ever wants a *recurring foreign* step, that is a
  future "add a Fixed change in currency X", not this CR.
- **`base_value_usd` is untouched** — the base stays USD, exposures are metadata; no server-side
  derivation (unlike CR051).

## 5. Schema — migration 040

```
forecast_incexp_fx_exposure(
  id            serial primary key,
  incexp_id     integer NOT NULL REFERENCES forecast_income_expense(id) ON DELETE CASCADE,
  currency      char(3)  NOT NULL CHECK (currency IN ('PLN','EUR')),
  pct           numeric(6,3) NOT NULL CHECK (pct > 0 AND pct < 100),   -- strictly < 100 (§3)
  UNIQUE (incexp_id, currency)
)
```

A child table (like `forecast_incexp_changes`), not a JSON blob — it's a small normalized list the
engine and the CR050 sync already know how to handle. No exposure rows ⇒ dormant ⇒ existing lines
are untouched, no backfill.

### 5.1 The `Σpct < 100` invariant must sit on a funnel every write path crosses

Per-row `pct < 100` is a DB CHECK, but the **cross-row sum** is not — and it is a mistake to
enforce it in the route only. Exposures have **more than one writer**: the modal PUT, CR050 override
materialization (`syncVariant` merges a base list with a variant's override), and any future
copy/adopt. This is *exactly* the shape of the CR050 opening bug — an invariant enforced in one
place and silently violated in the four others (`refreshModulesFromActuals`,
`clearOtherCashSweepTargets`, bulk-update, add-from-actuals). So:

- Enforce `Σpct < 100` in the **repository/materialization funnel** that every write and every
  variant sync passes through — not the HTTP handler.
- And make the **engine fail loud** if it ever loads a line whose exposures sum to ≥ 100 (a
  belt-and-braces backstop, same spirit as the F1 guard). A silently-clamped 130% line is a wrong
  number nobody sees; a thrown build is a bug someone fixes.

## 6. Engine change (`fcbuilder-incexp.js`)

1. **Split the trajectory** into `organic[]` (exposable) and `usdAdjust[]` (always USD), per §4 —
   the substantive change, because today they are fused in one `incexpValues[]`.
2. **Load an FX series per exposure currency.** Today the builder loads one series for
   `module.Currency` ([`:96-119`](../../server/src/services/forecast/fcbuilder-incexp.js#L96-L119)).
   A CR052 line has `currency = USD` (guard skipped) but exposures in PLN/EUR — so the builder must
   load `FX - PLN` / `FX - EUR` for **each exposure currency** and run the **CR051 F1 guard on each**
   (missing column or 0/non-finite rate ⇒ throw). Without this, a 20%-PLN line on a scenario with no
   `FX - PLN` rate yields `0/0 = NaN` and the factor poisons the whole line silently. The F1 guard as
   shipped keys off the line currency only; extending it to exposure currencies is required, not free.
3. **Apply** `lineUSD[i] = organic[i]·factor[i] + usdAdjust[i]`.

Gated: no exposure rows ⇒ steps 1–3 collapse to today's single stream ⇒ **unchanged output**.

## 7. CR050 (variants) interaction — **the primary risk of this CR**

The engine formula is trivial; this is where CR052 will actually break. Exposures are a **new child
collection**, and CR050's capture-and-materialize machinery for child collections is the
**highest-bug-density code in the repo** — every one of the four post-ship CR050 fixes
(v3.0.110–112) lived here: DATE-compared-as-instant, float-noise-as-change, missing-schedules,
assumption-bypass. Adding a fourth child-collection type walks straight back into it. Three concrete
tasks, none of them free:

- **New write-interception point.** CR050 had to special-case each child writer
  (`replaceModuleSchedules`, `replaceIncExpChanges`). Exposures need a `replaceIncExpExposures`
  equivalent that, on a **variant**, is captured as an override instead of a direct write — a third
  such interception, not a reuse of an existing one.
- **`syncVariant` materialization.** Base→variant copy of exposure rows, with stable surrogate ids,
  ordered deterministically.
- **Order-independent list comparison in the override diff.** `valuesEqual`/prune must treat
  `[{PLN,20},{EUR,10}]` and `[{EUR,10},{PLN,20}]` as equal, and compare `pct` **at the column's
  numeric scale** (the float-noise bug, again — `20.0` vs `20.000000001` must not read as a change).
- **`fcFieldLabels`:** an `fx_exposure` entry so the panel renders "FX Exposure: 20% PLN · 10% EUR".

**Test weight goes here, not on the formula.** The CR050 tests (byte-parity variant, override
pins + reverts, sync prunes a no-op) must each gain an exposure case.

## 8. UI (`FCExpModal.jsx`) + the setup table

- **Modal:** a new **"FX Exposure"** section (styled like Periodic Adjustments), shown **only when
  `Type = Expense` AND `Currency = USD`** — so it composes with, not conflicts with, CR051's
  denomination picker — and **available while Matched**. Add `{currency, %}` rows with a live
  preview: *"20% PLN ≈ $36,000 → 144,000 zł at 2026 FX."* Block save (not just warn) if
  `Σ pct ≥ 100`.
- **Setup table (do not skip this).** At the base year the factor is `1`, so `base_value_usd` is
  **unchanged** — a tagged line looks identical in the Expenditures table, and the effect only
  appears in Review. Without an indicator, a user tags 20% PLN, sees nothing change, and re-tags it
  thinking the save failed (the exact confusion CR051's reopen-test exists to catch). Add a compact
  **"20% PLN" chip** on the row (mirroring CR051's native-amount line) so the exposure is visible
  where it's set.

**Tax:** exposures are Expense-only (§3), and expenses carry no tax in the engine
(`if (incexpValues[i] > 0)` gates tax to income —
[`:156-161`](../../server/src/services/forecast/fcbuilder-incexp.js#L156-L161)), so the factor never
interacts with a tax base. This is *why* the feature is Expense-scoped: an income line would need a
defined tax base for the factored value, which is out of scope.

## 9. Tests

- **Engine — hand-computed, not "it moved":** one scenario, one 20%-PLN Living-Expenses line, a
  deliberately bent `FX - PLN` path, and assert the USD trajectory **to the cent** against a
  spreadsheet across several years (base year, a weaker-złoty year, a stronger one). Plus: the
  organic/USD-adjust split — a line with a **One-Off $10k in 2030** must keep that $10k fully USD
  while the base is 20% exposed; a mix (PLN+EUR) sums; F1 fires on a **missing exposure-currency**
  rate; `Σpct ≥ 100` throws at build.
- **Write path / invariant:** `Σpct ≥ 100` rejected at the **funnel** (not just the route); exposure
  rows round-trip; works on a **matched** line.
- **CR050 (the risk surface):** each existing variant test gains an exposure case — a zero-exposure
  variant stays byte-parity; an exposure override pins and reverts; sync carries base exposures and
  **prunes a no-op exposure edit** (float-scale + order-independent comparison).
- **E2E:** on the matched Living Expenses line, add "20% PLN", save, reopen — it survives and the
  row shows the chip; Review shows the FX effect when the assumption is bent.

## 10. Risks / caveats

- **CR050 child-collection capture (§7)** — the primary risk; the four v3.0.110–112 fixes were all
  in this machinery.
- **The organic/USD-adjust split (§4)** touches the core builder loop; the zero-exposure byte-parity
  gate (§12) is what protects existing scenarios.
- **`Σpct` invariant across write paths (§5.1)** — the CR050 bypass-family failure mode.
- **Share-drift (F4, restated):** "20%" is a base-year starting share and drifts as FX moves — the
  chip/preview copy must say so, or a later "17%" reads as a bug.
- **Matched base is USD:** the exposure is a % *of the USD amount* converted to native at base FX —
  correct for an aggregate you can't decompose, but not "I spend exactly 8,000 zł" (the CR051 path).
- **Flat-FX optimism (CR051 F3)** still applies to the carved slice.

## 11. Non-goals

- No per-currency inflation (deferred, as in CR051).
- No exposure on a non-USD-denominated line, and **no 100% exposure** (that's a denomination change —
  use CR051's currency picker).
- No exposure on income lines (§3) — tax base undefined.
- No change to CR051's pure-foreign native-entry path — this sits beside it.

## 12. Build & validation plan (this CR changes engine output — CR051's gate is not enough)

CR051 was mostly UI + display, so unit tests sufficed. CR052 **changes the numbers real scenarios
produce**, so it needs the CR045–049 engine-fix discipline, not the CR051 one:

1. **Zero-exposure byte-parity on a prod restore.** Restore a real prod dump to the isolated dev
   stack, regenerate **every** scenario, and diff against pre-change output — untagged lines must be
   **identical to the cent** (the §4 split is only safe if this holds on real data, not asserted).
2. **Hand-computed numeric check** (§9) on a tagged line — the spreadsheet is the oracle.
3. **Run CR050 paths against a DB that has variants** — the sync/override code only exercises on
   scenarios with a parent, which the throwaway e2e seed does not have; use the prod-copy restore.
4. **Overnight build → owner walkthrough *with the FX assumption bent*** — because the payoff (and
   any error) shows in Review, not the setup page. Migration 040 applied to prod **before** the code
   deploy, per the migration rule.
