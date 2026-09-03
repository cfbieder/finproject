#!/usr/bin/env node
'use strict';
/**
 * parse-fidelity-holdings.js — CR061 P2. Per-HOLDING positions out of a Fidelity
 * INVESTMENT REPORT PDF.
 *
 * The sibling `parse-fidelity-statement.js` reads per-ACCOUNT beginning/ending
 * values. This reads the Holdings tables underneath them: every position, with
 * quantity, price per unit, market value, total cost basis and unrealized G/L.
 *
 * WHY: fintable's holdings history begins 2026-07-04 and nothing recovers a day
 * before it. These statements are the only record of what was actually HELD in
 * the years before that, and they are the custodian's own — the same role
 * Quicken's Net Worth Report plays for the pre-2020 era in CR058. They are also
 * what would explain the month-boundary disagreements the roadmap records, where
 * Fidelity Bond is wrong at all four measured dates by up to +14,163.
 *
 * ── The check that makes this trustworthy ──
 *
 * Every section prints its own subtotal — `Total Common Stock (35% of account
 * holdings) $241,952.11 $268,154.37 -$26,202.26`. So the parser never has to be
 * believed: the rows it extracted must sum to the number the statement itself
 * printed, and a section that does not reconcile is an ERROR, not a warning.
 * That is the same construction as the Investments page's residual row, applied
 * to a parser instead of a feed.
 *
 * Fail-loud per .claude/rules/data-import.md: a money field that cannot be
 * parsed is an error, never a silent 0; a statement yielding zero holdings is an
 * error, not an empty success.
 *
 * READ-ONLY. Emits JSON or a table; writes nothing, anywhere.
 *
 * Usage:
 *   node parse-fidelity-holdings.js <file.pdf> [more.pdf ...]
 *   node parse-fidelity-holdings.js --json <file.pdf>
 *   node parse-fidelity-holdings.js --verbose <file.pdf>    # per-section checks
 */

const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');

/** Decompress every Flate stream and concatenate the text-show operands. */
function extractText(pdfPath) {
  const data = fs.readFileSync(pdfPath);
  const latin = data.toString('latin1');
  const chunks = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
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
  const shown = chunks.join('\n').match(/\((?:\\.|[^\\()])*\)/g) || [];
  const text = shown
    .map((s) => s.slice(1, -1).replace(/\\([()\\])/g, '$1'))
    .join(' ')
    .replace(/\s+/g, ' ');
  if (text.length < 500) {
    throw new Error(`${path.basename(pdfPath)}: extracted only ${text.length} chars — extraction failed`);
  }
  return text;
}

/**
 * A money/quantity token. Fidelity prints `$` only on the FIRST row of a group,
 * so both forms appear in one table and neither may be treated as the anomaly.
 * `-` and `not applicable` are genuine absences and return null, never 0 —
 * "the statement did not state this" and "this is zero" are different claims.
 */
function num(tok, ctx) {
  if (tok == null) throw new Error(`missing number (${ctx})`);
  const t = String(tok).trim();
  if (t === '-' || t === '--' || /^not applicable$/i.test(t)) return null;
  const cleaned = t.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new Error(`non-numeric "${tok}" (${ctx})`);
  return Number(cleaned);
}

const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function parsePeriodEnd(text, label) {
  const m = text.match(
    /INVESTMENT REPORT\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\s*-\s*([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/,
  );
  if (!m) throw new Error(`${label}: could not find the statement period`);
  const mm = MONTHS[m[4]];
  if (!mm) throw new Error(`${label}: unknown month "${m[4]}"`);
  return `${m[6]}-${String(mm).padStart(2, '0')}-${String(m[5]).padStart(2, '0')}`;
}

// Every subtotal label seen across the 51 statements (2016–2026). Enumerated
// from the corpus rather than guessed, because the layout changed over a decade.
const SECTIONS = [
  'Core Account',
  'Stock Funds', 'Short-Term Funds', 'Mutual Funds',
  'Equity ETPs', 'Fixed Income ETPs', 'Other ETPs', 'Exchange Traded Products',
  'Common Stock', 'Stocks',
  'Corporate Bonds', 'Bonds',
  'Options', 'Other', 'Loaned/Collateralized Securities',
];

// ⚠️ There is NO fixed list of aggregate sections, and that is the point.
// `Exchange Traded Products` is a LEAF in the 2016 layout (its rows sit directly
// under it) and an AGGREGATE in the modern one (Equity ETPs + Fixed Income ETPs
// + Other ETPs). Hard-coding either reading breaks half the corpus.
//
// So an aggregate is recognised structurally: it is a section whose body yields
// NO rows and whose printed total equals the sum of a SUFFIX of the leaf
// sections just parsed. Matching a suffix rather than everything pending is what
// makes nesting work — `Mutual Funds` must equal `Stock Funds` alone, not
// `Core Account + Stock Funds`. A zero-row section that matches nothing is left
// to fail, which is the whole reason the check exists.
function aggregateConsumes(printedTotal, pendingLeaves) {
  for (let k = 1; k <= pendingLeaves.length; k += 1) {
    const tail = pendingLeaves.slice(-k);
    const sum = tail.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - printedTotal) < 0.02) return k;
  }
  return 0;
}

// The subtotal regex can over-capture into a column header when a page breaks
// mid-table ("Cost Basis Unrealized Gain/Loss Income Earned Total Other"), so a
// captured name is resolved to the known section it ENDS with.
function resolveSectionName(raw) {
  const name = raw.trim();
  if (SECTIONS.includes(name)) return name;
  const hit = SECTIONS.filter((sec) => name.endsWith(sec)).sort((a, b) => b.length - a.length)[0];
  return hit || null;
}

const TICKER_RE = /\(([A-Z]{1,6}(?:\.[A-Z])?)\)/;
const CUSIP_RE = /\b([0-9A-Z]{9})\b/;

/**
 * One holdings row.
 *
 * Shape: `[marks] DESCRIPTION (TICKER) [E] QTY PRICE MV COST UGL [EAI] [EY %]`
 * with `$` optional per token. Bond rows carry a CUSIP instead of a ticker and
 * price against par — the two conventions CR061 §4.4 records.
 */
/**
 * ⚠️ TWO COLUMN LAYOUTS, and they differ by one column in the middle.
 *
 *   COMBINED (FA_):  Description | Quantity | Price | Total Market Value | Cost | Unrealized
 *   SINGLE   (FS_):  Description | BEGINNING Market Value | Quantity | Price |
 *                    ENDING Market Value | Cost | Unrealized
 *
 * Reading one as the other shifts every figure one column left, which is why the
 * single-account statements first parsed a Core Account of `1` against a printed
 * `2,325.29`: the quantity column had been read as a price. The section subtotal
 * moves too — in the single layout its FIRST number is the BEGINNING value, so
 * even a correct row sum would have been compared against the wrong month.
 */
function detectLayout(text) {
  return /Description\s+Beginning Market Value/.test(text) ? 'single' : 'combined';
}

function parseRows(rawBody, sectionName, label, layout) {
  const rows = [];

  // ⚠️ Anchor on the IDENTIFIER, not on the description.
  //
  // The first cut matched `DESCRIPTION <5 numbers>` and lost rows in two ways at
  // once: a description can be anything (multi-line issuer names, "FORMERLY
  // VANGUARD INDEX TR TO 05/24/2001", commas, slashes), and — the subtle one — a
  // match that the row filter REJECTS has still CONSUMED its input, so a
  // subtotal line that swallowed the row after it made that row unreachable.
  // `Stock Funds` reported 0 against a printed 7,146.46 while its neighbours
  // looked fine.
  //
  // The ticker or CUSIP is the one stable token on the line, so the scan anchors
  // there and reads the numeric run that follows. The description is then simply
  // whatever preceded it, which no longer has to be described by a grammar.
  const numTok = String.raw`(?:-?\$?[\d,]+\.\d{1,4}|-|not applicable)`;
  const rowRe = new RegExp(
    // The `E` flag marks an exchange-traded product; a core-account money-market
    // fund prints `-- 7-day yield: 0.06%` between its ticker and its numbers.
    // Both sit BETWEEN the identifier and the numeric run, so both are skipped
    // explicitly rather than by a permissive gap — a wildcard here would let the
    // scan wander into the next row's figures.
    String.raw`(?:\(([A-Z]{1,6}(?:\.[A-Z])?)\)|\b([0-9][0-9A-Z]{8})\b)`
    + String.raw`(?:\s*--\s*7-day yield:\s*[\d.]+\s*%)?\s*(?:E\s+)?`
    + (layout === 'single'
      ? String.raw`(${numTok})\s+(${numTok})\s+(${numTok})\s+(${numTok})\s+(${numTok})\s+(${numTok})`
      : String.raw`(${numTok})\s+(${numTok})\s+(${numTok})\s+(${numTok})\s+(${numTok})`),
    'g',
  );
  // Where the five figures we keep sit, per layout. The single layout's extra
  // BEGINNING value is deliberately not stored: this table records what was HELD
  // at the period end, and carrying a second month's value in the same row is
  // how two dates end up in one figure.
  const COL = layout === 'single'
    ? { qty: 4, price: 5, mv: 6, cost: 7, ugl: 8 }
    : { qty: 3, price: 4, mv: 5, cost: 6, ugl: 7 };

  let m;
  let lastEnd = 0;
  while ((m = rowRe.exec(rawBody)) !== null) {
    const symbol = m[1] || m[2];
    const desc = rawBody.slice(lastEnd, m.index)
      .replace(/Total [A-Za-z .&'-]+\(\d+% of account holdings\)[^A-Za-z]*/g, ' ')
      .replace(/Description Quantity Price Per Unit[A-Za-z .()/]*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    lastEnd = rowRe.lastIndex;

    rows.push({
      section: sectionName,
      description: desc.replace(/^[A-Z] /, '').slice(-120),
      symbol,
      quantity: num(m[COL.qty], `${label}/${sectionName}/qty`),
      price: num(m[COL.price], `${label}/${sectionName}/price`),
      market_value: num(m[COL.mv], `${label}/${sectionName}/mv`),
      cost_basis: num(m[COL.cost], `${label}/${sectionName}/cost`),
      unrealized: num(m[COL.ugl], `${label}/${sectionName}/ugl`),
    });
  }

  // The core-account CASH sweep carries no identifier at all. It IS a position —
  // omitting it would make every account miss its total by exactly the sweep.
  //
  // ⚠️ It obeys the same two layouts as every other row, and reading the wrong
  // one is silent: in the six-column form the sweep's PRICE column landed in
  // market value, so a $4,496.85 balance reported as `1` — a plausible-looking
  // number that only the subtotal check caught.
  const cash = rawBody.match(new RegExp(
    layout === 'single'
      ? String.raw`\bCASH\s+(${numTok})\s+(${numTok})\s+(${numTok})\s+(${numTok})`
      : String.raw`\bCASH\s+(${numTok})\s+(${numTok})\s+(${numTok})`,
  ));
  if (cash) {
    const c = layout === 'single'
      ? { qty: 2, price: 3, mv: 4 }    // [1] is the BEGINNING market value
      : { qty: 1, price: 2, mv: 3 };
    rows.push({
      section: sectionName,
      description: 'CASH',
      symbol: 'CASH',
      quantity: num(cash[c.qty], `${label}/${sectionName}/cash-qty`),
      price: num(cash[c.price], `${label}/${sectionName}/cash-price`),
      market_value: num(cash[c.mv], `${label}/${sectionName}/cash-mv`),
      cost_basis: null,     // "not applicable" on the statement — never 0
      unrealized: null,
    });
  }
  return rows;
}

/**
 * Split one account's Holdings block into sections, parse each, and CHECK each
 * against the subtotal the statement printed for it.
 */
function parseAccountHoldings(block, label, layout) {
  const sections = [];
  const pendingLeaves = [];
  const totalRe = /Total ([A-Za-z .&'/-]+?)\s*\(\d+% of account holdings\)\s*((?:-?\$?[\d,]+\.\d{2}|-|\s)+)/g;
  let m;
  let cursor = 0;
  while ((m = totalRe.exec(block)) !== null) {
    const name = resolveSectionName(m[1]);
    if (!name) { cursor = totalRe.lastIndex; continue; }

    const body = block.slice(cursor, m.index);
    cursor = totalRe.lastIndex;

    const printedToks = m[2].trim().split(/\s+/);
    // The single layout prints BEGINNING then ENDING; the combined prints only
    // the ending. Taking [0] in both would compare this month's rows against
    // last month's total.
    const printed = layout === 'single' ? printedToks.slice(1) : printedToks;
    // A section can print a subtotal with no figure at all (an empty
    // `Loaned/Collateralized Securities`). That is zero held, not a parse
    // failure — but it still has to reconcile against zero rows, so it is
    // checked rather than skipped.
    const printedMv = printed.length ? (num(printed[0], `${label}/${name}/total`) ?? 0) : 0;

    const rows = parseRows(body, name, label, layout);
    if (rows.length === 0) {
      const k = aggregateConsumes(printedMv, pendingLeaves);
      if (k > 0) { pendingLeaves.splice(-k, k); pendingLeaves.push(printedMv); continue; }
    }

    const sumMv = rows.reduce((s2, r) => s2 + (r.market_value || 0), 0);
    pendingLeaves.push(sumMv);
    sections.push({ name, rows, printed_total: printedMv, sum: sumMv });
  }
  return sections;
}

function parseFile(pdfPath) {
  const label = path.basename(pdfPath);
  const text = extractText(pdfPath);
  const asOf = parsePeriodEnd(text, label);
  const layout = detectLayout(text);

  // The Holdings pages repeat `Account # X27-230910` per account.
  const acctRe = /Account # ([A-Z0-9]\d{2}-\d{6})/g;
  const marks = [...text.matchAll(acctRe)].map((m) => ({ acct: m[1], at: m.index }));
  if (marks.length === 0) throw new Error(`${label}: no account markers found`);

  // ⚠️ Concatenate ALL of an account's pages BEFORE parsing sections, never page
  // by page. A section runs across page breaks — the ETF table is headed
  // `(continued)` on its later pages — and every page repeats `Account # …`, so
  // treating each page as a block puts a section's rows in one block and its
  // subtotal in another. The rows on the earlier pages are then silently
  // dropped: the first run of this parser reported 65,140.99 against a printed
  // 424,859.76 and, without the subtotal check, would have looked like data.
  const pagesByAccount = new Map();
  for (let i = 0; i < marks.length; i += 1) {
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    const page = text.slice(marks[i].at, end);
    // ⚠️ Test for the holdings COLUMN HEADER, not for a subtotal. A section that
    // runs past a page break is headed `(continued)` and carries rows with NO
    // subtotal of its own — filtering on the subtotal dropped those pages
    // entirely and lost $292,410 of one ETF section, which the reconciliation
    // check then reported rather than letting it pass as data.
    if (!/Price Per Unit/.test(page)) continue;   // not a holdings page
    if (!pagesByAccount.has(marks[i].acct)) pagesByAccount.set(marks[i].acct, []);
    pagesByAccount.get(marks[i].acct).push(page);
  }

  const byAccount = new Map();
  for (const [acct, pages] of pagesByAccount) {
    const sections = parseAccountHoldings(pages.join(' '), `${label}:${acct}`, layout);
    if (sections.length) byAccount.set(acct, sections);
  }

  const accounts = [...byAccount.entries()].map(([acct, sections]) => {
    const rows = sections.flatMap((s) => s.rows);
    const checks = sections.map((s) => ({
      section: s.name,
      printed: s.printed_total,
      parsed: Number(s.sum.toFixed(2)),
      delta: Number((s.sum - s.printed_total).toFixed(2)),
      ok: Math.abs(s.sum - s.printed_total) < 0.02,
    }));
    return {
      account_number: acct,
      as_of: asOf,
      positions: rows,
      total_market_value: Number(rows.reduce((s, r) => s + (r.market_value || 0), 0).toFixed(2)),
      checks,
      reconciles: checks.every((c) => c.ok),
    };
  });

  if (accounts.length === 0) throw new Error(`${label}: parsed zero accounts with holdings`);
  return { file: label, as_of: asOf, layout, accounts };
}

// ---- CLI -------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const verbose = args.includes('--verbose');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: parse-fidelity-holdings.js [--json] [--verbose] <file.pdf> ...');
    process.exit(2);
  }

  const out = [];
  let failed = 0;
  for (const f of files) {
    try {
      const r = parseFile(f);
      out.push(r);
      if (!json) {
        for (const a of r.accounts) {
          const bad = a.checks.filter((c) => !c.ok);
          console.log(
            `${r.file.padEnd(18)} ${a.account_number}  ${a.as_of}  `
            + `${String(a.positions.length).padStart(3)} positions  `
            + `$${a.total_market_value.toLocaleString('en-US', { minimumFractionDigits: 2 }).padStart(14)}  `
            + (a.reconciles ? '✓' : `🔴 ${bad.length} section(s) do not reconcile`),
          );
          if (verbose || !a.reconciles) {
            for (const c of a.checks) {
              console.log(`      ${c.ok ? '✓' : '🔴'} ${c.section.padEnd(26)} printed ${String(c.printed).padStart(14)}  parsed ${String(c.parsed).padStart(14)}  Δ ${c.delta}`);
            }
          }
          if (!a.reconciles) failed += 1;
        }
      }
    } catch (err) {
      failed += 1;
      console.error(`🔴 ${path.basename(f)}: ${err.message}`);
    }
  }

  if (json) console.log(JSON.stringify(out, null, 2));
  else if (failed) console.log(`\n🔴 ${failed} account-statement(s) did not reconcile or failed to parse.`);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { parseFile, extractText, parseRows, num };
