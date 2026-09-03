#!/usr/bin/env node
/**
 * backfill-prices.js — CR061 P1.
 *
 * Fills `security_prices` with dated daily closes for every security it is SAFE
 * to ask about — fin's first market-price data, in a table that has been 0 rows
 * since May 2026.
 *
 * ⚠️ Only `price_basis = 'per_share'` securities are ever asked. That gate is
 * structural, not a threshold: a CUSIP priced per-100-face or a deposit held at
 * par must never reach a ticker lookup, because 100,000 of face value at an
 * equity's share price books $25,000,000 from one bad classification.
 *
 * Quotability is EARNED here. `securities.quote_symbol` is written only once a
 * symbol has actually returned bars, so a security that never returns any keeps
 * NULL — which is a fact about the instrument (a mutual fund has no intraday
 * market) rather than a failure, and is what lets "no quote because it is a
 * fund" be told apart from "no quote because the lookup is broken".
 *
 * DRY RUN BY DEFAULT — pass --apply to write.
 * Idempotent: upserts on (security_id, price_date).
 *
 * Rollback:  DELETE FROM security_prices WHERE source = 'fintable';
 *
 * Usage: node Scripts/backfill-prices.js --start 2026-07-04 --end 2026-09-02 [--apply]
 */

const path = require('node:path');
const fs = require('node:fs');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `postgres://fin:${process.env.POSTGRES_PASSWORD}@localhost:${process.env.FIN_DB_PORT || 5434}/fin`;
}

const db = require('../server/src/v2/db');
const { backfillCloses } = require('../server/src/v2/services/marketPrices');

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const START = argVal('--start', '2026-07-04');
const END = argVal('--end', new Date().toISOString().slice(0, 10));

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — daily closes ${START}..${END}\n`);

  const s = await backfillCloses({ start: START, end: END, apply: APPLY });

  console.log(`  probeable securities (per_share only): ${s.securities}`);
  console.log(`  resolved to a working quote symbol:    ${s.resolved}`);
  console.log(`  bars ${APPLY ? 'written' : 'available'}:${' '.repeat(APPLY ? 26 : 24)}${APPLY ? s.written : s.bars}`);

  if (s.unresolved.length) {
    console.log(`\n  ${s.unresolved.length} security(ies) returned no bars — expected for anything`);
    console.log('  without an intraday market (open-end funds price by daily NAV):');
    for (const u of s.unresolved) console.log(`    ${u}`);
  }
  if (s.failed.length) {
    console.log(`\n  🔴 ${s.failed.length} lookup(s) failed (5xx — the feed, not the ticker):`);
    for (const f of s.failed.slice(0, 10)) console.log(`    ${f.symbol}: ${f.error}`);
  }

  if (APPLY) {
    const { rows } = await db.query(`
      SELECT count(*)::int AS n, min(price_date)::text AS a, max(price_date)::text AS b
        FROM security_prices WHERE source = 'fintable'`);
    console.log(`\nsecurity_prices now holds ${rows[0].n} closes, ${rows[0].a}..${rows[0].b}`);
    const { rows: norm } = await db.query(`
      SELECT ticker, quote_symbol FROM securities
       WHERE quote_symbol IS NOT NULL AND quote_symbol IS DISTINCT FROM ticker`);
    if (norm.length) {
      console.log('\nsymbols where the custodian and the quote feed disagree:');
      // Worth printing every time: a symbol that stops resolving goes silently
      // unquoted, and a missing quote looks exactly like a market that did not move.
      for (const n of norm) console.log(`  custodian ${n.ticker} → quote feed ${n.quote_symbol}`);
    }
  } else {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply.');
  }

  await db.close();
  process.exit(s.failed.length ? 1 : 0);
}

main().catch(async (e) => { console.error(e.message); try { await db.close(); } catch { /* closing */ } process.exit(2); });
