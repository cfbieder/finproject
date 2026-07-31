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

/**
 * Value-change blocks — Fidelity's OWN decomposition of the period's move:
 *
 *   Beginning + Additions + Subtractions + Transaction Costs
 *             + Change in Investment Value  =  Ending
 *
 * This matters because it is INDEPENDENTLY COMPUTED by the custodian, unlike a
 * CR058 anchor (`target − ledger`), which is a residual that absorbs every
 * fin-side error. It is the only route to a historical return series that is
 * not circular.
 *
 * It is NOT unrealized gain/loss, and must never be labelled as such. The
 * statement's own footnote on the asterisk:
 *
 *   "Reflects appreciation or depreciation of your holdings due to price
 *    changes, transactions from Other Activity In or Out and Multi-currency
 *    transactions, plus any distribution and income earned during the
 *    statement period."
 *
 * So it bundles price movement with journaled securities ("Other Activity In
 * or Out"), FX, and income. That impurity is exactly why CR058 §9 could not
 * treat the 2022 figure (−1,166,021.87) as market movement. Per-holding
 * `Unrealized Gain/Loss` columns exist elsewhere in these statements and are
 * the honest source for true unrealized — a much larger parsing job.
 *
 * Each block appears once per account plus one for the portfolio. The SINGLE
 * layout prints its block TWICE — once without the Exchanges In/Out sub-lines
 * and once with — carrying identical totals, so blocks are de-duplicated on
 * (beginning, ending).
 */
const VC_NUM = String.raw`(-?\$?[\d,]+\.\d{2}|-)`;

/** A block figure: "-" means the line is nil, NOT missing. */
function vcMoney(s, ctx) {
  return s === '-' ? 0 : money(s, ctx);
}

function parseValueChange(text, label) {
  const re = new RegExp(
    // 2016-2020 statements say "Beginning NET Account Value" / "Net Portfolio";
    // 2021+ drops the "Net". Same variance the ending-portfolio regex already
    // carries. Without this, every pre-2021 account silently found no block.
    String.raw`Beginning (?:Net )?(Portfolio|Account) Value(?:\s+as of\s+[A-Za-z]+\s+\d{1,2},\s*\d{4})?\s+` +
      VC_NUM + String.raw`\s+` + VC_NUM +
      String.raw`([\s\S]{0,700}?)` +
      // The ending line carries a variable footnote marker: "**", a bare letter
      // ("F"), or nothing. Requiring TWO figures after it is what excludes
      // "Ending Account Value Incl. AI $805,144.16", which prints only one.
      String.raw`Ending (?:Net )?\1 Value\s*(?:\*{1,2}|[A-Z])?\s*` + VC_NUM + String.raw`\s+` + VC_NUM,
    'g'
  );

  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, scope, begRaw, , body, endRaw] = m;
    // Every block line carries TWO columns: "This Period" and "Year-to-Date".
    // The YTD column is what makes a real series possible. These are MONTHLY
    // statements that happen to be filed quarterly, so the period column samples
    // four months a year and summing it is NOT the year's return. Differencing
    // YTD across consecutive statements (Q2 = YTD_Jun − YTD_Mar) recovers the
    // full period between them, including the months with no statement.
    const grabBoth = (labelRe, optional) => {
      const g = body.match(new RegExp(String.raw`\b${labelRe}\s*\*?\s+` + VC_NUM + String.raw`\s+` + VC_NUM));
      if (!g) {
        if (optional) return { period: 0, ytd: 0 };
        throw new Error(`${label}: value-change block missing "${labelRe}"`);
      }
      return {
        period: vcMoney(g[1], `${label} ${labelRe} period`),
        ytd: vcMoney(g[2], `${label} ${labelRe} ytd`),
      };
    };
    const grab = (labelRe, optional) => {
      const g = body.match(new RegExp(String.raw`\b${labelRe}\s*\*?\s+` + VC_NUM + String.raw`\s+` + VC_NUM));
      // A section Fidelity omits entirely (no activity of that kind) reads as
      // zero. That is safe ONLY because the reconciliation below re-derives the
      // ending value — a line that was present but unmatched fails there rather
      // than silently defaulting.
      if (!g) {
        if (optional) return 0;
        throw new Error(`${label}: value-change block missing "${labelRe}"`);
      }
      return vcMoney(g[1], `${label} ${labelRe}`);
    };

    // "Beginning Account Value - -" is an account's FIRST statement: it did not
    // exist, so there is no opening value. null, never 0 (same rule as §parseSingle).
    const beginning = begRaw === '-' ? null : vcMoney(begRaw, `${label} block beginning`);
    const ending = vcMoney(endRaw, `${label} block ending`);
    const key = `${scope}|${beginning}|${ending}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const additions = grab('Additions', true);
    const subtractions = grab('Subtractions', true);
    // MEMO ONLY — never an addend. "Transaction Costs, Fees & Charges" is a
    // SUB-LINE of Subtractions, alongside Withdrawals / Exchanges Out / Cards,
    // and adding it again double-counts. Caught on first run by the invariant
    // below (FS_2026_06: Subtractions −0.07, of which costs −0.07, so the
    // derived ending came out 7 cents short).
    const costs = grab('Transaction Costs, Fees & Charges', true);
    // A TOP-LEVEL line, sibling to Additions/Subtractions — not a sub-line of
    // either. Proven arithmetically on FA_2024_06, where Subtractions
    // (−163,080.06) equals its own sub-lines exactly (Withdrawals −10,000.00,
    // Exchanges Out −153,011.74, Margin Interest −68.32), leaving the transfer
    // outside it. Appears only in the six 2024 statements, when Z31-443539 was
    // split out of X27-230910 — and on an account's FIRST statement it replaces
    // Additions entirely, which is how FS_2024_06 failed the invariant.
    const transfers = grab('Transfers Between Fidelity Accounts', true);
    const changeInValue = grab('Change in Investment Value');

    // Reconciliation invariant (data-import rule): the parts must equal the
    // whole. Subtractions are printed already-negative.
    const derived = (beginning || 0) + additions + subtractions + transfers + changeInValue;
    if (Math.abs(derived - ending) > 0.01) {
      throw new Error(
        `${label}: value-change block does not reconcile — ` +
          `${(beginning || 0).toFixed(2)} + ${additions.toFixed(2)} + ${subtractions.toFixed(2)} + ` +
          `${transfers.toFixed(2)} + ${changeInValue.toFixed(2)} = ${derived.toFixed(2)}, ` +
          `but ending is ${ending.toFixed(2)}`
      );
    }

    out.push({
      scope: scope.toLowerCase(), beginning, additions, subtractions, transfers, costs, changeInValue, ending,
      // Year-to-Date column, for differencing across consecutive statements.
      ytd: {
        additions: grabBoth('Additions', true).ytd,
        subtractions: grabBoth('Subtractions', true).ytd,
        transfers: grabBoth('Transfers Between Fidelity Accounts', true).ytd,
        changeInValue: grabBoth('Change in Investment Value').ytd,
      },
    });
  }
  return out;
}

/**
 * Attach each block to the account it belongs to, matched on (beginning,
 * ending) rather than document order — order is a layout accident, the values
 * are the identity, and a mismatch surfaces as an unattached block instead of
 * silently pairing the wrong account with the wrong return.
 */
function attachValueChange(parsed, blocks) {
  const eq = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) <= 0.01);
  for (const acct of parsed.accounts) {
    acct.valueChange =
      blocks.find(
        (b) => b.scope === 'account' && eq(b.beginning, acct.beginningValue) && eq(b.ending, acct.endingValue)
      ) || null;
  }
  if (parsed.portfolio) {
    parsed.portfolio.valueChange =
      blocks.find(
        (b) =>
          b.scope === 'portfolio' &&
          eq(b.beginning, parsed.portfolio.beginningValue) &&
          eq(b.ending, parsed.portfolio.endingValue)
      ) || null;
  }
  return parsed;
}

/**
 * Holdings totals — the `Total Holdings` line closing each account's position
 * table:
 *
 *   Total Holdings  <ending market value>  <total cost basis>  <unrealized G/L>  <EAI>
 *
 * This is the honest source for unrealized gain/loss, and the reason matters.
 * §12.8 established that `Change in Investment Value` cannot measure return: it
 * absorbs "Other Activity In or Out", so a 2.5M transfer out of X27-230910 in
 * 2023 reappeared inside it as +2.68M of phantom "return". Market value minus
 * cost basis has no such defect — a transfer moves BOTH together, so the
 * embedded gain travels with the position instead of being manufactured.
 *
 * NOT asserted: cost + unrealized = market value. Money-market and core-cash
 * positions carry market value with no cost basis (FS_2026_06 is short by
 * 9,483.47, exactly its SPAXX position), so that identity is false by design.
 *
 * Attached to accounts by matching ending market value. Across all 117
 * account-statements the residual is 0.00 (82×), 35.05 (34×, a single holding
 * on X27-230910 carried in the account value but absent from its position
 * table for a decade) and 10.18 (1×) — so the tolerance below is wide enough to
 * absorb that and far too tight to pair the wrong account.
 */
const HOLDINGS_RESIDUAL_TOLERANCE = 50;

function parseHoldingsTotals(text, label) {
  // The column set VARIES with what the account holds, and the second figure
  // means different things in each shape — so the count decides, never the
  // position alone:
  //   4 figures  market value, cost basis, unrealized G/L, EAI   (holds securities)
  //   2 figures  market value, EAI                               (cash only)
  // Fidelity Cash Mgt reads `Total Holdings $1,278,965.19 $0.00` for every
  // period 2020-09 → 2023-09, when it held nothing but the FDIC sweep. Reading
  // that $0.00 as a cost basis would invent a 1.28M unrealized gain.
  const re = new RegExp(
    String.raw`Total Holdings\s+` + VC_NUM + String.raw`\s+` + VC_NUM +
      String.raw`(?:\s+` + VC_NUM + String.raw`)?(?:\s+` + VC_NUM + String.raw`)?`,
    'g'
  );
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const figures = [m[1], m[2], m[3], m[4]].filter((x) => x !== undefined);
    const marketValue = vcMoney(figures[0], `${label} holdings market value`);
    if (figures.length >= 3) {
      out.push({
        marketValue,
        costBasis: vcMoney(figures[1], `${label} holdings cost basis`),
        unrealized: vcMoney(figures[2], `${label} holdings unrealized`),
        cashOnly: false,
      });
    } else {
      // Cash only: there is no cost basis, so unrealized is genuinely ZERO —
      // materially different from "we could not parse it", which is why this is
      // flagged rather than left null for the caller to guess at.
      out.push({ marketValue, costBasis: 0, unrealized: 0, cashOnly: true });
    }
  }
  return out;
}

function attachHoldings(parsed, totals, label) {
  for (const acct of parsed.accounts) {
    const best = totals
      .map((t) => ({ t, d: Math.abs(t.marketValue - acct.endingValue) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!best || best.d > HOLDINGS_RESIDUAL_TOLERANCE) {
      acct.holdings = null;
      continue;
    }
    acct.holdings = { ...best.t, residual: round2cents(acct.endingValue - best.t.marketValue) };
  }
  return parsed;
}

const round2cents = (n) => Math.round(n * 100) / 100;

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
  const parsed = attachHoldings(
    attachValueChange(
      parseCombined(text, label) || parseSingle(text, label),
      parseValueChange(text, label)
    ),
    parseHoldingsTotals(text, label),
    label
  );

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
      console.log('  account       beginning        ending      adds      subs   chg-in-value  name');
      for (const a of r.accounts) {
        const v = a.valueChange;
        console.log(
          `  ${a.accountNumber.padEnd(12)} ` +
            `${(a.beginningValue == null ? '— opened' : a.beginningValue.toFixed(2)).padStart(13)} ` +
            `${a.endingValue.toFixed(2).padStart(13)}  ` +
            `${(v ? v.additions.toFixed(2) : '—').padStart(9)} ` +
            `${(v ? v.subtractions.toFixed(2) : '—').padStart(9)} ` +
            `${(v ? v.changeInValue.toFixed(2) : 'NO BLOCK').padStart(13)}  ${a.name}`
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
