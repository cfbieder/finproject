/**
 * CR024 Phase 1 — ingestBalances (unit, mocked client + db).
 *
 * Verifies the /v1/balances → bankfeed_balances cache step: resolve the feed's
 * internal account_id → stable UUID, upsert one row per resolved balance, skip
 * (count) any balance whose internal id has no UUID mapping. No network, no DB.
 *
 * Kept separate from the read-override DB test so the file-wide jest.mock here
 * can't leak into that real-DB block.
 */

jest.mock('../bankFeedClient', () => ({
  balances: jest.fn(),
  accounts: jest.fn(),
}));
jest.mock('../../db', () => ({ query: jest.fn(), transaction: jest.fn(), close: jest.fn() }));

const bankFeedClient = require('../bankFeedClient');
const db = require('../../db');
const orchestrator = require('../refreshBankFeedV2');

describe('refreshBankFeedV2.ingestBalances', () => {
  beforeEach(() => {
    bankFeedClient.balances.mockReset();
    db.query.mockReset();
    db.query.mockResolvedValue({ rows: [] });
  });

  test('resolves internal id→UUID, upserts each resolved balance, skips unresolved', async () => {
    bankFeedClient.balances.mockResolvedValue({
      balances: [
        { account_id: '1', balance: '292025.4500', currency: 'USD', balance_date: '2026-06-02', source: 'fintable' },
        { account_id: '2', balance: '790076.3800', currency: 'USD', balance_date: '2026-06-02', source: 'fintable' },
        { account_id: '9', balance: '1.0000', currency: 'USD', balance_date: '2026-06-02', source: 'fintable' }, // unresolved
      ],
    });

    const res = await orchestrator.ingestBalances({
      accountExternalIdById: { '1': 'uuid-1', '2': 'uuid-2' }, // '9' intentionally absent
    });

    expect(res).toEqual({ fetched: 3, upserted: 2, unresolved: 1 });
    expect(db.query).toHaveBeenCalledTimes(2);

    const firstArgs = db.query.mock.calls[0];
    expect(firstArgs[0]).toMatch(/INSERT INTO bankfeed_balances/);
    expect(firstArgs[1][0]).toBe('uuid-1');     // keyed on UUID, not internal id "1"
    expect(firstArgs[1][1]).toBe('292025.4500');
    expect(firstArgs[1][3]).toBe('2026-06-02');
  });

  test('CR035: source_synced_at flows through to the upsert (null when absent)', async () => {
    bankFeedClient.balances.mockResolvedValue({
      balances: [
        { account_id: '1', balance: '1.0000', currency: 'USD', balance_date: '2026-06-30', source: 'fintable', source_synced_at: '2026-06-25T01:29:10+00:00' },
        { account_id: '2', balance: '2.0000', currency: 'USD', balance_date: '2026-06-30', source: 'fintable' }, // no sync time
      ],
    });
    await orchestrator.ingestBalances({ accountExternalIdById: { '1': 'uuid-1', '2': 'uuid-2' } });
    expect(db.query.mock.calls[0][0]).toMatch(/source_synced_at/);
    expect(db.query.mock.calls[0][1][5]).toBe('2026-06-25T01:29:10+00:00'); // param 6 = source_synced_at
    expect(db.query.mock.calls[1][1][5]).toBeNull();                         // absent → null
  });

  test('accepts a bare-array balances response and defaults source to fintable', async () => {
    bankFeedClient.balances.mockResolvedValue([
      { account_id: '1', balance: '5.0000', currency: 'USD', balance_date: '2026-06-02' }, // no source
    ]);
    const res = await orchestrator.ingestBalances({ accountExternalIdById: { '1': 'uuid-1' } });
    expect(res).toEqual({ fetched: 1, upserted: 1, unresolved: 0 });
    expect(db.query.mock.calls[0][1][4]).toBe('fintable');
  });

  test('empty/missing balances → no upserts', async () => {
    bankFeedClient.balances.mockResolvedValue({ balances: [] });
    const res = await orchestrator.ingestBalances({ accountExternalIdById: { '1': 'uuid-1' } });
    expect(res).toEqual({ fetched: 0, upserted: 0, unresolved: 0 });
    expect(db.query).not.toHaveBeenCalled();
  });
});
