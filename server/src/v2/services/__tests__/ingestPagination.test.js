/**
 * ingest() transaction paging (unit, mocked client + db + staging).
 *
 * The defect: ingest() made ONE `limit: 500` call, never used the `offset` the
 * client already accepted, and said nothing when the result came back *equal to*
 * the limit — the one signal that rows had been dropped. On a two-month window
 * the feed held 1,551 rows and fin took 500, reporting a contented
 * `fetched: 500`. That is how a duplicate stayed invisible: the row that would
 * have exposed it was never fetched. Silent truncation on an external import is
 * exactly what `.claude/rules/data-import.md` exists to prevent.
 *
 * Kept in its own file so the file-wide jest.mock cannot leak into the DB-backed
 * bank-feed suites.
 */

jest.mock('../bankFeedClient', () => ({
  transactions: jest.fn(),
  accounts: jest.fn(),
  balances: jest.fn(),
  sync: jest.fn(),
}));
jest.mock('../../db', () => ({ query: jest.fn(), transaction: jest.fn(), close: jest.fn() }));
jest.mock('../../repositories/bankfeedStaging', () => ({
  insertMany: jest.fn(),
}));

const bankFeedClient = require('../bankFeedClient');
const db = require('../../db');
const staging = require('../../repositories/bankfeedStaging');
const orchestrator = require('../refreshBankFeedV2');

const PAGE = 500;

/** A transaction the normalizer will keep: resolvable account, real date/amount. */
function tx(i) {
  return {
    id: String(i),
    account_id: '1',
    source: 'fintable',
    external_id: `pfx--hash${i}`,
    transaction_date: '2026-06-08',
    amount: '25.0000',
    currency: 'EUR',
    description: 'row',
    pending: false,
  };
}

function page(n) {
  return { transactions: Array.from({ length: n }, (_, i) => tx(i)) };
}

describe('refreshBankFeedV2.ingest — transaction paging', () => {
  beforeEach(() => {
    bankFeedClient.transactions.mockReset();
    bankFeedClient.accounts.mockReset();
    bankFeedClient.balances.mockReset();
    bankFeedClient.sync.mockReset();
    staging.insertMany.mockReset();
    db.query.mockReset();

    bankFeedClient.sync.mockResolvedValue({ skipped: true });
    bankFeedClient.accounts.mockResolvedValue([{ id: 1, external_id: 'uuid-1' }]);
    bankFeedClient.balances.mockResolvedValue({ balances: [] });
    staging.insertMany.mockResolvedValue({ insertedCount: 0, updatedCount: 0, skippedCount: 0 });
    db.query.mockResolvedValue({ rows: [] });
  });

  test('a short first page is one request — no needless second call', async () => {
    bankFeedClient.transactions.mockResolvedValueOnce(page(120));

    const out = await orchestrator.ingest({ since: '2026-06-07' });

    expect(bankFeedClient.transactions).toHaveBeenCalledTimes(1);
    expect(out.fetched).toBe(120);
    expect(out.pages).toBe(1);
  });

  test('follows pages past the cap and reports the full count', async () => {
    // The live shape that exposed this: 1,551 rows behind a 500 limit.
    bankFeedClient.transactions
      .mockResolvedValueOnce(page(PAGE))
      .mockResolvedValueOnce(page(PAGE))
      .mockResolvedValueOnce(page(PAGE))
      .mockResolvedValueOnce(page(51));

    const out = await orchestrator.ingest({ since: '2026-06-07' });

    expect(bankFeedClient.transactions).toHaveBeenCalledTimes(4);
    expect(out.fetched).toBe(1551); // pre-fix this was 500, and said nothing
    expect(out.pages).toBe(4);

    // Offsets must actually advance — a loop that re-requests offset 0 would
    // also "fetch 1551" while reading the same page four times.
    const offsets = bankFeedClient.transactions.mock.calls.map((c) => c[0].offset);
    expect(offsets).toEqual([0, PAGE, PAGE * 2, PAGE * 3]);
  });

  test('an exactly-full single page still confirms the end', async () => {
    // 500 rows and no more: the cap and the true total are indistinguishable
    // without asking, so it must ask rather than assume either way.
    bankFeedClient.transactions
      .mockResolvedValueOnce(page(PAGE))
      .mockResolvedValueOnce(page(0));

    const out = await orchestrator.ingest({ since: '2026-06-07' });

    expect(bankFeedClient.transactions).toHaveBeenCalledTimes(2);
    expect(out.fetched).toBe(PAGE);
  });

  test('pages that never run out throw instead of staging a partial window', async () => {
    // A service ignoring `offset` would return a full page forever. Failing loud
    // beats importing an unknown fraction of the window.
    bankFeedClient.transactions.mockResolvedValue(page(PAGE));

    await expect(orchestrator.ingest({ since: '2020-01-01' }))
      .rejects.toThrow(/may be truncated/);

    expect(staging.insertMany).not.toHaveBeenCalled();
  });
});
