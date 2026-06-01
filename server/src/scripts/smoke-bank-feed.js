#!/usr/bin/env node
/**
 * Bank-feed parallel-import smoke test (CR022 §5.4).
 *
 * Live-server check of the additive bank-feed ingest path against a running fin
 * server (which must reach the bank-feed microservice). Asserts HTTP status,
 * response shape, idempotency, and the R1/R2 diagnostic surface. Uses ≥ not =
 * because live counts drift.
 *
 * Run:
 *   BASE_URL=http://localhost:3105 node server/src/scripts/smoke-bank-feed.js
 *   (3105 = dev; 3005 = prod once deployed)
 *
 * Exits non-zero on any failure. NOT read-only: it triggers a /refresh, which
 * stages live data and promotes mapped+un-ignored accounts (R1 fail-closed —
 * unmapped accounts never promote). On prod this is a real parallel-run write.
 * On dev, to reset after a run:
 *   DELETE FROM bankfeed_staging;
 *   DELETE FROM transactions WHERE source='bank-feed';
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3105';

let passed = 0;
let failed = 0;
const failures = [];

function fetchJson(path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request(
      url,
      {
        method,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { /* leave null */ }
          resolve({ status: res.statusCode, body: parsed, raw: data });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
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
  console.log(`\nBank-feed smoke test against ${BASE_URL}`);
  console.log('============================================================');

  console.log('\n[1] bank-feed service reachable through fin');

  await check('GET /api/v2/bank-feed/health → ok', async () => {
    const res = await fetchJson('/api/v2/bank-feed/health');
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body && res.body.status === 'ok', `status field: ${JSON.stringify(res.body)}`);
  });

  await check('GET /api/v2/bank-feed/accounts → ≥ 1 account', async () => {
    const res = await fetchJson('/api/v2/bank-feed/accounts');
    assert(res.status === 200, `status ${res.status}`);
    const list = Array.isArray(res.body) ? res.body : (res.body && res.body.accounts) || [];
    assert(list.length >= 1, `expected ≥1 account, got ${list.length}`);
  });

  console.log('\n[2] R1 mapping surface');

  await check('GET /api/v2/bank-feed/account-mappings → per-account status + staged count', async () => {
    const res = await fetchJson('/api/v2/bank-feed/account-mappings');
    assert(res.status === 200, `status ${res.status}`);
    const accts = (res.body && res.body.accounts) || [];
    assert(accts.length >= 1, 'no accounts');
    const a = accts[0];
    assert('status' in a && 'ignored' in a && 'staged_unpromoted' in a,
      `row missing R1 fields: ${JSON.stringify(a)}`);
    assert(['pending', 'mapped', 'ignored'].includes(a.status), `bad status ${a.status}`);
  });

  console.log('\n[3] ingest pipeline');

  let firstStaged = 0;
  await check('POST /api/v2/ingest-bank-feed/refresh {sinceDays:14} → ingest+sync shape', async () => {
    const res = await fetchJson('/api/v2/ingest-bank-feed/refresh', { method: 'POST', body: { sinceDays: 14 } });
    assert(res.status === 200, `status ${res.status}: ${res.raw?.slice(0, 200)}`);
    assert(res.body.ingest && res.body.sync, 'missing ingest/sync');
    assert(typeof res.body.sync.inserted === 'number', 'sync.inserted not a number');
    assert(Array.isArray(res.body.sync.unmappedAccounts), 'unmappedAccounts not array');
    assert(Array.isArray(res.body.sync.ignoredAccounts), 'ignoredAccounts not array');
    firstStaged = res.body.ingest.staged;
  });

  await check('POST /refresh again → idempotent (ingest.insertedCount 0, all updates)', async () => {
    const res = await fetchJson('/api/v2/ingest-bank-feed/refresh', { method: 'POST', body: { sinceDays: 14 } });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.ingest.insertedCount === 0,
      `re-run staged ${res.body.ingest.insertedCount} new rows (expected 0 — not idempotent)`);
  });

  await check('GET /api/v2/ingest-bank-feed/count → ≥ staged from first run', async () => {
    const res = await fetchJson('/api/v2/ingest-bank-feed/count');
    assert(res.status === 200, `status ${res.status}`);
    assert(typeof res.body.count === 'number', 'count not a number');
    assert(res.body.count >= firstStaged, `count ${res.body.count} < firstStaged ${firstStaged}`);
  });

  console.log('\n[4] regression net — PS path still alive');

  await check('GET /api/v2/transactions?source=pocketsmith&limit=1 → ≥ 1 PS row', async () => {
    const res = await fetchJson('/api/v2/transactions?source=pocketsmith&limit=1');
    assert(res.status === 200, `status ${res.status}`);
    const rows = (res.body && (res.body.data || res.body)) || [];
    assert(rows.length >= 1, 'no pocketsmith rows — discriminator may have nuked PS history');
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
