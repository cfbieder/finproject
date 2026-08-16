#!/usr/bin/env node
'use strict';
/**
 * fbar-package.js — CR082. Emit the accountant package for one tax year from
 * the LIVE report endpoint.
 *
 *   node Scripts/fbar-package.js 2025 [baseUrl] [outfile.csv]
 *   node Scripts/fbar-package.js 2025 http://127.0.0.1:3005
 *
 * Why this and not fbar-worksheet.js: that one queries the database and applies
 * the engine itself, which is correct but means the sheet and the page are two
 * readings of the same data. They drifted — a package generated 2026-08-15
 * totalled $2,599,736 against the app's $2,599,568, and nobody could say which
 * was right without re-deriving both. This script has no opinion about anything:
 * it GETs /api/v2/tax/fbar/:year and formats what comes back. If the sheet is
 * wrong, the page is wrong the same way, which is the only property that makes
 * a sheet safe to send to a preparer.
 *
 * READ-ONLY over HTTP. Writes one CSV, into the gitignored Samples/Tax/.
 *
 * It never invents a figure: a line the report leaves null is emitted as
 * NEEDS FIGURE with an empty amount column. A blank and a zero are different
 * claims and this file keeps them different.
 */

const fs = require('fs');
const path = require('path');

const csv = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const year = Number(process.argv[2] || new Date().getFullYear() - 1);
  const base = process.argv[3] || 'http://127.0.0.1:3005';
  const out = process.argv[4]
    || path.join(__dirname, '..', 'Samples', 'Tax', `fbar-${year}-ACCOUNTANT-PACKAGE.csv`);
  if (!Number.isInteger(year) || year < 1998) throw new Error(`bad tax year: ${process.argv[2]}`);

  const res = await fetch(`${base}/api/v2/tax/fbar/${year}`);
  if (!res.ok) throw new Error(`GET /tax/fbar/${year} → ${res.status}`);
  const r = (await res.json()).data;

  const computed = r.lines.filter((l) => l.max_usd !== null && l.max_usd !== undefined);
  const needed = r.lines.filter((l) => l.max_usd === null || l.max_usd === undefined);
  const stamp = new Date().toISOString().slice(0, 10);

  const head = [
    `# FinCEN Form 114 (FBAR) — TAX YEAR ${year} working papers`,
    `# Generated ${stamp} from the live report (GET /api/v2/tax/fbar/${year}) — the sheet and the`,
    `#   application render the same numbers from the same call, so they cannot disagree.`,
    '# MAXIMUM = highest END-OF-DAY balance across the whole calendar year, including the',
    "#   1 January carry-in. Computed from the client's own ledger. NOT an estimate.",
    `# ${computed.length} of ${r.lines.length} lines computed · ${needed.length} awaiting a figure.`,
    `# Aggregate so far $${Number(r.aggregate_usd).toLocaleString('en-US')}`
      + `${r.aggregate_is_floor ? ' — a FLOOR, not a total, while any line is outstanding.' : '.'}`,
    `# $10,000 threshold exceeded: ${r.threshold_exceeded === true ? 'YES'
        : r.threshold_exceeded === false ? 'NO' : 'CANNOT SAY on a partial set'}.`,
    '# Rows marked NEEDS FIGURE carry NO amount by design. They are not zero.',
    '#',
    '# FX rates applied, and their provenance:',
    ...r.rates.filter((x) => x.currency.trim() !== 'USD').map((x) =>
      `#   ${x.currency.trim()} ${x.rate_to_usd} USD per unit  [${x.source}]`
      + (x.source === 'treasury' ? '' : '  ⚠ NOT the Treasury rate — replace before filing')),
    '#',
  ].join('\n');

  const cols = ['fbar_part', 'label', 'institution_name', 'institution_country', 'currency',
    'max_native', 'max_on', 'max_usd', 'fx_rate', 'fx_source', 'status'];

  const body = r.lines.map((l) => [
    l.fbar_part, l.label, l.institution_name, l.institution_country, l.currency,
    l.max_native, l.max_on, l.max_usd, l.rate_to_usd, l.rate_source,
    (l.max_usd === null || l.max_usd === undefined)
      ? 'NEEDS FIGURE — not held in the ledger, supply from statement'
      : 'computed',
  ].map(csv).join(','));

  fs.writeFileSync(out, `${head}\n${cols.join(',')}\n${body.join('\n')}\n`);
  process.stdout.write(
    `${out}\n${r.lines.length} lines · ${computed.length} computed · ${needed.length} needing a figure\n`);
}

main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
