/**
 * CR085 §15 cut 5 — the picker must not open empty, and the set it opens with must not read as an
 * ANSWER. Pure: no DB, no engine, just the selection rule.
 */
const { _internals } = require('../forecastSensitivity');

const { markStartingSet, STARTING_SET_SIZE, STARTING_SET_FLOOR } = _internals;

const knob = (over) => ({ kind: 'level', field: 'market_value', group: 'asset', ...over });
const started = (list) => markStartingSet(list).filter((k) => k.starting);

describe('the starting set — the biggest numbers, not the biggest levers', () => {
  it('picks nothing when nothing has a magnitude', () => {
    // Rates, multipliers and dates have no comparable size, so they are never candidates.
    expect(started([
      knob({ kind: 'rate', usdMagnitude: null }),
      knob({ kind: 'timing', usdMagnitude: null }),
      knob({ kind: 'multiplier', usdMagnitude: null }),
    ])).toEqual([]);
    expect(markStartingSet([])).toEqual([]);
  });

  it('takes one knob per group before a second from any', () => {
    // A plan whose four biggest numbers are all assets must not open with four ways of asking the
    // same question.
    const out = started([
      knob({ usdMagnitude: 900, module: 'a1' }),
      knob({ usdMagnitude: 800, module: 'a2' }),
      knob({ usdMagnitude: 700, module: 'a3' }),
      knob({ usdMagnitude: 600, module: 'i1', group: 'income' }),
      knob({ usdMagnitude: 500, module: 'e1', group: 'expense' }),
    ]);
    // The three group leaders are all in; the two asset runners-up fill the rest. (The marks are
    // returned in CATALOGUE order, not pick order, so this asserts membership.)
    expect(new Set(out.map((k) => k.module))).toEqual(new Set(['a1', 'i1', 'e1', 'a2', 'a3']));
    expect(out).toHaveLength(STARTING_SET_SIZE);
  });

  /**
   * ⚠️ BREADTH HAS A FLOOR, or it reproduces this CR's own pathology. On `2026 Base` the largest
   * LIABILITY is `USD Credit Cards` at $27,187 against `United Beverages` at $4,175,595 — 150×
   * smaller. Included for balance it draws a bar of a few pixels beside one that fills the chart,
   * and a bar that renders as nothing reads as "this assumption does not matter".
   */
  // ⚠️ And it applies to BOTH passes. The floor first guarded only the breadth pass, so with few
  // candidates a knob 150× smaller could still get in by SIZE — same few-pixel bar, admitted
  // through the other door. A short starting set is better than a padded one.
  it('leaves out a group whose best candidate is under 1% of the largest', () => {
    const out = started([
      knob({ usdMagnitude: 4_000_000, module: 'big' }),
      knob({ usdMagnitude: 1_000_000, module: 'second' }),
      knob({ usdMagnitude: 27_000, module: 'tiny', group: 'liability' }),
    ]);
    expect(out.map((k) => k.module)).toEqual(['big', 'second']);
    expect(STARTING_SET_FLOOR).toBe(0.01);
  });

  it('keeps a small group leader that clears the floor', () => {
    const out = started([
      knob({ usdMagnitude: 1_000_000, module: 'big' }),
      knob({ usdMagnitude: 30_000, module: 'flow', group: 'expense' }),   // 3% — kept
    ]);
    expect(out.map((k) => k.module)).toEqual(['big', 'flow']);
  });

  it('excludes the cost basis — a tax input, not a driver of the plan', () => {
    // §22 established it only moves anything at all when the module is sold, so it is a poor
    // opening question however large the number is.
    const out = started([
      knob({ usdMagnitude: 9_000_000, field: 'base_value', module: 'basis' }),
      knob({ usdMagnitude: 1_000_000, module: 'mv' }),
    ]);
    expect(out.map((k) => k.module)).toEqual(['mv']);
  });

  it('never marks more than the set size, and never a zero', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      knob({ usdMagnitude: 1000 - i, module: `m${i}`, group: `g${i % 4}` }));
    expect(started(many)).toHaveLength(STARTING_SET_SIZE);
    expect(started([knob({ usdMagnitude: 0 }), knob({ usdMagnitude: null })])).toEqual([]);
  });

  it('returns the WHOLE catalogue, marking in place rather than filtering', () => {
    const list = [knob({ usdMagnitude: 100 }), knob({ kind: 'rate', usdMagnitude: null })];
    expect(markStartingSet(list)).toHaveLength(2);
  });
});
