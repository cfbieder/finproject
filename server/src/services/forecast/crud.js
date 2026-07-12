/**
 * Forecast CRUD service — CR043 Phase 2.1.
 *
 * The route-facing data-access + compute helpers that used to live as raw
 * `db.query(...)` blocks (with inline `require('../db')`) inside
 * v2/routes/forecast.js (N7 SQL-in-route, N13 inline requires). This is the
 * admin/CRUD side of the forecast domain; the generation engine is the sibling
 * index.js. Routes keep HTTP concerns (request parsing, PascalCase field
 * mapping, validation guards, response envelopes); everything that touches the
 * database for modules / income-expense items / scenario copy / the
 * add-from-actuals + base-year report queries lives here.
 */

const db = require('../../v2/db');
const repo = require('../../v2/repositories').forecast;

/**
 * Resolve an account name to its id (null when absent/not found).
 */
async function lookupAccountByName(name) {
  if (!name) return null;
  const result = await db.query('SELECT id FROM accounts WHERE name = $1 LIMIT 1', [name]);
  return result.rows[0]?.id || null;
}

/**
 * Refresh every module's base value (book) from year-end actuals in ONE
 * set-based statement (used by scenario copy with refreshFromActuals). Returns
 * the number of modules updated.
 *
 * base_amount is always in USD (base_currency); local-currency balance is the
 * sum of t.amount filtered to txs in the account's currency. market_value is
 * left as carried over from the source — broker-reported MV cannot be derived
 * from the ledger. Modules whose account has no transactions keep their copied
 * values.
 */
async function refreshModulesFromActuals(scenarioId, asOfDate) {
  const result = await db.query(`
    UPDATE forecast_modules m
    SET base_value = COALESCE(b.balance_lc, 0),
        base_value_usd = COALESCE(b.balance_usd, 0),
        base_date = $2,
        updated_at = NOW()
    FROM (
      SELECT a.id AS account_id,
        SUM(CASE WHEN t.currency = a.currency THEN t.amount ELSE 0 END) AS balance_lc,
        SUM(t.base_amount) AS balance_usd
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id
      WHERE t.transaction_date <= $2
      GROUP BY a.id
    ) b
    WHERE m.scenario_id = $1 AND m.account_id = b.account_id
  `, [scenarioId, asOfDate]);
  return result.rowCount;
}

/**
 * All modules across every scenario, joined with account + scenario names
 * (the GET /modules branch with no scenario filter).
 */
async function listAllModulesRaw() {
  const result = await db.query(`
    SELECT m.*, a.name as account_name, s.name as scenario_name
    FROM forecast_modules m
    LEFT JOIN accounts a ON m.account_id = a.id
    LEFT JOIN forecast_scenarios s ON m.scenario_id = s.id
    ORDER BY s.name, m.module_type, m.name
  `);
  return result.rows;
}

/**
 * Find a module (other than excludeModuleId) already holding cash_sweep_priority
 * within the scenario. Returns the clashing row ({ name }) or null.
 */
async function findCashSweepPriorityClash(scenarioId, excludeModuleId, priority) {
  const clash = await db.query(
    'SELECT name FROM forecast_modules WHERE scenario_id = $1 AND id != $2 AND cash_sweep_priority = $3 LIMIT 1',
    [scenarioId, excludeModuleId, priority]
  );
  return clash.rows[0] || null;
}

/**
 * Clear the legacy cash_sweep_target flag on every OTHER module in the scenario
 * that isn't actually priority 1 (keeps the flag unique to the primary).
 */
async function clearOtherCashSweepTargets(scenarioId, excludeModuleId) {
  await db.query(
    'UPDATE forecast_modules SET cash_sweep_target = FALSE WHERE scenario_id = $1 AND id != $2 AND cash_sweep_target = TRUE AND cash_sweep_priority IS DISTINCT FROM 1',
    [scenarioId, excludeModuleId]
  );
}

/**
 * Replace a module's embedded schedules (Invest / Dispose / IncomePct) in one
 * transaction — a failure mid-reinsert must not leave the schedule wiped by the
 * leading DELETEs (CR037 P5). Only the arrays actually present on the body are
 * touched.
 */
async function replaceModuleSchedules(id, body) {
  await db.transaction(async (client) => {
    if (Array.isArray(body.Invest)) {
      await client.query('DELETE FROM forecast_module_investments WHERE module_id = $1', [id]);
      for (const inv of body.Invest) {
        if (inv.Date || inv.Amount !== undefined) {
          await repo.addInvestment(id, {
            investment_date: inv.Date,
            amount: inv.Amount,
            flag: inv.Flag || '',
            note: inv.Note || '',
            date_end: inv.DateEnd || null,
          }, client);
        }
      }
    }

    if (Array.isArray(body.Dispose)) {
      await client.query('DELETE FROM forecast_module_disposals WHERE module_id = $1', [id]);
      for (const disp of body.Dispose) {
        if (disp.Date || disp.Amount !== undefined) {
          await repo.addDisposal(id, {
            disposal_date: disp.Date,
            amount: disp.Amount,
            flag: disp.Flag || '',
            note: disp.Note || '',
            date_end: disp.DateEnd || null,
          }, client);
        }
      }
    }

    if (Array.isArray(body.IncomePct)) {
      await client.query('DELETE FROM forecast_module_income_pct WHERE module_id = $1', [id]);
      for (const pct of body.IncomePct) {
        if (pct.Date) {
          await repo.setIncomePct(id, {
            effective_date: pct.Date,
            value: pct.Amount ?? pct.Value ?? 0,
          }, client);
        }
      }
    }
  });
}

/**
 * Resolve an income/expense item's account from its FC Line when no explicit
 * account was given: prefer an account whose name matches the line name, else
 * fall back to any account assigned to the line. Returns an account id or null.
 */
async function resolveIncExpAccountFromFcLine(fcLineId) {
  // Try to find an account whose name matches the FC Line name (most common case)
  const fcLineResult = await db.query('SELECT name FROM fc_lines WHERE id = $1', [fcLineId]);
  if (fcLineResult.rows.length > 0) {
    const matchingAccount = await db.query(
      'SELECT id FROM accounts WHERE name = $1 AND section = $2 LIMIT 1',
      [fcLineResult.rows[0].name, 'profit_loss']
    );
    if (matchingAccount.rows.length > 0) {
      return matchingAccount.rows[0].id;
    }
  }
  // Fallback: pick any account assigned to this FC Line.
  // After migration 021, fc_line_categories.category_id IS the account id.
  const lineAccount = await db.query(`
    SELECT flc.category_id AS account_id
    FROM fc_line_categories flc
    WHERE flc.fc_line_id = $1
    LIMIT 1
  `, [fcLineId]);
  if (lineAccount.rows.length > 0) {
    return lineAccount.rows[0].account_id;
  }
  return null;
}

/**
 * Replace an income/expense item's changes: delete existing rows then re-add
 * the provided ones (mirrors the route's previous non-transactional behavior).
 */
async function replaceIncExpChanges(id, changes) {
  await db.query('DELETE FROM forecast_incexp_changes WHERE incexp_id = $1', [id]);
  for (const change of changes) {
    if (change.Date || change.Amount !== undefined) {
      await repo.addIncExpChange(id, {
        change_date: change.Date,
        amount: change.Amount,
        flag: change.Flag || '',
      });
    }
  }
}

/**
 * Build the balance-sheet account tree with year-end aggregated balances for
 * the "add module from actuals" picker. Excludes the Bank Accounts subtree and
 * flags accounts already used as modules in the scenario.
 */
async function buildAddFromActualsTree(scenarioId, baseYear) {
  const asOfDate = `${baseYear}-12-31`;

  // Get account IDs already used as modules in this scenario
  const existingResult = await db.query(
    `SELECT account_id FROM forecast_modules WHERE scenario_id = $1 AND account_id IS NOT NULL`,
    [scenarioId]
  );
  const existingAccountIds = new Set(existingResult.rows.map(r => r.account_id));

  // Get full BS account tree, excluding Bank Accounts subtree
  const treeResult = await db.query(`
    WITH RECURSIVE tree AS (
      SELECT id, name, parent_id, currency, account_type, is_active,
             ARRAY[id] as path, 0 as depth
      FROM accounts
      WHERE section = 'balance_sheet' AND parent_id IS NULL
      UNION ALL
      SELECT a.id, a.name, a.parent_id, a.currency, a.account_type, a.is_active,
             t.path || a.id, t.depth + 1
      FROM accounts a
      JOIN tree t ON a.parent_id = t.id
      WHERE a.name != 'Bank Accounts'
    )
    SELECT id, name, parent_id, currency, account_type, depth
    FROM tree
    WHERE is_active = TRUE AND name != 'Bank Accounts'
    ORDER BY path
  `);

  const accounts = treeResult.rows;
  const accountIds = accounts.map(a => a.id);

  // Get closing balances for all BS accounts as of the base year
  const balancesResult = await db.query(`
    SELECT DISTINCT ON (account_id)
      account_id, closing_balance, currency
    FROM transactions
    WHERE transaction_date <= $1
      AND closing_balance IS NOT NULL
      AND account_id = ANY($2)
    ORDER BY account_id, transaction_date DESC, id DESC
  `, [asOfDate, accountIds]);

  // Get FX rates for conversion
  const currencies = new Set();
  for (const row of balancesResult.rows) {
    if (row.currency && row.currency !== 'USD') currencies.add(row.currency);
  }
  for (const acc of accounts) {
    if (acc.currency && acc.currency !== 'USD') currencies.add(acc.currency);
  }

  const fxRates = { USD: 1 };
  if (currencies.size > 0) {
    const ratesResult = await db.query(`
      SELECT DISTINCT ON (from_currency)
        from_currency, rate
      FROM exchange_rates
      WHERE from_currency = ANY($1) AND to_currency = 'USD'
      ORDER BY from_currency, ABS(rate_date - $2::date) ASC
    `, [Array.from(currencies), asOfDate]);
    for (const row of ratesResult.rows) {
      const rate = parseFloat(row.rate);
      if (rate > 0) fxRates[row.from_currency] = 1 / rate;
    }
  }

  // Build leaf balance map
  const leafBalanceMap = {};
  for (const row of balancesResult.rows) {
    leafBalanceMap[row.account_id] = {
      balance_lc: parseFloat(row.closing_balance) || 0,
      currency: row.currency || 'USD',
    };
  }

  // Build parent → children map for aggregation
  const childrenMap = {};
  for (const acc of accounts) {
    if (acc.parent_id) {
      if (!childrenMap[acc.parent_id]) childrenMap[acc.parent_id] = [];
      childrenMap[acc.parent_id].push(acc.id);
    }
  }

  // Recursive function to compute aggregated balance (sum of all descendants)
  const aggregatedCache = {};
  function getAggregatedBalance(accountId) {
    if (aggregatedCache[accountId] !== undefined) return aggregatedCache[accountId];

    let totalLc = 0;
    let totalUsd = 0;
    const children = childrenMap[accountId] || [];

    if (children.length === 0) {
      // Leaf node — use its own balance
      const lb = leafBalanceMap[accountId];
      if (lb) {
        totalLc = lb.balance_lc;
        const fxRate = fxRates[lb.currency] || 1;
        totalUsd = lb.balance_lc / fxRate;
      }
    } else {
      // Parent node — sum children
      for (const childId of children) {
        const childBal = getAggregatedBalance(childId);
        totalUsd += childBal.balance_usd;
        // For parent nodes, LC is mixed currencies so we only track USD
        totalLc += childBal.balance_lc;
      }
    }

    aggregatedCache[accountId] = { balance_lc: totalLc, balance_usd: totalUsd };
    return aggregatedCache[accountId];
  }

  // Build tree response
  const accountMap = {};
  for (const acc of accounts) {
    const bal = getAggregatedBalance(acc.id);
    const leafBal = leafBalanceMap[acc.id];
    const isLeaf = !childrenMap[acc.id] || childrenMap[acc.id].length === 0;
    const hasBalance = Math.abs(bal.balance_usd) > 0.01;

    accountMap[acc.id] = {
      account_id: acc.id,
      account_name: acc.name,
      parent_id: acc.parent_id,
      currency: acc.currency,
      account_type: acc.account_type,
      depth: acc.depth,
      is_leaf: isLeaf,
      balance_lc: isLeaf && leafBal ? leafBal.balance_lc : bal.balance_lc,
      balance_usd: bal.balance_usd,
      has_balance: hasBalance,
      already_added: existingAccountIds.has(acc.id),
      children: [],
    };
  }

  // Nest children under parents
  const roots = [];
  for (const acc of accounts) {
    const node = accountMap[acc.id];
    if (acc.parent_id && accountMap[acc.parent_id]) {
      accountMap[acc.parent_id].children.push(node);
    } else {
      roots.push(node);
    }
  }

  return {
    data: roots,
    baseYear: Number(baseYear),
    asOfDate,
    fxRates,
    summary: {
      total_accounts: accounts.length,
      with_balance: accounts.filter(a => Math.abs(getAggregatedBalance(a.id).balance_usd) > 0.01).length,
      already_added: existingAccountIds.size,
    },
  };
}

/**
 * Base-year P&L values from completed modules (by FC Line name) and
 * income/expense items, keyed by label. Non-zero contributions only.
 *
 * CR046 window (fixed v3.0.88): a module's income/expense stream only counts in the base
 * year if its window is OPEN that year. Rent that starts in 2028 does not exist in 2026, so
 * summing income_amount blindly put it in the base-year column — and, via the engine's
 * budget-NCF query, into the cash sweep's opening cash.
 *
 * `baseYear` null ⇒ no window filter (the old behavior), so callers that do not know the
 * scenario's PeriodStart are unchanged.
 */
async function getBaseYearValues(scenarioId, baseYear = null) {
  // Reused by both halves of the UNION: the stream must have started by the base year and
  // not yet have ended. NULL bounds are unbounded.
  const windowFilter = (prefix) => baseYear == null ? '' : `
      AND (m.${prefix}_start_date IS NULL OR EXTRACT(YEAR FROM m.${prefix}_start_date) <= ${Number(baseYear)})
      AND (m.${prefix}_end_date   IS NULL OR EXTRACT(YEAR FROM m.${prefix}_end_date)   >= ${Number(baseYear)})`;

  // ...and if the window OPENS or CLOSES in the base year, the stream only runs for half of
  // it (the July-1 convention the projection already applies). Without this the base year
  // would book the full amount while every other layer booked half — the same figure
  // disagreeing with itself across the display, the sweep's opening cash and the tax.
  const halfYear = (prefix) => baseYear == null ? '1' : `
      (CASE WHEN EXTRACT(YEAR FROM m.${prefix}_start_date) = ${Number(baseYear)}
              OR EXTRACT(YEAR FROM m.${prefix}_end_date)   = ${Number(baseYear)}
            THEN 0.5 ELSE 1 END)`;
  // Get income/expense amounts from BS modules (by FC Line name)
  const bsResult = await db.query(`
    SELECT
      COALESCE(exp_line.name, 'Unassigned Expense') as label,
      'expense' as type,
      SUM(CASE WHEN m.expense_amount IS NOT NULL AND m.expense_amount != 0
          THEN -m.expense_amount * ${halfYear('expense')} ELSE 0 END) as amount
    FROM forecast_modules m
    LEFT JOIN fc_lines exp_line ON m.expense_fc_line_id = exp_line.id
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
      AND m.expense_fc_line_id IS NOT NULL${windowFilter('expense')}
    GROUP BY exp_line.name
    UNION ALL
    SELECT
      COALESCE(inc_line.name, 'Unassigned Income') as label,
      'income' as type,
      SUM(COALESCE(m.income_amount, 0) * ${halfYear('income')}) as amount
    FROM forecast_modules m
    LEFT JOIN fc_lines inc_line ON m.income_fc_line_id = inc_line.id
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
      AND m.income_fc_line_id IS NOT NULL${windowFilter('income')}
    GROUP BY inc_line.name
  `, [scenarioId]);

  // Get base values from IncExp items (by FC Line name or item name)
  const incexpResult = await db.query(`
    SELECT
      COALESCE(fl.name, ie.name) as label,
      ie.base_value as amount
    FROM forecast_income_expense ie
    LEFT JOIN fc_lines fl ON ie.fc_line_id = fl.id
    WHERE ie.scenario_id = $1 AND COALESCE(ie.setup_status, 'new') NOT IN ('new', 'exclude')
  `, [scenarioId]);

  const values = {};
  for (const row of bsResult.rows) {
    const amt = parseFloat(row.amount) || 0;
    if (amt !== 0) values[row.label] = (values[row.label] || 0) + amt;
  }
  for (const row of incexpResult.rows) {
    const amt = parseFloat(row.amount) || 0;
    if (amt !== 0) values[row.label] = (values[row.label] || 0) + amt;
  }

  return values;
}

module.exports = {
  lookupAccountByName,
  refreshModulesFromActuals,
  listAllModulesRaw,
  findCashSweepPriorityClash,
  clearOtherCashSweepTargets,
  replaceModuleSchedules,
  resolveIncExpAccountFromFcLine,
  replaceIncExpChanges,
  buildAddFromActualsTree,
  getBaseYearValues,
};
