#!/usr/bin/env node
'use strict';
/**
 * seed-fbar-designations.js — CR082. Populate the Taxes section from last year's
 * papers, so the designation screen is a REVIEW surface rather than a
 * transcription one.
 *
 *   DATABASE_URL=<target> node Scripts/seed-fbar-designations.js [--filed-2024]
 *
 * Reads two gitignored files under Samples/Tax/ (see that directory's NOTES):
 *   fbar-2024-accountant-request.csv  full IBANs, institution blocks, native
 *                                     maxima and Dec-31 values (Part III)
 *   fbar-2024-worksheet.csv           the FILED form, incl. Part IV
 *
 * ── Two rules it will not break ──
 *
 * 1. NOTHING IS MARKED REVIEWED. Every row lands `review_state='unreviewed'`.
 *    The seed data is known to need checking: the sheet's PKO numbers disagree
 *    with the filed form's last-4 on three of four lines, one row is an
 *    aggregate ("PKO / various"), two Part IV names are absent from the client
 *    copy, and WISE …9270 appears twice. Tri-state exists precisely so
 *    "seeded" cannot be mistaken for "confirmed".
 *
 * 2. IT LINKS ONLY WHERE THE ANSWER IS FORCED. A designation is linked to a fin
 *    account only when institution + currency yield EXACTLY ONE candidate.
 *    The sheet has three PKO PLN rows; fin has three PLN candidates (`PKO`,
 *    `PKO Savings`, `PKO - Deposits`) whose 2025 maxima are 631,678 / 4,565,437
 *    / 1,000,000 PLN. A wrong link there misstates a line by a million dollars
 *    while leaving the aggregate untouched, so no total would reveal it. Those
 *    stay unlinked for the owner to resolve against the figures.
 *
 * Idempotent: keyed on (institution_name, account_number), re-running updates
 * rather than duplicating.
 */

const fs = require('fs');
const path = require('path');
const db = require('../server/src/v2/db');

const TAXDIR = path.join(__dirname, '..', 'Samples', 'Tax');

/** Institution name on the papers -> the fin account-name prefix it maps to. */
const INSTITUTION_TO_FIN = [
  [/^PKO$/i,                      'PKO'],
  [/bank zachodni|santander|erste/i, 'Santandar'],
  [/transferwise|^wise$/i,        'WISE'],
  [/caixa/i,                      'Caixa'],
  [/bnp/i,                        null],   // closed before 2025 — never links
];

function readCsv(file) {
  const text = fs.readFileSync(path.join(TAXDIR, file), 'utf8');
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const hdr = splitCsv(lines[0]);
  return lines.slice(1).map((l) => {
    const c = splitCsv(l);
    return Object.fromEntries(hdr.map((h, i) => [h, (c[i] ?? '').trim()]));
  });
}

function splitCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const COUNTRY = { poland: 'PL', germany: 'DE', belgium: 'BE', spain: 'ES', lithuania: 'LT' };

async function finCandidates(institution, currency) {
  const rule = INSTITUTION_TO_FIN.find(([re]) => re.test(institution || ''));
  if (!rule || rule[1] === null) return [];
  const { rows } = await db.query(
    `SELECT a.id, a.name FROM accounts a
      WHERE a.is_active AND a.currency = $1
        AND a.account_type IN ('asset','liability')
        AND a.name ILIKE $2
        AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id)
      ORDER BY a.name`,
    [currency, `${rule[1]}%`]
  );
  return rows;
}

async function upsert(d) {
  const { rows: existing } = await db.query(
    `SELECT id FROM tax_foreign_accounts
      WHERE institution_name IS NOT DISTINCT FROM $1
        AND own_account_number IS NOT DISTINCT FROM $2`,
    [d.institution_name, d.own_account_number]
  );
  if (existing.length) {
    await db.query(
      `UPDATE tax_foreign_accounts SET label=$2, fbar_part=$3, account_kind=$4,
              own_currency=$5, institution_street=$6, institution_city=$7,
              institution_postal=$8, institution_country=$9, account_id=$10,
              notes=$11, updated_at=NOW()
        WHERE id=$1`,
      [existing[0].id, d.label, d.fbar_part, d.account_kind, d.own_currency,
       d.institution_street, d.institution_city, d.institution_postal,
       d.institution_country, d.account_id, d.notes]
    );
    return { id: existing[0].id, created: false };
  }
  const { rows } = await db.query(
    `INSERT INTO tax_foreign_accounts
       (label, review_state, fbar_part, account_kind, own_account_number, own_currency,
        institution_name, institution_street, institution_city, institution_postal,
        institution_country, account_id, notes)
     VALUES ($1,'unreviewed',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [d.label, d.fbar_part, d.account_kind, d.own_account_number, d.own_currency,
     d.institution_name, d.institution_street, d.institution_city, d.institution_postal,
     d.institution_country, d.account_id, d.notes]
  );
  return { id: rows[0].id, created: true };
}

async function main() {
  const partIII = readCsv('fbar-2024-accountant-request.csv');
  const filed = readCsv('fbar-2024-worksheet.csv');

  // How many SHEET rows compete for the same fin account pool? Caught on the
  // first run by the UNIQUE(account_id) migration 070 added: fin holds ONE
  // `Santandar`, the filing holds FIVE Bank Zachodni WBK accounts, and two PLN
  // rows both resolved to account 22. "Exactly one fin candidate" is therefore
  // NOT the same as unambiguous -- when N rows chase 1 account, picking any of
  // them is a guess with a 1-in-N chance of being right. Both counts must be 1.
  const groupKey = (r) => {
    const rule = INSTITUTION_TO_FIN.find(([re]) => re.test(r.institution || ''));
    return `${rule ? String(rule[1]) : '?'}|${(r.currency || '').toUpperCase()}`;
  };
  const groupSize = new Map();
  for (const r of partIII) {
    if (!r.institution || !r.account_number) continue;
    groupSize.set(groupKey(r), (groupSize.get(groupKey(r)) || 0) + 1);
  }

  let linked = 0, ambiguous = 0, unlinkable = 0, created = 0, updated = 0;
  const report = [];

  for (const r of partIII) {
    if (!r.institution || !r.account_number) continue;
    const currency = (r.currency || '').toUpperCase();
    const cands = currency ? await finCandidates(r.institution, currency) : [];

    const competing = groupSize.get(groupKey(r)) || 1;
    let accountId = null, note = null;
    if (cands.length === 1 && competing === 1) {
      accountId = cands[0].id; linked++;
      note = `auto-linked: the only ${currency} candidate at ${r.institution}, and the only row claiming it`;
    } else if (cands.length === 0) {
      unlinkable++; note = `no fin account at ${r.institution} in ${currency}`;
    } else {
      ambiguous++;
      note = `NEEDS LINK — ${competing} sheet row(s) vs ${cands.length} fin ${currency} account(s)` +
             ` [${cands.map((c) => c.name).join(', ')}]`;
    }

    // `own_currency` is only legal on a report-only line (the CHECK pairs it
    // with a NULL account_id). A linked row takes its currency from the ledger.
    const d = {
      label: `${r.institution} ${String(r.account_number).replace(/\s+/g, '').slice(-4)} (${currency})`,
      fbar_part: 'III',
      account_kind: /securities/i.test(r.acct_type) ? 'securities' : 'bank',
      own_account_number: r.account_number,
      own_currency: accountId ? null : (currency || null),
      institution_name: r.institution,
      institution_street: r.street || null,
      institution_city: r.city || null,
      institution_postal: r.postal || null,
      institution_country: COUNTRY[(r.country || '').toLowerCase()] || null,
      account_id: accountId,
      notes: [note, r.max_2024_native ? `2024 filed max ${r.max_2024_native} ${currency}` : null]
        .filter(Boolean).join(' | '),
    };
    const out = await upsert(d);
    out.created ? created++ : updated++;
    report.push({ label: d.label, linked: !!accountId, note });
  }

  // Part IV — signature authority, no fin ledger, always report-only.
  let partIVCount = 0;
  for (const r of filed.filter((x) => x.part === 'IV')) {
    const d = {
      label: r.institution || `(name missing — page ${r.page})`,
      fbar_part: 'IV',
      account_kind: 'bank',
      own_account_number: r.account_number || 'UNKNOWN',
      own_currency: 'PLN',
      institution_name: r.institution || null,
      institution_street: r.street || null,
      institution_city: r.city || null,
      institution_postal: r.postal || null,
      institution_country: COUNTRY[(r.country || '').toLowerCase()] || null,
      account_id: null,
      notes: 'Part IV signature authority (CFO). Number masked in the client copy — needs the real one and a typed maximum.',
    };
    const out = await upsert(d);
    out.created ? created++ : updated++;
    partIVCount++;
  }

  // FX. 2024 is the rate the preparer DEMONSTRABLY used, recovered from two
  // filed lines (10,000 PLN -> $2,513 and 35,000 -> $8,794). 2025 is the ECB
  // prefill and is labelled as such — it is not the filing rate.
  await db.query(
    `INSERT INTO tax_fx_rates (tax_year, currency, rate_to_usd, source, note)
     VALUES (2024,'PLN',0.251257,'treasury','Recovered from the TY2024 filing: 35,000 PLN filed as $8,794')
     ON CONFLICT (tax_year, currency) DO UPDATE SET rate_to_usd=EXCLUDED.rate_to_usd,
       source=EXCLUDED.source, note=EXCLUDED.note`
  );
  const { rows: ecb } = await db.query(
    `SELECT from_currency, rate FROM exchange_rates
      WHERE to_currency='USD' AND rate_date = DATE '2025-12-31'`
  );
  for (const r of ecb) {
    await db.query(
      `INSERT INTO tax_fx_rates (tax_year, currency, rate_to_usd, source, note)
       VALUES (2025,$1,$2,'frankfurter-prefill','ECB Dec-31. NOT the Treasury rate — replace before filing.')
       ON CONFLICT (tax_year, currency) DO NOTHING`,
      [r.from_currency.trim(), r.rate]
    );
  }
  await db.query(
    `INSERT INTO tax_fx_rates (tax_year, currency, rate_to_usd, source, note)
     VALUES (2025,'USD',1,'manual','USD needs no conversion')
     ON CONFLICT (tax_year, currency) DO NOTHING`
  );

  console.log(`designations: ${created} created, ${updated} updated`);
  console.log(`  Part III   : ${partIII.length}  (linked ${linked}, ambiguous ${ambiguous}, no fin account ${unlinkable})`);
  console.log(`  Part IV    : ${partIVCount}  (all report-only, all needing a typed figure)`);
  console.log(`  every row  : review_state='unreviewed'\n`);
  for (const r of report) console.log(`  ${r.linked ? '✓' : '·'} ${r.label.padEnd(34)} ${r.note}`);
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
