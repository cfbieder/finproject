#!/usr/bin/env node
/**
 * backfill-fin-positions.js — CR061 P1.
 *
 * Walks bank-feed's stored holdings history day by day into fin's
 * `security_position_snapshots` / `security_positions`.
 *
 * Run AFTER `bank-feed/scripts/backfill-holdings.js`, which is what puts the
 * history into bank-feed in the first place. This one does no upstream fetching:
 * it reads `/v1/holdings?as_of=<date>`, which returns the latest snapshot at or
 * before that date per account.
 *
 * ⚠️ Back-dated snapshots carry NO `custodian_balance`, so they produce no
 * residual. That is deliberate and it comes from bank-feed: `/accounts` reports
 * only TODAY's balance, so pairing it with a July snapshot would assert a
 * reconciliation nobody ever measured. A historical day is positions without a
 * residual, which is the truth about it.
 *
 * DRY RUN BY DEFAULT — pass --apply to write.
 * Idempotent: re-running replaces each day's positions rather than adding to
 * them, so an interrupted run is simply re-runnable.
 *
 * Rollback, since positions are re-derivable:
 *   DELETE FROM security_position_snapshots WHERE polled_on < '<today>';
 *
 * Usage: node Scripts/backfill-fin-positions.js --from 2026-07-04 [--apply]
 */

const path = require('node:path');
const fs = require('node:fs');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
// The server's own URL is written for the CONTAINER; this runs on the host.
process.env.BANK_FEED_URL = (process.env.BANK_FEED_URL || 'http://localhost:3007')
  .replace('host.docker.internal', 'localhost');
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `postgres://fin:${process.env.POSTGRES_PASSWORD}@localhost:${process.env.FIN_DB_PORT || 5434}/fin`;
}

const db = require('../server/src/v2/db');
const { ingestHoldings } = require('../server/src/v2/services/ingestHoldings');

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const FROM = argVal('--from', '2026-07-04');
const TO = argVal('--to', new Date().toISOString().slice(0, 10));

function eachDate(from, to) {
  const out = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const dates = eachDate(FROM, TO);
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${dates.length} days, ${FROM}..${TO}`);
  if (!APPLY) {
    console.log('(nothing will be written; pass --apply)\n');
    const probe = await ingestHoldingsDry(dates[dates.length - 1]);
    console.log(`latest day would ingest: ${probe.accounts} accounts, ${probe.positions} positions`);
    await db.close();
    return;
  }

  let headers = 0;
  let positions = 0;
  let securities = 0;
  const failures = [];
  for (const date of dates) {
    try {
      const s = await ingestHoldings({ asOf: date });
      if (s.error) { failures.push({ date, error: s.error }); continue; }
      headers += s.headers;
      positions += s.positions;
      securities += s.securities_created;
      if (dates.indexOf(date) % 10 === 0) {
        process.stdout.write(`  ${date}: ${s.headers} snapshots, ${s.positions} positions\n`);
      }
    } catch (err) {
      failures.push({ date, error: err.message });
    }
  }

  console.log(`\nstored: ${headers} snapshots, ${positions} positions, ${securities} new securities`);
  if (failures.length) {
    console.log(`🔴 ${failures.length} day(s) failed — re-run to fill them:`);
    for (const f of failures.slice(0, 5)) console.log(`   ${f.date}: ${f.error}`);
  }

  const { rows } = await db.query(`
    SELECT min(polled_on) AS earliest, max(polled_on) AS latest,
           count(DISTINCT polled_on) AS days, count(*) AS snapshots,
           (SELECT count(*) FROM security_positions) AS positions
      FROM security_position_snapshots`);
  // fin's db layer parses DATE as a plain YYYY-MM-DD string (the same fix
  // bank-feed applies), so these are already strings — calling toISOString on
  // them throws.
  console.log(`\nfin now holds: ${rows[0].snapshots} snapshots over ${rows[0].days} days `
    + `(${rows[0].earliest}..${rows[0].latest}), ${rows[0].positions} positions`);
  await db.close();
  process.exit(failures.length ? 1 : 0);
}

// A dry run must not write, and ingestHoldings always writes — so the dry path
// only reports what the feed would offer, without calling it.
async function ingestHoldingsDry(asOf) {
  const bankFeedClient = require('../server/src/v2/services/bankFeedClient');
  const resp = await bankFeedClient.holdings(asOf);
  const list = (resp && resp.holdings) || [];
  return {
    accounts: list.length,
    positions: list.reduce((n, a) => n + (a.positions || []).length, 0),
  };
}

main().catch(async (e) => { console.error(e.message); try { await db.close(); } catch { /* closing */ } process.exit(2); });
