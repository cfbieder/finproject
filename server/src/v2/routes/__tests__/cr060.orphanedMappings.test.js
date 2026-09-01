/**
 * CR060 — findOrphanedMappings: the mapping that points at nothing.
 *
 * A bank reconnect can mint NEW fintable account ids. Since CR059 P3a the fin
 * mapping keys on that id, so a re-consent can leave the mapping pointing at an
 * account that no longer exists — and because `/account-mappings` builds its
 * rows by walking the FEED, such a mapping vanishes from the page instead of
 * lighting it up. The account stops feeding in silence. Two Revolut wallets did
 * exactly this for seven weeks.
 *
 * Pure function, no DB and no service.
 */

const { findOrphanedMappings } = require('../bankFeed');

const feed = () => [
  { external_id: 'ft_live_1' },
  { external_id: 'ft_live_2' },
];

const mappings = () => [
  { id: 1, external_name: 'ft_live_1', account_id: 10, ignored: false },
  { id: 2, external_name: 'ft_gone',   account_id: 20, ignored: false }, // reconnect re-keyed it
  { id: 3, external_name: 'ft_gone_2', account_id: 30, ignored: true },  // switched off on purpose
  { id: 4, external_name: 'ft_gone_3', account_id: null, ignored: false }, // never mapped
];

const names = new Map([[10, 'Chase Checking'], [20, 'Revolut EUR'], [30, 'OCME Sp. z o.o.']]);

describe('findOrphanedMappings (CR060)', () => {
  test('reports a mapped, non-ignored mapping whose feed account is gone', () => {
    const out = findOrphanedMappings(feed(), mappings(), names);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      mapping_id: 2,
      external_id: 'ft_gone',
      mapped_account_id: 20,
      mapped_account_name: 'Revolut EUR',
    });
  });

  test('stays silent on ignored mappings and on rows never mapped to a fin account', () => {
    // CR060's own correction: the ignored rows are switched off deliberately
    // (OCME's bank) and alerting on them forever is why the first scoping was wrong.
    const ids = findOrphanedMappings(feed(), mappings(), names).map((o) => o.mapping_id);
    expect(ids).not.toContain(3);
    expect(ids).not.toContain(4);
  });

  test('an EMPTY feed list is could-not-ask, not everything-is-orphaned', () => {
    // The distinction is the whole point: bank-feed returning nothing must not
    // render as 27 dead mappings, or the alarm gets trained away on its first blip.
    expect(findOrphanedMappings([], mappings(), names)).toBeNull();
    expect(findOrphanedMappings(null, mappings(), names)).toBeNull();
  });

  test('all mappings live → an empty list, which is a real answer and not null', () => {
    const live = [{ external_id: 'ft_live_1' }];
    const out = findOrphanedMappings(live, [mappings()[0]], names);
    expect(out).toEqual([]);
  });
});
