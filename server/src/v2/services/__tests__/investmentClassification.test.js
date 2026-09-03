'use strict';
/**
 * investmentClassification.test.js — CR061 P1.
 *
 * ⚠️ Every symbol here is INVENTED. The repo does not commit real financial data
 * (`Samples/Fidelity/`, `Samples/Fintable/` and the Quicken exports are all
 * gitignored) and a fixture of the live positions would be the portfolio itself:
 * the symbols ARE the holdings. So the SHAPES are real and the identifiers are
 * not, and CUSIPs are generated with a correct check digit rather than copied.
 * `Scripts/classify-live-positions.js` runs the same rules against the real
 * positions; that is where the counts get confirmed.
 *
 * What these protect is one failure: a non-per-share instrument reaching an
 * equity quote lookup, which prices 100,000 of face value at a share price.
 */

const {
  classify,
  isValidCusip,
  quoteSymbolCandidates,
} = require('../investmentClassification');

// Build a checksum-valid CUSIP from an invented 8-character base, so no real
// security identifier appears in this repo.
function cusip(base) {
  const val = (ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) return c - 48;
    return c - 65 + 10;
  };
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    let v = val(base[i]);
    if (i % 2 === 1) v *= 2;
    sum += Math.floor(v / 10) + (v % 10);
  }
  return base + String((10 - (sum % 10)) % 10);
}

const BOND = cusip('11122233');        // CUSIP-shaped, self-named, priced off par
const CASHLIKE = cusip('BANK1234');    // CUSIP-shaped AND at par — the trap

describe('CUSIP check digit', () => {
  test('accepts a well-formed identifier and rejects a corrupted one', () => {
    expect(isValidCusip(BOND)).toBe(true);
    const broken = BOND.slice(0, 8) + String((Number(BOND[8]) + 1) % 10);
    expect(isValidCusip(broken)).toBe(false);
  });

  test('rejects anything that is not nine valid characters', () => {
    expect(isValidCusip('12345678')).toBe(false);
    expect(isValidCusip('1234567890')).toBe(false);
    expect(isValidCusip('abc123456')).toBe(false);
    expect(isValidCusip(null)).toBe(false);
  });

  test('🔴 a valid checksum does NOT mean "bond" — the check space is one digit', () => {
    // This is the finding that changed the design. CR061 rev 3 proposed
    // check-digit validation as what would make the bond rule "falsifiable
    // rather than shape-matching". It does not separate a cash deposit whose
    // identifier happens to be CUSIP-shaped: roughly one in ten arbitrary
    // 9-character strings passes, and the live portfolio holds one that does.
    expect(isValidCusip(CASHLIKE)).toBe(true);
    // ...so the classifier must not rely on the checksum alone. See below.
  });
});

describe('classify — the three pricing conventions', () => {
  test('a listed ticker is an equity, priced per share', () => {
    expect(classify({ symbol: 'ZZT', name: 'Zeta Industries', price: '141.50' }))
      .toMatchObject({ asset_class: 'equity', price_basis: 'per_share', quantity_unit: 'shares' });
  });

  test('a self-named CUSIP off par is a bond, priced against par', () => {
    const r = classify({ symbol: BOND, name: BOND, price: '0.9989' });
    expect(r).toMatchObject({ asset_class: 'bond', price_basis: 'per_1_face', quantity_unit: 'face' });
    // The distinction that carries the money: 100000 x 0.9989 = 99,890, which is
    // face value times a fraction of par — not 100,000 shares at a dollar.
  });

  test('🔴 the two bond conventions are told apart by price magnitude', () => {
    // Both are live in the real portfolio and both satisfy
    // value = quantity x price, so no arithmetic check can separate them.
    // Percent of par: 1000 units of $100 face at 98.745% = 98,745.
    const percent = classify({ symbol: BOND, name: BOND, price: '98.745' });
    expect(percent.price_basis).toBe('per_100_face');
    // Fraction of par: 100,000 face dollars at 0.9989 = 99,890.
    const fraction = classify({ symbol: BOND, name: BOND, price: '0.9989' });
    expect(fraction.price_basis).toBe('per_1_face');
    // Both are still bonds, and both are quantity-in-face.
    expect(percent.asset_class).toBe('bond');
    expect(fraction.asset_class).toBe('bond');
    expect(percent.quantity_unit).toBe('face');
  });

  test('a known money-market fund is at par, never quoted', () => {
    expect(classify({ symbol: 'SPAXX', name: 'SPAXX', price: '1' }))
      .toMatchObject({ asset_class: 'mmf', price_basis: 'par' });
  });

  test('a five-letter ticker ending in X is an open-end fund, not an equity', () => {
    const r = classify({ symbol: 'ABCDX', name: 'Some Fund', price: '26.85' });
    expect(r.asset_class).toBe('mutual_fund');
    // Still per-share (a fund has a NAV per share) — this changes what the
    // instrument is CALLED, not how it is valued. It matters because a fund will
    // never return an intraday quote, and "no quote because it is a fund" must
    // not look like "no quote because the lookup is broken".
    expect(r.price_basis).toBe('per_share');
  });
});

describe('classify — the trap the design was rebuilt around', () => {
  test('🔴 a CUSIP-shaped identifier priced at exactly par is NOT a bond', () => {
    // A cash deposit sweep: CUSIP-shaped, self-named, checksum-valid, and cash.
    // Classified as a bond it would carry `per_1_face`, and its quantity — a
    // dollar amount — would be read as face value.
    const r = classify({ symbol: CASHLIKE, name: CASHLIKE, price: '1' });
    expect(r.asset_class).toBe('unknown');
    expect(r.price_basis).toBe('par');
    expect(r.reason).toMatch(/par/);
  });

  test('it resolves to unknown rather than cash — we know HOW it is priced, not WHAT it is', () => {
    const r = classify({ symbol: CASHLIKE, name: CASHLIKE, price: '1' });
    // Asserting `cash` would claim the second from evidence for the first.
    // `unknown` is never quoted and always warned, so it gets one manual
    // classification — the correct amount of certainty.
    expect(r.asset_class).not.toBe('cash');
    expect(r.asset_class).not.toBe('bond');
  });

  test('an unidentified par-priced ticker is unknown, never an equity', () => {
    // Five alpha characters would otherwise read as a listed ticker and become
    // safe to probe for a quote — for a price that is 1.00 by definition.
    const r = classify({ symbol: 'QQZEQ', name: 'QQZEQ', price: '1' });
    expect(r.asset_class).toBe('unknown');
    expect(r.price_basis).toBe('par');
  });
});

describe('classify — nothing is classified by default', () => {
  test('an unrecognised shape is unknown, with no pricing basis at all', () => {
    const r = classify({ symbol: 'THIS-IS-NOT-A-TICKER', name: 'x', price: '10' });
    expect(r.asset_class).toBe('unknown');
    expect(r.price_basis).toBeNull();
    expect(r.quantity_unit).toBeNull();
  });

  test('a missing symbol is unknown, not skipped and not defaulted', () => {
    expect(classify({ symbol: '', name: '', price: '1' }).asset_class).toBe('unknown');
    expect(classify({}).asset_class).toBe('unknown');
  });

  test('nothing the classifier returns is ever a quote-eligible default', () => {
    // Migration 075 removed `asset_class DEFAULT 'stock'` for this reason: an
    // unclassified row must not become quote-eligible by omission.
    for (const h of [{}, { symbol: '??' }, { symbol: CASHLIKE, name: CASHLIKE, price: '1' }]) {
      expect(classify(h).asset_class).not.toBe('stock');
      expect(classify(h).asset_class).not.toBe('equity');
    }
  });

  test('every classification is marked inferred, so a manual one is distinguishable', () => {
    expect(classify({ symbol: 'ZZT', price: '10' }).classification_source).toBe('inferred');
    // `classification_source` is what stops the next ingest overwriting an owner
    // decision — the rules propose, they do not overrule.
  });

  test('only per-share instruments are ever safe to probe for a quote', () => {
    const cases = [
      { symbol: BOND, name: BOND, price: '0.9989' },
      { symbol: CASHLIKE, name: CASHLIKE, price: '1' },
      { symbol: 'SPAXX', name: 'SPAXX', price: '1' },
      { symbol: '?!?', price: '5' },
    ];
    for (const c of cases) expect(classify(c).price_basis).not.toBe('per_share');
  });
});

describe('quoteSymbolCandidates — the custodian and the quote feed disagree', () => {
  test('a share-class ticker offers the dotted form as a fallback', () => {
    // Measured: the custodian reports a 4-letter class-B ticker; the quote feed
    // returns nothing for it and a price for the dotted form. Real money goes
    // silently unquoted, and a missing quote looks exactly like a flat market.
    expect(quoteSymbolCandidates('XYZB')).toEqual(['XYZB', 'XYZ.B']);
  });

  test('the plain form is always tried first', () => {
    expect(quoteSymbolCandidates('XYZB')[0]).toBe('XYZB');
  });

  test('an ordinary ticker gets exactly one candidate', () => {
    expect(quoteSymbolCandidates('ZZT')).toEqual(['ZZT']);
  });

  test('a CUSIP gets none — it is not a ticker and must never be probed', () => {
    expect(quoteSymbolCandidates(BOND)).toEqual([]);
    expect(quoteSymbolCandidates('')).toEqual([]);
  });
});
