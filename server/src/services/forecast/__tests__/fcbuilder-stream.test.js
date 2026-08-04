/**
 * CR069 P2 — the one stream evaluator, proved against the three implementations it replaces.
 *
 * These are equivalence tests, not behaviour tests: each asserts that the new evaluator
 * produces what the OLD code produced, using the old code's own formulas written out
 * independently. That is the only thing standing between a 1,000-line refactor and a silent
 * change to a number the owner reads.
 */

const { computeStreamSeries, applyStreamWindow, expandChanges } = require('../fcbuilder-stream');

const PERIOD_START = 2026;
const PERIOD_END = 2030;
const INFLATION = [2, 2.5, 3, 2, 2]; // periodStart .. periodEnd

const ctx = (over = {}) => ({
  startyear: PERIOD_START,
  endyear: PERIOD_END,
  yearsCount: PERIOD_END - PERIOD_START + 1,
  periodStart: PERIOD_START,
  inflationSeries: INFLATION,
  inflationLen: INFLATION.length,
  marketValues: [],
  baseMarketValue: 0,
  loanRate: null,
  ...over,
});

const stream = (over = {}) => ({
  direction: 'expense', mode: 'amount', amount: 0, growth_mult: null,
  start_date: null, end_date: null, changes: [], ...over,
});

describe('amount mode — equivalence with fcbuilder-incexp', () => {
  test('plain growth reproduces the item recursion exactly', () => {
    const s = stream({ direction: 'expense', amount: 1000, growth_mult: 1 });
    const got = computeStreamSeries(s, ctx());

    // The OLD inc/exp formula, written out independently:
    //   base[0] = BaseValue * (1 + infl[0]*g/100);  base[i] = base[i-1] * (1 + infl[i]*g/100)
    const expected = [];
    let base = -1000; // the item stored an expense NEGATIVE
    for (let i = 0; i < INFLATION.length; i++) {
      base = base * (1 + (INFLATION[i] * 1) / 100);
      expected.push(base);
    }
    got.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 8));
  });

  test('a growth multiplier scales inflation, and 0 is flat in nominal terms', () => {
    const half = computeStreamSeries(stream({ amount: 1000, growth_mult: 0.5 }), ctx());
    const flat = computeStreamSeries(stream({ amount: 1000, growth_mult: 0 }), ctx());
    let b = -1000;
    for (let i = 0; i < INFLATION.length; i++) b *= (1 + (INFLATION[i] * 0.5) / 100);
    expect(half[INFLATION.length - 1]).toBeCloseTo(b, 8);
    flat.forEach((v) => expect(v).toBeCloseTo(-1000, 8));
  });

  test('NULL growth_mult means inflation — the dormant default', () => {
    const a = computeStreamSeries(stream({ amount: 1000, growth_mult: null }), ctx());
    const b = computeStreamSeries(stream({ amount: 1000, growth_mult: 1 }), ctx());
    expect(a).toEqual(b);
  });

  test("Percent % overrides the rate for ITS YEAR ONLY, and the level change persists", () => {
    const s = stream({
      amount: 1000, growth_mult: 1,
      changes: [{ change_date: '2028-12-31', amount: -100, flag: 'Percent %' }],
    });
    const got = computeStreamSeries(s, ctx());
    // -100% in 2028 → that year's level is zero, and the recursion keeps it at zero after.
    expect(got[2]).toBeCloseTo(0, 10);
    expect(got[3]).toBeCloseTo(0, 10);
    expect(got[4]).toBeCloseTo(0, 10);
    // ...but the years before it are untouched.
    expect(got[0]).toBeCloseTo(-1020, 8);
  });

  test('the -100% row is a REDUCTION on an expense, never a doubling (migration 057)', () => {
    // `Children`'s real shape: a negative Percent % on an expense means the expense ENDS.
    // If the backfill had negated rate rows, this would come back at 2x instead of 0.
    const got = computeStreamSeries(stream({
      direction: 'expense', amount: 72408.98, growth_mult: 1,
      changes: [{ change_date: '2029-12-31', amount: -100, flag: 'Percent %' }],
    }), ctx());
    expect(got[3]).toBeCloseTo(0, 10);
    expect(Math.abs(got[2])).toBeGreaterThan(70000); // still running the year before
  });

  test('Fixed $ is a permanent level shift that compounds from its own year', () => {
    const s = stream({
      direction: 'income', amount: 0, growth_mult: 1,
      changes: [{ change_date: '2028-12-31', amount: 10000, flag: 'Fixed $' }],
    });
    const got = computeStreamSeries(s, ctx());
    expect(got[0]).toBeCloseTo(0, 10);
    expect(got[1]).toBeCloseTo(0, 10);
    expect(got[2]).toBeCloseTo(10000, 8);
    // then it grows at the stream's rate, from ITS OWN year
    expect(got[3]).toBeCloseTo(10000 * (1 + INFLATION[3] / 100), 8);
    expect(got[4]).toBeCloseTo(10000 * (1 + INFLATION[3] / 100) * (1 + INFLATION[4] / 100), 8);
  });

  test('Fixed $ absorbs a CR064 P6 income step — same math, proved against growIncome', () => {
    const stepYear = 2028;
    const amount = 10000;
    const got = computeStreamSeries(stream({
      direction: 'income', amount: 0, growth_mult: 1,
      changes: [{ change_date: `${stepYear}-07-01`, amount, flag: 'Fixed $' }],
    }), ctx());

    // CR064 P6's growIncome, written out independently:
    //   for (y = fromYear; y < toYear; y++) out *= (1 + inflation[y - periodStart + 1] * mult/100)
    const growIncome = (amt, fromYear, toYear) => {
      let out = amt;
      for (let y = fromYear; y < toYear; y++) {
        const j = y - PERIOD_START + 1;
        if (j >= 0 && j < INFLATION.length) out *= (1 + INFLATION[j] / 100);
      }
      return out;
    };
    for (let y = stepYear; y <= PERIOD_END; y++) {
      expect(got[y - PERIOD_START]).toBeCloseTo(growIncome(amount, stepYear, y), 8);
    }
  });

  test('a positive Fixed $ on an expense REDUCES it (the Children/Travel shape)', () => {
    // In the direction frame a change is "more of the stream" when positive. The migration
    // negates money rows for an expense, so the owner's +25,000 reduction arrives as -25,000
    // here and must shrink the expense.
    const got = computeStreamSeries(stream({
      direction: 'expense', amount: 72408.98, growth_mult: 0,
      changes: [{ change_date: '2028-12-31', amount: -25000, flag: 'Fixed $' }],
    }), ctx());
    expect(got[1]).toBeCloseTo(-72408.98, 6);
    expect(got[2]).toBeCloseTo(-(72408.98 - 25000), 6);
    expect(Math.abs(got[2])).toBeLessThan(Math.abs(got[1])); // it is a REDUCTION
  });

  test('One-Off $ hits its year only and never enters the base', () => {
    const got = computeStreamSeries(stream({
      direction: 'expense', amount: 1000, growth_mult: 0,
      changes: [{ change_date: '2028-12-31', amount: 65000, flag: 'One-Off $' }],
    }), ctx());
    expect(got[2]).toBeCloseTo(-66000, 6);
    expect(got[3]).toBeCloseTo(-1000, 6); // base untouched
  });

  test('a changes-only stream with a zero base still runs (15 live items are this shape)', () => {
    const got = computeStreamSeries(stream({
      direction: 'expense', amount: 0, growth_mult: 1,
      changes: [{ change_date: '2029-12-31', amount: 200000, flag: 'Fixed $' }],
    }), ctx());
    expect(got[0]).toBeCloseTo(0, 10);
    expect(got[3]).toBeCloseTo(-200000, 6);
  });

  test('a change dated before the axis is dropped, not counted', () => {
    const got = computeStreamSeries(stream({
      direction: 'income', amount: 100, growth_mult: 0,
      changes: [{ change_date: '2020-12-31', amount: 999999, flag: 'Fixed $' }],
    }), ctx());
    got.forEach((v) => expect(v).toBeCloseTo(100, 8));
  });
});

describe('the axis seed — a module whose base_date precedes PeriodStart', () => {
  // THE REGRESSION THIS FILE MISSED. Every other test here sets startyear === periodStart,
  // which is an inc/exp item's axis. A valuation module's axis starts at its OWN base_date —
  // 2025 against a PeriodStart of 2027 on 18 of 21 prod modules — so indices 0 and 1 are
  // before the horizon. Seeding the recursion at index 0 compounds from a zero the projection
  // just wrote, and `Property Costs`, `Barkeria Income` and `UB Income` vanished entirely.
  // Only the end-to-end sums gate caught it; these pin it here where it is cheap.
  const offsetCtx = (offset) => ({
    ...ctx(),
    startyear: PERIOD_START - offset,
    yearsCount: PERIOD_END - (PERIOD_START - offset) + 1,
  });

  test.each([1, 2, 3])('a %i-year offset still compounds from the amount, not from zero', (offset) => {
    const got = computeStreamSeries(
      stream({ direction: 'expense', amount: 45000, growth_mult: null }), offsetCtx(offset)
    );
    // Pre-horizon years carry nothing...
    for (let i = 0; i < offset; i++) expect(got[i]).toBe(0);
    // ...and the first modelled year is the amount with ONE period of growth, exactly as it
    // is when the axis starts at PeriodStart.
    expect(got[offset]).toBeCloseTo(-45000 * (1 + INFLATION[0] / 100), 6);
    // The whole series matches the offset-free case, shifted.
    const flat = computeStreamSeries(
      stream({ direction: 'expense', amount: 45000, growth_mult: null }), ctx()
    );
    for (let i = 0; i < INFLATION.length; i++) {
      expect(got[i + offset]).toBeCloseTo(flat[i], 6);
    }
  });

  test('a Fixed $ still lands on its own YEAR, not its own index', () => {
    const got = computeStreamSeries(stream({
      direction: 'income', amount: 0, growth_mult: 0,
      changes: [{ change_date: '2028-12-31', amount: 10000, flag: 'Fixed $' }],
    }), offsetCtx(2));
    // 2028 is index 4 on an axis starting at 2024.
    expect(got[3]).toBeCloseTo(0, 10);
    expect(got[4]).toBeCloseTo(10000, 6);
  });
});

describe('amount mode — equivalence with a module expense', () => {
  test("reproduces the module's compound-from-scratch loop term for term", () => {
    // OLD: compounded = amount; for (j = 0; j < periodNum; j++) compounded *= (1 + infl[j]/100)
    const amount = 45000;
    const got = computeStreamSeries(stream({ direction: 'expense', amount, growth_mult: null }), ctx());
    for (let y = PERIOD_START; y <= PERIOD_END; y++) {
      const periodNum = y - PERIOD_START + 1;
      let compounded = amount;
      for (let j = 0; j < periodNum; j++) compounded *= (1 + INFLATION[j] / 100);
      expect(got[y - PERIOD_START]).toBeCloseTo(-compounded, 6);
    }
  });
});

describe('yield mode — equivalence with income_pct', () => {
  const MV = [1000000, 1050000, 1102500, 1157625, 1215506];

  test('effective yield is inflation + spread on the average market value', () => {
    const got = computeStreamSeries(stream({
      direction: 'income', mode: 'yield',
      changes: [{ change_date: '2026-01-01', amount: -0.5, flag: 'Spread %' }],
    }), ctx({ marketValues: MV }));

    for (let i = 0; i < MV.length; i++) {
      const eff = INFLATION[i] + (-0.5);
      const expected = ((MV[i] + (MV[i - 1] ?? 0)) / 2) * eff / 100;
      expect(got[i]).toBeCloseTo(expected, 6);
    }
  });

  test('Spread % CARRIES FORWARD — the step function income_pct had', () => {
    const s = stream({
      direction: 'income', mode: 'yield',
      changes: [
        { change_date: '2026-01-01', amount: 1, flag: 'Spread %' },
        { change_date: '2029-01-01', amount: 3, flag: 'Spread %' },
      ],
    });
    const { spread } = expandChanges(s, ctx());
    expect(spread).toEqual([1, 1, 1, 3, 3]);
  });

  test('Percent % is single-year and Spread % persists — the two "percent" meanings', () => {
    const c = ctx();
    const sp = expandChanges(stream({ mode: 'yield', changes: [{ change_date: '2028-01-01', amount: 5, flag: 'Spread %' }] }), c).spread;
    const pc = expandChanges(stream({ growth_mult: 0, changes: [{ change_date: '2028-01-01', amount: 5, flag: 'Percent %' }] }), c).pct;
    expect(sp).toEqual([0, 0, 5, 5, 5]);   // carries
    expect(pc).toEqual([0, 0, 5, 0, 0]);   // one year only
  });

  test('no spread rows = an inflation-only yield (an empty income_pct schedule)', () => {
    const got = computeStreamSeries(stream({ direction: 'income', mode: 'yield' }), ctx({ marketValues: MV }));
    for (let i = 0; i < MV.length; i++) {
      expect(got[i]).toBeCloseTo(((MV[i] + (MV[i - 1] ?? 0)) / 2) * INFLATION[i] / 100, 6);
    }
  });
});

describe('pct_of_value mode — equivalence, including CR062 P0 signs', () => {
  test('derives a rate from base amount / base MV and applies it to the average', () => {
    const MV = [500000, 520000, 540800, 562432, 584929];
    const got = computeStreamSeries(
      stream({ direction: 'expense', mode: 'pct_of_value', amount: 5000 }),
      ctx({ marketValues: MV, baseMarketValue: 500000 })
    );
    const derived = 5000 / 500000;
    for (let i = 0; i < MV.length; i++) {
      expect(got[i]).toBeCloseTo(-(derived * ((MV[i] + (MV[i - 1] ?? 0)) / 2)), 6);
    }
  });

  test('an expense on a LIABILITY is still cash OUT — CR062 P0, the double-negation trap', () => {
    // Liabilities are stored with a NEGATIVE market value. The pre-CR062 code read
    // `isLiability ? val : -val`, which did not correct a sign but inverted one, CREDITING
    // the bank every year. Magnitude × direction cannot express that mistake.
    const MV = [-400000, -380000, -360000, -340000, -320000];
    const got = computeStreamSeries(
      stream({ direction: 'expense', mode: 'pct_of_value', amount: 20000 }),
      ctx({ marketValues: MV, baseMarketValue: -400000 })
    );
    got.forEach((v) => expect(v).toBeLessThan(0));
  });

  test('zero base market value falls back to compounding the amount at inflation', () => {
    const got = computeStreamSeries(
      stream({ direction: 'expense', mode: 'pct_of_value', amount: 1000 }),
      ctx({ marketValues: [0, 0, 0, 0, 0], baseMarketValue: 0 })
    );
    let compounded = 1000;
    compounded *= (1 + INFLATION[0] / 100);
    expect(got[0]).toBeCloseTo(-compounded, 6);
  });
});

describe('derived mode — a loan\'s interest (CR062)', () => {
  test('charges the rate on the AVERAGE outstanding balance, so a draw year is half', () => {
    const MV = [-100000, -90000, -80000, -70000, -60000];
    const got = computeStreamSeries(
      stream({ direction: 'expense', mode: 'derived' }),
      ctx({ marketValues: MV, baseMarketValue: 0, loanRate: 5 })
    );
    // draw year: average of (0, -100000) → half a year's interest on the full principal
    expect(got[0]).toBeCloseTo(-(5 / 100) * 50000, 6);
    for (let i = 1; i < MV.length; i++) {
      expect(got[i]).toBeCloseTo(-(5 / 100) * Math.abs((MV[i] + MV[i - 1]) / 2), 6);
    }
  });

  test('no rate = no interest, rather than a zero-rate charge', () => {
    const got = computeStreamSeries(
      stream({ mode: 'derived' }),
      ctx({ marketValues: [-100000, -100000, -100000, -100000, -100000], loanRate: null })
    );
    got.forEach((v) => expect(v).toBe(0));
  });
});

describe('the CR046 window', () => {
  test('zeroes outside and halves at each boundary year', () => {
    const series = [100, 100, 100, 100, 100];
    const halved = applyStreamWindow(series, { start_date: '2027-07-01', end_date: '2029-07-01' }, PERIOD_START, 5);
    expect(series).toEqual([0, 50, 100, 50, 0]);
    expect([...halved].sort()).toEqual([1, 3]);
  });

  test('start year == end year is halved ONCE, not twice', () => {
    const series = [100, 100, 100, 100, 100];
    applyStreamWindow(series, { start_date: '2028-07-01', end_date: '2028-07-01' }, PERIOD_START, 5);
    expect(series[2]).toBe(50);
  });

  test('an unbounded window changes nothing and reports nothing halved', () => {
    const series = [100, 100, 100, 100, 100];
    const halved = applyStreamWindow(series, { start_date: null, end_date: null }, PERIOD_START, 5);
    expect(series).toEqual([100, 100, 100, 100, 100]);
    expect(halved.size).toBe(0);
  });
});

describe('direction is the only thing that signs a stream', () => {
  test('the same stream, both directions, differs only in sign', () => {
    const base = { mode: 'amount', amount: 1000, growth_mult: 1, changes: [], start_date: null, end_date: null };
    const inc = computeStreamSeries({ ...base, direction: 'income' }, ctx());
    const exp = computeStreamSeries({ ...base, direction: 'expense' }, ctx());
    inc.forEach((v, i) => expect(v).toBeCloseTo(-exp[i], 10));
    inc.forEach((v) => expect(v).toBeGreaterThan(0));
  });
});
