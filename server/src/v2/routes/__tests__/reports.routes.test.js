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

    // CR054: the drill-down accepts an account filter so it matches the
    // By-Account report's filtered totals. Every returned row is on a
    // requested account (data-independent: the set is empty or all-match).
    test('GET /cash-flow/transactions?category&accounts → 200, rows only on the filtered account', async () => {
      const r = await req(
        'GET',
        '/cash-flow/transactions?fromDate=2026-01-01&toDate=2026-12-31' +
          '&category=Groceries&accounts=PKO'
      );
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      for (const row of r.body) {
        expect(row.Account).toBe('PKO');
      }
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

  // CR056 P1. Data-independent: shapes, validation and the identity — never a
  // specific balance, so these hold on CI's fresh seeded DB too.
  describe('investment returns', () => {
    const anyAccount = async () => {
      const { rows } = await db.query(
        `SELECT id FROM accounts WHERE account_type = 'asset' AND is_active ORDER BY id LIMIT 1`
      );
      return rows[0] ? rows[0].id : null;
    };

    test('GET /investment-returns with no account → 400', async () => {
      const r = await req('GET', '/investment-returns?fromDate=2025-01-01&toDate=2025-12-31');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/account/i);
    });

    test('GET /investment-returns with no dates → 400', async () => {
      const r = await req('GET', '/investment-returns?account=1');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/fromDate/);
    });

    test('GET /investment-returns with a malformed date → 400', async () => {
      const r = await req('GET', '/investment-returns?account=1&fromDate=01-01-2025&toDate=2025-12-31');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/YYYY-MM-DD/);
    });

    test('GET /investment-returns with an unknown interval → 400', async () => {
      const r = await req('GET', '/investment-returns?account=1&fromDate=2025-01-01&toDate=2025-12-31&interval=fortnight');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/interval/i);
    });

    test('GET /investment-returns with an unknown currency → 400', async () => {
      const r = await req('GET', '/investment-returns?account=1&fromDate=2025-01-01&toDate=2025-12-31&currency=eur');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/currency/i);
    });

    test('GET /investment-returns for an unknown account → 400', async () => {
      const r = await req('GET', '/investment-returns?account=99999999&fromDate=2025-01-01&toDate=2025-12-31');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Unknown account/);
    });

    test('rejects an over-wide span instead of silently coarsening it', async () => {
      const id = await anyAccount();
      if (!id) return;
      const r = await req('GET', `/investment-returns?account=${id}&fromDate=2000-01-01&toDate=2026-12-31&interval=month`);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/quarterly or annual/);
    });

    test('valid params → 200 { data, meta } with the documented shape', async () => {
      const id = await anyAccount();
      if (!id) return;
      const r = await req('GET', `/investment-returns?account=${id}&fromDate=2025-01-01&toDate=2025-12-31&interval=quarter`);
      expect(r.status).toBe(200);
      expect(r.body.data.intervals.map((i) => i.key)).toEqual(['2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4']);
      expect(r.body.meta.currency).toBe('usd');
      for (const key of ['beginningMV', 'netFlows', 'incomeTotal', 'priceReturn',
        'fxEffect', 'unattributed', 'totalReturn', 'returnPct', 'coverage', 'endingMV']) {
        expect(r.body.data.rows[key]).toHaveLength(4);
      }
      expect(Array.isArray(r.body.meta.markCoverage)).toBe(true);
      expect(Array.isArray(r.body.meta.chainBrokenBy)).toBe(true);
    });

    test('the reconciliation identity closes in every interval', async () => {
      // The assertion rev 1 could not pass: category 206 and NULL-category rows
      // moved MV while appearing in no row, so the columns did not tie.
      const id = await anyAccount();
      if (!id) return;
      const r = await req('GET', `/investment-returns?account=${id}&fromDate=2025-01-01&toDate=2025-12-31&interval=quarter`);
      expect(r.status).toBe(200);
      const { rows } = r.body.data;
      rows.beginningMV.forEach((bmv, i) => {
        const parts = rows.incomeTotal[i] + rows.priceReturn[i]
          + rows.fxEffect[i] + rows.unattributed[i];
        expect(parts).toBeCloseTo(rows.totalReturn[i], 6);
        expect(bmv + rows.netFlows[i] + rows.totalReturn[i]).toBeCloseTo(rows.endingMV[i], 6);
      });
    });

    test('currency=lc is accepted and reports its mode', async () => {
      const id = await anyAccount();
      if (!id) return;
      const r = await req('GET', `/investment-returns?account=${id}&fromDate=2025-01-01&toDate=2025-06-30&interval=quarter&currency=lc`);
      expect(r.status).toBe(200);
      expect(r.body.meta.currency).toBe('lc');
    });
  });

  /**
   * CR092 P1 — the narration endpoint validates the window IDENTICALLY to the
   * bridge it narrates, because it rebuilds that bridge server-side.
   *
   * That shared validation is the whole point of these cases: a parameter one
   * route accepted and the other rejected would put prose about one window
   * beside a table of another, and both halves would look internally
   * consistent. No gateway is reached — every assertion here returns before the
   * bridge is built, let alone narrated.
   */
  describe('POST /net-worth-bridge/narration — validation parity', () => {
    const WINDOW = 'fromDate=2025-01-01&toDate=2025-12-31';

    test.each([
      ['missing dates', ''],
      ['a malformed date', 'fromDate=2025-1-1&toDate=2025-12-31'],
      ['an unknown granularity', `${WINDOW}&granularity=fortnight`],
      ['a non-integer movers', `${WINDOW}&movers=all`],
    ])('rejects %s with the same 400 the bridge gives', async (_label, qs) => {
      const narration = await req('POST', `/net-worth-bridge/narration?${qs}`);
      const bridge = await req('GET', `/net-worth-bridge?${qs}`);

      expect(narration.status).toBe(400);
      expect(bridge.status).toBe(400);
      expect(narration.body.error).toBe(bridge.body.error);
    });

    test('an inverted window 400s rather than narrating backwards', async () => {
      const r = await req('POST', '/net-worth-bridge/narration?fromDate=2026-01-01&toDate=2025-01-01');
      expect(r.status).toBe(400);
    });
  });
});
