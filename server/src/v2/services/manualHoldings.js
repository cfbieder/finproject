'use strict';
/**
 * manualHoldings.js — CR097 P1a: a holdings register for manually valued accounts.
 *
 * A non-fed USD balance-sheet account (specimen: Misc Investments) carries a list of
 * holdings, each in its own currency (EUR/GBP/USD/PLN — whatever `exchange_rates`
 * covers). A dated VALUATION, in ONE transaction:
 *
 *   1. writes a CR061 position snapshot (source = 'manual') for the date;
 *   2. sets the account's manual_balances row for the date to Σ value in USD;
 *   3. runs CR033's mtm with bookDate = the valuation date, which books
 *      `entered − computed` to Unrealized G/L (category 88).
 *
 * Preview runs exactly the same writes inside a transaction that always rolls back,
 * so what the owner approves is what apply computes; apply carries the previewed
 * figures back (`expect`) and refuses PREVIEW_STALE if they moved (CR087's guard).
 * Any block — missing FX, stale FX not acknowledged, cost gap over threshold, the
 * 15% guard without force — rolls the whole valuation back. Nothing is half-saved.
 *
 * P1a limits (CR097 §5.3, §4.5): only the LATEST valuation can be saved over or
 * deleted (a back-dated save is refused, so no later mark needs replaying), and the
 * ACCOUNT must be USD. P1b lifts both.
 *
 * Arithmetic, per holding, valuation p → t (CR097 §4.3):
 *   value_acct_t = round2(value_local_t × fx_t)
 *   price_period = round2((value_local_t − value_local_p) × fx_p)
 *   fx_period    = (value_acct_t − value_acct_p) − price_period     ← residual: cents tie
 * A holding new since p starts from its cost (value_local_p = cost_local,
 * value_acct_p = cost_acct). The booked MTM row then equals Σ price_period +
 * Σ fx_period + the change in unreconciled cost — `cost_change`, the third column.
 */

const db = require('../db');
const AppError = require('../utils/AppError');
const { rateRowAsOf } = require('./fx');
const { setManualBalanceTx, mtm, MTM_SOURCE } = require('./reconcileManual');

const SNAPSHOT_SOURCE = 'manual';
const FX_STALE_DAYS = 5;
// Cost gap blocks above max($50, 2% of cost) — CR097 §4.4, tunable.
const GAP_ABS = 50;
const GAP_PCT = 0.02;

const KINDS = ['units', 'amount'];
const STATUSES = ['active', 'exited', 'failed'];
const ASSET_CLASSES = ['private', 'equity', 'etf', 'mutual_fund', 'bond', 'cash', 'unknown'];

const round2 = (x) => Math.round(x * 100) / 100;
// One order everywhere — register, entry form, preview — so typed input can be
// checked against the preview line by line.
const byPlatformThenName = (x, y) =>
  (x.platform || '').localeCompare(y.platform || '') || x.name.localeCompare(y.name);
const num = (x) => (x == null ? null : Number(x));

class PreviewRollback extends Error {}

// ---- account ---------------------------------------------------------------

async function loadAccount(q, accountId, { lock = false } = {}) {
  const a = (await q.query(
    `SELECT a.id, a.name, a.currency, a.section, a.account_type, a.opening_balance,
            a.manual_reconcile_mode, a.manual_holdings_enabled,
            EXISTS (
              SELECT 1 FROM account_source_mappings asm
              WHERE asm.source = 'bank-feed' AND asm.account_id = a.id
                AND asm.ignored IS NOT TRUE
            ) AS is_fed
       FROM accounts a WHERE a.id = $1 ${lock ? 'FOR UPDATE OF a' : ''}`,
    [accountId]
  )).rows[0];
  if (!a) throw AppError.notFound(`account ${accountId} not found`);
  return a;
}

/** Why this account cannot carry a register, or null. Re-checked on every save. */
function ineligibility(a) {
  if (a.section !== 'balance_sheet') return 'not a balance-sheet account';
  if (a.account_type !== 'asset') return 'a liability — a register lists what an account holds';
  if (a.is_fed) return 'on a bank feed — its positions come from the feed';
  if (a.currency !== 'USD') return `account currency is ${a.currency}; P1a registers USD accounts only`;
  return null;
}

async function requireEnabled(q, accountId, opts) {
  const a = await loadAccount(q, accountId, opts);
  if (!a.manual_holdings_enabled) {
    throw AppError.badRequest(`account ${accountId} has no holdings register — enable it first`);
  }
  const why = ineligibility(a);
  if (why) throw AppError.badRequest(`account ${accountId} cannot use a holdings register: ${why}`);
  return a;
}

/**
 * Enable the register. Switches the account to `mtm`: under `calibrate` every
 * gain would be absorbed into opening_balance, which is the defect CR097 exists
 * to end.
 */
async function enableRegister(accountId) {
  return db.transaction(async (client) => {
    const a = await loadAccount(client, accountId, { lock: true });
    const why = ineligibility(a);
    if (why) throw AppError.badRequest(`account ${accountId} cannot use a holdings register: ${why}`);
    await client.query(
      `UPDATE accounts SET manual_holdings_enabled = TRUE, manual_reconcile_mode = 'mtm' WHERE id = $1`,
      [accountId]
    );
    return {
      account_id: accountId, enabled: true,
      mode_switched: a.manual_reconcile_mode !== 'mtm',
    };
  });
}

/**
 * Disable: register writes stop and the CR033 page works on the account again.
 * Snapshots and booked MTM rows stay — they are valid ledger history (CR097 §4.5).
 */
async function disableRegister(accountId) {
  return db.transaction(async (client) => {
    await loadAccount(client, accountId, { lock: true });
    await client.query(`UPDATE accounts SET manual_holdings_enabled = FALSE WHERE id = $1`, [accountId]);
    return { account_id: accountId, enabled: false };
  });
}

// ---- register --------------------------------------------------------------

async function rateOrThrow(q, currency, date) {
  const r = await rateRowAsOf(q, currency, date);
  if (!r) throw AppError.badRequest(`no USD exchange rate for ${currency} — cannot value it`);
  return r;
}

function checkHoldingShape(h) {
  if (!KINDS.includes(h.kind)) throw AppError.badRequest(`kind must be one of ${KINDS.join(', ')}`);
  if (!STATUSES.includes(h.status)) throw AppError.badRequest(`status must be one of ${STATUSES.join(', ')}`);
  if (h.kind === 'units' && !(h.quantity > 0)) throw AppError.badRequest('a units holding needs a quantity > 0');
  if (h.kind === 'amount' && h.quantity != null) throw AppError.badRequest('an amount holding has no quantity');
  if (!(h.cost_local >= 0)) throw AppError.badRequest('cost_local must be ≥ 0');
  if (h.cost_acct != null && !(h.cost_acct >= 0)) throw AppError.badRequest('cost_acct must be ≥ 0');
  if (h.proceeds_acct != null && !(h.proceeds_acct >= 0)) throw AppError.badRequest('proceeds_acct must be ≥ 0');
  if (h.proceeds_acct != null && h.status !== 'exited') {
    throw AppError.badRequest('proceeds_acct only applies to an exited holding');
  }
}

/** cost_acct for an fx_default holding: cost_local at the rate on acquired_on. */
async function defaultCostAcct(q, currency, costLocal, acquiredOn) {
  const r = await rateOrThrow(q, currency, acquiredOn);
  // cost_acct is permanent — it feeds every later gap and "since purchase" figure —
  // so it gets the same staleness rule as a valuation, with no override: the nearest
  // rate can be years away (or after the purchase).
  if (dayDiff(r.rate_date, acquiredOn) > FX_STALE_DAYS) {
    throw AppError.badRequest(
      `the nearest ${currency} rate to ${acquiredOn} is dated ${r.rate_date} — ` +
      'enter the cost in the account currency (the amount actually sent) instead'
    );
  }
  return round2(costLocal * r.rate);
}

async function createHolding(accountId, input) {
  return db.transaction(async (client) => {
    await requireEnabled(client, accountId);
    const currency = String(input.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw AppError.badRequest('currency must be a 3-letter code');
    const assetClass = input.asset_class || 'private';
    if (!ASSET_CLASSES.includes(assetClass)) {
      throw AppError.badRequest(`asset_class must be one of ${ASSET_CLASSES.join(', ')}`);
    }
    const h = {
      kind: input.kind,
      status: input.status || 'active',
      quantity: input.kind === 'units' ? num(input.quantity) : (input.quantity == null ? null : num(input.quantity)),
      cost_local: num(input.cost_local),
      cost_acct: num(input.cost_acct),
      proceeds_acct: num(input.proceeds_acct),
    };
    checkHoldingShape(h);
    const entered = h.cost_acct != null;
    const costAcct = entered
      ? round2(h.cost_acct)
      : await defaultCostAcct(client, currency, h.cost_local, input.acquired_on);

    // Manual securities stay OUT of the feed and quote paths (CR097 §4.1): no ticker
    // (UNIQUE, and the feed's ingest inserts any short symbol as one), no price_basis
    // (quote eligibility is gated on 'per_share').
    const sec = (await client.query(
      `INSERT INTO securities (ticker, name, asset_class, currency, price_basis, quantity_unit, classification_source)
       VALUES (NULL, $1, $2, $3, NULL, $4, 'manual') RETURNING id`,
      [input.name.trim(), assetClass, currency, h.kind === 'units' ? 'shares' : null]
    )).rows[0];

    const row = (await client.query(
      `INSERT INTO manual_holdings
         (account_id, security_id, platform, kind, status, acquired_on, quantity,
          cost_local, cost_acct, cost_acct_source, proceeds_acct, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [accountId, sec.id, input.platform || null, h.kind, h.status, input.acquired_on, h.quantity,
        h.cost_local, costAcct, entered ? 'entered' : 'fx_default', h.proceeds_acct, input.note || null]
    )).rows[0];
    return getHolding(client, accountId, row.id);
  });
}

async function getHolding(q, accountId, holdingId) {
  const r = (await q.query(
    `SELECT h.id, h.account_id, h.security_id, s.name, s.currency, s.asset_class, h.platform,
            h.kind, h.status, h.acquired_on::text AS acquired_on, h.quantity, h.cost_local,
            h.cost_acct, h.cost_acct_source, h.proceeds_acct, h.note
       FROM manual_holdings h JOIN securities s ON s.id = h.security_id
      WHERE h.id = $1 AND h.account_id = $2`,
    [holdingId, accountId]
  )).rows[0];
  if (!r) throw AppError.notFound(`holding ${holdingId} not found on account ${accountId}`);
  for (const k of ['quantity', 'cost_local', 'cost_acct', 'proceeds_acct']) r[k] = num(r[k]);
  return r;
}

async function updateHolding(accountId, holdingId, patch) {
  return db.transaction(async (client) => {
    await requireEnabled(client, accountId);
    const cur = await getHolding(client, accountId, holdingId);
    const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);

    const next = {
      kind: has('kind') ? patch.kind : cur.kind,
      status: has('status') ? patch.status : cur.status,
      quantity: has('quantity') ? num(patch.quantity) : cur.quantity,
      cost_local: has('cost_local') ? num(patch.cost_local) : cur.cost_local,
      cost_acct: has('cost_acct') ? num(patch.cost_acct) : cur.cost_acct,
      proceeds_acct: has('proceeds_acct') ? num(patch.proceeds_acct) : cur.proceeds_acct,
      acquired_on: has('acquired_on') ? patch.acquired_on : cur.acquired_on,
    };
    if (next.kind === 'amount' && !has('quantity')) next.quantity = null;
    if (next.status !== 'exited' && !has('proceeds_acct')) next.proceeds_acct = null;

    // cost_acct: an explicit number makes it 'entered'; null reverts to the FX
    // default; otherwise an fx_default cost follows its inputs.
    let costSource = cur.cost_acct_source;
    if (has('cost_acct') && patch.cost_acct != null) {
      costSource = 'entered';
    } else if ((has('cost_acct') && patch.cost_acct == null) ||
               (costSource === 'fx_default' && (has('cost_local') || has('acquired_on')))) {
      costSource = 'fx_default';
      next.cost_acct = await defaultCostAcct(client, cur.currency, next.cost_local, next.acquired_on);
    }
    checkHoldingShape(next);

    await client.query(
      `UPDATE manual_holdings SET platform = $3, kind = $4, status = $5, acquired_on = $6,
              quantity = $7, cost_local = $8, cost_acct = $9, cost_acct_source = $10,
              proceeds_acct = $11, note = $12, updated_at = NOW()
        WHERE id = $1 AND account_id = $2`,
      [holdingId, accountId, has('platform') ? (patch.platform || null) : cur.platform,
        next.kind, next.status, next.acquired_on, next.quantity, next.cost_local,
        round2(next.cost_acct), costSource, next.proceeds_acct,
        has('note') ? (patch.note || null) : cur.note]
    );
    if (has('name') || has('asset_class')) {
      const ac = has('asset_class') ? patch.asset_class : cur.asset_class;
      if (!ASSET_CLASSES.includes(ac)) throw AppError.badRequest(`asset_class must be one of ${ASSET_CLASSES.join(', ')}`);
      await client.query(
        `UPDATE securities SET name = $2, asset_class = $3, updated_at = NOW() WHERE id = $1`,
        [cur.security_id, has('name') ? patch.name.trim() : cur.name, ac]
      );
    }
    return getHolding(client, accountId, holdingId);
  });
}

/**
 * Buy from cash: one platform's cash pays for a new holding. The spent share of
 * the cash's cost moves to the new holding — local AND account currency — so the
 * account's total cost is unchanged and the cost check stays where it was. Typing
 * the new holding's cost at today's rate instead would drop (or invent) the FX the
 * cash carried since it was deposited.
 *
 * The new holding is in the cash's currency: GBP cash buys a GBP holding.
 */
async function buyFromCash(accountId, cashHoldingId, input) {
  return db.transaction(async (client) => {
    await requireEnabled(client, accountId, { lock: true });
    const cash = await getHolding(client, accountId, cashHoldingId);
    if (cash.asset_class !== 'cash') throw AppError.badRequest(`"${cash.name}" is not a cash holding`);
    if (cash.status !== 'active') throw AppError.badRequest(`"${cash.name}" is ${cash.status}`);
    const amount = round2(Number(input.amount_local));
    if (!(amount > 0)) throw AppError.badRequest('amount_local must be > 0');
    if (amount > cash.cost_local + 0.004) {
      throw AppError.badRequest(
        `${amount} ${cash.currency} is more than the ${cash.cost_local} ${cash.currency} recorded in "${cash.name}"`
      );
    }
    const assetClass = input.asset_class || 'private';
    if (!ASSET_CLASSES.includes(assetClass) || assetClass === 'cash') {
      throw AppError.badRequest('asset_class must name what was bought, not cash');
    }
    const kind = input.kind;
    const quantity = kind === 'units' ? num(input.quantity) : null;
    checkHoldingShape({ kind, status: 'active', quantity, cost_local: amount, cost_acct: 0, proceeds_acct: null });

    // The spent share of the cash's cost; the last cent of an all-in spend goes too.
    const moved = amount >= cash.cost_local ? cash.cost_acct : round2(cash.cost_acct * (amount / cash.cost_local));

    await client.query(
      `UPDATE manual_holdings SET cost_local = $3, cost_acct = $4, cost_acct_source = 'entered', updated_at = NOW()
        WHERE id = $1 AND account_id = $2`,
      [cashHoldingId, accountId, round2(cash.cost_local - amount), round2(cash.cost_acct - moved)]
    );
    const sec = (await client.query(
      `INSERT INTO securities (ticker, name, asset_class, currency, price_basis, quantity_unit, classification_source)
       VALUES (NULL, $1, $2, $3, NULL, $4, 'manual') RETURNING id`,
      [input.name.trim(), assetClass, cash.currency, kind === 'units' ? 'shares' : null]
    )).rows[0];
    const row = (await client.query(
      `INSERT INTO manual_holdings
         (account_id, security_id, platform, kind, status, acquired_on, quantity,
          cost_local, cost_acct, cost_acct_source, note)
       VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,'entered',$9) RETURNING id`,
      [accountId, sec.id, input.platform || cash.platform, kind, input.acquired_on, quantity,
        amount, moved, input.note || `bought from ${cash.name}`]
    )).rows[0];
    return {
      cash: await getHolding(client, accountId, cashHoldingId),
      bought: await getHolding(client, accountId, row.id),
      moved_cost_acct: moved,
    };
  });
}

/** Only a holding no valuation has used can be deleted — otherwise mark it exited/failed. */
async function deleteHolding(accountId, holdingId) {
  return db.transaction(async (client) => {
    await requireEnabled(client, accountId);
    const cur = await getHolding(client, accountId, holdingId);
    const used = (await client.query(
      `SELECT 1 FROM security_positions sp
         JOIN security_position_snapshots s ON s.id = sp.snapshot_id
        WHERE sp.security_id = $1 AND s.account_id = $2 AND s.source = $3 LIMIT 1`,
      [cur.security_id, accountId, SNAPSHOT_SOURCE]
    )).rows[0];
    if (used) {
      throw AppError.badRequest(
        `"${cur.name}" appears in a saved valuation — mark it exited or failed instead of deleting it`
      );
    }
    await client.query(`DELETE FROM manual_holdings WHERE id = $1 AND account_id = $2`, [holdingId, accountId]);
    await client.query(`DELETE FROM securities WHERE id = $1`, [cur.security_id]);
    return { id: holdingId, deleted: true };
  });
}

/**
 * The Holdings index: every non-fed balance-sheet leaf account, with whether it
 * carries a register (and its last valuation) or could carry one in P1a.
 * Ineligible accounts are left out — the list is for what can be opened.
 */
async function listRegisters() {
  const rows = (await db.query(
    `SELECT a.id, a.name, a.currency, a.manual_holdings_enabled AS enabled,
            (SELECT COUNT(*)::int FROM manual_holdings h WHERE h.account_id = a.id) AS holdings,
            v.polled_on::text AS last_valued_on, v.sum_market_value AS last_total
       FROM accounts a
       LEFT JOIN LATERAL (
         SELECT polled_on, sum_market_value FROM security_position_snapshots s
          WHERE s.account_id = a.id AND s.source = $1
          ORDER BY polled_on DESC LIMIT 1
       ) v ON TRUE
      WHERE a.section = 'balance_sheet' AND a.account_type = 'asset'
        AND COALESCE(a.is_active, TRUE)
        AND NOT EXISTS (SELECT 1 FROM accounts ch WHERE ch.parent_id = a.id)
        AND NOT EXISTS (
          SELECT 1 FROM account_source_mappings asm
           WHERE asm.source = 'bank-feed' AND asm.account_id = a.id AND asm.ignored IS NOT TRUE)
        AND (a.manual_holdings_enabled OR a.currency = 'USD')
      ORDER BY a.manual_holdings_enabled DESC, a.name`,
    [SNAPSHOT_SOURCE]
  )).rows;
  return rows.map((r) => ({ ...r, last_total: num(r.last_total) }));
}

/** The register page: account, holdings with their latest valued figures, valuation list. */
async function getRegister(accountId) {
  const a = await loadAccount(db, accountId);
  const holdings = (await db.query(
    `SELECT h.id FROM manual_holdings h WHERE h.account_id = $1`, [accountId]
  )).rows;
  const list = [];
  for (const { id } of holdings) list.push(await getHolding(db, accountId, id));

  const valuations = (await db.query(
    `SELECT s.polled_on::text AS valued_on, s.sum_market_value AS total, s.positions_count,
            (SELECT SUM(t.amount) FROM transactions t
              WHERE t.account_id = s.account_id AND t.source = $3
                AND t.transaction_date = s.polled_on) AS mtm_amount
       FROM security_position_snapshots s
      WHERE s.account_id = $1 AND s.source = $2
      ORDER BY s.polled_on DESC`,
    [accountId, SNAPSHOT_SOURCE, MTM_SOURCE]
  )).rows.map((v) => ({ ...v, total: num(v.total), mtm_amount: num(v.mtm_amount) }));

  const latest = valuations[0] ? await positionsAt(db, accountId, valuations[0].valued_on) : new Map();
  for (const h of list) {
    const p = latest.get(h.security_id);
    h.latest = p ? {
      valued_on: valuations[0].valued_on, price_local: p.price_local,
      value_local: p.market_value_local, value_acct: p.market_value, fx_rate: p.fx_rate,
      carried: p.carried,
    } : null;
  }
  list.sort(byPlatformThenName);

  return {
    account: {
      id: a.id, name: a.name, currency: a.currency,
      reconcile_mode: a.manual_reconcile_mode,
      enabled: a.manual_holdings_enabled,
      ineligible_reason: ineligibility(a),
    },
    holdings: list,
    valuations,
  };
}

// ---- valuation -------------------------------------------------------------

async function latestValuationDate(q, accountId) {
  return (await q.query(
    `SELECT MAX(polled_on)::text AS d FROM security_position_snapshots
      WHERE account_id = $1 AND source = $2`,
    [accountId, SNAPSHOT_SOURCE]
  )).rows[0].d;
}

/** Positions of the manual snapshot on `date`, keyed by security_id. */
async function positionsAt(q, accountId, date) {
  const rows = (await q.query(
    `SELECT sp.security_id, sp.price_local, sp.market_value_local, sp.market_value, sp.fx_rate,
            sp.cost_basis, sp.raw
       FROM security_positions sp
       JOIN security_position_snapshots s ON s.id = sp.snapshot_id
      WHERE s.account_id = $1 AND s.source = $2 AND s.polled_on = $3::date`,
    [accountId, SNAPSHOT_SOURCE, date]
  )).rows;
  return new Map(rows.map((r) => [r.security_id, {
    price_local: num(r.price_local), market_value_local: num(r.market_value_local),
    market_value: num(r.market_value), fx_rate: num(r.fx_rate),
    carried: Boolean(r.raw && r.raw.carried),
    kind: r.raw ? r.raw.kind : null,
    // What the holding's cost and proceeds WERE at that valuation, so a top-up or an
    // exit since then is a cost movement, not a price movement.
    cost_acct: num(r.cost_basis),
    cost_local: r.raw && r.raw.cost_local != null ? Number(r.raw.cost_local) : null,
    proceeds_acct: r.raw && r.raw.proceeds_acct != null ? Number(r.raw.proceeds_acct) : 0,
  }]));
}

/** Opening + every non-MTM row in the balance window, up to `date`: what was put in. */
async function contributionsAsOf(q, acct, date) {
  return round2(Number(acct.opening_balance) + Number((await q.query(
    `SELECT COALESCE(SUM(t.amount), 0) AS s
       FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.account_id = $1 AND t.source IS DISTINCT FROM $3
        AND t.transaction_date >= a.opening_balance_date
        AND t.transaction_date <= $2::date`,
    [acct.id, date, MTM_SOURCE]
  )).rows[0].s));
}

const dayDiff = (a, b) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/**
 * Compute AND write one valuation on `client` (the caller decides commit vs
 * rollback). Returns the full explanation; never throws for a "block" — those are
 * listed in `blocked`, so a preview can show every one at once.
 */
async function valuationOnClient(client, accountId, { valuedOn, items = [], force = false, ackStaleFx = false }) {
  const acct = await requireEnabled(client, accountId, { lock: true });

  // P1a: nothing booked after `valuedOn` may exist — no later mark would be replayed.
  // That includes a balance typed or a CR033 mark booked before the register existed.
  const later = (await client.query(
    `SELECT GREATEST(
        (SELECT MAX(polled_on) FROM security_position_snapshots WHERE account_id = $1 AND source = $2),
        (SELECT MAX(balance_date) FROM manual_balances WHERE account_id = $1),
        (SELECT MAX(transaction_date) FROM transactions WHERE account_id = $1 AND source = $3)
      )::text AS d`,
    [accountId, SNAPSHOT_SOURCE, MTM_SOURCE]
  )).rows[0].d;
  if (later && valuedOn < later) {
    throw AppError.badRequest(
      `a valuation, balance or Unrealized G/L row dated ${later} already exists — P1a saves only ` +
      'on or after it (delete forward to correct an older one)'
    );
  }
  const prevDate = (await client.query(
    `SELECT MAX(polled_on)::text AS d FROM security_position_snapshots
      WHERE account_id = $1 AND source = $2 AND polled_on < $3::date`,
    [accountId, SNAPSHOT_SOURCE, valuedOn]
  )).rows[0].d;
  const prev = prevDate ? await positionsAt(client, accountId, prevDate) : new Map();

  const holdings = (await client.query(
    `SELECT h.id FROM manual_holdings h WHERE h.account_id = $1 AND h.acquired_on <= $2::date`,
    [accountId, valuedOn]
  )).rows;
  const hs = [];
  for (const { id } of holdings) hs.push(await getHolding(client, accountId, id));
  hs.sort(byPlatformThenName);

  const byId = new Map();
  for (const it of items) {
    if (!hs.some((h) => h.id === it.holding_id)) {
      throw AppError.badRequest(`holding ${it.holding_id} is not on account ${accountId} (or acquired after ${valuedOn})`);
    }
    byId.set(it.holding_id, it);
  }

  const fxCache = new Map();
  const fxFor = async (ccy) => {
    if (!fxCache.has(ccy)) fxCache.set(ccy, await rateRowAsOf(client, ccy, valuedOn));
    return fxCache.get(ccy);
  };

  const lines = [];
  for (const h of hs) {
    const it = byId.get(h.id) || {};
    const p = prev.get(h.security_id);
    // A holding worth 0 needs no rate; one missing rate must not block the valuation.
    const fx = (await fxFor(h.currency)) || (h.status !== 'active' ? { rate: null, rate_date: null } : null);
    if (!fx) throw AppError.badRequest(`no USD exchange rate for ${h.currency} — cannot value it`);
    let priceLocal = null;
    let valueLocal;
    let carried = false;
    if (h.status !== 'active') {
      valueLocal = 0;
    } else if (h.kind === 'units') {
      if (it.price != null) priceLocal = Number(it.price);
      else {
        carried = true;
        // Carry a per-share price only from a units position — an amount-only one
        // stored no price, and its value is not one.
        priceLocal = p && p.kind === 'units' && p.price_local != null ? p.price_local
          : (h.quantity ? h.cost_local / h.quantity : 0);
      }
      valueLocal = round2(h.quantity * priceLocal);
    } else if (it.value != null) {
      valueLocal = round2(Number(it.value));
    } else {
      carried = true;
      // Carry the last value, moved by any cost added or removed since — cash spent
      // on a purchase, or a top-up of an unconverted stake. Carrying it unchanged
      // would book the spent cash a second time, as a gain.
      if (p && p.market_value_local != null) {
        const dCostLocal = p.cost_local != null ? h.cost_local - p.cost_local : 0;
        valueLocal = round2(Math.max(0, p.market_value_local + dCostLocal));
      } else {
        valueLocal = h.cost_local;
      }
    }
    const valueAcct = valueLocal === 0 ? 0 : round2(valueLocal * fx.rate);

    // The starting point of this period: the previous valuation, or cost if new —
    // moved by any cost added (a top-up) or proceeds taken (an exit) since then, so
    // those land in the cost column instead of reading as a price move.
    const fxPurchase = h.cost_local ? h.cost_acct / h.cost_local : (fx.rate || 1);
    const fxP = p && p.fx_rate ? p.fx_rate : fxPurchase;
    let vLocalP;
    let vAcctP;
    if (p) {
      const dCostAcct = p.cost_acct != null ? h.cost_acct - p.cost_acct : 0;
      const dCostLocal = p.cost_local != null ? h.cost_local - p.cost_local : 0;
      const dProceeds = (h.proceeds_acct || 0) - p.proceeds_acct;
      vAcctP = p.market_value + dCostAcct - dProceeds;
      vLocalP = p.market_value_local + dCostLocal - dProceeds / fxP;
    } else {
      vLocalP = h.cost_local - (h.proceeds_acct || 0) / fxP;
      vAcctP = h.cost_acct - (h.proceeds_acct || 0);
    }
    const pricePeriod = round2((valueLocal - vLocalP) * fxP);
    const fxPeriod = round2(valueAcct - vAcctP - pricePeriod);

    // Since purchase. An exit's result is its proceeds against cost, frozen.
    const unrealized = round2(valueAcct + (h.proceeds_acct || 0) - h.cost_acct);
    const priceCum = h.status === 'active' ? round2((valueLocal - h.cost_local) * fxPurchase) : unrealized;

    lines.push({
      holding_id: h.id, security_id: h.security_id, name: h.name, platform: h.platform,
      currency: h.currency, kind: h.kind, status: h.status, quantity: h.quantity,
      price_local: priceLocal, value_local: valueLocal, carried,
      fx_rate: fx.rate, fx_rate_date: fx.rate_date, value_acct: valueAcct,
      cost_local: h.cost_local, cost_acct: h.cost_acct, cost_acct_source: h.cost_acct_source,
      proceeds_acct: h.proceeds_acct,
      new_since_previous: !p,
      price_period: pricePeriod, fx_period: fxPeriod,
      unrealized, price_cum: priceCum, fx_cum: round2(unrealized - priceCum),
    });
  }

  const total = round2(lines.reduce((s, l) => s + l.value_acct, 0));
  const costTotal = round2(hs.reduce((s, h) => s + h.cost_acct, 0));
  const proceedsTotal = round2(hs.reduce((s, h) => s + (h.proceeds_acct || 0), 0));

  const contributions = await contributionsAsOf(client, acct, valuedOn);
  const gap = round2(costTotal - proceedsTotal - contributions);
  // The same gap at the previous valuation, from what that snapshot recorded.
  let gapPrev = 0;
  if (prevDate) {
    let c = 0;
    for (const p of prev.values()) c += (p.cost_acct || 0) - p.proceeds_acct;
    gapPrev = round2(c - await contributionsAsOf(client, acct, prevDate));
  }
  const gapThreshold = round2(Math.max(GAP_ABS, GAP_PCT * costTotal));

  // ---- writes (rolled back by the caller on preview or block) ----
  await client.query(
    `DELETE FROM security_position_snapshots WHERE account_id = $1 AND source = $2 AND polled_on = $3::date`,
    [accountId, SNAPSHOT_SOURCE, valuedOn]
  );
  const snap = (await client.query(
    `INSERT INTO security_position_snapshots
       (account_id, polled_on, valued_on, source, status, custodian_balance, positions_count, sum_market_value, raw)
     VALUES ($1, $2, $2, $3, 'fetched', $4, $5, $4, $6) RETURNING id`,
    [accountId, valuedOn, SNAPSHOT_SOURCE, total, lines.length, JSON.stringify({ cr097: 'holdings register' })]
  )).rows[0];
  for (const l of lines) {
    // market_value / price stay in the ACCOUNT currency so quantity × price =
    // market_value holds for every reader; the holding's own figures go beside them.
    const qty = l.kind === 'units' ? l.quantity : 1;
    await client.query(
      `INSERT INTO security_positions
         (snapshot_id, account_id, security_id, quantity, price, price_basis, price_source,
          market_value, cost_basis, currency, price_local, market_value_local, fx_rate, raw)
       VALUES ($1,$2,$3,$4,$5,NULL,'manual',$6,$7,$8,$9,$10,$11,$12)`,
      [snap.id, accountId, l.security_id, qty, qty ? l.value_acct / qty : 0, l.value_acct,
        l.cost_acct, acct.currency, l.price_local, l.value_local, l.fx_rate,
        JSON.stringify({
          holding_id: l.holding_id, kind: l.kind, status: l.status, carried: l.carried,
          fx_rate_date: l.fx_rate_date, cost_local: l.cost_local, proceeds_acct: l.proceeds_acct || 0,
        })]
    );
  }
  await setManualBalanceTx(client, accountId, {
    balance: total, balanceDate: valuedOn, note: 'CR097 holdings register valuation',
  });
  const booked = await mtm(client, accountId, acct, valuedOn, false, force);

  const pricePeriod = round2(lines.reduce((s, l) => s + l.price_period, 0));
  const fxPeriod = round2(lines.reduce((s, l) => s + l.fx_period, 0));

  const staleFx = [...fxCache.entries()]
    .filter(([ccy, r]) => ccy !== 'USD' && r && dayDiff(r.rate_date, valuedOn) > FX_STALE_DAYS)
    .map(([currency, r]) => ({ currency, rate_date: r.rate_date, days: dayDiff(r.rate_date, valuedOn) }));

  const blocked = [];
  if (staleFx.length && !ackStaleFx) {
    blocked.push({
      code: 'FX_STALE',
      message: `exchange rate more than ${FX_STALE_DAYS} days from ${valuedOn}: ` +
        staleFx.map((s) => `${s.currency} ${s.rate_date}`).join(', ') + ' — acknowledge to use it',
    });
  }
  if (Math.abs(gap) > gapThreshold) {
    const m = (x) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    blocked.push({
      code: 'COST_GAP',
      message: `holdings cost ${m(costTotal)} vs transferred in ${m(contributions)}: unreconciled ` +
        `${m(gap)} exceeds ${m(gapThreshold)} — a holding, platform cash or a transfer is missing`,
    });
  }
  if (booked.implausible && !force) {
    blocked.push({ code: 'IMPLAUSIBLE', message: booked.note || 'MTM above the 15% guard — confirm to book it' });
  }

  return {
    account_id: accountId, valued_on: valuedOn, previous_valuation: prevDate,
    total, lines,
    explain: {
      price_period: pricePeriod, fx_period: fxPeriod,
      cost_change: round2(gap - gapPrev),
      // Should be 0. Non-zero means something moved the ledger that is neither a
      // price, a rate nor the cost gap — e.g. an Unrealized G/L row edited by hand.
      other: round2(booked.mtm_amount - pricePeriod - fxPeriod - (gap - gapPrev)),
    },
    cost: { cost_total: costTotal, proceeds_total: proceedsTotal, contributions, gap, threshold: gapThreshold },
    mtm_amount: booked.mtm_amount, computed_excl_mtm: booked.computed_excl_mtm,
    implausible: booked.implausible, implausible_pct: booked.implausible_pct,
    stale_fx: staleFx, blocked,
  };
}

/** Preview: every write, then ROLLBACK. Returns what apply would book. */
async function previewValuation(accountId, input) {
  let result;
  try {
    await db.transaction(async (client) => {
      result = await valuationOnClient(client, accountId, input);
      throw new PreviewRollback();
    });
  } catch (e) {
    if (!(e instanceof PreviewRollback)) throw e;
  }
  return { ...result, applied: false };
}

/** Apply: same computation, committed only when unblocked and matching `expect`. */
async function saveValuation(accountId, input) {
  return db.transaction(async (client) => {
    const result = await valuationOnClient(client, accountId, input);
    if (result.blocked.length) {
      const err = AppError.badRequest(
        `valuation not saved: ${result.blocked.map((b) => b.message).join('; ')}`, 'VALUATION_BLOCKED'
      );
      err.summary = result;
      throw err;
    }
    const exp = input.expect;
    if (exp && (Number(exp.mtm_amount) !== result.mtm_amount || Number(exp.total) !== result.total)) {
      const err = AppError.conflict(
        `the figures moved since you previewed them: MTM ${exp.mtm_amount} → ${result.mtm_amount}, ` +
        `total ${exp.total} → ${result.total}. Nothing was written. Preview again.`, 'PREVIEW_STALE'
      );
      err.summary = result;
      throw err;
    }
    return { ...result, applied: true };
  });
}

/**
 * Delete the LATEST valuation (P1a): its snapshot, its balance row and its MTM row
 * go together, so the ledger returns to where the previous valuation left it.
 */
async function deleteValuation(accountId, valuedOn) {
  return db.transaction(async (client) => {
    await requireEnabled(client, accountId, { lock: true });
    const latest = await latestValuationDate(client, accountId);
    if (latest !== valuedOn) {
      throw AppError.badRequest(
        latest ? `only the latest valuation (${latest}) can be deleted in P1a` : 'there is no valuation to delete'
      );
    }
    const s = await client.query(
      `DELETE FROM security_position_snapshots WHERE account_id = $1 AND source = $2 AND polled_on = $3::date`,
      [accountId, SNAPSHOT_SOURCE, valuedOn]
    );
    const b = await client.query(
      `DELETE FROM manual_balances WHERE account_id = $1 AND balance_date = $2::date`, [accountId, valuedOn]
    );
    const t = await client.query(
      `DELETE FROM transactions WHERE account_id = $1 AND source = $2 AND transaction_date = $3::date`,
      [accountId, MTM_SOURCE, valuedOn]
    );
    return {
      account_id: accountId, valued_on: valuedOn,
      deleted: { snapshots: s.rowCount, balances: b.rowCount, mtm_rows: t.rowCount },
    };
  });
}

module.exports = {
  enableRegister, disableRegister, getRegister, listRegisters,
  createHolding, updateHolding, deleteHolding, buyFromCash,
  previewValuation, saveValuation, deleteValuation,
  KINDS, STATUSES, ASSET_CLASSES, FX_STALE_DAYS,
};
