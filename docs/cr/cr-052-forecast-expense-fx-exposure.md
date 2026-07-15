# CR052 — Partial FX Exposure on an Expense Line ("20% of this line is PLN")

**Status:** PLANNED · **Track:** v3 · **Opened:** 2026-07-15
**Depends on:** [CR051](cr-051-forecast-expense-currency.md) (whole-line currency; this is its
intended completion). **Touches:** a new child table + **migration 040**, the income/expense
engine builder (`fcbuilder-incexp.js`), the Expenditures modal (`FCExpModal.jsx`), the incexp
write path, and the CR050 variant materialization/override path. **Has a migration and a gated
engine change** (byte-identical when no exposure is set).

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
| **One slice or a mix** | **Recommend: a small mix** — a line carries a list of `{currency, pct}` (e.g. 20% PLN + 10% EUR), residual = USD | Barely more work than a single slice and you have EUR exposure too. Constraint: `Σ pct ≤ 100`. |
| **Relationship to CR051's `currency`** | **Recommend: coexist, cleanly scoped — they are orthogonal.** CR051 `currency` = the line's **denomination** (what the base number is in). CR052 exposures = **partial foreign slices of a USD-denominated line.** Exposures are only offered when `currency = USD`. | No rework of the just-shipped CR051. A pure-foreign line keeps CR051's native entry; a USD aggregate gets exposures. Different mental models, non-overlapping. |
| **Works on matched lines** | **Yes — the whole point.** Exposure never touches the auto-loaded base value; it tags a proportion of it. | Resolves the screenshot case directly. |
| **Inflation of the slice** | **Carry CR051's single scenario rate** — the native slice inflates at the scenario inflation, then converts. | Per-currency inflation stays deferred. |

## 4. The model — one clean formula

Compute the line's normal USD trajectory exactly as today (`normalUSD[i]` — base value, inflation,
periodic changes, all in USD). Then apply a per-year **FX-adjustment factor**:

```
lineUSD[i] = normalUSD[i] × [ (1 − Σ pct_c) + Σ_c ( pct_c × FX_c[0] / FX_c[i] ) ]
```

where `pct_c` is the exposure fraction for currency `c`, `FX_c[0]` the base-year rate and
`FX_c[i]` the year-`i` rate (native per USD).

Why this is the right shape:
- **`i = 0`:** the bracket is `(1−Σpct) + Σ pct_c·1 = 1` — the base year is unchanged.
- **All FX flat:** every `FX_c[0]/FX_c[i] = 1`, bracket `= 1` — **byte-identical to today**, so a
  line with no exposure (or a scenario with flat FX) computes exactly as it does now. The engine
  change is provably safe.
- **It IS the "fixed native at t0" model:** the implied native amount of slice `c` in year `i` is
  `pct_c · normalUSD[i] · FX_c[0]` = `(pct_c · base · FX_c[0]) · inflation^i` — a base-year native
  figure inflating at the scenario rate, converted at `FX_c[i]`. Exactly what §3 chose.
- **The engine change is tiny:** compute `normalUSD[]` as now, multiply by the factor. No
  server-side `base_value_usd` derivation needed (unlike CR051) — the base stays USD; exposures are
  metadata.

## 5. Schema — migration 040

```
forecast_incexp_fx_exposure(
  id            serial primary key,
  incexp_id     integer NOT NULL REFERENCES forecast_income_expense(id) ON DELETE CASCADE,
  currency      char(3)  NOT NULL CHECK (currency IN ('PLN','EUR')),
  pct           numeric(6,3) NOT NULL CHECK (pct > 0 AND pct <= 100),
  UNIQUE (incexp_id, currency)
)
```

A child table (like `forecast_incexp_changes`), not a JSON blob — it's a small normalized list the
engine and the CR050 sync already know how to handle. `Σ pct ≤ 100` per line is enforced in the
write path (a cross-row check DB constraints express poorly). No exposure rows ⇒ dormant ⇒ existing
lines are untouched, no backfill.

## 6. Engine change (`fcbuilder-incexp.js`)

After `normalUSD[]` is computed, build the per-year factor from the line's exposures using the
same FX series the builder already loads (with the CR051 F1 guard: a missing/zero `FX - <ccy>` for
a currency in use fails loud). Multiply. That's it. Gated: no exposures ⇒ factor 1 ⇒ unchanged.

## 7. CR050 (variants) interaction

Exposures are child rows, so they ride the same rails as schedules/changes:
- **Sync** (`syncVariant`) must copy exposure rows base → variant.
- **Override capture:** editing exposures on a variant becomes an override (like the `changes`
  schedule), and reverts cleanly.
- **`fcFieldLabels`:** an `fx_exposure` entry so the variant panel renders "FX Exposure: 20% PLN"
  legibly.

This is real work but entirely patterned on the CR050 schedule handling.

## 8. UI (`FCExpModal.jsx`)

A new **"FX Exposure"** section (styled like Periodic Adjustments), shown **only when
Currency = USD** (so it composes with, not conflicts with, CR051's denomination picker) — and
**available while Matched**. Add `{currency, %}` rows with a live preview:
*"20% PLN ≈ $36,000 → 144,000 zł at 2026 FX."* Warn if `Σ pct > 100`.

## 9. Tests

- Engine: no exposure ⇒ **byte-identical** to today; 20% PLN with flat FX ⇒ identical; 20% PLN
  with a moving złoty ⇒ the USD cost moves by exactly the factor; a mix (PLN+EUR) sums correctly;
  F1 guard still fires on a missing rate for a currency in use.
- Write path: `Σ pct > 100` rejected; exposure rows round-trip; works on a **matched** line.
- CR050: an exposure override on a variant materializes and reverts; sync carries base exposures.
- E2E: on the matched Living Expenses line, add "20% PLN", save, reopen — it survives; Review
  shows the FX effect when the FX assumption is bent.

## 10. Risks / caveats

- **Share-drift (the F4 caveat, restated):** "20%" is a base-year starting share; it drifts as FX
  moves. The UI copy must say so, or a user will read a later "17%" as a bug.
- **Matched base is USD:** the exposure is a % *of the USD amount*, converted to native at base FX —
  correct for an aggregate you can't decompose, but it is not the same as "I spend exactly 8,000 zł"
  (that's the CR051 pure-foreign path).
- **Flat-FX optimism (CR051 F3) still applies** to the carved slice.

## 11. Non-goals

- No per-currency inflation (deferred, as in CR051).
- No exposure on a non-USD-denominated line (a PLN-denominated line is already 100% PLN).
- No change to CR051's pure-foreign native-entry path — this sits beside it.
