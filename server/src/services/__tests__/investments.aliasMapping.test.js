'use strict';
/**
 * investments.aliasMapping.test.js — Known Issue #29 / migration 081.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1). Every identifier is INVENTED.
 *
 * Migration 081 gives one security SEVERAL fintable names (an FDIC sweep the feed
 * reports under a ticker and a numeric id). Two readers joined the mappings table
 * by security alone and so returned one row per NAME: the Investments page listed
 * the merged sweep twice and its account share passed 100%, and the price probe
 * would have asked about — and written closes for — one security twice.
 */

const db = require('../../v2/db');
const { positionsFor } = require('../investments');
const { probeableSecurities } = require('../../v2/services/marketPrices');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('one security, two fintable names (DB)', () => {
  let acctId;
  let parId;
  let shareId;
  let snapId;

  const security = async (name, priceBasis, aliases) => {
    const { rows } = await db.query(
      `INSERT INTO securities (name, asset_class, price_basis) VALUES ($1, $2, $3) RETURNING id`,
      [name, priceBasis === 'par' ? 'unknown' : 'equity', priceBasis],
    );
    for (const alias of aliases) {
      await db.query(
        `INSERT INTO security_source_mappings (security_id, source, external_name) VALUES ($1, 'fintable', $2)`,
        [rows[0].id, alias],
      );
    }
    return rows[0].id;
  };

  beforeAll(async () => {
    const acct = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ('Alias Mapping Test Acct','asset','balance_sheet','USD',0) RETURNING id`,
    );
    acctId = acct.rows[0].id;
    parId = await security('ALIAS TEST SWEEP', 'par', ['ZZALIASTK', 'ZZALIAS9999']);
    shareId = await security('ALIAS TEST SHARE', 'per_share', ['ZZSHARETK', 'ZZSHARE9999']);

    const snap = await db.query(
      `INSERT INTO security_position_snapshots (account_id, polled_on, source, status, positions_count)
       VALUES ($1, '2099-01-01', 'bank-feed', 'fetched', 1) RETURNING id`,
      [acctId],
    );
    snapId = snap.rows[0].id;
    await db.query(
      `INSERT INTO security_positions
         (snapshot_id, account_id, security_id, quantity, price, price_basis, price_source, market_value, currency, raw)
       VALUES ($1, $2, $3, 100, 1, 'par', 'par', 100, 'USD', '{"symbol":"ZZALIAS9999"}'::jsonb)`,
      [snapId, acctId, parId],
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM security_positions WHERE snapshot_id = $1', [snapId]);
    await db.query('DELETE FROM security_position_snapshots WHERE account_id = $1', [acctId]);
    await db.query('DELETE FROM securities WHERE id = ANY($1::int[])', [[parId, shareId]]);
    await db.query('DELETE FROM accounts WHERE id = $1', [acctId]);
    await db.close();
  });

  test('🔴 positionsFor returns ONE row for one position, not one per name', async () => {
    const rows = await positionsFor([snapId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].market_value).toBe('100.0000');
  });

  test('the symbol shown is the one the feed reported on that position', async () => {
    const [row] = await positionsFor([snapId]);
    expect(row.symbol).toBe('ZZALIAS9999');
  });

  test('🔴 probeableSecurities lists a two-name security once', async () => {
    const rows = (await probeableSecurities()).filter((r) => r.id === shareId);
    expect(rows).toHaveLength(1);
  });
});
