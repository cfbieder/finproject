'use strict';
/**
 * ingestHoldings.test.js — CR061 P1.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1). Run via ./Scripts/test-fresh-db.sh.
 *
 * The upstream is stubbed so the assertions are about fin's behaviour, not
 * fintable's availability. Every identifier is INVENTED — the repo does not
 * commit real financial data, and the symbols would be the holdings.
 *
 * These cover the things that would silently produce a wrong number:
 * an account resolved through the wrong id, a departed position surviving a
 * re-ingest, a broken fetch stored as an empty account, an owner's manual
 * classification being overwritten, and the residual computed in floats.
 */

const db = require('../../db');
const bankFeedClient = require('../bankFeedClient');
const { ingestHoldings, residualsByAccount } = require('../ingestHoldings');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

const FEED_INTERNAL_ID = 9901;          // bank-feed's internal id
const FEED_UUID = 'uuid-cr061-test-1';  // the stable external id fin maps on
const IGNORED_UUID = 'uuid-cr061-ignored';
const IGNORED_INTERNAL_ID = 9902;

dbDescribe('CR061 ingestHoldings (DB)', () => {
  let acctId;
  let realAccounts;
  let realHoldings;

  const feedAccounts = () => Promise.resolve({
    accounts: [
      { id: FEED_INTERNAL_ID, external_id: FEED_UUID },
      { id: IGNORED_INTERNAL_ID, external_id: IGNORED_UUID },
    ],
  });

  const entry = (over = {}) => ({
    account_id: FEED_INTERNAL_ID,
    polled_on: '2026-09-02',
    status: 'fetched',
    custodian_balance: '14150.01',
    positions_count: 1,
    sum_market_value: '14150.0000',
    positions: [{
      symbol: 'ZZT', name: 'Zeta Industries', quantity: '100',
      price: '141.50', value: '14150.0000', cost_basis: '12000.0000', currency: 'USD',
    }],
    ...over,
  });

  const stub = (holdings) => { bankFeedClient.holdings = () => Promise.resolve({ holdings }); };

  beforeAll(async () => {
    realAccounts = bankFeedClient.accounts;
    realHoldings = bankFeedClient.holdings;
    bankFeedClient.accounts = feedAccounts;

    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ('CR061 Ingest Test','asset','balance_sheet','USD',0) RETURNING id`);
    acctId = a.rows[0].id;
    await db.query(
      `INSERT INTO account_source_mappings (account_id, source, external_name)
       VALUES ($1,'bank-feed',$2)`, [acctId, FEED_UUID]);
    // The deliberately untracked account: mapped to nothing, ignored.
    await db.query(
      `INSERT INTO account_source_mappings (account_id, source, external_name, ignored)
       VALUES (NULL,'bank-feed',$1,TRUE)`, [IGNORED_UUID]);
  });

  afterAll(async () => {
    bankFeedClient.accounts = realAccounts;
    bankFeedClient.holdings = realHoldings;
    await db.query(`DELETE FROM security_positions WHERE account_id = $1`, [acctId]);
    await db.query(`DELETE FROM security_position_snapshots WHERE account_id = $1`, [acctId]);
    await db.query(
      `DELETE FROM security_source_mappings WHERE external_name IN ('ZZT','YYT','ABCDX','QQZEQ')`);
    await db.query(
      `DELETE FROM securities WHERE name IN ('Zeta Industries','Yotta Corp','Some Fund','QQZEQ')`);
    await db.query(`DELETE FROM account_source_mappings WHERE external_name IN ($1,$2)`, [FEED_UUID, IGNORED_UUID]);
    await db.query(`DELETE FROM accounts WHERE id = $1`, [acctId]);
    await db.close();
  });

  // Each test starts from nothing. `securities_created` is a COUNT, so leaving a
  // security behind makes a later test's result depend on which tests ran before
  // it — and a suite whose outcome depends on its own order proves less than it
  // appears to.
  beforeEach(async () => {
    await db.query(`DELETE FROM security_positions WHERE account_id = $1`, [acctId]);
    await db.query(`DELETE FROM security_position_snapshots WHERE account_id = $1`, [acctId]);
    await db.query(`DELETE FROM securities WHERE id IN (
      SELECT security_id FROM security_source_mappings
       WHERE source = 'fintable' AND external_name IN ('ZZT','YYT','ABCDX','QQZEQ'))`);
    await db.query(`DELETE FROM security_source_mappings
                     WHERE source = 'fintable' AND external_name IN ('ZZT','YYT','ABCDX','QQZEQ')`);
  });

  // ---- the crosswalk ------------------------------------------------------

  test('resolves the feed INTERNAL id to the UUID fin maps on', async () => {
    stub([entry()]);
    const s = await ingestHoldings();
    // The response reports 9901; fin's mapping keys on the UUID. Keying on the
    // internal id would orphan every snapshot at the next re-consent — that id
    // has already been re-keyed once, in lockstep across both repos.
    expect(s.accounts).toBe(1);
    expect(s.headers).toBe(1);
    expect(s.positions).toBe(1);
    expect(s.unmapped).toEqual([]);
  });

  test('an account fin does not track is COUNTED, never ingested', async () => {
    stub([entry(), entry({ account_id: IGNORED_INTERNAL_ID })]);
    const s = await ingestHoldings();
    expect(s.accounts).toBe(1);
    // Reported rather than silent: a re-consent that re-keys an account must not
    // be able to stop holdings without anyone noticing — that once cost a feed
    // seven weeks of silence.
    expect(s.unmapped).toHaveLength(1);
    expect(s.unmapped[0].uuid).toBe(IGNORED_UUID);
  });

  test('an unknown feed account resolves to no UUID and is still reported', async () => {
    stub([entry({ account_id: 99999 })]);
    const s = await ingestHoldings();
    expect(s.accounts).toBe(0);
    expect(s.unmapped[0]).toEqual({ feed_account_id: 99999, uuid: null });
  });

  // ---- statuses -----------------------------------------------------------

  test('an absent snapshot writes NOTHING — there is no date to key on', async () => {
    stub([entry({ polled_on: null, status: 'absent', positions: [], positions_count: 0 })]);
    const s = await ingestHoldings();
    expect(s.headers).toBe(0);
    const r = await db.query(
      `SELECT count(*)::int AS n FROM security_position_snapshots WHERE account_id = $1`, [acctId]);
    expect(r.rows[0].n).toBe(0);
  });

  test('a partial fetch is stored as partial — never as an account holding nothing', async () => {
    stub([entry({ status: 'partial', positions: [], positions_count: 0, sum_market_value: null })]);
    await ingestHoldings();
    const r = await db.query(
      `SELECT status, positions_count FROM security_position_snapshots WHERE account_id = $1`, [acctId]);
    expect(r.rows[0].status).toBe('partial');
    // The distinction that matters downstream: 'empty' would license "this
    // account holds nothing", and a broken fetch licenses nothing at all.
    expect(r.rows[0].status).not.toBe('empty');
  });

  test('an empty snapshot keeps its header — "looked and found nothing" is information', async () => {
    stub([entry({ status: 'empty', positions: [], positions_count: 0, sum_market_value: null })]);
    const s = await ingestHoldings();
    expect(s.headers).toBe(1);
    expect(s.positions).toBe(0);
  });

  // ---- re-ingest ----------------------------------------------------------

  test('re-ingesting the same day REPLACES positions — a departed symbol does not survive', async () => {
    stub([entry()]);
    await ingestHoldings();
    // Same poll date, different holding: the first symbol has left the account.
    stub([entry({
      positions: [{
        symbol: 'YYT', name: 'Yotta Corp', quantity: '50', price: '10.00',
        value: '500.0000', cost_basis: '400.0000', currency: 'USD',
      }],
    })]);
    await ingestHoldings();
    const r = await db.query(`
      SELECT s.raw->>'symbol' AS symbol FROM security_positions s
       WHERE s.account_id = $1`, [acctId]);
    // Merging would leave ZZT behind, inflating Σ positions — which CR090's
    // residual row would then absorb as "not reported by the feed", the one
    // number it exists to make legible.
    expect(r.rows.map((x) => x.symbol)).toEqual(['YYT']);
  });

  test('re-ingesting updates the header in place rather than forking it', async () => {
    stub([entry()]);
    await ingestHoldings();
    stub([entry({ custodian_balance: '14150.02' })]);
    await ingestHoldings();
    const r = await db.query(
      `SELECT count(*)::int AS n, max(custodian_balance)::text AS bal
         FROM security_position_snapshots WHERE account_id = $1`, [acctId]);
    expect(r.rows[0].n).toBe(1);
    expect(r.rows[0].bal).toBe('14150.0200');
  });

  // ---- securities ---------------------------------------------------------

  test('a symbol seen for the first time creates ONE security and its mapping', async () => {
    stub([entry()]);
    const s = await ingestHoldings();
    expect(s.securities_created).toBe(1);
    const m = await db.query(
      `SELECT s.asset_class, s.price_basis, s.classification_source, s.ticker
         FROM security_source_mappings m JOIN securities s ON s.id = m.security_id
        WHERE m.source = 'fintable' AND m.external_name = 'ZZT'`);
    expect(m.rows[0]).toMatchObject({
      asset_class: 'equity', price_basis: 'per_share', classification_source: 'inferred', ticker: 'ZZT',
    });
  });

  test('the same symbol on a later run reuses the security — no duplicates', async () => {
    stub([entry()]);
    await ingestHoldings();
    const s2 = await ingestHoldings();
    expect(s2.securities_created).toBe(0);
  });

  test('🔴 a manual classification is NEVER overwritten by a later ingest', async () => {
    stub([entry()]);
    await ingestHoldings();
    // The owner reclassifies it by hand.
    await db.query(`
      UPDATE securities SET asset_class = 'etf', classification_source = 'manual'
       WHERE id = (SELECT security_id FROM security_source_mappings
                    WHERE source='fintable' AND external_name='ZZT')`);
    await ingestHoldings();
    const r = await db.query(`
      SELECT s.asset_class, s.classification_source FROM securities s
        JOIN security_source_mappings m ON m.security_id = s.id
       WHERE m.external_name = 'ZZT'`);
    // The rules propose; they do not overrule. Without this, every nightly run
    // would silently undo the owner's decision.
    expect(r.rows[0]).toEqual({ asset_class: 'etf', classification_source: 'manual' });
  });

  test('a CUSIP-shaped symbol gets no ticker — a CUSIP is not a ticker', async () => {
    stub([entry({
      positions: [{
        symbol: 'QQZEQ', name: 'QQZEQ', quantity: '1000', price: '1',
        value: '1000.0000', cost_basis: '1000.0000', currency: 'USD',
      }],
    })]);
    await ingestHoldings();
    const r = await db.query(`
      SELECT s.ticker, s.asset_class, s.price_basis FROM securities s
        JOIN security_source_mappings m ON m.security_id = s.id
       WHERE m.external_name = 'QQZEQ'`);
    // Priced at par: unknown, never quoted, always warned.
    expect(r.rows[0].asset_class).toBe('unknown');
    expect(r.rows[0].price_basis).toBe('par');
  });

  // ---- the residual, in decimal -------------------------------------------

  test('🔴 the residual is computed in SQL NUMERIC, not JS floats', async () => {
    stub([entry()]);
    await ingestHoldings();
    const rows = await residualsByAccount();
    const mine = rows.find((r) => r.account_id === acctId);
    // 14150.01 - 14150.00. In JS this subtraction gives 0.010000000000218279,
    // which would paint a fraction of a cent of noise onto accounts that
    // actually tie — and the whole page turns on that tie being visible.
    expect(mine.residual).toBe('0.0100');
    expect(typeof mine.sum_market_value).toBe('string');
  });

  test('valued_on stays NULL — nothing upstream states the valuation date', async () => {
    stub([entry()]);
    await ingestHoldings();
    const rows = await residualsByAccount();
    const mine = rows.find((r) => r.account_id === acctId);
    expect(mine.valued_on).toBeNull();
    expect(mine.polled_on).not.toBeNull();
  });

  // ---- failure ------------------------------------------------------------

  test('an upstream failure returns a summary and throws nothing', async () => {
    bankFeedClient.holdings = () => Promise.reject(new Error('503 service_unavailable'));
    const s = await ingestHoldings();
    // The ledger ingest is the important half; a holdings hiccup must not fail
    // it, and must not look like a successful run that found no accounts.
    expect(s.error).toMatch(/503/);
    expect(s.headers).toBe(0);
  });
});
