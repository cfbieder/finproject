'use strict';
/**
 * Unit test for refreshBankFeedV2.syncUpstream — CR023 6b "sync before reconcile".
 * Pure (no DB): mocks the bank-feed client. Verifies the param passthrough and,
 * critically, the FAIL-OPEN contract: a bank-feed outage must never throw (the
 * ingest/reconcile path falls back to cached data).
 */

jest.mock('../bankFeedClient', () => ({ sync: jest.fn() }));
const bankFeedClient = require('../bankFeedClient');
const { syncUpstream } = require('../refreshBankFeedV2');

describe('syncUpstream (best-effort pre-read sync)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('passes maxAgeMin/force through and returns the service result', async () => {
    bankFeedClient.sync.mockResolvedValue({ skipped: false });
    const r = await syncUpstream({ maxAgeMin: 15, force: false });
    expect(bankFeedClient.sync).toHaveBeenCalledWith({ maxAgeMin: 15, force: false });
    expect(r).toEqual({ skipped: false });
  });

  test('returns the skipped result when the service is already fresh', async () => {
    bankFeedClient.sync.mockResolvedValue({ skipped: true, reason: 'fresh', age_minutes: 5, max_age_minutes: 60 });
    const r = await syncUpstream({ maxAgeMin: 60 });
    expect(r.skipped).toBe(true);
  });

  test('fail-open: never throws if the sync errors; returns {error}', async () => {
    bankFeedClient.sync.mockRejectedValue(new Error('bank-feed down'));
    const r = await syncUpstream();
    expect(r).toEqual({ error: 'bank-feed down' });
  });
});
