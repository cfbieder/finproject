#!/usr/bin/env node
/**
 * load-bank-statement.js — CR019 cutover helper
 *
 * Rebuilds an account's pre-cutoff history from an authoritative PKO bank-statement
 * export (.xls with a running-balance "Saldo po transakcji" column) instead of a
 * Quicken QIF, for accounts where Quicken proved incomplete/wrong (e.g. PKO Savings
 * had +600k of phantom inflows). Bank running balances give an exact curve.
 *
 * What it does (inside ONE transaction when --apply):
 *   1. (optional) removes a superseded quicken-import batch's rows on the account
 *      (--drop-quicken-batch <uuid>): deletes its transactions on this account +
 *      its quicken_calibration_audit row + marks the batch rolled_back.
 *   2. deletes any prior rows from THIS loader (source='bank-statement',
 *      import_batch_id=BATCH) on the account — idempotent re-run.
 *   3. inserts the statement's rows dated < cutoff, categorized by Polish "Typ
 *      transakcji", with base_amount via budget_fx_rates(currency,year,month).
 *   4. sets accounts.opening_balance = TARGET − Σ(all account tx) so today's
 *      computed balance == TARGET (default: latest bankfeed_balances for the
 *      account's bank-feed mapping; override with --target <num>).
 *   5. asserts computed == TARGET (±0.01) else throws → whole tx rolls back.
 *
 * Dry-run by default; pass --apply to write. All account/category resolution is
 * BY NAME (prod ids differ from dev).
 *
 * Usage (inside fin-server, which has xlsx + pg + prod DATABASE_URL):
 *   node src/v2/scripts/load-bank-statement.js \
 *     --file /tmp/pko_sav.xls --account 19 --cutoff 2022-12-01 --currency PLN \
 *     --batch c0ffee19-0000-4000-8000-000000000019 \
 *     --drop-quicken-batch 3ef9c988-eab8-44e2-b3be-193e0207f5ce [--target 122767.61] [--apply]
 */
const XLSX = require('xlsx');
const { Client } = require('pg');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}

const FILE = arg('file');
const ACCOUNT = parseInt(arg('account'), 10);
const CUTOFF = arg('cutoff');                 // 'YYYY-MM-DD', rows with date < CUTOFF are loaded
const CURRENCY = arg('currency', 'PLN');
const BATCH = arg('batch');                    // fixed uuid → idempotent
const DROP_QK = arg('drop-quicken-batch', null);
const TARGET_OVERRIDE = arg('target', null);
const APPLY = arg('apply', false) === true;
const SOURCE = 'bank-statement';

// Polish "Typ transakcji" → COA leaf name (resolved to id by name at runtime)
const TYPE_TO_CAT = {
  'Naliczenie odsetek': 'Interest Income',
  'Podatek od odsetek': 'Interest Income',   // interest withholding → net into interest income
  'Opłata': 'Bank Fees',
  'Przelew z rachunku': 'Transfer - Historical',
  'Przelew na konto': 'Transfer - Historical',
  'Przelew podatkowy': 'Taxes',
};

function num(s) { return parseFloat(String(s).replace(/[+\s]/g, '').replace(/ /g, '')); }

function readStatement() {
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets['Lista transakcji'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).slice(1).filter(r => r[0]);
  // columns: 0 Data operacji, 2 Typ, 3 Kwota, 5 Saldo po transakcji, 12 Opis
  return rows.map(r => ({
    date: String(r[0]).slice(0, 10),
    amount: num(r[3]),
    saldo: num(r[5]),
    typ: String(r[2] || '').trim(),
    desc: String(r[12] || '').trim(),
  })).filter(r => Number.isFinite(r.amount));
}

(async () => {
  if (!FILE || !ACCOUNT || !CUTOFF || !BATCH) {
    console.error('missing required arg (--file --account --cutoff --batch)'); process.exit(1);
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    // --- resolve categories by name ---
    const wantCats = [...new Set(Object.values(TYPE_TO_CAT))];
    const catRes = await db.query('SELECT id, name FROM accounts WHERE name = ANY($1)', [wantCats]);
    const catId = {};
    for (const name of wantCats) {
      const hits = catRes.rows.filter(r => r.name === name);
      if (hits.length !== 1) throw new Error(`category '${name}' resolved to ${hits.length} rows (need exactly 1)`);
      catId[name] = hits[0].id;
    }

    // --- FX map ---
    const fxRes = await db.query('SELECT year, month, rate FROM budget_fx_rates WHERE currency=$1', [CURRENCY]);
    const fx = {};
    for (const r of fxRes.rows) fx[`${r.year}-${r.month}`] = parseFloat(r.rate);

    // --- read + filter statement ---
    const stmt = readStatement().filter(r => r.date < CUTOFF);
    const sumAmt = +stmt.reduce((s, r) => s + r.amount, 0).toFixed(2);
    const finalSaldo = stmt.length ? stmt.reduce((a, b) => (a.date > b.date ? a : b)).saldo : null;

    // category + base_amount per row
    const byCat = {};
    let missingFx = new Set(), unmapped = new Set();
    for (const r of stmt) {
      const cname = TYPE_TO_CAT[r.typ];
      if (!cname) unmapped.add(r.typ);
      r.category_id = cname ? catId[cname] : null;
      const [y, m] = [r.date.slice(0, 4), parseInt(r.date.slice(5, 7), 10)];
      const rate = fx[`${y}-${m}`];
      if (!rate) missingFx.add(`${y}-${m}`);
      r.base_amount = rate ? +(r.amount / rate).toFixed(2) : null;
      const k = cname || `(UNMAPPED:${r.typ})`;
      byCat[k] = byCat[k] || { n: 0, s: 0 };
      byCat[k].n++; byCat[k].s += r.amount;
    }
    if (unmapped.size) throw new Error('unmapped transaction types: ' + [...unmapped].join(', '));
    if (missingFx.size) throw new Error('missing FX rates for: ' + [...missingFx].join(', '));

    // --- target (feed balance) ---
    let target;
    if (TARGET_OVERRIDE) target = parseFloat(TARGET_OVERRIDE);
    else {
      const fm = await db.query(`SELECT external_name FROM account_source_mappings WHERE account_id=$1 AND source='bank-feed' LIMIT 1`, [ACCOUNT]);
      if (!fm.rows.length) throw new Error('no bank-feed mapping; pass --target');
      const bal = await db.query(`SELECT balance FROM bankfeed_balances WHERE feed_account_external_id=$1 ORDER BY balance_date DESC LIMIT 1`, [fm.rows[0].external_name]);
      if (!bal.rows.length) throw new Error('no bankfeed_balances; pass --target');
      target = parseFloat(bal.rows[0].balance);
    }

    // --- projection ---
    const otherSumRes = await db.query(
      `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE account_id=$1 AND source<>$2 AND NOT (source='quicken-import' AND import_batch_id=$3)`,
      [ACCOUNT, SOURCE, DROP_QK]);
    const otherSum = parseFloat(otherSumRes.rows[0].s);
    const newTxSum = +(otherSum + sumAmt).toFixed(2);
    const opening = +(target - newTxSum).toFixed(2);

    console.log(`\n=== load-bank-statement ${APPLY ? '(APPLY)' : '(DRY-RUN)'} acct ${ACCOUNT} ===`);
    console.log(`statement rows < ${CUTOFF}: ${stmt.length} | Σamount ${sumAmt} | final saldo ${finalSaldo}`);
    console.log('category breakdown:');
    for (const [c, v] of Object.entries(byCat)) console.log(`   ${c.padEnd(24)} ${v.n} rows  Σ ${v.s.toFixed(2)}`);
    if (DROP_QK) console.log(`drop quicken batch: ${DROP_QK}`);
    console.log(`other-source Σ (kept) ${otherSum} | new total Σ ${newTxSum}`);
    console.log(`target (current) ${target} | opening_balance := ${opening}`);
    console.log(`projected computed = ${(opening + newTxSum).toFixed(2)} (must == ${target})`);

    if (!APPLY) { console.log('\nDRY-RUN — no writes. Re-run with --apply.'); await db.end(); return; }

    await db.query('BEGIN');
    // 1. drop superseded quicken batch on this account
    if (DROP_QK) {
      const d = await db.query(`DELETE FROM transactions WHERE account_id=$1 AND source='quicken-import' AND import_batch_id=$2`, [ACCOUNT, DROP_QK]);
      await db.query(`DELETE FROM quicken_calibration_audit WHERE import_batch_id=$1 AND account_id=$2`, [DROP_QK, ACCOUNT]);
      await db.query(`UPDATE quicken_import_batches SET status='rolled_back', rolled_back_at=NOW(), updated_at=NOW() WHERE id=$1`, [DROP_QK]);
      console.log(`removed ${d.rowCount} quicken rows on acct ${ACCOUNT}; batch marked rolled_back`);
    }
    // 2. idempotent: clear prior loader rows (source-keyed; import_batch_id FK only allows quicken batches → NULL here)
    await db.query(`DELETE FROM transactions WHERE account_id=$1 AND source=$2`, [ACCOUNT, SOURCE]);
    // 3. insert (import_batch_id NULL; reversal = DELETE WHERE account_id AND source='bank-statement')
    for (const r of stmt) {
      await db.query(
        `INSERT INTO transactions (transaction_date, description1, description2, amount, currency, base_amount, base_currency,
           transaction_type, account_id, closing_balance, category_id, source, accepted)
         VALUES ($1,$2,$3,$4,$5,$6,'USD',$7,$8,$9,$10,$11,TRUE)`,
        [r.date, r.desc.slice(0, 500), r.typ.slice(0, 500), r.amount, CURRENCY, r.base_amount, r.typ.slice(0, 50),
         ACCOUNT, r.saldo, r.category_id, SOURCE]);
    }
    // 4. set opening
    await db.query(`UPDATE accounts SET opening_balance=$1 WHERE id=$2`, [opening, ACCOUNT]);
    // 5. verify
    const chk = await db.query(`SELECT (opening_balance + COALESCE((SELECT SUM(amount) FROM transactions WHERE account_id=$1),0)) c FROM accounts WHERE id=$1`, [ACCOUNT]);
    const computed = +parseFloat(chk.rows[0].c).toFixed(2);
    if (Math.abs(computed - target) > 0.01) { await db.query('ROLLBACK'); throw new Error(`verify FAILED: computed ${computed} != target ${target}`); }
    await db.query('COMMIT');
    console.log(`\nAPPLIED. inserted ${stmt.length} rows; computed today = ${computed} == target ${target} ✓`);
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('ERROR:', e.message); process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
