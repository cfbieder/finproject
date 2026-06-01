/**
 * ingestBankFeed route tests (CR022 §5.3).
 *
 * Mocks the orchestrator + staging repo + client; drives the router over real
 * http (mirrors fc-lines.test.js). Covers: full-pipeline default + explicit
 * since, the upstream error envelope (5xx→502, timeout→504), and the
 * staging-count + bank-feed-only review endpoints.
 */

const express = require('express');
const http = require('http');

const mockRefresh = { refresh: jest.fn(), promote: jest.fn() };
const mockStaging = { count: jest.fn() };
const mockClient = { baseUrl: 'http://bank-feed.test:3007' };
const mockDb = { query: jest.fn() };

jest.mock('../../services/refreshBankFeedV2', () => mockRefresh);
jest.mock('../../repositories/bankfeedStaging', () => mockStaging);
jest.mock('../../services/bankFeedClient', () => mockClient);
jest.mock('../../db', () => mockDb);

const router = require('../ingestBankFeed');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/ingest-bank-feed', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        { hostname: 'localhost', port, path: `/ingest-bank-feed${path}`, method, headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            server.close();
            try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
            catch { resolve({ status: res.statusCode, body: data }); }
          });
        }
      );
      req.on('error', (err) => { server.close(); reject(err); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

describe('ingestBankFeed routes', () => {
  let app;
  beforeEach(() => { app = createApp(); jest.clearAllMocks(); });

  test('POST /refresh with no body triggers full pipeline (default since)', async () => {
    mockRefresh.refresh.mockResolvedValue({ ingest: { fetched: 5 }, sync: { inserted: 3 } });
    const res = await request(app, 'POST', '/refresh', {});
    expect(res.status).toBe(200);
    expect(res.body.sync.inserted).toBe(3);
    // sinceDays undefined → orchestrator applies its own default
    expect(mockRefresh.refresh).toHaveBeenCalledWith({ sinceDays: undefined, since: undefined });
  });

  test('POST /refresh with {sinceDays:7} passes it through', async () => {
    mockRefresh.refresh.mockResolvedValue({ ingest: {}, sync: {} });
    await request(app, 'POST', '/refresh', { sinceDays: 7 });
    expect(mockRefresh.refresh).toHaveBeenCalledWith({ sinceDays: 7, since: undefined });
  });

  test('POST /refresh maps a 5xx upstream error to 502 with bank_feed_url', async () => {
    const err = new Error('bank-feed POST /v1/transactions → 503: upstream down');
    err.status = 503;
    mockRefresh.refresh.mockRejectedValue(err);
    const res = await request(app, 'POST', '/refresh', {});
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/upstream down/);
    expect(res.body.bank_feed_url).toBe('http://bank-feed.test:3007');
  });

  test('POST /refresh maps a timeout/AbortError to 504', async () => {
    const err = new Error('bank-feed request timed out after 8000ms');
    mockRefresh.refresh.mockRejectedValue(err);
    const res = await request(app, 'POST', '/refresh', {});
    expect(res.status).toBe(504);
    expect(res.body.bank_feed_url).toBe('http://bank-feed.test:3007');
  });

  test('POST /refresh maps a 4xx upstream error to its own status', async () => {
    const err = new Error('bank-feed → 401: unauthorized');
    err.status = 401;
    mockRefresh.refresh.mockRejectedValue(err);
    const res = await request(app, 'POST', '/refresh', {});
    expect(res.status).toBe(401);
  });

  test('POST /sync-to-transactions promotes only (no fetch)', async () => {
    mockRefresh.promote.mockResolvedValue({ inserted: 2, linked: 1 });
    const res = await request(app, 'POST', '/sync-to-transactions', {});
    expect(res.status).toBe(200);
    expect(res.body.sync.inserted).toBe(2);
    expect(mockRefresh.promote).toHaveBeenCalled();
    expect(mockRefresh.refresh).not.toHaveBeenCalled();
  });

  test('GET /count returns staged row count', async () => {
    mockStaging.count.mockResolvedValue(312);
    const res = await request(app, 'GET', '/count');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(312);
  });

  test('POST /review-new-transactions returns bank-feed rows only', async () => {
    mockDb.query.mockResolvedValue({ rows: [{ id: 1, source: 'bank-feed' }] });
    const res = await request(app, 'POST', '/review-new-transactions', {});
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    // the query must filter source='bank-feed'
    const sql = mockDb.query.mock.calls[0][0];
    expect(sql).toMatch(/source\s*=\s*'bank-feed'/);
  });
});
