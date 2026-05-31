/**
 * Bank Feed Import tests (CR022).
 *
 * Phase B scope (this commit): pure converter + the shared findPsMatch dedup
 * predicate, plus a DB-gated block exercising the bankfeed_staging repository
 * (insert/idempotency/unpromoted). Orchestrator promote + route tests land with
 * Phases C/D in this same file.
 *
 * Pure tests need no DB. The DB block runs against the dev Postgres on :5434
 * (skip with SKIP_DB_TESTS=1) and cleans up by a unique source tag so it never
 * touches real ingest rows.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeFeedTransaction,
  normalizeBatch,
  findPsMatch,
  _toMinorUnits4,
  _toEpochDay,
} = require('../../converters/bankFeedToCanonical');

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'bank-feed-transactions.json'), 'utf8')
);

// internal account_id → UUID (mirrors /v1/accounts; account 99 intentionally absent)
const ACCT_MAP = { '6': 'uuid-6', '4': 'uuid-4', '2': 'uuid-2' };

// ════════════════════════════════════════════════════════════════════════════
// normalizeFeedTransaction — pure
// ════════════════════════════════════════════════════════════════════════════

describe('normalizeFeedTransaction', () => {
  test('signed-decimal-as-string amount → numeric, no float drift on 4dp', () => {
    const row = normalizeFeedTransaction(
      { external_id: 'x', source: 'fintable', amount: '-123.4500', currency: 'PLN', transaction_date: '2026-05-15', pending: false },
      { accountExternalIdById: ACCT_MAP }
    );
    expect(row.amount).toBe(-123.45);
    expect(row.currency).toBe('PLN');
    expect(row.pending).toBe(false);
    expect(row.transaction_date).toBe('2026-05-15');
  });

  test('pending=true → filtered (returns null)', () => {
    const row = normalizeFeedTransaction(
      { external_id: 'p', source: 'fintable', amount: '-1.0000', currency: 'PLN', transaction_date: '2026-05-15', pending: true },
      { accountExternalIdById: ACCT_MAP }
    );
    expect(row).toBeNull();
  });

  test('resolves internal account_id → UUID via map; absent id → null', () => {
    const resolved = normalizeFeedTransaction(
      { external_id: 'a', source: 'fintable', amount: '-5', currency: 'pln', transaction_date: '2026-05-15', account_id: '6' },
      { accountExternalIdById: ACCT_MAP }
    );
    expect(resolved.feed_account_external_id).toBe('uuid-6');
    expect(resolved.currency).toBe('PLN'); // upcased

    const unresolved = normalizeFeedTransaction(
      { external_id: 'b', source: 'fintable', amount: '-5', currency: 'PLN', transaction_date: '2026-05-15', account_id: '99' },
      { accountExternalIdById: ACCT_MAP }
    );
    expect(unresolved.feed_account_external_id).toBeNull();
  });

  test('preserves the whole contract row as raw (no separate raw field on the list endpoint)', () => {
    const tx = { external_id: 'r', source: 'fintable', amount: '-5', currency: 'PLN', transaction_date: '2026-05-15', description: 'X' };
    const row = normalizeFeedTransaction(tx, { accountExternalIdById: ACCT_MAP });
    expect(row.raw).toBe(tx);
  });

  test('missing external_id / source throws', () => {
    expect(() => normalizeFeedTransaction({ source: 'fintable', amount: '-1', transaction_date: '2026-05-15' })).toThrow(/external_id/);
    expect(() => normalizeFeedTransaction({ external_id: 'x', amount: '-1', transaction_date: '2026-05-15' })).toThrow(/source/);
  });

  test('non-numeric amount and bad date throw', () => {
    expect(() => normalizeFeedTransaction({ external_id: 'x', source: 'fintable', amount: 'NaNish', transaction_date: '2026-05-15' })).toThrow(/amount/);
    expect(() => normalizeFeedTransaction({ external_id: 'x', source: 'fintable', amount: '-1', transaction_date: 'nope' })).toThrow(/transaction_date/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// normalizeBatch — filter + collapse + count (fixture-driven)
// ════════════════════════════════════════════════════════════════════════════

describe('normalizeBatch', () => {
  test('filters pending, collapses duplicate external_id, flags unresolved accounts', () => {
    const out = normalizeBatch(FIXTURE, { accountExternalIdById: ACCT_MAP });

    // 7 fixture rows: 1 pending (filtered), 1 duplicate external_id (collapsed) → 5 unique rows
    expect(out.filteredPending).toBe(1);
    expect(out.duplicatesCollapsed).toBe(1);
    expect(out.rows).toHaveLength(5);

    // dedup keeps the LAST occurrence (the "(refetched)" description)
    const circle = out.rows.find((r) => r.external_id.startsWith('306283222131625591'));
    expect(circle.description).toMatch(/refetched/);

    // account 99 has no UUID in the map → surfaced as unresolved
    expect(out.unresolvedAccounts).toContain('99');
  });

  test('skips and counts rows that fail to normalize, never throws', () => {
    const out = normalizeBatch(
      [
        { external_id: 'ok', source: 'fintable', amount: '-1', currency: 'PLN', transaction_date: '2026-05-15' },
        { source: 'fintable', amount: '-1', transaction_date: '2026-05-15' }, // missing external_id
        { external_id: 'bad-amt', source: 'fintable', amount: 'xx', transaction_date: '2026-05-15' },
      ],
      { accountExternalIdById: ACCT_MAP }
    );
    expect(out.rows).toHaveLength(1);
    expect(out.skipped).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// findPsMatch — cross-source dedup predicate (R2)
// ════════════════════════════════════════════════════════════════════════════

describe('findPsMatch', () => {
  const ps = (over = {}) => ({
    id: 1, account_id: 10, amount: -100, currency: 'PLN', transaction_date: '2026-05-15', description: 'SHOP A', ...over,
  });

  test('links a bank-feed row to a same-key PS row (ABS amount, ±1 day)', () => {
    const target = { account_id: 10, amount: -100, currency: 'PLN', transaction_date: '2026-05-15' };
    expect(findPsMatch(target, [ps()])).toEqual(ps());
  });

  test('sign-insensitive: feed +100 matches PS -100 (ABS equal)', () => {
    const target = { account_id: 10, amount: 100, currency: 'PLN', transaction_date: '2026-05-16' };
    expect(findPsMatch(target, [ps({ amount: -100 })])).not.toBeNull();
  });

  test('date 2 days apart → no match', () => {
    const target = { account_id: 10, amount: -100, currency: 'PLN', transaction_date: '2026-05-18' };
    expect(findPsMatch(target, [ps()])).toBeNull();
  });

  test('different currency, same magnitude → no match', () => {
    const target = { account_id: 10, amount: -100, currency: 'EUR', transaction_date: '2026-05-15' };
    expect(findPsMatch(target, [ps({ currency: 'PLN' })])).toBeNull();
  });

  test('different account → no match', () => {
    const target = { account_id: 11, amount: -100, currency: 'PLN', transaction_date: '2026-05-15' };
    expect(findPsMatch(target, [ps({ account_id: 10 })])).toBeNull();
  });

  test('two distinct same-day same-amount candidates → no merge unless description disambiguates', () => {
    const target = { account_id: 10, amount: -100, currency: 'PLN', transaction_date: '2026-05-15', description: 'SHOP B' };
    const candidates = [ps({ id: 1, description: 'SHOP A' }), ps({ id: 2, description: 'SHOP C' })];
    // ambiguous, none matches description → conservative null
    expect(findPsMatch(target, candidates)).toBeNull();

    // now one candidate's description matches exactly → link that one
    const candidates2 = [ps({ id: 1, description: 'SHOP A' }), ps({ id: 2, description: 'SHOP B' })];
    expect(findPsMatch(target, candidates2)).toEqual(ps({ id: 2, description: 'SHOP B' }));
  });

  test('empty candidates / null target → null', () => {
    expect(findPsMatch({ account_id: 10, amount: -1, currency: 'PLN', transaction_date: '2026-05-15' }, [])).toBeNull();
    expect(findPsMatch(null, [ps()])).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// helpers
// ════════════════════════════════════════════════════════════════════════════

describe('precision helpers', () => {
  test('toMinorUnits4 is float-drift safe', () => {
    expect(_toMinorUnits4('-123.4500')).toBe(1234500);
    expect(_toMinorUnits4(123.45)).toBe(1234500);
    expect(_toMinorUnits4(-0.1 - 0.2)).toBe(3000); // 0.30000000000000004 → 3000
  });
  test('toEpochDay parses YYYY-MM-DD, rejects junk', () => {
    expect(_toEpochDay('2026-05-15')).toBe(_toEpochDay('2026-05-15'));
    expect(_toEpochDay('2026-05-16') - _toEpochDay('2026-05-15')).toBe(1);
    expect(_toEpochDay('nope')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-backed: bankfeed_staging repository (gated by SKIP_DB_TESTS)
// ════════════════════════════════════════════════════════════════════════════

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('bankfeedStaging repository (DB)', () => {
  const staging = require('../../repositories/bankfeedStaging');
  const db = require('../../db');

  // unique source tag isolates these rows from real ingest data
  const TAG = 'test-bf-phaseB';

  function row(external_id, over = {}) {
    return {
      external_id,
      source: TAG,
      feed_account_external_id: 'uuid-test',
      transaction_date: '2026-05-15',
      amount: -12.3456,
      currency: 'PLN',
      description: 'unit test row',
      pending: false,
      raw: { external_id, note: 'fixture' },
      ...over,
    };
  }

  afterAll(async () => {
    await db.query('DELETE FROM bankfeed_staging WHERE source = $1', [TAG]);
    await db.close();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM bankfeed_staging WHERE source = $1', [TAG]);
  });

  test('insertMany inserts new rows, then is idempotent on re-run', async () => {
    const rows = [row('a'), row('b'), row('c')];
    const first = await staging.insertMany(rows);
    expect(first).toEqual({ insertedCount: 3, updatedCount: 0, skippedCount: 0 });

    const second = await staging.insertMany(rows);
    expect(second.insertedCount).toBe(0);
    expect(second.updatedCount).toBe(3);
  });

  test('upsert refreshes mutable fields and stores raw as jsonb', async () => {
    await staging.upsert(row('a', { description: 'before' }));
    const updated = await staging.upsert(row('a', { description: 'after' }));
    expect(updated.inserted).toBe(false);
    expect(updated.description).toBe('after');
    expect(updated.raw).toEqual({ external_id: 'a', note: 'fixture' });
  });

  test('findUnpromoted returns staged rows; findByExternalId fetches one', async () => {
    await staging.insertMany([row('a'), row('b')]);
    const unpromoted = await staging.findUnpromoted();
    const tagged = unpromoted.filter((r) => r.source === TAG);
    expect(tagged).toHaveLength(2);
    expect(tagged.every((r) => r.promoted_transaction_id === null)).toBe(true);

    const one = await staging.findByExternalId(TAG, 'a');
    expect(one).not.toBeNull();
    expect(one.external_id).toBe('a');
  });
});
