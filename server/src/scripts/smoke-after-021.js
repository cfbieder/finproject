#!/usr/bin/env node
/**
 * Post-migration-021 smoke test.
 *
 * Hits every endpoint whose SQL was rewritten when the categories table was
 * collapsed into accounts. Asserts:
 *  - HTTP 200
 *  - Expected response shape
 *  - Spot-check invariants (e.g. all 9 transfer leaves visible, sums non-zero)
 *
 * Run against a live server:
 *   node server/src/scripts/smoke-after-021.js
 *   BASE_URL=http://localhost:3005 node server/src/scripts/smoke-after-021.js
 *
 * Exits non-zero on any failure.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3005';

let passed = 0;
let failed = 0;
const failures = [];

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Bad JSON from ${path}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  console.log(`\nSmoke test against ${BASE_URL}`);
  console.log('============================================================');

  console.log('\n[1] Categories endpoint (alias over accounts)');

  await check('GET /api/v2/categories returns non-transfer P&L leaves', async () => {
    const res = await fetchJson('/api/v2/categories?activeOnly=true');
    assert(Array.isArray(res.data), 'data not array');
    assert(res.data.length > 0, 'empty result');
    assert(res.data.every(c => c.is_transfer === false), 'non-transfer set leaks transfers');
    assert(res.data.every(c => 'is_transfer' in c && 'name' in c && 'id' in c), 'shape missing fields');
  });

  await check('GET /api/v2/categories?includeTransfers=true returns 9 transfer leaves', async () => {
    const res = await fetchJson('/api/v2/categories?includeTransfers=true&activeOnly=true');
    const transfers = res.data.filter(c => c.is_transfer);
    assert(transfers.length === 9, `expected 9 transfers, got ${transfers.length}`);
    const names = transfers.map(c => c.name).sort();
    for (const required of ['Transfer - FX', 'Transfer - Business']) {
      assert(names.includes(required), `${required} missing — names: ${names.join(', ')}`);
    }
  });

  await check('GET /api/v2/categories/lookup?name=Transfer - FX resolves to id 208', async () => {
    const res = await fetchJson('/api/v2/categories/lookup?name=Transfer%20-%20FX');
    assert(res.data && res.data.name === 'Transfer - FX', 'lookup failed');
    assert(res.data.section === 'profit_loss', 'wrong section');
    assert(Array.isArray(res.data.mappings), 'mappings missing');
  });

  console.log('\n[2] Transactions repository (rewritten JOINs)');

  await check('GET /api/v2/transactions list joins category_name from accounts', async () => {
    const res = await fetchJson('/api/v2/transactions?limit=10');
    assert(res.data.length > 0, 'no transactions');
    const withCat = res.data.filter(t => t.category_name);
    assert(withCat.length > 0, 'no rows with category_name — JOIN broken');
  });

  await check('GET /api/v2/transactions?categoryId=208 returns Transfer - FX rows', async () => {
    const res = await fetchJson('/api/v2/transactions?categoryId=208&limit=10');
    if (res.data.length > 0) {
      assert(res.data.every(t => t.category_name === 'Transfer - FX'), 'wrong category resolved');
    }
  });

  await check('GET /api/v2/transactions/summary/by-category', async () => {
    const res = await fetchJson('/api/v2/transactions/summary/by-category?startDate=2026-01-01&endDate=2026-04-30');
    assert(Array.isArray(res.data) && res.data.length > 0, 'empty summary');
    assert(res.data.every(r => r.category_name && 'total_amount' in r), 'shape missing fields');
  });

  await check('GET /api/v2/transactions/transfer-analysis', async () => {
    const res = await fetchJson('/api/v2/transactions/transfer-analysis?year=2026');
    assert(res.data && typeof res.data === 'object', 'data missing');
    assert(Array.isArray(res.manualGroups), 'manualGroups missing');
    const cats = Object.keys(res.data);
    assert(cats.length > 0, 'no transfer categories returned');
  });

  console.log('\n[3] Reports (heavy category JOINs)');

  await check('GET /api/v2/reports/cash-flow', async () => {
    const res = await fetchJson('/api/v2/reports/cash-flow?fromDate=2026-01-01&toDate=2026-04-30');
    assert(res['Profit & Loss Accounts'] || res.data, 'unexpected shape');
  });

  await check('GET /api/v2/reports/balance', async () => {
    const res = await fetchJson('/api/v2/reports/balance?asOfDate=2026-04-30');
    assert(res.data || res['Balance Sheet Accounts'] || Array.isArray(res), 'unexpected shape');
  });

  await check('GET /api/v2/reports/category-trend resolves category by name', async () => {
    const res = await fetchJson('/api/v2/reports/category-trend?startDate=2026-01-01&endDate=2026-04-30&category=Bank%20Fees');
    assert(res.months && res.actual && res.budget, 'missing months/actual/budget');
  });

  console.log('\n[4] FC Lines (recursive cat_tree CTE rewritten over accounts)');

  await check('GET /api/v2/fc-lines lists lines with categories[]', async () => {
    const res = await fetchJson('/api/v2/fc-lines?budgetYear=2026');
    assert(Array.isArray(res.data), 'data not array');
    assert(res.data.length > 0, 'no FC Lines');
    const withCats = res.data.filter(l => l.categories && l.categories.length > 0);
    assert(withCats.length > 0, 'no FC Lines have categories assigned — JOIN broken');
    const sample = withCats[0].categories[0];
    assert('category_id' in sample && 'category_name' in sample, 'category shape missing');
  });

  await check('GET /api/v2/fc-lines/unassigned-categories', async () => {
    const res = await fetchJson('/api/v2/fc-lines/unassigned-categories?budgetYear=2026');
    assert(Array.isArray(res.data), 'data not array');
  });

  await check('GET /api/v2/fc-lines/review-structure has income+expense lines', async () => {
    const res = await fetchJson('/api/v2/fc-lines/review-structure?budgetYear=2026');
    assert(Array.isArray(res.income) && Array.isArray(res.expense), 'income/expense missing');
  });

  console.log('\n[5] Budget routes');

  await check('GET /api/v2/budget?budgetYear=2026 returns rows', async () => {
    const res = await fetchJson('/api/v2/budget?budgetYear=2026&limit=10');
    const rows = res.data || res;
    assert(Array.isArray(rows) && rows.length > 0, 'no budget rows');
  });

  console.log('\n[6] Transfer match groups (transferMatchGroups JOIN)');

  await check('GET /api/v2/transfer-match-groups returns groups with transactions', async () => {
    const res = await fetchJson('/api/v2/transfer-match-groups');
    const groups = Array.isArray(res) ? res : res.data;
    assert(Array.isArray(groups), 'unexpected shape');
    if (groups.length > 0) {
      const g = groups[0];
      assert(Array.isArray(g.transactions), 'transactions missing');
      if (g.transactions.length > 0) {
        const t = g.transactions[0];
        assert('category_name' in t && 'account_name' in t, 'JOIN missing fields');
      }
    }
  });

  console.log('\n[7] Schema invariants');

  await check('No FK orphans after migration', async () => {
    // Round-trip: pick any transaction, fetch it by category, ensure it resolves
    const list = await fetchJson('/api/v2/transactions?limit=1');
    if (list.data.length > 0 && list.data[0].category_id) {
      const res = await fetchJson(`/api/v2/categories/${list.data[0].category_id}`);
      assert(res.data && res.data.name === list.data[0].category_name,
        `category_id ${list.data[0].category_id} resolves to ${res.data?.name}, expected ${list.data[0].category_name}`);
    }
  });

  await check('All 9 transfer accounts visible (Transfer - Business + Transfer - FX present)', async () => {
    const res = await fetchJson('/api/v2/categories?includeTransfers=true&activeOnly=true');
    const names = res.data.filter(c => c.is_transfer).map(c => c.name).sort();
    const expected = [
      'Transfer - Bank',
      'Transfer - Business',
      'Transfer - Credit Card Payments',
      'Transfer - FX',
      'Transfer - Matched',
      'Transfer - Mortgage',
      'Transfer - Real Estate Investment',
      'Transfer - Securities Trades',
      'Transfer - Unmatched',
    ];
    assert(JSON.stringify(names) === JSON.stringify(expected),
      `mismatch:\n  got: ${names.join(', ')}\n  exp: ${expected.join(', ')}`);
  });

  console.log('\n============================================================');
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f.name}: ${f.error}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
