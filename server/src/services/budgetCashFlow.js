'use strict';
/**
 * The budget builder's Cash Flow by currency — CR104.
 *
 * For one build, per currency (USD, PLN, EUR — never added together), a monthly roll-forward of the
 * build's cells in two BLOCKS:
 *   - Cash        — every account under `Bank Accounts` and the two credit-card parents (cards net in:
 *                   a card balance owed is negative, the same sign as an overdrawn bank account);
 *   - Investments — every account under the brokerage parents.
 * Opening + inflows − outflows (+ Unassigned, Cash only) ± what-if transfers = ending, month by month.
 * A cell on an account in neither block is an OTHER account (Tax Liabilities, property, mortgage):
 * shown per currency, counted in the reconciliation, in neither ending.
 *
 * Opening (Jan 1, D5): ledger balances on the build's source LE's `actual_through`, plus that LE's
 * months after it — each LE row split across accounts by the build's trailing-12 actual grid (LE rows
 * carry no account). One snapshot, so nothing is counted twice; an override per currency × block
 * (stored in `budget_build_cash_plan`) replaces the estimate.
 *
 * Items and moves (§10): every figure is returned with the items behind it, so the modal can say
 * what a number is. A MOVE (`budget_build_cash_moves`) puts one item — category × account × currency
 * × month — in the other block than its account's: where the money lands, never an amount, so a move
 * follows the line when the budget changes.
 *
 * Read-only on the budget: the plan never publishes (D1). Design: docs/cr/cr-104-budget-builder-cash-by-currency.md.
 */

const db = require('../v2/db');
const builder = require('./budgetBuilder');
const { treeBalancesAsOf } = require('../v2/repositories/accountBalances');

/** The root accounts of each block; every account under a root follows it (the sweep's own rule). */
const BLOCK_ROOTS = Object.freeze({
  cash: Object.freeze(['Bank Accounts', 'PLN Credit Cards', 'USD Credit Cards']),
  investments: Object.freeze(['Fidelity Fixed Income', 'Fidelity Stock', 'CVC Investments', 'PL Investments', 'US - Investments']),
});
const BLOCKS = ['cash', 'investments'];
const MODELLED = ['USD', 'PLN', 'EUR'];
const TRANSFER_MAX = 100;
const MOVE_MAX = 500;

const err = (status, message) => Object.assign(new Error(message), { status });
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const zeros = () => Array(12).fill(0);
const sum = (a) => round2(a.reduce((s, v) => s + v, 0));
const isoDate = (d) => String(d).slice(0, 10);

// ---------------------------------------------------------------------------
// The roll-forward — pure, so it is tested to the cent without a database
// ---------------------------------------------------------------------------

/**
 * @param balances   [{ id, currency, balance }] — block accounts at the snapshot date
 * @param blockOf    Map account id → 'cash' | 'investments'
 * @param remainder  [{ account_id, currency, amount }] — the LE's months after the snapshot, split
 * @param cells      [{ category_id, account_id, currency, month, amount }] — the build's cells
 * @param accountCurrency Map account id → its currency (for the mismatch list)
 * @param plan       [{ kind, currency, block, month, to_currency, to_block, amount, to_amount }]
 * @param moves      [{ category_id, account_id, currency, month, to_block }] — items placed in a block
 */
function rollForward({ balances, blockOf, remainder, cells, accountCurrency = new Map(), plan = [], moves = [] }) {
  const cur = new Map();
  const get = (c) => {
    if (!cur.has(c)) {
      const block = () => ({ balance: 0, remainder: 0, inflows: zeros(), outflows: zeros(), transfers: zeros() });
      cur.set(c, { cash: { ...block(), remainderUnassigned: 0, unassigned: zeros() }, investments: block(),
        items: [], openingItems: { cash: new Map(), investments: new Map() },
        other: zeros(), remainderOther: 0 });
    }
    return cur.get(c);
  };
  const place = (accountId) => (accountId == null ? 'unassigned' : blockOf.get(Number(accountId)) || 'other');
  const moveKey = (cat, acct, c, m) => `${Number(cat)}|${acct == null ? 0 : Number(acct)}|${c}|${Number(m)}`;
  const moved = new Map(moves.map((v) => [moveKey(v.category_id, v.account_id, v.currency, v.month), v.to_block]));
  const matchedMoves = new Set();
  // The opening's per-account pieces, for the modal's "what is this" on the Jan opening.
  const openingItem = (c, block, accountId) => {
    const byAcct = get(c).openingItems[block];
    const k = accountId == null ? 0 : Number(accountId);
    if (!byAcct.has(k)) byAcct.set(k, { accountId: accountId == null ? null : Number(accountId), balance: 0, remainder: 0 });
    return byAcct.get(k);
  };

  for (const b of balances) {
    if (!b.balance) continue;
    const block = blockOf.get(Number(b.id));
    get(b.currency)[block].balance = round2(get(b.currency)[block].balance + b.balance);
    const it = openingItem(b.currency, block, b.id);
    it.balance = round2(it.balance + b.balance);
  }
  for (const r of remainder) {
    const c = get(r.currency);
    const where = place(r.account_id);
    if (where === 'unassigned') c.cash.remainderUnassigned = round2(c.cash.remainderUnassigned + r.amount);
    else if (where === 'other') c.remainderOther = round2(c.remainderOther + r.amount);
    else c[where].remainder = round2(c[where].remainder + r.amount);
    if (where !== 'other') {
      const it = openingItem(r.currency, where === 'unassigned' ? 'cash' : where, r.account_id);
      it.remainder = round2(it.remainder + r.amount);
    }
  }

  const mismatch = new Map();
  for (const cell of cells) {
    const amount = Number(cell.amount);
    const c = get(cell.currency);
    const m = Number(cell.month) - 1;
    const natural = place(cell.account_id);
    const key = moveKey(cell.category_id, cell.account_id, cell.currency, cell.month);
    // A No-account item already counts in Cash, so a move there is a move to its own block: it moves
    // nothing, and is listed as such rather than shown as applied.
    const own = natural === 'unassigned' ? 'cash' : natural;
    const movedTo = moved.has(key) && moved.get(key) !== own ? moved.get(key) : null;
    if (movedTo) matchedMoves.add(key);
    const where = movedTo || natural;
    let row;
    if (where === 'unassigned') { row = 'unassigned'; c.cash.unassigned[m] = round2(c.cash.unassigned[m] + amount); }
    else if (where === 'other') { row = 'other'; c.other[m] = round2(c.other[m] + amount); }
    else if (amount >= 0) { row = 'inflows'; c[where].inflows[m] = round2(c[where].inflows[m] + amount); }
    else { row = 'outflows'; c[where].outflows[m] = round2(c[where].outflows[m] + amount); }
    c.items.push({ categoryId: cell.category_id == null ? null : Number(cell.category_id),
      accountId: cell.account_id == null ? null : Number(cell.account_id), month: m + 1, amount: round2(amount),
      block: where === 'unassigned' ? 'cash' : (where === 'other' ? null : where), row,
      natural: natural === 'unassigned' ? 'cash' : (natural === 'other' ? null : natural), moved: !!movedTo });
    const acctCur = cell.account_id == null ? null : accountCurrency.get(Number(cell.account_id));
    if (acctCur && acctCur !== cell.currency) {
      const key = `${cell.currency}|${acctCur}`;
      const row = mismatch.get(key) || { currency: cell.currency, accountCurrency: acctCur, cells: 0, amount: 0 };
      row.cells += 1;
      row.amount = round2(row.amount + amount);
      mismatch.set(key, row);
    }
  }

  const overrides = new Map();
  for (const p of plan) {
    if (p.kind === 'opening') overrides.set(`${p.currency}|${p.block}`, Number(p.amount));
    if (p.kind !== 'transfer') continue;
    const m = Number(p.month) - 1;
    const from = get(p.currency)[p.block];
    const to = get(p.to_currency)[p.to_block];
    from.transfers[m] = round2(from.transfers[m] - Number(p.amount));
    to.transfers[m] = round2(to.transfers[m] + Number(p.to_amount));
  }

  const finish = (c, block, raw) => {
    const estimate = round2(raw.balance + raw.remainder + (raw.remainderUnassigned || 0));
    const key = `${c}|${block}`;
    const opening = overrides.has(key) ? overrides.get(key) : estimate;
    const ending = [];
    let run = opening;
    for (let m = 0; m < 12; m++) {
      run = round2(run + raw.inflows[m] + raw.outflows[m] + (raw.unassigned ? raw.unassigned[m] : 0) + raw.transfers[m]);
      ending.push(run);
    }
    const out = {
      opening: { value: opening, source: overrides.has(key) ? 'override' : 'estimate', estimate,
        balance: raw.balance, remainder: raw.remainder },
      inflows: raw.inflows, outflows: raw.outflows, transfers: raw.transfers, ending,
      year: { inflows: sum(raw.inflows), outflows: sum(raw.outflows), transfers: sum(raw.transfers),
        closing: ending[11] },
    };
    if (raw.unassigned) {
      out.unassigned = raw.unassigned;
      out.year.unassigned = sum(raw.unassigned);
      out.opening.remainderUnassigned = raw.remainderUnassigned;
    }
    return out;
  };

  const currencies = MODELLED.map((c) => {
    const raw = get(c);
    const cash = finish(c, 'cash', raw.cash);
    const investments = finish(c, 'investments', raw.investments);
    const shortMonths = cash.ending.map((v, m) => (v < 0 ? m + 1 : null)).filter(Boolean);
    const pieces = (block) => [...raw.openingItems[block].values()].filter((i) => i.balance || i.remainder);
    cash.opening.items = pieces('cash');
    investments.opening.items = pieces('investments');
    return {
      currency: c, cash, investments, items: raw.items,
      other: { months: raw.other, year: sum(raw.other), remainder: raw.remainderOther },
      short: shortMonths.length ? { months: shortMonths, lowest: Math.min(...cash.ending) } : null,
      flowTotal: round2(sum(cash.inflows) + sum(cash.outflows) + sum(cash.unassigned)
        + sum(investments.inflows) + sum(investments.outflows) + sum(raw.other)),
    };
  });
  const notModelled = [...cur.keys()].filter((c) => !MODELLED.includes(c)).map((c) => {
    const raw = cur.get(c);
    return { currency: c, cash: raw.cash.balance, investments: raw.investments.balance };
  }).filter((r) => r.cash || r.investments);
  const unmatchedMoves = moves.filter((v) => !matchedMoves.has(moveKey(v.category_id, v.account_id, v.currency, v.month)));
  return { currencies, notModelled, currencyMismatches: [...mismatch.values()], unmatchedMoves };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** The block accounts and their balances at `asOf`. A missing root fails loudly — never a smaller block. */
async function loadBlocks(client, roots, asOf) {
  const names = [...roots.cash, ...roots.investments];
  const rows = await treeBalancesAsOf(client, names, asOf);
  const missing = names.filter((n) => !rows.some((r) => r.root === n && r.name === n));
  if (missing.length) {
    throw err(500, `Cash flow: root account${missing.length > 1 ? 's' : ''} ${missing.map((n) => `'${n}'`).join(', ')} not found — update BLOCK_ROOTS in services/budgetCashFlow.js`);
  }
  const blockOf = new Map();
  const balances = [];
  for (const r of rows) {
    if (blockOf.has(r.id)) continue; // under two listed roots: counted once
    blockOf.set(r.id, roots.cash.includes(r.root) ? 'cash' : 'investments');
    if (!r.balance) continue;
    if (!r.currency) throw err(500, `Cash flow: account '${r.name}' has a balance but no currency`);
    balances.push({ id: r.id, currency: r.currency, balance: r.balance });
  }
  return { blockOf, balances };
}

/** The LE's months after its cut-off, split across accounts by the build's trailing-12 actual grid. */
async function loadRemainder(client, build) {
  const rows = (await client.query(
    `SELECT category_id, TRIM(currency) AS currency, SUM(amount) AS amount
       FROM budget_le_lines
      WHERE le_id = $1 AND category_id IS NOT NULL AND NOT (category_id = ANY($2::int[]))
        AND period_month > $3::date AND period_month < make_date($4::int + 1, 1, 1)
      GROUP BY 1, 2`,
    [build.source_le_id, build.excluded_category_ids || [], isoDate(build.actual_through), build.le_year]
  )).rows;
  if (!rows.length) return [];
  const { actual } = await builder.loadGrids(client, build);
  const out = [];
  for (const r of rows) {
    const amount = round2(r.amount);
    if (!amount) continue;
    const grid = actual.get(`${r.category_id}|${r.currency}`);
    const accounts = grid ? [...grid.keys()] : [];
    const weights = accounts.map((a) => Math.abs(grid.get(a).reduce((s, v) => s + v, 0)));
    if (!weights.some((w) => w > 0)) {
      out.push({ account_id: null, currency: r.currency, amount });
      continue;
    }
    builder.allocate(amount, weights).forEach((a, i) => {
      if (a) out.push({ account_id: accounts[i], currency: r.currency, amount: a });
    });
  }
  return out;
}

async function loadPlan(client, buildId) {
  return (await client.query(
    `SELECT id, kind, TRIM(currency) AS currency, block, month, TRIM(to_currency) AS to_currency, to_block,
            amount, rate, to_amount, note
       FROM budget_build_cash_plan WHERE build_id = $1 ORDER BY id`, [buildId]
  )).rows.map((p) => ({ ...p, amount: Number(p.amount), rate: p.rate == null ? null : Number(p.rate),
    to_amount: p.to_amount == null ? null : Number(p.to_amount) }));
}

async function loadMoves(client, buildId) {
  return (await client.query(
    `SELECT id, category_id, account_id, TRIM(currency) AS currency, month, to_block
       FROM budget_build_cash_moves WHERE build_id = $1 ORDER BY id`, [buildId]
  )).rows;
}

/** The modal's data for one build. `roots` is injectable for tests; production uses BLOCK_ROOTS. */
async function cashFlow(buildId, { roots = BLOCK_ROOTS } = {}) {
  const client = db;
  const build = await builder.getBuildRow(client, buildId);
  const view = await builder.getBuild(buildId, client);
  const asOf = isoDate(build.actual_through);
  const { blockOf, balances } = await loadBlocks(client, roots, asOf);
  const remainder = await loadRemainder(client, build);
  const { cells: rawCells } = await builder.cellsFor(client, build, view);
  const cells = rawCells.map((c) => ({ category_id: c.category_id, account_id: c.account_id, currency: String(c.currency).trim(),
    month: Number(c.month), amount: Number(c.amount) }));
  const ids = [...new Set(cells.map((c) => c.account_id).filter((a) => a != null))];
  const accountCurrency = new Map((await client.query(
    'SELECT id, TRIM(currency) AS currency FROM accounts WHERE id = ANY($1::int[])', [ids]
  )).rows.map((r) => [r.id, r.currency]));
  const plan = await loadPlan(client, buildId);
  const moves = await loadMoves(client, buildId);

  const { unmatchedMoves, ...result } = rollForward({ balances, blockOf, remainder, cells, accountCurrency, plan, moves });
  // Names for every category and account the items, openings and moves refer to.
  const nameIds = new Set();
  for (const c of result.currencies) {
    for (const i of c.items) { if (i.categoryId != null) nameIds.add(i.categoryId); if (i.accountId != null) nameIds.add(i.accountId); }
    for (const b of ['cash', 'investments']) for (const i of c[b].opening.items) if (i.accountId != null) nameIds.add(i.accountId);
  }
  for (const v of moves) { nameIds.add(Number(v.category_id)); if (v.account_id != null) nameIds.add(Number(v.account_id)); }
  const names = Object.fromEntries((await client.query(
    'SELECT id, name FROM accounts WHERE id = ANY($1::int[])', [[...nameIds]]
  )).rows.map((r) => [r.id, r.name]));
  const unmatched = new Set(unmatchedMoves.map((v) => v.id));
  // The reconciliation the page can see: each currency's cells against the build's own total
  // (computed separately, line by line). A mismatch means a cell was dropped or double-placed.
  for (const c of result.currencies) {
    // No line in this currency: the build's total is 0. A line with no figure yet: null — unknown, never 0.
    const total = c.currency in view.totals ? view.totals[c.currency] : 0;
    c.buildTotal = total;
    c.reconciled = total != null && Math.abs(c.flowTotal - total) < 0.005;
  }
  return {
    build: { id: build.id, targetYear: build.target_year, status: build.status, buildNo: build.build_no,
      note: build.note, editable: build.status === 'draft' },
    snapshot: { asOf, le: { id: build.source_le_id, name: build.le_name, actualThrough: asOf } },
    rates: Object.fromEntries(MODELLED.map((c) => [c, view.rates.fx[c]?.rate ?? null])),
    roots,
    ...result,
    unassignedLines: cells.filter((c) => c.account_id == null).length,
    names,
    plan: {
      openings: plan.filter((p) => p.kind === 'opening').map((p) => ({ currency: p.currency, block: p.block, amount: p.amount })),
      transfers: plan.filter((p) => p.kind === 'transfer').map((p) => ({
        id: p.id, month: p.month, fromCurrency: p.currency, fromBlock: p.block, toCurrency: p.to_currency,
        toBlock: p.to_block, amount: p.amount, rate: p.rate, toAmount: p.to_amount, note: p.note })),
      // A move whose item is gone (the line changed or lost that account) is listed, never silently kept.
      moves: moves.map((v) => ({ id: v.id, categoryId: Number(v.category_id),
        accountId: v.account_id == null ? null : Number(v.account_id), currency: v.currency, month: v.month,
        toBlock: v.to_block, matched: !unmatched.has(v.id) })),
    },
  };
}

// ---------------------------------------------------------------------------
// The plan — opening overrides and what-if transfers, on a draft only
// ---------------------------------------------------------------------------

/** A money amount: a finite number or a plain decimal string, at most two decimals. Never coerced. */
function money(raw, what) {
  let n;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim())) n = Number(raw.trim());
  else throw err(400, `${what} must be a number`);
  if (!Number.isFinite(n)) throw err(400, `${what} must be a number`);
  if (Math.abs(n - round2(n)) > 1e-9) throw err(400, `${what} can have at most two decimals`);
  if (Math.abs(n) >= 1e13) throw err(400, `${what} is too large`);
  return round2(n);
}

const pick = (v, allowed, what) => {
  if (!allowed.includes(v)) throw err(400, `${what} must be one of ${allowed.join(', ')}`);
  return v;
};

/**
 * Replace the build's openings and/or transfers (whichever the body carries). Body:
 *   { openings?: [{ currency, block, amount }], transfers?: [{ month, fromCurrency, fromBlock,
 *     toCurrency, toBlock, amount, rate?, note? }] }
 * A transfer's rate is to-per-from; omitted, it is the build's FX (local per USD) ratio, 1 within a
 * currency. `to_amount` is stored rounded to cents, so both sides reconcile with no residual.
 * `moves?: [{ categoryId, accountId (null = no account), currency, month, toBlock }]` replaces the
 * item moves (§10).
 */
async function savePlan(buildId, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw err(400, 'Body must be an object');
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!has('openings') && !has('transfers') && !has('moves')) throw err(400, 'Nothing to save: send openings, transfers and/or moves');

  return db.transaction(async (client) => {
    const build = await builder.getBuildRow(client, buildId, { lock: true });
    if (build.status !== 'draft') throw err(409, 'Only a draft’s cash plan can be edited');

    if (has('openings')) {
      if (!Array.isArray(body.openings)) throw err(400, 'openings must be a list');
      const seen = new Set();
      const rows = body.openings.map((o, i) => {
        if (!o || typeof o !== 'object') throw err(400, `Opening ${i + 1} must be an object`);
        const currency = pick(o.currency, MODELLED, 'Opening currency');
        const block = pick(o.block, BLOCKS, 'Opening block');
        const key = `${currency}|${block}`;
        if (seen.has(key)) throw err(400, `Two openings for ${currency} ${block}`);
        seen.add(key);
        return { currency, block, amount: money(o.amount, `Opening ${currency} ${block}`) };
      });
      await client.query(`DELETE FROM budget_build_cash_plan WHERE build_id = $1 AND kind = 'opening'`, [buildId]);
      for (const r of rows) {
        await client.query(
          `INSERT INTO budget_build_cash_plan (build_id, kind, currency, block, amount)
           VALUES ($1, 'opening', $2, $3, $4)`, [buildId, r.currency, r.block, r.amount]
        );
      }
    }

    if (has('transfers')) {
      if (!Array.isArray(body.transfers)) throw err(400, 'transfers must be a list');
      if (body.transfers.length > TRANSFER_MAX) throw err(400, `At most ${TRANSFER_MAX} transfers`);
      const rates = await builder.scenarioRates(build.scenario_name, build.target_year);
      const rows = body.transfers.map((t, i) => {
        const what = `Transfer ${i + 1}`;
        if (!t || typeof t !== 'object') throw err(400, `${what} must be an object`);
        const month = Number(t.month);
        if (!Number.isInteger(month) || month < 1 || month > 12) throw err(400, `${what}: month must be 1–12`);
        const fromCurrency = pick(t.fromCurrency, MODELLED, `${what}: from currency`);
        const fromBlock = pick(t.fromBlock, BLOCKS, `${what}: from`);
        const toCurrency = pick(t.toCurrency, MODELLED, `${what}: to currency`);
        const toBlock = pick(t.toBlock, BLOCKS, `${what}: to`);
        if (fromCurrency === toCurrency && fromBlock === toBlock) throw err(400, `${what}: from and to are the same`);
        const amount = money(t.amount, `${what}: amount`);
        if (!(amount > 0)) throw err(400, `${what}: amount must be above zero`);
        let rate;
        if (t.rate != null && t.rate !== '') {
          rate = typeof t.rate === 'number' ? t.rate
            : (typeof t.rate === 'string' && /^\d+(\.\d+)?$/.test(t.rate.trim()) ? Number(t.rate.trim()) : NaN);
          if (!Number.isFinite(rate) || rate <= 0) throw err(400, `${what}: rate must be a number above zero`);
        } else if (fromCurrency === toCurrency) {
          rate = 1;
        } else {
          const to = rates.fx[toCurrency]?.rate;
          const from = rates.fx[fromCurrency]?.rate;
          if (!to || !from) throw err(400, `${what}: the build has no ${!to ? toCurrency : fromCurrency} rate — type one`);
          rate = to / from;
        }
        rate = Math.round(rate * 1e6) / 1e6;
        if (!(rate > 0)) throw err(400, `${what}: rate rounds to zero`);
        if (rate >= 1e6) throw err(400, `${what}: rate is too large`);
        if (Math.abs(amount * rate) >= 1e13) throw err(400, `${what}: the amount arriving is too large`);
        const note = t.note == null ? null : String(t.note).slice(0, 200);
        return { month, fromCurrency, fromBlock, toCurrency, toBlock, amount, rate, toAmount: round2(amount * rate), note };
      });
      await client.query(`DELETE FROM budget_build_cash_plan WHERE build_id = $1 AND kind = 'transfer'`, [buildId]);
      for (const r of rows) {
        await client.query(
          `INSERT INTO budget_build_cash_plan
             (build_id, kind, currency, block, month, to_currency, to_block, amount, rate, to_amount, note)
           VALUES ($1, 'transfer', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [buildId, r.fromCurrency, r.fromBlock, r.month, r.toCurrency, r.toBlock, r.amount, r.rate, r.toAmount, r.note]
        );
      }
    }

    if (has('moves')) {
      if (!Array.isArray(body.moves)) throw err(400, 'moves must be a list');
      if (body.moves.length > MOVE_MAX) throw err(400, `At most ${MOVE_MAX} moves`);
      const id = (v) => (Number.isInteger(v) && v > 0 ? v : NaN);
      const seen = new Set();
      const rows = body.moves.map((v, i) => {
        const what = `Move ${i + 1}`;
        if (!v || typeof v !== 'object') throw err(400, `${what} must be an object`);
        const categoryId = id(v.categoryId);
        if (Number.isNaN(categoryId)) throw err(400, `${what}: category must be an account id`);
        const accountId = v.accountId == null ? null : id(v.accountId);
        if (Number.isNaN(accountId)) throw err(400, `${what}: account must be an account id or null`);
        const currency = pick(v.currency, MODELLED, `${what}: currency`);
        const month = v.month;
        if (!Number.isInteger(month) || month < 1 || month > 12) throw err(400, `${what}: month must be 1–12`);
        const toBlock = pick(v.toBlock, BLOCKS, `${what}: to`);
        const key = `${categoryId}|${accountId ?? 0}|${currency}|${month}`;
        if (seen.has(key)) throw err(400, `${what}: that item is moved twice`);
        seen.add(key);
        return { categoryId, accountId, currency, month, toBlock };
      });
      const ids = [...new Set(rows.flatMap((r) => (r.accountId == null ? [r.categoryId] : [r.categoryId, r.accountId])))];
      const section = new Map((await client.query('SELECT id, section FROM accounts WHERE id = ANY($1::int[])', [ids]))
        .rows.map((r) => [r.id, r.section]));
      for (const r of rows) {
        if (section.get(r.categoryId) !== 'profit_loss') throw err(400, `Move: ${r.categoryId} is not a category`);
        if (r.accountId != null && section.get(r.accountId) !== 'balance_sheet') throw err(400, `Move: ${r.accountId} is not an account`);
      }
      await client.query('DELETE FROM budget_build_cash_moves WHERE build_id = $1', [buildId]);
      for (const r of rows) {
        await client.query(
          `INSERT INTO budget_build_cash_moves (build_id, category_id, account_id, currency, month, to_block)
           VALUES ($1, $2, $3, $4, $5, $6)`, [buildId, r.categoryId, r.accountId, r.currency, r.month, r.toBlock]
        );
      }
    }
  });
}

module.exports = { cashFlow, savePlan, rollForward, BLOCK_ROOTS, MODELLED };
