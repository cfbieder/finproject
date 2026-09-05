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
  // The statement has three ways of declining to state a figure, and all three
  // mean the same thing: it did not say. `unavailable` appears in the beginning
  // market value of a position opened mid-period; `not applicable` on cash.
  // Returning 0 for any of them would turn "not stated" into a claim.
  // FOUR ways this statement declines to state a figure, all meaning "we did not
  // say": `-`, `not applicable` (cash), `unavailable` (a position opened
  // mid-period, or a loaned security's beginning value) and `unknown` (cost and
  // gain on securities out on loan). `n/a` is the collapsed form of `not
  // applicable`, which the subtotal reader joins into one token so positional
  // slicing keeps working. Returning 0 for any of them turns "not stated" into a
  // claim — and on a loaned-securities row it would assert a zero cost basis,
  // making the entire market value look like gain.
  if (t === '-' || t === '--' || /^(not applicable|n\/a|unavailable|unknown)$/i.test(t)) return null;
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

// Bond sections carry a different row grammar, not a variant of the same one.
const BOND_SECTIONS = new Set([
  'Corporate Bonds', 'Bonds', 'Certificates of Deposit',
  'Municipal Bonds', 'U.S. Treasury', 'Government Agency',
]);

/**
 * ⚠️ The column header, not the section name, says whether a table carries an
 * ACCRUED INTEREST column.
 *
 * 🔴 Six CDs print under `Other`, which is not a bond section, so they were read
 * with the ordinary grammar — and their accrued interest was booked as COST
 * BASIS while the real cost basis became the unrealized gain. Across the corpus
 * that is 108 rows holding $9,991,277 of market value against $19,356 of stored
 * cost. It survived because the reconciliation gate compares MARKET VALUE, which
 * sits BEFORE the extra column and was right in every row — the same blindness
 * that let 13 securities keep a page banner as their name.
 *
 * The signature is the header's own ordering (`… Accrued Int. (AI) <date> Total
 * Cost Basis …`) rather than the bare phrase, so prose about accrued interest in
 * a section's footnotes cannot switch the grammar.
 */
function hasAccruedColumn(rawBody) {
  return /Accrued\s+Int(?:erest|\.)\s*\(AI\)[\s\S]{0,40}?Total\s+Cost\s+Basis/.test(rawBody);
}

// Moody's and S&P print their own scales, and each is matched longest-first —
// `A1` must not win against `Aa1`, nor `A` against `AAA`.
// ⚠️ The trailing guard is a lookahead, NOT `\b`. A word boundary after `BBB-`
// does not exist — `-` and the following space are both non-word — so the
// engine backtracked and stored `BBB`, quietly promoting every minus-notch
// rating by one grade. Matched longest-first, too: `A1` must not win against
// `Aa1`, nor `A` against `AAA`.
const RATED = String.raw`(?=\s|$)`;
const MOODYS_RE = new RegExp(String.raw`\bMOODYS\s+(Aaa|Aa[123]|A[123]|Baa[123]|Ba[123]|B[123]|Caa[123]|Ca|C|WR|NR)` + RATED);
const SP_RE = new RegExp(String.raw`\bS&P\s+(AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC[+-]?|CC|C|D|NR)` + RATED);

/**
 * The terms a bond or CD prints about ITSELF — rating, coupon, maturity, payment
 * frequency, call date.
 *
 * WHY THIS IS FREE: the custodian already states all of it, on every statement,
 * in text this parser reads and used to discard. CR093 §1 decision 4 makes it
 * the authority: a vendor's coupon disagreeing with the custodian's would be a
 * second wrong number beside the right one.
 *
 * ⚠️ TWO PRINT FORMS, and they put the same facts in different places:
 *
 *   corporate bond   BLACKSTONE PRIVATE CREDIT FUND SER B `12/15/26`
 *                    <figures> $196.87 `2.625 %` FIXED COUPON MOODYS Baa2
 *                    S&P BBB- SEMIANNUALLY … CUSIP: 09261HAD9
 *                    → maturity is glued to the description (it is the Maturity
 *                      column); coupon and ratings trail the figures.
 *
 *   CD               CITIBANK N A CD `4.00000%` `05/15/2029` FIXED COUPON
 *                    FDIC INSURED MONTHLY … CUSIP: 17290GHT7 <figures>
 *                    → everything is in the description, and the CUSIP comes
 *                      BEFORE the figures rather than after.
 *
 * So the CD form is tried first and anchors coupon and maturity TOGETHER — a
 * bare four-digit date would otherwise pick up `NEXT CALL DATE`, and a bare
 * percentage would pick up a money-market fund's 7-day yield.
 *
 * Returns null unless a coupon or a rating was actually found, so an equity row
 * can never acquire empty bond terms.
 */
/**
 * A bond or CD's description is its issuer, and — for a CD — its coupon and
 * maturity, which is how CDs are conventionally named. What follows that is
 * TERMS, and now that the terms are parsed into their own columns they no longer
 * belong in the name: `UBS BK USA NATL ASSN CD 3.80000% 11/27/2028` rather than
 * `… FIXED COUPON FDIC INSURED MONTHLY NEXT CALL DATE 11/20/2026 CUSIP:`, which
 * is what the 120-character cut used to leave behind (and cut mid-word).
 */
function trimTermsTrailer(desc) {
  return desc
    .replace(/\s+(?:FIXED|STEP|VARIABLE|ZERO|FLOATING)\s+COUPON\b[\s\S]*$/, '')
    .replace(/\s*CUSIP:[\s\S]*$/, '')
    .trim();
}

function bondTerms(description, trailer) {
  const desc = description || '';
  const tail = trailer || '';
  const both = `${desc} ${tail}`;
  const t = {
    coupon_rate: null, maturity_date: null, coupon_type: null,
    payment_frequency: null, moodys_rating: null, sp_rating: null,
    next_call_date: null, fdic_insured: /FDIC\s+INSURED/.test(both),
  };

  const cd = desc.match(/\b(\d{1,2}\.\d{1,5})\s*%\s+(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (cd) {
    t.coupon_rate = Number(cd[1]);
    t.maturity_date = `${cd[4]}-${cd[2]}-${cd[3]}`;
  } else {
    const c = tail.match(/(\d{1,2}\.\d{1,5})\s*%?\s+(?:FIXED|STEP|VARIABLE|ZERO|FLOATING)\b/);
    if (c) t.coupon_rate = Number(c[1]);
    // ⚠️ Anchored at the END of the description because that is where the
    // Maturity COLUMN lands. An unanchored two-digit date would match a
    // "FORMERLY … TO 05/24/01" clause in an issuer name.
    const mat = desc.match(/(\d{2})\/(\d{2})\/(\d{2})\s*$/);
    // A two-digit year, resolved as 2000s: a bond maturing in the 1900s cannot
    // appear in a holdings table printed from 2016 onward.
    if (mat) t.maturity_date = `20${mat[3]}-${mat[1]}-${mat[2]}`;
  }

  const ct = both.match(/\b(FIXED|STEP|VARIABLE|ZERO|FLOATING)\s+COUPON\b/);
  if (ct) t.coupon_type = ct[1].toLowerCase();
  const pf = both.match(/\b(SEMIANNUALLY|ANNUALLY|QUARTERLY|MONTHLY|AT MATURITY)\b/);
  if (pf) t.payment_frequency = pf[1].toLowerCase().replace(' ', '_');
  const md = both.match(MOODYS_RE);
  if (md) t.moodys_rating = md[1];
  const sp = both.match(SP_RE);
  if (sp) t.sp_rating = sp[1];
  const nc = both.match(/NEXT CALL DATE\s+(\d{2})\/(\d{2})\/(\d{4})/);
  if (nc) t.next_call_date = `${nc[3]}-${nc[1]}-${nc[2]}`;

  if (t.coupon_rate === null && !t.moodys_rating && !t.sp_rating) return null;
  return t;
}

/**
 * Bond rows, which differ from every other section in two ways at once:
 *
 *  1. An extra ACCRUED INTEREST column sits between ending market value and
 *     cost basis, so the numeric run is seven long rather than six. Read with
 *     the ordinary mapping, accrued interest would be booked as cost basis and
 *     the cost as the gain.
 *  2. The identifier is not in parentheses. It is printed as `CUSIP: 06406RAN7`
 *     in the descriptive block that FOLLOWS the figures, after the coupon,
 *     ratings and call schedule.
 *
 * So the scan anchors on the numeric run and then takes the next CUSIP after
 * it. If a row ever loses its CUSIP the section simply will not reconcile,
 * which is the outcome we want over a guess.
 */
function parseBondRows(rawBody, sectionName, label, numTok) {
  const rows = [];
  const runRe = new RegExp(
    String.raw`(${numTok})\s+(${numTok})\s+(${numTok})\s+(${numTok})\s+(${numTok})\s+(${numTok})\s+(${numTok})`,
    'g',
  );
  let m;
  let lastEnd = 0;
  while ((m = runRe.exec(rawBody)) !== null) {
    const after = rawBody.slice(runRe.lastIndex);
    const cusip = after.match(/CUSIP:\s*([0-9A-Z]{9})/);
    if (!cusip) continue;
    const mv = num(m[4], `${label}/${sectionName}/mv`);
    if (mv === null) continue;
    // 🔴 This was the constant string 'BOND' for every bond ever parsed, so 40
    // securities — $1,064,132 of the live portfolio — rendered a Name column
    // reading "BOND" over and over. The description is available in exactly the
    // same place as in every other section: the text before the figures. It was
    // never captured because bonds anchor on the numeric run rather than on an
    // identifier, and nothing downstream reads a name, so nothing complained.
    const desc = describe(rawBody.slice(lastEnd, m.index)).replace(/^(?:[A-Z] )+/, '');
    // ⚠️ Advance past the CUSIP, not merely past the figures. A bond prints its
    // issuer name BEFORE the numbers and its coupon, ratings, call schedule and
    // CUSIP AFTER them, so stopping at the numeric run leaves that whole trailer
    // in the window the NEXT row inherits — and every bond then took its
    // predecessor's ratings as its name ("FIXED COUPON MOODYS A3 S&P BBB+ …").
    lastEnd = runRe.lastIndex + cusip.index + cusip[0].length;
    rows.push({
      section: sectionName,
      description: trimTermsTrailer(desc).slice(0, 120) || 'BOND',
      symbol: cusip[1],
      quantity: num(m[2], `${label}/${sectionName}/qty`),
      price: num(m[3], `${label}/${sectionName}/price`),
      market_value: mv,
      // m[5] is ACCRUED INTEREST — deliberately not stored as anything. It is
      // interest earned and not yet paid, not part of the position's value, and
      // the section subtotal excludes it.
      cost_basis: num(m[6], `${label}/${sectionName}/cost`),
      unrealized: num(m[7], `${label}/${sectionName}/ugl`),
      // Rating, coupon, maturity — the custodian's own record of an instrument
      // we hold, read out of the trailer this scan already had to walk past.
      terms: bondTerms(desc, rawBody.slice(runRe.lastIndex, lastEnd)),
    });
  }
  return rows;
}

/**
 * A row's description is whatever text precedes its identifier — which, for the
 * FIRST row on a page, also contains the page banner, the section heading and
 * the column header. Those are furniture, not the holding's name.
 *
 * 🔴 This was silently wrong for 13 of 265 securities: Iron Mountain was stored
 * as "st (AI) Sep 30, 2020 Total Cost Basis Un…" and Eaton Vance as
 * "March 31, 2016 Account # X27-230910 CHRI…". Nothing caught it, and nothing
 * could have — the reconciliation gate compares SUMS against the statement's
 * printed subtotals, so it validates arithmetic and never reads a name. Every
 * other defect this parser has had was caught by that gate; this one outlived it
 * by living in the one column the gate does not look at. `securities` is a master
 * table written once at first sight, so a bad name is permanent.
 *
 * Cutting at the LAST furniture token rather than scrubbing patterns out is what
 * makes this robust: the two header layouts do not share a shape —
 *
 *   combined  Description Quantity Price Per Unit … Est. Annual Income (EAI) Est.Yield (EY)
 *   single    Description Beginning Market Value Jun 1,2016 Quantity Jun 30,2016 … EAI ($) / EY (%)
 *
 * — and the old scrub matched the first only, because `[A-Za-z .()/]*` cannot
 * cross the dates the single layout interleaves between its column labels. Both
 * terminate on a yield label, so the cut point is stable where the pattern is not.
 */
const FURNITURE = new RegExp([
  // The column header comes in FOUR variants and they share no single tail, so
  // each terminator is listed independently and the LAST match wins:
  //   Description Quantity Price Per Unit … Total Cost Basis Unrealized Gain/Loss
  //   … Unrealized Gain/Loss Est. Annual Income (EAI) Est.Yield (EY)
  //   … Unrealized Gain/Loss Jun 30,2016 EAI ($) / EY (%)
  //   Core Account: Description Beginning Market Value … Ending Market Value … EAI ($) / EY (%)
  // The last has NO cost or unrealized column at all — a money-market sweep has
  // no basis — so anchoring on `Unrealized Gain/Loss` alone left every FDIC
  // deposit row named after its own header.
  // ⚠️ LONGEST FIRST. Alternation is ordered and matched at the earliest
  // position, so listing the bare phrase first meant it always won and the
  // trailing date was never consumed — `last match wins` decides between
  // matches at DIFFERENT positions, not between alternatives at the same one.
  // The 2016 layout ends its header `Unrealized Gain/Loss Dec 31, 2016` with no
  // income column at all, and one ETF was stored as `Dec 31, 2016 Equity ETPs M
  // ETFIS SER TR I BIOSHS BIOTE` because of it. Modern headers continue into an
  // EAI label, which is a LATER match and still wins.
  String.raw`Unrealized Gain\/Loss\s+[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4}`,
  String.raw`Unrealized Gain\/Loss`,
  String.raw`EAI \(\$\) \/ EY \(%\)`,
  String.raw`Est\. Annual Income \(EAI\)\s*Est\.\s?Yield \(EY\)`,
  // A FIFTH header variant, on bond tables only: they end in `Coupon Rate`
  // rather than a yield label. Without it the first bond of every section kept
  // the header as its name — `Jun 30, 2026 Est. Annual Income (EAI) Coupon Rate
  // Corporate Bonds B BLACKSTONE …`. Same column, same blindness: the
  // reconciliation gate never reads a name.
  String.raw`Est\. Annual Income \(EAI\)\s*Coupon Rate`,
  String.raw`Income Earned`,
  // 🔴 A run of figures ends the row BEFORE this one — whether or not that row
  // was matched. A holding with no ticker matches no row at all, so its whole
  // line stays in the window and the head-slice takes IT as the next holding's
  // name. FLDR was stored as `COLLATERAL DELV TO US BANK NA SECURITIES ON …`
  // because the collateral line above it in `Loaned/Collateralized Securities`
  // has no identifier: `… X unavailable 76,393.000 - unavailable unknown unknown
  // - -` then the real name. Six of the seven statements naming FLDR say
  // "FIDELITY LOW DURATION BOND FACTOR ETF"; the one that did not was the FIRST,
  // and securities.name is written at first sight.
  //
  // Three or more consecutive figure-or-absence tokens, so a name carrying one
  // number of its own (`CD 5.55000% 10/18/2033`) is not cut in half.
  String.raw`(?:(?:-{1,2}|not applicable|unavailable|unknown|-?\$?[\d,]+(?:\.\d+)?%?)\s+){3,}`,
  // A section subtotal and the figures trailing it. `[^A-Za-z]*` eats the
  // numbers so they cannot be read as part of the next row's name.
  String.raw`Total [A-Za-z .&'-]+\(\d+% of account holdings\)[^A-Za-z]*`,
  // Page banner and continuation heading (`Stocks (continued)`,
  // `Common Stock (continued)`) — both sit between the header and the first row.
  String.raw`\(continued\)`,
].join('|'), 'g');

// Two things still sit between the furniture and the name, and neither is a
// header: the SECTION HEADING, which prints once before its first row without
// the `(continued)` marker; and numeric debris from the row before — the EAI and
// yield columns trail every row and the numeric run deliberately does not capture
// them, so they are left in the window for the next row to inherit. Biogen read
// as `- - M BIOGEN INC COM` and Invesco as `277.06 6.170 M INVESCO …`.
const LEADING_DEBRIS = new RegExp(
  // `-$108.15` is a minus, then a dollar sign: an alternation of "dashes" OR
  // "optionally-$-prefixed number" matches neither half of it, and Iron Mountain
  // kept its predecessor's unrealized column.
  String.raw`^(?:(?:-{1,2}|%|-?\$?[\d,]+(?:\.\d+)?%?)\s+)+`,
);
const LEADING_SECTION = new RegExp(
  String.raw`^(?:` + SECTIONS.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  + String.raw`)(?:\s+E \(e\.g\. ETF, ETN\))?\s+`,
);

function describe(window) {
  let cut = 0;
  for (const f of window.matchAll(FURNITURE)) cut = f.index + f[0].length;
  let d = window.slice(cut).replace(/\s+/g, ' ').trim();
  // Order matters: debris precedes the heading (`… 6.170 Common Stock M INVESCO`),
  // and a heading can itself be followed by more debris.
  for (let i = 0; i < 2; i += 1) {
    d = d.replace(LEADING_DEBRIS, '').replace(LEADING_SECTION, '');
  }
  return d.trim();
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
  const numTok = String.raw`(?:-?\$?[\d,]+\.\d{1,4}|-|not applicable|unavailable|unknown)`;
  if (BOND_SECTIONS.has(sectionName)) return parseBondRows(rawBody, sectionName, label, numTok);

  // The extra ACCRUED INTEREST column is decided by the table's own header, not
  // by the section name — see hasAccruedColumn. It sits BETWEEN ending market
  // value and cost basis, so it shifts only the last two figures.
  const ai = hasAccruedColumn(rawBody) ? 1 : 0;
  const nNum = (layout === 'single' ? 6 : 5) + ai;

  const rowRe = new RegExp(
    // The `E` flag marks an exchange-traded product; a core-account money-market
    // fund prints `-- 7-day yield: 0.06%` between its ticker and its numbers.
    // Both sit BETWEEN the identifier and the numeric run, so both are skipped
    // explicitly rather than by a permissive gap — a wildcard here would let the
    // scan wander into the next row's figures.
    String.raw`(?:\(([A-Z]{1,6}(?:\.[A-Z])?)\)|\b([0-9][0-9A-Z]{8})\b)`
    // Between the identifier and the figures a row may carry a rate clause
    // (`-- 7-day yield: 0.06%`, `-- Interest rate: 0.01%`) and a single-letter
    // footnote marker (`E` for exchange-traded, `h` for held-away FDIC deposits).
    // Both are enumerated rather than skipped with a wildcard: a permissive gap
    // here would let the scan run past a row with no figures and pick up the
    // NEXT row's numbers, which reads as a real position at the wrong price.
    + String.raw`(?:\s*--\s*[A-Za-z0-9 -]{3,24}:\s*[\d.]+\s*%)?\s*(?:[A-Za-z]\s+)?`
    + Array.from({ length: nNum }, () => `(${numTok})`).join(String.raw`\s+`),
    'g',
  );
  // Where the five figures we keep sit, per layout. The single layout's extra
  // BEGINNING value is deliberately not stored: this table records what was HELD
  // at the period end, and carrying a second month's value in the same row is
  // how two dates end up in one figure.
  const COL = layout === 'single'
    ? { qty: 4, price: 5, mv: 6, cost: 7 + ai, ugl: 8 + ai }
    : { qty: 3, price: 4, mv: 5, cost: 6 + ai, ugl: 7 + ai };

  let m;
  let lastEnd = 0;
  while ((m = rowRe.exec(rawBody)) !== null) {
    const symbol = m[1] || m[2];
    const desc = describe(rawBody.slice(lastEnd, m.index));
    lastEnd = rowRe.lastIndex;

    rows.push({
      section: sectionName,
      // Keep the HEAD, not the tail. `slice(-120)` was correct only while the
      // window still held furniture in front of the name — the tail was then the
      // one part that was reliably the holding. With the furniture cut, tail-
      // slicing truncates the NAME instead, which is how two CDs ended up stored
      // starting mid-token on a leading space.
      // Flags stack (`M B FS KKR CAP CORP NOTE`), so strip all of them, not one.
      description: trimTermsTrailer(desc.replace(/^(?:[A-Z] )+/, '')).slice(0, 120),
      symbol,
      // A CD carries its coupon, maturity and FDIC status inside its own
      // description, so the terms are read from the FULL window — before the
      // 120-char cut that the stored name takes.
      terms: bondTerms(desc, ''),
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
  // ⚠️ The subtotal line uses the SAME absence tokens the rows do. A section
  // whose beginning value is `unavailable` captured nothing here, so the printed
  // total silently defaulted to 0 and the section "failed" against rows that
  // were correct — the parser and the LLM independently produced 4,339.60 while
  // the baseline said 0. Absence was taught to the row tokeniser and not to this
  // one; the two must agree on what "the statement did not say" looks like.
  const totalRe = /Total ([A-Za-z .&'/-]+?)\s*\(\d+% of account holdings\)\s*((?:-?\$?[\d,]+\.\d{2}|not applicable|unavailable|unknown|-|\s)+)/g;
  let m;
  let cursor = 0;
  while ((m = totalRe.exec(block)) !== null) {
    const name = resolveSectionName(m[1]);
    if (!name) { cursor = totalRe.lastIndex; continue; }

    const body = block.slice(cursor, m.index);
    cursor = totalRe.lastIndex;

    // ⚠️ An absence token must KEEP ITS PLACE, not be removed. It occupies the
    // BEGINNING-value slot, and the single layout reads the ENDING value by
    // position — so deleting it shifts every column left and the ending value is
    // dropped instead. (Filtering them out cost 3 statements before this note.)
    // `not applicable` is two words, so it is collapsed to one token first.
    const printedToks = m[2].trim().replace(/not applicable/gi, 'n/a').split(/\s+/);
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

    // ⚠️ THE SECOND COLUMN OF THE SUBTOTAL, checked because the first one was
    // right while the row beneath it was wrong.
    //
    // 🔴 CDs print under `Other` with an extra ACCRUED INTEREST column, so their
    // accrued interest was stored as cost basis and their cost basis as the
    // unrealized gain — 161 rows across the corpus. Market value sits BEFORE the
    // extra column, so the only figure the gate compared was the only figure
    // that could not move. A gate that reads one column can only find defects in
    // that column; this one now reads the next.
    //
    // Skipped, not failed, where the statement does not support it: a Core
    // Account prints `not applicable` for basis and omits the figure from its
    // own subtotal, and an aggregate section has no rows of its own.
    const costable = rows.length > 0
      && /Total Cost Basis/.test(body)
      && rows.every((r) => r.cost_basis !== null && r.cost_basis !== undefined);
    const printedCost = costable && printed.length > 1 ? num(printed[1], `${label}/${name}/total-cost`) : null;
    const sumCost = costable ? rows.reduce((s2, r) => s2 + r.cost_basis, 0) : null;

    sections.push({
      name, rows, printed_total: printedMv, sum: sumMv,
      printed_cost: printedCost, sum_cost: sumCost,
    });
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

  const holdingsText = new Map();
  for (const [acct, pages] of pagesByAccount) holdingsText.set(acct, pages.join(' '));

  const byAccount = new Map();
  for (const [acct, pages] of pagesByAccount) {
    const sections = parseAccountHoldings(pages.join(' '), `${label}:${acct}`, layout);
    if (sections.length) byAccount.set(acct, sections);
  }

  const accounts = [...byAccount.entries()].map(([acct, sections]) => {
    const rows = sections.flatMap((s) => s.rows);
    const checks = sections.flatMap((s) => {
      const out = [{
        section: s.name,
        printed: s.printed_total,
        parsed: Number(s.sum.toFixed(2)),
        delta: Number((s.sum - s.printed_total).toFixed(2)),
        ok: Math.abs(s.sum - s.printed_total) < 0.02,
      }];
      if (s.printed_cost !== null && s.sum_cost !== null) {
        out.push({
          section: `${s.name} (cost basis)`,
          printed: s.printed_cost,
          parsed: Number(s.sum_cost.toFixed(2)),
          delta: Number((s.sum_cost - s.printed_cost).toFixed(2)),
          ok: Math.abs(s.sum_cost - s.printed_cost) < 0.02,
        });
      }
      return out;
    });
    return {
      account_number: acct,
      as_of: asOf,
      positions: rows,
      total_market_value: Number(rows.reduce((s, r) => s + (r.market_value || 0), 0).toFixed(2)),
      checks,
      reconciles: checks.every((c) => c.ok),
      // Just this account's holdings pages. Exposed so a consumer can send the
      // TABLE rather than the whole document: a statement runs to ~52k
      // characters of which the holdings are a fraction, and the rest is
      // activity, summaries and disclosures that cost context and buy nothing.
      holdings_text: holdingsText.get(acct) || '',
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

module.exports = { parseFile, extractText, parseRows, num, describe, bondTerms };
