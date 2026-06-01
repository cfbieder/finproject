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

// ════════════════════════════════════════════════════════════════════════════
// DB-backed: promote — R1 opt-in gate + R2 cross-source dedup (CR022 §5.2)
// ════════════════════════════════════════════════════════════════════════════

dbDescribe('refreshBankFeedV2.promote (DB)', () => {
  const orchestrator = require('../refreshBankFeedV2');
  const staging = require('../../repositories/bankfeedStaging');
  const db = require('../../db');

  const ACCT = 3;                       // existing dev account (FK target)
  const TAG = 'test-bf-phaseC';         // staging source tag
  const UUID_OK = 'test-uuid-OK';       // mapped + not ignored
  const UUID_IGN = 'test-uuid-IGN';     // mapped + ignored
  const UUID_UNMAP = 'test-uuid-UNMAP'; // no mapping
  const PS_ID_BASE = 999100000;         // sentinel ps_id range for test PS rows

  async function cleanup() {
    await db.query(`DELETE FROM bankfeed_staging WHERE source = $1`, [TAG]);
    await db.query(`DELETE FROM transactions WHERE bank_feed_external_id LIKE 'test-bf-c-%'`);
    await db.query(`DELETE FROM transactions WHERE ps_id >= $1 AND ps_id < $2`, [PS_ID_BASE, PS_ID_BASE + 1000]);
    await db.query(`DELETE FROM account_source_mappings WHERE external_name LIKE 'test-uuid-%'`);
  }

  async function seedMapping(uuid, ignored, accountId = ACCT) {
    await db.query(
      `INSERT INTO account_source_mappings (account_id, source, external_name, ignored)
       VALUES ($1, 'bank-feed', $2, $3)
       ON CONFLICT (source, external_name) DO UPDATE SET account_id = EXCLUDED.account_id, ignored = EXCLUDED.ignored`,
      [accountId, uuid, ignored]
    );
  }

  async function seedStaging(externalId, uuid, over = {}) {
    await staging.upsert({
      external_id: externalId,
      source: TAG,
      feed_account_external_id: uuid,
      transaction_date: '2026-03-15',
      amount: -77.77,
      currency: 'PLN',
      description: 'phaseC staged',
      pending: false,
      raw: { external_id: externalId },
      ...over,
    });
  }

  async function seedPsRow(psId, over = {}) {
    await db.query(
      `INSERT INTO transactions (ps_id, transaction_date, description1, amount, currency, account_id, source, accepted)
       VALUES ($1, $2, $3, $4, $5, $6, 'pocketsmith', FALSE)`,
      [psId, over.date || '2026-03-15', over.desc || 'ps row', over.amount != null ? over.amount : -77.77, over.currency || 'PLN', ACCT]
    );
  }

  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); await db.close(); });

  test('R1: ignored skipped, unmapped pending, mapped promoted', async () => {
    await seedMapping(UUID_OK, false);
    await seedMapping(UUID_IGN, true);
    await seedStaging('test-bf-c-ok', UUID_OK);
    await seedStaging('test-bf-c-ign', UUID_IGN);
    await seedStaging('test-bf-c-unmap', UUID_UNMAP);

    const sync = await orchestrator.promote();

    expect(sync.ignoredAccounts).toContain(UUID_IGN);
    expect(sync.unmappedAccounts).toContain(UUID_UNMAP);

    // Assert on this test's own rows (TAG-scoped), not the global sync.inserted —
    // dev may hold unrelated staged rows that also promote in the same call.
    const promoted = await db.query(
      `SELECT bank_feed_external_id, source, accepted FROM transactions WHERE bank_feed_external_id LIKE 'test-bf-c-%'`
    );
    expect(promoted.rows).toHaveLength(1); // only the mapped+un-ignored row landed
    expect(promoted.rows[0].bank_feed_external_id).toBe('test-bf-c-ok');
    expect(promoted.rows[0].source).toBe('bank-feed');
    expect(promoted.rows[0].accepted).toBe(false);

    // ignored + unmapped rows remain unpromoted in staging
    const held = await db.query(
      `SELECT external_id FROM bankfeed_staging WHERE source = $1 AND promoted_transaction_id IS NULL`, [TAG]
    );
    const heldIds = held.rows.map((r) => r.external_id).sort();
    expect(heldIds).toEqual(['test-bf-c-ign', 'test-bf-c-unmap']);
  });

  test('R1: ignore-without-mapping (migration 024) — account_id NULL, reports ignored not unmapped', async () => {
    // Ignore-only row: no fin account, ignored=TRUE.
    await seedMapping(UUID_IGN, true, null);
    await seedStaging('test-bf-c-ignonly', UUID_IGN);

    const sync = await orchestrator.promote();

    expect(sync.ignoredAccounts).toContain(UUID_IGN);
    expect(sync.unmappedAccounts).not.toContain(UUID_IGN); // gate checks ignored first

    // never promoted (TAG-scoped: this test's row stays unpromoted)
    const held = await db.query(
      `SELECT promoted_transaction_id FROM bankfeed_staging WHERE source = $1 AND external_id = 'test-bf-c-ignonly'`, [TAG]
    );
    expect(held.rows[0].promoted_transaction_id).toBeNull();
  });

  test('R2: PS-first → bank-feed links onto the existing PS row (no new row)', async () => {
    await seedMapping(UUID_OK, false);
    await seedPsRow(PS_ID_BASE + 1);                    // PS twin, same acct/amount/date
    await seedStaging('test-bf-c-link', UUID_OK);

    const before = await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id = $1`, [ACCT]);
    const sync = await orchestrator.promote();
    const after = await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id = $1`, [ACCT]);

    // mergedWithPsCount is keyed by feed UUID, so it's already test-scoped.
    expect(sync.mergedWithPsCount[UUID_OK]).toBe(1);
    expect(after.rows[0].n).toBe(before.rows[0].n); // no new row — linked, not inserted

    // The external_id is stamped onto the EXISTING PS row (link), so the only
    // row carrying it must be that pocketsmith row — never a new bank-feed insert.
    const carrier = await db.query(
      `SELECT source, ps_id FROM transactions WHERE bank_feed_external_id = 'test-bf-c-link'`
    );
    expect(carrier.rows).toHaveLength(1);
    expect(carrier.rows[0].source).toBe('pocketsmith');
    expect(Number(carrier.rows[0].ps_id)).toBe(PS_ID_BASE + 1); // id stayed stable
  });

  test('R2: no PS twin → inserts a new bank-feed row', async () => {
    await seedMapping(UUID_OK, false);
    await seedStaging('test-bf-c-new', UUID_OK, { amount: -55.55, transaction_date: '2026-03-20' });

    const sync = await orchestrator.promote();
    // TAG-scoped: this test's row inserted a new bank-feed transaction, no merge
    const inserted = await db.query(`SELECT 1 FROM transactions WHERE bank_feed_external_id = 'test-bf-c-new'`);
    expect(inserted.rows).toHaveLength(1);
    expect(sync.mergedWithPsCount[UUID_OK] || 0).toBe(0);
  });

  test('R2: BANK_FEED_DEDUP_ENABLED=false → inserts new row even with a PS twin', async () => {
    await seedMapping(UUID_OK, false);
    await seedPsRow(PS_ID_BASE + 2);
    await seedStaging('test-bf-c-flagoff', UUID_OK);

    const prev = process.env.BANK_FEED_DEDUP_ENABLED;
    process.env.BANK_FEED_DEDUP_ENABLED = 'false';
    try {
      const sync = await orchestrator.promote();
      expect(sync.mergedWithPsCount[UUID_OK] || 0).toBe(0); // no merge with flag off
    } finally {
      if (prev === undefined) delete process.env.BANK_FEED_DEDUP_ENABLED;
      else process.env.BANK_FEED_DEDUP_ENABLED = prev;
    }

    // TAG-scoped: a new source-segregated bank-feed row was inserted (not linked)
    const newRow = await db.query(`SELECT 1 FROM transactions WHERE bank_feed_external_id = 'test-bf-c-flagoff'`);
    expect(newRow.rows).toHaveLength(1);
    const psRow = await db.query(`SELECT bank_feed_external_id FROM transactions WHERE ps_id = $1`, [PS_ID_BASE + 2]);
    expect(psRow.rows[0].bank_feed_external_id).toBeNull(); // PS row untouched
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-backed: R2.2 reverse dedup in the REAL PS promote (ingestPs §5.2 #7)
//
// Runs the actual syncStagingToTransactions() — the only edit to live PS code —
// scoped via onlyPsIds so it never touches the dev DB's real ~26k staging rows.
// ════════════════════════════════════════════════════════════════════════════

dbDescribe('PS promote reverse dedup (DB)', () => {
  const ingestPs = require('../../routes/ingestPs');
  const db = require('../../db');

  const ACCT = 3;
  const PS_ACCT_NAME = 'TestRevAcct';
  const PS_DUP = String(999200001);   // PS row that duplicates a bank-feed tx
  const PS_NEW = String(999200002);   // PS row with no bank-feed twin
  const BF_EXT = 'test-rev-bf';       // the bank-feed twin's external id

  async function cleanup() {
    await db.query(`DELETE FROM psdata_staging WHERE ps_id = ANY($1::varchar[])`, [[PS_DUP, PS_NEW]]);
    await db.query(`DELETE FROM transactions WHERE ps_id = ANY($1::bigint[])`, [[PS_DUP, PS_NEW]]);
    await db.query(`DELETE FROM transactions WHERE bank_feed_external_id = $1`, [BF_EXT]);
    await db.query(`DELETE FROM account_source_mappings WHERE source='pocketsmith' AND external_name=$1`, [PS_ACCT_NAME]);
  }

  async function seedPsStaging(psId, amount) {
    await db.query(
      `INSERT INTO psdata_staging (ps_id, transaction_date, amount, currency, account_name)
       VALUES ($1, '2026-04-10', $2, 'PLN', $3)`,
      [psId, amount, PS_ACCT_NAME]
    );
  }

  beforeEach(async () => {
    await cleanup();
    // pocketsmith mapping so the PS rows resolve to a fin account
    await db.query(
      `INSERT INTO account_source_mappings (account_id, source, external_name)
       VALUES ($1, 'pocketsmith', $2) ON CONFLICT (source, external_name) DO UPDATE SET account_id=EXCLUDED.account_id`,
      [ACCT, PS_ACCT_NAME]
    );
    // a genuine bank-feed transaction already in the canonical table (the twin)
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, bank_feed_external_id, accepted)
       VALUES ('2026-04-10', -88.88, 'PLN', $1, 'bank-feed', $2, FALSE)`,
      [ACCT, BF_EXT]
    );
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  test('a PS row duplicating a bank-feed tx is dropped; a non-duplicate is promoted', async () => {
    await seedPsStaging(PS_DUP, -88.88);   // matches the bank-feed twin (acct/amt/cur, same day)
    await seedPsStaging(PS_NEW, -11.11);   // no twin

    await ingestPs.syncStagingToTransactions({ onlyPsIds: [PS_DUP, PS_NEW] });

    const dup = await db.query(`SELECT 1 FROM transactions WHERE ps_id = $1`, [PS_DUP]);
    const fresh = await db.query(`SELECT 1 FROM transactions WHERE ps_id = $1`, [PS_NEW]);
    expect(dup.rows).toHaveLength(0);   // dropped — we already hold it via bank-feed
    expect(fresh.rows).toHaveLength(1); // promoted normally
  });

  test('with BANK_FEED_DEDUP_ENABLED=false the duplicate PS row IS promoted', async () => {
    await seedPsStaging(PS_DUP, -88.88);

    const prev = process.env.BANK_FEED_DEDUP_ENABLED;
    process.env.BANK_FEED_DEDUP_ENABLED = 'false';
    try {
      await ingestPs.syncStagingToTransactions({ onlyPsIds: [PS_DUP] });
    } finally {
      if (prev === undefined) delete process.env.BANK_FEED_DEDUP_ENABLED;
      else process.env.BANK_FEED_DEDUP_ENABLED = prev;
    }

    const dup = await db.query(`SELECT 1 FROM transactions WHERE ps_id = $1`, [PS_DUP]);
    expect(dup.rows).toHaveLength(1); // source-segregated: PS row kept
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-backed: PS↔bank-feed reconciliation (CR022 §G trust signal)
//
// Seeds a dedicated throwaway account so it never collides with the ~26k real
// rows, then asserts the matched / ps_only / bank_feed_only buckets.
// ════════════════════════════════════════════════════════════════════════════

dbDescribe('bankFeedReconciliation.reconcile (DB)', () => {
  const recon = require('../../repositories/bankFeedReconciliation');
  const db = require('../../db');

  const ACCT_NAME = 'TestReconAcct';
  const FEED_UUID = 'test-recon-uuid';
  let acctId;

  async function cleanup() {
    if (acctId) {
      await db.query(`DELETE FROM transactions WHERE account_id = $1`, [acctId]);
    }
    await db.query(`DELETE FROM account_source_mappings WHERE external_name = $1`, [FEED_UUID]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT_NAME]);
  }

  beforeAll(async () => {
    await cleanup();
    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section) VALUES ($1, 'asset', 'balance_sheet') RETURNING id`,
      [ACCT_NAME]
    );
    acctId = a.rows[0].id;
    await db.query(
      `INSERT INTO account_source_mappings (account_id, source, external_name, ignored)
       VALUES ($1, 'bank-feed', $2, FALSE)`,
      [acctId, FEED_UUID]
    );
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  test('classifies matched (linked + twin), ps_only, and bank_feed_only correctly', async () => {
    const d = '2026-05-20';
    // 1) PS row already linked (bank_feed_external_id set) → matched
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, bank_feed_external_id, accepted)
       VALUES ($1, -10.00, 'PLN', $2, 'pocketsmith', 'recon-linked', FALSE)`, [d, acctId]);
    // 2) PS row + a distinct bank-feed twin (same key, ±1 day) → matched
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ($1, -20.00, 'PLN', $2, 'pocketsmith', FALSE)`, [d, acctId]);
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, bank_feed_external_id, accepted)
       VALUES ($1, -20.00, 'PLN', $2, 'bank-feed', 'recon-twin', FALSE)`, ['2026-05-21', acctId]);
    // 3) PS row with NO bank-feed coverage → ps_only (the regression signal)
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ($1, -30.00, 'PLN', $2, 'pocketsmith', FALSE)`, [d, acctId]);
    // 4) bank-feed row with no PS twin → bank_feed_only
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, bank_feed_external_id, accepted)
       VALUES ($1, -40.00, 'PLN', $2, 'bank-feed', 'recon-bfonly', FALSE)`, [d, acctId]);

    const out = await recon.reconcile({ sinceDays: 60 });
    const row = out.accounts.find((r) => r.account_id === acctId);
    expect(row).toBeDefined();
    expect(row.matched).toBe(2);        // linked + twin
    expect(row.ps_only).toBe(1);        // the uncovered PS row
    expect(row.bank_feed_only).toBe(1); // the unmatched bank-feed row
  });

  test('an ignored account is excluded from reconciliation scope', async () => {
    await db.query(`UPDATE account_source_mappings SET ignored = TRUE WHERE external_name = $1`, [FEED_UUID]);
    const out = await recon.reconcile({ sinceDays: 60 });
    expect(out.accounts.find((r) => r.account_id === acctId)).toBeUndefined();
    await db.query(`UPDATE account_source_mappings SET ignored = FALSE WHERE external_name = $1`, [FEED_UUID]);
  });
});
