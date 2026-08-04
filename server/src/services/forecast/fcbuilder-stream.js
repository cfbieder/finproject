'use strict';
/**
 * fcbuilder-stream.js — CR069 P2. ONE evaluator for a P&L stream.
 *
 * Replaces three divergent implementations of the same idea:
 *
 *   fcbuilder-incexp.js       an item's own value, `growth_rate` × inflation, with a
 *                             Percent %/Fixed $/One-Off $ schedule
 *   fcbuilder-module.js:485+  a module's income — amount × `income_growth_rate` × inflation
 *                             with steps, or a yield on average market value
 *   fcbuilder-module.js:346+  a module's expense — amount at inflation FLAT, or a % of value,
 *                             or a loan's interest
 *
 * The three are the same function with different subsets of the features, which is why
 * migration 055 re-implemented the Fixed $ change that migration 001 already had.
 *
 * ── EQUIVALENCE, worked out before a line of this was written ────────────────────────
 *
 * The module compounds from scratch each year:
 *     v(y) = amount × Π_{j=0}^{(y−periodStart)} (1 + infl[j]·mult/100)
 * The inc/exp item recurses:
 *     base[i] = base[i−1] × (1 + g[i]/100) + D[i],  g[i] = infl[i]·mult
 * Expand the recursion with D = 0 and the product is term-for-term identical, on the same
 * inflation indices. The recursion is therefore the strictly more general form — it also
 * admits a per-year rate override — so it is the one kept here, and the module's amount
 * streams are proved against it by test rather than by this comment.
 *
 * A `Fixed $` at year Y lands in base[Y] and is first grown by g[Y+1] = infl[(Y+1)−periodStart].
 * CR064 P6's `growIncome(amount, Y, y)` starts its loop at j = Y − periodStart + 1, the same
 * index. That is why a step IS a Fixed $ change and nothing is lost absorbing it.
 *
 * ── SIGNS ────────────────────────────────────────────────────────────────────────────
 *
 * Everything in here works in the stream's own MAGNITUDE frame: bigger number = more of the
 * stream, whichever direction it flows. `direction` applies the sign once, at the very end.
 * That is why `forecast_streams.amount` is CHECKed non-negative while
 * `forecast_stream_changes.amount` is signed — a change says "more of this" or "less of it".
 *
 * The migration is what puts the data in that frame, and it must key on the FLAG, not on the
 * direction: `Fixed $`/`One-Off $` are money and are negated for an expense, `Percent %` and
 * `Spread %` are RATES whose sign means a direction of change, not of money. See migration
 * 057's header — `Children` carries −100% ("this expense ends"), and negating it would
 * double the expense instead.
 */

/** Year index of a date within this stream's own axis; null when absent/unparseable. */
const yearIndex = (dateValue, startyear) => {
  if (!dateValue) return null;
  const year = new Date(dateValue).getFullYear();
  if (!Number.isFinite(year)) return null;
  return year - startyear;
};

/**
 * Expand a stream's change rows onto its year axis.
 *
 * `pct` starts as the stream's own growth (multiplier × inflation) and a `Percent %` row
 * OVERRIDES it for that ONE year — which is the inc/exp behaviour exactly (fcbuilder-incexp
 * assigned into a prefilled array). It is deliberately not cumulative: the level change is
 * permanent because the recursion carries it forward, but the RATE applies to its own year.
 *
 * `spread` is the opposite and carries FORWARD until the next row, because that is what
 * `forecast_module_income_pct` did (a step function over effective dates). Two kinds of
 * "percent on a date", now distinguishable by their flag instead of by which table they
 * happened to live in.
 */
function expandChanges(stream, ctx) {
  const { yearsCount, startyear, periodStart, inflationSeries, inflationLen } = ctx;
  const mult = stream.growth_mult == null || stream.growth_mult === ''
    ? 1
    : (parseFloat(stream.growth_mult) || 0);

  const pct = new Array(yearsCount);
  const fixed = new Array(yearsCount).fill(0);
  const oneOff = new Array(yearsCount).fill(0);
  const spread = new Array(yearsCount).fill(0);

  for (let i = 0, year = startyear; year <= ctx.endyear; i++, year++) {
    const idx = year - periodStart;
    pct[i] = idx >= 0 && idx < inflationLen ? inflationSeries[idx] * mult : 0;
  }

  const rows = (Array.isArray(stream.changes) ? stream.changes : [])
    .filter((c) => c && c.change_date && c.amount != null)
    .map((c) => ({ idx: yearIndex(c.change_date, startyear), amount: parseFloat(c.amount) || 0, flag: c.flag }))
    .sort((a, b) => a.idx - b.idx);

  for (const row of rows) {
    // Out of range is DROPPED, matching fcbuilder-incexp's bounds check. CR064 P6's steps
    // counted a pre-horizon row instead; the two disagreed and no live row exercised either,
    // so one behaviour is chosen here and pinned by test rather than left ambiguous.
    if (row.idx == null || row.idx < 0 || row.idx >= yearsCount) continue;
    if (row.flag === 'Percent %') pct[row.idx] = row.amount;
    else if (row.flag === 'Fixed $') fixed[row.idx] += row.amount;
    else if (row.flag === 'One-Off $') oneOff[row.idx] += row.amount;
  }

  // Spread % carries forward from its own year.
  const spreadRows = rows.filter((r) => r.flag === 'Spread %' && r.idx != null);
  if (spreadRows.length) {
    let current = 0;
    let next = 0;
    for (let i = 0; i < yearsCount; i++) {
      while (next < spreadRows.length && spreadRows[next].idx <= i) {
        current = spreadRows[next].amount;
        next++;
      }
      spread[i] = current;
    }
  }

  return { pct, fixed, oneOff, spread, hasSpread: spreadRows.length > 0 };
}

/**
 * One stream's per-year series, in the module's LOCAL currency, SIGNED (an expense is
 * negative). Pure: no db, no fs, no mutation of its inputs.
 *
 * ctx: { startyear, endyear, yearsCount, periodStart, inflationSeries, inflationLen,
 *        marketValues, baseMarketValue, loanRate }
 */
function computeStreamSeries(stream, ctx) {
  const { yearsCount, startyear, endyear, periodStart, inflationSeries, inflationLen } = ctx;
  const out = new Array(yearsCount).fill(0);
  const mode = stream.mode || 'amount';
  const magnitude = Math.abs(parseFloat(stream.amount) || 0);
  const { pct, fixed, oneOff, spread, hasSpread } = expandChanges(stream, ctx);

  if (mode === 'amount') {
    // The recursion. Note the FIRST year already carries one period of growth — true of both
    // sources today (the item's `BaseValue × (1 + changeP[0]/100)`, and the module's
    // `periodNum = year − periodStart + 1` giving one multiplication at periodStart).
    const level = new Array(yearsCount).fill(0);
    const hasDriver = magnitude > 0 || fixed.some((v) => v !== 0) || oneOff.some((v) => v !== 0);
    if (hasDriver) {
      // The recursion seeds from the amount at the FIRST IN-RANGE year, not at index 0.
      //
      // The two source builders had different axes and that difference is load-bearing. An
      // inc/exp item's array started AT PeriodStart, so index 0 was always the first modelled
      // year. A module's array starts at its own `base_date` — 2025 on 18 of 21 prod modules,
      // against a PeriodStart of 2027 — so indices 0 and 1 are BEFORE the horizon and carry
      // nothing. Seeding at index 0 there would compound from a zero the projection had just
      // written, and the whole stream would come out flat zero for all 36 years.
      //
      // The old module code hid this by recomputing from scratch every year
      // (`compounded = amount; for j...`), which has no memory to poison. The recursion has
      // memory, so it needs to know where the series actually begins. Caught by the sums
      // gate: `Property Costs`, `Barkeria Income` and `UB Income` vanished entirely.
      let started = false;
      for (let i = 0, year = startyear; year <= endyear; i++, year++) {
        const idx = year - periodStart;
        const inRange = idx >= 0 && idx < inflationLen;
        if (!inRange) { level[i] = 0; out[i] = 0; continue; }
        const prev = started ? level[i - 1] : magnitude;
        started = true;
        level[i] = prev * (1 + (pct[i] ?? 0) / 100) + fixed[i];
        out[i] = level[i] + oneOff[i];
      }
    }
  } else if (mode === 'yield') {
    // Effective yield = inflation + spread, on the AVERAGE market value across the year.
    // `hasSpread` is not required: a yield stream with no rows is inflation-only, which is
    // what an empty forecast_module_income_pct schedule did.
    void hasSpread;
    const mv = ctx.marketValues || [];
    for (let i = 0, year = startyear; year <= endyear; i++, year++) {
      const idx = year - periodStart;
      if (idx < 0 || idx >= inflationLen) continue;
      const eff = (inflationSeries[idx] || 0) + (spread[i] || 0);
      out[i] = (((mv[i] || 0) + (mv[i - 1] ?? 0)) / 2) * eff / 100;
    }
  } else if (mode === 'pct_of_value') {
    // A % DERIVED from the base-year amount over the base-year market value, then applied to
    // the average market value each year. Falls back to compounding the amount when there is
    // no base value to derive from — both branches preserved from fcbuilder-module.
    const mv = ctx.marketValues || [];
    const base = ctx.baseMarketValue || 0;
    const derived = base !== 0 ? magnitude / base : 0;
    for (let i = 0, year = startyear; year <= endyear; i++, year++) {
      const idx = year - periodStart;
      if (idx < 0 || idx >= inflationLen) continue;
      if (derived !== 0) {
        out[i] = derived * (((mv[i] || 0) + (mv[i - 1] ?? 0)) / 2);
      } else {
        const periodNum = year - periodStart + 1;
        let compounded = magnitude;
        for (let j = 0; j < periodNum; j++) {
          if (j >= 0 && j < inflationLen) compounded *= (1 + inflationSeries[j] / 100);
        }
        out[i] = compounded;
      }
    }
    // pct_of_value is a magnitude of COST derived from a positive amount over a market value
    // that may be negative (a liability). CR062 P0: an expense is cash out on both sides of
    // the balance sheet, so the direction alone decides the sign — take the magnitude here
    // and let the caller's `direction` negate it exactly once.
    for (let i = 0; i < yearsCount; i++) out[i] = Math.abs(out[i]);
  } else if (mode === 'derived') {
    // CR062 — a loan's interest, charged on the AVERAGE outstanding balance. Read off the
    // final balance path rather than re-derived from the schedule, so interest can never
    // drift from principal.
    const mv = ctx.marketValues || [];
    const rate = ctx.loanRate;
    if (rate != null && Number.isFinite(rate)) {
      for (let i = 0, year = startyear; year <= endyear; i++, year++) {
        const idx = year - periodStart;
        if (idx < 0 || idx >= inflationLen) continue;
        const prev = i === 0 ? (ctx.baseMarketValue ?? 0) : (mv[i - 1] || 0);
        out[i] = (rate / 100) * Math.abs(((mv[i] || 0) + prev) / 2);
      }
    }
  }

  // `-1 * 0` is -0 in JavaScript, which survives JSON and reaches the database as "-0".
  // It compares equal to 0 everywhere that matters, so nothing would break — but a column
  // of -0.00 in an audit CSV is the kind of thing that costs someone an hour.
  const sign = stream.direction === 'expense' ? -1 : 1;
  for (let i = 0; i < yearsCount; i++) {
    const v = sign * out[i];
    out[i] = v === 0 ? 0 : v;
  }
  return out;
}

/**
 * CR046 window, unchanged: bounds WHEN a stream runs, never how much. Stored as July 1, so
 * the first and last year each carry half. Returns the indices it halved, so an ownership
 * gate does not halve one of them a second time and leave 25% of a year.
 */
function applyStreamWindow(series, stream, startyear, yearsCount) {
  const from = yearIndex(stream.start_date, startyear);
  const to = yearIndex(stream.end_date, startyear);
  if (from == null && to == null) return new Set();
  const halved = new Set();
  for (let i = 0; i < yearsCount; i++) {
    if ((from != null && i < from) || (to != null && i > to)) {
      series[i] = 0;
    } else if ((from != null && i === from) || (to != null && i === to)) {
      series[i] /= 2;
      halved.add(i);
    }
  }
  return halved;
}

module.exports = { computeStreamSeries, applyStreamWindow, expandChanges, yearIndex };
