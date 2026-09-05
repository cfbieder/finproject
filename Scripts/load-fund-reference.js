#!/usr/bin/env node
/**
 * load-fund-reference.js — CR093 P1.
 *
 * Persists what each fund IS and what it is made of, from the FinImpulse
 * summary endpoint, into the tables migration 077 adds. The Portfolio X-ray
 * reads these; it never calls a vendor on page load.
 *
 * ⚠️ THE SUM-TO-1 CHECK IS THE POINT, and migration 077 says so explicitly: it
 * is a cross-row invariant that no CHECK constraint can express. A PARTIAL set
 * of weights is the dangerous shape — it looks perfectly well-formed and
 * silently under-counts a fund's exposure, which on QQQ at $162,573 would move
 * real money out of the sector chart with nothing to notice it. Measured
 * 2026-09-05: all 23 funds that returned weights summed to 100.0000%.
 *
 * ⚠️ ABSENCE IS RECORDED, NOT INFERRED. `sector_weights_as_of` is set even when
 * a fund yields ZERO weight rows, because a bond fund genuinely has no equity
 * sectors and that must not read as "never asked". Same distinction as
 * polled_on/valued_on, and as snapshot status empty/absent.
 *
 * DRY RUN BY DEFAULT — pass --apply.
 * Usage: node Scripts/load-fund-reference.js --ref <json> [--apply]
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

const argv = process.argv;
const APPLY = argv.includes('--apply');
const refIdx = argv.indexOf('--ref');
const REF = refIdx >= 0 && argv[refIdx + 1] ? argv[refIdx + 1] : null;
const SOURCE = 'finimpulse';
const TODAY = new Date().toISOString().slice(0, 10);

async function main() {
  if (!REF) throw new Error('pass --ref <fund_reference.json>');
  const ref = JSON.parse(fs.readFileSync(REF, 'utf8'));
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — fund reference for ${Object.keys(ref).length} symbols\n`);

  let cats = 0; let wsets = 0; let wrows = 0; let none = 0; const refused = []; const missing = [];

  for (const [sym, r] of Object.entries(ref)) {
    const { rows } = await db.query('SELECT id FROM securities WHERE ticker = $1', [sym]);
    if (!rows.length) { missing.push(sym); continue; }
    const id = rows[0].id;
    const w = r.sector_weights || {};
    const keys = Object.keys(w);
    const sum = keys.reduce((a, k) => a + Number(w[k]), 0);

    // 🔴 Refuse the whole set rather than store part of it.
    if (keys.length && Math.abs(sum - 1) > 0.005) {
      refused.push({ sym, sum, n: keys.length });
      continue;
    }
    if (keys.length) { wsets += 1; wrows += keys.length; } else { none += 1; }
    if (r.category) cats += 1;

    if (!APPLY) continue;

    await db.query(`UPDATE securities
                       SET fund_category = $2, sector_weights_as_of = $3, updated_at = now()
                     WHERE id = $1`, [id, r.category || null, TODAY]);
    // Replace rather than merge: a fund that DROPS a sector must lose the row,
    // or a stale sector lingers forever and the set stops summing to 1.
    await db.query('DELETE FROM security_sector_weights WHERE security_id = $1', [id]);
    for (const k of keys) {
      await db.query(`INSERT INTO security_sector_weights (security_id, sector, weight, source)
                      VALUES ($1,$2,$3,$4)`, [id, k, w[k], SOURCE]);
    }
  }

  console.log(`  categories stored:            ${cats}`);
  console.log(`  funds with sector weights:    ${wsets}  (${wrows} rows)`);
  console.log(`  funds asked, none applicable: ${none}  ← recorded as asked, not as unknown`);
  if (missing.length) console.log(`  not held by fin (skipped):    ${missing.join(' ')}`);
  if (refused.length) {
    console.log(`\n  🔴 ${refused.length} weight set(s) REFUSED for not summing to 100%:`);
    for (const x of refused) console.log(`     ${x.sym}: ${x.n} sectors summing to ${(x.sum * 100).toFixed(2)}%`);
  }

  if (APPLY) {
    const { rows: chk } = await db.query(`
      SELECT s.ticker, ROUND(SUM(w.weight), 6)::float AS total
        FROM security_sector_weights w JOIN securities s ON s.id = w.security_id
       GROUP BY s.ticker HAVING ABS(SUM(w.weight) - 1) > 0.005`);
    console.log(chk.length
      ? `\n🔴 ${chk.length} stored set(s) do not sum to 1: ${chk.map((c) => `${c.ticker}=${c.total}`).join(', ')}`
      : '\n✓ every stored weight set sums to 100% — re-read from the database, not from the fetch');
  } else {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
  }
  await db.close();
}
main().catch(async (e) => { console.error(e.message); try { await db.close(); } catch { /* closing */ } process.exit(2); });
