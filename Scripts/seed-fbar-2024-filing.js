#!/usr/bin/env node
'use strict';
/**
 * seed-fbar-2024-filing.js — CR082 §9. Record the TY2024 return that was
 * actually filed, as a `filed` filing with its lines.
 *
 *   DATABASE_URL=<target> node Scripts/seed-fbar-2024-filing.js [--force]
 *
 * §9 called this "the cheapest correctness gate available" and it silently did
 * not happen: `seed-fbar-designations.js` advertises a `--filed-2024` flag in
 * its own header that was never implemented, and `tax_fbar_filings` held exactly
 * one row — (2025, 0, draft). So P2's first run was a leap of faith rather than
 * a verification against a known-good output, on a form where being wrong
 * carries penalties.
 *
 * ── Why this writes filing lines DIRECTLY and does not create designations ──
 *
 * The obvious route — enter the 31 rows as designations, type each figure, then
 * freeze with `force` — is wrong, and the notes in `Samples/Tax/` say why: the
 * 2024 filed list does not line up with fin's chart of accounts. Four BNP
 * accounts were closed before 2025, `WISE …9270` appears twice, and twelve Part
 * IV company accounts have no fin ledger at all. Designations are a STANDING
 * list; adding 31 historical rows to it would put them on every future year's
 * review screen, and each would then need a year-state override (migration 071)
 * for every year thereafter to get back off.
 *
 * `tax_fbar_filing_lines.tax_foreign_account_id` is nullable and documented in
 * migration 070 as a soft reference — "the line must stand alone, because it is
 * a record of what was FILED". A paper return transcribed years later is exactly
 * that case.
 *
 * ── What this file does NOT claim ──
 *
 * The client copy MASKS every account number (last 4 for Part III, fully for
 * Part IV), so the numbers stored here are the masked strings as they appear.
 * They are a record of the document, not a source of account numbers, and
 * nothing should ever read them as one. Part IV carries no maximum in the copy —
 * the value is left NULL with a reason, rather than being recorded as 0 (which
 * would claim the account held nothing) or as 15a (which would claim the FILER
 * answered "unknown", something this document does not say).
 *
 * Idempotent: refuses if a TY2024 filing already exists unless --force, which
 * replaces it.
 */

const fs = require('fs');
const path = require('path');
const db = require('../server/src/v2/db');

const TAX_YEAR = 2024;
const SOURCE = 'fbar-2024-worksheet.csv';
const CSV = path.join(__dirname, '..', 'Samples', 'Tax', SOURCE);

/** The copy prints country names; the column is CHAR(2). */
const COUNTRY = {
  POLAND: 'PL', GERMANY: 'DE', BELGIUM: 'BE', SPAIN: 'ES', LITHUANIA: 'LT',
};

function readCsv(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} not found.\n` +
      `Samples/Tax/ is gitignored — it carries account numbers, institution\n` +
      `addresses and the filer identity, and is never committed. This script\n` +
      `reads that directory and writes to Postgres; it cannot reconstruct it.`
    );
  }
  const [header, ...lines] = fs.readFileSync(file, 'utf8').trim().split('\n');
  const cols = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c.trim(), (cells[i] || '').trim()]));
  });
}

/**
 * A label a human can recognise a year later. The institution alone is not one —
 * PKO appears five times and Bank Zachodni WBK five more — so the visible tail
 * of the masked number is what separates them, and the page number is what makes
 * a row traceable back to the document when it does not.
 */
function labelFor(row, seq) {
  const tail = (row.account_number || '').replace(/[*\s]/g, '').slice(-4);
  const inst = row.institution || '(institution absent from the copy)';
  return tail ? `${inst} …${tail}` : `${inst} (p.${row.page}, #${seq})`;
}

async function main() {
  const force = process.argv.includes('--force');
  const rows = readCsv(CSV);

  const { rows: existing } = await db.query(
    `SELECT id, status, amendment_seq FROM tax_fbar_filings WHERE tax_year = $1`,
    [TAX_YEAR]
  );
  if (existing.length && !force) {
    console.log(
      `TY${TAX_YEAR} already has ${existing.length} filing row(s) ` +
      `(${existing.map((e) => `seq ${e.amendment_seq}/${e.status}`).join(', ')}). ` +
      `Nothing done — pass --force to replace.`
    );
    await db.close();
    return;
  }

  await db.query('BEGIN');
  try {
    if (existing.length) {
      await db.query(
        `DELETE FROM tax_fbar_filing_lines WHERE filing_id = ANY($1::int[])`,
        [existing.map((e) => e.id)]
      );
      await db.query(`DELETE FROM tax_fbar_filings WHERE tax_year = $1`, [TAX_YEAR]);
    }

    const { rows: ins } = await db.query(
      `INSERT INTO tax_fbar_filings (tax_year, amendment_seq, status, filed_on, filed_note)
       VALUES ($1, 0, 'filed', DATE '2025-10-07', $2) RETURNING id`,
      [TAX_YEAR,
        'Transcribed from the filed client copy (Dyke Yaxley LLC), not computed by fin. '
        + 'Account numbers are MASKED in that document and are stored here as they appear. '
        + 'Part IV carries no maximum in the copy; those lines are NULL, which is not zero.']
    );
    const filingId = ins[0].id;

    let seq = 0;
    let partIII = 0;
    let partIV = 0;
    let totalUsd = 0;
    for (const r of rows) {
      seq += 1;
      const usd = r.max_value_usd === '' ? null : Number(r.max_value_usd);
      if (usd !== null) totalUsd += usd;
      if (r.part === 'III') partIII += 1; else partIV += 1;

      await db.query(
        `INSERT INTO tax_fbar_filing_lines
           (filing_id, tax_foreign_account_id, label, account_number, institution_name,
            institution_country, fbar_part, account_kind, max_value_usd, manual_reason)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, 'bank', $7, $8)`,
        [filingId, labelFor(r, seq), r.account_number || null,
          r.institution || null, COUNTRY[r.country] || null, r.part, usd,
          `${SOURCE} p.${r.page} — ${r.capacity}`
          + (usd === null ? '. No maximum printed in the client copy.' : '')]
      );
    }

    // Refuse to finish quietly on a count that does not match the input — the
    // failure mode the designation seeder was bitten by, where a collapsed key
    // silently merged rows and dropped reportable accounts from an FBAR.
    const { rows: check } = await db.query(
      `SELECT count(*)::int AS n FROM tax_fbar_filing_lines WHERE filing_id = $1`,
      [filingId]
    );
    if (check[0].n !== rows.length) {
      throw new Error(
        `line count mismatch: read ${rows.length} rows from ${SOURCE} but the filing holds ${check[0].n}`
      );
    }

    await db.query('COMMIT');
    console.log(`TY${TAX_YEAR} recorded as FILED — ${check[0].n} lines.`);
    console.log(`  Part III : ${partIII}   Part IV : ${partIV}`);
    console.log(`  Total maximum as filed: $${totalUsd.toLocaleString('en-US')}`);
    console.log('  Account numbers are the MASKED strings from the client copy.');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }

  await db.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
