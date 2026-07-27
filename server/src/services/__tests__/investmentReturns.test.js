/**
 * CR056 — Investment Returns arithmetic.
 *
 * Pure-function tests: no DB, so they run in CI against the fresh Postgres that
 * ci-seed.sql builds (a "verify against the dev DB" assertion would never run
 * where it claims to — the same shape as the CR's own B6 finding).
 *
 * The identity test carries a category-206 posting and a NULL-category row on
 * purpose: both are invisible to rev 1's bucketing, which is what let the real
 * report be silently off by $8,781.87 on Fidelity IRA 2025.
 */

const {
  splitIntervals,
  splitByMarks,
  boundaryAligned,
  averageCapital,
  returnOn,
  markTolerance,
  chainReturns,
  longestSupportedRun,
  annualize,
  isCovered,
  coverageShare,
  bucketOf,
} = require('../investmentReturns');

describe('splitIntervals', () => {
  it('splits months and clips partial first/last spans to their own length', () => {
    const out = splitIntervals('2025-01-15', '2025-03-10', 'month');
    expect(out.map((i) => [i.key, i.start, i.end])).toEqual([
      ['2025-01', '2025-01-15', '2025-01-31'],
      ['2025-02', '2025-02-01', '2025-02-28'],
      ['2025-03', '2025-03-01', '2025-03-10'],
    ]);
  });

  it('anchors quarters to the calendar regardless of where the period starts', () => {
    const out = splitIntervals('2025-02-01', '2025-12-31', 'quarter');
    expect(out.map((i) => i.key)).toEqual(['2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4']);
    expect(out[0].start).toBe('2025-02-01'); // clipped, not back-dated to Jan 1
  });

  it('handles years and a single-day span', () => {
    expect(splitIntervals('2024-01-01', '2025-12-31', 'year').map((i) => i.key))
      .toEqual(['2024', '2025']);
    expect(splitIntervals('2025-06-10', '2025-06-10', 'month')).toHaveLength(1);
  });

  it('returns nothing when the range is inverted', () => {
    expect(splitIntervals('2025-06-01', '2025-01-01', 'month')).toEqual([]);
  });

  it('flags clipped spans as partial so a half period is not read as a full one', () => {
    // The page clips toDate to today, so the current period is always short.
    const out = splitIntervals('2026-01-01', '2026-07-27', 'month');
    expect(out.map((i) => i.partial)).toEqual([
      false, false, false, false, false, false, true,
    ]);
    const full = splitIntervals('2025-01-01', '2025-12-31', 'year');
    expect(full[0].partial).toBe(false);
  });
});

describe('splitByMarks', () => {
  // United Beverages' real mark dates: annual on 31 March, no 2021, plus a
  // stray year-end. Every calendar boundary sits ~90 days from a valuation, so
  // calendar columns suppress the entire series.
  const UB = [
    '2019-03-31', '2020-03-31', '2022-03-31', '2022-03-31',
    '2023-03-31', '2024-03-31', '2025-03-31', '2025-12-31',
  ];

  it('opens each span the day after a mark so MV(start−1) lands on it', () => {
    const out = splitByMarks(UB, '2019-01-01', '2025-12-31');
    expect(out[0].start).toBe('2019-04-01');
    expect(out[0].end).toBe('2020-03-31');
    // the builder reads BMV at start−1, which must be the mark itself
    expect(out[0].start > '2019-03-31').toBe(true);
  });

  it('turns a missing mark into one long span, not two blank columns', () => {
    const out = splitByMarks(UB, '2019-01-01', '2025-12-31');
    const long = out.find((s) => s.start === '2020-04-01');
    expect(long.end).toBe('2022-03-31'); // 2021 was never marked
    expect(long.days).toBeGreaterThan(700);
  });

  it('deduplicates same-day marks and stays inside the requested period', () => {
    const out = splitByMarks(UB, '2019-01-01', '2025-12-31');
    expect(out).toHaveLength(6); // 7 distinct marks ⇒ 6 spans
    const clipped = splitByMarks(UB, '2023-01-01', '2025-03-31');
    expect(clipped.map((s) => s.end)).toEqual(['2024-03-31', '2025-03-31']);
  });

  it('returns nothing when fewer than two marks fall in the period', () => {
    expect(splitByMarks(UB, '2019-01-01', '2019-12-31')).toEqual([]);
    expect(splitByMarks([], '2019-01-01', '2025-12-31')).toEqual([]);
  });
});

describe('averageCapital / returnOn', () => {
  it('divides by the mean of the opening and closing balance', () => {
    expect(averageCapital(1000, 2000)).toBe(1500);
    expect(returnOn(150, 1000, 2000)).toBeCloseTo(0.1, 10);
  });

  it('returns null when the average is non-positive', () => {
    expect(averageCapital(0, 0)).toBeNull();
    expect(averageCapital(-5000, 100)).toBeNull();
    expect(returnOn(50, -5000, 100)).toBeNull();
  });

  it('guards an average that is positive but tiny (balance crossing zero)', () => {
    // Fidelity Stocks carries opening_balance -302,785.91 with no transactions
    // until 2020, so the average crosses zero; unguarded this yields ~1,000,000%.
    expect(averageCapital(-99998, 100000)).toBeNull();
  });

  it('reports each component on the same denominator', () => {
    const [bmv, emv] = [1000, 2000]; // average 1500
    expect(returnOn(75, bmv, emv)).toBeCloseTo(0.05, 10);  // realized
    expect(returnOn(300, bmv, emv)).toBeCloseTo(0.2, 10);  // unrealized
    expect(returnOn(375, bmv, emv)).toBeCloseTo(0.25, 10); // total
  });
});

describe('markTolerance', () => {
  it('scales with the period so an annual column is not lost to a month of drift', () => {
    // A flat ±5 days discarded a whole 365-day return because its opening mark
    // landed 31 days late.
    expect(markTolerance('2025-01-01', '2025-12-31')).toBe(60);
    expect(markTolerance('2025-01-01', '2025-03-31')).toBe(15);
    expect(markTolerance('2025-02-01', '2025-02-28')).toBe(5); // floor
  });
});

describe('chainReturns / longestSupportedRun / annualize', () => {
  it('links sub-period returns geometrically', () => {
    expect(chainReturns([0.1, 0.1])).toBeCloseTo(0.21, 10);
  });

  it('refuses to chain across a null — one broken link breaks the chain', () => {
    expect(chainReturns([0.1, null, 0.1])).toBeNull();
    expect(chainReturns([])).toBeNull();
  });

  it('finds the longest contiguous supported run', () => {
    expect(longestSupportedRun([null, 0.1, 0.2, null, 0.3])).toEqual({ start: 1, end: 2, len: 2 });
    expect(longestSupportedRun([null, null])).toBeNull();
  });

  it('annualizes only spans longer than a year', () => {
    expect(annualize(0.5, 365)).toBeNull();
    expect(annualize(0.21, 730)).toBeCloseTo(1.21 ** (365 / 730) - 1, 10);
    expect(annualize(-1.5, 730)).toBeNull(); // total wipeout: no real root
  });
});

describe('bucketOf — the buckets must be exhaustive', () => {
  const row = (o) => bucketOf({ category_name: 'X', is_transfer: false, category_section: 'profit_loss', ...o });

  it('routes a NULL category to unattributed rather than dropping it', () => {
    expect(row({ category_name: null })).toBe('unattributed');
  });

  it('counts Transfer - Securities Trades as a flow', () => {
    // Its legs pair and cancel, so what survives is the unpaired remainder —
    // historically real deposits (Fidelity Stocks 2020: +$200,460.86).
    expect(row({ category_name: 'Transfer - Securities Trades', is_transfer: true })).toBe('flow');
  });

  it('separates the mark from ordinary income', () => {
    expect(row({ category_name: 'Unrealized G/L' })).toBe('price');
    expect(row({ category_name: 'Financial Income - Dividend' })).toBe('income');
  });

  it('routes a non-P&L category to unattributed', () => {
    expect(row({ category_section: 'balance_sheet' })).toBe('unattributed');
  });
});

describe('the reconciliation identity', () => {
  /** Mirrors the builder's arithmetic over a hand-built ledger. */
  const settle = (txns, bmv, emv) => {
    const sum = (b) => txns.filter((t) => t.bucket === b).reduce((a, t) => a + t.amount, 0);
    const flows = sum('flow');
    const totalReturn = emv - bmv - flows;
    const fx = totalReturn - (sum('income') + sum('price') + sum('unattributed'));
    return { flows, totalReturn, fx, parts: sum('income') + sum('price') + sum('unattributed') + fx };
  };

  it('closes with a category-206 posting and a NULL-category row present', () => {
    // Both are invisible to rev 1's bucketing; this is the case that failed.
    const txns = [
      { bucket: 'flow', amount: 8000 },          // Transfer - Bank
      { bucket: 'flow', amount: -8781.87 },      // Transfer - Securities Trades remainder
      { bucket: 'income', amount: 8921.63 },
      { bucket: 'price', amount: 36162.93 },
      { bucket: 'unattributed', amount: 0 },
    ];
    const { totalReturn, parts, flows } = settle(txns, 226778.29, 271080.98);
    expect(flows).toBeCloseTo(-781.87, 6);
    expect(parts).toBeCloseTo(totalReturn, 6);
    expect(226778.29 + flows + totalReturn).toBeCloseTo(271080.98, 6);
  });

  it('leaves FX exactly zero for an all-USD account', () => {
    const txns = [
      { bucket: 'flow', amount: 100 },
      { bucket: 'income', amount: 10 },
      { bucket: 'price', amount: 40 },
    ];
    const { fx } = settle(txns, 1000, 1150);
    expect(fx).toBeCloseTo(0, 10);
  });

  it('parks an unexplained NULL-category row in unattributed, not in FX', () => {
    const txns = [
      { bucket: 'income', amount: 10 },
      { bucket: 'unattributed', amount: -99986.71 }, // prod: Chase Checking
    ];
    const { fx, parts, totalReturn } = settle(txns, 100000, 23.29);
    expect(fx).toBeCloseTo(0, 6);
    expect(parts).toBeCloseTo(totalReturn, 6);
  });
});

describe('coverage', () => {
  const marks2025 = ['2025-01-31', '2025-02-28', '2025-03-31'];

  it('covers a period that contains a valuation, wherever in the span it falls', () => {
    // United Beverages anchors on 31 March. The table already PRINTS calendar
    // 2024's +5,375,000, so refusing to divide it was incoherent — it is now
    // covered, and flagged as dated to the valuation (see boundaryAligned).
    expect(isCovered(['2024-03-31', '2025-03-31'], '2024-01-01', '2024-12-31')).toBe(true);
    expect(isCovered(marks2025, '2025-02-01', '2025-02-28')).toBe(true);
  });

  it('suppresses only a period that was never valued at all', () => {
    const ub = ['2020-03-31', '2022-03-31']; // no 2021 valuation ever
    expect(isCovered(ub, '2021-01-01', '2021-12-31')).toBe(false);
    // Fidelity: first mark 2025-01-31, so 2024 has no valuation of any kind
    expect(isCovered(['2025-01-31', '2025-12-31'], '2024-01-01', '2024-12-31')).toBe(false);
  });

  it('does NOT count a mark that only sits on the opening boundary', () => {
    // It values the period's OPENING, not the period. Counting it made UB's
    // 2026-YTD column report a confident 0.00% price movement when nothing had
    // valued 2026 at all.
    expect(isCovered(['2024-12-31'], '2025-01-01', '2025-12-31')).toBe(false);
    expect(isCovered(['2024-12-31', '2025-06-30'], '2025-01-01', '2025-12-31')).toBe(true);
  });

  it('flags whether the valuations actually landed on the boundaries', () => {
    const ub = ['2024-03-31', '2025-03-31'];
    // covered, but dated to 31 March — not to calendar 2024
    expect(boundaryAligned(ub, '2024-01-01', '2024-12-31')).toBe(false);
    // Fidelity's month-end marks DO land on a calendar year's boundaries
    expect(boundaryAligned(['2024-12-31', '2025-12-31'], '2025-01-01', '2025-12-31')).toBe(true);
  });

  it('is not covered when every valuation falls outside the period', () => {
    // Marks straddling the span but never inside it: nothing valued this month.
    expect(isCovered(['2025-01-29', '2025-03-02'], '2025-02-01', '2025-02-28')).toBe(false);
  });

  it('allows a few days of slack when judging boundary ALIGNMENT', () => {
    // Tolerance now governs "did the valuation land on the boundary", not
    // "is there a valuation at all".
    expect(boundaryAligned(['2025-01-29', '2025-03-02'], '2025-02-01', '2025-02-28')).toBe(true);
    expect(boundaryAligned(['2025-01-20', '2025-03-02'], '2025-02-01', '2025-02-28')).toBe(false);
  });

  it('weights coverage by BMV so a small unmarked member does not poison a roll-up', () => {
    // Prod: Fidelity Options is 51,502 of 1,173,057 = 4.4% at 2024-12-31.
    const members = [
      { id: 1, name: 'Fidelity Stocks' }, { id: 2, name: 'Fidelity IRA' }, { id: 3, name: 'Fidelity Options' },
    ];
    const { share, uncovered } = coverageShare(
      members,
      { 1: marks2025, 2: marks2025, 3: [] },
      { 1: 894776.48, 2: 226778.29, 3: 51502.17 },
      '2025-02-01', '2025-02-28'
    );
    expect(share).toBeGreaterThan(0.95);
    expect(uncovered).toEqual([
      { account: 'Fidelity Options', shareOfBMV: expect.closeTo(0.0439, 3), firstMark: null },
    ]);
  });

  it('lands a cash-heavy roll-up in the badge band rather than suppressing it', () => {
    // Fidelity Fixed Income: Cash Mgt 778,982 (never marked, correctly — cash)
    // + Bond 1,229,468. A hard 90% cut-off would hide the sleeve forever.
    const { share } = coverageShare(
      [{ id: 1, name: 'Fidelity Bond' }, { id: 2, name: 'Fidelity Cash Mgt' }],
      { 1: ['2026-05-31', '2026-06-30'], 2: [] },
      { 1: 1229468.29, 2: 778981.54 },
      '2026-06-01', '2026-06-30'
    );
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.9);
  });

  it('gives a never-marked holding zero coverage', () => {
    const { share } = coverageShare(
      [{ id: 1, name: 'SP - Panorama Mar 6' }], { 1: [] }, { 1: 421992.12 },
      '2025-01-01', '2025-12-31'
    );
    expect(share).toBe(0);
  });
});
