/**
 * Rename proposal vote (pure, no DB). suggestForIds() wraps these with two
 * queries; the decisions that matter — KEEP votes, the majority bar, backoff —
 * live in buildLookup() + propose().
 */

const { buildLookup, propose } = require('../descriptionSuggest');

const ADOBE = 'PAYPAL PURCHASE ADOBE INC ADOBE WEB ID: PAYPALSI77 [POSDEBIT]';

describe('propose', () => {
  test('consistent past renames of the same feed text are proposed', () => {
    const lookup = buildLookup([{ raw: ADOBE, final: 'Adobe Photo', n: 4 }]);
    expect(propose(lookup, ADOBE)).toMatchObject({
      description: 'Adobe Photo', samples: 4, total: 4, confidence: 100,
    });
  });

  test('rows accepted unchanged outvote an occasional rename', () => {
    const lookup = buildLookup([
      { raw: 'MARSHALLS #0108 [SALE]', final: 'MARSHALLS #0108 [SALE]', n: 5 },
      { raw: 'MARSHALLS #0211 [SALE]', final: 'Marshalls', n: 2 },
    ]);
    expect(propose(lookup, 'MARSHALLS #0333 [SALE]')).toBeNull();
  });

  test('a single example is not enough', () => {
    const lookup = buildLookup([{ raw: 'WALTER AI MONTREAL', final: 'Walter AI', n: 1 }]);
    expect(propose(lookup, 'WALTER AI MONTREAL')).toBeNull();
  });

  test('no clear majority proposes nothing', () => {
    const lookup = buildLookup([
      { raw: 'GOOGLE *SERVICES', final: 'HBO Max', n: 2 },
      { raw: 'GOOGLE *SERVICES', final: 'ChatGPT', n: 2 },
    ]);
    expect(propose(lookup, 'GOOGLE *SERVICES')).toBeNull();
  });

  test('backs off to a shorter key when the order-id token differs', () => {
    const lookup = buildLookup([
      { raw: 'NETFLIX.COM*AB12CD', final: 'Netflix', n: 1 },
      { raw: 'NETFLIX.COM*XY98ZZ', final: 'Netflix', n: 2 },
    ]);
    expect(propose(lookup, 'NETFLIX.COM*QQ77RR')).toMatchObject({ description: 'Netflix' });
  });

  test('unknown merchant → null', () => {
    expect(propose(buildLookup([]), 'SOMETHING NEW')).toBeNull();
  });
});
