#!/usr/bin/env node
/**
 * load-dividends.js — CR093 §5b. Distribution history, so an equity can state a
 * yield.
 *
 * fin had none: `security_transactions` holds 0 rows, so the detail panel could
 * show a bond's coupon and an equity's nothing.
 *
 * ⚠️ Only CASH DIVIDENDS (`CD`) count toward a yield. Capital-gains
 * distributions are stored too — the money is real — but reported separately,
 * because a fund's year-end turnover is not an income rate and would look
 * exactly like one.
 *
 * DRY RUN BY DEFAULT — pass --apply to write.
 * Idempotent: upserts on (security_id, ex_date, dividend_type).
 *
 * Rollback:  DELETE FROM security_dividends WHERE source = 'tradier';
 *            UPDATE securities SET dividends_as_of = NULL;
 *
 * Usage: node Scripts/load-dividends.js [--apply]
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
const { loadDividends } = require('../server/src/v2/services/tradierDividends');

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — Tradier distribution history\n`);

  const s = await loadDividends({ apply: APPLY, token: process.env.TRADIER_ACCESS_TOKEN });

  console.log(`  priceable securities asked:  ${s.securities}`);
  console.log(`  answered:                    ${s.resolved}`);
  console.log(`  distributions ${APPLY ? 'written' : 'found'}:      ${APPLY ? s.written : s.rows}`);

  if (s.paysNothing.length) {
    console.log(`\n  ${s.paysNothing.length} answered with NO distributions — a fact about the`
      + ' instrument, not a gap, and recorded as such via dividends_as_of:');
    console.log(`    ${s.paysNothing.join(', ')}`);
  }
  if (s.failed.length) {
    console.log(`\n  🔴 ${s.failed.length} could not be asked at all:`);
    for (const f of s.failed) console.log(`    ${f.ticker}: ${f.error}`);
  }
  if (!APPLY) console.log('\nDRY RUN — nothing was written. Re-run with --apply.');
}

main()
  .then(async () => { await db.close(); })
  .catch(async (err) => {
    console.error(err.message);
    try { await db.close(); } catch { /* closing */ }
    process.exit(1);
  });
