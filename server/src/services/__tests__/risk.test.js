'use strict';
/**
 * risk.test.js — CR093 P2.
 *
 * ⚠️ No database. Concentration is arithmetic and issuer grouping is a string
 * heuristic; roadmap #26 records what happens when either is tested through a
 * builder that reads every account's snapshots. Every name here is invented,
 * with the SHAPES taken from real custodian output.
 */

const {
  summariseRisk, issuerOf, bankOf, FDIC_LIMIT,
} = require('../risk');

const pos = (over) => ({
  id: over.id, ticker: over.ticker || null, name: over.name,
  asset_class: over.asset_class || 'bond', price_basis: over.price_basis || 'per_1_face',
  is_fund: over.is_fund || false, fdic_insured: over.fdic_insured || false, mv: over.mv,
});

describe('issuerOf — derived, and therefore shown', () => {
  test('cuts at the first instrument-type token, where the name stops naming the borrower', () => {
    expect(issuerOf('ZZ BANK NATL ASSN CD 4.15000% 06/12/2028')).toBe('ZZ BANK NATL ASSN');
    expect(issuerOf('ZZ INTL CAP PTE LTD NOTE CALL MAKE WHOLE 02/05/31')).toBe('ZZ INTL CAP PTE LTD');
    expect(issuerOf('ZZ BK AG SER E NOTE 10/16/34')).toBe('ZZ BK AG');
    expect(issuerOf('ZZ HONDA FIN CORP MTN 01/08/31')).toBe('ZZ HONDA FIN CORP');
  });

  test('🔴 does NOT merge corporate families, and that is the safe direction', () => {
    // Only the first is an FDIC-insured bank. Merging them would be wrong for
    // the insurance question even where it might be arguable for credit, and
    // splitting understates concentration rather than inventing it.
    expect(issuerOf('ZZ BK USA NATL ASSN CD 3.80000% 11/27/2028')).toBe('ZZ BK USA NATL ASSN');
    expect(issuerOf('ZZ AG MTN 04/28/31')).toBe('ZZ AG');
  });

  test('🔴 a single token containing a digit is an IDENTIFIER, not an issuer', () => {
    // The first cut matched only digit-leading CUSIPs, so a feed id like
    // `FDIC91125` came back as an issuer — and, through bankOf, as a BANK,
    // hiding $76,574 of possible insured deposit behind a name that identifies
    // nothing. Every real issuer name carries a space.
    expect(issuerOf('909557MK3')).toBeNull();
    expect(issuerOf('FDIC91125')).toBeNull();
    expect(issuerOf('06375MPJ8')).toBeNull();
    // ...but a real name with digits in it survives.
    expect(issuerOf('ZZ 500 INDEX CORP NOTE 01/01/30')).toBe('ZZ 500 INDEX CORP');
  });

  test('an empty or token-leading name yields null rather than a stub', () => {
    expect(issuerOf('')).toBeNull();
    expect(issuerOf('CD 4.00% 2029')).toBeNull();
  });
});

describe('bankOf — a sweep names its bank mid-string', () => {
  test('reads the bank out of the sweep form', () => {
    expect(bankOf('FDIC INSURED DEPOSIT AT ZZ MORGAN BK q NOT COVERED BY SIPC')).toBe('ZZ MORGAN BK');
    expect(bankOf('FDIC INSURED DEPOSIT AT ZZ SANTANDER BK')).toBe('ZZ SANTANDER BK');
  });

  test('a brokered CD names its bank first, so the prefix rule serves', () => {
    expect(bankOf('ZZ FARGO BANK NATL ASSN CD 3.90000% 05/08/2028')).toBe('ZZ FARGO BANK NATL ASSN');
  });

  test('🔴 an identifier is not a bank', () => {
    expect(bankOf('FDIC91125')).toBeNull();
  });
});

describe('summariseRisk — concentration', () => {
  const rows = [
    pos({ id: 1, ticker: 'ZZA', name: 'ZZ A CORP COM', asset_class: 'equity', price_basis: 'per_share', mv: 5000 }),
    pos({ id: 2, ticker: 'ZZB', name: 'ZZ B CORP COM', asset_class: 'equity', price_basis: 'per_share', mv: 3000 }),
    pos({ id: 3, ticker: 'ZZC', name: 'ZZ C CORP COM', asset_class: 'equity', price_basis: 'per_share', mv: 2000 }),
  ];

  test('ranks holdings and reports cumulative shares', () => {
    const r = summariseRisk(rows);
    expect(r.concentration.largest.ticker).toBe('ZZA');
    expect(r.concentration.top_1).toBeCloseTo(0.5, 6);
    expect(r.concentration.top_5).toBeCloseTo(1, 6);
    expect(r.holdings_count).toBe(3);
  });

  test('a zero or absent value is not a holding', () => {
    const r = summariseRisk([...rows, pos({ id: 4, name: 'ZZ D', mv: 0 })]);
    expect(r.holdings_count).toBe(3);
  });

  test('an empty portfolio does not divide by zero', () => {
    const r = summariseRisk([]);
    expect(r.concentration.largest).toBeNull();
    expect(r.concentration.top_1).toBe(0);
    expect(Number(r.total_market_value)).toBe(0);
  });
});

describe('summariseRisk — issuer exposure', () => {
  test('aggregates several instruments from one issuer, and lists what it grouped', () => {
    const r = summariseRisk([
      pos({ id: 1, name: 'ZZ FARGO BANK NATL ASSN CD 4.15000% 06/12/2028', mv: 100000 }),
      pos({ id: 2, name: 'ZZ FARGO BANK NATL ASSN CD 3.90000% 05/08/2028', mv: 100000 }),
    ]);
    const g = r.by_issuer[0];
    expect(g.issuer).toBe('ZZ FARGO BANK NATL ASSN');
    expect(Number(g.market_value)).toBeCloseTo(200000, 2);
    // Shown, because the grouping is a heuristic the reader must be able to check.
    expect(g.holdings).toHaveLength(2);
  });

  test('🔴 a FUND is excluded, not filed under its sponsor', () => {
    // The issuer of an index fund is its sponsor; the risk is its hundreds of
    // constituents. Filing it under the sponsor names a risk that does not exist
    // and hides the one that does.
    const r = summariseRisk([
      pos({ id: 1, ticker: 'ZZF', name: 'ZZ SPONSOR LOW DURATION BOND ETF', price_basis: 'per_share', is_fund: true, mv: 500000 }),
      pos({ id: 2, name: 'ZZ CORP NOTE 01/01/30', mv: 10000 }),
    ]);
    expect(r.by_issuer.map((g) => g.issuer)).toEqual(['ZZ CORP']);
    expect(Number(r.issuer_coverage.excluded_funds_value)).toBeCloseTo(500000, 2);
  });

  test('a holding named only by an identifier is reported as having no issuer', () => {
    const r = summariseRisk([pos({ id: 1, name: '909557MK3', mv: 150000 })]);
    expect(r.by_issuer).toHaveLength(0);
    expect(Number(r.issuer_coverage.no_issuer_value)).toBeCloseTo(150000, 2);
  });
});

describe('summariseRisk — FDIC insurance, the one real limit on this page', () => {
  test('🔴 deposits at ONE bank are summed against the limit, not checked one by one', () => {
    // Three CDs of $99,500 each are individually under the limit and together
    // over it. Checking them separately is how a portfolio passes a test it
    // should fail.
    const r = summariseRisk([
      pos({ id: 1, name: 'ZZ FARGO BANK NATL ASSN CD 4.15% 2028', fdic_insured: true, mv: 99500 }),
      pos({ id: 2, name: 'ZZ FARGO BANK NATL ASSN CD 3.90% 2028', fdic_insured: true, mv: 99500 }),
      pos({ id: 3, name: 'ZZ FARGO BANK NATL ASSN CD 3.95% 2029', fdic_insured: true, mv: 99500 }),
    ]);
    const b = r.fdic.banks[0];
    expect(Number(b.market_value)).toBeCloseTo(298500, 2);
    expect(b.over_limit).toBe(true);
    expect(Number(b.uninsured)).toBeCloseTo(48500, 2);
    expect(Number(b.insured)).toBeCloseTo(FDIC_LIMIT, 2);
    expect(Number(r.fdic.total_uninsured)).toBeCloseTo(48500, 2);
  });

  test('a bank under the limit reports headroom, not a warning', () => {
    const r = summariseRisk([
      pos({ id: 1, name: 'ZZ CITY N A CD 4.00% 2029', fdic_insured: true, mv: 100000 }),
    ]);
    expect(r.fdic.banks[0].over_limit).toBe(false);
    expect(Number(r.fdic.banks[0].headroom)).toBeCloseTo(150000, 2);
    expect(r.fdic.over_limit_count).toBe(0);
  });

  test('🔴 a MONEY-MARKET FUND is not an insured deposit, and is said so rather than omitted', () => {
    // It sits beside the deposits in a Core Account and both get called "cash".
    // Leaving it out silently would let the reader read the omission as "fine".
    const r = summariseRisk([
      pos({ id: 1, ticker: 'ZZMM', name: 'ZZ GOVERNMENT MONEY MARKET', asset_class: 'mmf', price_basis: 'par', mv: 91000 }),
    ]);
    expect(r.fdic.banks).toHaveLength(0);
    expect(Number(r.fdic.money_market_value)).toBeCloseTo(91000, 2);
    expect(r.fdic.money_market[0].ticker).toBe('ZZMM');
  });

  test('🔴 a par holding whose name identifies nothing CANNOT be checked, and is listed', () => {
    // Entirely caused by roadmap #29: the feed renamed two sweeps to numeric ids
    // and the new securities carry no name. Skipping them would hide a hole in
    // the insurance answer.
    const r = summariseRisk([pos({ id: 1, name: 'FDIC91125', asset_class: 'unknown', price_basis: 'par', mv: 76574 })]);
    expect(r.fdic.banks).toHaveLength(0);
    expect(Number(r.fdic.unattributed_value)).toBeCloseTo(76574, 2);
  });

  test('a bond that is not an insured deposit stays out of the FDIC panel entirely', () => {
    const r = summariseRisk([
      pos({ id: 1, name: 'ZZ CORP NOTE 01/01/30', price_basis: 'per_100_face', mv: 100000 }),
    ]);
    expect(r.fdic.banks).toHaveLength(0);
    expect(Number(r.fdic.unattributed_value)).toBe(0);
    expect(Number(r.fdic.money_market_value)).toBe(0);
  });
});
