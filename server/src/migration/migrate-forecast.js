/**
 * Migrate Forecast Data from MongoDB to PostgreSQL
 *
 * Migrates FCModule and FCIncExp collections to their respective PostgreSQL tables.
 * Handles the nested arrays (Invest, Dispose, IncomePct) by normalizing into separate tables.
 *
 * Usage: MONGO_URI=... DATABASE_URL=... node migrate-forecast.js
 */

const mongoose = require('mongoose');
const db = require('../v2/db');

// MongoDB schemas
const transferSchema = new mongoose.Schema({
  Date: Date,
  Amount: Number,
  Flag: String
}, { _id: false });

const incomePctSchema = new mongoose.Schema({
  Date: Date,
  Value: Number
}, { _id: false });

const FCModuleSchema = new mongoose.Schema({
  Scenario: String,
  Account: String,
  Matched: Boolean,
  Name: String,
  Type: String,
  Currency: String,
  ExpCategory: String,
  Expense: Number,
  ExpensePct: Number,
  IncomeCategory: String,
  Income: Number,
  IncomePct: [incomePctSchema],
  BaseDate: Date,
  BaseValue: Number,
  MarketValue: Number,
  BaseValueUSD: Number,
  MarketValueUSD: Number,
  Growth: Number,
  Comment: String,
  Invest: [transferSchema],
  Dispose: [transferSchema]
});

const FCIncExpSchema = new mongoose.Schema({
  Scenario: String,
  Account: String,
  Matched: Boolean,
  Name: String,
  Type: String,
  Currency: String,
  BaseDate: Date,
  BaseValue: Number,
  BaseValueUSD: Number,
  Growth: Number,
  Comment: String,
  Change: [transferSchema]
});

const FCModule = mongoose.model('FCModule', FCModuleSchema, 'FCModule');
const FCIncExp = mongoose.model('FCIncExp', FCIncExpSchema, 'FCIncExp');

async function migrateForecast() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Load account lookup
  const accountResult = await db.query('SELECT id, name FROM accounts');
  const accountNameToId = new Map(accountResult.rows.map(r => [r.name, r.id]));

  // Get or create scenarios
  const scenarios = await FCModule.distinct('Scenario');
  const incExpScenarios = await FCIncExp.distinct('Scenario');
  const allScenarios = [...new Set([...scenarios, ...incExpScenarios])];

  console.log(`Found scenarios: ${allScenarios.join(', ')}`);

  const scenarioMap = new Map();
  for (const name of allScenarios) {
    if (!name) continue;

    const existing = await db.query('SELECT id FROM forecast_scenarios WHERE name = $1', [name]);
    if (existing.rows.length > 0) {
      scenarioMap.set(name, existing.rows[0].id);
    } else {
      const result = await db.query(`
        INSERT INTO forecast_scenarios (name, description, is_active)
        VALUES ($1, $2, TRUE)
        RETURNING id
      `, [name, `Migrated scenario: ${name}`]);
      scenarioMap.set(name, result.rows[0].id);
    }
  }

  // Migrate FCModule (balance sheet modules)
  console.log('\nMigrating forecast modules...');
  await db.query('TRUNCATE forecast_modules CASCADE');

  const modules = await FCModule.find();
  console.log(`Found ${modules.length} forecast modules`);

  let moduleCount = 0;
  for (const mod of modules) {
    const scenarioId = scenarioMap.get(mod.Scenario);
    if (!scenarioId) {
      console.log(`  Skipping module "${mod.Name}" - no scenario`);
      continue;
    }

    const accountId = accountNameToId.get(mod.Account) || null;

    try {
      const result = await db.query(`
        INSERT INTO forecast_modules (
          scenario_id, account_id, name, module_type, currency,
          expense_category, expense_amount, expense_pct,
          income_category, income_amount,
          base_date, base_value, market_value, base_value_usd, market_value_usd,
          growth_rate, comment, is_matched
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING id
      `, [
        scenarioId,
        accountId,
        mod.Name,
        mod.Type,
        mod.Currency || 'USD',
        mod.ExpCategory,
        mod.Expense || 0,
        mod.ExpensePct || 0,
        mod.IncomeCategory,
        mod.Income || 0,
        mod.BaseDate,
        mod.BaseValue || 0,
        mod.MarketValue || 0,
        mod.BaseValueUSD || 0,
        mod.MarketValueUSD || 0,
        mod.Growth || 0,
        mod.Comment,
        mod.Matched || false
      ]);

      const moduleId = result.rows[0].id;

      // Insert IncomePct entries
      if (mod.IncomePct && mod.IncomePct.length > 0) {
        for (const pct of mod.IncomePct) {
          await db.query(`
            INSERT INTO forecast_module_income_pct (module_id, effective_date, value)
            VALUES ($1, $2, $3)
            ON CONFLICT (module_id, effective_date) DO UPDATE SET value = EXCLUDED.value
          `, [moduleId, pct.Date, pct.Value || 0]);
        }
      }

      // Insert Invest entries
      if (mod.Invest && mod.Invest.length > 0) {
        for (const inv of mod.Invest) {
          await db.query(`
            INSERT INTO forecast_module_investments (module_id, investment_date, amount, flag)
            VALUES ($1, $2, $3, $4)
          `, [moduleId, inv.Date, inv.Amount || 0, inv.Flag]);
        }
      }

      // Insert Dispose entries
      if (mod.Dispose && mod.Dispose.length > 0) {
        for (const disp of mod.Dispose) {
          await db.query(`
            INSERT INTO forecast_module_disposals (module_id, disposal_date, amount, flag)
            VALUES ($1, $2, $3, $4)
          `, [moduleId, disp.Date, disp.Amount || 0, disp.Flag]);
        }
      }

      moduleCount++;
    } catch (err) {
      console.error(`Error migrating module "${mod.Name}":`, err.message);
    }
  }

  console.log(`Migrated ${moduleCount} forecast modules`);

  // Migrate FCIncExp (income/expense forecasts)
  console.log('\nMigrating forecast income/expense items...');
  await db.query('TRUNCATE forecast_income_expense CASCADE');

  const incExpItems = await FCIncExp.find();
  console.log(`Found ${incExpItems.length} income/expense items`);

  let incExpCount = 0;
  for (const item of incExpItems) {
    const scenarioId = scenarioMap.get(item.Scenario);
    if (!scenarioId) {
      console.log(`  Skipping item "${item.Name}" - no scenario`);
      continue;
    }

    const accountId = accountNameToId.get(item.Account) || null;

    try {
      const result = await db.query(`
        INSERT INTO forecast_income_expense (
          scenario_id, account_id, name, item_type, currency,
          base_date, base_value, base_value_usd, growth_rate, comment, is_matched
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [
        scenarioId,
        accountId,
        item.Name,
        item.Type,
        item.Currency || 'USD',
        item.BaseDate,
        item.BaseValue || 0,
        item.BaseValueUSD || 0,
        item.Growth || 0,
        item.Comment,
        item.Matched || false
      ]);

      const incExpId = result.rows[0].id;

      // Insert Change entries
      if (item.Change && item.Change.length > 0) {
        for (const chg of item.Change) {
          await db.query(`
            INSERT INTO forecast_incexp_changes (incexp_id, change_date, amount, flag)
            VALUES ($1, $2, $3, $4)
          `, [incExpId, chg.Date, chg.Amount || 0, chg.Flag]);
        }
      }

      incExpCount++;
    } catch (err) {
      console.error(`Error migrating inc/exp item "${item.Name}":`, err.message);
    }
  }

  console.log(`Migrated ${incExpCount} income/expense items`);

  // Print summary
  const summary = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM forecast_modules) as modules,
      (SELECT COUNT(*) FROM forecast_module_investments) as investments,
      (SELECT COUNT(*) FROM forecast_module_disposals) as disposals,
      (SELECT COUNT(*) FROM forecast_module_income_pct) as income_pcts,
      (SELECT COUNT(*) FROM forecast_income_expense) as incexp_items,
      (SELECT COUNT(*) FROM forecast_incexp_changes) as incexp_changes
  `);

  console.log('\nForecast migration summary:');
  console.log(`  Modules: ${summary.rows[0].modules}`);
  console.log(`  Investments: ${summary.rows[0].investments}`);
  console.log(`  Disposals: ${summary.rows[0].disposals}`);
  console.log(`  Income %: ${summary.rows[0].income_pcts}`);
  console.log(`  Inc/Exp items: ${summary.rows[0].incexp_items}`);
  console.log(`  Inc/Exp changes: ${summary.rows[0].incexp_changes}`);

  await mongoose.disconnect();
  console.log('\nDisconnected from MongoDB');
}

// Run if called directly
if (require.main === module) {
  migrateForecast()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { migrateForecast };
