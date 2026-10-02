#!/usr/bin/env node
'use strict';
// bank-feed-guard-replay.js — is a tripped bank-feed insert guard a REAL re-key, or a busy day?
//
// READ-ONLY. Replays one bank-feed sync's fetch, convert and account steps inside a
// database transaction that is ALWAYS rolled back, then lists every transaction the
// sync would INSERT and whether bank-feed already holds a same-value twin (same
// account, same amount, date ±3) under another id. Twins are the signature of
// upstream ids being re-minted — the failure the guard exists for. No twins means
// the new rows are genuine and the guard tripped on volume (2026-10-01: month-end,
// 79 new of 261, 0 twins). See docs/guides/feed-stall-runbook.md.
//
// It runs INSIDE the bank-feed container, which holds the Fintable token and DB env:
//   docker cp Scripts/bank-feed-guard-replay.js bank-feed-app:/tmp/replay.js
//   docker exec -w /app bank-feed-app node /tmp/replay.js
//   docker exec bank-feed-app rm -f /tmp/replay.js
// It makes the same read calls to Fintable that one scheduled sync makes.
const fs = require('fs');
const Module = require('module');

// The fetch/convert helpers are not exported; compile the module with an export
// appended rather than copying them, so the replay cannot drift from the real sync.
const path = '/app/src/services/fintableSync.js';
const src = `${fs.readFileSync(path, 'utf8')}
module.exports.__fetch = fetchAndConvertFromApi;
module.exports.__fetchFloor = fetchFloor;
module.exports.__ensureConnections = ensureConnections;
module.exports.__upsertAccounts = upsertAccounts;
module.exports.__planBoundaryCarryover = planBoundaryCarryover;`;
const m = new Module(path, module);
m.filename = path;
m.paths = Module._nodeModulePaths('/app/src/services');
m._compile(src, path);
const S = m.exports;
const { pool } = require('/app/src/db');

(async () => {
  const syncDate = new Date().toISOString().slice(0, 10);
  const floor = S.__fetchFloor(syncDate);
  const { converted } = await S.__fetch(0, syncDate, {}, floor);
  const client = await pool.connect();
  const fresh = [];
  try {
    await client.query('BEGIN');
    const conn = await S.__ensureConnections(client, converted.accounts, {});
    const ext = await S.__upsertAccounts(client, conn, converted.accounts, {});
    await S.__planBoundaryCarryover(client, converted.transactions, ext, floor);
    for (const t of converted.transactions) {
      const accountId = ext.get(t.external_account_id);
      if (!accountId) continue;
      const held = await client.query(
        'SELECT 1 FROM feed_transactions WHERE account_id = $1 AND external_id = $2',
        [accountId, t.external_id]
      );
      if (held.rows.length) continue;
      const twin = await client.query(
        `SELECT 1 FROM feed_transactions
          WHERE account_id = $1 AND amount = $2
            AND transaction_date BETWEEN $3::date - 3 AND $3::date + 3`,
        [accountId, t.amount, t.transaction_date]
      );
      fresh.push({ date: t.transaction_date, amount: t.amount, ccy: t.currency, account: accountId, twin: twin.rows.length > 0 });
    }
  } finally {
    await client.query('ROLLBACK');   // always — this script writes nothing
    client.release();
  }
  const twins = fresh.filter((r) => r.twin);
  const byDate = {};
  for (const r of fresh) byDate[r.date] = (byDate[r.date] || 0) + 1;
  console.log(`fetched ${converted.transactions.length} · would insert ${fresh.length} · with a same-value twin already held: ${twins.length}`);
  console.log('would insert, by date:', JSON.stringify(byDate));
  for (const r of twins) console.log(`TWIN ${r.date} ${r.amount} ${r.ccy} account ${r.account}`);
  console.log(fresh.length === 0
    ? 'VERDICT: nothing new to insert — if syncs are failing, the guard is not the cause.'
    : twins.length === 0
    ? 'VERDICT: no twins — genuine new activity; a tripped guard tripped on volume.'
    : `VERDICT: ${twins.length} twin(s) — possible id re-mint. Do NOT force the sync; investigate.`);
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
