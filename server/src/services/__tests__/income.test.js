'use strict';
/**
 * income.test.js — CR093 P3.
 *
 * ⚠️ No database. The coupon schedule is arithmetic over dates, and roadmap
 * issue #26 records what happens when arithmetic is tested through a builder
 * that reads every account's snapshots.
 *
 * The strongest assertions here are the ones taken from the CUSTODIAN'S OWN
 * printed Estimated Annual Income. All 27 bonds on the 2026-06 statement were
 * reproduced to the cent by this code; the two pinned below are the ones whose
 * answers a naive `face x coupon` gets wrong.
 */

const {
  couponDates, bondIncome, faceOf, summariseIncome, absenceGroup, addMonths,
} = require('../income');

describe('couponDates — walked backwards from maturity', () => {
  test('a semiannual bond pays on the maturity day and six months before it', () => {
    // Maturity anchors the schedule; there is no issue date to walk forward from.
    expect(couponDates('2027-02-11', 'semiannually', '2026-06-30', '2027-06-30'))
      .toEqual(['2026-08-11', '2027-02-11']);
  });

  test('🔴 nothing is generated after maturity — the bond stops paying', () => {
    // This is the entire reason the schedule exists rather than a multiplication.
    expect(couponDates('2026-12-15', 'semiannually', '2026-06-30', '2027-06-30'))
      .toEqual(['2026-12-15']);
  });

  test('a monthly CD pays on the maturity day of every month', () => {
    const d = couponDates('2028-11-27', 'monthly', '2026-09-05', '2027-09-05');
    expect(d).toHaveLength(12);
    expect(d[0]).toBe('2026-09-27');
    expect(d.every((x) => x.endsWith('-27'))).toBe(true);
  });

  test('a day-of-month past the end of a short month clamps rather than rolling over', () => {
    // A bond maturing on the 31st pays on the 30th in a 30-day month, not on the
    // 1st of the next one — which would move the payment into another bucket.
    const d = couponDates('2030-12-31', 'monthly', '2026-09-05', '2027-01-05');
    expect(d).toContain('2026-11-30');
    expect(d).not.toContain('2026-12-01');
  });

  test('`at_maturity` pays exactly once, on the day the principal returns', () => {
    expect(couponDates('2027-03-01', 'at_maturity', '2026-09-05', '2027-09-05'))
      .toEqual(['2027-03-01']);
    expect(couponDates('2030-03-01', 'at_maturity', '2026-09-05', '2027-09-05'))
      .toEqual([]);
  });

  test('a bond already matured pays nothing', () => {
    expect(couponDates('2020-01-01', 'semiannually', '2026-09-05', '2027-09-05')).toEqual([]);
  });
});

describe('faceOf — 🔴 `quantity` does not mean the same thing in every row', () => {
  // One security, one price_basis, two sources. Measured 2026-09-05 on
  // BLACKSTONE PRIVATE CREDIT FUND: the feed writes units of $100 and the
  // statement writes dollars of face. Both market values are correct, which is
  // why nothing ever complained — market_value is the column the reconciliation
  // gate reads.
  const feedRow = { price_basis: 'per_100_face', quantity: 150, price: 99.409, market_value: 14911.35 };
  const stmtRow = { price_basis: 'per_100_face', quantity: 100000, price: 100.0826, market_value: 100082.61 };

  test('derives the SAME face from either source, without knowing which wrote it', () => {
    expect(faceOf(feedRow)).toBeCloseTo(15000, 2);
    // Within a cent of face: the statement's printed price is itself rounded to
    // four decimals, so the derivation is approximate by construction — and the
    // 27-bond EAI comparison still reproduces every coupon to the cent.
    expect(faceOf(stmtRow)).toBeCloseTo(100000, 0);
  });

  test('a $1-par CD is handled by the same formula', () => {
    expect(faceOf({ price_basis: 'per_1_face', quantity: 200000, price: 0.9898, market_value: 197960 }))
      .toBeCloseTo(200000, 2);
  });

  test('an unusable row yields null rather than a plausible number', () => {
    expect(faceOf({ price_basis: 'per_share', price: 10, market_value: 100 })).toBeNull();
    expect(faceOf({ price_basis: 'per_100_face', price: 0, market_value: 100 })).toBeNull();
    expect(faceOf({ price_basis: 'per_100_face', price: 99, market_value: null })).toBeNull();
  });
});

describe('bondIncome — reproduces the custodian’s own printed EAI', () => {
  test('🔴 a bond maturing inside the window pays HALF what `face x coupon` says', () => {
    // The case CR093 §4 was written around. BLACKSTONE, 2.625% of 2026-12-15:
    // Fidelity prints EAI $196.87 against a coupon-implied $393.75, because only
    // one coupon remains. A "yield" from the naive figure would not fall as the
    // bond ran off — a maturing holding looking like a yield cut that never was.
    const r = bondIncome({
      price_basis: 'per_100_face', quantity: 150, price: 98.914, market_value: 14837.10,
      coupon_rate: 2.625, payment_frequency: 'semiannually', maturity_date: '2026-12-15',
    }, '2026-06-30', '2027-06-30');
    expect(r.face).toBeCloseTo(15000, 0);
    expect(r.total).toBeCloseTo(196.88, 2);          // statement: 196.87
    expect(r.total * 2).toBeCloseTo(393.75, 1);      // what the naive form gives
  });

  test('a bond maturing well beyond the window pays its full annual coupon', () => {
    // IBM INTL CAP 4.75% of 2031 — statement EAI $4,750.00.
    const r = bondIncome({
      price_basis: 'per_100_face', quantity: 1000, price: 100.0826, market_value: 100082.61,
      coupon_rate: 4.75, payment_frequency: 'semiannually', maturity_date: '2031-02-05',
    }, '2026-06-30', '2027-06-30');
    expect(r.payments).toBeUndefined();
    expect(r.dates).toHaveLength(2);
    expect(r.total).toBeCloseTo(4750, 2);
  });

  test('an annual payer gets one coupon, not two', () => {
    // BARCLAYS 4.55% of 2030-09-04 — statement EAI $455.00.
    const r = bondIncome({
      price_basis: 'per_100_face', quantity: 100, price: 100, market_value: 10000,
      coupon_rate: 4.55, payment_frequency: 'annually', maturity_date: '2030-09-04',
    }, '2026-06-30', '2027-06-30');
    expect(r.dates).toHaveLength(1);
    expect(r.total).toBeCloseTo(455, 2);
  });

  test('a callable bond still schedules to maturity, but says it is callable', () => {
    // A call cannot be predicted, so the income is not reduced for it — the fact
    // is carried instead, because a called bond simply stops paying.
    const r = bondIncome({
      price_basis: 'per_1_face', quantity: 100000, price: 1, market_value: 100000,
      coupon_rate: 4.1, payment_frequency: 'monthly', maturity_date: '2029-05-21',
      next_call_date: '2026-11-20',
    }, '2026-09-05', '2027-09-05');
    expect(r.total).toBeCloseTo(4100, 2);
    expect(r.callable_before).toBe('2026-11-20');
  });

  test('a security with no coupon is not a bond', () => {
    expect(bondIncome({ price_basis: 'per_share', quantity: 10, price: 5, market_value: 50 },
      '2026-09-05', '2027-09-05')).toBeNull();
  });
});

describe('summariseIncome — scheduled and estimated never become one number', () => {
  const bond = {
    id: 1, name: 'ZZ NOTE', price_basis: 'per_100_face', quantity: 100, price: 100,
    market_value: 10000, coupon_rate: 5, payment_frequency: 'semiannually',
    maturity_date: '2031-01-15',
  };
  const fund = {
    id: 2, ticker: 'ZZF', name: 'ZZ FUND', price_basis: 'per_share', quantity: 100,
    price: 50, market_value: 5000, ttm_income: 2, dividends_asked: true,
  };

  test('🔴 a coupon is contractual and a distribution is a projection', () => {
    // Merged, the page would say a fund's distribution is as reliable as a bond
    // coupon. They are reported apart first and combined second.
    const r = summariseIncome([bond, fund], '2026-09-05', '2027-09-05', 15000);
    expect(r.scheduled.total).toBeCloseTo(500, 2);
    expect(r.estimated.total).toBeCloseTo(200, 2);
    expect(r.total).toBeCloseTo(700, 2);
  });

  test('the monthly view carries both, kept apart', () => {
    const r = summariseIncome([bond, fund], '2026-09-05', '2027-09-05', 15000);
    const jan = r.by_month.find((m) => m.month === '2027-01');
    expect(jan.scheduled).toBeCloseTo(250, 2);
    // The distribution is spread evenly: we know what was PAID last year, not
    // when the next payments land.
    expect(jan.estimated).toBeGreaterThan(0);
    expect(r.by_month.reduce((a, m) => a + m.estimated, 0)).toBeCloseTo(200, 2);
  });

  test('🔴 each monthly column sums EXACTLY to the total printed above it', () => {
    // Rounding thirteen buckets independently loses cents — $200 spread evenly
    // came back as $199.94 — and a column that does not add up to its own total
    // invites the reader to wonder which figure is wrong.
    const r = summariseIncome([bond, fund], '2026-09-05', '2027-09-05', 15000);
    const sum = (k) => Number(r.by_month.reduce((a, m) => a + m[k], 0).toFixed(2));
    expect(sum('scheduled')).toBe(r.scheduled.total);
    expect(sum('estimated')).toBe(r.estimated.total);
    expect(sum('total')).toBe(r.total);
  });

  test('a bond callable inside the window is counted AND flagged', () => {
    const r = summariseIncome([{ ...bond, next_call_date: '2027-01-15' }], '2026-09-05', '2027-09-05', 10000);
    expect(r.scheduled.total).toBeCloseTo(500, 2);
    expect(r.scheduled.callable_total).toBeCloseTo(500, 2);
  });

  test('yield on the portfolio uses the WHOLE portfolio, not the paying part', () => {
    // Against the income-producing sleeve alone it would read far higher and
    // describe a portfolio the owner does not have.
    const r = summariseIncome([bond, fund], '2026-09-05', '2027-09-05', 100000);
    expect(r.yield_on_portfolio).toBeCloseTo(0.007, 6);
  });
});

describe('absenceGroup — 🔴 three reasons, and only one is a hole in our data', () => {
  test('a bond with no terms is awaiting a statement, which closes itself', () => {
    expect(absenceGroup({ price_basis: 'per_100_face' })).toBe('awaiting_terms');
  });

  test('🔴 cash and money-market DO pay interest — this one understates the total', () => {
    // The statements print `7-day yield: 3.47%` and `Interest rate: 1.82%`; the
    // parser discards both. `par` is the structural tell, the same signal
    // services/exposure.js reads.
    expect(absenceGroup({ price_basis: 'par' })).toBe('rate_unknown');
  });

  test('a security we asked about that pays nothing is a MEASUREMENT', () => {
    expect(absenceGroup({ price_basis: 'per_share', dividends_asked: true })).toBe('pays_nothing');
    expect(absenceGroup({ price_basis: 'per_share', dividends_asked: false })).toBe('no_coverage');
  });
});

describe('addMonths', () => {
  test('clamps to the end of a short month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  test('crosses a year boundary in both directions', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});
