#!/usr/bin/env node
/**
 * backfill-tradier-prices.js — CR093.
 *
 * Replaces fintable as the source of `security_prices` with Tradier, whose
 * history is measurably deeper: 3,112 daily bars for DIA back to 2014-04-17,
 * against fintable's measured floor of ~2020-08.
 *
 * ⚠️ The depth is the point. fin held 44 trading days; MACD 12/26/9 emits
 * nothing until ~35 points, so the indicator the owner asked for would have been
 * almost entirely warm-up. Any selectable period beyond 2M would have been empty.
 *
 * ⚠️ Prints every date where Tradier and the existing feed DISAGREE before
 * adopting Tradier. CR089 measured fintable's own two endpoints disagreeing by
 * 0.65% about the same close, so two providers certainly will; the row can only
 * hold one number, and a silent overwrite is how a chart and a valuation end up
 * differing with nothing to explain it.
 *
 * DRY RUN BY DEFAULT — pass --apply to write.
 * Idempotent: upserts on (security_id, price_date).
 *
 * Rollback:  DELETE FROM security_prices WHERE source = 'tradier';
 *            (then re-run Scripts/backfill-prices.js to restore fintable rows)
 *
 * Usage: node Scripts/backfill-tradier-prices.js --start 2014-01-01 [--apply]
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
const { backfillFromTradier } = require('../server/src/v2/services/tradierPrices');

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const START = argVal('--start', '2014-01-01');
const END = argVal('--end', new Date().toISOString().slice(0, 10));

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — Tradier daily closes ${START}..${END}\n`);

  const s = await backfillFromTradier({
    start: START, end: END, apply: APPLY, token: process.env.TRADIER_ACCESS_TOKEN,
  });

  console.log(`  probeable securities (per_share only): ${s.securities}`);
  console.log(`  resolved to a working symbol:          ${s.resolved}`);
  console.log(`  bars ${APPLY ? 'written' : 'available'}: ${APPLY ? s.written : s.bars}`);

  if (s.disagreed.length) {
    console.log(`\n  ⚠️ ${s.disagreed.length} security(ies) where Tradier and the existing feed disagree`);
    console.log('     on a shared date by >0.1%. Tradier is adopted; this is the record of what changed:');
    for (const d of s.disagreed.slice(0, 12)) {
      console.log(`       ${d.symbol.padEnd(8)} ${d.count} date(s), worst ${d.worst.date}`
        + ` ${d.worst.was.toFixed(4)} → ${d.worst.now.toFixed(4)} (${d.worst.pct.toFixed(3)}%)`);
    }
  }
  if (s.unresolved.length) {
    console.log(`\n  ${s.unresolved.length} security(ies) returned no bars — expected for anything without`);
    console.log('  an intraday market (open-end funds price by daily NAV):');
    console.log(`    ${s.unresolved.join(' ')}`);
  }
  if (s.failed.length) {
    console.log(`\n  🔴 ${s.failed.length} lookup(s) failed (the feed, not the ticker):`);
    for (const f of s.failed.slice(0, 10)) console.log(`    ${f.symbol}: ${f.error}`);
  }

  if (APPLY) {
    const { rows } = await db.query(`
      SELECT source, count(*)::int AS n, min(price_date)::text AS a, max(price_date)::text AS b
        FROM security_prices GROUP BY source ORDER BY 2 DESC`);
    console.log('\nsecurity_prices now holds:');
    for (const r of rows) console.log(`  ${r.source.padEnd(10)} ${String(r.n).padStart(7)} closes  ${r.a}..${r.b}`);
  } else {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply.');
  }

  await db.close();
  process.exit(s.failed.length ? 1 : 0);
}

main().catch(async (e) => { console.error(e.message); try { await db.close(); } catch { /* closing */ } process.exit(2); });
