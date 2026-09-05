#!/usr/bin/env node
/**
 * classify-funds.js — CR093.
 *
 * Corrects `securities.asset_class` for the funds fin holds. Four bond funds
 * were classified `equity` — FLDR ($533,703), HYG, NVG, AGG — which is
 * **$566,716, 14.6% of the portfolio** in the wrong bucket, and it makes fin's
 * equity/fixed-income split read 48/43 when the truth is nearer 42/58.
 *
 * ⚠️ NO MARKET-DATA VENDOR COULD ANSWER THIS. Tradier returns a null asset
 * class for every fund tested. FinImpulse does return one, and it independently
 * confirms three of the four (`Ultrashort Bond`, `High Yield Bond`,
 * `Intermediate Core Bond`) — but it classifies CLOSED-END funds as `stock` and
 * returns no category at all for them, which is exactly where NVG sits.
 *
 * So the rule is: the vendor's `category` decides where it has one; a named
 * judgement decides where it does not, and says so. Both land as
 * `classification_source = 'manual'`, because neither is an inference from
 * symbol shape — which is the thing that column exists to keep out (CR061 P1
 * rejected a classifier that made FDIC91125 a bond and FCNTX an equity).
 *
 * DRY RUN BY DEFAULT — pass --apply.
 * Usage: node Scripts/classify-funds.js [--apply]   (FIN_DB_PORT=5433 for prod)
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
const APPLY = process.argv.includes('--apply');

/** Vendor category → fin asset_class. "Bond"/"Muni" in the name is the whole rule. */
const fromCategory = (c) => (/bond|muni/i.test(c || '') ? 'bond' : 'equity');

/**
 * Funds the vendor cannot classify, decided by name and recorded as such.
 * ⚠️ Only entries whose reasoning is written down belong here.
 */
const BY_NAME = {
  // "NUVEEN AMT FREE MUN CR INC FD" — AMT-Free MUNICIPAL Credit Income Fund.
  // A closed-end muni bond fund; FinImpulse reports it as `stock`.
  NVG: { cls: 'bond', why: 'closed-end MUNICIPAL bond fund (vendor reports it as stock)' },
  // Closed-end EQUITY funds running covered-call overlays. Equity exposure.
  EOS: { cls: 'equity', why: 'closed-end enhanced-equity income fund (covered calls)' },
  BDJ: { cls: 'equity', why: 'closed-end enhanced-dividend equity trust (covered calls)' },
  // Open-end equity fund. Already `mutual_fund`, which is correct and kept:
  // it is the distinction that explains why it has no quote and no chart.
  FCNTX: { cls: 'mutual_fund', why: 'open-end equity fund — priced by daily NAV, no intraday market' },
};

async function main() {
  // ⚠️ `indexOf` returns -1 when the flag is absent, and argv[-1 + 1] is argv[0]
  // — the node binary. Guard the index, or the script reads its own interpreter.
  const i = process.argv.indexOf('--ref');
  const refPath = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
  if (!refPath) throw new Error('pass --ref <fund_reference.json> (from the FinImpulse fetch)');
  const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — fund asset_class\n`);
  let changed = 0; let moved = 0;

  for (const [sym, r] of Object.entries(ref)) {
    const target = r.category ? fromCategory(r.category) : (BY_NAME[sym] || {}).cls;
    if (!target) { console.log(`  ${sym.padEnd(7)} ⚠️ no category and no named rule — LEFT ALONE`); continue; }
    const why = r.category ? `vendor category "${r.category}"` : BY_NAME[sym].why;

    const { rows } = await db.query(
      'SELECT id, asset_class, name FROM securities WHERE ticker = $1', [sym]);
    if (!rows.length) continue;
    const s = rows[0];
    if (s.asset_class === target) continue;

    const { rows: v } = await db.query(`
      SELECT COALESCE(SUM(p.market_value),0)::float AS mv FROM security_positions p
       -- The LATEST snapshot PER ACCOUNT, not one snapshot overall: a single
       -- LIMIT 1 picks whichever account sorted first and reports 0 for every
       -- holding of the other four.
       WHERE p.security_id = $1 AND p.snapshot_id IN (
         SELECT DISTINCT ON (account_id) id FROM security_position_snapshots
          WHERE source='bank-feed' ORDER BY account_id, polled_on DESC)`, [s.id]);
    changed += 1; moved += v[0].mv;
    console.log(`  ${sym.padEnd(7)} ${s.asset_class} → ${target}   $${v[0].mv.toLocaleString('en-US', { maximumFractionDigits: 0 }).padStart(9)}   ${why}`);

    if (APPLY) {
      await db.query(`UPDATE securities
                         SET asset_class = $2, classification_source = 'manual', updated_at = now()
                       WHERE id = $1`, [s.id, target]);
    }
  }

  console.log(`\n${changed} security(ies) reclassified, $${moved.toLocaleString('en-US', { maximumFractionDigits: 0 })} of live positions affected.`);
  const { rows: split } = await db.query(`
    SELECT s.asset_class, ROUND(SUM(p.market_value)::numeric,0) AS mv
      FROM security_positions p JOIN securities s ON s.id = p.security_id
     WHERE p.snapshot_id IN (SELECT DISTINCT ON (account_id) id FROM security_position_snapshots
                              WHERE source='bank-feed' ORDER BY account_id, polled_on DESC)
     GROUP BY 1 ORDER BY 2 DESC`);
  const tot = split.reduce((a, b) => a + Number(b.mv), 0);
  console.log(`\n${APPLY ? 'Portfolio' : 'Portfolio (unchanged — dry run)'} by asset class:`);
  for (const r of split) console.log(`  ${r.asset_class.padEnd(12)} $${Number(r.mv).toLocaleString('en-US').padStart(11)}  ${(100 * r.mv / tot).toFixed(1)}%`);

  if (!APPLY) console.log('\nDRY RUN — nothing written. Re-run with --apply.');
  await db.close();
}
main().catch(async (e) => { console.error(e.message); try { await db.close(); } catch { /* closing */ } process.exit(2); });
