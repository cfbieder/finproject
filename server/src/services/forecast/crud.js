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
const variants = require('../../v2/services/forecastVariants'); // CR050
const { baseYearFxRate } = require('./fcbuilder-setup'); // CR064 P8 — base-year FX
const validate = require('../../v2/utils/validate'); // CR069 P2 — 400s from the write path

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
  // CR050: this is a set-based UPDATE across every module in the scenario — it bypasses
  // repo.updateModule entirely, so on a variant it would write rows the next sync silently
  // erases. Re-basing from ledger actuals is the BASE scenario's job; a variant inherits the
  // result. Refuse rather than lose the write.
  await variants.assertNotVariant(scenarioId, 'Refresh from actuals');

  // CR062 — a LOAN opts IN to the market-value refresh, and it is the one module
  // type that should. The exclusion above exists because broker-reported MV cannot
  // be derived from a cash ledger; a loan's outstanding balance is the exact
  // opposite — the mortgage account's ledger balance IS what is owed. Leaving it
  // out would re-base `base_value` around a stale outstanding, which is the number
  // every projected year starts from.
  const result = await db.query(`
    UPDATE forecast_modules m
    SET base_value = COALESCE(b.balance_lc, 0),
        base_value_usd = COALESCE(b.balance_usd, 0),
        market_value = CASE WHEN m.loan_interest_rate IS NOT NULL
                            THEN COALESCE(b.balance_lc, 0) ELSE m.market_value END,
        market_value_usd = CASE WHEN m.loan_interest_rate IS NOT NULL
                                THEN COALESCE(b.balance_usd, 0) ELSE m.market_value_usd END,
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
  // CR050: on a variant's inherited module the schedules are an override, not a write — they
  // replace wholesale (these child tables have no unique constraint to merge on), which is
  // exactly what this function already does to the base's rows.
  const intercepted = await variants.interceptSchedules('module', id, body);
  if (intercepted.intercepted) return;

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

    // CR062 — a loan's principal schedule, as a % of the original amount per year. Same
    // replace-wholesale shape as the two above, for the same reason: the table has no key to
    // merge on, so a partial write would leave a schedule that is neither the old nor the new.
    if (Array.isArray(body.Amortization)) {
      await client.query('DELETE FROM forecast_module_amortization WHERE module_id = $1', [id]);
      for (const row of body.Amortization) {
        if (row.Date) {
          await repo.setAmortization(id, {
            effective_date: row.Date,
            pct: row.Pct ?? row.Value ?? row.Amount ?? 0,
          }, client);
        }
      }
    }

    // CR069 P3 — IncomePct and IncomeSteps are NOT here: they are `Spread %` and `Fixed $`
    // rows on a stream, written by `replaceModuleStreams`. What remains is the balance path's
    // own schedules, which belong to the valuation and never moved.
  });
}

/**
 * CR062 — what a retype-to-Loan will destroy, WITHOUT destroying it. Backs the
 * confirm the UI shows on the first save that turns a module into a loan; the
 * same shape the write path reports afterwards, so the two cannot disagree.
 */
async function previewLoanRetype(id) {
  // CR069 P2 — the yield schedule, the income steps and both windows moved onto STREAMS. The
  // counts must follow, or the confirm dialog under-reports what the retype destroys: it said
  // "1 yield row" from a table nothing writes any more while the real rows sat on the stream.
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM forecast_module_investments WHERE module_id = $1) AS invest,
      (SELECT COUNT(*)::int FROM forecast_module_disposals   WHERE module_id = $1) AS dispose,
      (SELECT COUNT(*)::int FROM forecast_stream_changes c
         JOIN forecast_streams st ON st.id = c.stream_id
        WHERE st.module_id = $1 AND c.flag = 'Spread %') AS income_pct,
      -- CR064 P6 — a loan has no income, so its income steps cannot survive the retype
      -- either. Counted here so the confirm names them before they go.
      (SELECT COUNT(*)::int FROM forecast_stream_changes c
         JOIN forecast_streams st ON st.id = c.stream_id
        WHERE st.module_id = $1 AND st.direction = 'income' AND c.flag = 'Fixed $') AS income_steps,
      (SELECT COUNT(*)::int FROM forecast_streams
        WHERE module_id = $1 AND (start_date IS NOT NULL OR end_date IS NOT NULL)) AS windows
  `, [id]);
  const r = rows[0] || { invest: 0, dispose: 0, income_pct: 0, income_steps: 0, windows: 0 };
  return { ...r, total: r.invest + r.dispose + r.income_pct + r.income_steps + r.windows };
}

/**
 * CR062 — clear what a loan module cannot carry. Destructive, so `previewLoanRetype`
 * exists to show it first and the result is echoed back to the caller.
 *
 * ON A VARIANT this is an OVERRIDE, not a delete. A raw delete of inherited child
 * rows is silently reversed by the next force-sync from base — which runs at Step 0
 * of every generate — handing the module back exactly the rows the route then 400s
 * on. `interceptSchedules` with empty arrays is how CR050 expresses "this variant
 * has none of these", and it survives the sync.
 */
async function clearForLoanRetype(id) {
  const before = await previewLoanRetype(id);
  if (before.total === 0) return before;

  // Empty-array patches: on an inherited row this records the override; on a
  // variant-local or base row it falls through to the ordinary delete-and-reinsert.
  await replaceModuleSchedules(id, { Invest: [], Dispose: [] });

  // CR069 P2 — the yield schedule, the steps and both windows are STREAM properties now, so
  // clearing them is a stream write, which carries its own variant interception. What a loan
  // keeps is exactly one derived expense stream holding its interest line.
  const line = (await loadModuleStreams(id))
    .find((st) => st.direction === 'expense')?.fc_line_id ?? null;
  await replaceModuleStreams(id, {
    Streams: [{ Direction: 'expense', Mode: 'derived', FcLineId: line, Amount: 0, Changes: [] }],
  });

  return before;
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
 *
 * `client` lets the generation engine read this inside its own transaction: the sweep's
 * opening cash IS this base-year NCF, and the engine used to keep a hand-copied second
 * version of the query below. The copy drifted (it dropped every non-liability module
 * expense, so 2026 property costs never left the bank) and the two figures disagreed
 * silently for the whole horizon. One query, one caller-supplied handle — no second copy.
 */
async function getBaseYearValues(scenarioId, baseYear = null, client = db) {
  // CR075 — the base year IS THE BUDGET. Owner, 2026-08-07: *"forecast year −2 = ACTUAL,
  // forecast year −1 = BUDGET, forecast year 0 = start forecast."*
  //
  // This function used to derive the base year from the modules' STREAMS — summing each
  // stream's typed `amount` — and it was never the budget. Two ways it diverged, both live
  // on prod and both found by the owner reading the Review's 2026 column:
  //
  //   YIELD streams contributed ZERO. A yield stream's amount is 0 by construction (the card
  //   hides the box; the yield is a rate), so `CVC Dividend`, `Dividend Income` and
  //   `Interest Income` — 129,000 of budgeted investment income across 3.3M of market value —
  //   read as nothing. The function already had a branch for exactly this shape on LOAN
  //   streams, whose comment says "the stream amount is 0 on a derived stream by
  //   construction". The identical reasoning was never applied to `yield`.
  //
  //   AMOUNT streams disagreed with the budget anyway, because a typed base-year amount is
  //   not a budget: `UB Income` carried 128,205 against a budget of 192,266.
  //
  // Income was understated by 193,071 and the net by 161,302 — and `index.js` folds this into
  // the cash sweep's OPENING CASH, which the sweep then pins to its band every year, so the
  // error rode all 36 forecast years instead of washing out. That is the CR049 §1 failure
  // mode for the third time in this one function (after the ~65K liability-gated expense
  // branch and the ~400K unconverted-FX one, both recorded above in git history).
  //
  // Reading the budget deletes the machinery those two bugs lived in, which is most of the
  // argument for it. Gone with it:
  //   - the CR046 window filter and half-year convention — a budget entry is DATED, so a
  //     stream that starts mid-year is already only in the months it exists;
  //   - the CR062 loan-interest derivation — budgeted interest is a budgeted row;
  //   - the CR064 P8 per-currency conversion — `base_amount` is already USD, so there is no
  //     rate to get wrong and no `baseYearFxRate` to throw.
  //
  // What it does NOT cover, deliberately: budget entries with no category (72 rows, −86,796
  // on prod — card repayments, which have no P&L line by definition). They were not in the
  // stream-derived figure either, and this is the Review's P&L column.
  //
  // `baseYear` null means the caller could not resolve PeriodStart. There is no budget year
  // to read then, so return nothing rather than guessing — the old code's "no window filter"
  // fallback silently produced a full-horizon figure labelled as one year.
  if (baseYear == null) return {};

  const result = await client.query(`
    WITH RECURSIVE cat_tree AS (
      SELECT flc.fc_line_id, c.id
      FROM fc_line_categories flc
      JOIN accounts c ON flc.category_id = c.id
      UNION ALL
      SELECT ct.fc_line_id, ch.id
      FROM cat_tree ct
      JOIN accounts ch ON ch.parent_id = ct.id
    ),
    -- Each leaf counted once per fc_line. The same CTE \`fcLines.getBudgetTotals\` uses, so the
    -- base-year column and the stream cards' budget reference cannot disagree about which
    -- accounts a line covers.
    distinct_leaves AS (
      SELECT DISTINCT fc_line_id, id
      FROM cat_tree ct
      WHERE NOT EXISTS (SELECT 1 FROM accounts ch WHERE ch.parent_id = ct.id)
    )
    SELECT l.name AS label, COALESCE(SUM(be.base_amount), 0) AS amount
    FROM fc_lines l
    JOIN distinct_leaves dl ON dl.fc_line_id = l.id
    JOIN budget_entries be ON be.category_id = dl.id AND be.budget_year = $1
    GROUP BY l.name
  `, [baseYear]);

  const values = {};
  for (const row of result.rows) {
    const amt = parseFloat(row.amount) || 0;
    if (amt === 0) continue;   // an unbudgeted line is absent, not a zero row
    values[row.label] = (values[row.label] || 0) + amt;
  }
  return values;
}
/**
 * The sweep's OPENING CASH: every account in the `Bank Accounts` tree, valued the canonical way
 * and converted to USD at the rate nearest `asOfDate`.
 *
 * CR076 D2 — extracted from `index.js` so it can be TESTED against seeded rows rather than
 * asserted. It used to read the `closing_balance` column off each account's latest transaction,
 * while every other balance in Fin is `opening_balance + Σ(amount)` from `opening_balance_date`
 * (`services/reports.js`, whose comment calls closing_balance "prone to stale PS data"). On prod
 * the two disagreed by 11,276.93 — `PKO EUR` stored −4,848.85 EUR against a book value of
 * +151.15, and `PKO TFI` had no `closing_balance` row at all so 6,000 PLN counted as zero.
 *
 * That figure is `startingCash`, which the sweep pins its band to every year, so the error rode
 * all 36 forecast years — and `fcWarnings` W1/W4 judged "cash below the low band" against it.
 *
 * The CR024 `balance_from_feed` override is deliberately not replicated: 0 accounts in this tree
 * carry it. Currency comes from the ACCOUNT, matching `reports.js`.
 */
async function getOpeningBankCash(client, asOfDate) {
  const result = await client.query(`
    WITH RECURSIVE bank_tree AS (
      SELECT id, currency, opening_balance, opening_balance_date
      FROM accounts WHERE name = 'Bank Accounts'
      UNION ALL
      SELECT a.id, a.currency, a.opening_balance, a.opening_balance_date
      FROM accounts a JOIN bank_tree bt ON a.parent_id = bt.id
    ),
    account_balances AS (
      SELECT bt.id,
             COALESCE(bt.currency, 'USD') AS currency,
             bt.opening_balance + COALESCE(SUM(t.amount), 0) AS closing_balance
      FROM bank_tree bt
      LEFT JOIN transactions t
        ON t.account_id = bt.id
       AND t.transaction_date >= bt.opening_balance_date
       AND t.transaction_date <= $1
      GROUP BY bt.id, bt.currency, bt.opening_balance
    )
    SELECT ab.closing_balance, ab.currency,
      COALESCE(
        (SELECT er.rate FROM exchange_rates er
         WHERE er.from_currency = ab.currency AND er.to_currency = 'USD'
         ORDER BY ABS(er.rate_date - $1::date) ASC LIMIT 1),
        1.0
      ) AS fx_rate
    FROM account_balances ab
  `, [asOfDate]);

  let total = 0;
  for (const row of result.rows) {
    total += (parseFloat(row.closing_balance) || 0) * (parseFloat(row.fx_rate) || 1);
  }
  return total;
}

module.exports = {
  getOpeningBankCash,
  lookupAccountByName,
  refreshModulesFromActuals,
  listAllModulesRaw,
  findCashSweepPriorityClash,
  clearOtherCashSweepTargets,
  replaceModuleSchedules,
  replaceModuleStreams,
  loadModuleStreams,
  previewLoanRetype,
  clearForLoanRetype,
  buildAddFromActualsTree,
  getBaseYearValues,
};

/**
 * CR069 P2 — write a module's streams, from either shape.
 *
 * Accepts the NEW `Streams` array and the LEGACY per-direction fields, because the Modules
 * editor still sends the legacy ones until P3 replaces that form with stream cards. Both
 * converge on the same rows, so there is one writer and not two conventions.
 *
 * Replace-wholesale per direction, which is what every other schedule on a module already
 * does and what a `streams` variant patch means. Only the directions the body actually
 * mentions are touched: a PUT that changes only the loan rate must not delete the income
 * stream it never named.
 */

/**
 * CR051 — the base-year rate a non-USD stream's USD twin is derived at.
 *
 * Derived, never trusted from the client, and a currency the scenario cannot convert is
 * REFUSED: before CR051 a PLN line silently booked its native amount as dollars (~4x too
 * large) and a zero rate produced Infinity. The engine fails loud on the same condition at
 * build time; this stops the row being written at all, where the owner can still see why.
 *
 * Resolved LAZILY — only when a non-USD amount is actually about to be stored. Doing it up
 * front made an empty EUR draft (no streams at all) 400 on a rate it never needed, which is a
 * scenario-setup complaint raised against a save that stores nothing.
 */
async function resolveFxRate(c, moduleId, wanted) {
  const needsRate = (wanted || []).some((w) => Math.abs(Number(w.Amount ?? w.amount) || 0) > 0);
  if (!needsRate) return 1;

  const mod = (await c.query(
    `SELECT m.currency, s.name AS scenario_name
       FROM forecast_modules m JOIN forecast_scenarios s ON s.id = m.scenario_id
      WHERE m.id = $1`, [moduleId]
  )).rows[0];
  const currency = (mod?.currency || 'USD').trim() || 'USD';
  if (currency === 'USD') return 1;

  // A 400, not a 500: an unconvertible currency is the caller telling us something the
  // scenario cannot express, and the owner needs the sentence rather than a stack trace.
  let rate;
  try {
    rate = await baseYearFxRate(mod.scenario_name, currency);
  } catch (err) {
    throw validate.badRequest(
      `Cannot store a ${currency} amount on "${mod.scenario_name}": ${err.message}`
    );
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw validate.badRequest(
      `No usable base-year FX rate for ${currency} on "${mod.scenario_name}" — set the FX assumption first.`
    );
  }
  return rate;
}

/** Which directions a write touches — the ones its rows are replaced for. */
function directionsTouched() {
  // A `Streams` write is the WHOLE set, so both directions are replaced. There is no partial
  // form any more — the cards render every stream the module has.
  return ['income', 'expense'];
}

/** One desired stream in variant-patch shape (matches `forecastVariants.baseSchedule`). */
function toPatchStream(st, fxRate) {
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const amount = Math.abs(Number(st.Amount ?? st.amount) || 0);
  return {
    direction: st.Direction ?? st.direction,
    fc_line_id: num(st.FcLineId ?? st.fc_line_id),
    mode: st.Mode ?? st.mode ?? 'amount',
    amount,
    amount_usd: Math.abs(amount / (fxRate || 1)),
    growth_mult: num(st.GrowthMult ?? st.growth_mult),
    start_date: (st.StartDate ?? st.start_date) || null,
    end_date: (st.EndDate ?? st.end_date) || null,
    tax_rate_override: num(st.TaxRateOverride ?? st.tax_rate_override),
    changes: (Array.isArray(st.Changes ?? st.changes) ? (st.Changes ?? st.changes) : [])
      .filter((ch) => (ch.Date ?? ch.change_date))
      .map((ch) => ({
        change_date: ch.Date ?? ch.change_date,
        amount: Number(ch.Amount ?? ch.amount) || 0,
        flag: ch.Flag ?? ch.flag ?? 'Fixed $',
      })),
  };
}

async function replaceModuleStreams(id, body, client) {
  const c = client || db;
  const toNum = (v) => (v === '' || v == null ? null : Number(v));

  // CR069 P3 — one shape. The legacy per-direction translation retired with the columns; the
  // editor sends `Streams` and nothing else does. A body that mentions no streams touches none.
  if (!Array.isArray(body.Streams)) return;
  const wanted = body.Streams;

  // CR050 — on a VARIANT's inherited module this is an override, not a write.
  //
  // Every sibling write path is intercepted (`repo.updateModule`, `replaceModuleSchedules`);
  // this one was not, and streams are a `SCHEDULE_TABLES` entry, so `syncEntity` rewrites
  // them from base-or-patch on every sync. A direct write would read back correctly and then
  // VANISH the next time the base was touched — deferred, non-deterministic data loss, which
  // forecastVariants' own header calls the worst failure mode the feature can have. Found by
  // the pre-deploy security review, not by a test.
  //
  // A `streams` patch replaces the set WHOLESALE, so it has to carry every stream — including
  // the directions this body never mentioned, which are read back from the row as it stands.
  const inherited = await variants.inheritedRow('module', id);
  if (inherited) {
    const keep = (await c.query(
      `SELECT * FROM forecast_streams WHERE module_id = $1
        AND direction <> ALL($2::text[]) ORDER BY id`,
      [id, directionsTouched()]
    )).rows;
    const keepPatch = [];
    for (const st of keep) {
      const chg = (await c.query(
        'SELECT change_date, amount, flag FROM forecast_stream_changes WHERE stream_id = $1 ORDER BY id',
        [st.id]
      )).rows;
      keepPatch.push({
        direction: st.direction, fc_line_id: st.fc_line_id, mode: st.mode,
        amount: st.amount, amount_usd: st.amount_usd, growth_mult: st.growth_mult,
        start_date: st.start_date, end_date: st.end_date,
        tax_rate_override: st.tax_rate_override, changes: chg,
      });
    }
    const fx = await resolveFxRate(c, id, wanted);
    const patch = { streams: [...keepPatch, ...wanted.map((w) => toPatchStream(w, fx))] };
    await db.transaction(async (client) => {
      await variants.mergeEntityOverride(client, inherited.scenario_id, 'module', inherited.origin_base_id, patch);
      await variants.syncVariant(inherited.scenario_id, { client, force: true });
    });
    return;
  }

  const fxRate = await resolveFxRate(c, id, wanted);

  const directions = directionsTouched();

  for (const direction of directions) {
    await c.query(
      'DELETE FROM forecast_streams WHERE module_id = $1 AND direction = $2', [id, direction]
    );
    for (const st of wanted.filter((w) => (w.Direction || w.direction) === direction)) {
      const amount = Math.abs(Number(st.Amount ?? st.amount) || 0);
      const fcLineId = toNum(st.FcLineId ?? st.fc_line_id);
      const changes = Array.isArray(st.Changes ?? st.changes) ? (st.Changes ?? st.changes) : [];
      const window = (st.StartDate ?? st.start_date) || (st.EndDate ?? st.end_date);
      const tax = toNum(st.TaxRateOverride ?? st.tax_rate_override);
      const growth = toNum(st.GrowthMult ?? st.growth_mult);

      // A stream that carries NOTHING AT ALL is skipped rather than stored as a row the engine
      // will read as zero forever. But "nothing" means nothing — the first version of this
      // tested only the line and the amount, and so DISCARDED a stream carrying just a window
      // or just a tax override. The owner typed a value, got a 200, and found it empty on
      // reopen: the CR043 N10 defect class, caught by the e2e "value must survive a reopen"
      // spec setting an income start year on a module with no income line.
      if (!fcLineId && amount === 0 && changes.length === 0
          && !window && tax == null && growth == null) continue;

      const ins = await c.query(`
        INSERT INTO forecast_streams (
          module_id, direction, fc_line_id, mode, amount, amount_usd,
          growth_mult, start_date, end_date, tax_rate_override
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
      `, [
        id, direction, fcLineId, st.Mode ?? st.mode ?? 'amount', amount,
        // Derived, not accepted: native / base-year rate (1 for USD, so this is a no-op there).
        Math.abs(amount / fxRate),
        toNum(st.GrowthMult ?? st.growth_mult),
        st.StartDate ?? st.start_date ?? null,
        st.EndDate ?? st.end_date ?? null,
        toNum(st.TaxRateOverride ?? st.tax_rate_override),
      ]);
      for (const ch of changes) {
        const date = ch.Date ?? ch.change_date;
        if (!date) continue;
        await c.query(
          `INSERT INTO forecast_stream_changes (stream_id, change_date, amount, flag)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (stream_id, change_date, flag) DO UPDATE SET amount = EXCLUDED.amount`,
          [ins.rows[0].id, date, Number(ch.Amount ?? ch.amount) || 0, ch.Flag ?? ch.flag ?? 'Fixed $']
        );
      }
    }
  }
}

/** A module's streams with their change rows, ordered — for the read path. */
async function loadModuleStreams(moduleId, client = db) {
  // `fc_line_name` is joined here and not only in the LIST's aggregate. The two projections of a
  // stream drifted on exactly this in v3.16.0: the module editor loads from GET /modules/:id,
  // which came through this function, so the Actual field reported "no line set" on every module
  // that had one. A form that cannot see a field it is editing will guess, and it did.
  const streams = (await client.query(
    `SELECT s.*, l.name AS fc_line_name
       FROM forecast_streams s
       LEFT JOIN fc_lines l ON l.id = s.fc_line_id
      WHERE s.module_id = $1
      ORDER BY s.direction, s.id`, [moduleId]
  )).rows;
  if (!streams.length) return [];
  const changes = (await client.query(
    'SELECT * FROM forecast_stream_changes WHERE stream_id = ANY($1) ORDER BY change_date',
    [streams.map((s) => s.id)]
  )).rows;
  const byStream = new Map();
  for (const c of changes) {
    if (!byStream.has(c.stream_id)) byStream.set(c.stream_id, []);
    byStream.get(c.stream_id).push(c);
  }
  return streams.map((s) => ({ ...s, changes: byStream.get(s.id) || [] }));
}
