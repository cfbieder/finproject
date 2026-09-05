#!/usr/bin/env node
/**
 * load-equity-sectors.js — CR093 P1.
 *
 * Sectors for SINGLE-NAME holdings, from Tradier's Morningstar-sourced
 * fundamentals. FinImpulse answers what a FUND is made of; it does not classify
 * individual companies, and Tradier does — 12 of 12 measured 2026-09-05.
 *
 * ⚠️ A single name is stored as a FUND WITH ONE SECTOR AT 100%. That is not a
 * trick: it is what it is, and it means the X-ray's sector query needs no
 * special case, no UNION and no branch for "is this a fund". One query covers
 * the whole portfolio, and a holding cannot fall between two code paths.
 *
 * ⚠️ Tradier returns a NUMERIC Morningstar sector code, not a name. The map is
 * eleven values and stable, so it is a local lookup rather than a dependency —
 * and it is deliberately the SAME eleven the fund weights use, or the two halves
 * of the sector chart would not add up.
 *
 * ⚠️ The class-share separator is a SLASH: BRK/B, not BRK.B. Measured — the dot
 * returns no sector at all, and the dot is what this agent assumed before
 * testing it.
 *
 * DRY RUN BY DEFAULT — pass --apply.
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
const { symbolCandidates } = require('../server/src/v2/services/tradierPrices');

const APPLY = process.argv.includes('--apply');
const TOKEN = process.env.TRADIER_ACCESS_TOKEN;
const SOURCE = 'tradier';
const TODAY = new Date().toISOString().slice(0, 10);

/** Morningstar sector codes → the same eleven names the fund weights use. */
const SECTOR = {
  101: 'basic_materials', 102: 'consumer_cyclical', 103: 'financial_services',
  104: 'realestate', 205: 'consumer_defensive', 206: 'healthcare', 207: 'utilities',
  308: 'communication_services', 309: 'energy', 310: 'industrials', 311: 'technology',
};

async function sectorFor(sym) {
  for (const cand of symbolCandidates(sym)) {
    const res = await fetch(
      `https://api.tradier.com/beta/markets/fundamentals/company?symbols=${encodeURIComponent(cand)}`,
      { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } },
    );
    if (!res.ok) continue;
    const body = await res.json();
    for (const e of Array.isArray(body) ? body : []) {
      for (const r of e.results || []) {
        const code = ((r.tables || {}).historical_asset_classification || {}).morningstar_sector_code;
        if (code && SECTOR[code]) return { sector: SECTOR[code], used: cand, code };
      }
    }
  }
  return null;
}

/**
 * 🔴 A CLOSED-END FUND IS NOT AN OPERATING COMPANY, and Tradier answers as if it
 * were. Measured 2026-09-05: BDJ (BlackRock Enhanced Equity Dividend TRUST), EOS
 * (Eaton Vance Enhanced Equity Income FUND II) and UTF (Cohen & Steers
 * INFRASTRUCTURE) all return `financial_services` — which is the sector a fund
 * MANAGER is registered in, not what the fund holds. BDJ and EOS hold
 * diversified equities; UTF holds infrastructure. Booking them as financials
 * would have moved ~$60,000 into a sector none of them is in.
 *
 * It is the fund look-through problem wearing a disguise: these instruments are
 * funds that a quote feed reports as stocks, which is exactly why FinImpulse
 * could not classify them either (quote_type "stock", no category).
 *
 * So a fund-shaped NAME is refused a single-name sector. It gets no row and no
 * as_of date — "not yet asked" rather than a confident wrong answer — and shows
 * in the X-ray as an explicit uncovered bucket.
 */
const FUND_SHAPED = /\b(TRUST|TR\b|FUND|FD\b|ETF|ETP|INDEX|IDX|PORTFOLIO|SHS BEN INT)\b/i;

/**
 * 🔴 AND A NAME REGEX IS NOT ENOUGH. `UTF` is "COHEN &STEERS INFRASTRUCTURE COM"
 * — a closed-end infrastructure fund whose name contains no fund word at all, so
 * it sails through FUND_SHAPED and collects `financial_services` from Tradier.
 *
 * Nor can a second vendor arbitrate: FinImpulse reports UTF and BDJ with exactly
 * the same `quote_type: stock` and `sector: Financial Services`. Both are
 * *correct* about the legal entity and both are wrong about the exposure, which
 * is why asking a third would not help either.
 *
 * So this is an explicit, named list — the same conclusion CR093 reached for fund
 * asset class, and for the same reason: it is four judgements, and no feed sells
 * the answer. An entry here must say what the fund actually holds.
 */
const CLOSED_END = {
  BDJ: 'BlackRock Enhanced Equity Dividend Trust — diversified US equities, not financials',
  EOS: 'Eaton Vance Enhanced Equity Income Fund II — diversified US equities, not financials',
  UTF: 'Cohen & Steers Infrastructure Fund — utilities and infrastructure, not financials',
  NVG: 'Nuveen AMT-Free Municipal Credit Income Fund — municipal BONDS (already classed bond)',
};

async function main() {
  if (!TOKEN) throw new Error('TRADIER_ACCESS_TOKEN is not set');
  const { rows } = await db.query(`
    WITH latest AS (SELECT DISTINCT ON (account_id) id FROM security_position_snapshots
                     WHERE source='bank-feed' ORDER BY account_id, polled_on DESC)
    SELECT DISTINCT s.id, s.ticker, s.name FROM security_positions p JOIN securities s ON s.id=p.security_id
     WHERE p.snapshot_id IN (SELECT id FROM latest)
       AND s.asset_class='equity' AND s.price_basis='per_share' AND s.ticker IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM security_sector_weights w WHERE w.security_id=s.id)
     ORDER BY s.ticker`);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — sectors for ${rows.length} single-name holdings\n`);
  let ok = 0; const miss = []; const funds = [];
  for (const s of rows) {
    if (CLOSED_END[s.ticker] || FUND_SHAPED.test(s.name || '')) { funds.push(s.ticker); continue; }
    const r = await sectorFor(s.ticker);
    if (!r) { miss.push(s.ticker); continue; }
    ok += 1;
    console.log(`  ${s.ticker.padEnd(6)} → ${r.sector}${r.used !== s.ticker ? `   (as ${r.used})` : ''}`);
    if (!APPLY) continue;
    await db.query('UPDATE securities SET sector_weights_as_of = $2, updated_at = now() WHERE id = $1', [s.id, TODAY]);
    await db.query('DELETE FROM security_sector_weights WHERE security_id = $1', [s.id]);
    await db.query(`INSERT INTO security_sector_weights (security_id, sector, weight, source)
                    VALUES ($1,$2,1.0,$3)`, [s.id, r.sector, SOURCE]);
  }
  console.log(`\nresolved ${ok}/${rows.length - funds.length} operating companies`);
  if (funds.length) {
    console.log(`\nrefused as CLOSED-END FUNDS, not companies: ${funds.join(' ')}`);
    for (const f of funds) if (CLOSED_END[f]) console.log(`  ${f.padEnd(5)} ${CLOSED_END[f]}`);
    console.log('  Both vendors report these as stocks in financial_services — the sector their');
    console.log('  MANAGER is registered in, not what they hold. They need fund look-through.');
  }
  if (miss.length) {
    console.log(`no sector: ${miss.join(' ')}`);
    console.log('  — left with NO row and NO as_of date, so they read as "not yet asked" rather than');
    console.log('    as "has no sector", and the X-ray can show them as an explicit uncovered bucket.');
  }
  if (!APPLY) console.log('\nDRY RUN — nothing written. Re-run with --apply.');
  await db.close();
}
main().catch(async (e) => { console.error(e.message); try { await db.close(); } catch { /* closing */ } process.exit(2); });
