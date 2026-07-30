#!/usr/bin/env node
'use strict';
/**
 * parse-fidelity-statement.js — extract per-account valuations from a Fidelity
 * INVESTMENT REPORT PDF.
 *
 * Fidelity's statements are TEXT PDFs, not scans: the content streams are Flate
 * compressed and the text sits in ordinary `(...) Tj` show operators. So this
 * needs no OCR, no `ocr-llm` round trip, and no third-party PDF dependency —
 * zlib (built into Node) plus a regex over the show operators is enough.
 *
 * Two report layouts, both handled:
 *   - COMBINED (FA_*) — an "Accounts Included in This Report" table listing
 *     every account with its beginning and ending value. Parsed from that table.
 *   - SINGLE  (FS_*) — one account, no table; parsed from the header's
 *     "Account Number:" plus the Account Summary's beginning/ending values.
 *
 * WHY THIS MATTERS: an account's *current* balance is owned by the bank feed and
 * is right, but every historical point between reconciles is only as good as
 * whenever an MTM row happened to land. These statements are the custodian's own
 * point-in-time valuation — the same role Quicken's Net Worth Report plays for
 * the pre-2020 era in CR058, for the feed era instead.
 *
 * Fail-loud per .claude/rules/data-import.md: a money field that cannot be
 * parsed is an error, never a silent 0. A statement yielding zero accounts is an
 * error, not an empty success.
 *
 * Usage:
 *   node parse-fidelity-statement.js <file.pdf> [more.pdf ...]     # table
 *   node parse-fidelity-statement.js --json <file.pdf> [...]       # JSON
 */

const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');

/** Decompress every Flate stream and concatenate the text-show operands. */
function extractText(pdfPath) {
  const data = fs.readFileSync(pdfPath);
  const chunks = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(data.toString('latin1'))) !== null) {
    const start = m.index + m[0].length;
    const end = data.toString('latin1').indexOf('endstream', start);
    if (end === -1) continue;
    try {
      chunks.push(zlib.inflateSync(data.subarray(start, end)).toString('latin1'));
    } catch {
      /* not a Flate stream (image, font, xref) — skip */
    }
  }
  if (chunks.length === 0) {
    throw new Error(`${path.basename(pdfPath)}: no decompressable content streams — not a text PDF?`);
  }
  const raw = chunks.join('\n');
  const shown = raw.match(/\((?:\\.|[^\\()])*\)/g) || [];
  // Unescape the PDF string escapes that appear in these files.
  const text = shown
    .map((s) => s.slice(1, -1).replace(/\\([()\\])/g, '$1'))
    .join(' ')
    .replace(/\s+/g, ' ');
  if (text.length < 500) {
    throw new Error(`${path.basename(pdfPath)}: extracted only ${text.length} chars — extraction failed`);
  }
  return text;
}

/** "$1,204,472.05" | "-$20,000.00" | "1,204,472.05" → Number. Never silently 0. */
function money(s, ctx) {
  if (s == null) throw new Error(`missing money value (${ctx})`);
  const cleaned = String(s).replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`non-numeric money value "${s}" (${ctx})`);
  }
  return Number(cleaned);
}

const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

/** "INVESTMENT REPORT June 1, 2026 - June 30, 2026" → {periodStart, periodEnd}. */
function parsePeriod(text, label) {
  const m = text.match(
    /INVESTMENT REPORT\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\s*-\s*([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/
  );
  if (!m) throw new Error(`${label}: could not find the statement period`);
  const iso = (mon, d, y) => {
    const mm = MONTHS[mon];
    if (!mm) throw new Error(`${label}: unknown month "${mon}"`);
    return `${y}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  return { periodStart: iso(m[1], m[2], m[3]), periodEnd: iso(m[4], m[5], m[6]) };
}

const ACCT_RE = /[A-Z0-9]\d{2}-\d{6}/;

/**
 * COMBINED layout. The table reads:
 *   <TYPE/NAME…> <ACCT> <BEGIN> <END> <page>
 * repeated, then "Ending Portfolio Value <BEGIN_TOTAL> <END_TOTAL>".
 */
function parseCombined(text, label) {
  const start = text.indexOf('Accounts Included in This Report');
  if (start === -1) return null;
  // 2025+ says "Ending Portfolio Value"; 2024 says "Ending NET Portfolio Value".
  const term = text.slice(start).match(/Ending (?:Net )?Portfolio Value/);
  if (!term) {
    throw new Error(`${label}: found the account table but no "Ending [Net] Portfolio Value" terminator`);
  }
  const end = start + term.index;
  const table = text.slice(start, end);

  const accounts = [];
  const re = new RegExp(
    `(${ACCT_RE.source})\\s+\\$?([\\d,]+\\.\\d{2})\\s+\\$?([\\d,]+\\.\\d{2})`,
    'g'
  );
  let m;
  while ((m = re.exec(table)) !== null) {
    // The account's descriptive name is whatever precedes its number. Trim off
    // the table's own column headings and the previous row's trailing page
    // number, both of which otherwise ride along on the FIRST account.
    const before = table.slice(0, m.index);
    const name = (before.match(/(?:\d+\s+)?([A-Z][A-Za-z®\s\-,.']{4,})$/) || [, ''])[1]
      // The year-end layout prints a superscript marker between the column
      // headings ("Beginning Value z Ending Value"), so allow anything short
      // between them rather than requiring them adjacent.
      .replace(/.*Beginning Value\s*\S{0,3}\s*Ending Value\s*/i, '')
      .replace(/^(?:GENERAL INVESTMENTS|PERSONAL RETIREMENT)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    accounts.push({
      accountNumber: m[1],
      name,
      beginningValue: money(m[2], `${label} ${m[1]} beginning`),
      endingValue: money(m[3], `${label} ${m[1]} ending`),
    });
  }
  if (accounts.length === 0) {
    throw new Error(`${label}: "Accounts Included in This Report" present but no account rows parsed`);
  }

  const tot = text
    .slice(end)
    .match(/Ending (?:Net )?Portfolio Value\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})/);
  const portfolio = tot
    ? {
        beginningValue: money(tot[1], `${label} portfolio beginning`),
        endingValue: money(tot[2], `${label} portfolio ending`),
      }
    : null;

  // Reconciliation invariant (data-import rule): the parts must equal the whole.
  if (portfolio) {
    const sumEnd = accounts.reduce((s, a) => s + a.endingValue, 0);
    if (Math.abs(sumEnd - portfolio.endingValue) > 0.01) {
      throw new Error(
        `${label}: accounts sum to ${sumEnd.toFixed(2)} but portfolio ending is ` +
          `${portfolio.endingValue.toFixed(2)} — an account row was missed`
      );
    }
  }
  return { layout: 'combined', accounts, portfolio };
}

/** SINGLE layout: header account number + Account Summary begin/end. */
function parseSingle(text, label) {
  const acct = text.match(new RegExp(`Account Number:\\s*(${ACCT_RE.source})`));
  if (!acct) throw new Error(`${label}: neither an account table nor an "Account Number:" header`);

  // Monthly:  "Beginning Account Value $1,174,359.89"
  // Year-end: "Beginning Account Value as of Jan 1, 2025 $894,000.48"
  // The optional "as of <date>" is what made the 2025 year-end report fail on
  // first run — correctly, as a hard error rather than a silent zero.
  const AS_OF = String.raw`(?:\s+as of\s+[A-Za-z]+\s+\d{1,2},\s*\d{4})?`;
  // An account's FIRST statement prints "Beginning Account Value - -": the
  // account did not exist, so there is no opening value. That must read as
  // NULL, never 0 — a zero would assert the account was open and empty, which
  // would make any return or delta computed from it quietly wrong. Z31-443539's
  // June 2024 statement is exactly this case: opened 2024-06-09.
  const begDash = new RegExp(String.raw`Beginning Account Value${AS_OF}\s+-\s`).test(text);
  const beg = text.match(new RegExp(String.raw`Beginning Account Value${AS_OF}\s+\$?([\d,]+\.\d{2})`));
  const end = text.match(
    new RegExp(String.raw`Ending Account Value${AS_OF}\s*\*{0,2}\s*\$?([\d,]+\.\d{2})`)
  );
  if (!end) throw new Error(`${label}: Account Summary ending value not found`);
  if (!beg && !begDash) throw new Error(`${label}: Account Summary beginning value not found`);

  const nameM = text.match(/Account Number:/) ? text.slice(0, text.indexOf('Account Number:')) : '';
  const name = (nameM.match(/([A-Z][A-Z®\s]{6,})\s+CHRISTOPHER/) || [, 'FIDELITY ACCOUNT'])[1].trim();

  return {
    layout: 'single',
    accounts: [
      {
        accountNumber: acct[1],
        name,
        // null ⇒ the account did not exist at the period start (first statement).
        beginningValue: beg ? money(beg[1], `${label} beginning`) : null,
        endingValue: money(end[1], `${label} ending`),
        opensThisPeriod: !beg,
      },
    ],
    portfolio: null,
  };
}

/** Income Summary — this-period figures. Absent on some layouts; null then. */
function parseIncome(text) {
  const i = text.indexOf('Income Summary');
  if (i === -1) return null;
  const seg = text.slice(i, i + 600);
  const grab = (labelRe) => {
    const m = seg.match(new RegExp(`${labelRe}\\s+\\$?([\\d,]+\\.\\d{2})`));
    return m ? money(m[1], labelRe) : null;
  };
  return {
    taxable: grab('Taxable'),
    dividends: grab('Dividends'),
    interest: grab('Interest'),
    longTermCapGains: grab('Long-term Capital Gains'),
    taxExempt: grab('Tax-exempt'),
  };
}

function parseStatement(pdfPath) {
  const label = path.basename(pdfPath);
  const text = extractText(pdfPath);
  const { periodStart, periodEnd } = parsePeriod(text, label);
  const parsed = parseCombined(text, label) || parseSingle(text, label);

  // Whether the figures are ANNUAL or MONTHLY is decided by the PERIOD, never
  // by the document's own label. Both are unreliable in the other direction:
  //   - "2025 YEAR-END INVESTMENT REPORT" really does span Jan 1 → Dec 31.
  //   - "YEAR-END INVESTMENT REPORT" on the 2018 December statement spans
  //     Dec 1 → Dec 31 — the year-end wording is a cover-page summary, not the
  //     reporting period.
  //   - Fidelity issued MONTHLY December statements in 2024 and ANNUAL ones in
  //     2025, both named `*_12.pdf`, so the filename decides nothing either.
  // Deriving from the parsed dates is true by construction: an annual figure is
  // one whose period is a whole year. Getting this backwards would misdate a
  // valuation by eleven months and overstate a period's income twelvefold.
  const isAnnual = /-01-01$/.test(periodStart) && /-12-31$/.test(periodEnd);

  return {
    file: label,
    statementType: isAnnual ? 'annual' : 'monthly',
    // What the document CALLS itself, kept separate from what it covers.
    labelledYearEnd: /YEAR-END INVESTMENT REPORT/i.test(text),
    periodStart,
    periodEnd,
    layout: parsed.layout,
    portfolio: parsed.portfolio,
    accounts: parsed.accounts,
    income: parseIncome(text),
  };
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const files = args.filter((a) => a !== '--json');
  if (files.length === 0) {
    console.error('usage: node parse-fidelity-statement.js [--json] <file.pdf> ...');
    process.exit(1);
  }

  const results = [];
  let failed = 0;
  for (const f of files) {
    try {
      results.push(parseStatement(f));
    } catch (err) {
      console.error(`FAILED ${path.basename(f)}: ${err.message}`);
      failed += 1;
    }
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      const yr = r.statementType === 'annual' ? '  ** ANNUAL period: values and income cover the whole year **' : '';
      console.log(`\n${r.file}  [${r.layout}/${r.statementType}]  ${r.periodStart} → ${r.periodEnd}${yr}`);
      console.log('  account       beginning        ending  name');
      for (const a of r.accounts) {
        console.log(
          `  ${a.accountNumber.padEnd(12)} ` +
            `${(a.beginningValue == null ? '— opened' : a.beginningValue.toFixed(2)).padStart(13)} ` +
            `${a.endingValue.toFixed(2).padStart(13)}  ${a.name}`
        );
      }
      if (r.portfolio) {
        console.log(
          `  ${'PORTFOLIO'.padEnd(12)} ${r.portfolio.beginningValue.toFixed(2).padStart(13)} ` +
            `${r.portfolio.endingValue.toFixed(2).padStart(13)}  (parts verified = whole)`
        );
      }
      if (r.income) {
        const bits = Object.entries(r.income)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k} ${v.toFixed(2)}`);
        if (bits.length) console.log(`  income: ${bits.join(' · ')}`);
      }
    }
  }
  if (failed > 0) process.exitCode = 1;
}

module.exports = { parseStatement, extractText, money, parsePeriod };

if (require.main === module) main();
