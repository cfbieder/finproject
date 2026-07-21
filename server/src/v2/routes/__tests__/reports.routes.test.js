'use strict';
/**
 * reports.routes.test.js — CR043 Phase 2.2.
 *
 * Characterization tests pinning the reports router's HTTP contract (status
 * codes + response envelopes) BEFORE the 2.2 route→service extraction of the
 * balance-sheet / cash-flow builders. DB-backed (skip with SKIP_DB_TESTS=1) but
 * data-independent — every assertion holds on CI's fresh seeded DB (shapes and
 * validation, never specific balances). The numeric parity of the reports
 * themselves is guarded separately by a golden before/after diff at extraction
 * time and by the CR024 `_fetchAccountBalances` integration test.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../reports');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/reports', router);
const req = (m, p) => request(app, m, `/reports${p}`);

dbDescribe('reports router contract (DB)', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(async () => {
    await db.close();
  });

  describe('balance sheet', () => {
    test('GET /balance with no asOfDate → 400', async () => {
      const r = await req('GET', '/balance');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/asOfDate/);
    });

    test('GET /balance with a malformed date → 400', async () => {
      const r = await req('GET', '/balance?asOfDate=2026-13-99');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Invalid/i);
    });

    test('GET /balance?asOfDate=<valid> → 200 { "Balance Sheet Accounts": [...] }', async () => {
      const r = await req('GET', '/balance?asOfDate=2026-06-30');
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body['Balance Sheet Accounts'])).toBe(true);
    });
  });

  describe('cash flow', () => {
    test('GET /cash-flow with no dates → 400', async () => {
      const r = await req('GET', '/cash-flow');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/fromDate/);
    });

    test('GET /cash-flow with a malformed date → 400', async () => {
      const r = await req('GET', '/cash-flow?fromDate=2026-01-01&toDate=nope');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Invalid/i);
    });

    test('GET /cash-flow?fromDate&toDate → 200 { "Profit & Loss Accounts": [...] }', async () => {
      const r = await req('GET', '/cash-flow?fromDate=2026-01-01&toDate=2026-06-30');
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body['Profit & Loss Accounts'])).toBe(true);
    });

    // CR054 "By Account": category/account filters + currency toggle.
    test('GET /cash-flow with category/accounts/currency filters → 200 with meta', async () => {
      const r = await req(
        'GET',
        '/cash-flow?fromDate=2026-01-01&toDate=2026-06-30' +
          '&category=Groceries&accounts=Checking&currency=original'
      );
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body['Profit & Loss Accounts'])).toBe(true);
      expect(r.body.meta).toBeDefined();
      expect(r.body.meta.currency).toBe('original');
      expect(Array.isArray(r.body.meta.currencies)).toBe(true);
    });

    test('GET /cash-flow defaults currency to usd in meta', async () => {
      const r = await req('GET', '/cash-flow?fromDate=2026-01-01&toDate=2026-06-30');
      expect(r.status).toBe(200);
      expect(r.body.meta.currency).toBe('usd');
    });
  });

  describe('cash-flow transactions', () => {
    test('GET /cash-flow/transactions with no category → 200 bare []', async () => {
      const r = await req('GET', '/cash-flow/transactions?fromDate=2026-01-01&toDate=2026-06-30');
      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    });
  });

  describe('category trend', () => {
    test('GET /category-trend with no dates → 400', async () => {
      const r = await req('GET', '/category-trend?category=Foo');
      expect(r.status).toBe(400);
    });

    test('GET /category-trend with no category → 400', async () => {
      const r = await req('GET', '/category-trend?startDate=2026-01-01&endDate=2026-06-30');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/category/i);
    });

    test('GET /category-trend with valid params → 200 { months, actual, budget }', async () => {
      const r = await req('GET', '/category-trend?startDate=2026-01-01&endDate=2026-03-31&category=CR043NoSuchCategoryXYZ');
      expect(r.status).toBe(200);
      // months are computed from the date range regardless of data
      expect(r.body.months).toEqual(['2026-01', '2026-02', '2026-03']);
      expect(r.body.actual).toEqual({});
      expect(r.body.budget).toEqual({});
    });
  });
});
