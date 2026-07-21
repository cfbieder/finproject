/**
 * CR055 — category-suggest key derivation + progressive backoff (pure, no DB).
 *
 * The live suggestForIds() path (corpus build + name resolution) is exercised
 * in the dev walkthrough; here we pin the deterministic pieces that drive
 * accuracy: token normalization and the 3→2→1 candidate-key ladder that lets a
 * per-transaction-id merchant (US card "AMAZON MKTPL*<orderid>") collapse to a
 * single "amazon mktpl" bucket instead of fragmenting per order.
 */

const { merchantTokens, merchantKey, keyCandidates } = require('../categorySuggest');

describe('merchantTokens', () => {
  test('strips digits, punctuation, and bracketed US disposition tags', () => {
    expect(merchantTokens("MCDONALD'S F1413 [SALE]")).toEqual(['mcdonald']);
    expect(merchantTokens('MARSHALLS #0108 [SALE]')).toEqual(['marshalls']);
    expect(merchantTokens('7-ELEVEN 24853 [SALE]')).toEqual(['eleven']);
  });

  test('collapses PKO whole-string doubling and trailing location tokens', () => {
    expect(merchantTokens('GREEN COFFEE WARSZAWA POL GREEN COFFEE WARSZAWA POL'))
      .toEqual(['green', 'coffee']);
  });

  test('empty / null description → no tokens', () => {
    expect(merchantTokens('')).toEqual([]);
    expect(merchantTokens(null)).toEqual([]);
  });
});

describe('keyCandidates (progressive backoff ladder)', () => {
  test('Amazon order-ids differ at the 3-token level but share level 2 and 1', () => {
    expect(keyCandidates('AMAZON MKTPL*F40KK8XY3 [SALE]'))
      .toEqual(['amazon mktpl kk', 'amazon mktpl', 'amazon']);
    expect(keyCandidates('AMAZON MKTPL*1Q8RX4GZ3'))
      .toEqual(['amazon mktpl rx', 'amazon mktpl', 'amazon']);
    // The differing 3-token keys fragment history; the shared 2-token key is
    // where 100s of Amazon rows converge, so backoff must expose it.
    const a = keyCandidates('AMAZON MKTPL*F40KK8XY3 [SALE]');
    const b = keyCandidates('AMAZON MKTPL*1Q8RX4GZ3');
    expect(a[0]).not.toBe(b[0]);
    expect(a).toContain('amazon mktpl');
    expect(b).toContain('amazon mktpl');
  });

  test('short merchants collapse levels without duplicate keys', () => {
    expect(keyCandidates("MCDONALD'S F1413 [SALE]")).toEqual(['mcdonald']);
    expect(keyCandidates('GREEN COFFEE WARSZAWA POL')).toEqual(['green coffee', 'green']);
  });

  test('candidates are ordered most-specific first', () => {
    const ks = keyCandidates('ALPHA BETA GAMMA DELTA');
    expect(ks).toEqual(['alpha beta gamma', 'alpha beta', 'alpha']);
  });

  test('merchantKey stays backward-compatible with the 3-token key', () => {
    expect(merchantKey('AMAZON MKTPL*F40KK8XY3 [SALE]')).toBe('amazon mktpl kk');
    expect(keyCandidates('AMAZON MKTPL*F40KK8XY3 [SALE]')[0])
      .toBe(merchantKey('AMAZON MKTPL*F40KK8XY3 [SALE]'));
  });
});
