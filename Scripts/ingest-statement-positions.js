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
const files = args.filter((a) => !a.startsWith('--'));

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

async function resolveSecurity(position, cache) {
  const symbol = String(position.symbol || '').trim();
  if (!symbol) return null;
  if (cache.has(symbol)) return cache.get(symbol);

  const existing = await db.query(`
    SELECT s.id, s.name FROM security_source_mappings m
      JOIN securities s ON s.id = m.security_id
     WHERE m.source = 'fintable' AND m.external_name = $1`, [symbol]);
  if (existing.rows.length) {
    await healName(db, existing.rows[0], symbol, position);
    cache.set(symbol, existing.rows[0].id); return existing.rows[0].id;
  }

  const stmt = await db.query(`
    SELECT s.id, s.name FROM security_source_mappings m
      JOIN securities s ON s.id = m.security_id
     WHERE m.source = $1 AND m.external_name = $2`, [SOURCE, symbol]);
  if (stmt.rows.length) {
    await healName(db, stmt.rows[0], symbol, position);
    cache.set(symbol, stmt.rows[0].id); return stmt.rows[0].id;
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
  cache.set(symbol, rows[0].id);
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
  return !n || n === symbol || FURNITURE_IN_NAME.test(n) || !/^[A-Za-z]/.test(n);
}

let healed = 0;
async function healName(db, row, symbol, position) {
  const better = String(position.description || '').trim();
  if (!better || nameLooksWrong(better, symbol)) return;
  if (!nameLooksWrong(row.name, symbol)) return;
  await db.query('UPDATE securities SET name = $2, updated_at = now() WHERE id = $1', [row.id, better]);
  healed += 1;
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
      .map((f) => path.join('Samples', 'Fidelity', f));

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${list.length} statement file(s)\n`);

  const cache = new Map();
  const firstSeen = new Map();
  const drift = [];
  const stats = { files: 0, accounts: 0, ingested: 0, skipped_unreconciled: 0, unmapped: new Set(), positions: 0 };

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
      // its own printed subtotal is ingested. One that does not is left absent.
      if (!a.reconciles) { stats.skipped_unreconciled += 1; continue; }

      if (!firstSeen.has(accountId)) firstSeen.set(accountId, await firstRecordedOn(accountId));
      const first = firstSeen.get(accountId);
      const inFinEra = first !== null && a.as_of >= first;
      const ledger = inFinEra ? await ledgerBalanceOn(accountId, a.as_of) : null;
      drift.push({
        date: a.as_of,
        account_id: accountId,
        statement: a.total_market_value,
        ledger,
        // No comparison outside fin's own record for the account. Reporting a
        // drift there would be measuring fin against a period it never claimed.
        drift: inFinEra && ledger !== null ? Number((ledger - a.total_market_value).toFixed(2)) : null,
        no_fin_record: !inFinEra,
      });

      if (!APPLY || REPORT_ONLY) { stats.ingested += 1; stats.positions += a.positions.length; continue; }

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
                      fetched_at = NOW()
        RETURNING id`,
      // ⚠️ polled_on AND valued_on both get the statement's period end. Unlike
      // the feed, a statement states the date its figures are true for.
      [accountId, a.as_of, SOURCE, a.total_market_value, a.positions.length,
        JSON.stringify({ file: parsed.file, account_number: a.account_number })]);
      const snapshotId = rows[0].id;

      await db.query('DELETE FROM security_positions WHERE snapshot_id = $1', [snapshotId]);
      for (const p of a.positions) {
        const securityId = await resolveSecurity(p, cache);
        if (!securityId) continue;
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
          JSON.stringify({ symbol: p.symbol, section: p.section })]);
        stats.positions += 1;
      }
      stats.ingested += 1;
    }
  }

  console.log(`statements parsed: ${stats.files} · account-statements: ${stats.accounts}`);
  console.log(`${APPLY && !REPORT_ONLY ? 'ingested' : 'would ingest'}: ${stats.ingested}  ·  positions: ${stats.positions}`);
  console.log(`skipped (did not reconcile): ${stats.skipped_unreconciled}`);
  if (healed) console.log(`repaired ${healed} security name(s) that held statement furniture or the bare symbol`);
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

  if (!APPLY) console.log('\nDRY RUN — nothing was written. Re-run with --apply.');
  await db.close();
}

main().catch(async (e) => { console.error(e); try { await db.close(); } catch { /* closing */ } process.exit(2); });
