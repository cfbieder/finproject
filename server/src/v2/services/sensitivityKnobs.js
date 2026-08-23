'use strict';
// CR085 P1 — what a sensitivity run is allowed to move, and the arithmetic for moving it.
//
// A knob is `{ entity, target, field, kind, low, high }`. The catalogue below is a CLOSED
// whitelist: a field name never reaches SQL as an identifier unless it is a key in here.
//
// ⚠️ THE KIND DECIDES THE ARITHMETIC, AND GETTING IT WRONG IS SILENT.
// "±10%" is wrong for most of these fields, and "±1 percentage point" is wrong for others in a
// way that looks right. Every unit below was read out of the engine, not assumed:
//
//   • `forecast_modules.growth_rate` is a MULTIPLIER OF INFLATION, not a rate.
//     `growthPctForYear` returns `growthPct * inflationSeries[i]` (fcbuilder-common.js:104-118),
//     so 1.0 is "full CPI", 0 is "no growth" and prod carries -30 as a deliberate write-off.
//     ±1pp on a 1.0 would mean 0.0/2.0 — zeroing or doubling an asset's growth and calling it a
//     small stress. It is the same dimensionless kind as a stream's `growth_mult`.
//   • `loan_interest_rate` (live 6-7) and both `tax_rate_override` columns (live 0-23) ARE
//     percentage points: the engine divides them by 100 (fcbuilder-module.js:629, :635).
//   • `disposal_cost_pct` is percent as well (`gross * (pct / 100)`, fcbuilder-module.js:500).
//
// ⚠️ NULL IS LOAD-BEARING IN FIVE PLACES and every entry declares what its NULL means. A setter
// that writes 0 over a NULL `tax_rate_override` silently switches the module from "use the
// scenario rate" to "tax-free", which is not the knob anybody asked for.

const db = require('../db');

const KIND = Object.freeze({
  RATE: 'rate',             // percentage points
  LEVEL: 'level',           // relative %
  MULTIPLIER: 'multiplier', // absolute, dimensionless
  TIMING: 'timing',         // whole years
});

/** Default band per kind — editable per knob, printed beside every bar. */
const DEFAULT_BAND = Object.freeze({
  [KIND.RATE]: 1,
  [KIND.LEVEL]: 10,
  [KIND.MULTIPLIER]: 0.25,
  [KIND.TIMING]: 2,
});

/**
 * NULL semantics. `nullIs` is the value the ENGINE reads when the column is NULL, so a knob can
 * perturb from the right base; `nullIsScenarioRate` means the base has to be looked up; and
 * `refuseWhenNull` means the field cannot be perturbed from NULL at all, because materialising a
 * value would change the model's SHAPE rather than its size.
 */
const MODULE_FIELDS = Object.freeze({
  // ⚠️ `requiresValuation` is an ENGINE precondition, not a UI preference. `fcbuilder-module.js`
  // forces all three of these to zero when `has_valuation` is false:
  //     baseValues   = hasValuation ? BaseValue   : 0     (:142)
  //     marketValues = hasValuation ? MarketValue : 0     (:143)
  //     growthPct    = hasValuation ? Growth      : 0     (:288)
  // so on a flow module the knob writes, the build succeeds and NOTHING moves — a zero-length bar
  // that reads "this assumption does not matter" when the truth is "the engine never reads this
  // field here". Twelve of the thirty live modules on `2026 Base` are flow modules, so this was
  // roughly 36 no-op knobs on offer.
  growth_rate: {
    kind: KIND.MULTIPLIER, label: 'Growth (× inflation)', nullIs: 0, requiresValuation: true,
  },
  market_value: {
    kind: KIND.LEVEL, label: 'Market value', usdTwin: 'market_value_usd', nullIs: 0,
    requiresValuation: true,
  },
  base_value: {
    kind: KIND.LEVEL, label: 'Cost basis', usdTwin: 'base_value_usd', nullIs: 0,
    requiresValuation: true,
  },
  // The three loan fields are read only when the module actually carries a loan.
  loan_principal: { kind: KIND.LEVEL, label: 'Loan principal', nullIs: 0, requiresLoan: true },
  loan_interest_rate: { kind: KIND.RATE, label: 'Loan interest rate', nullIs: 0, requiresLoan: true },
  loan_end_date: {
    kind: KIND.TIMING, label: 'Loan end date', refuseWhenNull: true, requiresLoan: true,
  },
  // ⚠️ Not valuation-gated, but TAXABILITY-gated, and the difference cost a fifth zero bar.
  //
  // This column is read in exactly two places: as the capital-gains rate on a DISPOSAL, and as the
  // fallback for an INCOME stream's tax (`stream.tax_rate_override ?? module.tax_rate_override ??
  // scenarioRate`, fcbuilder-module.js:632-634). An expense-only flow module has neither — the
  // CHECK `fc_stream_tax_is_income_only` guarantees its expense streams carry no tax — so moving
  // this rate writes, builds, and moves nothing.
  //
  // Found in the shipped table: `Car Expenses · Tax rate (gains)` ranked with $0 down AND $0 up,
  // which in a ranked chart reads as "this assumption does not matter" rather than "this rate is
  // never read here".
  tax_rate_override: {
    kind: KIND.RATE, label: 'Tax rate (gains)', nullIsScenarioRate: true, requiresTaxable: true,
  },
});

const STREAM_FIELDS = Object.freeze({
  amount: {
    kind: KIND.LEVEL, label: 'Amount', usdTwin: 'amount_usd', nullIs: 0,
    // ⚠️ `amount` is 0 BY CONSTRUCTION on yield and pct_of_value streams, so a knob on it is a
    // guaranteed no-op — and a 0-impact bar reads as "this does not matter", which is the exact
    // misreading the ambiguity guard exists to prevent. The whitelist is keyed on (field, mode).
    modes: ['amount'],
  },
  // ⚠️ ONLY THE `amount` BRANCH READS THIS — the eighth knob found that could not move anything.
  // `growth_mult` feeds exactly one thing: `pct[i] = inflationSeries[idx] * mult`
  // (fcbuilder-stream.js:69-80). The `yield` branch computes `eff = inflation + spread` and never
  // touches `pct`; `pct_of_value` derives from the market value and never touches it either. So on
  // a yield or pct_of_value stream this knob writes, builds, and moves NOTHING —
  // `Fidelity Fixed Income · Growth (× inflation)` came back "moved the plan by nothing
  // measurable" on a real run, which is how it was found.
  growth_mult: {
    kind: KIND.MULTIPLIER, label: 'Growth (× inflation)', nullIs: 1, modes: ['amount'],
  },
  tax_rate_override: {
    kind: KIND.RATE, label: 'Tax rate (income)', nullIsScenarioRate: true,
    directions: ['income'],   // CHECK fc_stream_tax_is_income_only
  },
  start_date: { kind: KIND.TIMING, label: 'Starts', refuseWhenNull: true },
  end_date: { kind: KIND.TIMING, label: 'Ends', refuseWhenNull: true },
});

const DISPOSAL_FIELDS = Object.freeze({
  // Disposing of a module the engine values at zero moves nothing — same gate, same reason.
  amount: { kind: KIND.LEVEL, label: 'Disposal amount', nullIs: 0, requiresValuation: true },
  disposal_cost_pct: {
    kind: KIND.RATE, label: 'Selling cost', nullIs: 0, requiresValuation: true,
    // CR078: NULL means "no selling cost modelled" and 0 means "considered, and free". They are
    // different statements, so a restore must put NULL back as NULL.
  },
  disposal_date: {
    kind: KIND.TIMING, label: 'Disposal date', refuseWhenNull: true, requiresValuation: true,
  },
});

const ENTITIES = Object.freeze({
  module: { table: 'forecast_modules', fields: MODULE_FIELDS },
  stream: { table: 'forecast_streams', fields: STREAM_FIELDS },
  disposal: { table: 'forecast_module_disposals', fields: DISPOSAL_FIELDS },
});

/** `derived`-mode streams are computed from another figure: perturbing one no-ops or double-counts. */
const EXCLUDED_STREAM_MODES = new Set(['derived']);

class KnobError extends Error {}

function specFor(entity, field) {
  const ent = ENTITIES[entity];
  if (!ent) throw new KnobError(`Unknown knob entity "${entity}"`);
  const spec = Object.prototype.hasOwnProperty.call(ent.fields, field) ? ent.fields[field] : null;
  if (!spec) throw new KnobError(`"${field}" is not a sensitivity knob on a ${entity}`);
  return { ...spec, entity, field, table: ent.table };
}

const knobId = (k) => [k.entity, k.target.module, k.target.direction ?? k.target.date ?? '', k.field]
  .map((p) => String(p ?? '')).join('::');

// ---------------------------------------------------------------------------
// Resolution — BY NAME on the scratch, never by id
// ---------------------------------------------------------------------------

/**
 * ⚠️ `copyScenario` re-keys every id, so a real module id means nothing on the throwaway copy.
 * CR084 hit this and resolves by name (forecastPreview.js:100-112); CR053's `readScratchBaseline`
 * did the same before it.
 *
 * A target that resolves to ZERO rows, or to MORE THAN ONE, aborts the whole run naming the count.
 * A knob silently skipped is a knob that reads as harmless — it draws a zero-length bar in a chart
 * whose entire claim is that the bars are ranked.
 */
async function resolveTarget(client, scenarioId, entity, target) {
  const mod = await client.query(
    'SELECT * FROM forecast_modules WHERE scenario_id = $1 AND name = $2',
    [scenarioId, target.module]
  );
  if (mod.rows.length !== 1) {
    throw new KnobError(
      `Cannot place a knob on "${target.module}": the scenario holds ${mod.rows.length} modules ` +
      `with that name.`
    );
  }
  const moduleRow = mod.rows[0];
  if (entity === 'module') return { row: moduleRow, moduleRow };

  if (entity === 'stream') {
    // `(direction, fc_line_id)` matches the two partial unique indexes on forecast_streams —
    // one WHERE fc_line_id IS NOT NULL, one WHERE it IS NULL — so NULL is a DISTINCT key value
    // here, not a wildcard. Live modules do carry NULL fc_line_id.
    const r = await client.query(
      `SELECT * FROM forecast_streams
        WHERE module_id = $1 AND direction = $2
          AND fc_line_id IS NOT DISTINCT FROM $3`,
      [moduleRow.id, target.direction, target.fcLineId ?? null]
    );
    if (r.rows.length !== 1) {
      throw new KnobError(
        `Cannot place a knob on the ${target.direction} stream of "${target.module}": ` +
        `${r.rows.length} streams match.`
      );
    }
    return { row: r.rows[0], moduleRow };
  }

  // disposal — forecast_module_disposals has NO unique constraint and exact duplicate rows are
  // legal (CR050 §3), so (module, disposal_date) is a key only because the live data says it is.
  // The guard is what makes relying on it safe rather than lucky.
  const r = await client.query(
    'SELECT * FROM forecast_module_disposals WHERE module_id = $1 AND disposal_date = $2',
    [moduleRow.id, target.date]
  );
  if (r.rows.length !== 1) {
    throw new KnobError(
      `Cannot place a knob on the ${target.date} disposal of "${target.module}": ` +
      `${r.rows.length} rows match.`
    );
  }
  return { row: r.rows[0], moduleRow };
}

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

const num = (v) => (v == null ? null : Number(v));

/** Shift a DATE by whole years, reading its LOCAL components. */
function shiftYears(value, years) {
  // ⚠️ node-postgres parses a DATE into a JS Date at LOCAL midnight; reading UTC components can
  // land on the previous day. This is the CR050 v3.0.110 defect — a DATE compared as an instant —
  // which reported three overrides for a one-field edit.
  const d = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  const y = d.getFullYear() + years;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The perturbed value for one side of one knob.
 * @returns {{ value: *, twin?: number }} what to write; `twin` is the USD column for a level knob.
 */
function perturb(spec, current, band, side, { scenarioRate = 0 } = {}) {
  const sign = side === 'low' ? -1 : 1;

  if (spec.kind === KIND.TIMING) {
    if (current == null) {
      throw new KnobError(
        `"${spec.label}" is not set on this row, and an open-ended date is a different MODEL, ` +
        `not a smaller number — a ±${band}y shift cannot materialise one.`
      );
    }
    return { value: shiftYears(current, sign * band) };
  }

  let base = num(current);
  if (base == null) {
    if (spec.nullIsScenarioRate) base = Number(scenarioRate) || 0;
    else if (spec.nullIs != null) base = spec.nullIs;
    else base = 0;
  }

  if (spec.kind === KIND.RATE || spec.kind === KIND.MULTIPLIER) {
    return { value: base + sign * band };            // absolute: pp for a rate, ×  for a multiplier
  }

  // LEVEL — relative, and it must move BOTH currency columns by the SAME factor.
  //
  // ⚠️ The engine derives a module's implied acquisition FX rate from BaseValue / BaseValueUSD
  // (fcbuilder-module.js:324) and, for a module marked USD, THROWS if the two disagree by more
  // than a cent (:166-177). Scaling one column alone either re-rates the module's currency or
  // aborts the build outright.
  if (base === 0) {
    throw new KnobError(
      `"${spec.label}" is 0 here, so a ±${band}% move is 0 — the bar would read as ` +
      `"this does not matter" when the truth is "there is nothing to move".`
    );
  }
  const factor = 1 + (sign * band) / 100;
  return { value: base * factor, factor };
}

// ---------------------------------------------------------------------------
// apply / restore
// ---------------------------------------------------------------------------

/**
 * Apply one side of one knob to the scratch.
 *
 * @returns {{restore: Function, value: *, before: *}} `restore()` puts back the value that was
 *   actually there; `value` is what the knob was moved TO and `before` what it was.
 *
 * ⚠️ `restore` REPLAYS A CAPTURED PRIOR VALUE. It never computes an inverse: `× 1/1.1` after
 * `× 1.1` does not return a NUMERIC(15,2) to where it started, and a lossy restore is the loop's
 * only silent failure mode — every later point would measure its own knob plus a residue.
 *
 * ⚠️ `value` and `before` are REPORTED, not just written. "±0.25×" on a growth of 0.8 does not
 * tell a reader it lands at 0.55 and 1.05, and "±50%" on a market value says nothing at all
 * without the value. The table shows the band AND both ends because the band alone is unreadable.
 */
async function applyKnob(client, scenarioId, knob, side, { scenarioRate = 0 } = {}) {
  const spec = specFor(knob.entity, knob.field);
  const { row, moduleRow } = await resolveTarget(client, scenarioId, knob.entity, knob.target);
  // Only the specs that need it pay for the extra reads, and the SETTER uses the same predicate
  // the picker does — two implementations of "may this knob move?" would drift into offering one
  // the run then refuses, or hiding one that works.
  assertApplicable(spec, row, moduleRow, await applicabilityContext(client, spec, moduleRow));

  const band = knob[side === 'low' ? 'lowBand' : 'highBand'] ?? knob.band ?? DEFAULT_BAND[spec.kind];
  const before = row[knob.field];
  const beforeTwin = spec.usdTwin ? row[spec.usdTwin] : undefined;

  const { value, factor } = perturb(spec, before, band, side, { scenarioRate });

  const cols = [knob.field];
  const vals = [value];
  if (spec.usdTwin) {
    const twinBase = num(beforeTwin);
    cols.push(spec.usdTwin);
    vals.push(twinBase == null ? null : twinBase * factor);
  }

  await writeRow(client, spec, row.id, cols, vals);

  const restore = async () => {
    const restoreVals = spec.usdTwin ? [before, beforeTwin] : [before];
    await writeRow(client, spec, row.id, cols, restoreVals);
  };

  // ⚠️ The USD twin is REPORTED, not just written. The knob moves the module's OWN-currency
  // column, so `value` is PLN on a PLN module while every impact the page prints is USD. Shown
  // side by side with nothing to distinguish them, a reader forms the ratio "±50% of 15,000,000
  // moved the plan $4.1M" — about 27% — when the truth is $4.1M against $4,175,595, nearly all of
  // it. Wrong by 3.6×, and that ratio is the whole judgement this page supports.
  return {
    restore, value, before,
    valueUsd: spec.usdTwin ? (vals[1] ?? null) : null,
    beforeUsd: spec.usdTwin ? (beforeTwin ?? null) : null,
  };
}

/** Every column name here is a key of the closed catalogue above, never caller input. */
async function writeRow(client, spec, id, cols, vals) {
  for (const c of cols) {
    if (!Object.prototype.hasOwnProperty.call(ENTITIES[spec.entity].fields, c) && c !== spec.usdTwin) {
      throw new KnobError(`Refusing to write "${c}" — not in the knob catalogue`);
    }
  }
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  await client.query(`UPDATE ${spec.table} SET ${sets} WHERE id = $1`, [id, ...vals]);
}

async function applicabilityContext(client, spec, moduleRow) {
  if (!spec.requiresTaxable || !moduleRow) return {};
  const [streams, disposals] = await Promise.all([
    client.query('SELECT direction FROM forecast_streams WHERE module_id = $1', [moduleRow.id]),
    client.query('SELECT id FROM forecast_module_disposals WHERE module_id = $1', [moduleRow.id]),
  ]);
  return { streams: streams.rows, disposals: disposals.rows };
}

function assertApplicable(spec, row, moduleRow, context = {}) {
  if (spec.entity === 'stream') {
    if (EXCLUDED_STREAM_MODES.has(row.mode)) {
      throw new KnobError(
        `"${spec.label}" cannot be sensitised on a ${row.mode}-mode stream: it is computed from ` +
        `another figure, so moving it either does nothing or double-counts.`
      );
    }
    if (spec.modes && !spec.modes.includes(row.mode)) {
      throw new KnobError(
        `"${spec.label}" is 0 by construction on a ${row.mode}-mode stream, so the knob is a ` +
        `guaranteed no-op and its bar would read as "this does not matter".`
      );
    }
    if (spec.directions && !spec.directions.includes(row.direction)) {
      throw new KnobError(`"${spec.label}" applies only to ${spec.directions.join('/')} streams.`);
    }
  }
  if (spec.refuseWhenNull && row[spec.field] == null) {
    throw new KnobError(`"${spec.label}" is not set on this row, so there is nothing to shift.`);
  }

  if (spec.requiresValuation && moduleRow && !moduleRow.has_valuation) {
    throw new KnobError(
      `"${moduleRow.name}" carries no valuation, so the engine reads its value and growth as ` +
      `ZERO — "${spec.label}" would move nothing. This module is its streams; sensitise one of ` +
      `those instead.`
    );
  }

  if (spec.requiresLoan && moduleRow && moduleRow.loan_principal == null) {
    throw new KnobError(`"${moduleRow.name}" carries no loan, so "${spec.label}" is never read.`);
  }

  if (spec.requiresTaxable && moduleRow) {
    const hasIncome = (context.streams || []).some((st) => st.direction === 'income');
    const hasGains = Boolean(moduleRow.has_valuation) && (context.disposals || []).length > 0;
    if (!hasIncome && !hasGains) {
      throw new KnobError(
        `"${moduleRow.name}" has nothing this rate applies to — no income stream to tax and no ` +
        `disposal to realise a gain on — so "${spec.label}" would move nothing.`
      );
    }
  }

  // ⚠️ THE EXCLUDED-MODULE GUARD APPLIES TO EVERY ENTITY, NOT JUST TO MODULE FIELDS.
  //
  // The engine skips an `exclude` module entirely, so a knob anywhere underneath it — a stream
  // amount, a disposal date, a selling cost — writes successfully, builds successfully and moves
  // NOTHING. Caught on the first live run: a ±2y shift of `New Business`'s 2040 disposal returned
  // rowsChanged=0 and a zero-length bar, which in a ranked chart reads as "this assumption does
  // not matter" when the truth is "this module is not in the plan". The first version of this
  // guard tested `spec.entity === 'module'` and let both child entities through.
  if (moduleRow && moduleRow.setup_status === 'exclude') {
    throw new KnobError(
      `"${moduleRow.name}" is excluded from this scenario, so every bar for it would be zero — ` +
      `not because the assumption does not matter, but because the module is not in the plan. ` +
      `Include it in a variant instead: that is a different plan, not a smaller number.`
    );
  }
}

/**
 * Which of the four groups a knob belongs in — asset · liability · income · expense.
 *
 * ⚠️ Keyed on what the ENGINE branches on: `has_valuation`, the SIGN of the value, the presence of
 * a loan, and a stream's `direction`. **Never on `module_type`**, which is free text the owner
 * edits — prod carries both `Asset` and `Business` and nothing constrains it. CR070 records the
 * same rule for module capabilities and for the same reason.
 *
 * A liability is a module the engine treats as debt: it carries a loan, or its value is negative
 * (`moduleWrite.js` treats `market_value < 0` as debt; the engine's worked example is
 * `PLN Credit Cards` at −24,542.66).
 */
function knobGroup(spec, row, moduleRow, streams = []) {
  if (spec.entity === 'stream') return row.direction === 'income' ? 'income' : 'expense';

  const isDebt = moduleRow.loan_principal != null
    || Number(moduleRow.market_value) < 0
    || Number(moduleRow.base_value) < 0;

  if (moduleRow.has_valuation) return isDebt ? 'liability' : 'asset';

  // A flow module IS its streams, so a module-level knob on one inherits their direction.
  const dirs = new Set(streams.map((st) => st.direction));
  if (dirs.has('income') && !dirs.has('expense')) return 'income';
  if (dirs.has('expense') && !dirs.has('income')) return 'expense';
  if (dirs.has('income')) return 'income';
  return 'other';
}

/** Display order — balance sheet first, then the flows, as the owner reads a plan. */
const GROUPS = Object.freeze([
  { key: 'asset', label: 'Assets' },
  { key: 'liability', label: 'Liabilities' },
  { key: 'income', label: 'Income' },
  { key: 'expense', label: 'Expenses' },
  { key: 'other', label: 'Other' },
]);

module.exports = {
  KIND,
  knobGroup,
  GROUPS,
  DEFAULT_BAND,
  KnobError,
  ENTITIES,
  MODULE_FIELDS,
  STREAM_FIELDS,
  DISPOSAL_FIELDS,
  specFor,
  knobId,
  resolveTarget,
  applyKnob,
  // exposed for unit tests
  _internals: { perturb, shiftYears, assertApplicable },
};
