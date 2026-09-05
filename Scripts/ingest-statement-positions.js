#!/usr/bin/env node
/**
 * ingest-statement-positions.js — CR061 P2.
 *
 * Custodian statements → `security_position_snapshots` / `security_positions`
 * with `source='statement'`, and a drift report comparing each statement's
 * per-account total against what fin's ledger said on that date.
 *
 * ⚠️ THE REPORT BOOKS NOTHING (owner, 2026-09-04). It names where fin drifted
 * from the custodian and stops. Re-marking history is a different change with
 * real blast radius — CR058 records a mark correction that took three
 * migrations to undo — and belongs in its own CR with its own review.
 *
 * ── Two things that make statement snapshots BETTER than the feed's ──
 *
 * 1. They are genuinely dated. fintable states only when it was POLLED, and the
 *    2026-09-02 poll carries 08-31's closes (CR089), so `valued_on` is null for
 *    every feed snapshot. A statement says "Holdings … March 31, 2016" — the
 *    valuation date is stated, so `valued_on` is FILLED here. Statement history
 *    is the only position data fin has that knows its own date.
 * 2. They reach back to 2016. fintable's history begins 2026-07-04.
 *
 * ⚠️ And the two sources DO NOT OVERLAP: statements end 2026-06-30, the feed
 * begins 2026-07-04. There is no date on which both describe the same account,
 * so they cannot be cross-checked against each other. That is why validation is
 * against fin's ledger instead.
 *
 * Only statements whose every section reconciles against its own printed
 * subtotal are ingested (owner, 2026-09-04). One that does not is left ABSENT,
 * which the schema distinguishes from "held nothing" by design.
 *
 * DRY RUN BY DEFAULT — pass --apply to write.
 * Rollback:  DELETE FROM security_position_snapshots WHERE source = 'statement';
 *
 * Usage:
 *   node Scripts/ingest-statement-positions.js [--apply] [--report] [Samples/Fidelity/*.pdf]
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
const { parseFile } = require('../server/src/v2/scripts/parse-fidelity-holdings');
const { classify } = require('../server/src/v2/services/investmentClassification');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REPORT_ONLY = args.includes('--report');
// ⚠️ `--llm <path>` takes a VALUE, so a plain "drop everything starting with --"
// filter leaves the path behind as a positional, and the script then tries to
// parse the JSON sidecar as a statement PDF.
const FLAGS_WITH_VALUES = new Set(['--llm']);
const files = args.filter((a, i) => !a.startsWith('--') && !FLAGS_WITH_VALUES.has(args[i - 1]));

/**
 * Fidelity account number → fin account id.
 *
 * ⚠️ PINNED, not inferred, and every entry was verified the way CR058 verified
 * its own map: by an exact balance match against fin at a statement boundary,
 * never by reading the account's description text. Inferring the mapping from
 * whichever fin account the total is CLOSEST to would be circular — it would
 * quietly assign each statement to whatever account made the drift smallest,
 * which is the very thing this report exists to measure.
 *
 * An account number not in this map is REFUSED, not guessed.
 *
 * Note an account's holdings change over a decade while its number does not:
 * X27-230910 held equities and ETFs in 2016 and is fin's Bond account today.
 * That is the same account being used differently, not a mismapping.
 */
const ACCOUNT_MAP = {
  'Z31-443539': 27,   // Fidelity Stocks   — verified 2026-06-30, exact to the cent
  'X27-230910': 31,   // Fidelity Bond
  'X94-929946': 30,   // Fidelity Cash Mgt
  '194-901660': 26,   // Fidelity IRA
};

const SOURCE = 'statement';

/**
 * The hybrid's second half, arriving as data.
 *
 * `Scripts/extract-statements-llm.js --emit <file>` writes the account-statements
 * the deterministic parser cannot reconcile, but ONLY those whose every printed
 * section subtotal tied against the model's rows — the same gate the parser
 * answers to, applied to the same statement. Rows that did not tie are never
 * written, so this file cannot carry an unverified extraction for us to trust
 * here on the strength of a flag.
 *
 * ⚠️ The substitution is per ACCOUNT-STATEMENT, not per file: one PDF holds
 * several accounts and the parser routinely reconciles two of three.
 */
const LLM_FILE = (() => { const i = process.argv.indexOf('--llm'); return i >= 0 ? process.argv[i + 1] : null; })();
const llmByAccount = new Map();
if (LLM_FILE) {
  for (const e of JSON.parse(fs.readFileSync(LLM_FILE, 'utf8'))) {
    llmByAccount.set(`${e.file}|${e.account_number}`, e);
  }
}

async function resolveSecurity(position, cache) {
  /**
   * ⚠️ Not every holding has a ticker, and dropping the ones that do not loses
   * money silently. FA_2025_12 carries a EURO (EUR) cash balance — 7,607.47 at
   * 1.174 = $8,934.59 — with no symbol, correctly, because none is printed. It
   * was skipped, and the snapshot stored $8,934.59 short of the header total
   * that the statement itself supplies. Caught by the rows-vs-header check, not
   * by anything that reads a name or a symbol.
   *
   * The mapping is keyed on `external_name`, which need not be a ticker, so an
   * unticketed holding keys on its description instead and carries a NULL
   * ticker. Refusing it would be defensible; storing an account short is not.
   */
  const symbol = String(position.symbol || '').trim()
    || String(position.description || '').trim();
  if (!symbol) return null;
  // 🔴 THE CACHE MUST NOT SKIP THE HEAL, only the lookup.
  //
  // This returned early, so `healName` ran at most ONCE per symbol per run — on
  // the OLDEST statement, since the corpus is read in date order. The comment
  // below it claims the most recent statement wins; the code made the first one
  // win, which is the exact defect that rule was written to kill. AGG kept
  // `Mar 31, 2017 Fixed Income ETPs ISHARES CORE U.S. AGGREGATE BOND ETF` from
  // its first sighting while all 61 later sightings said `ISHARES CORE US
  // AGGREGATE BOND ETF`, and re-running the ingest could never repair it.
  //
  // So the cache holds the ROW, not the id, and every sighting still heals.
  if (cache.has(symbol)) {
    const hit = cache.get(symbol);
    await healName(db, hit, symbol, position);
    return hit.id;
  }

  const existing = await db.query(`
    SELECT s.id, s.name FROM security_source_mappings m
      JOIN securities s ON s.id = m.security_id
     WHERE m.source = 'fintable' AND m.external_name = $1`, [symbol]);
  if (existing.rows.length) {
    await healName(db, existing.rows[0], symbol, position);
    cache.set(symbol, existing.rows[0]); return existing.rows[0].id;
  }

  const stmt = await db.query(`
    SELECT s.id, s.name FROM security_source_mappings m
      JOIN securities s ON s.id = m.security_id
     WHERE m.source = $1 AND m.external_name = $2`, [SOURCE, symbol]);
  if (stmt.rows.length) {
    await healName(db, stmt.rows[0], symbol, position);
    cache.set(symbol, stmt.rows[0]); return stmt.rows[0].id;
  }

  const c = classify(position);
  const isTicker = /^[A-Z]{1,5}$/.test(symbol.toUpperCase());
  const { rows } = await db.query(`
    INSERT INTO securities (ticker, name, asset_class, currency, price_basis, quantity_unit, classification_source)
    VALUES ($1,$2,$3,'USD',$4,$5,$6) RETURNING id`,
  [isTicker ? symbol.toUpperCase() : null, position.description || symbol,
    c.asset_class, c.price_basis, c.quantity_unit, c.classification_source]);
  await db.query(`
    INSERT INTO security_source_mappings (security_id, source, external_name)
    VALUES ($1,$2,$3) ON CONFLICT (source, external_name) DO NOTHING`,
  [rows[0].id, SOURCE, symbol]);
  cache.set(symbol, { id: rows[0].id, name: position.description || symbol });
  return rows[0].id;
}

/**
 * `securities.name` is written once, at first sight, and never revisited — so a
 * name that was wrong when the row was created stays wrong forever. 13 of 265
 * were stored named after their own statement page header (Iron Mountain as
 * "st (AI) Sep 30, 2020 Total Cost Basis Un…"), because the parser's description
 * capture reached back across the header on the first row of a page.
 *
 * The parser is fixed, but a corrected parser repairs nothing on its own: a
 * re-run finds the mapping, returns the existing id and never looks at the name.
 * So heal on resolve, under a predicate that CONVERGES — a bad name is one that
 * carries statement furniture, starts on punctuation, or is just the symbol
 * (what the bank-feed writes, since fintable sets `name == symbol` for
 * everything). Once healed a row stops matching and is left alone, so this is
 * not last-writer-wins across 117 statements.
 *
 * A statement description is the only real name source fin has.
 */
const FURNITURE_IN_NAME = /Total Cost Basis|Ending Market Value|Beginning Market Value|Accrued Interest|Account #|Price Per Unit|Est\.\s?Yield|EAI|\(continued\)|% of account holdings|Unrealized Gain/;

function nameLooksWrong(name, symbol) {
  const raw = String(name || '');
  const n = raw.trim();
  // Untrimmed is its own symptom, and testing the TRIMMED value hides it: four
  // brokered CDs were stored as " B FINWISE BANK (UTAH) CD …" — the old tail-
  // slice cutting mid-token — and read as perfectly well-formed once trimmed.
  if (raw !== n) return true;
  // `BOND` is a PLACEHOLDER, not a name — parseBondRows wrote it as a constant
  // for every bond, so 40 securities carried it. It passes every other test here
  // (trimmed, alphabetic, unlike its symbol), which is why it had to be named.
  // `CASH` is left alone: for the core-account sweep that IS the name.
  if (n === 'BOND') return true;
  return !n || n === symbol || FURNITURE_IN_NAME.test(n) || !/^[A-Za-z]/.test(n);
}

// Counted as DISTINCT securities, not as UPDATEs. Reading in date order, a
// holding whose description changed over a decade is rewritten at each change
// point, so counting writes reported 276 for what is 231 securities — a number
// that reads as churn rather than as repair.
const healed = new Set();
async function healName(db, row, symbol, position) {
  // 🔴 A DRY RUN MUST NOT WRITE. This repair sits inside resolveSecurity, which
  // the merge loop calls BEFORE the `!APPLY` early return, so without this guard
  // `node ingest-statement-positions.js` with no flags silently UPDATEd
  // securities.name — and did so against prod before it was caught. The repairs
  // themselves were correct, which is exactly why it would have gone unnoticed.
  if (!APPLY || REPORT_ONLY) return;
  const better = String(position.description || '').trim();
  if (!better || nameLooksWrong(better, symbol)) return;
  if (String(row.name || '').trim() === better) return;

  /**
   * ⚠️ THE MOST RECENT STATEMENT WINS, not the first one seen.
   *
   * Healing only names that "look wrong" left the real failure untouched: a wrong
   * name that looks perfectly plausible. FLDR was stored as `COLLATERAL DELV TO
   * US BANK NA SECURITIES ON …` because its FIRST sighting sat in
   * `Loaned/Collateralized Securities` beneath a collateral line with no ticker.
   * Six of the seven statements naming it say `FIDELITY LOW DURATION BOND FACTOR
   * ETF`; first-seen-wins picked the seventh, and no predicate over the string
   * alone could tell — it is trimmed, alphabetic, unlike its symbol and reads
   * like an instrument.
   *
   * Statements are now read in date order and the latest good description wins,
   * which is also the right answer when an instrument is genuinely RENAMED. The
   * value of a name is that it is current, not that it was first.
   */
  await db.query('UPDATE securities SET name = $2, updated_at = now() WHERE id = $1', [row.id, better]);
  // Keep the cached row in step, so a symbol seen fifty times updates only when
  // the description actually changes rather than once per sighting.
  row.name = better;
  healed.add(row.id);
}

let termsWritten = 0;

/**
 * The instrument terms a bond or CD prints about itself — rating, coupon,
 * maturity, payment frequency, call date (migration 078).
 *
 * ⚠️ LATEST STATEMENT WINS, and the `WHERE` clause is what enforces it rather
 * than the read order. Statements ARE read in date order, but `--llm` and a
 * single-file re-run both bypass that ordering, and a 2016 re-read must not
 * overwrite a 2026 rating with a decade-old one. The name-healing rule above
 * learned this the expensive way: first-seen-wins named FLDR after a collateral
 * line while six later statements had it right.
 *
 * `<=` rather than `<` so re-reading the SAME statement still repairs a row a
 * fixed parser now reads better.
 */
async function upsertBondTerms(securityId, asOf, t) {
  if (!t) return;
  const { rowCount } = await db.query(`
    INSERT INTO security_bond_terms
      (security_id, as_of, maturity_date, next_call_date, coupon_rate,
       coupon_type, payment_frequency, moodys_rating, sp_rating, fdic_insured, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'statement')
    ON CONFLICT (security_id) DO UPDATE SET
      as_of = EXCLUDED.as_of,
      maturity_date = EXCLUDED.maturity_date,
      next_call_date = EXCLUDED.next_call_date,
      coupon_rate = EXCLUDED.coupon_rate,
      coupon_type = EXCLUDED.coupon_type,
      payment_frequency = EXCLUDED.payment_frequency,
      moodys_rating = EXCLUDED.moodys_rating,
      sp_rating = EXCLUDED.sp_rating,
      fdic_insured = EXCLUDED.fdic_insured,
      updated_at = now()
    WHERE security_bond_terms.as_of <= EXCLUDED.as_of`,
  [securityId, asOf, t.maturity_date, t.next_call_date, t.coupon_rate,
    t.coupon_type, t.payment_frequency, t.moodys_rating, t.sp_rating, t.fdic_insured]);
  termsWritten += rowCount;
}

/**
 * The first date fin has any record of this account.
 *
 * ⚠️ Load-bearing. fin's Fidelity Bond account has no transaction before
 * 2024-06-06, yet the custodian account mapped to it has statements back to
 * 2016 — so a naive comparison reported a **-$999,453 (-100%) drift** on dates
 * where fin simply had no record. That is not fin disagreeing with the
 * custodian; it is the account not existing yet in fin, and the money living
 * under a different fin account in that era.
 *
 * "fin has no record" and "fin says zero" are different claims, and only the
 * second is drift.
 */
async function firstRecordedOn(accountId) {
  const { rows } = await db.query(
    'SELECT min(transaction_date)::text AS d FROM transactions WHERE account_id = $1', [accountId]);
  return rows[0] && rows[0].d ? rows[0].d : null;
}

/** What fin's balance sheet said this account was worth on that date. */
async function ledgerBalanceOn(accountId, date) {
  const { rows } = await db.query(`
    SELECT (a.opening_balance + COALESCE(SUM(t.amount),0))::numeric(18,4)::text AS bal
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
       AND t.transaction_date <= $2::date AND t.transaction_date >= a.opening_balance_date
     WHERE a.id = $1 GROUP BY a.id, a.opening_balance`, [accountId, date]);
  return rows.length ? Number(rows[0].bal) : null;
}

async function main() {
  const list = files.length
    ? files
    : fs.readdirSync(path.join(__dirname, '..', 'Samples', 'Fidelity'))
      .filter((f) => f.endsWith('.pdf'))
      // ⚠️ Chronological, not readdir order (which is not sorted at all). The
      // name a security ends up with depends on the order statements are read,
      // and `FA_`/`FS_` interleave in time while sorting apart alphabetically.
      .sort((x, y) => {
        const k = (f) => (f.match(/(\d{4})_(\d{2})/) || ['', '0', '0']).slice(1).join('');
        return k(x).localeCompare(k(y)) || x.localeCompare(y);
      })
      .map((f) => path.join('Samples', 'Fidelity', f));

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${list.length} statement file(s)\n`);

  const cache = new Map();
  const firstSeen = new Map();
  const drift = [];
  const stats = { files: 0, accounts: 0, ingested: 0, skipped_unreconciled: 0, llm_substituted: 0, unmapped: new Set(), positions: 0, unresolved: 0, merged_lines: 0 };

  for (const f of list) {
    let parsed;
    try { parsed = parseFile(f); } catch (err) {
      console.error(`🔴 ${path.basename(f)}: ${err.message}`);
      continue;
    }
    stats.files += 1;

    for (const a of parsed.accounts) {
      stats.accounts += 1;
      const accountId = ACCOUNT_MAP[a.account_number];
      if (!accountId) { stats.unmapped.add(a.account_number); continue; }

      // Owner decision 2026-09-04: only a statement whose every section ties to
      // its own printed subtotal is ingested. One that does not is left absent —
      // unless the LLM sidecar carries an extraction that DID tie, which is the
      // same condition met by a different reader.
      const sub = llmByAccount.get(`${path.basename(f)}|${a.account_number}`);
      if (!a.reconciles && !sub) { stats.skipped_unreconciled += 1; continue; }
      if (!a.reconciles) stats.llm_substituted += 1;

      // ⚠️ Take the TOTAL from the sidecar too, never from `a`. The parser's
      // `total_market_value` is the sum of the rows IT read, and on a statement
      // it could not reconcile those rows are precisely what is wrong: on
      // FA_2025_12 it read Corporate Bonds as 4,266.62 against a printed
      // 309,149.26. Using it would book a snapshot $305k short and report the
      // gap as fin/custodian drift.
      const positions = sub ? sub.positions : a.positions;
      const totalMv = sub ? sub.total_market_value : a.total_market_value;

      if (!firstSeen.has(accountId)) firstSeen.set(accountId, await firstRecordedOn(accountId));
      const first = firstSeen.get(accountId);
      const inFinEra = first !== null && a.as_of >= first;
      const ledger = inFinEra ? await ledgerBalanceOn(accountId, a.as_of) : null;
      drift.push({
        date: a.as_of,
        account_id: accountId,
        statement: totalMv,
        ledger,
        // No comparison outside fin's own record for the account. Reporting a
        // drift there would be measuring fin against a period it never claimed.
        drift: inFinEra && ledger !== null ? Number((ledger - totalMv).toFixed(2)) : null,
        no_fin_record: !inFinEra,
      });

      // ⚠️ A security can appear on the SAME statement TWICE, and both lines are
      // real. Fidelity prints separate lines for separate lots: FA_2020_12 lists
      // FSMAX at 30.709 units / $2,563.59 and again at 231.41 / $19,318.11, same
      // $83.48 price, and the section subtotal contains both.
      //
      // `security_positions` is UNIQUE (snapshot_id, security_id), so the insert's
      // ON CONFLICT DO UPDATE **overwrote** the first line with the second and the
      // money on it simply vanished — 11 account-statements affected, and the
      // header still read right because `sum_market_value` is the statement's own
      // printed total. Rows that do not add up to a header that does is the same
      // shape as the name defect: the check that exists reads the column that is
      // correct.
      //
      // Two lots of one holding ARE one position, so they are summed here rather
      // than fought over by the database.
      const merged = new Map();
      for (const p of positions) {
        const securityId = await resolveSecurity(p, cache);
        if (!securityId) { stats.unresolved += 1; continue; }
        const prev = merged.get(securityId);
        if (!prev) { merged.set(securityId, { ...p, securityId, lines: 1 }); continue; }
        prev.lines += 1;
        prev.quantity = Number(prev.quantity || 0) + Number(p.quantity || 0);
        prev.market_value = Number(prev.market_value || 0) + Number(p.market_value || 0);
        prev.cost_basis = prev.cost_basis === null && p.cost_basis === null
          ? null : Number(prev.cost_basis || 0) + Number(p.cost_basis || 0);
        // Lots of one security are priced identically. If they ever are not,
        // derive the price rather than keep an arbitrary one of the two.
        if (Number(prev.price) !== Number(p.price)) {
          prev.price = prev.quantity ? Number((prev.market_value / prev.quantity).toFixed(8)) : prev.price;
        }
      }

      stats.merged_lines += positions.length - merged.size;
      if (!APPLY || REPORT_ONLY) { stats.ingested += 1; stats.positions += merged.size; continue; }

      const { rows } = await db.query(`
        INSERT INTO security_position_snapshots
          (account_id, polled_on, valued_on, source, status, custodian_balance,
           positions_count, sum_market_value, raw)
        VALUES ($1,$2,$2,$3,'fetched',$4,$5,$4,$6)
        ON CONFLICT (account_id, polled_on, source)
        DO UPDATE SET valued_on = EXCLUDED.valued_on,
                      custodian_balance = EXCLUDED.custodian_balance,
                      positions_count = EXCLUDED.positions_count,
                      sum_market_value = EXCLUDED.sum_market_value,
                      -- Provenance has to be refreshed too. Without this an
                      -- existing snapshot re-read by a different extractor kept
                      -- its OLD raw column: two of the four LLM statements landed
                      -- with rows replaced and no record of what produced them.
                      raw = EXCLUDED.raw,
                      fetched_at = NOW()
        RETURNING id`,
      // ⚠️ polled_on AND valued_on both get the statement's period end. Unlike
      // the feed, a statement states the date its figures are true for.
      // positions_count is the number of rows actually WRITTEN, not the number of
      // lines the statement printed — a header that cannot disagree with its rows.
      [accountId, a.as_of, SOURCE, totalMv, merged.size,
        // Provenance is recorded per snapshot: which reader produced these rows,
        // and on which tier. A row that came from a model must be answerable for
        // later without re-deriving it.
        JSON.stringify({
          file: parsed.file,
          account_number: a.account_number,
          statement_lines: positions.length,
          extractor: sub ? { kind: 'llm', ...sub.extractor } : { kind: 'parser' },
        })]);
      const snapshotId = rows[0].id;

      await db.query('DELETE FROM security_positions WHERE snapshot_id = $1', [snapshotId]);


      for (const p of merged.values()) {
        const securityId = p.securityId;
        const { rows: sec } = await db.query('SELECT price_basis FROM securities WHERE id = $1', [securityId]);
        await db.query(`
          INSERT INTO security_positions
            (snapshot_id, account_id, security_id, quantity, price, price_basis,
             price_source, market_value, cost_basis, currency, raw)
          VALUES ($1,$2,$3,$4,$5,$6,'custodian',$7,$8,'USD',$9)
          ON CONFLICT (snapshot_id, security_id) DO UPDATE
            SET quantity = EXCLUDED.quantity, price = EXCLUDED.price,
                market_value = EXCLUDED.market_value, cost_basis = EXCLUDED.cost_basis`,
        [snapshotId, accountId, securityId, p.quantity, p.price,
          sec[0] ? sec[0].price_basis : null, p.market_value, p.cost_basis,
          JSON.stringify({ symbol: p.symbol, section: p.section, lines: p.lines })]);
        // Terms belong to the INSTRUMENT, not to this snapshot, so they are
        // written once per security rather than per position row.
        await upsertBondTerms(securityId, a.as_of, p.terms);
        stats.positions += 1;
      }
      stats.ingested += 1;
    }
  }

  console.log(`statements parsed: ${stats.files} · account-statements: ${stats.accounts}`);
  console.log(`${APPLY && !REPORT_ONLY ? 'ingested' : 'would ingest'}: ${stats.ingested}  ·  positions: ${stats.positions}`);
  console.log(`skipped (did not reconcile): ${stats.skipped_unreconciled}`);
  if (termsWritten) {
    console.log(`bond terms written/refreshed: ${termsWritten}`
      + ' — rating, coupon, maturity and payment frequency, read from the statements themselves');
  }
  if (stats.merged_lines) {
    console.log(`merged ${stats.merged_lines} duplicate lot line(s) into their security`
      + ' — Fidelity prints one line per lot and both belong to the section subtotal');
  }
  if (stats.unresolved) console.log(`⚠️ ${stats.unresolved} position(s) had no usable symbol and were NOT stored`);
  if (stats.llm_substituted) {
    console.log(`LLM-extracted (parser could not reconcile; every printed subtotal tied): ${stats.llm_substituted}`);
  } else if (LLM_FILE) {
    console.log(`⚠️ --llm ${LLM_FILE} matched no account-statement — check the file names in it`);
  }
  if (healed.size) console.log(`updated ${healed.size} security name(s) to what the most recent statement calls them`);
  if (stats.unmapped.size) {
    console.log(`\n⚠️ ${stats.unmapped.size} account number(s) are not in the pinned map and were REFUSED,`);
    console.log('   not guessed — assigning by closest balance would hide the very drift this measures:');
    for (const u of stats.unmapped) console.log(`     ${u}`);
  }

  // ---- the deliverable ----
  console.log('\n──── DRIFT: fin\'s ledger vs the custodian statement ────');
  console.log('(positive = fin thought the account was worth MORE than the statement says)\n');
  const byAccount = new Map();
  for (const d of drift) {
    if (!byAccount.has(d.account_id)) byAccount.set(d.account_id, []);
    byAccount.get(d.account_id).push(d);
  }
  const names = Object.fromEntries((await db.query(
    'SELECT id, name FROM accounts WHERE id = ANY($1::int[])',
    [[...byAccount.keys()]],
  )).rows.map((r) => [r.id, r.name]));

  for (const [acct, rowsFor] of [...byAccount.entries()].sort()) {
    rowsFor.sort((x, y) => x.date.localeCompare(y.date));
    const material = rowsFor.filter((r) => r.drift !== null && Math.abs(r.drift) >= 1);
    const noRecord = rowsFor.filter((r) => r.no_fin_record);
    const compared = rowsFor.length - noRecord.length;
    console.log(`${names[acct] || acct}  (${compared} of ${rowsFor.length} dates comparable, ${material.length} with drift ≥ $1)`);
    if (noRecord.length) {
      console.log(`   ⚠️ ${noRecord.length} statement date(s) predate fin's first record for this account`
        + ` (${noRecord[0].date}..${noRecord[noRecord.length - 1].date}) — NOT drift, and not compared.`);
      console.log('      The custodian account existed; in fin its value sat under a different account then.');
    }
    for (const r of material.slice(-8)) {
      const pctOf = r.statement ? (100 * r.drift / r.statement).toFixed(2) : '—';
      console.log(`   ${r.date}  statement ${String(r.statement.toFixed(2)).padStart(14)}`
        + `  ledger ${String(r.ledger.toFixed(2)).padStart(14)}`
        + `  drift ${String(r.drift.toFixed(2)).padStart(13)}  (${pctOf}%)`);
    }
    if (material.length > 8) console.log(`   … and ${material.length - 8} earlier date(s)`);
    if (!material.length && compared) console.log(`   ✓ all ${compared} comparable date(s) tie within $1`);
  }

  /**
   * The integrity check that did not exist, and whose absence let a real defect
   * live: `sum_market_value` is the statement's own printed total, so the header
   * stayed correct while the rows beneath it lost money to an ON CONFLICT that
   * overwrote one lot with another. A header that cannot disagree with its rows
   * has to be asserted, because nothing else reads both.
   */
  if (APPLY && !REPORT_ONLY) {
    const { rows: bad } = await db.query(`
      SELECT s.id, a.name, s.valued_on, s.positions_count, s.sum_market_value,
             COUNT(p.id) AS actual_rows,
             COALESCE(SUM(p.market_value), 0) AS rows_sum
        FROM security_position_snapshots s
        JOIN accounts a ON a.id = s.account_id
        LEFT JOIN security_positions p ON p.snapshot_id = s.id
       WHERE s.source = $1
       GROUP BY s.id, a.name, s.valued_on, s.positions_count, s.sum_market_value
      HAVING COUNT(p.id) <> s.positions_count
          OR ABS(COALESCE(SUM(p.market_value), 0) - s.sum_market_value) >= 0.02
       ORDER BY s.valued_on`, [SOURCE]);
    if (!bad.length) {
      console.log('\n✓ every statement snapshot: stored rows match positions_count AND sum to sum_market_value');
    } else {
      console.log(`\n🔴 ${bad.length} snapshot(s) whose rows do not reconcile with their own header:`);
      for (const b of bad.slice(0, 10)) {
        console.log(`   ${b.name} ${b.valued_on}  header ${b.positions_count} rows / ${b.sum_market_value}`
          + `  ·  stored ${b.actual_rows} rows / ${Number(b.rows_sum).toFixed(2)}`);
      }
    }
  }

  if (!APPLY) console.log('\nDRY RUN — nothing was written. Re-run with --apply.');
  await db.close();
}

main().catch(async (e) => { console.error(e); try { await db.close(); } catch { /* closing */ } process.exit(2); });
