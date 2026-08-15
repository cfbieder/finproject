#!/usr/bin/env node
'use strict';
/**
 * fbar-worksheet.js — CR082. Produce the FBAR working papers for one tax year.
 *
 *   DATABASE_URL=<prod> node Scripts/fbar-worksheet.js 2025 [outfile.csv]
 *
 * READ-ONLY. It runs SELECTs and writes one CSV; it never touches the database.
 *
 * This is the pre-UI form of CR082 P2: the engine (`fbarMaxValue.js`) already
 * computes the figure, and this puts it on a sheet an accountant can read. When
 * `/tax/fbar` ships it renders the same numbers from the same function — this
 * script is not a second implementation, and must never become one.
 *
 * WHAT IT WILL NOT DO
 *   - It never invents a maximum. An account the engine refuses, or that fin
 *     does not hold at all, is emitted as NEEDS FIGURE with an empty amount.
 *   - It never presents its FX as authoritative. `exchange_rates` is the ECB
 *     (frankfurter) series; FinCEN requires the TREASURY Dec-31 rate, published
 *     each January at fiscal.treasury.gov, and quoted in the OPPOSITE direction
 *     (foreign per USD, where this stores USD per foreign). Every row prints the
 *     rate and its source, and the header says so.
 *   - It decides nothing about reportability. The `designation` column carries
 *     last year's answer or a reason to look; the owner and preparer decide.
 */

const fs = require('fs');
const path = require('path');
const db = require('../server/src/v2/db');
const { accountYearFigures, toUsdRoundedUp } = require('../server/src/v2/services/fbarMaxValue');

/**
 * The candidate list is EXPLICIT, and that is deliberate: "foreign" is where the
 * institution sits, not what currency the account is denominated in, so no query
 * can derive it. `Wise - USD` is a USD account at a foreign institution and is a
 * candidate; `Cash EUR` is EUR and is not an account at all. Each entry carries
 * the reason it is on the list so the next reader can disagree with it.
 */
const CANDIDATES = [
  // name                 institution (2024 filing name)   why
  ['PKO',                 'PKO',                'filed 2024'],
  ['PKO Savings',         'PKO',                'filed 2024'],
  ['PKO - Deposits',      'PKO',                'filed 2024'],
  ['PKO EUR',             'PKO',                'filed 2024'],
  ['PKO - USD',           'PKO',                'USD account at a foreign institution'],
  ['PKO TFI',             'PKO TFI',            'Polish mutual fund — NOT filed 2024, see notes'],
  ['Santandar',           'Erste (ex-Santander Bank Polska, ex-BZ WBK)', 'filed 2024 as BANK ZACHODNI WBK'],
  ['Caixa EUR',           'CaixaBank',          'filed 2024'],
  ['WISE - EUR',          'Wise',               'filed 2024'],
  ['WISE - GBP',          'Wise',               'filed 2024'],
  ['WISE - PLN',          'Wise',               'filed 2024'],
  ['Wise - USD',          'Wise',               'filed 2024 — USD at a foreign institution'],
  ['WISE - USD - Old',    'Wise',               'filed 2024 — confirm whether closed'],
  ['Revolut-EUR',         'Revolut',            'NOT filed 2024 — reportable?'],
  ['Revolut-PLN',         'Revolut',            'NOT filed 2024 — reportable?'],
  ['Revolut-USD',         'Revolut',            'NOT filed 2024 — confirm Revolut entity (US vs LT/UK)'],
  // Credit cards: normally NOT reportable financial accounts. Listed so the
  // decision is visible and reversible rather than silently absent.
  ['PKO Visa Gold CB',    'PKO',                'credit card — normally not reportable'],
  ['PKO Visa Gold KB',    'PKO',                'credit card — normally not reportable'],
  ['PKO VISA Infinity CB','PKO',                'credit card — normally not reportable'],
  ['PKO VISA Infinity KB','PKO',                'credit card — normally not reportable'],
];

/** Accounts filed in 2024 that fin does NOT hold — they need typed figures. */
const NOT_IN_FIN = [
  ['BNP Paribas x4', 'BNP Paribas', 'CLOSED before 2025 (owner 2026-08-15) — DROPS OFF TY2025'],
  ['Part IV: signature authority x12', 'various (CFO)', 'employer/company accounts — typed figures, see 2024 worksheet'],
];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const year = Number(process.argv[2] || new Date().getFullYear() - 1);
  const out = process.argv[3] || path.join(__dirname, '..', 'Samples', 'Tax', `fbar-${year}-worksheet.csv`);
  if (!Number.isInteger(year) || year < 1998) throw new Error(`bad tax year: ${process.argv[2]}`);

  // Rates: whatever the FX series holds for Dec 31 of the year. Explicitly a
  // PREFILL — see the header note this writes into the sheet.
  const { rows: rateRows } = await db.query(
    `SELECT from_currency, rate FROM exchange_rates
      WHERE to_currency = 'USD' AND rate_date = make_date($1::int, 12, 31)`,
    [year]
  );
  const rates = new Map(rateRows.map((r) => [r.from_currency.trim(), Number(r.rate)]));
  rates.set('USD', 1);

  const { rows: accts } = await db.query(
    `SELECT id, name, currency FROM accounts WHERE name = ANY($1::text[])`,
    [CANDIDATES.map((c) => c[0])]
  );
  const byName = new Map(accts.map((a) => [a.name, a]));

  const lines = [];
  let aggregate = 0;
  let anyMissing = false;

  for (const [name, institution, why] of CANDIDATES) {
    const a = byName.get(name);
    if (!a) {
      anyMissing = true;
      lines.push({ account: name, institution, currency: '', max_native: '', year_end_native: '',
                   rate: '', rate_source: '', max_usd: '', status: 'NOT IN FIN', note: why });
      continue;
    }
    const f = await accountYearFigures(db, a.id, year);
    if (f.refused) {
      anyMissing = true;
      lines.push({ account: name, institution, currency: f.currency || a.currency,
                   max_native: '', year_end_native: '', rate: '', rate_source: '', max_usd: '',
                   status: 'NEEDS FIGURE', note: `${f.refusal_reason}: ${f.refusal_detail || ''} | ${why}` });
      continue;
    }
    const ccy = (f.currency || '').trim();
    const rate = rates.get(ccy);
    const usd = rate ? toUsdRoundedUp(f.reportable_max_native, rate) : null;
    if (usd === null) anyMissing = true;
    else aggregate += usd;

    lines.push({
      account: name, institution, currency: ccy,
      max_native: f.reportable_max_native,
      max_on: f.max_on,
      year_end_native: f.year_end_native,
      rate: rate ?? '', rate_source: rate ? 'frankfurter-prefill (NOT Treasury)' : 'MISSING RATE',
      max_usd: usd ?? '',
      status: rate ? 'computed' : 'NEEDS RATE',
      note: `${why}${f.max_native < 0 ? ' | true max ' + f.max_native + ', reported 0' : ''}`,
    });
  }

  for (const [name, institution, why] of NOT_IN_FIN) {
    lines.push({ account: name, institution, currency: '', max_native: '', year_end_native: '',
                 rate: '', rate_source: '', max_usd: '', status: 'NEEDS FIGURE', note: why });
  }

  const cols = ['account', 'institution', 'currency', 'max_native', 'max_on', 'year_end_native',
                'rate', 'rate_source', 'max_usd', 'status', 'note'];
  const hdr = [
    `# FinCEN Form 114 (FBAR) working papers — tax year ${year}`,
    `# Generated ${new Date().toISOString().slice(0, 10)} by Scripts/fbar-worksheet.js from fin's ledger.`,
    `# MAXIMUM = highest END-OF-DAY balance across the whole year, including the Jan-1 carry-in.`,
    `# FX IS A PREFILL, NOT THE FILING RATE: these are ECB/frankfurter Dec-31 rates, quoted as`,
    `#   USD per 1 unit of foreign currency. FinCEN requires the TREASURY Dec-31 rate, which is`,
    `#   published in the OPPOSITE direction (foreign per USD). Replace before filing.`,
    `# Rows marked NEEDS FIGURE / NOT IN FIN carry NO amount by design — they are not zero.`,
    '#',
  ].join('\n');

  const body = [cols.join(','), ...lines.map((l) => cols.map((c) => csvCell(l[c])).join(','))].join('\n');
  fs.writeFileSync(out, `${hdr}\n${body}\n`);

  const computed = lines.filter((l) => l.status === 'computed');
  console.log(`tax year        : ${year}`);
  console.log(`rates found     : ${[...rates.keys()].filter((k) => k !== 'USD').join(', ') || '(none)'}`);
  console.log(`rows            : ${lines.length}  (computed ${computed.length}, needs attention ${lines.length - computed.length})`);
  console.log(`aggregate (USD) : ${aggregate.toLocaleString('en-US')}${anyMissing ? '  <-- PARTIAL: rows still need figures' : ''}`);
  console.log(`$10,000 test    : ${aggregate > 10000 ? 'EXCEEDED — every foreign account is reportable' : 'not exceeded on computed rows alone'}`);
  if (anyMissing) {
    console.log(`\n!! The aggregate above is a FLOOR, not the answer. Rows needing figures:`);
    for (const l of lines.filter((x) => x.status !== 'computed')) console.log(`   - ${l.account.padEnd(30)} ${l.status}`);
  }
  console.log(`\nwrote ${out}`);
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
